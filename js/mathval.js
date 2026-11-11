// Turns a math answer into a number so equivalent forms can be compared:
// "$\frac{\sqrt{3}}{2}$", "√3/2", "sqrt(3)/2" and "0.866" all describe the same value.
//
// Input is converted to a small plain syntax (numbers, + - * / ^, parentheses,
// pi, sqrt, cbrt, ln, log) and read by a hand-written parser. Nothing is ever
// passed to eval, because in rooms the host checks other players' typed answers.
// Anything with leftover letters (variables like x, words) is not a number: null.

const SUPERSCRIPTS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };

// Greek letters become their names ("ω" -> "omega"); capitals keep a capital ("Δ" -> "Delta").
const GREEK = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ϵ: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta',
  ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon',
  φ: 'phi', ϕ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega', Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi',
  Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega',
};
export const GREEK_NAMES = new Set(Object.values(GREEK).map(n => n.toLowerCase()));
export const greekToNames = t => String(t ?? '').replace(/[α-ωϵϕΓΔΘΛΞΣΦΨΩ]/g, c => (GREEK[c] ? ` ${GREEK[c]} ` : c));

export function toPlainMath(src, keepCase = false) {
  let s = greekToNames(String(src ?? '').replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ\b|\\circ\b|\\degree\b/g, ' degrees '));   // $60^{\circ}$
  s = s.replace(/\\?\$/g, ' ')
    .replace(/\\(left|right|displaystyle|,|;|!|quad)/g, '')
    .replace(/\\text\{([^{}]*)\}/g, '$1')
    .replace(/\\mathrm\{([^{}]*)\}/g, '$1');
  // \frac{a}{b} and \sqrt[n]{x} / \sqrt{x}, innermost first
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '(($1)/($2))')
      .replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, '(($2)^(1/($1)))')
      .replace(/\\sqrt\{([^{}]*)\}/g, ' sqrt($1)')
      .replace(/\^\{([^{}]*)\}/g, '^($1)')
      // (Subscripts are dropped for numbers; expressions keep them as part of the name: v_0.)
      .replace(/_\{([^{}]*)\}/g, (m, sub) => (keepCase && /^[A-Za-z0-9]+$/.test(sub) ? `_${sub}` : keepCase ? ' _ ' : ''));
    if (s === before) break;
  }
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, m => `^(${[...m].map(c => SUPERSCRIPTS[c]).join('')})`)
    .replace(/\\pi\b|π/g, ' pi ')
    .replace(/\\(times|cdot)|[×·∙]/g, '*')
    .replace(/\\div|÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/√\s*(\d+(?:\.\d+)?|[a-z]+)/gi, 'sqrt($1)')
    .replace(/√/g, 'sqrt')
    .replace(/[{}]/g, m => (m === '{' ? '(' : ')'))
    .replace(/\\/g, ' ');
  if (!keepCase) s = s.toLowerCase();
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, '$1')                    // thousands separators
    .replace(/(\d)\s*x\s*(?=10\s*\^)/g, '$1*')                  // 3 x 10^8
    .replace(/\b(?:the\s+)?(?:square\s+)?root(?:\s+of)?\b/gi, 'sqrt')                 // "root 2", "the square root of 2"
    .replace(/\bcube sqrt\b/gi, 'cbrt')
    .replace(/\bsquared\b/gi, '^2').replace(/\bcubed\b/gi, '^3')
    .replace(/\btimes\b/gi, '*').replace(/\bover\b/gi, '/')
    .replace(/%/g, '/100');
  return s.replace(/\s+/g, ' ').trim();
}

const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, ln: Math.log, log: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
};
const CONSTS = { pi: Math.PI };

function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/.exec(s.slice(i));
    if (num) { out.push({ t: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const id = /^[a-z]+/.exec(s.slice(i));
    if (id) {
      const w = id[0];
      if (FUNCS[w]) out.push({ t: 'fn', v: w });
      else if (w in CONSTS) out.push({ t: 'num', v: CONSTS[w] });
      else return null;                                        // a variable or a word
      i += w.length;
      continue;
    }
    if ('+-*/^()'.includes(c)) { out.push({ t: c }); i++; continue; }
    return null;
  }
  return out;
}

function parse(tokens, env = {}) {
  let p = 0;
  const peek = () => tokens[p];
  const startsFactor = tk => tk && (tk.t === 'num' || tk.t === 'var' || tk.t === 'fn' || tk.t === '(');
  function expr() {
    let v = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tokens[p++].t;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = unary();
    for (;;) {
      const tk = peek();
      if (tk && (tk.t === '*' || tk.t === '/')) { p++; const r = unary(); v = tk.t === '*' ? v * r : v / r; }
      else if (startsFactor(tk)) v *= power();               // implicit: 2pi, 3sqrt(2), 2(5)
      else return v;
    }
  }
  function unary() {
    if (peek()?.t === '-') { p++; return -unary(); }
    if (peek()?.t === '+') { p++; return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (peek()?.t === '^') { p++; return base ** unary(); }
    return base;
  }
  function primary() {
    const tk = tokens[p++];
    if (!tk) throw new Error('end');
    if (tk.t === 'num') return tk.v;
    if (tk.t === 'var') return env[tk.v];
    if (tk.t === '(') { const v = expr(); if (tokens[p++]?.t !== ')') throw new Error(')'); return v; }
    if (tk.t === 'fn') {
      // sqrt(3), or sqrt3 / sqrt 3 without parentheses
      const arg = peek()?.t === '(' ? primary() : power();
      return FUNCS[tk.v](arg);
    }
    throw new Error('unexpected');
  }
  const v = expr();
  if (p !== tokens.length) throw new Error('trailing');
  return v;
}

// The value of a math expression, or null if it isn't a pure number.
export function evaluate(src) {
  const plain = toPlainMath(src);
  if (!plain || !/\d|pi/.test(plain)) return null;
  const tokens = tokenize(plain);
  if (!tokens || !tokens.length) return null;
  try {
    const v = parse(tokens);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// Same, but ignores units or words after the number ("$2\sqrt{3}$ meters").
export function evaluateLoose(src) {
  const direct = evaluate(src);
  if (direct != null) return direct;
  // Only strip unit-like words ("meters", "kg m/s"), never a lone variable ("3 x squared").
  const m = String(src ?? '').match(/^(.*?\d[^a-zA-Z]*?)\s+([a-zA-Z][a-zA-Z /.^\d]*)$/);
  if (!m || /^[a-zA-Z](\s|\^|$)/.test(m[2]) || /(^|[^\^\d])\d/.test(m[2])) return null;
  return evaluate(m[1]);
}

// Does a typed decimal agree with an exact value to the precision it was typed with?
// Needs at least 3 significant figures (0.866 for √3/2 counts, 0.87 doesn't).
export function roundsTo(typed, exact) {
  const m = String(typed).trim().match(/^[-+]?(\d*)\.(\d+)$/);
  if (!m) return false;
  const digits = (m[1].replace(/^0+/, '') + m[2]).replace(/^0+/, '');
  if (digits.length < 3) return false;
  const tol = 0.5 * Math.pow(10, -m[2].length) + 1e-12;
  return Math.abs(parseFloat(typed) - exact) <= tol;
}

// ── Expressions with variables ──────────────────────────────────────────────
// "1/4 omega", "ω/4", "0.25ω" and "omega over 4" are the same expression. Both sides are
// evaluated at a few made-up values of their variables and compared. Letters are variables
// (case matters when the key uses both "m" and "M"); short runs like "mgh" are products.

const DENOM = { half: 2, halves: 2, third: 3, thirds: 3, fourth: 4, fourths: 4, quarter: 4, quarters: 4, fifth: 5, fifths: 5, sixth: 6, sixths: 6, eighth: 8, eighths: 8 };
const HALVES = [[/\b(one|two|three|four|five)[\s-]+(halves|half|thirds?|fourths?|quarters?|fifths?|sixths?|eighths?)(?:\s+of)?\b/gi,
  (_, n, d) => ` (${['one', 'two', 'three', 'four', 'five'].indexOf(n.toLowerCase()) + 1}/${DENOM[d.toLowerCase()]}) `],
  [/\bhalf(?:\s+of)?\b/gi, ' (1/2) '], [/\b(?:a\s+)?quarter(?:\s+of)?\b/gi, ' (1/4) '],
  [/\b(?:a\s+)?third(?:\s+of)?\b/gi, ' (1/3) '], [/\btwice\b/gi, ' 2 '], [/\bthrice\b/gi, ' 3 ']];

function symbolTokens(src) {
  let s = toPlainMath(src, true);
  for (const [re, to] of HALVES) s = s.replace(re, to);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/.exec(s.slice(i));
    if (num) { out.push({ t: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z]+(?:_[A-Za-z0-9]+)?/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      const [w, sub] = id[0].split('_'), low = w.toLowerCase();
      if (sub) {                                   // "v_0": the subscript belongs to the last letter
        if (w.length > 4 && !GREEK_NAMES.has(low)) return null;
        const letters = GREEK_NAMES.has(low) ? [low] : [...w];
        letters.forEach((ch, k) => out.push({ t: 'var', v: k === letters.length - 1 ? `${ch}_${sub}` : ch }));
        continue;
      }
      if (FUNCS[low] && (w === low || w === w.toUpperCase() || w === low[0].toUpperCase() + low.slice(1))) out.push({ t: 'fn', v: low });
      else if (low === 'pi') out.push({ t: 'num', v: Math.PI });
      else if (GREEK_NAMES.has(low)) out.push({ t: 'var', v: w[0] === w[0].toUpperCase() ? low[0].toUpperCase() + low.slice(1) : low });
      else if (w.length <= 4) for (const ch of w) out.push({ t: 'var', v: ch });   // "mgh" = m*g*h
      else return null;                                                         // a word
      continue;
    }
    if ('+-*/^()'.includes(c)) { out.push({ t: c }); i++; continue; }
    return null;
  }
  return out;
}

// Something written as math, not a word: a number, an operator, a Greek letter or a function.
const looksMathy = src => /[\d+\-*/^√π]|[α-ωΓΔΘΛΞΣΦΨΩ]|\\[a-z]+|\b(sqrt|pi|ln|log|sin|cos|tan|omega|theta|alpha|lambda|half|quarter|twice|over|squared)\b/i.test(String(src));

// true / false when both are expressions in the same variables, else null (not comparable).
export function sameExpression(typed, key) {
  if (!looksMathy(key) || !looksMathy(typed)) return null;
  const kt = symbolTokens(key), gt = symbolTokens(typed);
  if (!kt || !gt) return null;
  const kv = new Set(kt.filter(t => t.t === 'var').map(t => t.v));
  if (!kv.size) return null;
  // Case only matters when the key needs it (m and M); "w" stands in for omega.
  const fold = new Set([...kv].map(v => v.toLowerCase())).size === kv.size;
  const name = v => (fold ? v.toLowerCase() : v);
  const keyNames = new Set([...kv].map(name));
  const rename = v => { const n = name(v); return n === 'w' && keyNames.has('omega') && !keyNames.has('w') ? 'omega' : n; };
  const kt2 = kt.map(t => (t.t === 'var' ? { t: 'var', v: rename(t.v) } : t));
  const gt2 = gt.map(t => (t.t === 'var' ? { t: 'var', v: rename(t.v) } : t));
  const gv = new Set(gt2.filter(t => t.t === 'var').map(t => t.v));
  if (gv.size !== keyNames.size || [...gv].some(v => !keyNames.has(v))) {
    // "m/m" for m/M: the same letters, but the key tells m and M apart.
    const lower = set => [...new Set([...set].map(v => v.toLowerCase()))].sort().join();
    return !fold && lower(gv) === lower(keyNames) ? false : null;
  }
  const vars = [...keyNames].sort();
  let compared = 0, nonzero = false;
  for (let trial = 0; trial < 4; trial++) {
    const env = Object.fromEntries(vars.map((v, j) => [v, 1.13 + 0.71 * ((j * 7 + trial * 3) % 11) + 0.37 * trial]));
    let a, b;
    try { a = parse(kt2, env); b = parse(gt2, env); } catch { return null; }
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (Math.abs(a - b) > 1e-9 * Math.max(Math.abs(a), Math.abs(b))) return false;
    if (a !== 0) nonzero = true;
    compared++;
  }
  return compared >= 2 && nonzero ? true : null;
}
