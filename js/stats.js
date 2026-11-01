import { el, store, pct, timeAgo } from './util.js';
import { SUBJECT_ORDER } from './questions.js';

const KEY = 'lockout.stats.v1';
const MAX = 8000;

// Results are stored in this browser only (localStorage).
// result: correct | incorrect | neg (wrong interrupt) | dead (nobody buzzed) | skipped | none (room: someone else answered)
export const Stats = {
  all() { return store.get(KEY, []); },
  save(list) {
    if (list.length > MAX) list = list.slice(-MAX);
    store.set(KEY, list);
  },
  add(rec) {
    const list = this.all();
    rec.rid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    rec.ts = Date.now();
    list.push(rec);
    this.save(list);
    return rec.rid;
  },
  update(rid, patch) {
    const list = this.all();
    const r = list.find(x => x.rid === rid);
    if (r) { Object.assign(r, patch); this.save(list); }
  },
  clear() { store.remove(KEY); },

  // Latest outcome per question decides whether it's still "missed".
  missedIds() {
    const last = new Map();
    for (const r of this.all()) if (r.result !== 'skipped' && r.result !== 'none') last.set(r.qid, r.result);
    return new Set([...last].filter(([, res]) => res !== 'correct').map(([id]) => id));
  },
  seenIds() { return new Set(this.all().map(r => r.qid)); },
};

const subjVar = s => ({
  Biology: 'var(--bio)', Chemistry: 'var(--chem)', Physics: 'var(--phys)', Mathematics: 'var(--math)',
  'Earth and Space': 'var(--es)', Astronomy: 'var(--es)', Energy: 'var(--energy)',
  Geology: 'var(--es)', 'Physical Oceanography': 'var(--phys)', Technology: 'var(--math)',
  'Social Sciences': 'var(--energy)', Geography: 'var(--geo)',
}[s] || 'var(--other)');

function summarize(recs) {
  const tu = recs.filter(r => r.type === 'tossup' && r.result !== 'skipped' && r.result !== 'none');
  const tuCorrect = tu.filter(r => r.result === 'correct');
  const tuAttempted = tu.filter(r => ['correct', 'incorrect', 'neg'].includes(r.result));
  const negs = tu.filter(r => r.result === 'neg');
  const bonus = recs.filter(r => r.type === 'bonus' && r.result !== 'skipped' && r.result !== 'none');
  const bonusCorrect = bonus.filter(r => r.result === 'correct');
  const fracs = tuCorrect.map(r => r.frac).filter(f => typeof f === 'number');
  return {
    heard: tu.length, tuCorrect: tuCorrect.length, tuAttempted: tuAttempted.length, negs: negs.length,
    bonus: bonus.length, bonusCorrect: bonusCorrect.length,
    points: recs.reduce((a, r) => a + (r.points || 0), 0),
    avgBuzz: fracs.length ? fracs.reduce((a, b) => a + b, 0) / fracs.length : null,
  };
}

// "Texas 2025, RR1, #16" (results saved before rounds were recorded look the question up).
function sourceOf(r, lookup) {
  const q = (!r.round || !r.num) && lookup ? lookup(r.qid) : null;
  const set = r.set || q?.set, round = r.round || q?.round, num = r.num || q?.num;
  return [set, round ? (/^\d+$/.test(round) ? `Round ${round}` : round) : '', num ? `#${num}` : ''].filter(Boolean).join(', ');
}

export function renderStats(root, { onPracticeMissed, onReset, missedCount, comp = 'sb', compName = '', lookup = null }) {
  // Results from the other competition (Science Bowl / Ocean Science Bowl) are kept but not shown here.
  const recs = Stats.all().filter(r => (r.comp || 'sb') === comp);
  const actions = el('div', { class: 'actions' },
    el('button', { class: 'btn primary', type: 'button', disabled: !missedCount, onclick: onPracticeMissed },
      `Practice missed questions (${missedCount})`),
    el('button', { class: 'btn', type: 'button', disabled: !recs.length, onclick: () => exportCsv(recs) }, 'Export CSV'),
    el('button', { class: 'btn', type: 'button', disabled: !recs.length, onclick: onReset }, 'Reset stats'));

  if (!recs.length) {
    root.replaceChildren(
      el('div', { class: 'stats-top' }, el('h1', {}, compName ? `Stats: ${compName}` : 'Stats'), actions),
      el('div', { class: 'stats-empty' },
        el('p', {}, 'Your results show up here after you answer a few questions.'),
        el('a', { class: 'btn primary', href: '#practice' }, 'Start practicing')));
    return;
  }

  const all = summarize(recs);
  const figure = (value, label) => el('div', { class: 'figure' }, el('b', {}, value), el('span', {}, label));
  const figures = el('div', { class: 'figures' },
    figure(all.heard, 'toss-ups heard'),
    figure(`${pct(all.tuCorrect, all.tuAttempted)}%`, `toss-up accuracy when you buzz (${all.tuCorrect}/${all.tuAttempted})`),
    figure(`${pct(all.tuCorrect, all.heard)}%`, 'of toss-ups heard answered correctly'),
    figure(all.avgBuzz == null ? '—' : `${Math.round(all.avgBuzz * 100)}%`, 'average point in the question when you buzzed correctly'),
    figure(all.negs, 'wrong interrupts'),
    figure(all.bonus ? `${pct(all.bonusCorrect, all.bonus)}%` : '—', `bonus conversion (${all.bonusCorrect}/${all.bonus})`));

  const bySubject = new Map();
  for (const r of recs) { if (!bySubject.has(r.subject)) bySubject.set(r.subject, []); bySubject.get(r.subject).push(r); }
  const subjects = [...bySubject.keys()].sort((a, b) => {
    const ia = SUBJECT_ORDER.indexOf(a), ib = SUBJECT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const table = el('div', { class: 'table-scroll' }, el('table', { class: 'subject-table' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Subject'), el('th', { class: 'num' }, 'Heard'), el('th', { class: 'num' }, 'Correct'),
      el('th', { class: 'num' }, 'Interrupts wrong'), el('th', {}, 'Accuracy when buzzing'), el('th', { class: 'num' }, 'Avg buzz'),
      el('th', { class: 'num' }, 'Bonus'))),
    el('tbody', {}, subjects.map(name => {
      const s = summarize(bySubject.get(name));
      const acc = pct(s.tuCorrect, s.tuAttempted);
      return el('tr', { style: `--c:${subjVar(name)}` },
        el('td', {}, el('span', { class: 'subject-dot' }), name),
        el('td', { class: 'num' }, s.heard),
        el('td', { class: 'num' }, s.tuCorrect),
        el('td', { class: 'num' }, s.negs),
        el('td', {}, el('div', { style: 'display:flex; gap:8px; align-items:center' },
          el('div', { class: 'bar', style: 'flex:1' }, el('i', { style: `width:${acc}%` })), `${acc}%`)),
        el('td', { class: 'num' }, s.avgBuzz == null ? '—' : `${Math.round(s.avgBuzz * 100)}%`),
        el('td', { class: 'num' }, s.bonus ? `${s.bonusCorrect}/${s.bonus}` : '—'));
    }))));

  const label = { correct: 'Correct', incorrect: 'Wrong', neg: 'Wrong (interrupt)', dead: 'Not buzzed', skipped: 'Skipped', none: 'Someone else' };
  const recent = el('ol', { class: 'history-list' }, recs.slice(-40).reverse().map(r => { const src = sourceOf(r, lookup); return el('li', {},
    el('details', {}, el('summary', {},
      el('span', { class: `res ${r.result}` }),
      el('span', { class: 'sum' }, el('b', {}, r.subject), src ? el('span', { class: 'src' }, src) : null, el('span', { class: 'qt' }, r.qtext ? r.qtext.slice(0, 120) : r.qid)),
      el('span', { class: 'pts' }, `${label[r.result] || r.result} · ${timeAgo(r.ts)}`)),
    el('div', { class: 'body' },
      r.given ? el('p', {}, 'You said: ', el('span', { class: 'ans' }, r.given)) : null,
      r.answer ? el('p', {}, 'Answer: ', el('span', { class: 'ans' }, r.answer)) : null,
      el('p', { class: 'meta' }, [src, r.type === 'bonus' ? 'Bonus' : 'Toss-up', r.mode === 'room' ? 'room' : 'solo'].filter(Boolean).join(', '))))); }));

  root.replaceChildren(
    el('div', { class: 'stats-top' }, el('h1', {}, compName ? `Stats: ${compName}` : 'Stats'), el('p', { class: 'lede', style: 'margin:0' }, `${all.points} points across ${recs.length} questions, saved in this browser.`), actions),
    figures,
    el('h2', { style: 'margin-bottom:8px' }, 'By subject'),
    table,
    el('h2', { style: 'margin-bottom:8px' }, 'Recent questions'),
    recent);
}

function exportCsv(recs) {
  const cols = ['ts', 'qid', 'subject', 'type', 'set', 'round', 'num', 'result', 'points', 'frac', 'given', 'answer', 'mode'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...recs.map(r => cols.map(c => esc(c === 'ts' ? new Date(r.ts).toISOString() : r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'science-bowl-stats.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
