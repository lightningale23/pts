// rate.html: people rate a fixed set of questions (importer/difficulty/human/set.json) on the difficulty
// scale, to test the AI rater against (RUBRIC.md). Ratings stay in this browser (pts.rate.v1) until the
// person downloads them and sends the file to the owner. The site's own difficulty numbers are never
// shown here, so they can't sway anyone.
import { $, el, store } from './util.js';
import { parseQuestions } from './questions.js';
import { richText } from './text.js';

const KEY = 'pts.rate.v1';
const theme = store.get('lockout.theme', null);
if (theme) document.documentElement.dataset.theme = theme;

const saved = store.get(KEY, null) || {};
const state = { name: saved.name || '', ratings: saved.ratings || {}, pos: saved.pos || 0, subject: saved.subject || 'All', set: [], version: 1 };
const persist = () => {
  const ok = store.set(KEY, { name: state.name, ratings: state.ratings, pos: state.pos, subject: state.subject });
  $('#saved-note').textContent = ok ? 'Saved in this browser as you go.' : "This browser can't save: download your ratings before you leave.";
};

// Share of teams for a number: f = 10^(-d/5).
const share = d => 100 * Math.pow(10, -d / 5);
function shareText(d) {
  const p = share(d);
  const pctText = p >= 10 ? `${Math.round(p)}%` : p >= 1 ? `${p.toFixed(1)}%` : `${p.toFixed(2)}%`;
  const oneIn = p >= 50 ? '' : ` (about 1 team in ${Math.round(100 / p)})`;
  return `<b>${Number(d.toFixed(2))}</b>: about <b>${pctText}</b> of teams${oneIn}`;
}

const TYPE = q => (q.type === 'bonus' ? 'Bonus' : 'Toss-up');
// Subjects as the tabs show them (OSB questions are one tab whatever their own subject).
const SUBJECTS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Earth and Space', 'Energy', 'Ocean Science Bowl'];
const subjectOf = q => (q.comp === 'osb' ? 'Ocean Science Bowl' : q.subject);
// Indexes (into state.set) of the questions in the chosen subject, in set order.
const visible = () => state.set.map((q, i) => i).filter(i => state.subject === 'All' || subjectOf(state.set[i]) === state.subject);

function drawSubjects() {
  const box = $('#subjects');
  const tabs = ['All', ...SUBJECTS.filter(s => state.set.some(q => subjectOf(q) === s))];
  box.replaceChildren(...tabs.map(s => {
    const qs = state.set.filter(q => s === 'All' || subjectOf(q) === s);
    const n = qs.filter(q => done(state.ratings[q.id])).length;
    return el('button', { type: 'button', 'aria-pressed': String(s === state.subject), onclick: () => pickSubject(s) },
      s === 'Earth and Space' ? 'Earth & Space' : s, el('span', { class: 'count' }, `${n}/${qs.length}`));
  }));
}
function pickSubject(s) {
  state.subject = s;
  const vis = visible();
  // The first question in it not done yet, else its first.
  const first = vis.find(i => !done(state.ratings[state.set[i].id]));
  state.pos = first ?? vis[0] ?? 0;
  persist();
  show();
}
const done = r => r && (typeof r.d === 'number' || r.skip);

function drawDots() {
  const vis = visible();
  $('#dots').replaceChildren(...vis.map((i, k) => {
    const r = state.ratings[state.set[i].id];
    const b = el('button', { type: 'button', 'aria-label': `Question ${k + 1}`, onclick: () => go(i) }, String(k + 1));
    b.classList.toggle('done', Boolean(r && typeof r.d === 'number'));
    b.classList.toggle('skipped', Boolean(r && r.skip));
    b.classList.toggle('here', i === state.pos);
    b.title = r && typeof r.d === 'number' ? `rated ${r.d}` : r && r.skip ? "can't judge" : 'not rated yet';
    return b;
  }));
  drawSubjects();
  const inView = vis.filter(i => done(state.ratings[state.set[i].id])).length;
  const n = state.set.filter(q => done(state.ratings[q.id])).length;
  $('#progress-text').textContent = state.subject === 'All' ? `${n} of ${state.set.length} done`
    : `${state.subject}: ${inView} of ${vis.length} done (${n} of ${state.set.length} in all)`;
  $('#progress-bar').style.width = `${(100 * inView) / Math.max(1, vis.length)}%`;
  $('#done-msg').textContent = n === state.set.length ? 'All done, thank you! Download your ratings below.' : `${state.set.length - n} to go.`;
}

function setValue(d) {
  if (typeof d !== 'number' || Number.isNaN(d)) {
    $('#num').value = '';
    $('#slider').classList.add('unset');   // faded until touched, so its resting place doesn't suggest a number
    $('#readout').innerHTML = 'Move the slider or type a number.';
    return;
  }
  $('#slider').classList.remove('unset');
  $('#slider').value = String(Math.min(12, d));
  $('#num').value = String(Math.round(d * 100) / 100);
  $('#readout').innerHTML = shareText(d);
}

function show() {
  const q = state.set[state.pos];
  if (!q) return;
  $('#qcard').hidden = false;
  const vis = visible();
  $('#qmeta').textContent = `Question ${vis.indexOf(state.pos) + 1} of ${vis.length} · ${q.comp === 'osb' ? 'Ocean Science Bowl · ' : ''}${q.subject} · ${TYPE(q)} · ${q.format === 'mc' ? 'Multiple choice' : 'Short answer'}${q.level === 'MS' ? ' · Middle school' : ''}`;
  $('#qtext').innerHTML = richText(q.question);
  $('#qchoices').replaceChildren(...(q.choices || []).map((c, i) => el('li', { html: `<b>${'WXYZ'[i]})</b> ${richText(c)}` })));
  const ans = q.choices && q.answerLetter ? `${q.answerLetter}) ${richText(q.answerText)}` : richText(q.answer);
  $('#qans').replaceChildren(
    el('p', { html: `<b>Answer:</b> ${ans}` }),
    q.accept ? el('p', { html: `Also accepted: ${richText(q.accept)}` }) : '',
  );
  const r = state.ratings[q.id];
  $('#qans').hidden = !r;   // answered before: show the answer again
  $('#show-ans').textContent = $('#qans').hidden ? 'Show answer' : 'Hide answer';
  $('#note').value = r?.note || '';
  setValue(r && typeof r.d === 'number' ? r.d : NaN);
  $('#qstatus').textContent = r?.skip ? "Marked can't judge." : r ? 'Rated. Change it if you like.' : '';
  drawDots();
}

// Moves to set index i (from the dots), or by a step within the subject (step: -1 / +1).
function step(d) {
  const vis = visible(), k = vis.indexOf(state.pos);
  go(vis[Math.max(0, Math.min(vis.length - 1, (k < 0 ? 0 : k) + d))]);
}
function go(i) {
  state.pos = Math.max(0, Math.min(state.set.length - 1, i));
  persist();
  show();
  $('#qcard').scrollIntoView({ block: 'nearest' });
}

function save({ skip = false } = {}) {
  const q = state.set[state.pos];
  const d = parseFloat($('#num').value);
  if (!skip && (Number.isNaN(d) || d < 0)) { $('#qstatus').textContent = 'Pick a number first (or press Can\'t judge).'; return false; }
  state.ratings[q.id] = skip ? { skip: true, note: $('#note').value.trim(), at: new Date().toISOString() }
    : { d: Math.round(d * 100) / 100, note: $('#note').value.trim(), at: new Date().toISOString() };
  persist();
  // On to the next question not done yet (or simply the next one).
  const vis = visible();
  const next = vis.find(i => i > state.pos && !done(state.ratings[state.set[i].id])) ?? vis.find(i => !done(state.ratings[state.set[i].id]));
  if (next !== undefined) go(next); else { show(); $('#qstatus').textContent = state.subject === 'All' ? 'All done, thank you!' : `All ${state.subject} questions done. Pick another subject or download your ratings.`; }
  return true;
}

function exportData() {
  return {
    reviewer: state.name || 'unnamed', set: state.version, at: new Date().toISOString(),
    ratings: Object.fromEntries(state.set.filter(q => state.ratings[q.id]).map(q => [q.id, state.ratings[q.id]])),
  };
}

// ── Wiring ──
$('#name').value = state.name;
$('#name').addEventListener('input', e => { state.name = e.target.value.trim(); persist(); });
if (!Object.keys(state.ratings).length) $('#howto').open = true;
$('#slider').addEventListener('input', e => setValue(+e.target.value));
$('#num').addEventListener('input', e => {
  const d = parseFloat(e.target.value);
  if (!Number.isNaN(d)) { $('#slider').value = String(Math.min(12, d)); $('#slider').classList.remove('unset'); $('#readout').innerHTML = shareText(d); }
});
$('#num').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
$('#show-ans').addEventListener('click', () => {
  $('#qans').hidden = !$('#qans').hidden;
  $('#show-ans').textContent = $('#qans').hidden ? 'Show answer' : 'Hide answer';
});
$('#prev').addEventListener('click', () => step(-1));
$('#next').addEventListener('click', () => step(1));
$('#save').addEventListener('click', () => save());
$('#skip').addEventListener('click', () => save({ skip: true }));
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range';
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'a' || e.key === 'A') $('#show-ans').click();
  else if (e.key === 'Enter') { e.preventDefault(); save(); }
  else if (/^[0-9.]$/.test(e.key)) { $('#num').focus(); }
});

$('#download').addEventListener('click', () => {
  const data = exportData();
  if (!Object.keys(data.ratings).length) { $('#export-status').textContent = 'Nothing rated yet.'; return; }
  const name = (state.name || 'unnamed').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unnamed';
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })), download: `pts-difficulty-${name}.json` });
  document.body.append(a); a.click(); a.remove();
  $('#export-status').textContent = `Downloaded pts-difficulty-${name}.json (${Object.keys(data.ratings).length} questions). Send it to Toby.`;
});
$('#copy').addEventListener('click', async () => {
  const data = exportData();
  try { await navigator.clipboard.writeText(JSON.stringify(data)); $('#export-status').textContent = 'Copied. Paste it in a message to Toby.'; }
  catch { $('#export-status').textContent = "Couldn't copy here: use Download instead."; }
});

// ── Load the set and the banks ──
(async () => {
  try {
    const [setRes, sbRes, osbRes] = await Promise.all(['importer/difficulty/human/set.json', 'data/questions.csv', 'data/osb-questions.csv']
      .map(u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return u.endsWith('.json') ? r.json() : r.text(); })));
    const byId = new Map([...parseQuestions(sbRes).map(q => [q.id, { ...q, comp: 'sb' }]), ...parseQuestions(osbRes).map(q => [q.id, { ...q, comp: 'osb' }])]);
    state.version = setRes.version;
    state.set = setRes.questions.map(x => byId.get(x.id)).filter(Boolean);
    if (!state.set.length) throw new Error('none of the questions were found in the banks');
    state.pos = Math.min(state.pos, state.set.length - 1);
    if (state.subject !== 'All' && !state.set.some(q => subjectOf(q) === state.subject)) state.subject = 'All';
    if (!visible().includes(state.pos)) state.pos = visible()[0] ?? 0;
    show();
  } catch (err) {
    $('#progress-text').textContent = `Couldn't load the questions (${err.message}). Reload the page to try again.`;
  }
})();
