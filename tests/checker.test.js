import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, parseAnswerSpec, parseNumber } from '../js/checker.js';
import { normalizeRow } from '../js/questions.js';

const sa = (answer, extra = {}) => normalizeRow({ question: 'Q?', answer, type: 'tossup', subject: 'Biology', ...extra });
const mc = (answer) => normalizeRow({ question: 'Q?', answer, type: 'tossup', subject: 'Physics', w: 'Proton', x: 'Neutron', y: 'Electron', z: 'Positron' });
const ok = (q, g) => assert.equal(checkAnswer(q, g).correct, true, `"${g}" should be accepted for "${q.answer}"`);
const no = (q, g) => assert.equal(checkAnswer(q, g).correct, false, `"${g}" should be rejected for "${q.answer}"`);

test('multiple choice by letter or text', () => {
  const q = mc('Y) ELECTRON');
  assert.equal(q.answerLetter, 'Y');
  ok(q, 'y'); ok(q, 'Y'); ok(q, 'y) electron'); ok(q, 'electron'); ok(q, 'electon');
  no(q, 'x'); no(q, 'neutron'); no(q, 'positron'); no(q, 'w)');
});

test('MC answer given as letter only', () => {
  const q = mc('Z');
  assert.equal(q.answerText, 'Positron');
  ok(q, 'z'); ok(q, 'positron'); no(q, 'proton');
});

test('accept / do not accept notes', () => {
  const q = sa('MITOCHONDRIA (ACCEPT: MITOCHONDRION; DO NOT ACCEPT: ORGANELLE)');
  ok(q, 'mitochondria'); ok(q, 'Mitochondrion'); ok(q, 'mitocondria'); no(q, 'organelle'); no(q, 'chloroplast');
});

test('optional words in parentheses', () => {
  const q = sa('(PRIMARY) MOTOR CORTEX');
  ok(q, 'motor cortex'); ok(q, 'primary motor cortex'); no(q, 'sensory cortex');
});

test('OR alternatives and accept column', () => {
  const q = sa('SODIUM OR NA', { accept: 'Na+' });
  ok(q, 'sodium'); ok(q, 'Na'); no(q, 'Ne'); no(q, 'potassium');
});

test('short answers need exact match', () => {
  const q = sa('NEON');
  ok(q, 'neon'); no(q, 'nein'); no(q, 'xenon');
});

test('numbers: equivalent forms and units', () => {
  ok(sa('0.5'), '1/2'); ok(sa('0.5'), '.5'); ok(sa('1/2'), '0.5');
  ok(sa('300,000'), '3 x 10^5'); ok(sa('3 × 10^8 METERS PER SECOND'), '3e8');
  ok(sa('12 METERS PER SECOND'), '12'); ok(sa('12 METERS PER SECOND'), '12 m/s');
  no(sa('12 METERS PER SECOND'), '13'); ok(sa('-4'), '−4'); no(sa('4'), '-4');
  ok(sa('25%'), '25%');
  assert.equal(parseNumber('3 x 10^-2').value, 0.03);
});

test('statement lists compare as sets', () => {
  const q = sa('1 AND 3');
  ok(q, '1, 3'); ok(q, '3 and 1'); ok(q, '1 3'); no(q, '1'); no(q, '1, 2, 3');
  const q2 = sa('2');
  no(q2, '2 and 3');
});

test('answer spec parsing', () => {
  const s = parseAnswerSpec('ADENOSINE TRIPHOSPHATE (ACCEPT: ATP)');
  assert.ok(s.alts.includes('adenosine triphosphate'));
  assert.ok(s.alts.includes('atp'));
});

test('empty answer is wrong', () => {
  no(sa('IRON'), '');
});

test('expressions after numbers must match; LaTeX times is understood', () => {
  const q = sa('$3x^2$', { accept: '3 X SQUARED' });
  ok(q, '3x^2'); ok(q, '3 x squared'); no(q, '3x^3'); no(q, '3');
  ok(sa('$3.0 \\times 10^8$ METERS PER SECOND'), '3 x 10^8');
  ok(sa('$3.0 \\times 10^8$'), '300,000,000');
  ok(sa('9.8 m/s^2'), '9.8');
  ok(sa('6', { accept: 'X = 6' }), 'x=6');
});
