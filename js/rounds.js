// Sorts each tournament's rounds into stages: round robin, early / mid / late
// double elimination, or other.
//
// Labeled rounds are exact: RR/Prelim/Seeding/Swiss are round robin; DE, Playoff,
// SE (single elimination) and Wildcard rounds are elimination rounds, split into
// thirds in order; anything called Final(s)/Semifinal/Quarterfinal/Championship is always late DE.
// Tournaments that only number their rounds ("Round 1" ... "Round 16") are an
// estimate: the first few (5 by default, set per tournament in config.js) count
// as round robin and the rest as elimination.

export const STAGES = [
  ['rr', 'RR'],
  ['early', 'Early DE'],
  ['mid', 'Mid DE'],
  ['late', 'Late DE'],
  ['other', 'Other'],
];
export const STAGE_LABEL = Object.fromEntries(STAGES);

export function classifyRound(label) {
  const l = String(label || '').toLowerCase().trim();
  const num = +(l.match(/\d+/)?.[0] ?? 0);
  if (!l) return { kind: 'other', n: 0 };
  if (/^(rr|round[\s-]*robin|prelim\w*|seeding|pool|swiss)\b|^rr\d/.test(l)) return { kind: 'rr', n: num };
  if (/\b(finals?|championship|tiebreak\w*|(quarter|semi)[\s-]*finals?)\b|^finals?\d/.test(l)) return { kind: 'final', n: num };
  if (/^wild\s*card/.test(l)) return { kind: 'elim', n: num, early: true };
  if (/^(de|double[\s-]*elim\w*|playoffs?|elim\w*|se|single[\s-]*elim\w*|bracket|knockout|ko)\s*\d|^(de|se)\d/.test(l)) {
    return { kind: 'elim', n: num };
  }
  if (/^(round\s*)?\d+\b/.test(l) && !/replace|tiebreak|extra|backup|spare/.test(l)) return { kind: 'numbered', n: num };
  return { kind: 'other', n: num };
}

// Adds q.stage to every question. overrides: { 'MIT 2025': { rr: 6 } }
export function assignStages(questions, overrides = {}, defaultRR = 5) {
  const bySet = new Map();
  for (const q of questions) {
    if (!bySet.has(q.set)) bySet.set(q.set, new Map());
    bySet.get(q.set).set(q.round, null);
  }
  for (const [set, rounds] of bySet) {
    const rrCount = overrides[set]?.rr ?? defaultRR;
    const elims = [];
    const finals = [];
    for (const label of rounds.keys()) {
      const c = classifyRound(label);
      if (c.kind === 'numbered') {
        if (c.n <= rrCount) rounds.set(label, 'rr');
        else elims.push({ label, order: c.n });
      } else if (c.kind === 'elim') elims.push({ label, order: c.early ? -1000 + c.n : c.n });
      else if (c.kind === 'final') finals.push(label);
      else rounds.set(label, c.kind === 'rr' ? 'rr' : 'other');
    }
    // Split elimination rounds into thirds, in order.
    elims.sort((a, b) => a.order - b.order);
    const m = elims.length;
    const early = Math.ceil(m / 3);
    const mid = Math.ceil((m - early) / 2);
    elims.forEach((e, i) => rounds.set(e.label, i < early ? 'early' : i < early + mid ? 'mid' : 'late'));
    for (const f of finals) rounds.set(f, 'late');
  }
  for (const q of questions) q.stage = bySet.get(q.set)?.get(q.round) || 'other';
  return questions;
}
