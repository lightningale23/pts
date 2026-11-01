import { evaluateLoose, roundsTo } from './mathval.js';

// Answer checking for Science Bowl answers.
// Handles: multiple-choice letters or option text, ACCEPT / DO NOT ACCEPT notes,
// optional words in parentheses, numeric equivalence (0.5 = 1/2 = 5 x 10^-1),
// "1 and 3"-style statement lists (also "13" or "one and three"), plurals,
// lead-ins like "it's", more precise numbers that round to the answer, and typos.
// When in doubt it accepts: practice should reward knowing the answer, not exact typing.

export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\$/g, ' ')
    .replace(/π/g, ' pi ').replace(/√/g, ' sqrt ').replace(/²/g, '^2').replace(/³/g, '^3')
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

const splitList = s => s.split(/\s*(?:;|,|\bor\b|\|)\s*/i).map(x => x.trim()).filter(Boolean);

// Pull ACCEPT / DO NOT ACCEPT notes out of an answer line and expand optional parts.
export function parseAnswerSpec(answer, acceptField = '', rejectField = '') {
  let main = String(answer || '');
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

  // Main answer: "X OR Y" are alternatives; parentheses mark optional text.
  const mainAlts = main.split(/\s+\bOR\b\s+/).map(s => s.trim()).filter(Boolean);
  for (const a of mainAlts) {
    alts.unshift(a.replace(/[([][^)\]]*[)\]]/g, ' '));   // without the optional part
    alts.push(a.replace(/[()[\]]/g, ' '));              // with the optional part
  }
  if (acceptField) alts.push(...splitList(acceptField));
  if (rejectField) rejects.push(...splitList(rejectField));
  const uniq = arr => [...new Set(arr.map(normalize).filter(Boolean))];
  return { alts: uniq(alts), rejects: uniq(rejects), main: normalize(mainAlts[0] || '') };
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
function numberList(s, allowSplit = false, keepOrder = false) {
  let t = numberWordsToDigits(normalize(s))
    .replace(/\b(statements?|numbers?|choices?|and|only|both|just|then)\b/g, ' ');
  if (!/\d/.test(t) || !/^[\d\s,&+>]*$/.test(t)) return null;
  let nums = t.match(/\d+/g);
  if (allowSplit) nums = nums.flatMap(n => (n.length > 1 ? n.split('') : [n]));
  nums = nums.map(Number);
  // "Order/rank the following" answers are sequences: 231 is not 132.
  return keepOrder ? nums : [...new Set(nums)].sort((a, b) => a - b);
}

// Questions whose answer is a sequence rather than a set.
const isOrdering = q => /\b(order|rank|arrange|sequence|chronological|from (least|most|lowest|highest|smallest|largest|first)|in (increasing|decreasing))\b/i.test(q.question || '');

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

export function checkAnswer(q, givenRaw) {
  const raw = normalize(givenRaw);
  if (!raw) return { correct: false, reason: 'no answer', score: 0 };
  const given = stripFiller(raw);

  const spec = parseAnswerSpec(q.answer, q.accept, q.reject);
  if (spec.rejects.some(r => r === given || squash(stem(r)) === squash(stem(given)))) {
    return { correct: false, reason: 'not accepted', score: 0 };
  }

  // Multiple choice is strict: the letter, or the option written exactly (ignoring
  // capitalization, spacing and punctuation), or an equal number in simplest form.
  if (q.choices && q.answerLetter) return checkMultipleChoice(q, raw, spec);

  // Statement-number lists ("select all that apply")
  const ordered = isOrdering(q);

  // "All": typing every statement number counts, and so does "all" for a full list.
  const n = statementCount(q);
  if (n >= 2 && !ordered) {
    const everything = Array.from({ length: n }, (_, i) => i + 1).join(',');
    const keyIsAll = spec.alts.some(isAllWord);
    const keyIsFullList = spec.alts.some(a => numberList(a)?.join(',') === everything);
    const g = numberList(given, true);
    if (keyIsAll && g) {
      const ok = g.join(',') === everything;
      return { correct: ok, reason: 'list', score: ok ? 1 : 0 };
    }
    if ((keyIsAll || keyIsFullList) && isAllWord(given)) return { correct: true, reason: 'list', score: 1 };
  }

  for (const alt of spec.alts) {
    const single = alt.replace(/\s+/g, '');
    // An ordering answer written as one run of digits ("231") is a sequence of single digits.
    const altNums = numberList(alt, ordered && /^\d{2,9}$/.test(single), ordered);
    if (!altNums || altNums.length < 2) continue;
    const g = numberList(given, altNums.every(n => n <= 9), ordered);
    if (g) {
      const ok = g.join(',') === altNums.join(',');
      return { correct: ok, reason: 'list', score: ok ? 1 : 0 };
    }
  }

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
      const ok = !gR ? !isExpr
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

  // Text answers
  let best = 0;
  for (const alt of spec.alts) {
    const sc = Math.max(textMatch(given, alt), given !== raw ? textMatch(raw, alt) : 0);
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
  const sameAsCorrect = text => {
    if (exactForm(text) === exactForm(correctText)) return true;
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
  const nums = [...String(q.question || '').matchAll(/(?:^|\n)\s*(\d{1,2})\s*[).]/g)].map(m => +m[1]);
  return nums.length >= 2 ? Math.max(...nums) : 0;
}

function isAllWord(t) {
  return /^(all|all of (them|the above|these|the statements)|all (two|three|four|five|six|2|3|4|5|6)( of them)?|every one|everything)$/
    .test(normalize(t));
}

// The keyed answer and its listed alternates, before any normalizing (so LaTeX survives).
function rawAlternatives(q) {
  const main = String(q.answer || '')
    .replace(/[([][^()[\]]*\b(accept|do not accept|don't accept|reject|prompt)\b[^()[\]]*[)\]]/gi, ' ')
    .replace(/^\s*\(?[WXYZ]\)\s*/i, '');
  return [...main.split(/\s+\bOR\b\s+/), ...String(q.accept || '').split(/\s*[;|]\s*/)]
    .map(t => t.trim()).filter(Boolean);
}
