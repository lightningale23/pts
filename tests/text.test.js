import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spokenTokens, tokenize, setPronunciations, sayRespelling } from '../js/text.js';

const say = (question, extra = {}) => spokenTokens(tokenize({ question, ...extra })).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

test('a pronunciation guide is said in place of the word it is for', () => {
  assert.equal(say('Which tissue, Parenchyma [pair-EN-kih-ma], stores starch?'), 'Which tissue, pair-en-kih-ma , stores starch?');
  assert.equal(say('The Beaufort (BOW-fort) scale.'), 'The bow-fort scale.');
  assert.equal(say('the Tolman–Oppenheimer–Volkoff [TOHL-muhn OH-pen-high-muhr VOHL-kawf ] limit'), 'tohl-muhn oh-pen-high-muhr vohl-kawf limit');
  assert.equal(say('Brassica oleracea (BRASS-ih-kuh oh-luh-RAY-see-uh) is'), 'brass-ih-kuh oh-luh-ray-see-uh is');
  assert.equal(say('a solution of acetic [uh-SEE-tic] acid'), 'a solution of uh-see-tic acid');
  assert.equal(say('the de Broglie [de-BROY] wavelength'), 'the de-broy wavelength');
  assert.equal(say('infundibulum (read: in-fun-DIB-yuh-lum) of'), 'in-fun-dib-yuh-lum of');
  assert.equal(say('Spacing of (111) [one-one-one] planes'), 'Spacing of one-one-one planes');
  assert.equal(say('Type Ic (one-C) supernova'), 'Type one c supernova');
  const mc = say('Which is ground tissue?', { choices: ['Parenchyma [pair-EN-kih-ma]', 'Xylem', '', ''] });
  assert.ok(mc.includes('pair-en-kih-ma') && !/Parenchyma|EN/.test(mc), mc);
});

test('text that only looks like a guide is read as written', () => {
  assert.equal(say('A (non-polar) solvent.'), 'A (non-polar) solvent.');
  assert.equal(say('iron (III) oxide'), 'iron (III) oxide');
  // a guide that fits no word just before it: the word is said and the guide skipped
  assert.equal(say('Small [PEE-wee]-associated RNAs'), 'Small associated RNAs');
});

test('words on the pronunciation list are said as listed', () => {
  setPronunciations('word,say\n# notes\ncnidaria,nye-DAIR-ee-uh\ncepheid,SEF-ee-id\neuler,OY-ler\ndiels,deelz\n');
  assert.equal(say('Members of Cnidaria, and Cepheids.'), 'Members of nye-dair-ee-uh, and sef-ee-ids.');
  assert.equal(say('Euler’s formula and the Diels-Alder reaction'), 'oy-lers formula and the deelz Alder reaction');
  // the question's own guide wins
  assert.equal(say('Cnidaria (NIGH-dare-ee-uh) are'), 'nigh-dare-ee-uh are');
  setPronunciations('');
});

test('respellings are given to the voice in a form it reads well', () => {
  assert.equal(sayRespelling('kal-SER-ee-uh'), 'kal-ser-ee-uh');
  assert.equal(sayRespelling('AL-kye-n'), 'al-kyen');
  assert.equal(sayRespelling('p-k-a'), 'p k a');
});

test('a reading guide is read instead of the math it describes', () => {
  assert.equal(say('Find $x^2$ [read as: x squared] now.'), 'Find x squared now.');
  assert.equal(say('the 3’ [three prime] end'), 'the 3’ [three prime] end');
});

test('characters that stop some voices mid-word are removed', () => {
  assert.equal(say('the di\u0000erence in tension'), 'the dierence in tension');
  assert.equal(say('the ﬁrst ﬂow'), 'the first flow');
});
