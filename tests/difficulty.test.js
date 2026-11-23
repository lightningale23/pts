import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeRow, parseQuestions } from '../js/questions.js';
import { assignStages } from '../js/rounds.js';
import {
  rateDifficulty, difficultyJob, contentWords, keyParts, isCalculation, answerCore, answerNumbers, hardForm,
  roundKey, difficultyBand, formatDifficulty, englishRanks, technical, MODEL, FEATURES, parseIdNumbers, applyStored,
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
  assert.equal(difficultyBand(1.2), 'easy');
  assert.equal(difficultyBand(10.2), 'extreme');
});

// The Science Bowl bank, rated as the site rates it: the stored ratings (data/difficulty.csv).
const sb = [...parseQuestions(readFileSync('data/questions.csv', 'utf8')), ...parseQuestions(readFileSync('data/visual-bonuses.csv', 'utf8'))]
  .filter(q => q.subject !== 'General Science');
const osb = parseQuestions(readFileSync('data/osb-questions.csv', 'utf8'));
assignStages(sb);
assignStages(osb);
const stored = parseIdNumbers(readFileSync('data/difficulty.csv', 'utf8'));

test('stored ratings: (nearly) every question has one; the site uses them as they are', () => {
  for (const qs of [sb, osb]) {
    const missing = qs.filter(q => !stored.has(q.id)).length;
    assert.ok(missing <= qs.length * 0.01, `${missing} questions without a stored rating: rate them (importer/difficulty/v2/batch_api.mjs)`);
  }
  const some = sb.slice(0, 50).map(q => ({ ...q }));
  const r = applyStored(some, stored);
  assert.ok(r && r.sets.size >= 1);
  assert.deepEqual(some.map(q => q.difficulty), some.map(q => stored.get(q.id)));
  assert.equal(applyStored([{ id: 'not-rated', set: 'x', round: '1' }], stored), null);
});

const { sets } = rateDifficulty(sb, english, undefined, null, stored);
const byText = s => sb.find(q => q.question.includes(s));

test('the bank: the scale is sane (never negative, hard questions rare, MS < HS, MC < SA)', () => {
  const d = sb.map(q => q.difficulty);
  assert.ok(d.every(x => x >= 0 && Number.isFinite(x)));
  const sorted = [...d].sort((a, b) => a - b);
  const median = sorted[Math.floor(d.length / 2)];
  assert.ok(median >= 1 && median <= 4, `median ${median}`);
  assert.ok(d.filter(x => x > 10).length <= 30);
  const over8 = d.filter(x => x >= 8).length;
  assert.ok(over8 >= 10 && over8 < 0.03 * d.length, `${over8} at 8 or more`);
  const avg = pred => { const xs = sb.filter(pred).map(q => q.difficulty); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  assert.ok(avg(q => q.level === 'MS') < avg(q => q.level === 'HS') - 0.5);
  assert.ok(avg(q => q.type === 'bonus') > avg(q => q.type === 'tossup'));
  assert.ok(avg(q => q.format === 'mc') < avg(q => q.format === 'sa'));
  assert.equal(sets.size, new Set(sb.map(q => q.set)).size);
});

test('the anchors stay near their published ratings; known misratings stay fixed', () => {
  // v3 stores Haiku's ratings as they are, anchors too (the owner's choice); they're in its prompt, so they stay close.
  const anchors = JSON.parse(readFileSync('importer/difficulty/v2/anchors.json', 'utf8'));
  for (const [id, d] of Object.values(anchors).flat()) if (stored.has(id)) assert.ok(Math.abs(stored.get(id) - d) <= 2, `${id}: ${stored.get(id)} vs ${d}`);
  // Routine calculations and easy facts on niche-sounding topics stay low (they were 4-9 on the old model).
  for (const id of ['1q41bnq', '1wr2o9p', '1qkk7ph', 'ha428l', '15puwj8']) assert.ok(stored.get(id) <= 3, `${id}: ${stored.get(id)}`);
  const niche = ['Woodljung-Dahl', 'Flory'].map(s => byText(s) || sb.find(q => q.answer.toLowerCase().includes(s.toLowerCase())));
  const easy = ['Which of the following is the SI Unit of electrical potential', 'Which one of the following is NOT a phase in mitosis',
    'For an advent calendar, Daniel will do 1 push-up', 'Two resistors are connected in series to a battery'].map(byText);
  for (const q of [...niche, ...easy]) assert.ok(q, 'anchor question found');
  for (const q of niche) assert.ok(q.difficulty >= 5, `${q.question.slice(0, 50)}: ${q.difficulty}`);
  for (const q of easy) assert.ok(q.difficulty <= 1.5, `${q.question.slice(0, 50)}: ${q.difficulty}`);
});

test('fallback model (questions without a stored rating) tracks the stored ratings', () => {
  const qs = sb.map(q => ({ ...q }));
  rateDifficulty(qs, english);
  const pairs = qs.map(q => [q.difficulty, stored.get(q.id)]).filter(p => p[1] !== undefined);
  const rank = v => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = []; o.forEach(([, i], k) => { r[i] = k; }); return r; };
  const a = rank(pairs.map(p => p[0])), b = rank(pairs.map(p => p[1]));
  const n = a.length, m = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - m) * (b[i] - m); da += (a[i] - m) ** 2; db += (b[i] - m) ** 2; }
  assert.ok(num / Math.sqrt(da * db) > 0.5);
  // A stored rating wins over the model for the questions that have one.
  const two = sb.slice(0, 2).map(q => ({ ...q }));
  rateDifficulty(two, english, undefined, null, new Map([[two[0].id, 7.5]]));
  assert.equal(two[0].difficulty, 7.5);
  assert.notEqual(two[1].difficulty, undefined);
});

test('model ladder (ai): parsed from CSV, used only with data and a weight', async () => {
  const { parseAiCsv, usesAi } = await import('../js/difficulty.js');
  const ai = parseAiCsv('id,ai\nabc,1.25\r\nbad,\nxyz,-0.5\n');
  assert.deepEqual([...ai], [['abc', 1.25], ['xyz', -0.5]]);
  assert.equal(usesAi({ weights: { niche: 1 } }), false);
  assert.equal(usesAi({ weights: { ai: 0.8 } }), true);
  const a = row({ num: '1' }), b = row({ num: '2', question: 'What organelle makes proteins?', answer: 'RIBOSOME' });
  const model = { intercept: 3, weights: { ai: 1, aiMissing: 0.5 }, center: 3, stretch: 1 };
  rateDifficulty([a, b], english, model, new Map([[a.id, 2]]));
  assert.equal(a.difficulty, 5);      // 3 + 1 × 2
  assert.equal(b.difficulty, 3.5);    // no value: 3 + 0.5 (aiMissing)
  rateDifficulty([a, b], english, model, null);   // no ladder data at all: neither feature
  assert.equal(a.difficulty, 3);
  assert.equal(b.difficulty, 3);
});

test('AI signals: model replies cleaned into answers, judge replies into A/B', async () => {
  const { cleanAnswer, judgeChoice, questionText, contestantMessages } = await import('../importer/difficulty/llm.mjs');
  assert.equal(cleanAnswer('<think>hmm</think>\nThe answer is phloem.'), 'phloem');
  assert.equal(cleanAnswer('**Answer:** X) Mitochondria\nBecause...'), 'X) Mitochondria');
  assert.equal(judgeChoice('B'), 'B');
  assert.equal(judgeChoice('Question A is harder'), 'A');
  assert.equal(judgeChoice('It is a close call, but B.'), 'B');
  assert.equal(judgeChoice('neither'), null);
  const mc = row({ format: 'Multiple Choice', w: 'One', x: 'Two', y: 'Three', z: 'Four', answer: 'X) Two', question: 'Pick a number from the list of four numbers below please' });
  assert.match(questionText(mc), /W\) One\nX\) Two/);
  assert.doesNotMatch(questionText(mc, 0.5), /W\)/);   // cut off before the choices
  assert.equal(contestantMessages(mc, 1, 'IMG')[1].images[0], 'IMG');
});
