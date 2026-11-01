import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spokenTokens, tokenize } from '../js/text.js';

const say = (question, extra = {}) => spokenTokens(tokenize({ question, ...extra })).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

test('pronunciation guides are skipped when reading aloud; the word itself is said', () => {
  assert.equal(say('Which tissue, Parenchyma [pair-EN-kih-ma], stores starch?'), 'Which tissue, Parenchyma , stores starch?');
  assert.equal(say('The Beaufort (BOW-fort) scale.'), 'The Beaufort scale.');
  assert.equal(say('the Tolman–Oppenheimer–Volkoff [TOHL-muhn OH-pen-high-muhr VOHL-kawf ] limit'), 'the Tolman–Oppenheimer–Volkoff limit');
  assert.equal(say('Small [PEE-wee]-associated RNAs'), 'Small associated RNAs');
  assert.equal(say('A (non-polar) solvent.'), 'A (non-polar) solvent.');
  const mc = say('Which is ground tissue?', { choices: ['Parenchyma [pair-EN-kih-ma]', 'Xylem', '', ''] });
  assert.ok(!/EN|kih/.test(mc), mc);
});

test('a reading guide is read instead of the math it describes', () => {
  assert.equal(say('Find $x^2$ [read as: x squared] now.'), 'Find x squared now.');
  assert.equal(say('the 3’ [three prime] end'), 'the 3’ [three prime] end');
});

test('characters that stop some voices mid-word are removed', () => {
  assert.equal(say('the di\u0000erence in tension'), 'the dierence in tension');
  assert.equal(say('the ﬁrst ﬂow'), 'the first flow');
});
