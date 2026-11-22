import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeRow, parseQuestions } from '../js/questions.js';
import { assignStages } from '../js/rounds.js';
import {
  rateDifficulty, difficultyJob, contentWords, keyParts, isCalculation, answerCore, answerNumbers, hardForm,
  roundKey, difficultyBand, formatDifficulty, englishRanks, technical, MODEL, FEATURES,
} from '../js/difficulty.js';
import englishList from '../js/english-words.js';

const english = englishRanks(englishList);
const row = (o = {}) => normalizeRow({ set: 'S', round: 'RR1', num: '1', type: 'TOSS-UP', subject: 'Biology', format: 'Short Answer', level: 'HS', question: 'What organelle makes ATP?', answer: 'MITOCHONDRIA', ...o });

test('content words: math, guides, common words, plurals and story names', () => {
  assert.deepEqual(contentWords('What is the $x^{2}$ value of the enzymes in cells?', english), ['enzyme', 'cell']);
  assert.deepEqual(contentWords('What is a chondrichthyes [con-DRICK-thees]?', english), ['chondrichthye']);
  // a person's name in a story question isn't a word of the topic; a scientist's name is
  assert.deepEqual(contentWords('Anurag throws a ball', english), ['throw', 'ball']);
  assert.deepEqual(contentWords('Aarushi and Eshaan want to approximate', english), ['want', 'approximate']);
  assert.ok(contentWords('the Boltzmann distribution', english).includes('boltzmann'));
});

test('technical words: rare in everyday English', () => {
  assert.equal(technical('umpolung', english), 1);
  assert.ok(technical('calendar', english) < 0.5);
  assert.ok(technical('snail', english) < 0.9);
  assert.equal(technical('water', english), 0);
});

test('answer text, calculations and parts', () => {
  assert.equal(answerCore(row({ answer: 'MITOCHONDRIA (ACCEPT: MITOCHONDRION)' })), 'MITOCHONDRIA');
  assert.equal(answerCore(row({ format: 'Multiple Choice', w: 'A', x: 'B', y: 'C', z: 'D', answer: 'X) B' })), 'B');
  assert.equal(isCalculation(row({ answer: '12 m/s' })), true);
  assert.equal(isCalculation(row({ answer: '$2\\sqrt{3}$' })), true);
  assert.equal(isCalculation(row({ answer: 'CHLOROPLAST' })), false);
  assert.equal(isCalculation(row({ answer: '1) MITOSIS; 2) 46' })), false);
  // a matrix to work out is a calculation, with nine numbers to give
  const inv = row({ answer: 'top row 1, -1/3, -2/3, middle row -1/2, 1/6, 5/6, and bottom row -1, 2/3, 1/3' });
  assert.equal(isCalculation(inv), true);
  assert.equal(answerNumbers(inv), 9);
  assert.equal(hardForm(row({ answer: '$2\\sqrt{3}$' })), true);
  assert.equal(hardForm(row({ answer: '-10 m/s^2' })), false);   // units aren't a hard form
  assert.equal(keyParts('1) MITOSIS; 2) 46; 3) G1'), 3);
  assert.equal(keyParts('I) Flashing ; II) 3/8'), 2);
  assert.equal(keyParts('2, 1, 3'), 0);
});

test('the model only uses known features', () => {
  for (const k of Object.keys(MODEL.weights)) assert.ok(FEATURES.includes(k), k);
  assert.ok(Object.keys(MODEL.weights).length > 10);
});

test('rating in slices gives the same numbers', () => {
  const make = () => {
    const qs = [];
    for (let i = 0; i < 60; i++) qs.push(row({ num: String(i), question: `What enzyme number ${i} acts on substrate ${i % 7}?`, answer: `ENZYME ${i % 5}` }));
    assignStages(qs);
    return qs;
  };
  const a = make(), b = make();
  rateDifficulty(a, english);
  const job = difficultyJob(b, english);
  let steps = 0;
  while (!job.step(0)) steps++;
  assert.ok(steps > 0);
  assert.deepEqual(b.map(q => q.difficulty), a.map(q => q.difficulty));
});

test('display helpers', () => {
  assert.equal(formatDifficulty(5.4), '5.40');
  assert.equal(difficultyBand(1.9), 'easy');
  assert.equal(difficultyBand(10.2), 'extreme');
});

// The Science Bowl bank: the scale and the hand-rated anchors.
const sb = [...parseQuestions(readFileSync('data/questions.csv', 'utf8')), ...parseQuestions(readFileSync('data/visual-bonuses.csv', 'utf8'))]
  .filter(q => q.subject !== 'General Science');
assignStages(sb);
const { sets } = rateDifficulty(sb, english);
const byText = s => sb.find(q => q.question.includes(s));

test('the bank: never negative, not capped at 10, hard questions rare', () => {
  const d = sb.map(q => q.difficulty);
  assert.ok(d.every(x => x >= 0 && Number.isFinite(x)));
  assert.ok(d.some(x => x > 10));
  const over8 = d.filter(x => x >= 8).length / d.length;
  assert.ok(over8 > 0.002 && over8 < 0.03, `${over8}`);
  const avg = pred => { const xs = sb.filter(pred).map(q => q.difficulty); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  assert.ok(avg(q => q.level === 'MS') < avg(q => q.level === 'HS') - 1);
  assert.ok(avg(q => q.type === 'bonus') > avg(q => q.type === 'tossup'));
  assert.ok(avg(q => q.format === 'mc') < avg(q => q.format === 'sa'));
  assert.equal(sets.size, new Set(sb.map(q => q.set)).size);
  assert.ok(sets.get('DVMS 2025') < sets.get('MIT 2025'));
});

test('niche knowledge rates far above everyday facts; length alone does not', () => {
  const niche = ['Woodljung-Dahl', 'nephelauxetic', 'Bürgi-Dunitz', 'Flory']
    .map(s => byText(s) || sb.find(q => q.answer.toLowerCase().includes(s.toLowerCase())));
  const easy = ['Which of the following is the SI Unit of electrical potential', 'Which one of the following is NOT a phase in mitosis',
    'For an advent calendar, Daniel will do 1 push-up', 'Two resistors are connected in series to a battery'].map(byText);
  for (const q of [...niche, ...easy]) assert.ok(q, 'anchor question found');
  for (const q of niche) assert.ok(q.difficulty >= 6.5, `${q.question.slice(0, 50)}: ${q.difficulty}`);
  for (const q of easy) assert.ok(q.difficulty <= 3, `${q.question.slice(0, 50)}: ${q.difficulty}`);
});
