import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankKey, rowProblems, tidyRow, itemStatus, mergeDecisions } from '../js/review.js';

const ok = {
  set: 'MIT 2025', year: '2025', level: 'HS', round: 'RR3', num: '4', type: 'BONUS', subject: 'Physics',
  format: 'Short Answer', question: 'What is the SI unit of force?', answer: 'NEWTON', w: '', x: '', y: '', z: '',
  accept: '', reject: '', notes: '',
};

test('a complete row has no problems', () => {
  assert.deepEqual(rowProblems(ok, ['Physics']), []);
});

test('missing fields, bad multiple choice and | in accept are caught', () => {
  assert.ok(rowProblems({ ...ok, answer: '' }).some(p => /answer/.test(p)));
  assert.ok(rowProblems({ ...ok, num: '' }).some(p => /number/.test(p)));
  const mc = { ...ok, format: 'Multiple Choice', w: 'a', x: 'b', y: 'c', z: '', answer: 'X) B' };
  assert.ok(rowProblems(mc).some(p => /four options/.test(p)));
  assert.ok(rowProblems({ ...mc, z: 'd', answer: 'B' }).some(p => /letter/.test(p)));
  assert.deepEqual(rowProblems({ ...mc, z: 'd' }), []);
  assert.ok(rowProblems({ ...ok, accept: 'a | b' }).some(p => /\|/.test(p)));
  assert.ok(rowProblems({ ...ok, subject: 'Astronomy' }, ['Physics']).some(p => /subjects/.test(p)));
  assert.ok(rowProblems({ ...ok, question: 'It costs $5 to $x' }).length === 0);
  assert.ok(rowProblems({ ...ok, question: 'It costs $5' }).some(p => /\$/.test(p)));
  assert.ok(rowProblems({ ...ok, question: 'It costs \\$5' }).length === 0);
});

test('tidyRow fills a bare multiple choice letter and clears options of short answers', () => {
  const r = tidyRow({ ...ok, format: 'Multiple Choice', w: 'Mass', x: 'Velocity', y: 'Energy', z: 'Heat', answer: 'x' });
  assert.equal(r.answer, 'X) Velocity');
  assert.equal(tidyRow({ ...ok, w: 'left over' }).w, '');
});

test('bankKey matches merge_into_bank.py (case, LaTeX and punctuation ignored)', () => {
  assert.equal(bankKey({ question: 'What is $x^{2}$?', answer: 'X' }), bankKey({ question: 'what is x2', answer: 'x' }));
});

test('status: applied wins, then local, then saved', () => {
  const saved = { a: { action: 'add' }, b: { action: 'dismiss' } };
  const local = { b: { action: 'add' }, c: { action: 'undo' } };
  const applied = { a: { id: 'q1' }, d: { repeat: true } };
  assert.equal(itemStatus('a', { saved, local, applied }), 'added');
  assert.equal(itemStatus('b', { saved, local, applied }), 'add');
  assert.equal(itemStatus('c', { saved, local, applied }), 'todo');
  assert.equal(itemStatus('d', { saved, local, applied }), 'repeat');
  assert.equal(itemStatus('e', { saved, local, applied }), 'todo');
});

test('mergeDecisions: local changes win, undo removes, added questions are frozen', () => {
  const saved = { a: { action: 'add', row: 1 }, b: { action: 'dismiss' } };
  const local = { a: { action: 'add', row: 2 }, b: { action: 'undo' }, c: { action: 'dismiss' } };
  assert.deepEqual(mergeDecisions(saved, local, {}), { a: { action: 'add', row: 2 }, c: { action: 'dismiss' } });
  assert.deepEqual(mergeDecisions(saved, local, { a: { id: 'x' } }).a, { action: 'add', row: 1 });
});
