// The fallback model's number for every question (js/difficulty.js MODEL, no stored ratings), as JSON
// [[id, group, d], ...] on stdout, for combine.py.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestions } from '../../../js/questions.js';
import { assignStages } from '../../../js/rounds.js';
import { rateDifficulty, englishRanks } from '../../../js/difficulty.js';
import english from '../../../js/english-words.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const ranks = englishRanks(english), out = [];
const banks = {
  sb: [...parseQuestions(read('data/questions.csv')), ...parseQuestions(read('data/visual-bonuses.csv'))].filter(q => q.subject !== 'General Science'),
  osb: parseQuestions(read('data/osb-questions.csv')),
};
for (const [k, qs] of Object.entries(banks)) {
  assignStages(qs);
  rateDifficulty(qs, ranks);
  for (const q of qs) out.push([q.id, k === 'osb' ? 'OSB' : q.subject, q.difficulty]);
}
process.stdout.write(JSON.stringify(out));
