import { evaluateLoose, roundsTo, sameExpression, greekToNames } from './mathval.js';
import { listLabels, isOrderingQuestion } from './text.js';

// Answer checking for Science Bowl answers.
// Handles: multiple-choice letters or option text, ACCEPT / DO NOT ACCEPT notes,
// optional words in parentheses, numeric equivalence (0.5 = 1/2 = 5 x 10^-1),
// "1 and 3"-style statement lists (also "13" or "one and three"), plurals,
// lead-ins like "it's", more precise numbers that round to the answer, and typos.
// When in doubt it accepts: practice should reward knowing the answer, not exact typing.

export function normalize(s) {
  return greekToNames(String(s ?? '').replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ\b|\\circ\b|\\degree\b/g, '°'))   // $60^{\circ}$ = 60°
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\\?\$/g, ' ')
    .replace(/π/g, ' pi ').replace(/√/g, ' sqrt ').replace(/²/g, '^2').replace(/³/g, '^3').replace(/±/g, '+-')
    .replace(/(^|\s)([a-z])\*(?=\s|$)/g, '$1$2 star')  // "Sagittarius A*" is not "Sagittarius A"
    .replace(/\\(times|cdot)/g, ' x ')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')   // thousands separators
    .replace(/[−–—]/g, '-')
    .replace(/[×]/g, 'x')
    .replace(/[^a-z0-9.\-+/^% ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');
}

// Ignore spaces and hyphens between letters ("x-ray" = "xray"), but keep minus signs.
const squash = s => s.replace(/\s+/g, '').replace(/([a-z])-(?=[a-z])/g, '$1');

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a, b) {
  if (!a && !b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// Alternatives are separated by ";", "|", "," or "or", but a list of statement numbers
// ("4, 3, 2, 1") is one alternative, not four.
// A comma inside brackets or between digits isn't a separator: "(1,1,-1)", "1,3-diazole",
// "1,600,000 J" are single answers. The whole comma-separated entry is kept as well, so typing
// "anhydrobiosis, anoxybiosis, cryobiosis" matches an entry listing those three.
const NUMBER_LIST = /^(?:\d+|[ivx]+)(?:\s*(?:,\s*(?:and\s+)?|\band\b)\s*(?:\d+|[ivx]+))+$/i;
function splitCommas(part) {
  const out = [];
  let depth = 0, cur = '';
  for (let i = 0; i < part.length; i++) {
    const c = part[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0 && !(/\d/.test(part[i - 1] || '') && /[-\d]/.test(part[i + 1] || ''))) {
      out.push(cur); cur = ''; continue;
    }
    cur += c;
  }
  out.push(cur);
  const pieces = out.flatMap(p => p.split(/\s*\bor\b\s*/i));
  return pieces.length > 1 && out.length > 1 ? [...pieces, part] : pieces;
}
const splitList = s => String(s).split(/\s*[;|]\s*/)
  .flatMap(part => (NUMBER_LIST.test(part.trim()) ? [part] : splitCommas(part)))
  .map(x => x.trim()).filter(Boolean);

// The [3] in "\\sqrt[3]{2}" is part of the math, not a note: hidden while notes are taken out.
export const hideRoots = s => String(s || '').replace(/\\sqrt\[([^\]]*)\]/g, '\\sqrt\u0003$1\u0004');
export const showRoots = s => String(s).replace(/\u0003/g, '[').replace(/\u0004/g, ']');

// Pull ACCEPT / DO NOT ACCEPT notes out of an answer line and expand optional parts.
export function parseAnswerSpec(answer, acceptField = '', rejectField = '') {
  let main = hideRoots(answer);
  const alts = [];
  const rejects = [];
  main = main.replace(/[([]([^()[\]]*)[)\]]/g, (whole, inner) => {
    const m = inner.match(/^\s*(do not accept|don't accept|reject|do not take|accept|also accept|prompt on)\s*:?\s*(.*)$/i);
    if (!m) return whole;
    const kind = m[1].toLowerCase();
    if (kind.startsWith('prompt')) return ' ';
    // "ACCEPT: X, DO NOT ACCEPT: Y" in the same parenthesis
    const [acc, rej] = m[2].split(/do not accept\s*:?|don't accept\s*:?/i);
    if (/^(do not|don't|reject)/.test(kind)) rejects.push(...splitList(m[2]));
    else { alts.push(...splitList(acc)); if (rej) rejects.push(...splitList(rej)); }
    return ' ';
  });
  // A trailing "ACCEPT: ..." without brackets.
  main = main.replace(/\b(also accept|accept)\s*:\s*(.*)$/i, (_, __, rest) => { alts.push(...splitList(rest)); return ' '; });
  // Reading guides aren't part of the answer: "[the quantity RT squared]", "(read: big o of n)".
  main = main.replace(/\[[^\]]*\]/g, ' ').replace(/\((?:read|pronounced|say)\b[^)]*\)/gi, ' ');

  // Main answer: "X OR Y" are alternatives; parentheses mark optional text.
  const mainAlts = main.split(/\s+\bOR\b\s+/).map(s => s.trim()).filter(Boolean);
  for (const a of mainAlts) {
    alts.unshift(a.replace(/[([][^)\]]*[)\]]/g, ' '));   // without the optional part
    alts.push(a.replace(/[()[\]]/g, ' '));              // with the optional part
  }
  if (acceptField) alts.push(...splitList(acceptField));
  if (rejectField) rejects.push(...splitList(rejectField));
  const uniq = arr => [...new Set(arr.map(a => normalize(showRoots(a))).filter(Boolean))];
  return { alts: uniq(alts), rejects: uniq(rejects), main: normalize(showRoots(mainAlts[0] || '')) };
}

// Parse a leading number: 3, -2.5, .5, 1/2, 3e5, 3 x 10^5, 3*10^-2, 50%
export function parseNumber(s) {
  const t = normalize(s);
  let m = t.match(/^([-+]?\d+)\s*\/\s*(\d+)(?!\.)/);
  if (m) return { value: +m[1] / +m[2], rest: t.slice(m[0].length).trim(), mantissa: m[1], exp: 0 };
  m = t.match(/^([-+]?(?:\d+\.?\d*|\.\d+))(?:\s*(?:e|(?:x|times|\*)\s*10\s*\^?)\s*([-+]?\d+))?/);
  if (!m) return null;
  let value = parseFloat(m[1]);
  const exp = m[2] != null ? +m[2] : 0;
  if (exp) value *= Math.pow(10, exp);
  let rest = t.slice(m[0].length).trim();
  if (rest.startsWith('%')) { value /= 100; rest = rest.slice(1).trim(); }
  return { value, rest, mantissa: m[1], exp };
}

const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const numberWordsToDigits = t => t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, w => NUMBER_WORDS[w]);

// Strip conversational lead-ins people type when answering fast: "it's", "the answer is", "i think"…
const LEAD = /^(?:(?:um+|uh+|so|ok|okay|i think|i guess|maybe|probably|my answer is|the answer is|answer is|answer|it s|its|it is|is|that s|thats|that is|the|a|an)\b\s*)+/;
const TRAIL = /\s*\b(?:i think|maybe|probably)$/;
function stripFiller(t) {
  const out = t.replace(LEAD, '').replace(TRAIL, '').trim();
  return out || t;
}

// Compare words loosely: ignore "the" anywhere and plural endings.
const stemWord = w => (w.length > 4 && /ies$/.test(w) ? w.slice(0, -3) + 'y'
  : w.length > 4 && /(ses|xes|zes|ches|shes)$/.test(w) ? w.slice(0, -2)
  : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
const words = t => t.split(' ').filter(w => w && w !== 'the');
const stem = t => words(t).map(stemWord).join(' ');

// Statement-number answers ("1 AND 3"): the set of numbers, ignoring order and separators.
// With allowSplit, "13" counts as 1 and 3 (only used when every correct statement is a single digit).
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const romanToDigits = t => t.replace(/\b(viii|vii|vi|iv|ix|iii|ii|i|v|x)\b/g, r => ROMAN[r]);

// Does this question number its statements I, II, III (or key its answer that way)?
const usesRoman = q => /(?:^|\n)\s*(?:I{1,3}|IV|VI{0,3}|IX|X)\s*[).:]/.test(q.question || '') || !!listLabels(q.question)?.roman ||
  /^\s*(?:I{1,3}|IV|VI{0,3}|IX|X)\b(?:[\s,]+(?:AND\s+)?(?:I{1,3}|IV|VI{0,3}|IX|X)\b)*(?:\s+ONLY)?\s*$/i.test(q.answer || '');

function numberList(s, allowSplit = false, keepOrder = false, roman = false) {
  let t = numberWordsToDigits(normalize(s));
  if (roman) t = romanToDigits(t);
  t = t
    .replace(/\b(statements?|numbers?|choices?|and|only|both|just|then)\b/g, ' ');
  if (!/\d/.test(t) || !/^[\d\s,&+>]*$/.test(t)) return null;
  let nums = t.match(/\d+/g);
  if (allowSplit) nums = nums.flatMap(n => (n.length > 1 ? n.split('') : [n]));
  nums = nums.map(Number);
  // "Order/rank the following" answers are sequences: 231 is not 132.
  return keepOrder ? nums : [...new Set(nums)].sort((a, b) => a - b);
}

// Questions whose answer is a sequence rather than a set.
const isOrdering = q => /\b(sequence|chronological|in (increasing|decreasing))\b/i.test(q.question || '') || isOrderingQuestion(q.question);

function textMatch(given, alt) {
  if (!given || !alt) return 0;
  if (given === alt || squash(given) === squash(alt)) return 1;
  const gs = stem(given), as = stem(alt);
  if (gs === as || squash(gs) === squash(as)) return 1;
  let best = similarity(squash(gs), squash(as));
  // Same words with a typo in each: judge word by word, in any order.
  const gw = words(gs), aw = words(as);
  if (gw.length === aw.length && aw.length > 1) {
    const left = gw.slice();
    let ok = true, total = 0;
    for (const a of aw) {
      let bi = -1, bs = 0;
      left.forEach((g, i) => { const v = similarity(g, a); if (v > bs) { bs = v; bi = i; } });
      if (bi < 0 || bs < threshold(a.length)) { ok = false; break; }
      total += bs;
      left.splice(bi, 1);
    }
    if (ok) best = Math.max(best, Math.min(0.99, total / aw.length + 0.1));
  }
  return best;
}

// How similar a typed answer must be. Very short answers (element symbols, Na vs Ne) must be exact.
function threshold(len) {
  if (len <= 4) return 1;
  if (len <= 6) return 0.8;    // one typo
  if (len <= 8) return 0.75;   // mitosis vs meiosis (0.71) still fails
  return 0.72;
}

const decimals = str => (str.match(/\.(\d+)/)?.[1].length) || 0;

// Numbers: equal values match; a more precise answer that rounds to the official one also matches
// (9.81 for 9.8, 2.998 x 10^8 for 3.0 x 10^8), but plain integers must be exact.
function numbersMatch(g, a) {
  const tol = (1e-9 * Math.abs(a.value) || 1e-12);
  if (Math.abs(a.value - g.value) <= tol) return true;
  const d = decimals(a.mantissa), e = a.exp;
  if (d === 0 && e === 0) return false;
  // Rounding is only forgiven for small differences: 9.81 for 9.8, not 0.44 for 0.4.
  if (Math.abs(g.value - a.value) > 0.01 * Math.abs(a.value)) return false;
  const scale = Math.pow(10, e);
  const gm = g.value / scale, am = a.value / scale;
  return Math.abs(Number(gm.toFixed(d)) - Number(am.toFixed(d))) < 1e-9;
}

// Words used in the question bank. A close spelling is forgiven as a typo, unless the typed
// word is itself a term the bank uses and the answer doesn't (troposphere vs stratosphere,
// mitosis vs meiosis, ionic vs ionization): then it's a different answer.
// setVocabulary takes the texts, or a function returning them; the word list is built the
// first time it's needed (or ahead of time with buildVocabulary), so loading stays fast.
let VOCAB = null, VOCAB_SRC = null;
export function setVocabulary(texts) { VOCAB = null; VOCAB_SRC = texts; }
export function buildVocabulary() {
  if (VOCAB || !VOCAB_SRC) return VOCAB;
  const texts = typeof VOCAB_SRC === 'function' ? VOCAB_SRC() : VOCAB_SRC;
  VOCAB = new Set();
  for (const t of texts) for (const w of normalize(t).split(' ')) if (w.length >= 5 && /^[a-z]+$/.test(w)) VOCAB.add(stemWord(w));
  return VOCAB;
}
const digitsOf = t => (String(t).match(/\d+(?:\.\d+)?/g) || []).join(' ');
// Minus signs (not hyphens inside words): "ln x" is not a typo of "-ln x".
const minusSigns = t => (String(t).match(/(^|[\s(=+*/^])-/g) || []).length;
const prefixLen = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
function isOtherTerm(given, alt) {
  if (!buildVocabulary()) return false;
  const aw = words(stem(alt));
  return words(stem(given)).some(g => g.length >= 5 && !aw.includes(g) && VOCAB.has(g) &&
    // ...but another form of the same word is fine: mitochondrion / mitochondria, nucleus / nuclei
    !aw.some(a => { const p = prefixLen(g, a); return p >= 5 && p >= 0.75 * Math.max(g.length, a.length); }));
}

// The thing the question asks for is implied, so the answer can leave it off: "O" for
// O HORIZON when the question asks "What soil horizon...", "Doppler" for DOPPLER EFFECT
// ("Name this effect"), "sulfuric" for SULFURIC ACID ("What acid..."). It also works the
// other way: "Richter scale" for an answer keyed as RICHTER.
const ASKERS = new Set(['what', 'which', 'this', 'these', 'whose']);
const STOP = new Set(['is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'has', 'have', 'had',
  'in', 'on', 'at', 'for', 'from', 'by', 'with', 'that', 'which', 'whose', 'when', 'where', 'as', 'if', 'to', 'be', 'and', 'or',
  'describes', 'describe', 'causes', 'cause', 'results', 'forms', 'occurs', 'best', 'most', 'least', 'named', 'called', 'refers',
  'allows', 'explains', 'helps', 'makes', 'contains', 'produces', 'uses', 'used', 'found', 'known', 'often', 'also', 'typically']);
const FILLER = new Set(['of', 'the', 'a', 'an', 'kind', 'type', 'sort', 'name', 'specific', 'general', 'two', 'three', 'four']);
function impliedWords(question) {
  const w = normalize(String(question || '').replace(/(?<!\\)\$[^$]*[^$\\]\$/g, ' ')).replace(/[^a-z' -]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set();
  const PREP = new Set(['in', 'of', 'by', 'to', 'for', 'with', 'from', 'at', 'on', 'through', 'during', 'into', 'under']);
  for (let i = 0; i < w.length; i++) {
    if (!ASKERS.has(w[i]) && !(w[i] === 'name' && ['this', 'these', 'the'].includes(w[i + 1]))) continue;
    if ((w[i] === 'which' || w[i] === 'whose') && PREP.has(w[i - 1])) continue;   // "in which an electron..."
    let j = i + 1;
    // "What is the balance between ... called?": the noun after "is the"
    if (['is', 'are', 'was', 'were'].includes(w[j]) && w[j + 1] === 'the') j += 2;
    for (let n = 0; j < w.length && n < 6; j++, n++) {
      if (STOP.has(w[j])) break;
      if (w[j].length > 1 && !/^[ivx]+$/.test(w[j]) && !FILLER.has(w[j]) && !ASKERS.has(w[j])) out.add(stemWord(w[j]));
    }
  }
  return out;
}
function withoutImplied(t, implied) {
  if (!implied.size) return t;
  const ws = t.split(' ');
  while (ws.length > 1 && implied.has(stemWord(ws[ws.length - 1]))) ws.pop();
  while (ws.length > 1 && implied.has(stemWord(ws[0]))) ws.shift();
  return ws.join(' ');
}

// Numbered statements in the question ("1) Alpha 2) Beta 3) Gamma", or "1) Alpha; 2) Beta")
// can be answered by name: "alpha, beta, gamma" counts as 1, 2, 3.
function statementNames(question) {
  const text = String(question || '');
  const out = [];
  const re = /(?:^|\n|[;:,.]\s|\s)\(?(\d)\)\s*([^\n;]+?)(?=\s*(?:;|\n|$|,?\s*(?:and\s+)?\(?\d\)\s))/g;
  let m;
  while ((m = re.exec(text))) {
    const n = +m[1];
    const name = normalize(m[2].replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')).replace(/[.?]$/, '').trim();
    if (name && !out[n]) out[n] = name;
  }
  return out.length > 2 && out.slice(1).every(Boolean) ? out : null;
}
function namesToNumbers(given, names) {
  let rest = ` ${given} `;
  const found = [];
  // longest names first, so "red giant branch" wins over "red giant"
  const order = names.map((name, n) => [name, n]).filter(([name]) => name).sort((a, b) => b[0].length - a[0].length);
  for (const [name, n] of order) {
    for (const form of new Set([name, stem(name)])) {
      const i = rest.indexOf(` ${form} `);
      if (i >= 0) { found.push([i, n]); rest = rest.slice(0, i) + ' ' + '#'.repeat(form.length) + ' ' + rest.slice(i + form.length + 2); break; }
    }
  }
  if (found.length < 1) return null;
  // nothing left but separators: "alpha, beta and gamma", "gamma then beta then alpha"
  if (rest.replace(/#+/g, ' ').replace(/\b(and|then|only|followed by|is|are|least|most|to|lowest|highest|greatest|smallest|both|all)\b|[,;<>&/+-]/g, ' ').trim()) return null;
  return found.sort((a, b) => a[0] - b[0]).map(([, n]) => n).join(', ');
}

export function checkAnswer(q, givenRaw) {
  if (!q.choices && /\b[a-z]{2,}/i.test(String(givenRaw ?? ''))) {
    const names = statementNames(q.question);
    const asNumbers = names && namesToNumbers(normalize(givenRaw), names.map(n => n || ''));
    if (asNumbers && !/^\d/.test(normalize(givenRaw))) {
      const r = checkAnswer(q, asNumbers);
      if (r.correct || r.reason === 'list') return r;
    }
  }
  const raw = normalize(givenRaw);
  if (!raw) return { correct: false, reason: 'no answer', score: 0 };
  const given = stripFiller(raw);

  const spec = parseAnswerSpec(q.answer, q.accept, q.reject);
  if (!q.choices) {
    const implied = impliedWords(q.question);
    for (const a of [...spec.alts]) {
      const short = withoutImplied(a, implied);
      if (short !== a && !spec.alts.includes(short)) spec.alts.push(short);
    }
    // Just repeating the question's noun ("horizon" for "What soil horizon...") isn't an answer.
    if (implied.size && words(given).every(w => implied.has(stemWord(w))) && !spec.alts.includes(given)) {
      return { correct: false, reason: 'incorrect', score: 0 };
    }
    const g = withoutImplied(given, implied);
    if (g !== given && spec.alts.some(a => withoutImplied(a, implied) === g)) return { correct: true, reason: 'exact', score: 1 };
  }
  if (spec.rejects.some(r => r === given || squash(stem(r)) === squash(stem(given)))) {
    return { correct: false, reason: 'not accepted', score: 0 };
  }

  // Multiple choice is strict: the letter, or the option written exactly (ignoring
  // capitalization, spacing and punctuation), or an equal number in simplest form.
  if (q.choices && q.answerLetter) return checkMultipleChoice(q, raw, spec);

  // Statement-number lists ("select all that apply")
  const ordered = isOrdering(q);
  const roman = usesRoman(q);

  // "All": typing every statement number counts, and so does "all" for a full list.
  const n = statementCount(q);
  if (n >= 2 && !ordered) {
    const everything = Array.from({ length: n }, (_, i) => i + 1).join(',');
    const keyIsAll = spec.alts.some(isAllWord);
    const keyIsFullList = spec.alts.some(a => numberList(a, false, false, roman)?.join(',') === everything);
    const g = numberList(given, true, false, roman);
    if (keyIsAll && g) {
      const ok = g.join(',') === everything;
      return { correct: ok, reason: 'list', score: ok ? 1 : 0 };
    }
    if ((keyIsAll || keyIsFullList) && isAllWord(given)) return { correct: true, reason: 'list', score: 1 };
  }
  // "None" for a list keyed "None of them" / "Neither" (the tap buttons send "None")
  if (n >= 2 && isNoneWord(given)) {
    const keyIsNone = spec.alts.some(a => isNoneWord(a) || /^(0|zero)$/.test(normalize(a)));
    return { correct: keyIsNone, reason: 'list', score: keyIsNone ? 1 : 0 };
  }

  // Every keyed list is tried (an answer can be keyed as "1 AND 3" and also accept "20 AND 110").
  let listMismatch = false;
  for (const alt of spec.alts) {
    const single = alt.replace(/\s+/g, '');
    // An ordering answer written as one run of digits ("231") is a sequence of single digits.
    const altNums = numberList(alt, ordered && /^\d{2,9}$/.test(single), ordered, roman);
    // ("II ONLY" is a one-statement list when the statements are numbered I, II, III)
    if (!altNums || (altNums.length < 2 && !roman)) continue;
    const g = numberList(given, altNums.every(n => n <= 9), ordered, roman);
    if (g) {
      if (g.join(',') === altNums.join(',')) return { correct: true, reason: 'list', score: 1 };
      listMismatch = true;
    }
  }
  // A lone number still counts when the key also lists it alone ("6", ACCEPT "6:1").
  const lone = numberList(given);
  const keyedAlone = lone?.length === 1 && spec.alts.some(a => numberList(a)?.length === 1 && numberList(a)[0] === lone[0]);
  if (listMismatch && !keyedAlone) return { correct: false, reason: 'list', score: 0 };

  // Numeric answers: units are optional, but a different expression after the
  // number ("3x^3" vs "3x^2") must match.
  const gNum = parseNumber(numberWordsToDigits(given));
  const unitLike = r => /^[a-z /%.]+$/.test(r);
  if (gNum && !numberList(given)?.slice(1).length) {
    for (const alt of spec.alts) {
      const aNum = parseNumber(alt);
      if (!aNum || !numbersMatch(gNum, aNum)) continue;
      const gR = gNum.rest, aR = aNum.rest;
      const isExpr = /^[a-z]\s*\^/.test(aR) || /^[xyz](\b|$)/.test(aR); // "x^2", "x squared"
      // A bare number is fine when the key only adds units ("9.8" for 9.8 m/s^2), not when the
      // key goes on with more numbers ("1" for "1,3-diazole" or the vector "(1,1,-1)").
      const unitsOnly = r => !r || (/^[a-z%/°]/.test(r) && !/(^|\s)-?\d/.test(r.replace(/\^-?\d+/g, '')));
      const ok = !gR ? !isExpr && unitsOnly(aR)
        : !aR ? unitLike(gR)
        : squash(gR) === squash(aR) || (unitLike(gR) && unitLike(aR));
      if (ok) return { correct: true, reason: 'number', score: 1 };
    }
  }

  // Math answers (often keyed in LaTeX): compare values, so 0.5, 1/2 and $\frac{1}{2}$ match,
  // √3/2 matches sqrt(3)/2, and a decimal typed to 3+ significant figures that rounds
  // correctly also counts (0.866 for √3/2).
  const typed = String(givenRaw ?? '').trim().replace(/^(?:it'?s|its|it is|the answer is|answer:?)\s+/i, '');
  const looksLikeList = !/[√π^*/()\\]|sqrt|pi|\.\d/i.test(typed) && (numberList(given)?.length ?? 0) > 1;
  const gVal = looksLikeList ? null : evaluateLoose(typed);
  if (gVal != null) {
    for (const keyed of rawAlternatives(q)) {
      const aVal = evaluateLoose(keyed);
      if (aVal == null) continue;
      const exact = Math.abs(gVal - aVal) <= (1e-9 * Math.abs(aVal) || 1e-12);
      const rounded = roundsTo(typed.replace(/\s*[a-zA-Z][a-zA-Z /.]*$/, ''), aVal);
      if (exact || rounded) return { correct: true, reason: 'equal value', score: 1 };
    }
  }

  // Expressions with variables: "1/4 omega" for ω/4, "1/2 mv^2" for ½mv². A keyed form that is
  // the same kind of expression but a different one ("ω/2" for ω/4, "M/m" for m/M) can't be
  // matched as a typo below.
  const differs = new Set();
  if (!looksLikeList) {
    for (const keyed of rawAlternatives(q)) {
      // "$18v$ (3 root 6 over 2 v)": the expression, or the gloss in parentheses
      const gloss = keyed.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
      const forms = gloss ? [keyed, gloss[1], gloss[2]] : [keyed];
      const results = forms.map(f => sameExpression(typed, f));
      if (results.includes(true)) return { correct: true, reason: 'equal value', score: 1 };
      if (results.includes(false)) differs.add(squash(normalize(keyed)));
    }
  }

  // Text answers
  let best = 0;
  for (const alt of spec.alts) {
    if (differs.has(squash(alt))) continue;
    const sc = Math.max(textMatch(given, alt), given !== raw ? textMatch(raw, alt) : 0);
    // A near miss that is really another term ("troposphere" for STRATOSPHERE) isn't a typo,
    // and neither is one with different numbers or signs in it ("2sqrt2" for √2, "x^3" for x^2,
    // "ln x" for -ln x).
    if (sc < 1 && sc >= threshold(squash(alt).length) && (isOtherTerm(given, alt) || digitsOf(given) !== digitsOf(alt) || minusSigns(given) !== minusSigns(alt))) {
      best = Math.max(best, sc); continue;
    }
    if (sc >= threshold(squash(alt).length)) return { correct: true, reason: sc === 1 ? 'exact' : 'close spelling', score: sc };
    best = Math.max(best, sc);
  }
  return { correct: false, reason: best >= 0.6 ? 'close' : 'incorrect', score: best };
}

// ── Multiple choice ─────────────────────────────────────────────────────────
const exactForm = t => squash(normalize(String(t || '').replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')));
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

// A number written in a plain form: integer, decimal, simplified fraction or scientific
// notation. Unsimplified fractions (2/4) and expressions (1+1, sqrt 4) return null.
function plainNumber(t) {
  const s = normalize(String(t || '').replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')).replace(/\s+/g, ' ');
  const frac = s.match(/^([-+]?\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const n = +frac[1], d = +frac[2];
    if (!d || gcd(n, d) !== 1) return null;
    return n / d;
  }
  const num = parseNumber(s);
  if (!num || num.rest) return null;
  return num.value;
}

function checkMultipleChoice(q, given, spec) {
  const correctIdx = 'WXYZ'.indexOf(q.answerLetter);
  const correctText = q.choices[correctIdx] || q.answerText;
  // Pronunciation guides in an option ("Methionine (muh-THY-uh-neen)", "Flow cytometry [sigh-TAW-muh-tree]")
  // aren't part of the answer, and the key's own wording of the answer counts too.
  const guideless = t => String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/\((?:read:?|pronounced:?)?\s*[A-Za-z'’]+(?:[-\s][A-Za-z'’]+)*-[A-Za-z'’-]+\)/g, ' ');
  const texts = [correctText, guideless(correctText), q.answerText, guideless(q.answerText)].filter(Boolean);
  // (the typed answer arrives normalized, so compare normalized forms too: "$\frac{3}{5}$")
  const forms = [...new Set([...texts.map(exactForm), ...texts.map(t => exactForm(normalize(t)))])].filter(Boolean);
  const sameAsCorrect = text => {
    if (forms.includes(exactForm(text)) || forms.includes(exactForm(guideless(text)))) return true;
    const a = plainNumber(correctText), g = plainNumber(text);
    return a != null && g != null && Math.abs(a - g) <= (1e-9 * Math.abs(a) || 1e-12);
  };

  if (sameAsCorrect(given)) return { correct: true, reason: 'choice text', score: 1 };
  const letter = given.match(/^([wxyz])(?:\s|\)|\.|$)/);
  if (letter) {
    const rest = given.slice(1).replace(/^[).\s]+/, '');
    const letterOk = letter[1].toUpperCase() === q.answerLetter;
    // "x" alone counts; "x) text" counts only when the letter and the text are both right.
    const ok = letterOk && (!rest || sameAsCorrect(rest));
    return { correct: ok, reason: ok ? 'letter' : 'wrong letter', score: ok ? 1 : 0 };
  }
  if (splitList(q.accept || '').some(a => exactForm(a) === exactForm(given))) {
    return { correct: true, reason: 'accepted alternate', score: 1 };
  }
  return { correct: false, reason: 'choice', score: 0 };
}

// ── Helpers for lists and math ──────────────────────────────────────────────
// How many numbered statements the question lists ("1) ... 2) ... 3) ...").
function statementCount(q) {
  const text = String(q.question || '');
  let nums = [...text.matchAll(/(?:^|\n)\s*(\d{1,2})\s*[).]/g)].map(m => +m[1]);
  if (nums.length < 2) {
    nums = [...text.matchAll(/(?:^|\n)\s*(I{1,3}|IV|VI{0,3}|IX|X)\s*[).:]/g)].map(m => ROMAN[m[1].toLowerCase()]);
  }
  // or written on one line: "I) Graphite II) HNO3 III) HCl"
  return nums.length >= 2 ? Math.max(...nums) : (listLabels(text)?.n || 0);
}

function isNoneWord(t) {
  return /^(none|neither|none of (them|the above|these|those|the statements|the (two|three|four|five|six|2|3|4|5|6))|neither of (them|these|those))$/
    .test(normalize(t));
}

function isAllWord(t) {
  return /^(all|all of (them|the above|these|the statements)|all (two|three|four|five|six|2|3|4|5|6)( of them)?|every one|everything)$/
    .test(normalize(t));
}

// The keyed answer and its listed alternates, before any normalizing (so LaTeX survives).
function rawAlternatives(q) {
  const main = hideRoots(q.answer)
    .replace(/[([][^()[\]]*\b(accept|do not accept|don't accept|reject|prompt)\b[^()[\]]*[)\]]/gi, ' ')
    .replace(/^\s*\(?[WXYZ]\)\s*/i, '')
    .replace(/\[[^\]]*\]/g, ' ').replace(/\((?:read|pronounced|say)\b[^)]*\)/gi, ' ');  // reading guides
  return [...main.split(/\s+\bOR\b\s+/), ...String(q.accept || '').split(/\s*[;|]\s*/)]
    .map(t => showRoots(t).trim()).filter(Boolean);
}
