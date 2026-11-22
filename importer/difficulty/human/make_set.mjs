// Builds importer/difficulty/human/set.json: the questions rate.html asks people to rate, the same for
// everyone. 12 per SB subject spread over the current ratings (one from each twelfth), 8 OSB, no visual
// bonuses or very long questions, and none the API rater sees as examples (anchors, easy and calculation
// examples, calibration checks), so the people's ratings are a fair test of it. Seeded: rerunning gives
// the same set as long as the banks don't change.
//   node importer/difficulty/human/make_set.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestions } from '../../../js/questions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const V2 = 'importer/difficulty/v2';
const skip = new Set(Object.values(JSON.parse(read(`${V2}/anchors.json`))).flat().map(a => a[0]));
const api = read(`${V2}/batch_api.mjs`);
for (const block of [api.match(/CALC_EXAMPLES = \[([^\]]+)\]/s)[1], api.match(/LOW_EXAMPLES = \[([\s\S]+?)\]\.filter/)[1]])
  for (const m of block.matchAll(/'([0-9a-z]+)'/g)) skip.add(m[1]);
for (const f of readdirSync(path.join(ROOT, V2, 'ratings')).filter(f => f.startsWith('cal-')))
  for (const line of read(`${V2}/ratings/${f}`).split('\n')) if (line.trim()) skip.add(line.split(/\s+/)[0]);
const current = new Map(read('data/difficulty.csv').trim().split('\n').slice(1).map(l => l.split(',')).map(([id, d]) => [id, +d]));

let seed = 20261122;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const ok = q => !skip.has(q.id) && !q.image && current.has(q.id) && q.question.length <= 650 && q.subject !== 'General Science';
const pick = (qs, n) => {
  const sorted = qs.filter(ok).sort((a, b) => current.get(a.id) - current.get(b.id));
  const out = [];
  for (let k = 0; k < n; k++) {
    const lo = Math.floor(k * sorted.length / n), hi = Math.floor((k + 1) * sorted.length / n);
    out.push(sorted[lo + Math.floor(rnd() * (hi - lo))]);
  }
  return out;
};
const sb = parseQuestions(read('data/questions.csv'));
const osb = parseQuestions(read('data/osb-questions.csv'));
const set = [];
for (const s of ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Earth and Space', 'Energy'])
  for (const q of pick(sb.filter(q => q.subject === s), 12)) set.push({ id: q.id, comp: 'sb' });
for (const q of pick(osb, 8)) set.push({ id: q.id, comp: 'osb' });
for (let i = set.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [set[i], set[j]] = [set[j], set[i]]; }
writeFileSync(path.join(ROOT, 'importer/difficulty/human/set.json'), `${JSON.stringify({ version: 1, made: '2026-11-22', questions: set }, null, 1)}\n`);
console.log(`${set.length} questions`);
