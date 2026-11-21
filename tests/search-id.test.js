import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionForSearch, looksLikeId } from '../js/questions.js';

const q1 = { id: '1qy21vz' }, q2 = { id: '1urxzu5-2' };
const byId = new Map([[q1.id, q1], [q2.id, q2]]);

test('a search that is just an ID finds that question', () => {
  assert.equal(questionForSearch('1qy21vz', byId), q1);
  assert.equal(questionForSearch('  1QY21VZ ', byId), q1);
  assert.equal(questionForSearch('1urxzu5-2', byId), q2);
});

test('"ID x", "id: x" and "#x" work too', () => {
  for (const t of ['ID 1qy21vz', 'id:1qy21vz', 'id: 1qy21vz', 'Id #1qy21vz', '#1qy21vz']) assert.equal(questionForSearch(t, byId), q1, t);
});

test('word searches and unknown IDs find nothing by ID', () => {
  for (const t of ['', 'proton', '1qy21vz proton', 'idaho', 'zzzz999']) assert.equal(questionForSearch(t, byId), null, t);
  assert.equal(questionForSearch('1qy21vz', null), null);
});

test('looksLikeId: letters and digits, not plain words', () => {
  for (const t of ['1qy21vz', 'ID 1qy21vz', '#wgpbvt9', '1urxzu5-2']) assert.ok(looksLikeId(t), t);
  for (const t of ['proton', 'carbon dioxide', 'h2', '', 'x'.repeat(13) + '1']) assert.ok(!looksLikeId(t), t);
});
