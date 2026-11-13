import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readHeader, splitOptions, answerLetter, cleanAnswerParts, joinLines, fixMathSymbols, readPacketMeta,
  questionFromText, buildBankModel, suggestFixes, autoFill,
} from '../js/review-autofill.js';

const SB = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Earth and Space', 'Energy', 'General Science'];
const blank = {
  set: 'BASED 2025', year: '2025', level: 'HS', round: 'DE6', num: '', type: 'TOSS-UP', subject: '', format: 'Short Answer',
  question: '', w: '', x: '', y: '', z: '', answer: '', accept: '', reject: '', notes: '',
};

test('packet headers are read and taken off', () => {
  let h = readHeader('Math – Multiple Choice What is the remainder?', SB);
  assert.equal(h.subject, 'Mathematics'); assert.equal(h.format, 'Multiple Choice'); assert.equal(h.rest, 'What is the remainder?');
  h = readHeader('14MATH –ShortAnswer What is the value?', SB);
  assert.equal(h.num, '14'); assert.equal(h.subject, 'Mathematics'); assert.equal(h.format, 'Short Answer');
  h = readHeader('PHYSICS A 10 meter bar is moving.', SB);
  assert.equal(h.subject, 'Physics'); assert.equal(h.rest, 'A 10 meter bar is moving.');
  h = readHeader('Y-Risk – question format What deep model architecture?', SB);
  assert.equal(h.subject, ''); assert.equal(h.theme, 'Y-Risk'); assert.equal(h.rest, 'What deep model architecture?');
  h = readHeader('B21) Energy – Multiple Choice Researchers found', SB);
  assert.equal(h.num, '21'); assert.equal(h.subject, 'Energy');
  assert.equal(readHeader('PHYSICS Question Type Calculate the entropy.', SB).rest, 'Calculate the entropy.');
  assert.equal(readHeader('Biology [3] – Multiple Choice Intermediate filaments', SB).subject, 'Biology');
  // ordinary questions are left alone
  assert.equal(readHeader('In a multiple choice test, what is the chance of guessing?', SB), null);
  assert.equal(readHeader('Energy is conserved in which collisions?', SB), null);
  assert.equal(readHeader('2 moles of gas expand. What is the work done?', SB), null);
});

test('W) … Z) in the question become options', () => {
  const s = splitOptions('Which acid is strongest?\nW) HClO\nX) $\\text{HClO}_{2}$Y) $\\text{HClO}_{3}$\nZ) $\\text{HClO}_{4}$');
  assert.equal(s.stem, 'Which acid is strongest?');
  assert.deepEqual(s.options, ['HClO', '$\\text{HClO}_{2}$', '$\\text{HClO}_{3}$', '$\\text{HClO}_{4}$']);
  assert.deepEqual(splitOptions('Pick one: W) red X) green Y) blue Z) gold').options, ['red', 'green', 'blue', 'gold']);
  assert.equal(splitOptions('What is the X) value?'), null);
  assert.equal(answerLetter('X) TRANSFORMERS [WC]', []), 'X');
  assert.equal(answerLetter('transformers', ['RNN', 'Transformers', 'a', 'b']), 'X');
  assert.equal(answerLetter('WATER', ['a', 'b', 'c', 'd']), '');
  assert.equal(answerLetter('X-RAYS', ['a', 'b', 'c', 'd']), '');
});

test('answers lose ANSWER:, writer initials and ACCEPT clauses', () => {
  assert.deepEqual(cleanAnswerParts({ answer: 'ANSWER: 8 [ZZ]' }), { answer: '8', accept: [], reject: [], writers: ['ZZ'] });
  const a = cleanAnswerParts({ answer: 'MITOCHONDRIA (ACCEPT: MITOCHONDRION) (DO NOT ACCEPT: CHLOROPLAST)' });
  assert.equal(a.answer, 'MITOCHONDRIA'); assert.deepEqual(a.accept, ['MITOCHONDRION']); assert.deepEqual(a.reject, ['CHLOROPLAST']);
  assert.deepEqual(cleanAnswerParts({ answer: 'Z) Occludins [HG] BIOCHEM' }).writers, ['HG (BIOCHEM)']);
  assert.equal(cleanAnswerParts({ answer: 'IRON [III]' }).answer, 'IRON [III]');
  // a part's ACCEPT stays with its part
  const m = cleanAnswerParts({ answer: '1) COUNTERCLOCKWISE (accept: LEFTWARDS); 2) 4' });
  assert.equal(m.answer, '1) COUNTERCLOCKWISE (accept: LEFTWARDS); 2) 4'); assert.deepEqual(m.accept, []);
});

test('wrapped lines are joined, list items keep their lines', () => {
  assert.equal(joinLines('used by LLMs\nlike ChatGPT? Order these:\n1) a;\n2) b'), 'used by LLMs like ChatGPT? Order these:\n1) a;\n2) b');
  assert.equal(joinLines('is\n2.5 m'), 'is 2.5 m');
  assert.equal(joinLines('the pre-\nmRNA'), 'the pre-mRNA');
});

test('unicode math becomes LaTeX inside $…$ only', () => {
  assert.equal(fixMathSymbols('$\\frac{π}{4}$ and π'), '$\\frac{\\pi}{4}$ and π');
  assert.equal(fixMathSymbols('$2πr$'), '$2\\pi r$');
  assert.equal(fixMathSymbols('a −5 b​'), 'a -5 b');
  assert.equal(fixMathSymbols('costs \\$5 and $x°$'), 'costs \\$5 and $x^{\\circ}$');
});

test('packet text gives the number and toss-up or bonus', () => {
  assert.deepEqual(readPacketMeta('BONUS\n15) PHYSICS A bar\nANSWER: 8'), { type: 'BONUS', num: '15' });
  assert.deepEqual(readPacketMeta('VISUAL BONUS 21B\nDUALITY, SHORT ANSWER'), { type: 'BONUS', num: '21' });
  assert.deepEqual(readPacketMeta('12) BIOLOGY Short Answer What'), { type: '', num: '12' });
  const t = 'TOSS-UP\n12) BIOLOGY Short Answer Order these\n1) a\nANSWER 2, 3, 1\nBONUS\n12) BIOLOGY Short Answer Which\nANSWER: 1 only';
  assert.deepEqual(questionFromText(t, { num: '12', type: 'BONUS' }), { question: '12) BIOLOGY Short Answer Which', answer: '1 only' });
  assert.deepEqual(questionFromText(t, { num: '12', type: 'TOSS-UP' }).answer, '2, 3, 1');
});

const bank = [];
for (let i = 0; i < 40; i++) {
  bank.push({ set: 'MIT 2025', year: '2025', level: 'HS', subject: 'Physics', question: `What is the value of the force on a charge moving in a magnetic field number ${i}?`, answer: 'NEWTON' });
  bank.push({ set: 'MIT 2025', year: '2025', level: 'HS', subject: 'Biology', question: `Which enzyme in the cell copies the DNA strand during replication in organism ${i}?`, answer: 'POLYMERASE' });
  bank.push({ set: 'MIT 2025', year: '2025', level: 'HS', subject: 'Mathematics', question: `What is the binary number in simplest fraction form in base ten for case ${i}?`, answer: '2/3' });
}
for (let i = 0; i < 300; i++) bank.push({ set: 'X', subject: 'Physics', question: 'the of in is a to and for on at the the of of in in', answer: 'zero point' });
const model = buildBankModel(bank, { subjects: SB });

test('the bank model guesses subjects, respaces glued words and finds repeats', () => {
  assert.equal(model.guessSubject('Which enzyme copies DNA during replication?')[0].subject, 'Biology');
  assert.equal(model.respace('What is thevalue ofthe binarynumber?').text, 'What is the value of the binary number?');
  assert.equal(model.respace('the $\\text{thevalue}$ magnetic').text, 'the $\\text{thevalue}$ magnetic');
  assert.equal(model.respace('the polymerase force').changes.length, 0);
  const s = model.similar('Which enzyme in the cell copies the DNA strand during replication in organism 3?', { answer: 'polymerase' });
  assert.ok(s[0].score > 0.8 && s[0].sameAnswer);
  assert.deepEqual(model.setInfo('MIT 2025'), { year: '2025', level: 'HS', count: 120 });
});

test('autoFill fixes a header-and-options row in one go', () => {
  const row = { ...blank, question: 'Math – Multiple Choice What is thevalue ofthe binarynumber in base ten?\nW) -1\nX) 0\nY) 1\nZ) 2', answer: 'Z) 2 [MR]' };
  const { row: r, applied } = autoFill(row, { subjects: SB, model, text: 'TOSS-UP\n22) Math – Multiple Choice What\nANSWER: Z) 2 [MR]' });
  assert.equal(r.question, 'What is the value of the binary number in base ten?');
  assert.deepEqual([r.w, r.x, r.y, r.z], ['-1', '0', '1', '2']);
  assert.equal(r.format, 'Multiple Choice'); assert.equal(r.subject, 'Mathematics');
  assert.equal(r.answer, 'Z) 2'); assert.equal(r.notes, 'writer: MR'); assert.equal(r.num, '22');
  assert.ok(applied.length >= 4);
  // a clean row needs nothing
  assert.deepEqual(autoFill(r, { subjects: SB, model }).applied, []);
});

test('letter and text that disagree are offered both ways, not changed on their own', () => {
  const row = { ...blank, subject: 'Physics', format: 'Multiple Choice', question: 'Which?', w: 'Red', x: 'Green', y: 'Blue', z: 'Gold', answer: 'X) BLUE' };
  const f = suggestFixes(row, { subjects: SB });
  assert.deepEqual(f.filter(x => x.id.startsWith('letter')).map(x => [x.label, x.auto]), [['Trust the letter: X)', false], ['Trust the text: Y)', false]]);
  assert.equal(f.find(x => x.id === 'letter-text').apply(row).answer, 'Y) Blue');
  assert.equal(suggestFixes({ ...row, answer: 'gold' }, { subjects: SB }).find(x => x.id === 'letter').apply(row).answer, 'Z) gold');
});

test('signs count when matching an answer to an option, guides and shortening do not', () => {
  const mc = { ...blank, subject: 'Mathematics', format: 'Multiple Choice', question: 'Which?', w: 'n − 1', x: 'n', y: 'n + 1', z: 'n + 2', answer: 'Y) n + 1' };
  assert.deepEqual(suggestFixes(mc, { subjects: SB }).filter(x => x.id.startsWith('letter')), []);
  const guide = { ...mc, w: '2 cosh(x) [READ: two cosh x]', x: '2 sinh(x) [READ: two sinch x]', y: 'a', z: 'b', answer: 'W) 2 sinh(x)' };
  assert.equal(suggestFixes(guide, { subjects: SB }).find(x => x.id === 'letter-text')?.label, 'Trust the text: X)');
  const short = { ...mc, w: 'Its orbit has not been cleared of other objects', answer: 'W) ITS ORBIT HAS NOT BEEN CLEARED' };
  assert.deepEqual(suggestFixes(short, { subjects: SB }).filter(x => x.id.startsWith('letter')), []);
});
