import { el, store, pct, timeAgo } from './util.js';
import { SUBJECT_ORDER } from './questions.js';

const KEY = 'lockout.stats.v1';
const MAX = 8000;

// Results are stored in this browser only (localStorage).
// result: correct | incorrect | neg (wrong answer after buzzing early) | dead (nobody buzzed) | skipped | none (room: someone else answered)
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
    tuWrong: tu.filter(r => r.result === 'incorrect').length,
    tuPoints: tu.reduce((a, r) => a + (r.points || 0), 0),
    buzzes: fracs.length,
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
  const figure = (value, label, sub) => el('div', { class: 'figure' }, el('b', {}, value), el('span', {}, label),
    sub ? el('small', {}, sub) : null);
  const per = (n, d) => (d ? (n / d).toFixed(1) : '—');
  const figures = el('div', { class: 'figures' },
    figure(all.points, 'points', `${per(all.tuPoints, all.heard)} per toss-up heard`),
    figure(`${pct(all.tuCorrect, all.heard)}%`, 'toss-up conversion', `${all.tuCorrect} of ${all.heard} heard`),
    figure(`${pct(all.tuCorrect, all.tuAttempted)}%`, 'accuracy when you buzz', `${all.tuCorrect} of ${all.tuAttempted} buzzes`),
    figure(all.avgBuzz == null ? '—' : `${Math.round(all.avgBuzz * 100)}%`, 'average buzz point', 'of the question read, on correct buzzes'),
    figure(all.negs, 'negs', all.tuAttempted ? `${pct(all.negs, all.tuAttempted)}% of buzzes` : ''),
    figure(all.bonus ? `${pct(all.bonusCorrect, all.bonus)}%` : '—', 'bonus conversion', `${all.bonusCorrect} of ${all.bonus}`));

  // Toss-up attempts: correct, wrong after the question was read, and negs.
  const parts = [['correct', 'Correct', all.tuCorrect], ['incorrect', 'Wrong', all.tuWrong], ['neg', 'Negs', all.negs]];
  const attempts = all.tuAttempted ? el('section', { class: 'stat-card' },
    el('div', { class: 'stat-card-head' }, el('h2', {}, 'Toss-up attempts'), el('span', {}, `${all.tuAttempted} buzzes`)),
    el('div', { class: 'stack-bar', role: 'img', 'aria-label': parts.map(([, l, n]) => `${l} ${n}`).join(', ') },
      parts.filter(([, , n]) => n).map(([k, l, n]) => el('i', { class: k, style: `flex:${n}`, title: `${l}: ${n} (${pct(n, all.tuAttempted)}%)` }))),
    el('div', { class: 'stack-legend' }, parts.map(([k, l, n]) => el('span', {}, el('i', { class: k }), `${l} `, el('b', {}, n),
      el('small', {}, ` ${pct(n, all.tuAttempted)}%`)))),
    el('p', { class: 'stat-note' }, 'Wrong: answered after the question was read. Negs: wrong after buzzing early, which costs points.')) : null;

  const bySubject = new Map();
  for (const r of recs) { if (!bySubject.has(r.subject)) bySubject.set(r.subject, []); bySubject.get(r.subject).push(r); }
  const subjects = [...bySubject.keys()].sort((a, b) => {
    const ia = SUBJECT_ORDER.indexOf(a), ib = SUBJECT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const table = el('div', { class: 'table-scroll' }, el('table', { class: 'subject-table' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Subject'), el('th', { class: 'num' }, 'Heard'), el('th', { class: 'num' }, 'Correct'),
      el('th', { class: 'num' }, 'Negs'), el('th', {}, 'Accuracy when buzzing'), el('th', { class: 'num', title: 'Toss-up points per toss-up heard' }, 'Pts/TU'),
      el('th', { class: 'num' }, 'Avg buzz'), el('th', { class: 'num' }, 'Bonus'))),
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
        el('td', { class: 'num' }, per(s.tuPoints, s.heard)),
        el('td', { class: 'num' }, s.avgBuzz == null ? '—' : `${Math.round(s.avgBuzz * 100)}%`),
        el('td', { class: 'num' }, s.bonus ? `${s.bonusCorrect}/${s.bonus}` : '—'));
    }))));

  // Where in the question correct buzzes come, per subject (earlier is better).
  const buzzRows = subjects.map(name => ({ name, s: summarize(bySubject.get(name)) })).filter(x => x.s.avgBuzz != null);
  const buzzCard = buzzRows.length ? el('section', { class: 'stat-card' },
    el('div', { class: 'stat-card-head' }, el('h2', {}, 'Buzz point by subject'), el('span', {}, 'share of the question read on correct buzzes · earlier is better')),
    el('div', { class: 'buzz-rows' }, buzzRows.map(({ name, s }) => {
      const v = Math.round(s.avgBuzz * 100);
      return el('div', { class: 'buzz-row', style: `--c:${subjVar(name)}` },
        el('span', { class: 'buzz-name' }, el('span', { class: 'subject-dot' }), name),
        el('div', { class: 'bar buzz-bar' }, el('i', { style: `width:${v}%` }),
          all.avgBuzz != null ? el('b', { class: 'avg-mark', style: `left:${Math.round(all.avgBuzz * 100)}%`, title: `Your average: ${Math.round(all.avgBuzz * 100)}%` }) : null),
        el('span', { class: 'buzz-val' }, `${v}%`, el('small', {}, ` (${s.buzzes})`)));
    })),
    el('p', { class: 'stat-note' }, 'The line marks your average across all subjects. Numbers in parentheses are correct buzzes.')) : null;

  const label = { correct: 'Correct', incorrect: 'Wrong', neg: 'Neg', dead: 'Not buzzed', skipped: 'Skipped', none: 'Someone else' };
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
    attempts,
    el('h2', { style: 'margin-bottom:8px' }, 'By subject'),
    table,
    buzzCard,
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
