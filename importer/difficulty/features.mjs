// Writes the features of every rated question (and the whole bank's feature means) for fit.py.
// node importer/difficulty/features.mjs > /tmp/features.json        (labels: data/difficulty.csv)
// node importer/difficulty/features.mjs --hand > /tmp/features.json (labels: the 444 old hand ratings)
// With data/ai-difficulty.csv (ladder_fit.py) the `ai` feature is filled in; with
// importer/difficulty/pairwise-ratings.txt (pairwise_fit.py) its questions are added as extra
// labels at weight PAIR_WEIGHT (default 0.3; a hand rating counts 1).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseQuestions } from '../../js/questions.js';
import { assignStages } from '../../js/rounds.js';
import { bankFeatures, englishRanks, FEATURES, parseAiCsv } from '../../js/difficulty.js';
import english from '../../js/english-words.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const ranks = englishRanks(english);
const has = f => existsSync(path.join(ROOT, f));
const ai = has('data/ai-difficulty.csv') ? parseAiCsv(read('data/ai-difficulty.csv')) : null;
const banks = {
  sb: [...parseQuestions(read('data/questions.csv')), ...parseQuestions(read('data/visual-bonuses.csv'))].filter(q => q.subject !== 'General Science'),
  osb: parseQuestions(read('data/osb-questions.csv')),
};
const feats = new Map(), bankRows = {};
for (const [k, qs] of Object.entries(banks)) {
  assignStages(qs);
  const f = bankFeatures(qs, ranks, ai);
  for (const [id, v] of f) feats.set(id, v);
  bankRows[k] = [...f.values()].map(v => FEATURES.map(n => v[n]));
}
// Labels: the stored ratings (difficulty v2, every question), or with --hand the old 444 hand ratings.
let labels;
if (process.argv.includes('--hand')) {
  const ids = JSON.parse(read('importer/difficulty/sample-ids.json'));
  labels = read('importer/difficulty/ratings.txt').trim().split('\n').map(l => l.split(/\s+/).map(Number)).map(([i, r]) => [ids[i], r]);
} else {
  labels = [...parseAiCsv(read('data/difficulty.csv'))];
}
const rows = labels.filter(([id]) => feats.has(id)).map(([id, r]) => ({ id, rating: r, x: FEATURES.map(n => feats.get(id)[n]) }));
const ids = rows.map(r => r.id);
const weight = +(process.env.PAIR_WEIGHT || 0.3);
const hand = new Set(ids);
const extra = !has('importer/difficulty/pairwise-ratings.txt') ? [] : read('importer/difficulty/pairwise-ratings.txt').trim().split('\n')
  .map(l => l.trim().split(/\s+/)).filter(([id]) => id && feats.has(id) && !hand.has(id))
  .map(([id, r]) => ({ id, rating: +r, weight, x: FEATURES.map(n => feats.get(id)[n]) }));
process.stdout.write(JSON.stringify({ features: FEATURES, rows, extra, ai: Boolean(ai && ai.size), bank: bankRows }));
