// pts dev tools (dev.html): troubleshooting views and controls. Not linked from the site.
// Everything here runs on this device and uses the site's own modules, so what it shows is
// what the site does.
import { CONFIG } from './config.js';
import { $, el, store } from './util.js';
import { loadQuestions } from './questions.js';
import { tokenize, spokenTokens, spokenForm, speakableText, sayRespelling, setPronunciations, richText, plainText } from './text.js';
import { checkAnswer, parseAnswerSpec, normalize, setVocabulary, buildVocabulary } from './checker.js';
import { evaluate, evaluateLoose, sameExpression, toPlainMath } from './mathval.js';
import {
  ttsSupported, englishVoices, speakQuestion, stopSpeaking, voicePace, recordPace, describeVoice,
  matchVoice, matchedRate, speechRate, estimateMs, DEFAULT_RATE,
} from './speech.js';
import { choiceStarts } from './engine.js';
import { Stats } from './stats.js';
import { googleUrl } from './game-view.js';

// ── Shared state ─────────────────────────────────────────────────────────
const COMPS = CONFIG.competitions || { sb: { name: 'Science Bowl', bankFiles: CONFIG.bankFiles, useSheet: true } };
const S = { banks: {}, byId: new Map(), all: [], lexicon: 0, loadMs: {}, current: null };
const fmt = n => Number(n).toLocaleString();
const kb = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const kv = pairs => el('dl', { class: 'kv' }, pairs.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v ?? '—')]));
const pre = (v, cls = '') => el('pre', { class: `out ${cls}` }, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const btn = (label, onclick, extra = {}) => el('button', { class: 'btn small', type: 'button', onclick, ...extra }, label);
const card = (title, ...body) => el('section', { class: 'dev-card' }, el('h2', {}, title), ...body);
const input = (attrs = {}) => el('input', { type: 'text', ...attrs });

// Theme: the site's saved choice, with a toggle.
const theme = store.get('lockout.theme', null);
if (theme) document.documentElement.dataset.theme = theme;
$('#theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('lockout.theme', next);
});

// ── Tabs ─────────────────────────────────────────────────────────────────
const TABS = [];
function tab(id, label, render) { TABS.push({ id, label, render, pane: null }); }
function showTab(id) {
  const t = TABS.find(x => x.id === id) || TABS[0];
  for (const x of TABS) {
    x.button.setAttribute('aria-selected', String(x === t));
    if (x.pane) x.pane.hidden = x !== t;
  }
  if (!t.pane) { t.pane = el('div', { role: 'tabpanel' }); $('#panes').append(t.pane); t.render(t.pane); }
  t.pane.hidden = false;
  try { sessionStorage.setItem('pts.dev.tab', t.id); } catch { /* ignore */ }
  history.replaceState(null, '', `#${t.id}`);
}

// ── Loading ──────────────────────────────────────────────────────────────
async function loadBanks(force = false) {
  S.all = []; S.byId = new Map();
  for (const [key, c] of Object.entries(COMPS)) {
    const t0 = performance.now();
    try {
      S.banks[key] = await loadQuestions({
        ...CONFIG, bankFiles: c.bankFiles || CONFIG.bankFiles,
        sheetCsvUrl: c.useSheet ? CONFIG.sheetCsvUrl : '', sheetId: c.useSheet ? CONFIG.sheetId : '',
      }, { force });
    } catch (e) { S.banks[key] = { questions: [], source: `failed: ${e.message}` }; }
    S.loadMs[key] = Math.round(performance.now() - t0);
    for (const q of S.banks[key].questions) { q._comp = key; S.all.push(q); S.byId.set(q.id, q); }
  }
  setVocabulary(() => S.all.flatMap(q => [q.answer, q.accept, ...(q.choices || [])]));
  setTimeout(() => buildVocabulary(), 200);
}
async function loadLexicon() {
  try { S.lexicon = setPronunciations(await (await fetch('data/pronunciations.csv', { cache: 'no-cache' })).text()); } catch { S.lexicon = 0; }
}

// The official answer forms the site must accept (the same list the import checks use).
function officialForms(q) {
  if (q.choices && q.answerLetter) return [q.answerLetter, q.answerText].filter(Boolean);
  const split = s => s.split(/\s*;\s*/).map(x => x.trim()).filter(Boolean);
  const alts = [];
  let main = q.answer;
  main = main.replace(/[([]\s*(?:also accept|accept)\s*:?\s*([^()[\]]*)[)\]]/gi, (_, a) => { alts.push(...split(a.replace(/\s*,\s*(?=[A-Za-z])/g, ';'))); return ' '; });
  main = main.replace(/[([]\s*(?:do not accept|don't accept|reject|prompt on)[^()[\]]*[)\]]/gi, ' ');
  main = main.replace(/\[[^\]]*\]/g, ' ').replace(/\((?:read|pronounced)[^)]*\)/gi, ' ');
  const out = [];
  for (const part of main.split(/\s+\bOR\b\s+/)) {
    const p = part.trim().replace(/\s+/g, ' ');
    if (!p) continue;
    out.push(p);
    const bare = p.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (bare && bare !== p && /[A-Za-z0-9]/.test(bare)) out.push(bare);
  }
  out.push(...[...alts, ...split(q.accept || '')].flatMap(a => a.split(/\s+or\s+/i)));
  return [...new Set(out)].filter(Boolean);
}

// Spoken text, with the words the voice says differently from the page marked.
function spokenView(q) {
  const toks = tokenize(q);
  const sp = spokenTokens(toks);
  const frag = el('div', { class: 'spoken' });
  toks.forEach((t, i) => {
    const plain = speakableText(spokenForm(t));
    const said = sp[i];
    if (!said) { if (plain.trim()) frag.append(el('s', { class: 'muted', title: 'not spoken' }, plain), ' '); return; }
    frag.append(said !== plain ? el('span', { class: 'chg', title: `page: ${t.t}` }, said) : said, ' ');
  });
  return { frag, words: sp, toks };
}

// ── Voice controls (shared by the question and speech tabs) ──────────────
const voiceSel = el('select', { 'aria-label': 'Voice' });
const rateIn = el('input', { type: 'number', min: '0.5', max: '2', step: '0.05', value: String(store.get('pts.settings.v2', {})?.voiceRate || DEFAULT_RATE), style: 'width:5.5em' });
function fillVoices() {
  const keep = voiceSel.value || store.get('pts.settings.v2', {})?.voiceURI || '';
  voiceSel.replaceChildren(...englishVoices().map(v => {
    const p = voicePace(v);
    return el('option', { value: v.voiceURI }, `${v.name} (${v.lang}${v.localService ? ', on device' : ', online'}${v.default ? ', default' : ''})${p ? ` · ${(p.wps * 60).toFixed(0)} wpm` : ''}`);
  }));
  if (keep) voiceSel.value = keep;
}
if (ttsSupported) { fillVoices(); window.speechSynthesis.addEventListener?.('voiceschanged', fillVoices); }
// (one set of voice controls, at the top of the page, used by every tab)
$('#voicebar').replaceChildren(el('label', {}, 'Voice'), voiceSel, el('label', {}, 'Rate'), rateIn, btn('Stop speaking', () => stopSpeaking()));
if (!ttsSupported) $('#voicebar').replaceChildren(el('span', { class: 'bad' }, 'This browser has no speech synthesis.'));
function speak(words, { breaks = [], log } = {}) {
  const t0 = performance.now();
  let last = -1;
  log?.(`speak ${words.filter(Boolean).length} tokens at ${speechRate(rateIn.value)}x with ${voiceSel.selectedOptions[0]?.textContent || 'default voice'}`);
  speakQuestion(words, {
    voiceURI: voiceSel.value, rate: Number(rateIn.value), breaks,
    onProgress: k => { if (k !== last) { last = k; log?.(`  word ${k}: ${words[k]}  (${Math.round(performance.now() - t0)} ms)`); } },
    onEnd: () => { log?.(`end after ${Math.round(performance.now() - t0)} ms (estimate ${Math.round(estimateMs(words, rateIn.value))} ms)`); fillVoices(); },
  });
}

// ── Overview ─────────────────────────────────────────────────────────────
tab('overview', 'Overview', pane => {
  const box = el('div');
  pane.append(box);
  const draw = async () => {
    const storage = [];
    try {
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); storage.push([k, (localStorage.getItem(k) || '').length]); }
    } catch { /* blocked */ }
    const total = storage.reduce((a, [, n]) => a + n, 0);
    const voices = ttsSupported ? englishVoices() : [];
    let latest = '—';
    try {
      const days = await (await fetch('data/changelog.json', { cache: 'no-cache' })).json();
      latest = days[0] ? `${days[0].date}: ${days[0].items[0]}` : '—';
    } catch { /* ignore */ }
    box.replaceChildren(
      el('div', { class: 'dev-grid' },
        card('This device', kv([
          ['Browser', navigator.userAgent],
          ['Online', String(navigator.onLine)],
          ['Screen', `${screen.width}×${screen.height} at ${devicePixelRatio}x; window ${innerWidth}×${innerHeight}`],
          ['Theme', document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark (system)' : 'light (system)')],
          ['Speech', ttsSupported ? `${voices.length} English voices (${voices.filter(v => v.localService).length} on device)` : 'not supported'],
          ['Local storage', `${storage.length} keys, ${kb(total * 2)}`],
          ['Clipboard', String(!!navigator.clipboard)],
        ])),
        card('Site', kv([
          ['Banks', Object.entries(S.banks).map(([k, b]) => `${COMPS[k].short || k}: ${fmt(b.questions.length)} (${S.loadMs[k]} ms) — ${b.source}${b.warning ? ` — warning: ${b.warning}` : ''}`).join('\n')],
          ['Pronunciation list', `${S.lexicon} words`],
          ['Repo', CONFIG.repo || '—'],
          ['Latest changelog', latest],
          ['Settings (SB)', JSON.stringify(store.get('pts.settings.v2', {}))],
        ]),
        el('div', { class: 'row' },
          btn('Reload banks (skip cache)', async e => { e.target.disabled = true; await loadBanks(true); e.target.disabled = false; draw(); }),
          btn('Reload pronunciation list', async () => { await loadLexicon(); draw(); }),
          btn('Clear session caches', () => { try { sessionStorage.clear(); } catch { /* ignore */ } draw(); }))),
      ),
      card('Errors on this page', el('p', { class: 'muted' }, 'Script errors and failed promises on this page show here.'), errorLog));
  };
  draw();
});
const errorLog = pre('(none yet)', 'log');
const logError = msg => { errorLog.textContent = (errorLog.textContent === '(none yet)' ? '' : errorLog.textContent + '\n') + `${new Date().toLocaleTimeString()}  ${msg}`; };
addEventListener('error', e => logError(e.message));
addEventListener('unhandledrejection', e => logError(String(e.reason?.stack || e.reason)));

// ── Question inspector ───────────────────────────────────────────────────
tab('question', 'Question', pane => {
  const idIn = input({ placeholder: 'Question ID, e.g. 1qy21vz', class: 'grow' });
  const setSel = el('select', { 'aria-label': 'Set for random' }, el('option', { value: '' }, 'Any set'),
    ...[...new Set(S.all.map(q => q.set))].sort().map(s => el('option', { value: s }, s)));
  const typed = input({ placeholder: 'Try an answer', class: 'grow' });
  const out = el('div');
  const log = pre('', 'log'); log.hidden = true;
  const addLog = m => { log.hidden = false; log.textContent += m + '\n'; log.scrollTop = log.scrollHeight; };
  const show = q => {
    S.current = q;
    if (!q) { out.replaceChildren(el('p', { class: 'bad' }, 'No question with that ID.')); return; }
    idIn.value = q.id;
    try { sessionStorage.setItem('pts.dev.q', q.id); } catch { /* ignore */ }
    const { frag, words, toks } = spokenView(q);
    const forms = officialForms(q);
    out.replaceChildren(
      el('div', { class: 'qbox' },
        el('div', { class: 'meta' }, [COMPS[q._comp]?.short, q.set, q.round, q.num && `#${q.num}`, q.type, q.subject, q.format === 'mc' ? 'multiple choice' : 'short answer', q.level].filter(Boolean).join(' · ')),
        el('div', { html: richText(q.question) }),
        q.choices ? el('ol', { type: 'A' }, q.choices.map((c, i) => el('li', { html: `<b>${'WXYZ'[i]})</b> ${richText(c)}` }))) : null,
        el('p', {}, el('b', {}, 'Answer: '), el('span', { html: richText(q.answer) })),
        q.accept ? el('p', {}, el('b', {}, 'Accept: '), q.accept) : null,
        q.reject ? el('p', {}, el('b', {}, 'Reject: '), q.reject) : null,
        q.notes ? el('p', { class: 'muted' }, 'Notes: ', q.notes) : null),
      el('div', { class: 'row' },
        btn('Speak', () => { log.textContent = ''; speak(words, { breaks: choiceStarts(toks), log: addLog }); }),
        btn('Stop', () => stopSpeaking()),
        el('a', { class: 'btn small', href: googleUrl(q), target: '_blank', rel: 'noopener' }, 'Search Google'),
        btn('Copy ID', () => navigator.clipboard?.writeText(q.id)),
        btn('Open in the checker', () => { checkerFill(q, typed.value); showTab('checker'); })),
      log,
      el('h3', {}, 'What the voice is given (marked: said differently from the page; struck: not said)'), frag,
      el('h3', {}, 'Official answers through the checker'),
      el('table', { class: 'dt' }, el('tbody', {}, forms.map(f => {
        const r = checkAnswer(q, f);
        return el('tr', {}, el('td', {}, f), el('td', { class: r.correct ? 'ok' : 'bad' }, r.correct ? 'accepted' : 'REJECTED'), el('td', { class: 'muted' }, `${r.reason} · ${r.score?.toFixed?.(2) ?? r.score}`));
      }))),
      el('h3', {}, 'Raw question object'), pre(Object.fromEntries(Object.entries(q).filter(([k]) => !k.startsWith('_')))));
    tryIt();
  };
  const tryRes = el('span', { class: 'muted' });
  const tryIt = () => {
    if (!S.current || !typed.value.trim()) { tryRes.textContent = ''; return; }
    const r = checkAnswer(S.current, typed.value);
    tryRes.className = r.correct ? 'ok' : 'bad';
    tryRes.textContent = `${r.correct ? 'accepted' : 'rejected'} (${r.reason}, ${r.score?.toFixed?.(2) ?? r.score})`;
  };
  typed.addEventListener('input', tryIt);
  const go = () => show(S.byId.get(idIn.value.trim()));
  idIn.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  const random = () => { const pool = setSel.value ? S.all.filter(q => q.set === setSel.value) : S.all; show(pool[Math.floor(Math.random() * pool.length)]); };
  pane.append(card('Question inspector',
    el('div', { class: 'row' }, idIn, btn('Show', go), setSel, btn('Random', random)),
    el('div', { class: 'row' }, typed, tryRes),
    out));
  let start = null;
  try { start = sessionStorage.getItem('pts.dev.q'); } catch { /* ignore */ }
  if (start && S.byId.has(start)) show(S.byId.get(start));
});

// ── Answer checker lab ───────────────────────────────────────────────────
const ck = {};
function checkerFill(q, typedValue = '') {
  if (!ck.question) return;
  ck.question.value = q.question; ck.answer.value = q.answer; ck.accept.value = q.accept || ''; ck.reject.value = q.reject || '';
  ck.choices.value = q.choices ? q.choices.join('\n') : '';
  if (typedValue) ck.typed.value = typedValue;
  ck.run();
}
tab('checker', 'Checker', pane => {
  ck.question = el('textarea', { placeholder: 'Question text (used for implied nouns, statement lists, ordering)' });
  ck.answer = input({ placeholder: 'Answer, e.g. ω/4 or W) MITOSIS', class: 'grow' });
  ck.accept = input({ placeholder: 'Accept (separate with ;)', class: 'grow' });
  ck.reject = input({ placeholder: 'Reject', class: 'grow' });
  ck.choices = el('textarea', { placeholder: 'Multiple choice: W, X, Y, Z options, one per line (leave empty for short answer)', style: 'min-height:60px' });
  ck.typed = el('textarea', { placeholder: 'Typed answers to try, one per line', style: 'min-height:90px' });
  const out = el('div');
  ck.run = () => {
    const choices = ck.choices.value.split('\n').map(s => s.trim());
    const isMC = choices.some(Boolean);
    const q = { question: ck.question.value, answer: ck.answer.value, accept: ck.accept.value, reject: ck.reject.value, type: 'tossup', choices: isMC ? [0, 1, 2, 3].map(i => choices[i] || '') : null };
    if (isMC) {
      const m = q.answer.trim().match(/^\(?([WXYZ])\)?(?:[).:\s-]+(.*))?$/i);
      if (m) { q.answerLetter = m[1].toUpperCase(); q.answerText = (m[2] || q.choices['WXYZ'.indexOf(q.answerLetter)] || '').trim(); }
    }
    const spec = parseAnswerSpec(q.answer, q.accept, q.reject);
    const tries = ck.typed.value.split('\n').map(s => s.trim()).filter(Boolean);
    out.replaceChildren(
      el('h3', {}, 'How the key is read'),
      kv([['Alternates', spec.alts.join('  |  ')], ['Rejects', spec.rejects.join('  |  ') || '—'], ['Main', spec.main],
        ['Key as a number', String(evaluateLoose(q.answer) ?? '—')], ['Key as plain math', toPlainMath(q.answer)],
        ...(isMC ? [['MC letter / text', `${q.answerLetter || '?'} / ${q.answerText || '?'}`]] : [])]),
      el('h3', {}, 'Typed answers'),
      tries.length ? el('div', { class: 'table-scroll' }, el('table', { class: 'dt' },
        el('thead', {}, el('tr', {}, ...['Typed', 'Result', 'Reason', 'Score', 'Normalized', 'Value', 'Same expression as'].map(h => el('th', {}, h)))),
        el('tbody', {}, tries.map(t => {
          const r = checkAnswer(q, t);
          const same = [q.answer, ...String(q.accept || '').split(/\s*[;|]\s*/).filter(Boolean)].map(k => [k, sameExpression(t, k)]).filter(([, v]) => v != null);
          return el('tr', {},
            el('td', {}, t), el('td', { class: r.correct ? 'ok' : 'bad' }, r.correct ? 'accepted' : 'rejected'),
            el('td', {}, r.reason), el('td', { class: 'num' }, r.score?.toFixed?.(2) ?? String(r.score)),
            el('td', { class: 'muted' }, normalize(t)), el('td', { class: 'num' }, String(evaluate(t) ?? evaluateLoose(t) ?? '—')),
            el('td', { class: 'muted' }, same.map(([k, v]) => `${k}: ${v}`).join('; ') || '—'));
        })))) : el('p', { class: 'muted' }, 'Type answers above, one per line.'));
  };
  for (const f of ['question', 'answer', 'accept', 'reject', 'choices', 'typed']) ck[f].addEventListener('input', ck.run);
  pane.append(card('Answer checker',
    ck.question, el('div', { class: 'row' }, ck.answer), el('div', { class: 'row' }, ck.accept, ck.reject), ck.choices,
    el('div', { class: 'row' }, el('label', {}, 'Try'),
      btn('Load the inspected question', () => S.current && checkerFill(S.current))), ck.typed, out));
  if (S.current) checkerFill(S.current); else ck.run();
});

// ── Speech lab ───────────────────────────────────────────────────────────
tab('speech', 'Speech', pane => {
  const text = el('textarea', { placeholder: 'Text to read, as it would appear in a question (pronunciation guides, $math$ and all)' }, 'Which tissue, Parenchyma [pair-EN-kih-ma], stores starch in Cnidaria, Saccharomyces and siliceous ooze (sih-LISH-ish ooze)?');
  const preview = el('div');
  const log = pre('', 'log');
  const addLog = m => { log.textContent += m + '\n'; log.scrollTop = log.scrollHeight; };
  const draw = () => preview.replaceChildren(el('h3', {}, 'What the voice is given'), spokenView({ question: text.value }).frag);
  text.addEventListener('input', draw);
  const resp = input({ placeholder: 'A respelling, e.g. sih-LISH-us', class: 'grow' });
  const respOut = el('code');
  resp.addEventListener('input', () => { respOut.textContent = resp.value ? sayRespelling(resp.value) : ''; });
  const paceBox = el('div');
  const drawPace = () => {
    let all = {};
    try { all = JSON.parse(localStorage.getItem('pts.voicePace.v1') || '{}'); } catch { /* ignore */ }
    const names = new Map(englishVoices().map(v => [v.voiceURI, v.name]));
    const rows = Object.entries(all);
    paceBox.replaceChildren(rows.length ? el('table', { class: 'dt' },
      el('thead', {}, el('tr', {}, ...['Voice', 'Pace at 1×', 'Sentences timed', ''].map(h => el('th', {}, h)))),
      el('tbody', {}, rows.map(([k, p]) => el('tr', {}, el('td', {}, names.get(k) || k), el('td', { class: 'num' }, `${(p.wps * 60).toFixed(0)} wpm (${p.wps.toFixed(2)} words/s)`),
        el('td', { class: 'num' }, p.n), el('td', {}, btn('Forget', () => { delete all[k]; localStorage.setItem('pts.voicePace.v1', JSON.stringify(all)); drawPace(); fillVoices(); })))))) : el('p', { class: 'muted' }, 'No voice has been timed on this device yet.'));
  };
  const CAL = ['The quick brown fox jumps over the lazy dog near the river bank.', 'Science Bowl questions are read at a steady pace by the moderator.',
    'A toss-up is worth four points and a bonus is worth ten points.', 'Photosynthesis turns light energy into chemical energy in the chloroplast.'];
  const hostInfo = input({ placeholder: '{"name":"Microsoft Aria Online (Natural)","lang":"en-US","local":false,"wps":3.0}', class: 'grow' });
  const hostRate = el('input', { type: 'number', min: '0.5', max: '2', step: '0.05', value: '1.2', style: 'width:5.5em' });
  const matchOut = el('span', { class: 'muted' });
  const doMatch = () => {
    let info = null;
    try { info = JSON.parse(hostInfo.value); } catch { matchOut.textContent = 'Paste the host voice as JSON.'; return; }
    const m = matchVoice(info), r = matchedRate(info, hostRate.value);
    matchOut.textContent = `This device reads with ${m.voice?.name || 'its default voice'}${m.exact ? ' (same voice: no change)' : ''}; rate ${r ?? speechRate(hostRate.value)}${r == null && !m.exact ? ' (not matched: pace unknown on one side)' : ''}.`;
  };
  pane.append(
    card('Read aloud',
      text,
      el('div', { class: 'row' },
        btn('Speak', () => { log.textContent = ''; const toks = tokenize({ question: text.value }); speak(spokenTokens(toks), { breaks: choiceStarts(toks), log: addLog }); }),
        btn('Speak the inspected question', () => { if (!S.current) return; log.textContent = ''; const toks = tokenize(S.current); speak(spokenTokens(toks), { breaks: choiceStarts(toks), log: addLog }); })),
      preview, el('h3', {}, 'Events'), log),
    el('div', { class: 'dev-grid' },
      card('Respelling tester', el('p', { class: 'muted' }, 'How a pronunciation guide or list entry is passed to the voice.'),
        el('div', { class: 'row' }, resp, btn('Speak it', () => speak([sayRespelling(resp.value)], { log: addLog }))), el('p', {}, respOut)),
      card('Voice pace', el('p', { class: 'muted' }, 'How fast each voice talks on this device (used to keep room players at the host’s pace).'),
        paceBox, el('div', { class: 'row' },
          btn('Time the selected voice (4 sentences)', () => { log.textContent = ''; speak(CAL, { log: addLog }); setTimeout(drawPace, 500); }),
          btn('Refresh', () => { drawPace(); fillVoices(); }),
          btn('This voice as host JSON', () => { hostInfo.value = JSON.stringify(describeVoice(voiceSel.value)); })))),
    card('Room voice matching', el('p', { class: 'muted' }, 'What this device would do as a player with this host voice (copy "This voice as host JSON" on the host’s device).'),
      el('div', { class: 'row' }, hostInfo, el('label', {}, 'Host rate'), hostRate, btn('Check', doMatch)), matchOut));
  draw(); drawPace();
});

// ── Storage ──────────────────────────────────────────────────────────────
tab('storage', 'Storage', pane => {
  const list = el('div');
  const editor = el('textarea', { style: 'min-height:220px' });
  const keyIn = input({ placeholder: 'key', class: 'grow' });
  const msg = el('span', { class: 'muted' });
  const draw = () => {
    const rows = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); rows.push([k, localStorage.getItem(k) || '']); } } catch { /* blocked */ }
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    list.replaceChildren(el('div', { class: 'table-scroll' }, el('table', { class: 'dt' },
      el('thead', {}, el('tr', {}, ...['Key', 'Size', 'Starts with', ''].map(h => el('th', {}, h)))),
      el('tbody', {}, rows.map(([k, v]) => el('tr', {}, el('td', {}, k), el('td', { class: 'num' }, kb(v.length * 2)), el('td', { class: 'muted' }, v.slice(0, 60)),
        el('td', {}, btn('Edit', () => { keyIn.value = k; try { editor.value = JSON.stringify(JSON.parse(v), null, 2); } catch { editor.value = v; } msg.textContent = ''; }),
          ' ', btn('Delete', () => { if (confirmDelete(k)) { localStorage.removeItem(k); draw(); } }))))))));
  };
  const confirmDelete = k => window.confirm(`Delete "${k}" from this browser?`);
  const save = () => {
    const k = keyIn.value.trim(); if (!k) return;
    let v = editor.value;
    try { v = JSON.stringify(JSON.parse(v)); } catch { /* save as plain text */ }
    try { localStorage.setItem(k, v); msg.textContent = `Saved ${k}.`; msg.className = 'ok'; } catch (e) { msg.textContent = e.message; msg.className = 'bad'; }
    draw();
  };
  const exportAll = () => {
    const all = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); all[k] = localStorage.getItem(k); }
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(all, null, 1)], { type: 'application/json' })), download: `pts-storage-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
  };
  const importIn = el('input', { type: 'file', accept: 'application/json', hidden: true });
  importIn.addEventListener('change', async () => {
    const f = importIn.files[0]; if (!f) return;
    try {
      const all = JSON.parse(await f.text());
      for (const [k, v] of Object.entries(all)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
      msg.textContent = `Imported ${Object.keys(all).length} keys.`; msg.className = 'ok';
    } catch (e) { msg.textContent = `Import failed: ${e.message}`; msg.className = 'bad'; }
    draw();
  });
  pane.append(
    card('Local storage (this browser)',
      el('p', { class: 'muted' }, 'Settings, stats, saved questions and learned voice paces live here. Export before changing anything you want back.'),
      el('div', { class: 'row' }, btn('Refresh', draw), btn('Export all', exportAll), btn('Import…', () => importIn.click()), importIn), list),
    card('Edit a key', el('div', { class: 'row' }, keyIn, btn('Save', save), msg), editor),
    card('Stats',
      el('p', { class: 'muted' }, `${fmt(Stats.all().length)} results saved. Sample results are for trying the stats page; they mix with real ones, so export first.`),
      el('div', { class: 'row' },
        el('label', {}, 'Add'), el('input', { type: 'number', id: 'dev-n', value: '200', min: '1', max: '5000', style: 'width:6em' }),
        btn('sample results', () => { addSamples(Number($('#dev-n').value) || 200); draw(); }),
        btn('Clear all stats', () => { if (window.confirm('Delete every saved result in this browser?')) { Stats.clear(); draw(); } }))));
  draw();
});

// Plausible results from real bank questions (for the stats page).
function addSamples(n) {
  const pool = S.all.filter(q => (q._comp || 'sb') === 'sb');
  const list = Stats.all();
  const now = Date.now();
  for (let i = 0; i < n && pool.length; i++) {
    const q = pool[Math.floor(Math.random() * pool.length)];
    const tossup = q.type === 'tossup', u = Math.random();
    const result = tossup ? (u < 0.45 ? 'correct' : u < 0.57 ? 'neg' : u < 0.72 ? 'incorrect' : 'dead') : (u < 0.5 ? 'correct' : 'incorrect');
    const points = result === 'correct' ? (tossup ? 4 : 10) : result === 'neg' ? -4 : 0;
    list.push({
      qid: q.id, subject: q.subject, type: q.type, qtype: q.type, format: q.format, set: q.set, round: q.round, num: q.num,
      qtext: plainText(q.question).slice(0, 200), answer: q.answer, mode: 'solo', comp: 'sb', result, points,
      frac: result === 'correct' && tossup ? Math.min(1, Math.max(0.1, 0.55 + (Math.random() - 0.5) * 0.6)) : null,
      given: result === 'correct' ? q.answer.slice(0, 40) : 'sample', rid: `dev${now.toString(36)}${i}`, ts: now - (n - i) * 45000,
    });
  }
  Stats.save(list);
}

// ── Bank tools ───────────────────────────────────────────────────────────
tab('bank', 'Bank', pane => {
  const sets = new Map();
  for (const q of S.all) {
    const k = `${q._comp}|${q.set}`;
    if (!sets.has(k)) sets.set(k, { comp: q._comp, set: q.set, n: 0, rounds: new Set(), mc: 0, bonus: 0 });
    const s = sets.get(k); s.n++; s.rounds.add(q.round); if (q.choices) s.mc++; if (q.type === 'bonus') s.bonus++;
  }
  const find = input({ placeholder: 'Find questions containing… (question, answer or ID)', class: 'grow' });
  const found = el('div');
  find.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const t = find.value.trim().toLowerCase(); if (!t) return;
    const hits = S.all.filter(q => q.id === t || q.question.toLowerCase().includes(t) || q.answer.toLowerCase().includes(t)).slice(0, 50);
    found.replaceChildren(el('table', { class: 'dt' }, el('tbody', {}, hits.map(q => el('tr', {},
      el('td', {}, el('a', { href: '#question', onclick: () => { sessionStorage.setItem('pts.dev.q', q.id); queueMicrotask(() => showQuestion(q.id)); } }, q.id)),
      el('td', { class: 'muted' }, `${q.set} ${q.round} #${q.num}`), el('td', {}, plainText(q.question).slice(0, 110))))),
      hits.length === 50 ? el('caption', {}, 'first 50') : null));
  });
  const setSel = el('select', {}, ...[...sets.values()].sort((a, b) => a.set.localeCompare(b.set)).map(s => el('option', { value: `${s.comp}|${s.set}` }, `${s.set} (${COMPS[s.comp]?.short || s.comp})`)));
  const runOut = el('div');
  const run = async () => {
    const [comp, set] = setSel.value.split('|');
    const qs = S.all.filter(q => q._comp === comp && q.set === set);
    runOut.replaceChildren(el('p', { class: 'muted' }, `Checking ${qs.length} questions…`));
    await new Promise(r => setTimeout(r, 20));
    const fails = [];
    let tried = 0;
    for (const q of qs) for (const f of officialForms(q)) { tried++; const r = checkAnswer(q, f); if (!r.correct) fails.push({ q, f, r }); }
    runOut.replaceChildren(el('p', { class: fails.length ? 'bad' : 'ok' }, `${tried} official answers tried, ${fails.length} rejected.`),
      fails.length ? el('table', { class: 'dt' }, el('tbody', {}, fails.slice(0, 200).map(({ q, f, r }) => el('tr', {},
        el('td', {}, el('a', { href: '#question', onclick: () => { sessionStorage.setItem('pts.dev.q', q.id); queueMicrotask(() => showQuestion(q.id)); } }, q.id)),
        el('td', {}, f), el('td', { class: 'muted' }, `${r.reason} · key: ${q.answer}`))))) : null);
  };
  pane.append(
    card('Find', el('div', { class: 'row' }, find), found),
    card('Check a set’s official answers', el('p', { class: 'muted' }, 'Runs every official answer and listed alternate through the checker, as the import checks do.'),
      el('div', { class: 'row' }, setSel, btn('Run', run)), runOut),
    card('Sets', el('div', { class: 'table-scroll' }, el('table', { class: 'dt' },
      el('thead', {}, el('tr', {}, ...['Set', 'Bank', 'Questions', 'Rounds', 'Multiple choice', 'Bonuses'].map(h => el('th', {}, h)))),
      el('tbody', {}, [...sets.values()].sort((a, b) => a.set.localeCompare(b.set)).map(s => el('tr', {},
        el('td', {}, s.set || '(no set)'), el('td', {}, COMPS[s.comp]?.short || s.comp), el('td', { class: 'num' }, fmt(s.n)),
        el('td', { class: 'num' }, s.rounds.size), el('td', { class: 'num' }, fmt(s.mc)), el('td', { class: 'num' }, fmt(s.bonus)))))))));
});
function showQuestion(id) {
  const t = TABS.find(x => x.id === 'question');
  if (t.pane) { t.pane.remove(); t.pane = null; }
  showTab('question');
}

// ── Start ────────────────────────────────────────────────────────────────
$('#tabs').replaceChildren(...TABS.map(t => (t.button = el('button', { type: 'button', role: 'tab', onclick: () => showTab(t.id) }, t.label))));
$('#panes').replaceChildren(el('p', { class: 'muted' }, 'Loading question banks…'));
await Promise.all([loadBanks(), loadLexicon()]);
$('#panes').replaceChildren();
let first = location.hash.slice(1);
if (!TABS.some(t => t.id === first)) { try { first = sessionStorage.getItem('pts.dev.tab') || 'overview'; } catch { first = 'overview'; } }
showTab(first);
window.ptsDev = { S, checkAnswer, sameExpression, sayRespelling, spokenTokens, tokenize, recordPace, voicePace };
