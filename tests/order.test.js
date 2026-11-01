import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuestionSource, normalizeRow } from '../js/questions.js';

// A lopsided bank: 2000 physics, 100 biology, 50 energy, 300 computer science.
const rows = [];
const add = (subject, n) => { for (let i = 0; i < n; i++) rows.push(normalizeRow({ set: 'S', round: '1', num: String(i), type: 'TOSS-UP', subject, question: `${subject} q${i}?`, answer: 'X' })); };
add('Physics', 2000); add('Biology', 100); add('Energy', 50); add('Computer Science', 300);
const base = { typeMode: 'tossup', order: 'random', filters: { subjects: [] } };
const draw = (src, n) => { const c = {}; for (let i = 0; i < n; i++) { const q = src.next(); c[q.subject] = (c[q.subject] || 0) + 1; } return c; };

test('random order: each main subject is equally likely, whatever its size', () => {
  const c = draw(new QuestionSource(rows, base), 9000);
  for (const s of ['Physics', 'Biology', 'Energy']) assert.ok(Math.abs(c[s] - 3000) < 300, `${s}: ${c[s]}`);
  assert.equal(c['Computer Science'], undefined, 'misc subjects are left out by default');
});

test('misc subjects join only when picked; picking subjects restricts the draw', () => {
  const c = draw(new QuestionSource(rows, { ...base, filters: { subjects: ['Computer Science', 'Biology'] } }), 4000);
  assert.deepEqual(Object.keys(c).sort(), ['Biology', 'Computer Science']);
  assert.ok(Math.abs(c.Biology - 2000) < 250);
});

test('a subject runs through all its questions before repeating', () => {
  const src = new QuestionSource(rows, { ...base, filters: { subjects: ['Energy'] } });
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(src.next().id);
  assert.equal(seen.size, 50);
});
