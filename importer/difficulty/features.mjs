// Writes the features of every rated question (and the whole bank's feature means) for fit.py.
// node importer/difficulty/features.mjs > /tmp/features.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseQuestions } from '../../js/questions.js';
import { assignStages } from '../../js/rounds.js';
import { bankFeatures, englishRanks, FEATURES } from '../../js/difficulty.js';
import english from '../../js/english-words.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const ranks = englishRanks(english);
const banks = {
  sb: [...parseQuestions(read('data/questions.csv')), ...parseQuestions(read('data/visual-bonuses.csv'))].filter(q => q.subject !== 'General Science'),
  osb: parseQuestions(read('data/osb-questions.csv')),
};
const feats = new Map(), bankRows = {};
for (const [k, qs] of Object.entries(banks)) {
  assignStages(qs);
  const f = bankFeatures(qs, ranks);
  for (const [id, v] of f) feats.set(id, v);
  bankRows[k] = [...f.values()].map(v => FEATURES.map(n => v[n]));
}
const ids = JSON.parse(read('importer/difficulty/sample-ids.json'));
const ratings = read('importer/difficulty/ratings.txt').trim().split('\n').map(l => l.split(/\s+/).map(Number));
const rows = ratings.map(([i, r]) => ({ id: ids[i], rating: r, x: FEATURES.map(n => feats.get(ids[i])[n]) }));
process.stdout.write(JSON.stringify({ features: FEATURES, rows, bank: bankRows }));
