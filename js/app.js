import { CONFIG } from './config.js';
import { $, $$, el, escapeHtml, store, randomCode } from './util.js';
import { loadQuestions, facets as computeFacets, QuestionSource, SUBJECT_SHORT, matchesFilters } from './questions.js';
import { GameEngine } from './engine.js';
import { GameView, starButton } from './game-view.js';
import { Bookmarks } from './bookmarks.js';
import { STAGE_LABEL } from './rounds.js';
import { SettingsPanel, loadSettings, saveSettings, DEFAULTS } from './settings.js';
import { Stats, renderStats } from './stats.js';
import { RoomHost, RoomClient } from './net.js';
import { richText, plainText } from './text.js';

const state = {
  questions: [],
  facets: { subjects: [], sets: [], levels: [], years: [] },
  settings: loadSettings(),
  mode: 'solo',      // solo | room
  role: null,        // host | player (rooms)
  engine: null,
  source: null,
  host: null,
  client: null,
  roomSettings: null,
  roomSummary: [],
  loaded: false,
};

// One ID per browser tab (kept across reloads so a player who refreshes rejoins with their score).
const pid = (() => {
  try {
    let id = sessionStorage.getItem('lockout.pid');
    if (!id) { id = `u${randomCode(10)}`; sessionStorage.setItem('lockout.pid', id); }
    return id;
  } catch { return `u${randomCode(10)}`; }
})();

// ── Actions the view triggers; they route to the engine or to the host ──
const actions = {
  buzz() { act('buzz'); },
  submit(text) { act('answer', text); },
  live(text) { if (state.role === 'player' || state.role === 'host') act('live', text); },
  next() { act('next'); },
  skip() { act('skip'); },
  togglePause() { act('pause'); },
  override(index, correct) { act('override', { index, correct }); },
};

function act(kind, arg) {
  if (state.role === 'player') {
    const c = state.client;
    if (kind === 'buzz') c.send({ t: 'buzz' });
    else if (kind === 'answer') c.send({ t: 'answer', text: arg });
    else if (kind === 'live') c.send({ t: 'live', text: arg });
    else if (kind === 'next') c.send({ t: 'next' });
    return;
  }
  const e = state.engine;
  if (!e) return;
  const me = state.mode === 'solo' ? 'me' : pid;
  switch (kind) {
    case 'buzz': e.buzz(me); break;
    case 'answer': e.submit(me, arg); break;
    case 'live': e.live(me, arg); break;
    case 'next':
      if (e.phase === 'empty') reconfigureSource();
      if (['idle', 'revealed', 'empty'].includes(e.phase)) e.next();
      break;
    case 'skip': if (e.phase !== 'idle' && e.phase !== 'empty') e.skip(); break;
    case 'pause': e.paused ? e.resume() : e.pause(); break;
    case 'override': e.override(arg.index, arg.correct); break;
  }
}

// ── View + stats hooks ──────────────────────────────────────────────────
const personal = () => (state.role === 'player' ? state.playerPersonal : state.mode === 'room' ? state.roomSettings : state.settings);
const view = new GameView({
  actions,
  hooks: {
    personal,
    lookup: id => state.byId?.get(id),
    onReveal(d, mine) {
      const q = d.q;
      return Stats.add({
        qid: q.id, subject: q.subject, type: d.kind || q.type, qtype: q.type, format: q.format, set: q.set,
        qtext: plainText(q.question).slice(0, 200), answer: q.choices && q.answerLetter ? `${q.answerLetter}) ${q.answerText}` : q.answer,
        mode: state.mode, ...mine,
      });
    },
    onRecordUpdate(rid, mine) { if (rid) Stats.update(rid, mine); },
  },
});

const panel = new SettingsPanel($('#settings-panel'), { onChange: onSettingsChange });

function onSettingsChange(s, what) {
  if (what === 'speech' && !s.readAloud) view.stopVoice();
  if (state.mode === 'solo') {
    saveSettings(s);
    if (what === 'filters') reconfigureSource();
  } else if (state.role === 'host') {
    saveSettings({ ...state.settings, sound: s.sound, voiceURI: s.voiceURI });
    if (what === 'filters' || what === 'teams') reconfigureSource();
    if (what === 'rules' || what === 'teams') { state.engine.emitScores(); renderRoomBar(); }
    if (what === 'teams') { panel.render(s, state.facets); updatePoolCount(); }
    state.host.setSummary(summaryLines(s));
  }
}

function statsCtx() { return { missed: Stats.missedIds(), seen: Stats.seenIds(), saved: Bookmarks.ids() }; }

function reconfigureSource() {
  if (!state.source) return;
  const s = state.mode === 'solo' ? state.settings : state.roomSettings;
  state.source.configure(s, state.mode === 'solo' ? statsCtx() : {});
  updatePoolCount();
}

function updatePoolCount() {
  const s = state.source;
  if (!s) return;
  const mode = (state.mode === 'solo' ? state.settings : state.roomSettings).typeMode;
  const noun = mode === 'bonus' ? 'bonuses' : mode === 'mixed' ? 'questions' : 'toss-ups';
  panel.setPoolCount(s.size ? `${s.size.toLocaleString()} ${noun} match these settings.` : `No ${noun} match these settings.`);
}

// ── Solo ────────────────────────────────────────────────────────────────
function ensureSolo() {
  if (state.mode === 'solo' && state.engine) return;
  state.mode = 'solo';
  state.role = null;
  state.source = new QuestionSource(state.questions, state.settings, statsCtx());
  state.engine = new GameEngine({ source: state.source, settings: state.settings });
  state.engine.addPlayer('me', 'You');
  state.engine.on('*', (ev, d) => view.handle(ev, d));
  view.configure({ me: 'me', mode: 'solo', isHost: true });
  state.engine.emitScores();
  view.scoreLine.textContent = '';
  panel.roomMode = false;
  panel.readOnly = false;
  panel.render(state.settings, state.facets);
  updatePoolCount();
  $('#room-bar').hidden = true;
  $('#players-panel').hidden = true;
  $('#chat-panel').hidden = true;
}

function stopSolo() {
  if (state.mode === 'solo' && state.engine) state.engine.stop();
  state.engine = null;
  state.source = null;
}

// ── Rooms ───────────────────────────────────────────────────────────────
function summaryLines(s) {
  const f = s.filters;
  const typeLabel = { mixed: 'Mixed toss-ups and bonuses, all buzz-in', tb: 'Toss-ups with bonuses', tossup: 'Toss-ups only', bonus: 'Bonuses only' }[s.typeMode];
  return [
    s.instant ? 'Whole question shown at once' : `Reading at ${s.wpm} words per minute`,
    f.subjects.length ? `Subjects: ${f.subjects.map(x => SUBJECT_SHORT[x] || x).join(', ')}` : 'All subjects',
    typeLabel + (f.formats.length === 1 ? (f.formats[0] === 'mc' ? ', multiple choice only' : ', short answer only') : ''),
    f.sets.length ? `${f.sets.length} packet${f.sets.length === 1 ? '' : 's'} picked` : 'All packets',
    f.stages?.length ? `Rounds: ${f.stages.map(k => STAGE_LABEL[k]).join(', ')}` : 'All rounds',
    s.typeMode === 'mixed'
      ? `Scoring: +${s.tossupPts} per question, −${s.interruptPenalty} wrong interrupt`
      : `Scoring: +${s.tossupPts} toss-up, +${s.bonusPts} bonus, −${s.interruptPenalty} wrong interrupt`,
    s.teams ? 'Teams on (A vs B)' : 'Every player for themselves',
    s.readAloud ? 'Questions are read aloud' : 'Questions are not read aloud',
  ];
}

async function createRoom(name) {
  setLobbyStatus('Creating room…');
  stopSolo();
  const rs = JSON.parse(JSON.stringify(state.settings));
  rs.filters.missedOnly = false;
  rs.filters.savedOnly = false;
  rs.filters.unseenOnly = false;
  state.roomSettings = rs;
  const source = new QuestionSource(state.questions, rs);
  const engine = new GameEngine({ source, settings: rs });
  const host = new RoomHost(engine);
  try {
    await host.open();
  } catch (err) {
    setLobbyStatus(err.message, true);
    return;
  }
  Object.assign(state, { mode: 'room', role: 'host', engine, source, host });
  engine.on('*', (ev, d) => view.handle(ev, d));
  host.on('sys', text => view.addChat('', text, true));
  host.on('error', err => showBanner(err.message));
  view.configure({ me: pid, mode: 'room', isHost: true });
  engine.addPlayer(pid, name);
  panel.roomMode = true;
  panel.readOnly = false;
  panel.render(rs, state.facets);
  updatePoolCount();
  host.setSummary(summaryLines(rs));
  view.addChat('', `Room ${host.code} is open. Share the code or the invite link.`, true);
  enterRoomUI();
}

async function joinRoom(code, name) {
  setLobbyStatus('Connecting…');
  const client = new RoomClient();
  state.playerPersonal = { sound: state.settings.sound, voiceOn: true, voiceURI: state.settings.voiceURI };
  client.on('msg', msg => onHostMessage(msg));
  client.on('closed', () => { if (state.client === client) endRoom('The host closed the room.'); });
  client.on('error', err => showBanner(err.message));
  state.pendingClient = client;
  try {
    await client.join(code, name, pid);
  } catch (err) {
    state.pendingClient = null;
    client.leave();
    setLobbyStatus(err.message, true);
    return;
  }
}

function onHostMessage(msg) {
  if (!msg) return;
  switch (msg.t) {
    case 'welcome': {
      stopSolo();
      Object.assign(state, { mode: 'room', role: 'player', client: state.pendingClient, roomSummary: msg.summary, roomTeams: msg.teams });
      state.client.code = msg.code || state.client.code;
      state.pendingClient = null;
      view.configure({ me: pid, mode: 'room', isHost: false });
      view.loadSnapshot(msg.snapshot);
      panel.renderSummary(msg.summary, state.playerPersonal, onPlayerPersonal);
      view.addChat('', `You joined room ${state.client.code}.`, true);
      enterRoomUI();
      break;
    }
    case 'ev': view.handle(msg.ev, msg.data); break;
    case 'room':
      state.roomSummary = msg.summary;
      state.roomTeams = msg.teams;
      if (state.role === 'player') { panel.renderSummary(msg.summary, state.playerPersonal, onPlayerPersonal); renderRoomBar(); }
      break;
    case 'sys': view.addChat('', msg.text, true); break;
    case 'closed': endRoom('The host closed the room.'); break;
  }
}

function onPlayerPersonal(kind) {
  if (kind === 'mute') view.stopVoice();
  saveSettings({ ...state.settings, sound: state.playerPersonal.sound, voiceURI: state.playerPersonal.voiceURI });
}

function enterRoomUI() {
  $('#players-panel').hidden = false;
  $('#chat-panel').hidden = false;
  $('#room-bar').hidden = false;
  renderRoomBar();
  setLobbyStatus('');
  if (location.hash !== '#rooms') location.hash = '#rooms';
  else route();
}

function inviteLink(code) {
  const u = new URL(location.href);
  u.hash = 'rooms';
  u.searchParams.set('room', code);
  return u.toString();
}

function renderRoomBar() {
  const bar = $('#room-bar');
  const code = state.role === 'host' ? state.host?.code : state.client?.code;
  if (!code) return;
  const teamsOn = state.role === 'host' ? state.roomSettings.teams : state.roomTeams;
  const myTeam = state.role === 'host' ? (state.engine.players.get(pid)?.team || '') : (view.myTeam || '');
  const copyBtn = el('button', { class: 'btn small', type: 'button' }, 'Copy invite link');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(inviteLink(code)); copyBtn.textContent = 'Link copied'; }
    catch { prompt('Copy this link:', inviteLink(code)); }
  });
  const teamSel = teamsOn ? el('label', {}, 'Team ', el('select', {
    onchange: e => {
      const team = e.target.value;
      if (state.role === 'host') state.engine.updatePlayer(pid, { team });
      else state.client.send({ t: 'team', team });
    },
  }, ['', 'A', 'B'].map(t => el('option', { value: t, selected: t === myTeam }, t ? `Team ${t}` : 'Pick a team')))) : null;
  bar.replaceChildren(...[
    el('span', { class: 'muted' }, 'Room'), el('span', { class: 'room-code' }, code),
    copyBtn,
    el('span', { class: 'muted' }, state.role === 'host' ? "You're the host. Keep this tab open." : 'Connected'),
    teamSel,
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn small', type: 'button', onclick: () => leaveRoom() }, state.role === 'host' ? 'Close room' : 'Leave room'),
  ].filter(Boolean));
}

function leaveRoom() {
  if (state.role === 'host') state.host.close();
  if (state.role === 'player') state.client.leave();
  endRoom();
}

function endRoom(message) {
  if (state.mode !== 'room') return;
  state.engine?.stop();
  Object.assign(state, { mode: 'solo', role: null, engine: null, source: null, host: null, client: null });
  $('#room-bar').hidden = true;
  $('#players-panel').hidden = true;
  $('#chat-panel').hidden = true;
  $('#chat-log').replaceChildren();
  if (message) showBanner(message);
  if (location.hash === '#rooms') route(); else location.hash = '#rooms';
}

function setLobbyStatus(text, isError = false) {
  const s = $('#lobby-status');
  s.textContent = text;
  s.style.color = isError ? 'var(--bad)' : '';
}

// ── Question database page ──────────────────────────────────────────────
const db = { page: 0, per: 20 };

function initDb() {
  const subj = $('#db-subject');
  subj.replaceChildren(el('option', { value: '' }, 'All'), ...state.facets.subjects.map(([s, n]) => el('option', { value: s }, `${s} (${n})`)));
  const sets = $('#db-set');
  sets.replaceChildren(el('option', { value: '' }, 'All'), ...state.facets.sets.map(([s, n]) => el('option', { value: s }, `${s} (${n})`)));
  $('#db-stage').replaceChildren(el('option', { value: '' }, 'All'), ...(state.facets.stages || []).map(([k, label, n]) => el('option', { value: k }, `${label} (${n.toLocaleString()})`)));
  $('#db-count').textContent = `${state.questions.length.toLocaleString()} questions in the bank.`;
}

// Lower-cased search text per question, built once (the bank can hold tens of thousands).
const hayCache = new WeakMap();
function searchText(q) {
  let hay = hayCache.get(q);
  if (hay === undefined) {
    hay = `${q.question} ${(q.choices || []).join(' ')} ${q.answer} ${q.accept}`.toLowerCase();
    hayCache.set(q, hay);
  }
  return hay;
}

function renderDb() {
  const term = $('#db-q').value.trim().toLowerCase();
  const words = term.split(/\s+/).filter(Boolean);
  const subject = $('#db-subject').value, type = $('#db-type').value, set = $('#db-set').value;
  const savedOnly = $('#db-saved').checked;
  const stage = $('#db-stage').value;
  const hits = state.questions.filter(q => {
    if (stage && q.stage !== stage) return false;
    if (savedOnly && !Bookmarks.has(q.id)) return false;
    if (subject && q.subject !== subject) return false;
    if (type && q.type !== type) return false;
    if (set && q.set !== set) return false;
    if (!words.length) return true;
    const hay = searchText(q);
    return words.every(w => hay.includes(w));
  });
  const pages = Math.max(1, Math.ceil(hits.length / db.per));
  db.page = Math.min(db.page, pages - 1);
  const slice = hits.slice(db.page * db.per, (db.page + 1) * db.per);
  const hl = html => {
    if (!words.length) return html;
    // highlight outside of tags only
    return html.replace(/(>|^)([^<]*)/g, (m, a, text) => a + words.reduce((t, w) =>
      t.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>'), text));
  };
  $('#db-results').replaceChildren(...(slice.length ? slice.map(q => el('li', { class: 'db-item', dataset: { subject: q.subject } },
    el('div', { class: 'top' },
      el('span', { class: 'subj' }, q.subject),
      el('span', {}, `${q.type === 'bonus' ? 'Bonus' : 'Toss-up'}, ${q.format === 'mc' ? 'multiple choice' : 'short answer'}`),
      el('span', { class: 'src' }, [q.set, q.round ? `Round ${q.round}` : '', q.num ? `#${q.num}` : ''].filter(Boolean).join(', ')),
      starButton(q)),
    el('p', { html: hl(richText(q.question)) }),
    q.choices ? el('ul', { class: 'choices' }, q.choices.map((c, i) => c ? el('li', { html: `<b>${'WXYZ'[i]})</b> ${hl(richText(c))}` }) : null)) : null,
    el('details', {}, el('summary', {}, 'Show answer'),
      el('p', { class: 'ans', html: hl(q.choices && q.answerLetter ? `${q.answerLetter}) ${richText(q.answerText)}` : richText(q.answer)) }),
      q.accept ? el('p', { html: `Also accepted: ${hl(richText(q.accept))}` }) : null),
    el('div', { class: 'actions' },
      el('button', { class: 'btn small', type: 'button', onclick: () => playOne(q) }, 'Read this one')))) :
    [el('li', { class: 'stats-empty' }, 'No questions match. Try fewer words or clear a filter.')]));
  const pager = $('#db-pager');
  pager.replaceChildren(
    el('button', { class: 'btn small', type: 'button', disabled: db.page === 0, onclick: () => { db.page--; renderDb(); scrollTo(0, 0); } }, 'Previous'),
    el('span', {}, `${hits.length.toLocaleString()} found, page ${db.page + 1} of ${pages}`),
    el('button', { class: 'btn small', type: 'button', disabled: db.page >= pages - 1, onclick: () => { db.page++; renderDb(); scrollTo(0, 0); } }, 'Next'));
}

// ── Saved (bookmarked) questions ─────────────────────────────────────────
function drawSaved() {
  const root = $('#saved-root');
  const items = Bookmarks.list().map(b => ({ b, q: state.byId?.get(b.qid) || b.q })).filter(x => x.q);
  const practice = el('button', {
    class: 'btn primary', type: 'button', disabled: !items.some(x => state.byId?.has(x.b.qid)),
    onclick: () => {
      state.settings.filters.savedOnly = true;
      state.settings.filters.missedOnly = false;
      saveSettings(state.settings);
      if (state.mode === 'solo' && state.engine) { panel.render(state.settings, state.facets); reconfigureSource(); }
      location.hash = '#practice';
    },
  }, `Practice saved questions (${items.length})`);
  const clearAll = el('button', {
    class: 'btn', type: 'button', disabled: !items.length,
    onclick: () => confirmDialog('Remove all bookmarks?', 'This clears every saved question in this browser.', 'Remove all', () => Bookmarks.clear()),
  }, 'Remove all');
  const head = el('div', { class: 'saved-head' },
    el('h1', {}, 'Saved'),
    el('p', { class: 'lede', style: 'margin:0' }, items.length
      ? `${items.length} bookmarked question${items.length === 1 ? '' : 's'}, saved in this browser.`
      : 'Questions you bookmark show up here.'),
    el('div', { class: 'actions' }, practice, clearAll));
  if (!items.length) {
    root.replaceChildren(head, el('div', { class: 'stats-empty' },
      el('p', {}, 'Press the star next to a question, or the B key while practicing, to save it for later.'),
      el('a', { class: 'btn primary', href: '#practice' }, 'Start practicing')));
    return;
  }
  root.replaceChildren(head, el('ol', { class: 'db-results' }, items.map(({ b, q }) => el('li', { class: 'db-item', dataset: { subject: q.subject } },
    el('div', { class: 'top' },
      el('span', { class: 'subj' }, q.subject),
      el('span', {}, `${q.type === 'bonus' ? 'Bonus' : 'Toss-up'}, ${q.format === 'mc' ? 'multiple choice' : 'short answer'}`),
      el('span', { class: 'src' }, [q.set, q.round ? `Round ${q.round}` : '', q.num ? `#${q.num}` : '', `saved ${new Date(b.ts).toLocaleDateString()}`].filter(Boolean).join(', ')),
      starButton(q)),
    q.question ? el('p', { html: richText(q.question) }) : el('p', { class: 'meta' }, 'Question text will appear once it has been read in full.'),
    q.choices ? el('ul', { class: 'choices' }, q.choices.map((c, i) => c ? el('li', { html: `<b>${'WXYZ'[i]})</b> ${richText(c)}` }) : null)) : null,
    q.answer ? el('details', {}, el('summary', {}, 'Show answer'),
      el('p', { class: 'ans', html: q.choices && q.answerLetter ? `${q.answerLetter}) ${richText(q.answerText)}` : richText(q.answer) }),
      q.accept ? el('p', { html: `Also accepted: ${richText(q.accept)}` }) : null) : null,
    state.byId?.has(q.id) ? el('div', { class: 'actions' },
      el('button', { class: 'btn small', type: 'button', onclick: () => playOne(state.byId.get(q.id)) }, 'Read this one')) : null))));
}

Bookmarks.on('change', () => {
  if (!$('#view-saved').hidden) drawSaved();
  if (!$('#view-questions').hidden && $('#db-saved').checked) renderDb();
  const tab = document.querySelector('.tabs a[data-route="saved"]');
  if (tab) tab.textContent = Bookmarks.size ? `Saved (${Bookmarks.size})` : 'Saved';
  if (state.mode === 'solo' && state.settings.filters.savedOnly) reconfigureSource();
});

function playOne(q) {
  if (state.mode === 'room' && state.role === 'player') { showBanner('Leave the room to read questions on your own.'); return; }
  if (state.mode === 'solo') ensureSolo();
  state.source.enqueue(q);
  location.hash = state.mode === 'room' ? '#rooms' : '#practice';
  const e = state.engine;
  if (e.phase === 'reading' || e.phase === 'answering') e.skip();
  else { e.pendingBonus = null; e.next(); }
}

// ── Routing ─────────────────────────────────────────────────────────────
function show(id) {
  for (const v of $$('.view')) v.hidden = v.id !== id;
}

function route() {
  const r = (location.hash.slice(1) || 'practice').split('?')[0];
  // Leaving solo practice mid-question pauses the reading.
  if (r !== 'practice' && state.mode === 'solo' && state.engine?.phase === 'reading') state.engine.pause();
  for (const a of $$('.tabs a')) if (a.dataset.route === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  if (r === 'practice') {
    show('view-play');
    if (state.loaded && state.mode === 'solo') ensureSolo();
  } else if (r === 'rooms') {
    if (state.mode === 'room') show('view-play');
    else {
      show('view-rooms');
      $('#lobby-name').value ||= store.get('lockout.name', '');
      const code = new URLSearchParams(location.search).get('room');
      if (code && !$('#lobby-code').value) $('#lobby-code').value = code;
    }
  } else if (r === 'questions') { show('view-questions'); if (state.loaded) renderDb(); }
  else if (r === 'stats') { show('view-stats'); drawStats(); }
  else if (r === 'saved') { show('view-saved'); drawSaved(); }
  else if (r === 'help') show('view-help');
  else { location.hash = '#practice'; return; }
  document.title = `${CONFIG.siteName} — Science Bowl practice`;
}

function drawStats() {
  renderStats($('#stats-root'), {
    missedCount: (ids => { let n = 0; for (const q of state.questions) if (ids.has(q.id)) n++; return n; })(Stats.missedIds()),
    onPracticeMissed() {
      state.settings.filters.missedOnly = true;
      state.settings.filters.savedOnly = false;
      state.settings.filters.unseenOnly = false;
      saveSettings(state.settings);
      if (state.mode === 'solo' && state.engine) { panel.render(state.settings, state.facets); reconfigureSource(); }
      location.hash = '#practice';
    },
    onReset() {
      confirmDialog('Reset all stats?', 'This deletes every saved result in this browser. It can’t be undone.', 'Reset stats', () => { Stats.clear(); drawStats(); });
    },
  });
}

function confirmDialog(title, body, okLabel, onOk) {
  const d = $('#dialog');
  d.replaceChildren(el('h2', {}, title), el('p', {}, body), el('div', { class: 'actions' },
    el('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Cancel'),
    el('button', { class: 'btn primary', type: 'button', onclick: () => { d.close(); onOk(); } }, okLabel)));
  d.showModal();
}

function showBanner(text) {
  const b = $('#banner');
  b.replaceChildren(el('span', {}, text), ' ', el('button', { class: 'link-btn', type: 'button', onclick: () => { b.hidden = true; } }, 'Dismiss'));
  b.hidden = false;
}

// ── Keyboard ────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ($('#view-play').hidden || $('#dialog').open) return;
  const t = e.target;
  if (t.id === 'answer') { if (e.key === 'Escape') t.blur(); return; }
  if (t.matches('input, textarea, select, [contenteditable]')) { if (e.key === 'Escape') t.blur(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); view.pressBuzz(); }
  else if (k === 'n') { e.preventDefault(); actions.next(); }
  else if (k === 's' && state.role !== 'player') { e.preventDefault(); actions.skip(); }
  else if (k === 'p' && state.role !== 'player') { e.preventDefault(); actions.togglePause(); }
  else if (k === 'b') { e.preventDefault(); view.toggleBookmark(); }
  else if (k === 'r' && state.mode === 'solo' && view.phase === 'revealed') {
    const j = [...(view.judgments || [])].reverse().find(x => x && x.pid === 'me' && !x.correct);
    if (j) actions.override(j.index, true);
  } else if (e.key === '/' && state.mode === 'room') { e.preventDefault(); $('#chat-input').focus(); }
});

// ── Wiring ──────────────────────────────────────────────────────────────
function initTheme() {
  const saved = store.get('lockout.theme', null);
  if (saved) document.documentElement.dataset.theme = saved;
  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('lockout.theme', next);
  });
}

function wireLobby() {
  const nameOk = () => {
    const name = $('#lobby-name').value.trim();
    if (!name) { setLobbyStatus('Enter your name first.', true); $('#lobby-name').focus(); return null; }
    store.set('lockout.name', name);
    return name;
  };
  $('#lobby-create').addEventListener('click', () => {
    const name = nameOk();
    if (!name) return;
    if (!state.loaded) { setLobbyStatus('Questions are still loading. Try again in a moment.', true); return; }
    createRoom(name);
  });
  $('#lobby-join').addEventListener('click', () => {
    const name = nameOk();
    if (!name) return;
    const code = $('#lobby-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { setLobbyStatus('Enter the room code from the host.', true); $('#lobby-code').focus(); return; }
    joinRoom(code, name);
  });
  $('#lobby-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#lobby-join').click(); });
  $('#chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    input.value = '';
    input.blur(); // back to the game, so space buzzes again
    if (!text) return;
    if (state.role === 'player') state.client.send({ t: 'chat', text });
    else if (state.role === 'host') state.engine.chat(pid, text);
  });
}

function wireDb() {
  let timer;
  $('#db-filters').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { db.page = 0; renderDb(); }, 150); });
  $('#db-filters').addEventListener('submit', e => e.preventDefault());
}

async function load(force = false) {
  if (!state.loaded) $('#q-text').innerHTML = '<p class="empty-state">Loading questions…</p>';
  try {
    const res = await loadQuestions(CONFIG, { force });
    state.questions = res.questions;
    state.byId = new Map(res.questions.map(q => [q.id, q]));
    state.facets = computeFacets(res.questions);
    state.loaded = true;
    if (res.warning) showBanner(res.warning);
    $('#help-source').textContent = `${res.questions.length.toLocaleString()} questions loaded: ${res.source}. They come from publicly released tournament packets; each question shows its tournament and round.`;
    initDb();
    if (state.mode === 'solo') { stopSolo(); }
    route();
    if (state.mode === 'room' && state.role === 'host') { state.source.all = state.questions; reconfigureSource(); }
  } catch (err) {
    console.error(err);
    $('#q-text').innerHTML = `<p class="empty-state">Couldn't load questions: ${escapeHtml(err.message)}. Reload the page to try again.</p>`;
  }
}

function boot() {
  $('#site-name').textContent = CONFIG.siteName;
  initTheme();
  wireLobby();
  wireDb();
  $('#reload-questions').addEventListener('click', async e => {
    e.target.disabled = true;
    await load(true);
    e.target.disabled = false;
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', e => {
    if (state.role === 'host' && state.engine?.players.size > 1) { e.preventDefault(); e.returnValue = ''; }
  });
  route();
  load().then(() => Bookmarks.emit('change', Bookmarks.size));
}

boot();

// Exposed for debugging in the browser console.
window.lockout = { state, Stats, DEFAULTS, matchesFilters };
