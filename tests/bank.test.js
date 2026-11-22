import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseQuestions } from '../js/questions.js';

const BANKS = ['data/questions.csv', 'data/osb-questions.csv', 'data/visual-bonuses.csv'];

test('joke rounds the owner removed stay out of the banks (Princess Anne, Roundshare 2024)', () => {
  for (const file of BANKS) {
    const qs = parseQuestions(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    const jokes = qs.filter(q => /princess\s*anne/i.test(q.round));
    assert.equal(jokes.length, 0, `${file}: ${jokes.map(q => q.id).join(' ')}`);
  }
});
