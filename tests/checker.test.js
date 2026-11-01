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
  ok(q, 'y'); ok(q, 'Y'); ok(q, 'y) electron'); ok(q, 'electron'); ok(q, 'ELECTRON'); ok(q, '(y)');
  no(q, 'electon'); no(q, 'electrons'); no(q, 'x'); no(q, 'neutron'); no(q, 'positron'); no(q, 'w)'); no(q, 'y) neutron');
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

test('lenient: select-all-that-apply in any written form', () => {
  const q = sa('1 AND 2');
  ok(q, '12'); ok(q, '21'); ok(q, '1,2'); ok(q, '1 & 2'); ok(q, 'one and two'); ok(q, 'statements 1 and 2'); ok(q, '2 1');
  no(q, '1'); no(q, '123'); no(q, '13');
  const q3 = sa('1, 3, AND 4');
  ok(q3, '134'); ok(q3, '4 3 1'); no(q3, '14');
});

test('lenient: lead-ins, plurals, typos, word order of typos', () => {
  ok(sa('MITOCHONDRIA'), "it's mitochondria");
  ok(sa('MITOCHONDRIA'), 'the answer is mitochondria');
  ok(sa('CHLOROPLAST'), 'chloroplasts');
  ok(sa('ENZYME'), 'enzymes');
  ok(sa('PHOTOSYNTHESIS'), 'photosynthsis');
  ok(sa('CELLULAR RESPIRATION'), 'celular respiraton');
  ok(sa('OSMOSIS'), 'osmossis');
  ok(sa('IGNEOUS'), 'ignous');
  ok(sa('4'), 'four');
});

test('lenient: rounded numbers', () => {
  ok(sa('9.8'), '9.81');
  ok(sa('$3.0 \\times 10^8$'), '2.998 x 10^8');
  no(sa('9.8'), '9.6');
  no(sa('6'), '5.6');
});

test('multiple choice is strict: exact option text, letter, or an equal simple number', () => {
  const q = normalizeRow({ question: 'Q?', answer: 'X) HYDROCHLORIC ACID', type: 'tossup', subject: 'Chemistry', w: 'Acetic acid', x: 'Hydrochloric acid', y: 'Carbonic acid', z: 'Hydrofluoric acid' });
  ok(q, '(x)'); ok(q, 'X.'); ok(q, 'hydrochloric acid'); ok(q, 'Hydrochloric  Acid');
  no(q, "it's x"); no(q, 'hydrochloric'); no(q, 'hydrochloric acids'); no(q, 'hydrocloric acid'); no(q, 'w');
  const n = normalizeRow({ question: 'Q?', answer: 'Y) 1/2', type: 'tossup', subject: 'Mathematics', w: '1/3', x: '1/4', y: '1/2', z: '2/3' });
  ok(n, '1/2'); ok(n, '0.5'); ok(n, '.5'); ok(n, 'y');
  no(n, '2/4'); no(n, '1+1/2'); no(n, '0.50001');
  const f = normalizeRow({ question: 'Q?', answer: 'Z', type: 'tossup', subject: 'Mathematics', w: '$\\frac{1}{3}$', x: '2', y: '3', z: '$\\frac{3}{4}$' });
  ok(f, '3/4'); ok(f, '0.75'); no(f, '6/8');
  const e = normalizeRow({ question: 'Q?', answer: 'W) $H_2O$', type: 'tossup', subject: 'Chemistry', w: '$H_2O$', x: '$CO_2$', y: '$O_2$', z: '$N_2$' });
  ok(e, 'H2O'); ok(e, 'h2o'); no(e, 'water');
});

test('still strict where it matters', () => {
  no(sa('MITOSIS'), 'meiosis');
  no(sa('NA'), 'ne');
  no(sa('SODIUM'), 'sodium chloride');
  no(sa('NEON'), 'xenon');
  no(sa('HYDROCHLORIC ACID'), 'acid');
});

test('ordering questions compare sequences, not sets', () => {
  const ord = (answer) => normalizeRow({ question: 'Order the following 3 organisms in chronological order of appearance:\n1) oak trees\n2) lichen\n3) grass', answer, type: 'bonus', subject: 'Biology' });
  ok(ord('231'), '231'); ok(ord('231'), '2, 3, 1'); ok(ord('231'), '2 3 1'); ok(ord('2, 3, 1'), '231');
  no(ord('231'), '132'); no(ord('231'), '123'); no(ord('231'), '23');
  const rank = normalizeRow({ question: 'Rank the following 4 regions from lowest to highest frequency.', answer: '2, 4, 3, 1', type: 'bonus', subject: 'Physics' });
  ok(rank, '2431'); ok(rank, '2,4,3,1'); no(rank, '1234'); no(rank, '1342');
  const sel = normalizeRow({ question: 'Identify all of the following 3 quantities that are vectors:', answer: '2 and 3', type: 'bonus', subject: 'Physics' });
  ok(sel, '32'); ok(sel, '2, 3'); no(sel, '2');
  const only = normalizeRow({ question: 'Identify all of the following stages in which water turns from liquid to gas:', answer: '1 only', type: 'bonus', subject: 'Earth and Space' });
  ok(only, '1'); no(only, '12');
});

test('"All" answers: typing every statement number counts', () => {
  const q = normalizeRow({ question: 'Identify all of the following 3 intermolecular forces present between ammonia molecules:\n1) London dispersion\n2) Dipole-dipole\n3) Hydrogen bonding', answer: 'All', type: 'bonus', subject: 'Chemistry' });
  ok(q, 'all'); ok(q, '123'); ok(q, '1, 2, 3'); ok(q, '3 2 1'); ok(q, 'all three');
  no(q, '12'); no(q, '1 and 3');
  const full = normalizeRow({ question: 'Identify all of the following:\n1) a\n2) b\n3) c', answer: '1, 2, AND 3', type: 'bonus', subject: 'Biology' });
  ok(full, 'all'); ok(full, '123');
  const ord = normalizeRow({ question: 'Order the following from least to greatest:\n1) a\n2) b\n3) c', answer: '312', type: 'bonus', subject: 'Biology' });
  no(ord, 'all'); no(ord, '123');
});

test('numerically equivalent answers when the key is written in LaTeX', () => {
  const r3 = sa('$\\frac{√3}{2}$');
  ok(r3, '√3/2'); ok(r3, 'sqrt(3)/2'); ok(r3, 'sqrt3/2'); ok(r3, '0.866'); ok(r3, '.8660');
  no(r3, '0.87'); no(r3, '0.9'); no(r3, '0.865'); no(r3, '3/2');
  ok(sa('$\\frac{15}{16}$'), '0.9375'); ok(sa('$\\frac{15}{16}$'), '15/16'); no(sa('$\\frac{15}{16}$'), '0.94');
  ok(sa('4π$^{2}$/27'), '4pi^2/27'); ok(sa('4π$^{2}$/27'), '1.462');
  ok(sa('3.3 × $10^{-17}$'), '3.3e-17'); ok(sa('3.3 × $10^{-17}$'), '3.3 x 10^-17');
  ok(sa('$\\frac{2√10}{3}$'), '2sqrt(10)/3'); ok(sa('$\\frac{2√10}{3}$'), '2.108');
  ok(sa('$2\\sqrt{3}$ METERS'), '2√3'); ok(sa('$2\\sqrt{3}$ METERS'), '3.46 meters'); ok(sa('$2\\sqrt{3}$ METERS'), '3.464');
  ok(sa('$\\frac{1}{2}$ (ACCEPT: 0.5)'), '1/2');
  no(sa('$3x^2$'), '3');
});

test('pi answers', () => {
  ok(sa('π'), 'pi'); ok(sa('π'), 'π'); ok(sa('π'), '3.14159'); no(sa('π'), '3');
  ok(sa('$\\frac{\\pi}{4}$'), 'pi/4'); ok(sa('$\\frac{\\pi}{4}$'), '0.785');
});

test('rounding leniency stays within 1%', () => {
  ok(sa('9.8'), '9.81'); no(sa('0.4'), '0.44'); no(sa('$3.3 \\times 10^{-17}$'), '3.63e-17'); no(sa('2 TIMES $10^{5}$'), '2.2e5');
});

test('Roman-numeral statements accept regular numbers', () => {
  const q = normalizeRow({ question: 'Identify all of the following three forces that are fictitious:\nI. Coriolis force\nII. Centrifugal force\nIII. Drag', answer: 'I AND II', type: 'tossup', subject: 'Physics' });
  ok(q, '12'); ok(q, '1 and 2'); ok(q, '2, 1'); ok(q, 'I and II'); ok(q, 'i, ii');
  no(q, '1'); no(q, '123'); no(q, 'I'); no(q, '13');
  const only = normalizeRow({ question: 'Select all of the following:\nI. a\nII. b\nIII. c', answer: 'II ONLY', type: 'tossup', subject: 'Biology' });
  ok(only, '2'); ok(only, 'II'); no(only, '12');
  const all = normalizeRow({ question: 'Identify all of the following:\nI. a\nII. b\nIII. c', answer: 'ALL', type: 'tossup', subject: 'Biology' });
  ok(all, '123'); ok(all, 'I, II, III'); no(all, '12');
  const ord = normalizeRow({ question: 'Order the following from smallest to largest:\nI. a\nII. b\nIII. c', answer: 'I, III, II', type: 'bonus', subject: 'Chemistry' });
  ok(ord, '132'); ok(ord, '1, 3, 2'); ok(ord, 'I, III, II'); no(ord, '123'); no(ord, '231');
});

test('numbered lists in ACCEPT stay whole, and every keyed list is tried', () => {
  const order = normalizeRow({ question: 'Order the following: 1) A; 2) B; 3) C; 4) D', answer: 'SILICA, FLORISIL, CHARCOAL, ALUMINA', accept: '4, 3, 2, 1', type: 'tossup', subject: 'Chemistry' });
  ok(order, '4, 3, 2, 1'); no(order, '4, 3, 1, 2');
  const both = sa('1 AND 3', { accept: '20 AND 110' });
  ok(both, '1 and 3'); ok(both, '20 and 110'); no(both, '1'); no(both, '20');
  const ratio = sa('6', { accept: '6:1 or Equivalent' });
  ok(ratio, '6'); ok(ratio, '6:1');
});

test('multiple choice ignores pronunciation guides in the options', () => {
  const q = normalizeRow({ question: 'Which amino acid?', answer: 'Z) Methionine', type: 'tossup', subject: 'Biology',
    w: 'Glutamine', x: 'Tryptophan (TRIP-tuh-fan)', y: 'Arginine (AAR-juh-neen)', z: 'Methionine (muh-THY-uh-neen)' });
  ok(q, 'z'); ok(q, 'Methionine'); ok(q, 'Z) Methionine'); no(q, 'Tryptophan'); no(q, 'x');
  const f = normalizeRow({ question: 'Which technique?', answer: 'X) Flow cytometry', type: 'tossup', subject: 'Biology',
    w: 'MALDI-TOF [MAHL-dee toff] mass spectrometry', x: 'Flow cytometry [sigh-TAW-muh-tree]', y: 'Immunoprecipitation', z: 'Affinity chromatography' });
  ok(f, 'flow cytometry'); ok(f, 'X'); no(f, 'MALDI-TOF mass spectrometry');
});

test('reading guides, ± and starred names in keys', () => {
  const s = sa('SAGITTARIUS A* [“A-star]', { reject: 'SAGITTARIUS A' });
  ok(s, 'Sagittarius A*'); no(s, 'Sagittarius A');
  const pm = sa('±5 [plus or minus five]', { reject: '5' });
  ok(pm, '±5'); no(pm, '5');
  ok(sa('O(n) (read: big o of n)'), 'O(n)');
  ok(sa('(0,0) AND (6, -4) [IN ANY ORDER]'), '(0,0) AND (6, -4)');
});

test('commas inside numbers, names and brackets do not split alternates', () => {
  const tup = { answer: '(5,5,-5)', accept: '(1,1,-1)', question: 'Give a normal vector.' };
  assert.equal(checkAnswer(tup, '(1,1,-1)').correct, true);
  assert.equal(checkAnswer(tup, '1').correct, false);
  const chem = { answer: 'IMIDAZOLE', accept: 'Glyoxaline; 1,3-diazole', question: 'Name this ring.' };
  assert.equal(checkAnswer(chem, '1,3-diazole').correct, true);
  assert.equal(checkAnswer(chem, '1').correct, false);
  const big = { answer: '1,600,000 kJ', accept: '1,600,000,000 J; 1.6 * 10^9 J', question: 'How much energy?' };
  assert.equal(checkAnswer(big, '1600000000 J').correct, true);
  const names = { answer: 'ALL', accept: '1, 2, 3; ANHYDROBIOSIS, ANOXYBIOSIS, CRYOBIOSIS',
    question: 'Identify all of the following three that are forms of cryptobiosis: 1) Anhydrobiosis; 2) Anoxybiosis; 3) Cryobiosis' };
  assert.equal(checkAnswer(names, 'anhydrobiosis, anoxybiosis, cryobiosis').correct, true);
  assert.equal(checkAnswer(names, '1, 2, 3').correct, true);
});
