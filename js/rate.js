// rate.html: the difficulty grid. One question per subject (columns) per 0.25 of stored difficulty (rows), so
// people can see whether the ratings (data/difficulty.csv) line up across subjects and climb down each column.
// Cells, rows, columns or the whole grid can be re-picked at random. People mark a question as easier / about
// right / harder than its number; marks stay in this browser (pts.rate.v2) until downloaded and sent to the owner.
import { $, el, store } from './util.js';
import { parseQuestions } from './questions.js';
import { richText } from './text.js';

const KEY = 'pts.rate.v2';
const OLD_KEY = 'pts.rate.v1';   // the old blind-rating page; its ratings can still be downloaded
const STEP = 0.25;
const theme = store.get('lockout.theme', null);
if (theme) document.documentElement.dataset.theme = theme;

const COMPS = {
  sb: { label: 'Science Bowl', file: 'data/questions.csv', subjects: ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Earth and Space', 'Energy'] },
  osb: { label: 'Ocean Science Bowl', file: 'data/osb-questions.csv', subjects: ['Biology', 'Chemistry', 'Geology', 'Physical Oceanography', 'Technology', 'Social Sciences', 'Geography'] },
};
const VERDICTS = [
  { v: 'easier', short: 'Easier', long: d => `Easier than ${fmt(d)}`, title: 'This question is easier than its number says' },
  { v: 'right', short: 'OK', long: () => 'About right', title: 'The number looks right' },
  { v: 'harder', short: 'Harder', long: d => `Harder than ${fmt(d)}`, title: 'This question is harder than its number says' },
];

const saved = store.get(KEY, null) || {};
const state = {
  comp: COMPS[saved.comp] ? saved.comp : 'sb',
  filters: { level: '', type: '', format: '', ...(saved.filters || {}) },
  answers: Boolean(saved.answers),
  picks: { sb: {}, osb: {}, ...(saved.picks || {}) },
  marks: saved.marks || {},
  name: saved.name || '',
};
const persist = () => {
  const ok = store.set(KEY, { comp: state.comp, filters: state.filters, answers: state.answers, picks: state.picks, marks: state.marks, name: state.name });
  if (!ok) $('#export-status').textContent = "This browser can't save: download your marks before you leave.";
};

const fmt = d => d.toFixed(2);
const binOf = d => Math.floor(Math.round(d * 100) / (STEP * 100));   // exact on two-decimal ratings
const share = d => 100 * Math.pow(10, -d / 5);
const shareText = d => { const p = share(d); return p >= 10 ? `${Math.round(p)}%` : p >= 1 ? `${p.toFixed(1)}%` : `${p.toFixed(2)}%`; };
const cellKey = (subject, bin) => `${subject}|${bin}`;
const TYPE = q => (q.type === 'bonus' ? 'Bonus' : 'Toss-up');
const FORMAT = q => (q.format === 'mc' ? 'MC' : 'SA');

const banks = {};          // comp → questions with a stored rating (q.d)
let pools = new Map();     // cellKey → questions allowed by the filters
let maxBin = 0;
const byId = new Map();

function buildPools() {
  const { level, type, format } = state.filters;
  const subjects = new Set(COMPS[state.comp].subjects);
  pools = new Map();
  maxBin = 0;
  for (const q of banks[state.comp] || []) {
    if (!subjects.has(q.subject)) continue;
    if (level && q.level !== level) continue;
    if (type && q.type !== type) continue;
    if (format && q.format !== format) continue;
    const b = binOf(q.d), k = cellKey(q.subject, b);
    if (!pools.has(k)) pools.set(k, []);
    pools.get(k).push(q);
    if (b > maxBin) maxBin = b;
  }
}

// A random question for a cell, another than the one there now when there's a choice.
function pick(k) {
  const pool = pools.get(k) || [];
  const now = state.picks[state.comp][k];
  const others = pool.length > 1 ? pool.filter(q => q.id !== now) : pool;
  const q = others[Math.floor(Math.random() * others.length)];
  if (q) state.picks[state.comp][k] = q.id; else delete state.picks[state.comp][k];
}
// The question shown in a cell; a missing or filtered-out pick is replaced.
function current(k) {
  const id = state.picks[state.comp][k];
  const pool = pools.get(k) || [];
  if (!id || !pool.some(q => q.id === id)) pick(k);
  return byId.get(state.picks[state.comp][k]) || null;
}

const bins = () => Array.from({ length: maxBin + 1 }, (_, b) => b);
const subjects = () => COMPS[state.comp].subjects;

function reroll(keys) {
  for (const k of keys) pick(k);
  persist();
  for (const k of keys) drawCell(k);
}

// ── Drawing ──
function drawComp() {
  $('#comp').replaceChildren(...Object.entries(COMPS).map(([c, { label }]) =>
    el('button', { type: 'button', 'aria-pressed': String(c === state.comp), onclick: () => { state.comp = c; persist(); drawComp(); redraw(); } }, label)));
}

function judgeButtons(q, small) {
  const m = state.marks[q.id];
  return VERDICTS.map(({ v, short, long, title }) => el('button', {
    type: 'button', class: v, title, 'aria-pressed': String(m?.v === v),
    onclick: e => { e.stopPropagation(); setMark(q, m?.v === v ? null : v); },
  }, small ? short : long(q.d)));
}

function setMark(q, v, note) {
  const m = state.marks[q.id] || {};
  const next = { ...m, v: v === undefined ? m.v ?? null : v, at: new Date().toISOString() };
  if (note !== undefined) next.note = note;
  if (!next.v && !next.note) delete state.marks[q.id];
  else state.marks[q.id] = { ...next, d: q.d, subject: q.subject, comp: state.comp };
  persist();
  const k = cellKey(q.subject, binOf(q.d));
  if (state.picks[state.comp][k] === q.id) drawCell(k);
  if (dlgKey === k) drawDialog();
  drawTally();
}

function cellContent(k) {
  const q = current(k);
  const pool = pools.get(k) || [];
  if (!q) return el('div', { class: 'none' }, 'No question here');
  const text = richText(q.question) + (q.choices ? `<br>${q.choices.map((c, i) => `<b>${'WXYZ'[i]})</b> ${richText(c)}`).join('<br>')}` : '');
  const ans = q.choices && q.answerLetter ? `${q.answerLetter}) ${richText(q.answerText)}` : richText(q.answer);
  return el('div', { class: 'cell' },
    el('div', { class: 'top' },
      el('span', { class: 'd', title: `Stored difficulty: about ${shareText(q.d)} of teams` }, fmt(q.d)),
      el('span', {}, `${TYPE(q)} · ${FORMAT(q)}${q.level === 'MS' ? ' · MS' : ''}`),
      el('span', { class: 'sp' }),
      el('span', { title: `${pool.length} question${pool.length === 1 ? '' : 's'} could go here` }, String(pool.length)),
      el('button', { type: 'button', class: 're', title: 'Another question for this cell', 'aria-label': 'Another question for this cell', disabled: pool.length < 2, onclick: () => reroll([k]) }, '↻')),
    el('button', { type: 'button', class: 'q', html: text, title: 'Read it in full', onclick: () => openDialog(k) }),
    state.answers ? el('div', { class: 'a', html: `<b>Answer:</b> ${ans}` }) : '',
    el('div', { class: 'judge' }, judgeButtons(q, true)));
}

function drawCell(k) {
  const td = document.querySelector(`td[data-k="${CSS.escape(k)}"]`);
  if (!td) return;
  const content = cellContent(k);
  const q = byId.get(state.picks[state.comp][k]);
  const v = q && state.marks[q.id]?.v;
  td.className = (pools.get(k) || []).length ? (v ? `v-${v}` : '') : 'empty';
  td.replaceChildren(content);
}

function redraw() {
  buildPools();
  const subs = subjects();
  const head = el('tr', {},
    el('th', { scope: 'col' }, el('span', { class: 'sub' }, 'Difficulty')),
    ...subs.map(s => {
      const n = bins().reduce((t, b) => t + (pools.get(cellKey(s, b))?.length || 0), 0);
      return el('th', { scope: 'col' }, el('div', { class: 'colhead' },
        el('span', {}, el('b', {}, s), el('span', { class: 'sub' }, `${n.toLocaleString()} questions`)),
        el('button', { type: 'button', class: 're', title: `New questions for all of ${s}`, 'aria-label': `Randomize ${s}`, onclick: () => reroll(bins().map(b => cellKey(s, b))) }, '↻')));
    }));
  const rows = bins().map(b => el('tr', {},
    el('th', { scope: 'row' },
      el('span', { class: 'rowd' }, fmt(b * STEP)),
      el('span', { class: 'sub', title: `Up to ${fmt((b + 1) * STEP - 0.01)}; about ${shareText(b * STEP)} of teams` }, `to ${fmt((b + 1) * STEP - 0.01)}`),
      el('button', { type: 'button', class: 're', title: `New questions for this row`, 'aria-label': `Randomize row ${fmt(b * STEP)}`, onclick: () => reroll(subs.map(s => cellKey(s, b))) }, '↻ row')),
    ...subs.map(s => el('td', { 'data-k': cellKey(s, b) }))));
  const table = el('table', { class: 'grid' }, el('thead', {}, head), el('tbody', {}, rows));
  $('#grid-wrap').replaceChildren(table);
  for (const b of bins()) for (const s of subs) drawCell(cellKey(s, b));
  persist();
  drawTally();
}

function drawTally() {
  const ms = Object.values(state.marks).filter(m => m.v);
  const c = v => ms.filter(m => m.v === v).length;
  $('#tally').textContent = ms.length ? `${ms.length} marked: ${c('easier')} easier, ${c('right')} OK, ${c('harder')} harder` : 'Nothing marked yet.';
}

// ── Full view of one cell ──
let dlgKey = null;
function openDialog(k) {
  dlgKey = k;
  drawDialog();
  $('#dlg').showModal();
}
function drawDialog() {
  const q = byId.get(state.picks[state.comp][dlgKey]);
  if (!q) { $('#dlg').close(); return; }
  $('#d-meta').innerHTML = `<span class="d">${fmt(q.d)}</span> · ${state.comp === 'osb' ? 'Ocean Science Bowl · ' : ''}${q.subject} · ${TYPE(q)} · ${q.format === 'mc' ? 'Multiple choice' : 'Short answer'}${q.level === 'MS' ? ' · Middle school' : ''}<br>${[q.set, q.round && `Round ${q.round}`, q.num && `#${q.num}`].filter(Boolean).join(', ')} · ID ${q.id}`;
  $('#d-text').innerHTML = richText(q.question);
  $('#d-choices').replaceChildren(...(q.choices || []).map((c, i) => el('li', { html: `<b>${'WXYZ'[i]})</b> ${richText(c)}` })));
  const ans = q.choices && q.answerLetter ? `${q.answerLetter}) ${richText(q.answerText)}` : richText(q.answer);
  $('#d-ans').replaceChildren(el('p', { html: `<b>Answer:</b> ${ans}` }), q.accept ? el('p', { html: `Also accepted: ${richText(q.accept)}` }) : '');
  $('#d-judge').replaceChildren(...judgeButtons(q, false));
  if (document.activeElement !== $('#d-note')) $('#d-note').value = state.marks[q.id]?.note || '';
  $('#d-reroll').disabled = (pools.get(dlgKey) || []).length < 2;
  $('#d-link').href = `./${state.comp === 'osb' ? '?comp=osb' : ''}#questions?id=${encodeURIComponent(q.id)}`;
}
$('#d-note').addEventListener('change', e => {
  const q = byId.get(state.picks[state.comp][dlgKey]);
  if (q) setMark(q, undefined, e.target.value.trim());
});
$('#d-reroll').addEventListener('click', () => { $('#d-note').blur(); reroll([dlgKey]); drawDialog(); });
$('#d-close').addEventListener('click', () => $('#dlg').close());
$('#dlg').addEventListener('click', e => { if (e.target === $('#dlg')) $('#dlg').close(); });   // click on the backdrop
$('#dlg').addEventListener('close', () => { $('#d-note').dispatchEvent(new Event('change')); dlgKey = null; });

// ── Controls ──
for (const f of ['level', 'type', 'format']) {
  const s = $(`#f-${f}`);
  s.value = state.filters[f];
  s.addEventListener('change', () => { state.filters[f] = s.value; redraw(); });
}
$('#f-answers').checked = state.answers;
$('#f-answers').addEventListener('change', e => { state.answers = e.target.checked; persist(); for (const b of bins()) for (const s of subjects()) drawCell(cellKey(s, b)); });
$('#shuffle-all').addEventListener('click', () => reroll(bins().flatMap(b => subjects().map(s => cellKey(s, b)))));
$('#name').value = state.name;
$('#name').addEventListener('input', e => { state.name = e.target.value.trim(); persist(); });
if (!Object.keys(state.marks).length) $('#howto').open = true;

const fileName = prefix => `${prefix}-${(state.name || 'unnamed').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unnamed'}.json`;
function download(data, name) {
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); a.remove();
}
const exportData = () => ({ reviewer: state.name || 'unnamed', kind: 'difficulty-grid', at: new Date().toISOString(), marks: state.marks });
$('#download').addEventListener('click', () => {
  const n = Object.keys(state.marks).length;
  if (!n) { $('#export-status').textContent = 'Nothing marked yet.'; return; }
  const name = fileName('pts-difficulty-grid');
  download(exportData(), name);
  $('#export-status').textContent = `Downloaded ${name} (${n} questions). Send it to Toby.`;
});
$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(exportData())); $('#export-status').textContent = 'Copied. Paste it in a message to Toby.'; }
  catch { $('#export-status').textContent = "Couldn't copy here: use Download instead."; }
});

// Ratings made on the old one-at-a-time page, if this browser has any.
const old = store.get(OLD_KEY, null);
const oldN = old?.ratings ? Object.keys(old.ratings).length : 0;
if (oldN) {
  const box = $('#old-ratings');
  box.hidden = false;
  box.append(`You have ${oldN} rating${oldN === 1 ? '' : 's'} from the old rating page. `,
    el('a', { href: '#', onclick: e => { e.preventDefault(); download({ reviewer: old.name || state.name || 'unnamed', set: 1, at: new Date().toISOString(), ratings: old.ratings }, fileName('pts-difficulty')); } }, 'Download them'),
    ' and send them to Toby too.');
}

// ── Load the banks and the stored ratings ──
(async () => {
  try {
    const get = u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.text(); });
    const [diffCsv, ...csvs] = await Promise.all(['data/difficulty.csv', ...Object.values(COMPS).map(c => c.file)].map(get));
    const d = new Map(diffCsv.trim().split('\n').slice(1).map(l => l.split(',')).map(([id, x]) => [id, Number(x)]));
    Object.keys(COMPS).forEach((c, i) => {
      banks[c] = parseQuestions(csvs[i]).filter(q => Number.isFinite(d.get(q.id))).map(q => ({ ...q, d: d.get(q.id) }));
      for (const q of banks[c]) byId.set(q.id, q);
    });
    drawComp();
    redraw();
  } catch (err) {
    $('#load-status').textContent = `Couldn't load the questions (${err.message}). Reload the page to try again.`;
  }
})();
