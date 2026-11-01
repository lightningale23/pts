// Turns a math answer into a number so equivalent forms can be compared:
// "$\frac{\sqrt{3}}{2}$", "√3/2", "sqrt(3)/2" and "0.866" all describe the same value.
//
// Input is converted to a small plain syntax (numbers, + - * / ^, parentheses,
// pi, sqrt, cbrt, ln, log) and read by a hand-written parser. Nothing is ever
// passed to eval, because in rooms the host checks other players' typed answers.
// Anything with leftover letters (variables like x, words) is not a number: null.

const SUPERSCRIPTS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };

export function toPlainMath(src) {
  let s = String(src ?? '');
  s = s.replace(/\$/g, ' ')
    .replace(/\\(left|right|displaystyle|,|;|!|quad)/g, '')
    .replace(/\\text\{([^{}]*)\}/g, '$1')
    .replace(/\\mathrm\{([^{}]*)\}/g, '$1');
  // \frac{a}{b} and \sqrt[n]{x} / \sqrt{x}, innermost first
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '(($1)/($2))')
      .replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, '(($2)^(1/($1)))')
      .replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)')
      .replace(/\^\{([^{}]*)\}/g, '^($1)')
      .replace(/_\{[^{}]*\}/g, '');
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
    .replace(/\\/g, ' ')
    .toLowerCase()
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')                    // thousands separators
    .replace(/(\d)\s*x\s*(?=10\s*\^)/g, '$1*')                  // 3 x 10^8
    .replace(/\b(?:the\s+)?(?:square\s+)?root(?:\s+of)?\b/g, 'sqrt')                 // "root 2", "the square root of 2"
    .replace(/\bcube sqrt\b/g, 'cbrt')
    .replace(/\bsquared\b/g, '^2').replace(/\bcubed\b/g, '^3')
    .replace(/\btimes\b/g, '*').replace(/\bover\b/g, '/')
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

function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const startsFactor = tk => tk && (tk.t === 'num' || tk.t === 'fn' || tk.t === '(');
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
