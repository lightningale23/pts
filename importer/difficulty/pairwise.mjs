// Pairwise comparisons against the hand-rated questions ("anchors"). A judge model is shown a
// question and an anchor and says which is harder; each pair is asked both ways round (A/B and
// B/A) so a preference for the first or second slot cancels. pairwise_fit.py turns the answers
// into a rating on the rubric's scale (an anchor rated 6 that the question "beats" half the time
// puts it near 6). Those ratings become extra training labels for fit.py.
//
// Anchors are picked around the question's current rating (js/difficulty.js), from its subject
// when there are enough, so each comparison is a close one (close calls carry the most information).
//
//   node importer/difficulty/pairwise.mjs --validate 80      # first: how good is the judge?
//   node importer/difficulty/pairwise.mjs --sample 2000      # then: rate 2,000 more questions
//        [--judge gemma3:12b] [--anchors 6] [--ids FILE] [--bank sb|osb|all] [--parallel 4] [--host URL]
//
// --validate N takes N anchors as the questions to rate (compared with the other anchors only),
// so pairwise_fit.py can check its ratings against the hand ratings before anything is trusted.
// Results: importer/difficulty/runs/pairwise-<judge>.jsonl, one line per comparison:
//   { t: question id, a: anchor id, ar: anchor rating, tf: 1 if the question was shown first,
//     win: 1 if the question was judged harder, v: 1 for validation }
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { rateDifficulty, englishRanks } from '../../js/difficulty.js';
import english from '../../js/english-words.js';
import { RUNS, args, loadBanks, handRatings, ollama, pool, progressLine, jsonl, judgeMessages, judgeChoice, rng, shuffle } from './llm.mjs';

const o = args();
const judge = o.judge || 'gemma3:12b';
const K = Math.max(2, +(o.anchors || 6));
const parallel = Math.max(1, +(o.parallel || 4));
const api = ollama(o.host);

// Current ratings (the same numbers the site shows), per bank as the site rates them.
const all = loadBanks(o.bank || 'all');
const ranks = englishRanks(english);
for (const comp of ['sb', 'osb']) rateDifficulty(all.filter(q => q.comp === comp), ranks);
const byId = new Map(all.map(q => [q.id, q]));

const anchors = handRatings().map(h => ({ ...h, q: byId.get(h.id) })).filter(a => a.q);
const anchorIds = new Set(anchors.map(a => a.id));
const rand = rng(11);

let targets, validation = false;
if (o.validate) {
  validation = true;
  targets = shuffle(anchors, rand).slice(0, +o.validate).map(a => a.q);
} else if (o.ids) {
  const want = readFileSync(o.ids, 'utf8').split(/[\s,]+/).filter(Boolean);
  targets = want.map(id => byId.get(id)).filter(Boolean);
} else if (o.sample) {
  targets = shuffle(all.filter(q => !anchorIds.has(q.id)), rng(23)).slice(0, +o.sample);
} else {
  console.error('Say what to rate: --validate N, --sample N or --ids FILE.');
  process.exit(1);
}

// K anchors near the question's current rating: one nearest each of a spread of offsets.
const OFFSETS = [-3, -1.5, -0.5, 0.5, 1.5, 3, -2.25, 2.25, -1, 1, 0];
function pickAnchors(q) {
  const pool_ = anchors.filter(a => a.id !== q.id);
  const same = pool_.filter(a => a.q.subject === q.subject);
  const from = same.length >= 15 ? same : pool_;
  const e = typeof q.difficulty === 'number' ? q.difficulty : 4;
  const used = new Set(), out = [];
  for (const off of OFFSETS) {
    if (out.length >= K) break;
    let best = null;
    for (const a of from) if (!used.has(a.id) && (!best || Math.abs(a.rating - (e + off)) < Math.abs(best.rating - (e + off)))) best = a;
    if (best) { used.add(best.id); out.push(best); }
  }
  return out;
}

let thinking = false;
try { thinking = (await api.info(judge)).thinking; }
catch (err) { console.error(`${judge}: not available (${err.message}). Pull it with: ollama pull ${judge}`); process.exit(1); }

const out = jsonl(path.join(RUNS, `pairwise-${judge.replace(/[^\w.-]+/g, '_')}.jsonl`));
const done = new Set(out.rows.map(r => `${r.t}|${r.a}|${r.tf}`));
const jobs = [];
for (const q of targets) for (const a of pickAnchors(q)) for (const tf of [1, 0]) if (!done.has(`${q.id}|${a.id}|${tf}`)) jobs.push({ q, a, tf });
console.error(`${judge}: ${targets.length} questions${validation ? ' (validation)' : ''}, ${jobs.length} comparisons to make`);
let unclear = 0;
await pool(jobs, parallel, async ({ q, a, tf }) => {
  const [first, second] = tf ? [q, a.q] : [a.q, q];
  let reply;
  try { reply = await api.chat(judge, judgeMessages(first, second), { maxTokens: thinking ? 16 : 8, thinking }); }
  catch (err) { console.error(`\n${q.id} vs ${a.id}: ${err.message}`); return; }
  const pick = judgeChoice(reply);
  if (!pick) { unclear++; return; }
  const win = (pick === 'A') === Boolean(tf) ? 1 : 0;
  out.add({ t: q.id, a: a.id, ar: a.rating, tf, win, v: validation ? 1 : 0 });
}, progressLine(judge, jobs.length));
if (unclear) console.error(`${unclear} replies weren't A or B (left out; a rerun asks again).`);
console.error('Done. Next: python3 importer/difficulty/pairwise_fit.py');
