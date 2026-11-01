// Answer checking for Science Bowl answers.
// Handles: multiple-choice letters or option text, ACCEPT / DO NOT ACCEPT notes,
// optional words in parentheses, numeric equivalence (0.5 = 1/2 = 5 x 10^-1),
// "1 and 3"-style statement lists, and small typos.

export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\$/g, ' ')
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
  if (m) return { value: +m[1] / +m[2], rest: t.slice(m[0].length).trim() };
  m = t.match(/^([-+]?(?:\d+\.?\d*|\.\d+))(?:\s*(?:e|(?:x|times|\*)\s*10\s*\^?)\s*([-+]?\d+))?/);
  if (!m) return null;
  let value = parseFloat(m[1]);
  if (m[2] != null) value *= Math.pow(10, +m[2]);
  let rest = t.slice(m[0].length).trim();
  if (rest.startsWith('%')) { value /= 100; rest = rest.slice(1).trim(); }
  return { value, rest };
}

// Answers like "1 AND 3", "1, 2, 4", "ALL" are compared as sets of statement numbers.
function numberSet(s) {
  const t = normalize(s);
  if (!/^\d+(\s*(,|and|&|\s)\s*\d+)+$/.test(t)) return null;
  return [...new Set(t.match(/\d+/g))].sort().join(',');
}

function textMatch(given, alt) {
  if (!given || !alt) return 0;
  if (given === alt || squash(given) === squash(alt)) return 1;
  const sim = similarity(squash(given), squash(alt));
  return sim;
}

function threshold(len) {
  if (len <= 4) return 1;       // short answers must be exact (Na vs Ne!)
  if (len <= 7) return 0.84;
  return 0.8;
}

export function checkAnswer(q, givenRaw) {
  const given = normalize(givenRaw);
  if (!given) return { correct: false, reason: 'no answer', score: 0 };

  const spec = parseAnswerSpec(q.answer, q.accept, q.reject);
  if (spec.rejects.some(r => r === given || squash(r) === squash(given))) {
    return { correct: false, reason: 'not accepted', score: 0 };
  }

  // Multiple choice
  if (q.choices && q.answerLetter) {
    const letter = given.match(/^([wxyz])(?:\s|\)|\.|$)/);
    if (letter) {
      const rest = given.slice(1).replace(/^[).\s]+/, '');
      const ok = letter[1].toUpperCase() === q.answerLetter;
      // "x" alone, or "x) text" where the letter decides
      if (!rest || ok) return { correct: ok, reason: ok ? 'letter' : 'wrong letter', score: ok ? 1 : 0 };
    }
    const correctText = normalize(q.answerText);
    let best = { i: -1, s: 0 };
    q.choices.forEach((c, i) => {
      const s = textMatch(given, normalize(c));
      if (s > best.s) best = { i, s };
    });
    const altScore = Math.max(0, ...spec.alts.map(a => textMatch(given, a)));
    const ok = (best.i === 'WXYZ'.indexOf(q.answerLetter) && best.s >= threshold(correctText.length)) ||
               altScore >= threshold(given.length);
    return { correct: ok, reason: ok ? 'choice text' : 'choice', score: Math.max(best.s, altScore) };
  }

  // Statement-number lists
  const givenSet = numberSet(given);
  for (const alt of spec.alts) {
    const altSet = numberSet(alt);
    if (altSet) {
      if (givenSet) return { correct: givenSet === altSet, reason: 'list', score: givenSet === altSet ? 1 : 0 };
      if (/^\d+$/.test(given)) return { correct: false, reason: 'list', score: 0 };
    }
  }

  // Numeric answers: equal values match; units are optional, but a different
  // expression after the number ("3x^3" vs "3x^2") must match exactly.
  const gNum = parseNumber(given);
  const unitLike = r => /^[a-z /%.]+$/.test(r);
  if (gNum && !givenSet) {
    for (const alt of spec.alts) {
      const aNum = parseNumber(alt);
      if (!aNum) continue;
      const tol = 1e-9 * Math.max(1, Math.abs(aNum.value));
      if (Math.abs(aNum.value - gNum.value) > tol) continue;
      const gR = gNum.rest, aR = aNum.rest;
      const isExpr = /^[a-z]\s*\^/.test(aR) || /^[xyz](\b|$)/.test(aR); // "x^2", "x squared"
      const ok = !gR ? !isExpr
        : !aR ? unitLike(gR)
        : squash(gR) === squash(aR) || (unitLike(gR) && unitLike(aR));
      if (ok) return { correct: true, reason: 'number', score: 1 };
    }
  }

  // Text answers
  let best = 0;
  for (const alt of spec.alts) {
    const s = textMatch(given, alt);
    if (s >= threshold(squash(alt).length)) return { correct: true, reason: s === 1 ? 'exact' : 'close spelling', score: s };
    best = Math.max(best, s);
  }
  return { correct: false, reason: best >= 0.6 ? 'close' : 'incorrect', score: best };
}
