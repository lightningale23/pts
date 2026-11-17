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

// Compare words loosely: ignore "the" and "and" anywhere ("kamacite taenite" = KAMACITE AND TAENITE), and plural endings.
const stemWord = w => (w.length > 4 && /ies$/.test(w) ? w.slice(0, -3) + 'y'
  : w.length > 4 && /(ses|xes|zes|ches|shes)$/.test(w) ? w.slice(0, -2)
  : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
const words = t => t.split(' ').filter(w => w && w !== 'the' && w !== 'and');
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
  // Questions in parts ("1) PEARLITE; 2) 3"): each part is checked on its own (see checkParts).
  const parts = answerParts(q);
  if (parts) return checkParts(q, parts, givenRaw);
  return checkWhole(q, givenRaw);
}

function checkWhole(q, givenRaw) {
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

  // A key written as a number word ("Two") takes the number (2).
  const keyWord = spec.alts.find(a => /^(zero|one|two|three|four|five|six|seven|eight|nine|ten)$/.test(a));
  if (keyWord && numberWordsToDigits(given) === numberWordsToDigits(keyWord)) return { correct: true, reason: 'number', score: 1 };

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

// ── Questions in parts ──────────────────────────────────────────────────────
// Visual bonuses and some bonuses ask two or three things and key them as "1) H; 2) M; 3) PEARLITE",
// "I) Analemma; II) ...", "1 – QUARKS; 2 – STRONG" or "1: Op-Amp; 2: Two". The player can answer
// with or without the labels and with any separators ("h, m, pearlite", "1) h 2) m 3) pearlite",
// "H M pearlite"); each part is checked by the usual rules against its own key, its own slice of
// the question (statement lists, multiple-choice options) and the ACCEPT alternates that fit it.
// All parts must be right.

const ROMAN_VAL = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
const labelValue = s => (/^\d+$/.test(s) ? +s : ROMAN_VAL[s.toLowerCase()] || 0);
// "1)", "1.", "1:", "1 –", "(1)", "I)", "II." — before whitespace or the end ("2.4", "2:1" aren't labels)
const KEY_LABEL = /(^|[\s;,(])(\d|I{1,3}|IV|VI?)\s*(?:\)|\.(?=\s|$)|:(?=\s)|\s[–—-](?=\s))/g;
const GIVEN_LABEL = /(^|[\s;,(])(\d|i{1,3}|iv|vi?)\s*(?:\)|\.(?!\d)|:(?!\d)|\s?[–—-](?=\s))/gi;

// Labels numbered 1, 2, 3... in order, the first at the very start: [{pos, end}] or null.
function labelRun(text, re, k = 0) {
  const found = [...String(text).matchAll(re)].map(m => ({ v: labelValue(m[2]), pos: m.index + m[1].length, end: m.index + m[0].length }));
  if (!found.length || found[0].v !== 1 || String(text).slice(0, found[0].pos).replace(/[\s(]/g, '')) return null;
  const run = [found[0]];
  let skipped = false;
  for (const f of found.slice(1)) {
    if (k && run.length >= k) break;
    if (f.v === run.length + 1 && f.pos >= run[run.length - 1].end) run.push(f);
    else if (f.v > run.length + 1) skipped = true;   // "1. Inflation 3. Recombination 2. ...": a matching, not parts
  }
  if (skipped && found.some(f => f.v > run.length && f.pos < run[run.length - 1].pos)) return null;
  return run;
}

// Labels in a typed answer: increasing part numbers (some may be skipped), the first at the start.
function givenLabels(text, k) {
  const found = [...String(text).matchAll(GIVEN_LABEL)].map(m => ({ v: labelValue(m[2]), pos: m.index + m[1].length, end: m.index + m[0].length }));
  if (!found.length || found[0].v < 1 || found[0].v > k || String(text).slice(0, found[0].pos).replace(/[\s(]/g, '')) return null;
  const run = [found[0]];
  for (const f of found.slice(1)) {
    const last = run[run.length - 1];
    if (f.v > last.v && f.v <= k && f.pos >= last.end) run.push(f);
  }
  return run;
}

// Where each part's question starts: "1) What is...? 2) Identify all of the following: 1) A 2) B".
// A part label is followed by a question or an instruction, not a short list item.
const ASKS = /^(?:what|which|who|whom|whose|where|when|why|how|identify|name|give|order|rank|match|describe|calculate|find|determine|provide|state|list|classify|assign|explain|is|are|does|do|would|will|can|could|if|in|by|for|true|consider|assuming|given|using|based|estimate|compute|evaluate|label|select|choose)\b/i;
function questionSlices(text, k) {
  const t = String(text || '');
  const found = [...t.matchAll(/(^|[\s/?.:;"'”])(\d|I{1,3}|IV|VI?)\s*(?:\)|\.(?=\s)|:(?=\s))/g)]
    .map(m => ({ v: labelValue(m[2]), pos: m.index + m[1].length, end: m.index + m[0].length }));
  const asks = (f, i) => {
    const next = found[i + 1]?.pos ?? t.length;
    const seg = t.slice(f.end, next).trim();
    return ASKS.test(seg) || /\?/.test(seg) || seg.length > 60;
  };
  const chosen = [];
  for (let v = 1; v <= k; v++) {
    const after = chosen.length ? chosen[chosen.length - 1].end : 0;
    const cands = found.map((f, i) => [f, i]).filter(([f]) => f.v === v && f.pos >= after);
    const pick = cands.find(([f, i]) => asks(f, i)) || cands[0];
    if (!pick) return null;
    chosen.push(pick[0]);
  }
  return chosen.map((c, i) => t.slice(c.end, chosen[i + 1]?.pos ?? t.length).trim());
}

// The parts of a keyed answer, or null when it isn't in parts. Cached on the question.
export function answerParts(q) {
  if (!q || q._part || (q.choices && q.answerLetter)) return null;
  if (q._parts !== undefined && q._partsKey === q.answer + '\u0001' + q.accept) return q._parts;
  const key = String(q.answer || '');
  const run = labelRun(key, KEY_LABEL);
  let parts = null;
  if (run && run.length >= 2) {
    const answers = run.map((r, i) => key.slice(r.end, run[i + 1]?.pos ?? key.length).replace(/^[\s:]+|[\s;,]+$/g, '').replace(/(?<=[a-z)\]])\.$/i, '').trim());
    if (answers.every(Boolean)) {
      const slices = questionSlices(q.question, answers.length);
      parts = answers.map((answer, i) => partQuestion(q, answer, slices ? slices[i] : String(q.question || ''), i));
      assignAccepts(parts, q.accept, q.reject);
    }
  }
  Object.defineProperty(q, '_parts', { value: parts, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(q, '_partsKey', { value: q.answer + '\u0001' + q.accept, writable: true, configurable: true, enumerable: false });
  return parts;
}

// One part as a question of its own. "X) TBDMS" or a bare "W" is a multiple-choice part: the
// letter or the option's text, like any multiple choice.
function partQuestion(q, answer, question, i) {
  const p = { _part: true, label: i + 1, question, answer, accept: '', reject: '', type: q.type, subject: q.subject };
  const m = answer.match(/^\(?([WXYZ])\)?(?:\s*\)?\s*(.*))?$/);
  if (m && (/^\(?[WXYZ]\)/.test(answer) || !m[2]) && !/\b[WXYZ]\)/.test(m[2] || '')) {
    const letter = m[1];
    const idx = 'WXYZ'.indexOf(letter);
    let text = (m[2] || '').trim();
    if (!text) {
      // a bare letter: the option's text from this part of the question (or the row's own options)
      const opt = String(question).match(new RegExp(`(?:^|\\s)${letter}\\)\\s*([^\\n]+?)(?=\\s+[WXYZ]\\)|\\n|$)`));
      text = opt ? opt[1].trim() : (q.choices?.[idx] || '');
    }
    p.choices = ['', '', '', ''];
    p.choices[idx] = text;
    p.answerLetter = letter;
    p.answerText = text;
  }
  return p;
}

// ACCEPT alternates of a question in parts belong to one part each: the part they're most like
// (shared words, initials, spelling); when none stands out, every part that has words.
function assignAccepts(parts, accept, reject) {
  const textParts = parts.filter(p => !p.answerLetter && /[a-z]{2}/i.test(p.answer));
  for (const [field, list] of [['accept', splitList(accept || '')], ['reject', splitList(reject || '')]]) {
    for (const alt of list) {
      const a = normalize(alt);
      if (!a) continue;
      let best = 0, at = [];
      for (const p of textParts) {
        const k = normalize(p.answer);
        const aw = new Set(words(stem(a))), kw = words(stem(k));
        const shared = kw.filter(w => aw.has(w) && w.length > 2).length / Math.max(1, Math.min(aw.size, kw.length));
        const initials = kw.map(w => w[0]).join('') === squash(a) ? 1 : 0;
        const sc = Math.max(similarity(squash(a), squash(k)), shared, initials);
        if (sc > best + 1e-9) { best = sc; at = [p]; } else if (Math.abs(sc - best) <= 1e-9) at.push(p);
      }
      for (const p of (best >= 0.45 ? at : textParts)) p[field] = p[field] ? `${p[field]}; ${alt}` : alt;
    }
  }
}

// Split the typed answer into one piece per part and check them.
function checkParts(q, parts, givenRaw) {
  const raw = String(givenRaw ?? '').trim();
  const k = parts.length;
  if (!raw) return { correct: false, reason: 'no answer', score: 0, parts: parts.map(p => ({ label: p.label, given: '', correct: false })) };
  const memo = new Map();
  const judge = (i, piece) => {
    const s = piece.replace(/^[\s;,/|&]+|[\s;,/|&]+$/g, '').replace(/^and\s+|\s+and$/gi, '').trim();
    const key = `${i}\u0001${s}`;
    if (!memo.has(key)) {
      // "1 h 2 m 3 pearlite": a part's own number in front of it is a label
      const bare = s.replace(new RegExp(`^(?:${i + 1}|${['i', 'ii', 'iii', 'iv', 'v', 'vi'][i]})\\s*[).:–—-]?\\s+(?=\\S)`, 'i'), '');
      memo.set(key, !!s && (checkWhole(parts[i], s).correct || (bare !== s && checkWhole(parts[i], bare).correct)));
    }
    return memo.get(key);
  };
  const result = pieces => {
    const res = pieces.map((g, i) => ({ label: i + 1, given: g.replace(/^[\s;,/|&]+|[\s;,/|&]+$/g, '').trim(), correct: judge(i, g) }));
    const n = res.filter(r => r.correct).length;
    return { correct: n === k, reason: n === k ? 'parts' : 'parts wrong', score: n / k, parts: res };
  };

  // 1. The player labeled the parts ("1) h 2) m 3) pearlite", "I. emission II. dark", "1) h 3) pearlite").
  const run = givenLabels(raw, k);
  if (run && run.length >= 2) {
    const pieces = Array(k).fill('');
    run.forEach((r, i) => { pieces[r.v - 1] = raw.slice(r.end, run[i + 1]?.pos ?? raw.length); });
    return result(pieces);
  }

  // 2. Otherwise the cut points: separators first (; newline |), then commas, "and", "/", spaces.
  // The split that gets the most parts right wins (parts stay in order, nothing is left out).
  const toks = raw.match(/[;\n|]+|,|\/|\s+(?:and|then)\s+|\s+|[^;\n|,/\s]+/gi) || [];
  const cuts = [0];   // token positions where a piece may start
  for (let t = 0; t < toks.length; t++) if (!/^[^;\n|,/\s]/.test(toks[t])) cuts.push(t + 1);
  const strength = t => (/[;\n|]/.test(toks[t - 1] || '') ? 3 : /,|\//.test(toks[t - 1] || '') ? 2 : /and|then/i.test(toks[t - 1] || '') ? 1.5 : 1);
  const text = (a, b) => toks.slice(a, b).join('');
  const strong = cuts.filter(c => c > 0 && strength(c) === 3);
  if (strong.length === k - 1) {
    const r = result([0, ...strong, toks.length].slice(0, -1).map((c, i, arr) => text(c, [...strong, toks.length][i])));
    if (r.correct) return r;
  }
  // Best split by dynamic programming over cut points (too many words: separators only).
  const usable = toks.length > 80 ? cuts.filter(c => c === 0 || strength(c) >= 2) : cuts;
  const pts = [...new Set([...usable, toks.length])].sort((a, b) => a - b);
  // best[j][c]: [parts right, cut strength, cuts] for parts 0..j-1 covering tokens before cut c
  let best = new Map([[0, [0, 0, []]]]);
  for (let j = 0; j < k; j++) {
    const next = new Map();
    for (const [start, [right, str, cs]] of best) {
      for (const end of pts) {
        if (end < start || (j === k - 1 && end !== toks.length)) continue;
        // most parts right, then fewest empty pieces, then cuts at the strongest separators
        const sc = [right + (end > start && judge(j, text(start, end)) ? 1 : 0), str + (end > start ? 100 : 0) + (end < toks.length ? strength(end) : 0), [...cs, end]];
        const cur = next.get(end);
        if (!cur || sc[0] > cur[0] || (sc[0] === cur[0] && sc[1] > cur[1])) next.set(end, sc);
      }
    }
    best = next;
  }
  const [, , ends] = best.get(toks.length);
  return result(ends.map((e, i) => text(i ? ends[i - 1] : 0, e)));
}

// The full answers a player could type for a question in parts: the key's parts joined, and with
// each part's alternates (ACCEPT, OR) in its place. For checking every official answer is taken.
export function partAnswerForms(q, formsOf) {
  const parts = answerParts(q);
  if (!parts) return null;
  const each = parts.map(p => (p.answerLetter ? [p.answerLetter, p.answerText].filter(Boolean) : formsOf(p)));
  if (each.some(f => !f.length)) return [];
  const base = each.map(f => f[0]);
  const out = [base.join('; '), base.map((f, i) => `${i + 1}) ${f}`).join(' ')];
  each.forEach((f, i) => f.slice(1).forEach(alt => out.push(base.map((b, j) => (j === i ? alt : b)).join('; '))));
  return [...new Set(out)];
}
