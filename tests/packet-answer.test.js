import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.localStorage ??= { getItem() { return null; }, setItem() {}, removeItem() {} };
const { packetAnswer, parseQuestions } = await import('../js/questions.js');

test('packetAnswer reads the old key and the reason from the notes', () => {
  assert.equal(packetAnswer({ notes: 'writer: SC' }), null);
  assert.equal(packetAnswer({}), null);
  assert.deepEqual(packetAnswer({ notes: 'writer: KO; packet answer: Y) Cosine' }), { answer: 'Y) Cosine', why: '' });
  assert.deepEqual(packetAnswer({ notes: 'packet answer: 255; why: 25 factors.' }), { answer: '255', why: '25 factors.' });
  // A multi-part old key keeps its semicolons.
  assert.deepEqual(packetAnswer({ notes: 'writer: SC; packet answer: 1: ALL; 2: 2 AND 3; why: BICEP-2 has no PMTs.' }),
    { answer: '1: ALL; 2: 2 AND 3', why: 'BICEP-2 has no PMTs.' });
  // "packet answer had no letter" is a note, not an old key.
  assert.equal(packetAnswer({ notes: 'packet answer had no letter; matched option X' }), null);
});

test('every corrected key in the banks differs from its packet answer', () => {
  for (const file of ['data/questions.csv', 'data/visual-bonuses.csv', 'data/osb-questions.csv']) {
    for (const q of parseQuestions(readFileSync(file, 'utf8'))) {
      const pa = packetAnswer(q);
      if (!pa) continue;
      assert.notEqual(pa.answer.toLowerCase(), String(q.answer).toLowerCase(), `${q.id} in ${file}`);
    }
  }
});
