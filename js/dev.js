// pts dev tools (dev.html): troubleshooting views and controls. Not linked from the site.
// Everything here runs on this device and uses the site's own modules, so what it shows is
// what the site does.
import { CONFIG } from './config.js';
import { $, el, store } from './util.js';
import { loadQuestions, normalizeRow, SB_SUBJECTS, OSB_SUBJECTS } from './questions.js';
import {
  REVIEW_FIELDS, DECISIONS_PATH, LOCAL_KEY, TOKEN_KEY, bankKey, rowProblems, tidyRow, itemStatus, mergeDecisions, ghRead, ghWrite,
} from './review.js';
import { buildBankModel, suggestFixes, autoFill, questionFromText } from './review-autofill.js';
import { tokenize, spokenTokens, spokenForm, speakableText, sayRespelling, setPronunciations, useRespellings, richText, plainText } from './text.js';
import { checkAnswer, parseAnswerSpec, normalize, setVocabulary, buildVocabulary } from './checker.js';
import { evaluate, evaluateLoose, sameExpression, toPlainMath } from './mathval.js';
import {
  ttsSupported, englishVoices, speakQuestion, stopSpeaking, voicePace, recordPace, describeVoice,
  matchVoice, matchedRate, speechRate, estimateMs, DEFAULT_RATE,
} from './speech.js';
import { choiceStarts } from './engine.js';
import { Stats } from './stats.js';
import { googleUrl } from './game-view.js';
import { iceServers, getPeerClass, DEFAULT_ICE } from './net.js';

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
  document.body.dataset.devTab = t.id;   // the Review tab uses the full width
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
const respellBox = el('input', { type: 'checkbox', id: 'dev-respell' });
try { respellBox.checked = sessionStorage.getItem('pts.dev.respell') ? sessionStorage.getItem('pts.dev.respell') === '1' : !!CONFIG.respellings; } catch { respellBox.checked = !!CONFIG.respellings; }
useRespellings(respellBox.checked);
respellBox.addEventListener('change', () => {
  useRespellings(respellBox.checked);
  try { sessionStorage.setItem('pts.dev.respell', respellBox.checked ? '1' : '0'); } catch { /* ignore */ }
  const t = TABS.find(x => x.pane && !x.pane.hidden);           // redraw the open tab with the new setting
  if (t) { t.pane.remove(); t.pane = null; showTab(t.id); }
});
$('#voicebar').replaceChildren(el('label', {}, 'Voice'), voiceSel, el('label', {}, 'Rate'), rateIn, btn('Stop speaking', () => stopSpeaking()),
  el('label', { for: 'dev-respell', title: 'Say hard terms from packet guides and data/pronunciations.csv. The site has this ' + (CONFIG.respellings ? 'on' : 'off') + '.' },
    respellBox, ` Respellings (${CONFIG.respellings ? 'on' : 'off'} on the site)`));
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
          ['Pronunciation list', `${S.lexicon} words; respellings ${CONFIG.respellings ? 'on' : 'off'} on the site`],
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
        q.image ? el('p', {}, el('a', { href: q.image, target: '_blank', rel: 'noopener' },
          el('img', { src: q.image, alt: 'Visual bonus picture', style: 'max-width:100%;max-height:320px;background:#fff;border:1px solid #ccc;padding:4px' }))) : null,
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

// ── Review queue ─────────────────────────────────────────────────────────
// Questions the packet readers left out (importer/review_queue.py → review/queue.json), each
// with a screenshot from its packet. Fix one up and add it, or dismiss it. Decisions are saved
// to review/decisions.json on GitHub; the "Apply review" GitHub Action then adds the approved
// questions to the bank (importer/apply_review.py). Auto-fill (js/review-autofill.js) suggests
// fixes for each question and can apply the safe ones when a question is opened.
const STATUS_LABEL = { todo: 'To review', add: 'Approved (adding…)', added: 'Added', repeat: 'Already in the bank', dismissed: 'Dismissed' };
const DRAFTS_KEY = 'pts.dev.reviewDrafts.v1';
const AUTOFILL_KEY = 'pts.dev.reviewAutofill';
const VIEW_KEY = 'pts.dev.reviewView';
tab('review', 'Review', pane => {
  const savedView = (() => { try { return JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null'); } catch { return null; } })();
  const R = {
    queue: null, saved: {}, applied: {}, local: store.get(LOCAL_KEY, {}), drafts: store.get(DRAFTS_KEY, {}),
    f: { comp: '', set: '', reason: '', status: 'todo', q: '', ...(savedView?.f || {}) }, cur: savedView?.cur || null, list: [],
    autoOnOpen: store.get(AUTOFILL_KEY, true), autoTried: new Set(), autoNote: {},
  };
  const token = () => store.get(TOKEN_KEY, '') || '';
  const repo = CONFIG.repo || 'lightningale23/pts';
  const st = rid => itemStatus(rid, R);
  const bankKeys = new Map(S.all.map(q => [bankKey(q), q]));
  const head = el('div'), listBox = el('div'), edBox = el('div');
  const saveMsg = el('span', { class: 'muted' });
  let ed = null;   // the open editor's controls (for keyboard shortcuts)

  // The bank, learned once per competition: subject guesses, word list, similar questions.
  const models = {};
  const subjectsOf = comp => (comp === 'osb' ? OSB_SUBJECTS : [...SB_SUBJECTS, 'General Science']);
  const modelOf = comp => (models[comp] ||= buildBankModel(S.all.filter(q => q._comp === comp), { subjects: comp === 'osb' ? OSB_SUBJECTS : SB_SUBJECTS }));
  const ctxOf = it => ({ text: it.text, subjects: subjectsOf(it.comp), model: modelOf(it.comp) });

  const keepView = () => { try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ f: R.f, cur: R.cur })); } catch { /* ignore */ } };
  const persistLocal = () => { store.set(LOCAL_KEY, R.local); store.set(DRAFTS_KEY, R.drafts); };
  const pending = () => Object.keys(R.local).length;
  const decide = (it, d) => {
    if (d) R.local[it.rid] = { ...d, comp: it.comp, at: new Date().toISOString() };
    else if (R.saved[it.rid]) R.local[it.rid] = { action: 'undo' };
    else delete R.local[it.rid];
    delete R.drafts[it.rid];
    persistLocal();
  };
  const rowOf = it => R.drafts[it.rid] || (R.local[it.rid] || R.saved[it.rid])?.row || it.row;
  const problemsOf = it => {
    const r = tidyRow({ ...it.row, ...rowOf(it) });
    const p = rowProblems(r, subjectsOf(it.comp));
    const dup = bankKeys.get(bankKey(r));
    if (dup) p.push(`Already in the bank as ${dup.id}.`);
    return p;
  };
  const label = it => `${it.row.set} · ${it.row.round}${rowOf(it).num || it.row.num ? ` #${rowOf(it).num || it.row.num}` : ''} ${(rowOf(it).type || it.row.type) === 'BONUS' ? 'B' : 'TU'}`;

  async function load() {
    head.replaceChildren(el('p', { class: 'muted' }, 'Loading the review queue…'));
    try {
      const r = await fetch('review/queue.json', { cache: 'no-cache' });
      R.queue = r.ok ? await r.json() : null;
    } catch { R.queue = null; }
    await loadSaved();
    if (R.queue) {
      head.replaceChildren(el('p', { class: 'muted' }, 'Learning from the bank for auto-fill…'));
      await new Promise(r => setTimeout(r, 30));
      for (const comp of new Set(R.queue.items.map(it => it.comp))) modelOf(comp);
    }
    draw();
  }
  async function loadSaved() {
    const files = { saved: DECISIONS_PATH, applied: 'review/applied.json' };
    for (const [k, path] of Object.entries(files)) {
      try {
        if (token()) R[k] = (await ghRead(repo, path, token())).json || {};
        else { const r = await fetch(path, { cache: 'no-cache' }); R[k] = r.ok ? await r.json() : {}; }
      } catch (e) { saveMsg.className = 'bad'; saveMsg.textContent = `Couldn't read ${path}: ${e.message}`; }
    }
    for (const rid of Object.keys(R.local)) if (R.applied[rid]) delete R.local[rid];   // done already
    persistLocal();
  }

  async function save() {
    if (!token()) { saveMsg.className = 'bad'; saveMsg.textContent = 'Add a GitHub token first (under More), or download the file.'; return; }
    const n = pending();
    if (!n) return;
    saveMsg.className = 'muted'; saveMsg.textContent = 'Saving…';
    const count = a => Object.values(R.local).filter(d => d.action === a).length;
    const adds = count('add');
    const msg = `Review: ${[adds && `approve ${adds}`, count('dismiss') && `dismiss ${count('dismiss')}`, count('undo') && `undo ${count('undo')}`].filter(Boolean).join(', ')}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { sha, json } = await ghRead(repo, DECISIONS_PATH, token());
        R.applied = (await ghRead(repo, 'review/applied.json', token())).json || {};
        const merged = mergeDecisions(json || {}, R.local, R.applied);
        await ghWrite(repo, DECISIONS_PATH, token(), merged, sha, msg);
        R.saved = merged; R.local = {}; persistLocal();
        saveMsg.className = 'ok';
        saveMsg.textContent = `Saved ${n} change${n === 1 ? '' : 's'}. ${adds ? 'The "Apply review" GitHub Action adds approved questions to the bank in a minute or two; the site picks them up after it redeploys.' : ''}`;
        draw();
        return;
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt < 2) continue;   // changed meanwhile: read again
        saveMsg.className = 'bad'; saveMsg.textContent = `Not saved: ${e.message}`;
        return;
      }
    }
  }
  const download = () => {
    const merged = mergeDecisions(R.saved, R.local, R.applied);
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(merged, null, 1) + '\n'], { type: 'application/json' })), download: 'decisions.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importFile = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      for (const [rid, v] of Object.entries(d)) if (!R.applied[rid] && JSON.stringify(R.saved[rid]) !== JSON.stringify(v)) R.local[rid] = v;
      persistLocal(); draw();
    } catch (err) { saveMsg.className = 'bad'; saveMsg.textContent = `Couldn't read that file: ${err.message}`; }
    e.target.value = '';
  } });

  // Search: every word must appear somewhere in the set, round, number, type, subject, text,
  // answer, file, ID or reason ("based de6 22", "#14 bonus", "occludins").
  const hay = it => {
    const r = rowOf(it);
    return `${it.row.set} ${it.row.round} #${r.num || it.row.num} ${r.num || it.row.num} ${r.type} ${r.type === 'BONUS' ? 'b' : 'tu'} ${r.subject} ${r.format} ${r.question} ${r.answer} ${it.source.folder} ${it.source.file} ${it.rid} ${(R.queue.reasons || {})[it.reason] || it.reason} ${it.text || ''}`.toLowerCase();
  };
  const statusOk = (it, want) => {
    const s = st(it.rid);
    if (!want) return true;
    if (want === 'done') return s !== 'todo';
    if (want === 'ready') return s === 'todo' && !problemsOf(it).length;
    if (want === 'fix') return s === 'todo' && problemsOf(it).length > 0;
    if (want === 'edited') return s === 'todo' && !!R.drafts[it.rid];
    return s === want;
  };
  function filtered() {
    const f = R.f, words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (R.queue?.items || []).filter(it => (!f.comp || it.comp === f.comp) && (!f.set || it.row.set === f.set)
      && (!f.reason || it.reason === f.reason) && statusOk(it, f.status)
      && (!words.length || (h => words.every(w => h.includes(w)))(hay(it))));
  }

  // Applies every safe fix to each question in the list that is still to review.
  function autofillShown() {
    let n = 0, ready = 0;
    for (const it of R.list) {
      if (st(it.rid) !== 'todo') continue;
      const base = tidyRow({ ...it.row, ...rowOf(it) });
      const { row, applied } = autoFill(base, ctxOf(it));
      R.autoTried.add(it.rid);
      if (!applied.length) continue;
      R.drafts[it.rid] = tidyRow(row); R.autoNote[it.rid] = applied; n++;
      if (!problemsOf(it).length) ready++;
    }
    store.set(DRAFTS_KEY, R.drafts);
    saveMsg.className = 'ok';
    saveMsg.textContent = n ? `Auto-filled ${n} question${n === 1 ? '' : 's'}; ${ready} of them pass every check now. Nothing is approved until you add it.` : 'Nothing to auto-fill in this list.';
    draw();
    if (R.cur) open(R.cur);
  }

  function draw() {
    if (!R.queue) {
      head.replaceChildren(card('Review queue',
        el('p', {}, 'There is no review queue yet (review/queue.json). It is made from the packets on the computer they are kept on:'),
        pre('python importer/review_queue.py --sb "C:/Users/tobyw/Documents/scibowl-packets" --osb "C:/Users/tobyw/Documents/NOSB packets"'),
        el('p', { class: 'muted' }, 'Then commit review/ and push. A new chat that can reach the packet folders can do this too.')));
      listBox.replaceChildren(); edBox.replaceChildren();
      return;
    }
    const items = R.queue.items;
    const count = s => items.filter(it => st(it.rid) === s).length;
    const ready = items.filter(it => statusOk(it, 'ready')).length;
    const reasons = R.queue.reasons || {};
    const sel = (key, opts, lab) => el('select', { 'aria-label': lab, onchange: e => { R.f[key] = e.target.value; keepView(); drawList(); } },
      opts.map(([v, t]) => el('option', { value: v, selected: R.f[key] === v }, t)));
    const sets = [...new Set(items.filter(it => !R.f.comp || it.comp === R.f.comp).map(it => it.row.set))].sort();
    const setCount = name => items.filter(it => it.row.set === name && (!R.f.comp || it.comp === R.f.comp) && statusOk(it, R.f.status)).length;
    const byReason = Object.entries(items.reduce((a, it) => ((a[it.reason] = (a[it.reason] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]);
    const search = input({ id: 'rv-search', type: 'search', placeholder: 'Search: set, round, #number, words, answer, file or ID   ( / )', value: R.f.q, class: 'grow' });
    search.addEventListener('input', () => { R.f.q = search.value; keepView(); drawList(); });
    search.addEventListener('keydown', e => { if (e.key === 'Enter' && R.list[0]) { e.preventDefault(); open(R.list[0].rid); } });
    const tokIn = el('input', { type: 'password', placeholder: token() ? 'saved in this browser' : 'github_pat_…', class: 'grow', autocomplete: 'off' });
    const n = pending();
    head.replaceChildren(card('Review queue',
      el('p', { class: 'muted' }, `${fmt(count('todo'))} to review (${fmt(ready)} pass every check), ${fmt(count('add'))} approved and waiting, ${fmt(count('added'))} added, ${fmt(count('dismissed'))} dismissed.`),
      el('div', { class: 'row' },
        sel('status', [['todo', 'To review'], ['ready', 'To review: ready to add'], ['fix', 'To review: needs fixing'], ['edited', 'To review: edited'], ['add', 'Approved'], ['added', 'Added'], ['dismissed', 'Dismissed'], ['done', 'All decided'], ['', 'Everything']], 'Status'),
        sel('comp', [['', 'SB and OSB'], ...Object.entries(COMPS).map(([k, c]) => [k, c.short || k])], 'Competition'),
        sel('set', [['', `All sets (${sets.length})`], ...sets.map(s => [s, `${s} (${setCount(s)})`])], 'Set'),
        sel('reason', [['', 'Any reason'], ...byReason.map(([k]) => [k, reasons[k] || k])], 'Reason'),
        search),
      el('div', { class: 'row' },
        el('button', { class: 'btn small primary', type: 'button', disabled: !n, onclick: save }, n ? `Save ${n} change${n === 1 ? '' : 's'} to GitHub` : 'Nothing to save'),
        btn('✨ Auto-fill this list', autofillShown, { title: 'Applies the safe fixes to every question in the list that is still to review (saved as edits, not approved)' }),
        el('label', { class: 'muted', title: 'Applies the safe fixes when you open a question you haven\'t touched' },
          el('input', { type: 'checkbox', checked: R.autoOnOpen, onchange: e => { R.autoOnOpen = e.target.checked; store.set(AUTOFILL_KEY, R.autoOnOpen); } }), ' Auto-fill when I open a question'),
        saveMsg),
      el('details', {}, el('summary', {}, token() ? 'More' : 'More (GitHub token needed to save)'),
        el('p', { class: 'muted' }, `Queue made ${new Date(R.queue.generated).toLocaleString()}. `, byReason.map(([k, v]) => `${reasons[k] || k}: ${fmt(v)}`).join(' · ')),
        el('div', { class: 'row' }, btn('Download decisions.json', download), btn('Load a decisions file', () => importFile.click()), importFile, btn('Reload', () => load())),
        el('p', { class: 'muted' }, 'Saving writes review/decisions.json to the repo. Make a fine-grained token at GitHub → Settings → Developer settings → Fine-grained tokens: only the pts repository, permission Contents: Read and write. It stays in this browser (local storage), never in the repo. Without one, download decisions.json and commit it to review/ yourself.'),
        el('div', { class: 'row' }, tokIn,
          btn('Save token', () => { if (tokIn.value.trim()) store.set(TOKEN_KEY, tokIn.value.trim()); tokIn.value = ''; load(); }),
          btn('Forget token', () => { store.remove(TOKEN_KEY); draw(); })),
        el('p', { class: 'muted' }, 'Keys: Alt+↓ / Alt+↑ next and previous · Ctrl+Enter add · Alt+D dismiss · Alt+S skip · Alt+F auto-fill · Alt+Z undo a fill · / search · J / K move when not typing.'),
        R.queue.packets?.length ? el('details', {}, el('summary', {}, `${R.queue.packets.length} packets read only partly or not at all`),
          el('table', { class: 'dt' }, el('tbody', {}, R.queue.packets.map(p => el('tr', {},
            el('td', {}, `${p.folder} / ${p.file}`), el('td', { class: p.status === 'failed' ? 'bad' : '' }, p.status), el('td', { class: 'muted' }, p.problems.join('; '))))))) : null)));
    drawList();
  }

  // The list: every match at once, in its own scrolling box beside the editor.
  function drawList() {
    R.list = filtered();
    const dot = { todo: '○', add: '↑', added: '✓', repeat: '=', dismissed: '✕' };
    const box = el('div', { class: 'rv-scroll' });
    if (R.list.length) {
      box.append(el('table', { class: 'dt rv-list' }, el('tbody', {}, R.list.map(it => {
        const s = st(it.rid), probs = s === 'todo' ? problemsOf(it) : [];
        return el('tr', { class: it.rid === R.cur ? 'rv-cur' : '', dataset: { rid: it.rid }, tabindex: 0, onclick: () => open(it.rid), onkeydown: e => { if (e.key === 'Enter') open(it.rid); } },
          el('td', { title: STATUS_LABEL[s], class: s === 'added' || s === 'add' ? 'ok' : s === 'dismissed' ? 'muted' : '' }, dot[s]),
          el('td', {},
            el('div', {}, label(it), R.drafts[it.rid] ? el('span', { class: 'muted', title: 'Edited, not added yet' }, ' ✎') : null),
            el('div', { class: 'muted rv-snip' }, plainText(rowOf(it).question).slice(0, 80) || '(no text)'),
            el('div', { class: 'rv-tags' },
              s === 'todo' ? el('span', { class: probs.length ? 'bad' : 'ok', title: probs.join('\n') }, probs.length ? `${probs.length} to fix` : 'ready') : null,
              el('span', { class: 'muted' }, (R.queue.reasons || {})[it.reason] || it.reason))));
      }))));
    } else box.append(el('p', { class: 'muted' }, 'Nothing here.'));
    listBox.replaceChildren(el('section', { class: 'dev-card rv-listcard' }, el('h2', {}, `${fmt(R.list.length)} question${R.list.length === 1 ? '' : 's'}`), box));
    if (!R.list.some(it => it.rid === R.cur)) { if (R.list[0]) open(R.list[0].rid); else { R.cur = null; ed = null; edBox.replaceChildren(); } }
    else markCurrent();
  }
  function markCurrent() {
    for (const tr of listBox.querySelectorAll('tr')) tr.classList.toggle('rv-cur', tr.dataset.rid === R.cur);
    listBox.querySelector('tr.rv-cur')?.scrollIntoView({ block: 'nearest' });
  }

  // Next question still to review after this one (after an add, dismiss or skip).
  function next(rid) {
    const i = R.list.findIndex(it => it.rid === rid);
    const later = R.list.slice(i + 1).find(it => st(it.rid) === 'todo') || R.list.find(it => st(it.rid) === 'todo' && it.rid !== rid);
    if (later) R.cur = later.rid;
    drawList();
    if (later && R.list.some(it => it.rid === later.rid)) open(later.rid);
    else if (R.list[0] && !R.list.some(it => it.rid === R.cur)) open(R.list[0].rid);
  }
  // The question above or below in the list, whatever its status.
  function move(delta) {
    const i = R.list.findIndex(it => it.rid === R.cur);
    const j = Math.max(0, Math.min(R.list.length - 1, (i < 0 ? 0 : i) + delta));
    if (R.list[j] && R.list[j].rid !== R.cur) open(R.list[j].rid);
  }

  function open(rid) {
    const it = R.queue.items.find(x => x.rid === rid);
    if (!it) return;
    const fresh = R.shown !== rid;
    R.cur = R.shown = rid; keepView();
    const s = st(rid);
    const locked = s === 'added' || s === 'repeat';
    const ctx = ctxOf(it);
    // Auto-fill a question nobody has touched, once per visit to the page.
    if (R.autoOnOpen && s === 'todo' && !R.drafts[rid] && !R.local[rid] && !R.saved[rid] && !R.autoTried.has(rid)) {
      R.autoTried.add(rid);
      const { row: filled, applied } = autoFill(tidyRow(it.row), ctx);
      if (applied.length) { R.drafts[rid] = tidyRow(filled); R.autoNote[rid] = applied; store.set(DRAFTS_KEY, R.drafts); }
    }
    const row = { ...it.row, ...rowOf(it) };
    const subjects = subjectsOf(it.comp);
    const F = {};
    const undo = [];
    const field = (f, lab, node) => { F[f] = node; node.disabled = locked; node.addEventListener('input', changed); return el('label', { class: `rv-f rv-${f}` }, el('span', {}, lab), node); };
    const txt = (f, lab, attrs = {}) => field(f, lab, el('input', { type: 'text', value: row[f] ?? '', ...attrs }));
    const pick = (f, lab, opts) => field(f, lab, el('select', {}, [...new Set([row[f], ...opts])].filter(v => v != null).map(o => el('option', { value: o, selected: o === row[f] }, o || '—'))));
    const area = (f, lab, rows) => field(f, lab, el('textarea', { rows }, row[f] ?? ''));
    const preview = el('div'), probs = el('div'), mcBox = el('div', { class: 'rv-grid4' }), fixBox = el('div', { class: 'rv-fixes' }), simBox = el('div');
    const sets = [...new Set(S.all.filter(q => q._comp === it.comp).map(q => q.set))].sort();
    const setList = el('datalist', { id: 'rv-sets' }, sets.map(x => el('option', { value: x })));
    // A text box with a datalist only offers options that match what is already typed, so a filled-in
    // Set showed one option. Empty it while it has focus so every set is listed, and put it back if
    // nothing was picked.
    let keptSet = null;
    const showAllSets = e => { keptSet = e.target.value; e.target.value = ''; };
    const restoreSet = e => { if (!e.target.value && keptSet) { e.target.value = keptSet; changed(); } keptSet = null; };
    const current = () => tidyRow(Object.fromEntries(REVIEW_FIELDS.map(f => [f, F[f] ? F[f].value : row[f]])));
    const addBtn = el('button', { class: 'btn small primary', type: 'button', onclick: () => add(), title: 'Ctrl+Enter' }, s === 'add' ? 'Update approved' : 'Add to the site');
    const noteIn = input({ placeholder: 'Why dismissed (optional)', class: 'grow', value: (R.local[rid] || R.saved[rid])?.note || '' });
    const undoBtn = btn('↶ Undo fill', () => undoFill(), { disabled: true, title: 'Alt+Z' });
    const autoBtn = btn('✨ Auto-fill', () => applyAll(), { title: 'Applies every safe fix below (Alt+F)' });

    // Puts a whole row into the form (keeping a copy for Undo).
    function setForm(r, remember = true) {
      if (remember) { undo.push(current()); undoBtn.disabled = false; }
      for (const f of REVIEW_FIELDS) {
        const node = F[f];
        if (!node) continue;
        const v = r[f] ?? '';
        if (node.tagName === 'SELECT' && ![...node.options].some(o => o.value === v)) node.append(el('option', { value: v }, v || '—'));
        node.value = v;
      }
      changed();
    }
    function undoFill() { if (undo.length) { setForm(undo.pop(), false); undoBtn.disabled = !undo.length; } }
    function applyAll() {
      if (locked) return;
      const { row: r, applied } = autoFill(current(), ctx);
      if (applied.length) { setForm(r); fixNote(`Filled: ${applied.join(' · ')}`); }
      else fixNote('Nothing left to fill.');
    }
    let noteText = R.autoNote[rid] ? `Auto-filled when opened: ${R.autoNote[rid].join(' · ')}` : '';
    const fixNote = t => { noteText = t; drawFixes(current()); };
    function drawFixes(r) {
      if (locked) { fixBox.replaceChildren(); return; }
      const fixes = suggestFixes(r, ctx);
      const safe = fixes.filter(f => f.auto).length;
      autoBtn.disabled = !safe;
      autoBtn.textContent = safe ? `✨ Auto-fill (${safe})` : '✨ Auto-fill';
      fixBox.replaceChildren(
        fixes.length ? el('div', { class: 'rv-chips' }, fixes.map(f => el('button', {
          type: 'button', class: `rv-chip${f.auto ? ' safe' : ''}`, title: f.detail,
          onclick: () => { setForm(f.apply(current())); fixNote(`${f.label}: ${f.detail}`); },
        }, f.auto ? '✨ ' : '? ', f.label))) : el('span', { class: 'muted' }, 'No fixes to suggest.'),
        ...(noteText ? [el('div', { class: 'muted rv-fixnote' }, noteText)] : []));
    }
    let simTimer = 0;
    function drawSimilar(r) {
      clearTimeout(simTimer);
      simTimer = setTimeout(() => {
        const hits = r.question.length > 25 ? ctx.model.similar(r.question, { answer: r.answer }).filter(h => h.q.id !== R.applied[rid]?.id) : [];
        simBox.replaceChildren(...!hits.length ? [] : [el('div', { class: 'rv-sim' }, el('h3', {}, 'Similar questions in the bank'),
          hits.map(h => el('div', { class: 'rv-simrow' },
            el('div', {}, el('b', { class: h.score > 0.8 ? 'bad' : '' }, `${Math.round(h.score * 100)}%`), h.sameAnswer ? el('span', { class: 'bad' }, ' · same answer') : null,
              ` · ${h.q.set} ${h.q.round} #${h.q.num} ${h.q.type === 'BONUS' ? 'B' : 'TU'} · `,
              el('a', { href: '#question', onclick: e => { e.preventDefault(); try { sessionStorage.setItem('pts.dev.q', h.q.id); } catch { /* ignore */ } showQuestion(h.q.id); } }, h.q.id),
              locked || s === 'dismissed' ? null : [' · ', el('a', { href: '#', onclick: e => { e.preventDefault(); decide(it, { action: 'dismiss', note: `repeat of ${h.q.id} (${h.q.set} ${h.q.round} #${h.q.num})` }); next(rid); draw(); } }, 'dismiss as a repeat')]),
            el('div', { class: 'muted rv-snip' }, plainText(h.q.question).slice(0, 160), ' — ', plainText(h.q.answer).slice(0, 60)))))]);
      }, 150);
    }

    function changed() {
      const r = current();
      if (!locked) {
        const orig = tidyRow({ ...it.row, ...((R.local[rid] || R.saved[rid])?.row || {}) });
        if (JSON.stringify(r) !== JSON.stringify(orig)) R.drafts[rid] = r; else delete R.drafts[rid];
        store.set(DRAFTS_KEY, R.drafts);
      }
      mcBox.hidden = r.format !== 'Multiple Choice';
      const q = normalizeRow({ ...r, id: 'preview' });
      const p = rowProblems(r, subjects);
      const dup = bankKeys.get(bankKey(r));
      if (dup && !locked) p.push(`Already in the bank as ${dup.id} (${dup.set} ${dup.round} #${dup.num}).`);
      const warn = /\b(?:shown|pictured|depicted|below|above|diagram|figure|image|graph)\b/i.test(r.question)
        ? ["The site can't show pictures: make sure the question works without one."] : [];
      probs.replaceChildren(...p.map(x => el('div', { class: 'bad' }, x)), ...warn.map(x => el('div', { class: 'muted' }, '⚠ ', x)));
      addBtn.disabled = locked || p.length > 0;
      addBtn.title = p.length ? p.join('\n') : 'Ctrl+Enter';
      drawFixes(r);
      drawSimilar(r);
      const listRow = listBox.querySelector(`tr[data-rid="${rid}"] .rv-tags span`);
      if (listRow && s === 'todo') { listRow.className = p.length ? 'bad' : 'ok'; listRow.textContent = p.length ? `${p.length} to fix` : 'ready'; }
      if (!q) { preview.replaceChildren(el('p', { class: 'muted' }, 'Fill in the question and answer to see it.')); return; }
      const forms = officialForms(q);
      preview.replaceChildren(el('div', { class: 'qbox' },
        el('div', { class: 'meta' }, [r.set, r.round, r.num && `#${r.num}`, r.type, r.subject, r.format].filter(Boolean).join(' · ')),
        el('div', { html: richText(q.question) }),
        q.choices ? el('ol', { type: 'A' }, q.choices.map((c, i) => el('li', { html: `<b>${'WXYZ'[i]})</b> ${richText(c)}` }))) : null,
        el('p', {}, el('b', {}, 'Answer: '), el('span', { html: richText(q.answer) })),
        q.accept ? el('p', {}, el('b', {}, 'Accept: '), q.accept) : null,
        q.reject ? el('p', {}, el('b', {}, 'Reject: '), q.reject) : null,
        q.notes ? el('p', { class: 'muted' }, 'Notes: ', q.notes) : null,
        el('table', { class: 'dt' }, el('tbody', {}, forms.map(f => {
          const c = checkAnswer(q, f);
          return el('tr', {}, el('td', {}, f), el('td', { class: c.correct ? 'ok' : 'bad' }, c.correct ? 'accepted' : 'REJECTED by the checker'));
        })))));
    }
    function add() {
      const r = current();
      if (locked || rowProblems(r, subjects).length) return;
      decide(it, { action: 'add', row: r });
      next(rid);
      draw();
    }
    const dismiss = () => { if (locked) return; decide(it, { action: 'dismiss', note: noteIn.value.trim() }); next(rid); draw(); };
    // The packet text as the question: the block for this number, with its ANSWER line, then the safe fixes.
    const fromText = () => {
      const t = questionFromText(it.text, current());
      if (!t) return;
      const r = { ...current(), question: t.question };
      if (t.answer && !String(r.answer || '').trim()) r.answer = t.answer;
      setForm(autoFill(r, ctx).row);
      fixNote('Took the question from the packet text and auto-filled it.');
    };
    const img = it.img ? el('img', { src: `review/${it.img}`, alt: 'The question in its packet', class: 'rv-shot', onclick: e => e.target.classList.toggle('rv-zoom') }) : null;
    const d = R.local[rid] || R.saved[rid];
    const pos = R.list.findIndex(x => x.rid === rid);
    const bar = el('div', { class: 'rv-bar' },
      btn('‹', () => move(-1), { title: 'Previous (Alt+↑)', disabled: pos <= 0 }),
      el('span', { class: 'muted rv-pos' }, pos >= 0 ? `${pos + 1} / ${R.list.length}` : '—'),
      btn('›', () => move(1), { title: 'Next (Alt+↓)', disabled: pos < 0 || pos >= R.list.length - 1 }),
      locked ? null : [addBtn, btn('Dismiss', dismiss, { title: 'Alt+D' }), btn('Skip →', () => next(rid), { title: 'Next one to review (Alt+S)' }), autoBtn, undoBtn]);
    edBox.replaceChildren(el('section', { class: 'dev-card rv-edcard' }, bar,
      el('h2', {}, `${it.row.set} · ${it.row.round}${it.row.num ? ` #${it.row.num}` : ''} ${it.row.type}`),
      el('div', { class: 'meta muted' }, `${COMPS[it.comp]?.short || it.comp} · ${(R.queue.reasons || {})[it.reason] || it.reason} · ${it.source.folder} / ${it.source.file}${it.source.pages ? ` (page ${it.source.pages.join(', ')})` : ''} · ${rid}`),
      el('p', { class: s === 'todo' ? 'muted' : 'ok' }, STATUS_LABEL[s],
        s === 'added' ? [' as ', el('a', { href: '#question', onclick: e => { e.preventDefault(); try { sessionStorage.setItem('pts.dev.q', R.applied[rid].id); } catch { /* ignore */ } showQuestion(R.applied[rid].id); } }, R.applied[rid].id), ' (reload the page to see it in the bank)'] : null,
        s === 'dismissed' && d?.note ? ` — ${d.note}` : null,
        (R.local[rid]) ? el('span', { class: 'muted' }, ' · not saved yet') : null),
      el('div', { class: 'rv-ed' },
        el('div', { class: 'rv-left' },
          it.problems?.length ? el('ul', { class: 'muted rv-probs' }, it.problems.map(p => el('li', {}, p))) : null,
          img || el('p', { class: 'muted' }, 'No screenshot for this one (a text packet, or the question could not be found on the page).'),
          it.text ? el('details', {}, el('summary', {}, 'Text read from the packet'), pre(it.text),
            locked ? null : el('div', { class: 'row' }, btn('Use it as the question', fromText))) : null,
          simBox),
        el('div', { class: 'rv-right' },
          fixBox,
          el('div', { class: 'rv-form' },
            el('div', { class: 'rv-grid' },
              txt('set', 'Set', { list: 'rv-sets', onfocus: showAllSets, onblur: restoreSet }), setList, txt('year', 'Year'), pick('level', 'Level', ['HS', 'MS']),
              txt('round', 'Round'), txt('num', 'Number'), pick('type', 'Type', ['TOSS-UP', 'BONUS']),
              pick('subject', 'Subject', subjects), pick('format', 'Format', ['Short Answer', 'Multiple Choice'])),
            area('question', 'Question (math as $x^{2}$)', 6),
            mcBox,
            el('div', { class: 'rv-grid' }, txt('answer', 'Answer'), txt('accept', 'Accept (; between)'), txt('reject', 'Do not accept'), txt('notes', 'Notes'))),
          probs,
          locked ? null : el('div', { class: 'row' }, noteIn,
            s !== 'todo' ? btn('Undo decision', () => { decide(it, null); open(rid); draw(); }) : null,
            btn('Reset edits', () => { delete R.drafts[rid]; delete R.autoNote[rid]; store.set(DRAFTS_KEY, R.drafts); R.cur = null; open(rid); drawList(); })),
          el('h3', {}, 'How it will look'), preview))));
    mcBox.append(...['w', 'x', 'y', 'z'].map(c => txt(c, `${c.toUpperCase()})`)));
    ed = { add, dismiss, skip: () => next(rid), applyAll, undoFill, locked };
    changed();
    markCurrent();
    // Keep the editor's top in view when moving to another question.
    if (fresh) { const top = edBox.getBoundingClientRect().top; if (top < 0 || top > innerHeight * 0.6) edBox.scrollIntoView({ block: 'start' }); }
  }

  // Keyboard: works while this tab is showing.
  document.addEventListener('keydown', e => {
    if (pane.hidden || !R.queue) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const k = e.code;
    if (e.altKey && (k === 'ArrowDown' || k === 'ArrowUp')) { e.preventDefault(); move(k === 'ArrowDown' ? 1 : -1); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && ed && e.target.id !== 'rv-search') { e.preventDefault(); ed.add(); return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey && ed && !ed.locked) {
      const act = { KeyD: ed.dismiss, KeyS: ed.skip, KeyF: ed.applyAll, KeyZ: ed.undoFill }[k];
      if (act) { e.preventDefault(); act(); return; }
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); $('#rv-search')?.focus(); }
    else if (e.key === 'j') move(1);
    else if (e.key === 'k') move(-1);
  });

  pane.append(head, el('div', { class: 'rv-cols' }, listBox, edBox));
  load();
});

// ── Network (rooms) ──────────────────────────────────────────────────────
// What a room needs from this network: the room service (PeerJS broker), and a route to the
// other device: direct (STUN finds a public address) or through a relay (TURN).
const urlsOf = srv => [].concat(srv.urls || srv.url || []);
function gather(servers, policy = 'all', ms = 7000) {
  return new Promise(resolve => {
    const found = [];
    let pc;
    try { pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: policy }); } catch (e) { resolve({ error: e.message, found }); return; }
    pc.createDataChannel('probe');
    const done = () => { try { pc.close(); } catch { /* ignore */ } resolve({ found }); };
    const timer = setTimeout(done, ms);
    pc.onicecandidate = e => {
      if (!e.candidate) { clearTimeout(timer); done(); return; }
      const c = e.candidate;
      const m = String(c.candidate).match(/ typ (\w+)/);
      found.push({ type: c.type || m?.[1] || '?', protocol: c.protocol || (/ (udp|tcp) /i.exec(c.candidate)?.[1] || '?').toLowerCase(), address: c.address || '', url: c.url || '' });
    };
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(e => { clearTimeout(timer); resolve({ error: e.message, found }); });
  });
}
async function loopback(policy) {
  const Peer = await getPeerClass();
  const servers = await iceServers();
  const opts = { debug: 0, ...(CONFIG.peerOptions || {}), config: { iceServers: servers, iceTransportPolicy: policy } };
  const mk = id => new Promise((res, rej) => { const p = new Peer(id, opts); p.on('open', () => res(p)); p.on('error', rej); });
  const a = await mk(`${CONFIG.peerPrefix}devtest-${Math.random().toString(36).slice(2, 8)}`);
  const b = await mk(undefined);
  const t0 = performance.now();
  try {
    return await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('no connection after 15 s')), 15000);
      a.on('connection', c => c.on('data', d => { if (d === 'ping') c.send('pong'); }));
      const c = b.connect(a.id, { reliable: true });
      c.on('open', () => c.send('ping'));
      c.on('data', d => { if (d === 'pong') { clearTimeout(timer); res(Math.round(performance.now() - t0)); } });
      c.on('error', e => { clearTimeout(timer); rej(new Error(e.type || e.message)); });
    });
  } finally { try { a.destroy(); b.destroy(); } catch { /* ignore */ } }
}
tab('network', 'Network', pane => {
  const out = el('div');
  const line = (ok, text) => el('li', { class: ok === true ? 'ok' : ok === false ? 'bad' : 'muted' }, `${ok === true ? '✓' : ok === false ? '✗' : '·'} ${text}`);
  const run = async () => {
    const list = el('ul');
    out.replaceChildren(list);
    const add = (ok, text) => { list.append(line(ok, text)); };
    add(null, `Browser: ${navigator.userAgent}`);
    if (typeof RTCPeerConnection === 'undefined') { add(false, 'This browser has no WebRTC, so it can’t join rooms.'); return; }
    // 1. relay settings
    const servers = await iceServers({ fresh: true });
    const custom = servers.filter(s => !DEFAULT_ICE.includes(s));
    add(custom.length ? true : null, custom.length ? `Relay servers set for this site: ${custom.map(s => urlsOf(s).join(', ')).join(' | ')}` : 'No relay servers of the site’s own (iceServersUrl / iceServers in js/config.js); only Google STUN and PeerJS’s free TURN.');
    if (CONFIG.iceServersUrl && !custom.length) add(false, `iceServersUrl is set, but it returned no servers: ${CONFIG.iceServersUrl.replace(/apiKey=[^&]+/, 'apiKey=…')}`);
    // 2. the room service
    try {
      const Peer = await getPeerClass();
      add(true, 'Loaded the multiplayer library (PeerJS).');
      const id = await new Promise((res, rej) => {
        const p = new Peer(undefined, { debug: 0, ...(CONFIG.peerOptions || {}) });
        const timer = setTimeout(() => { try { p.destroy(); } catch { /* ignore */ } rej(new Error('no answer after 10 s')); }, 10000);
        p.on('open', pid => { clearTimeout(timer); res(pid); try { p.destroy(); } catch { /* ignore */ } });
        p.on('error', e => { clearTimeout(timer); rej(new Error(e.type || e.message)); });
      });
      add(true, `Reached the room service (got ID ${id.slice(0, 8)}…). Creating and finding rooms works.`);
    } catch (e) { add(false, `Couldn’t reach the room service: ${e.message}. Rooms can’t be created or joined from this network.`); }
    // 3. routes, server by server
    add(null, 'Checking routes (a few seconds per server)…');
    let direct = false, relay = false;
    const host = await gather([], 'all', 3000);
    const hostTypes = new Set(host.found.map(c => c.type));
    add(hostTypes.has('host') ? true : null, hostTypes.has('host') ? 'This device offers local addresses (same-network connections possible).' : 'No local addresses offered (the browser hides them, or a policy blocks UDP).');
    for (const srv of servers) {
      const r = await gather([srv], 'all', 7000);
      const types = [...new Set(r.found.map(c => `${c.type}/${c.protocol}`))].filter(t => !t.startsWith('host'));
      const isTurn = urlsOf(srv).some(u => /^turns?:/.test(u));
      const gotRelay = r.found.some(c => c.type === 'relay');
      const gotSrflx = r.found.some(c => c.type === 'srflx');
      direct ||= gotSrflx; relay ||= gotRelay;
      add(isTurn ? gotRelay : gotSrflx, `${urlsOf(srv).join(', ')}: ${r.error ? `error ${r.error}` : types.length ? types.join(', ') : 'no answer'}`);
    }
    add(direct, direct ? 'A public address was found (direct connections may work, unless the other side is blocked).' : 'No public address found: direct connections from this network won’t work.');
    add(relay, relay ? 'A relay server answered: rooms can go through it.' : 'No relay server answered: on a network that blocks direct connections, rooms can’t connect.');
    // 4. a real connection, this device to itself
    for (const [policy, label] of [['all', 'Room connection (any route)'], ['relay', 'Room connection through a relay only']]) {
      try { add(true, `${label}: works (${await loopback(policy)} ms to connect and answer).`); }
      catch (e) { add(false, `${label}: failed (${e.message}).`); }
    }
    add(null, 'Run this on both devices. Two devices can play if both reach the room service and either both find a public address or at least one reaches a relay.');
  };
  pane.append(card('Rooms on this network',
    el('p', { class: 'muted' }, 'Checks what a room needs: the room service that introduces devices, and a route between them (direct, or through a relay server). Takes about half a minute.'),
    el('div', { class: 'row' }, btn('Run the check', async e => { e.target.disabled = true; try { await run(); } finally { e.target.disabled = false; } })), out));
});

// ── Start ────────────────────────────────────────────────────────────────
$('#tabs').replaceChildren(...TABS.map(t => (t.button = el('button', { type: 'button', role: 'tab', onclick: () => showTab(t.id) }, t.label))));
$('#panes').replaceChildren(el('p', { class: 'muted' }, 'Loading question banks…'));
await Promise.all([loadBanks(), loadLexicon()]);
$('#panes').replaceChildren();
let first = location.hash.slice(1);
if (!TABS.some(t => t.id === first)) { try { first = sessionStorage.getItem('pts.dev.tab') || 'overview'; } catch { first = 'overview'; } }
showTab(first);
window.ptsDev = { S, checkAnswer, sameExpression, sayRespelling, spokenTokens, tokenize, recordPace, voicePace };
