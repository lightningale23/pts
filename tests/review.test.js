import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bankKey, rowProblems, tidyRow, itemStatus, mergeDecisions, b64, unb64, ghRead } from '../js/review.js';

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

test('saving a large decisions file encodes without overflowing the stack', () => {
  const big = readFileSync(new URL('../review/decisions.json', import.meta.url), 'utf8').repeat(20) + 'é—∆ 🧪';
  const enc = b64(big);
  assert.equal(unb64(enc), big);
  assert.equal(enc, Buffer.from(big, 'utf8').toString('base64'));
});

test('ghRead fetches the raw text when GitHub omits content for files over 1 MB', async () => {
  const real = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(opts.headers.Accept);
    if (opts.headers.Accept.includes('raw')) return { ok: true, status: 200, text: async () => '{"a":{"action":"add"}}' };
    return { ok: true, status: 200, json: async () => ({ sha: 'abc', size: 2_000_000, content: '', encoding: 'none' }) };
  };
  try {
    assert.deepEqual(await ghRead('o/r', 'review/decisions.json', 't'), { sha: 'abc', json: { a: { action: 'add' } } });
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = real; }
});
