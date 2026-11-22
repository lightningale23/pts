import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeRow, parseQuestions } from '../js/questions.js';
import { assignStages } from '../js/rounds.js';
import { rateDifficulty, difficultyJob, contentWords, keyParts, isCalculation, answerCore, roundKey, difficultyBand, formatDifficulty } from '../js/difficulty.js';

const row = (o = {}) => normalizeRow({ set: 'S', round: 'RR1', num: '1', type: 'TOSS-UP', subject: 'Biology', format: 'Short Answer', level: 'HS', question: 'What organelle makes ATP?', answer: 'MITOCHONDRIA', ...o });

test('content words: math, common words and plurals left out', () => {
  assert.deepEqual(contentWords('What is the $x^{2}$ value of the enzymes in cells?'), ['enzyme', 'cell']);
  assert.deepEqual(contentWords("Earth's crust; glass"), ['earth', 'crust', 'glass']);
});

test('answer text, calculations and parts', () => {
  assert.equal(answerCore(row({ answer: 'MITOCHONDRIA (ACCEPT: MITOCHONDRION)' })), 'MITOCHONDRIA');
  assert.equal(answerCore(row({ format: 'Multiple Choice', w: 'A', x: 'B', y: 'C', z: 'D', answer: 'X) B' })), 'B');
  assert.equal(isCalculation(row({ answer: '12 m/s' })), true);
  assert.equal(isCalculation(row({ answer: '$2\\sqrt{3}$' })), true);
  assert.equal(isCalculation(row({ answer: 'CHLOROPLAST' })), false);
  assert.equal(isCalculation(row({ answer: '1) MITOSIS; 2) 46' })), false);
  assert.equal(keyParts('1) MITOSIS; 2) 46; 3) G1'), 3);
  assert.equal(keyParts('I) Flashing ; II) 3/8'), 2);
  assert.equal(keyParts('2, 1, 3'), 0);
});

// A small bank: one plain question per kind, plus filler so the z-scores have something to compare with.
function bank() {
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(row({ set: 'Filler', num: String(i), question: `What is filler question number ${i} about plants?`, answer: `PLANT ${i % 5}` }));
  const base = { question: 'What organelle makes most of the ATP in a eukaryotic cell?', answer: 'MITOCHONDRIA' };
  rows.push(row({ ...base, set: 'HS', num: '1' }));
  rows.push(row({ ...base, set: 'HS', num: '1', type: 'BONUS' }));
  rows.push(row({ ...base, set: 'HS', num: '2', format: 'Multiple Choice', w: 'MITOCHONDRIA', x: 'RIBOSOME', y: 'NUCLEUS', z: 'GOLGI', answer: 'W) MITOCHONDRIA' }));
  rows.push(row({ ...base, set: 'MS', num: '1', level: 'MS' }));
  rows.push(row({ ...base, set: 'HS', round: 'Finals', num: '3' }));
  const qs = rows.filter(Boolean);
  assignStages(qs);
  return qs;
}

test('the factors move the number the right way', () => {
  const qs = bank();
  const r = rateDifficulty(qs);
  const [tu, bonus, mc, ms, finals] = qs.slice(-5).map(q => q.difficulty);
  for (const q of qs) assert.ok(q.difficulty >= 0 && Number.isFinite(q.difficulty), `${q.difficulty}`);
  assert.ok(bonus > tu, 'bonus harder than toss-up');
  assert.ok(mc < tu, 'multiple choice easier than short answer');
  assert.ok(ms < tu, 'middle school easier');
  assert.ok(finals > tu, 'finals harder than round robin');
  // sets and rounds: the average of their questions
  const hs = qs.filter(q => q.set === 'HS');
  assert.equal(r.sets.get('HS'), Math.round(hs.reduce((a, q) => a + q.difficulty, 0) / hs.length * 100) / 100);
  assert.equal(r.rounds.get(roundKey('HS', 'Finals')), finals);
});

test('rating in slices gives the same numbers', () => {
  const a = bank(), b = bank();
  rateDifficulty(a);
  const job = difficultyJob(b);
  let steps = 0;
  while (!job.step(0)) steps++;
  assert.ok(steps > 0);
  assert.deepEqual(b.map(q => q.difficulty), a.map(q => q.difficulty));
});

test('display helpers', () => {
  assert.equal(formatDifficulty(5.4), '5.40');
  assert.equal(difficultyBand(2.9), 'easy');
  assert.equal(difficultyBand(10.2), 'extreme');
});

test('the Science Bowl bank: centered on 5, never negative, not capped at 10', () => {
  const qs = [...parseQuestions(readFileSync('data/questions.csv', 'utf8')), ...parseQuestions(readFileSync('data/visual-bonuses.csv', 'utf8'))]
    .filter(q => q.subject !== 'General Science');
  assignStages(qs);
  const { sets } = rateDifficulty(qs);
  const d = qs.map(q => q.difficulty);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  assert.ok(Math.abs(mean - 5) < 0.2, `mean ${mean}`);
  assert.ok(d.every(x => x >= 0));
  assert.ok(d.some(x => x > 10));
  const avg = (pred) => { const xs = qs.filter(pred).map(q => q.difficulty); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  assert.ok(avg(q => q.level === 'MS') < avg(q => q.level === 'HS'));
  assert.ok(avg(q => q.type === 'bonus') > avg(q => q.type === 'tossup'));
  assert.ok(avg(q => q.stage === 'late') > avg(q => q.stage === 'rr'));
  assert.equal(sets.size, new Set(qs.map(q => q.set)).size);
});
