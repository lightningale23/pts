import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spokenTokens, tokenize, setPronunciations, sayRespelling, useRespellings } from '../js/text.js';

const say = (question, extra = {}) => spokenTokens(tokenize({ question, ...extra })).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

test('respellings are off by default: the word is said and its guide skipped', () => {
  assert.equal(say('Which tissue, Parenchyma [pair-EN-kih-ma], stores starch?'), 'Which tissue, Parenchyma , stores starch?');
  assert.equal(say('The Beaufort (BOW-fort) scale.'), 'The Beaufort scale.');
  assert.equal(say('siliceous ooze (sih-LISH-ish ooze) forms'), 'siliceous ooze forms');
  assert.equal(say('infundibulum (read: in-fun-DIB-yuh-lum) of'), 'infundibulum of');
  assert.equal(say('A (non-polar) solvent.'), 'A (non-polar) solvent.');
  assert.equal(say('iron (III) oxide'), 'iron (III) oxide');
  setPronunciations('word,say\ncnidaria,nye-DAIR-ee-uh\n');
  assert.equal(say('Members of Cnidaria.'), 'Members of Cnidaria.');
  setPronunciations('');
  // math reading guides still work
  assert.equal(say('Find $x^2$ [read as: x squared] now.'), 'Find x squared now.');
});

test('with respellings on, a pronunciation guide is said in place of the word it is for', () => {
  useRespellings(true);
  assert.equal(say('Which tissue, Parenchyma [pair-EN-kih-ma], stores starch?'), 'Which tissue, pair-en-kim-ma , stores starch?');
  assert.equal(say('The Beaufort (BOW-fort) scale.'), 'The bow-fort scale.');
  assert.equal(say('the Tolman–Oppenheimer–Volkoff [TOHL-muhn OH-pen-high-muhr VOHL-kawf ] limit'), 'tohl-muhn oh-pen-high-muhr vohl-kawf limit');
  assert.equal(say('Brassica oleracea (BRASS-ih-kuh oh-luh-RAY-see-uh) is'), 'brass-ick-ka oh-luh-ray-see-uh is');
  assert.equal(say('a solution of acetic [uh-SEE-tic] acid'), 'a solution of us-see-tic acid');
  assert.equal(say('the de Broglie [de-BROY] wavelength'), 'the de-broy wavelength');
  assert.equal(say('infundibulum (read: in-fun-DIB-yuh-lum) of'), 'in-fun-dib-yul-lum of');
  assert.equal(say('Spacing of (111) [one-one-one] planes'), 'Spacing of one-one-one planes');
  assert.equal(say('Type Ic (one-C) supernova'), 'Type one-C supernova');
  const mc = say('Which is ground tissue?', { choices: ['Parenchyma [pair-EN-kih-ma]', 'Xylem', '', ''] });
  assert.ok(mc.includes('pair-en-kim-ma') && !/Parenchyma|EN/.test(mc), mc);
  useRespellings(false);
});

test('text that only looks like a guide is read as written', () => {
  useRespellings(true);
  assert.equal(say('A (non-polar) solvent.'), 'A (non-polar) solvent.');
  assert.equal(say('iron (III) oxide'), 'iron (III) oxide');
  // a guide that fits no word just before it: the word is said and the guide skipped
  assert.equal(say('Small [PEE-wee]-associated RNAs'), 'Small associated RNAs');
  useRespellings(false);
});

test('with respellings on, words on the pronunciation list are said as listed', () => {
  useRespellings(true);
  setPronunciations('word,say\n# notes\ncnidaria,nye-DAIR-ee-uh\ncepheid,SEF-ee-id\neuler,OY-ler\ndiels,deelz\n');
  assert.equal(say('Members of Cnidaria, and Cepheids.'), 'Members of nye-dair-ee-uh, and sef-ee-ids.');
  assert.equal(say('Euler’s formula and the Diels-Alder reaction'), 'oy-lers formula and the deelz Alder reaction');
  // the list (checked by ear) wins over a guide printed in the question
  assert.equal(say('Cnidaria (NIGH-dare-ee-uh) are'), 'nye-dair-ee-uh are');
  setPronunciations('');
  useRespellings(false);
});

test('respellings are given to the voice in a form it reads well', () => {
  assert.equal(sayRespelling('kal-SER-ee-uh'), 'kal-ser-ee-uh');
  assert.equal(sayRespelling('AL-kye-n'), 'al-kyen');
  // pieces that don't look like words get spelled out by some voices ("sih" as S I H)
  assert.equal(sayRespelling('sih-LISH-ish'), 'sil-lish-ish');
  assert.equal(sayRespelling('A-con-druh-PLAY-shuh'), 'A-con-drup-play-sha');
  assert.equal(sayRespelling('puh-REN-kih-muh'), 'puh-ren-kim-ma');
  assert.equal(sayRespelling('p-k-a'), 'p k a');
});

test('a reading guide is read instead of the math it describes', () => {
  assert.equal(say('Find $x^2$ [read as: x squared] now.'), 'Find x squared now.');
  assert.equal(say('the 3’ [three prime] end'), 'the 3’ [three prime] end');
});

test('a READ guide for math written as plain text is read instead of it', () => {
  assert.equal(say('the equations x squared + y squared +4x−6y = 0 [READ: x squared plus y squared plus 4 x minus 6 y equals 0 ] and x squared + y squared − 4x − 2y = 4 [READ: x squared plus y squared minus 4 x minus 2 y equals 4 ]?'),
    'the equations x squared plus y squared plus 4 x minus 6 y equals 0 and x squared plus y squared minus 4 x minus 2 y equals 4?');
  assert.equal(say('its O(n) [read: big O of n] runtime'), 'its big O of n runtime');
  assert.equal(say('2 HCl (read: two H-C-L) forms'), 'two H-C-L forms');
  // each list item keeps its own label
  assert.equal(say('ions:\n1) Na+ (read: sodium plus)\n2) K+ (read: potassium plus)'), 'ions: 1) sodium plus 2) potassium plus');
  assert.equal(say('3) 1,5-dimethylcyclohexene [read: one five die-methyl cyclo-hex-EEN]'), '3) one five die-methyl cyclo-hex-een');
});

test('a READ guide that is only how to say a word, or an instruction, is skipped', () => {
  assert.equal(say('the intersection chord [READ: kord ] of the two circles'), 'the intersection chord of the two circles');
  assert.equal(say('The frame reads: [read slowly] 5 prime'), 'The frame reads: 5 prime');
  assert.equal(say('initiators: 1) AIBN [read out the letters] 2) TMSCl'), 'initiators: 1) AIBN 2) TMSCl');
});

test('degree signs and ion charges are read as such, not as exponents', () => {
  assert.equal(say('at $25^{\\circ}$C.'), 'at 25 degrees Celsius.');
  assert.equal(say('an angle of $45^{o}$'), 'an angle of 45 degrees');
  assert.equal(say('below 0° Celsius, 30°C'), 'below 0 degrees Celsius, 30 degrees Celsius');
  assert.equal(say('$100^{\\circ}\\text{C}$'), '100 degrees Celsius');
  assert.equal(say('the $\\Delta G^{\\circ}$ and $E^{o}$'), 'the Delta G naught and E naught');
  assert.equal(say('$\\text{Fe}^{3+}$ and Fe^3+ ions'), 'Fe 3 plus and Fe 3 plus ions');
  assert.equal(say('$\\text{CO}_{3}^{2-}$, $F^{-}$, $O^{2–}$'), 'CO 3 2 minus , F minus , O 2 minus');
  // exponents stay exponents
  assert.equal(say('$10^{-34}$'), '10 to the minus 34');
  assert.equal(say('$x^{2}$'), 'x squared');
  assert.equal(say('x^2 + 1'), 'x^2 + 1');
});

test('characters that stop some voices mid-word are removed', () => {
  assert.equal(say('the di\u0000erence in tension'), 'the dierence in tension');
  assert.equal(say('the ﬁrst ﬂow'), 'the first flow');
});

test('math touching a word stays attached, and \\$ is a dollar sign, not math', async () => {
  const { tokensHtml, richText, plainText } = await import('../js/text.js');
  const toks = tokenize({ question: 'Is N$_{2}$ or $x^{2}$-y bigger than CO$_{2}$?' });
  assert.deepEqual(toks.map(t => [t.t, !!t.glue]), [['Is', false], ['N', false], ['$_{2}$', true], ['or', false], ['$x^{2}$', false], ['-y', true], ['bigger', false], ['than', false], ['CO', false], ['$_{2}$', true], ['?', true]]);
  assert.ok(!/N<\/span> <span/.test(tokensHtml(toks)));
  const money = 'Cadburys cost \\$2 each, and Toblerones cost \\$3 each.';
  assert.deepEqual(tokenize({ question: money }).map(t => t.t), ['Cadburys', 'cost', '$2', 'each,', 'and', 'Toblerones', 'cost', '$3', 'each.']);
  assert.ok(!tokenize({ question: money }).some(t => t.m));
  assert.equal(richText('costs \\$5 and $x$'), `costs $5 and ${richText('$x$').trim()}`);
  assert.equal(plainText('costs \\$5.99, then \\$0.39'), 'costs $5.99, then $0.39');
});

test('nested LaTeX is read as words', async () => {
  const { speakMath } = await import('../js/text.js');
  assert.equal(speakMath('$\\lim_{x \\to 2} \\frac{x^{6}-64}{x^{2}-4}$'), 'the limit as x approaches 2 of x to the 6 minus 64 over x squared minus 4');
  assert.equal(speakMath('$\\int_{0}^{1} e^{x}\\,dx$'), 'the integral from 0 to 1 of e to the x dx');
  assert.equal(speakMath('$\\sqrt[3]{4}$'), 'the cube root of 4');
  assert.equal(speakMath('$\\binom{n}{2}$'), 'n choose 2');
  assert.equal(speakMath('$3^{3^{3}}$'), '3 to the 3 cubed');
  assert.equal(speakMath('$\\text{H}_{2}\\text{O}_{2} \\to 2\\text{OH}$'), 'H 2 O 2 yields 2 OH');
});
