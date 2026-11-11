import { escapeHtml } from './util.js';

// Split question text into reading tokens. $...$ math stays as a single token,
// newlines become line breaks, and multiple-choice options start on their own line.
// Token shape: { t: string, m?: true (math), br?: true (newline before), lab?: true (choice label) }
export function tokenize(q) {
  const out = [];
  pushText(out, q.question);
  if (q.choices) {
    q.choices.forEach((c, i) => {
      if (!c) return;
      out.push({ t: `${'WXYZ'[i]})`, br: true, lab: true });
      pushText(out, c);
    });
  }
  return out;
}

// $...$ is math; \$ is a literal dollar sign ("costs \$5"). A closing $ can't follow a backslash.
export const MATH_SPLIT = /((?<!\\)\$[^$]*[^$\\]\$)/g;
const isMath = p => /^\$[^$]*[^$\\]\$$/.test(p) && !p.startsWith('\\');
const unescapeDollars = s => s.replace(/\\\$/g, '$');

function pushText(out, text) {
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, li) => {
    let first = true;
    let joined = false;   // the next token touches the one before it ("N$_{2}$", "$x^{2}$-")
    for (const part of line.split(MATH_SPLIT)) {
      if (!part) continue;
      if (isMath(part)) {
        const t = tok(part, li > 0 && first, true);
        if (joined) t.glue = true;
        out.push(t);
        first = false;
        joined = true;
        continue;
      }
      const words = unescapeDollars(part).split(/(\s+)/);
      words.forEach((w, wi) => {
        if (!w) return;
        if (/^\s+$/.test(w)) { joined = false; return; }
        const t = tok(w, li > 0 && first, false);
        if (joined && wi === 0) t.glue = true;
        out.push(t);
        first = false;
        joined = true;
      });
    }
  });
}

function tok(t, br, m) {
  const o = { t };
  if (br) o.br = true;
  if (m) o.m = true;
  return o;
}

// Milliseconds to show a token at the given words-per-minute.
// The moderator's lead-in, read before the question: "Physics, Toss-up, Short answer".
// These tokens fill the header (with its subject colors) instead of the question text.
export function introTokens(q) {
  return [
    { t: q.subject, intro: 'subject' },
    { t: q.type === 'bonus' ? 'Bonus' : 'Toss-up', intro: 'kind' },
    { t: q.format === 'mc' ? 'Multiple choice' : 'Short answer', intro: 'format' },
  ];
}

export function tokenDelay(token, wpm) {
  const base = 60000 / Math.max(60, wpm);
  if (token.intro) return base * (token.t.split(/\s+/).length + 0.8);
  let f = 1;
  if (token.m) f = 1.8;
  else if (token.t.length > 9) f = 1.25;
  if (/[.?!;:]$/.test(token.t)) f += 0.6;
  if (token.lab) f += 0.5;
  return base * f;
}

export function renderMath(src) {
  const body = src.replace(/^\$|\$$/g, '');
  if (typeof window !== 'undefined' && window.katex) {
    try { return window.katex.renderToString(body, { throwOnError: false }); } catch { /* fall through */ }
  }
  return `<span class="math-raw">${escapeHtml(body)}</span>`;
}

export function tokenHtml(token) {
  const inner = token.m ? renderMath(token.t) : escapeHtml(token.t);
  if (token.lab) return `<span class="choice-label">${inner}</span>`;
  return inner;
}

// Render tokens as HTML. Choice lines are wrapped so they can be styled as a list.
export function tokensHtml(tokens) {
  let html = '';
  tokens = tokens.filter(t => !t.intro);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.br) html += t.lab ? '<br class="choice-break">' : '<br>';
    else if (i > 0 && !t.glue) html += ' ';
    html += `<span class="w">${tokenHtml(t)}</span>`;
  }
  return html;
}

// Render plain text that may contain $math$ (answers, database view).
export function richText(text) {
  return String(text || '').split(MATH_SPLIT)
    .map(p => isMath(p) ? renderMath(p) : escapeHtml(unescapeDollars(p)).replace(/\n/g, '<br>'))
    .join('');
}

// Plain-text version of a question for one-line summaries ("$\\sqrt{144}$" → "√144").
const SYMBOLS = { '\\sqrt': '√', '\\times': '×', '\\cdot': '·', '\\pi': 'π', '\\theta': 'θ', '\\Delta': 'Δ', '\\lambda': 'λ', '\\mu': 'μ', '\\omega': 'ω', '\\alpha': 'α', '\\beta': 'β', '\\infty': '∞', '\\le': '≤', '\\ge': '≥', '\\frac': '' };
export function plainText(text) {
  return String(text || '')
    .replace(/(?<!\\)\$([^$]*[^$\\])\$/g, (_, m) => m.replace(/\\[a-zA-Z]+/g, c => SYMBOLS[c] ?? '').replace(/[{}]/g, '').replace(/\^/g, '^'))
    .replace(/\\\$/g, '$')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Text to speech ──────────────────────────────────────────────────────
const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'nu', 'pi', 'rho', 'sigma', 'tau', 'phi', 'omega', 'Delta', 'Omega', 'Sigma', 'Phi'];

// LaTeX structures read as words, with nested braces handled: fractions, roots, integrals,
// sums, limits, binomials, accents. What's left (powers, subscripts, symbols) is read below.
const ROOTS = { 2: 'square', 3: 'cube', 4: 'fourth', 5: 'fifth' };
const FUNCS = { sin: 'sine', cos: 'cosine', tan: 'tangent', sec: 'secant', csc: 'cosecant', cot: 'cotangent', arcsin: 'arcsine', arccos: 'arccosine', arctan: 'arctangent', sinh: 'hyperbolic sine', cosh: 'hyperbolic cosine', tanh: 'hyperbolic tangent', ln: 'natural log', log: 'log', exp: 'exp', det: 'determinant' };
function braced(s, i) {                                  // s[i] is '{': [inside, index after '}']
  for (let d = 0, j = i; j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}' && --d === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}
function argAt(s, i) {
  while (s[i] === ' ') i++;
  if (s[i] === '{') return braced(s, i);
  const cmd = s.slice(i).match(/^\\[a-zA-Z]+/);
  if (cmd) return [cmd[0], i + cmd[0].length];
  return [s[i] || '', i + 1];
}
function sayStructure(s, chem) {
  let out = '';
  for (let i = 0; i < s.length;) {
    if (s[i] === '^' && s[i + 1] === '{') {
      const [a, j] = braced(s, i + 1);
      out += /[\\^]/.test(a) ? ` to the ${speakMath(a)} ` : `^{${a}}`;   // 3^{3^{3}}: "3 to the 3 cubed"
      i = j; continue;
    }
    const cmd = s[i] === '\\' && s.slice(i).match(/^\\([a-zA-Z]+|[,;:! ])/);
    if (!cmd) { out += s[i++]; continue; }
    const name = cmd[1];
    let j = i + cmd[0].length, a, b;
    const S = t => sayStructure(t, chem);
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') { [a, j] = argAt(s, j); [b, j] = argAt(s, j); out += ` ${S(a)} over ${S(b)} `; }
    else if (name === 'binom') { [a, j] = argAt(s, j); [b, j] = argAt(s, j); out += ` ${S(a)} choose ${S(b)} `; }
    else if (name === 'sqrt') {
      let n = '';
      if (s[j] === '[') { const k = s.indexOf(']', j); n = s.slice(j + 1, k); j = k + 1; }
      [a, j] = argAt(s, j);
      out += ` the ${n ? (ROOTS[n] || `${n}th`) : 'square'} root of ${S(a)} `;
    } else if (/^(int|sum|prod|lim)$/.test(name)) {
      let lo = '', hi = '';
      for (let k = 0; k < 2; k++) {
        while (s[j] === ' ') j++;
        if (s[j] === '_') [lo, j] = argAt(s, j + 1);
        else if (s[j] === '^') [hi, j] = argAt(s, j + 1);
      }
      if (name === 'lim') out += ` the limit as ${S(lo.replace(/\\to|\\rightarrow|→/g, ' approaches '))} of `;
      else out += ` the ${{ int: 'integral', sum: 'sum', prod: 'product' }[name]}${lo ? ` from ${S(lo)}` : ''}${hi ? ` to ${S(hi)}` : ''} of `;
    } else if (/^(dot|ddot|hat|vec|bar|overline)$/.test(name)) {
      [a, j] = argAt(s, j);
      out += name === 'vec' ? ` vector ${S(a)} ` : ` ${S(a)} ${{ dot: 'dot', ddot: 'double dot', hat: 'hat', bar: 'bar', overline: 'bar' }[name]} `;
    } else if (/^(text|mathrm|operatorname|mathbf|mathit)$/.test(name)) { [a, j] = argAt(s, j); out += ` ${a} `; }
    else if (FUNCS[name]) out += ` ${FUNCS[name]} `;
    else if (/^(left|right|displaystyle|quad|qquad|langle|rangle|rfloor|rceil|[,;:! ])$/.test(name)) out += ' ';
    else if (name === 'lfloor') out += ' the floor of ';
    else if (name === 'hbar') out += ' h bar ';
    else if (name === 'pm') out += ' plus or minus ';
    else if (/^(cdots|ldots|dots)$/.test(name)) out += ' and so on ';
    else if (/^(to|rightarrow)$/.test(name)) out += chem ? ' yields ' : ' to ';
    else if (name === 'prime') out += ' prime ';
    else out += cmd[0];                                   // \pi, \times, \le ...: read below
    i = j;
  }
  return out;
}

// How a math expression should sound: "$3x^2$" → "3 x squared", "$\frac{1}{2}$" → "1 over 2".
export function speakMath(src) {
  let m = String(src).replace(/^\$|\$$/g, '');
  m = sayStructure(sayDegreesAndCharges(m), /\\(text|mathrm)\{/.test(m) || /→/.test(m))
    .replace(/'/g, ' prime ')
    .replace(/→/g, ' yields ');
  m = m
    .replace(/\^\{?2\}?(?![\d])/g, ' squared ')
    .replace(/\^\{?3\}?(?![\d])/g, ' cubed ')
    .replace(/\^\{([^{}]*)\}/g, ' to the $1 ')
    .replace(/\^(-?\w+)/g, ' to the $1 ')
    .replace(/_\{([^{}]*)\}/g, ' $1 ')
    .replace(/_(\w)/g, ' $1 ')
    .replace(/\\(times|cdot)/g, ' times ')
    .replace(/\\(le|leq)\b/g, ' less than or equal to ')
    .replace(/\\(ge|geq)\b/g, ' greater than or equal to ')
    .replace(/\\(ne|neq)\b/g, ' not equal to ')
    .replace(/\\infty/g, ' infinity ')
    .replace(new RegExp(`\\\\(${GREEK.join('|')})\\b`, 'g'), ' $1 ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/=/g, ' equals ')
    .replace(/\+/g, ' plus ')
    .replace(/(\s|^)-(?=\s*\d|\s*[a-z])/gi, '$1 minus ')
    .replace(/\s-\s/g, ' minus ')
    .replace(/</g, ' less than ')
    .replace(/>/g, ' greater than ')
    .replace(/\//g, ' over ');
  return m.replace(/\s+/g, ' ').trim();
}

// Degree signs and ion charges, in LaTeX or plain text:
//   "30^{\circ}C", "30°C", "45^{o}" -> "30 degrees Celsius", "45 degrees"
//   "\Delta H^{\circ}", "E^{o}"     -> "Delta H naught", "E naught" (standard state)
//   "Fe^{3+}", "Fe^3+", "SO_{4}^{2-}", "F^{-}" -> "Fe 3 plus", "SO 4 2 minus", "F minus"
// (an exponent stays an exponent: "x^2 + 1", "10^{-34}", "2^{10}+1")
const DEG = String.raw`(?:\^\s*\{\s*(?:\\circ|o|\\degree)\s*\}|\^\s*(?:\\circ|\\degree)(?![A-Za-z])|\^o(?![A-Za-z])|\\degree(?![A-Za-z])|°)`;
const DEG_RE = new RegExp(`([0-9A-Za-z)}]?)\\s*${DEG}\\s*(?:\\\\text\\{\\s*([CFK])\\s*\\}|\\\\mathrm\\{\\s*([CFK])\\s*\\}|([CFK])(?![A-Za-z]))?`, 'g');
const SCALE = { C: 'Celsius', F: 'Fahrenheit', K: 'kelvin' };
export function sayDegreesAndCharges(src) {
  return String(src)
    .replace(DEG_RE, (all, prev, t1, t2, t3) => {
      const unit = t1 || t2 || t3;
      if (/\d/.test(prev) || unit) return `${prev} degrees${unit ? ` ${SCALE[unit]}` : ''} `;
      if (/[A-Za-z)}]/.test(prev)) return `${prev} naught `;           // ΔH°, E°: standard state
      return `${prev} degrees `;
    })
    // a charge: digits then a sign, and nothing after it (in braces, or at the end of a word)
    .replace(/\^\s*\{\s*(\d*)\s*([+\-−–])\s*\}/g, (_, n, sign) => ` ${n} ${sign === '+' ? 'plus' : 'minus'} `)
    .replace(/\^(\d*)([+\-−–])(?=$|[\s,.;:)\]?!])/g, (_, n, sign) => ` ${n} ${sign === '+' ? 'plus' : 'minus'} `);
}

export function spokenForm(token) {
  if (token.intro) return `${token.t},`;
  if (token.m) return speakMath(token.t);
  if (token.lab) return `${token.t.replace(')', '')},`;
  return token.t;
}

// Pronunciation guides ("[pair-EN-kih-ma]", "(BOW-fort)", "[TOHL-muhn OH-pen-high-muhr ]")
// tell a human reader how to say the word before them. Browser voices can't take phonetic
// hints, but they read a plain respelling well, so the guide (in lowercase: some voices spell
// out capitals) is said in place of the word. Reading guides ("[read as: 3 x squared]",
// "(read: big O of n)") are kept: they say how to read math aloud.
const READING_WORDS = /\b(read|reads|as|the|of|over|times|squared|cubed|minus|plus|equals|to|and|or|prime|naught|sub|super|power|root|quantity|accept|do|not|i\.e|e\.g|see|note)\b/i;
function isPronunciation(open, inner) {
  const body = inner.trim();
  // (only whole words count as reading words: "see" in "uh-SEE-tic" is a syllable)
  if (!body || !/^[A-Za-z’' -]+$/.test(body) || body.split(/\s+/).some(w => !w.includes('-') && READING_WORDS.test(w))) return false;
  if (/^(?:[IVX]+|[A-Z]{1,4})$/.test(body)) return false;              // iron (III), (ABA)
  const caps = /(^|[\s-])[A-Z]{2,}(?=$|[\s-])/.test(body);        // a stressed syllable: "EN", "BOW"
  const hyphens = (body.match(/-/g) || []).length;
  // 'weak': "(deelz-ahl-der)" or "(non-polar)" in parentheses. Only used when it plainly fits
  // the word before it; otherwise the text is read as written.
  return open === '[' ? caps || hyphens >= 1 : (caps || hyphens >= 2 ? true : hyphens >= 1 ? 'weak' : false);
}
// Words a span may hold beyond the guide's own word count: particles ("de", "van't"), the
// first half of a split hyphenated word ("Diels-"), an oxidation state ("(II)").
const PARTICLES = /^(de|du|da|di|del|della|van|van[’']t|von|der|den|ter|ten|le|la|du|st\.?)$/i;
const extraWord = (t, next) => (PARTICLES.test(t) && /^[A-Z]/.test(next || '')) || /-$/.test(t) || /^\(?[IVX]+\)?[,.;:]?$/.test(t);

// Characters a voice can choke on (a stray NUL stops some voices mid-word) or reads oddly.
const LIGS = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'ft', 'ﬆ': 'st' };
export function speakableText(s) {
  return sayDegreesAndCharges(String(s || '')).replace(/[ﬀ-ﬆ]/g, c => LIGS[c] || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\ue000-\uf8ff]/g, '');
}

// A guide or list respelling as the voice should get it. Voices read each hyphenated piece
// as a word, and spell out pieces that don't look like English ("sih" -> "S I H"), so:
//  - short vowels written "ih", "eh", "uh" take the next consonant, which keeps them short
//    and readable: "sih-LISH-us" -> "sil-lish-us", "BRASS-ih-kuh" -> "brass-ick-ka"
//  - a final "uh" is written "a" ("PLAY-shuh" -> "play-sha"); a final "ih" is "ee"
//  - a lone capital is a letter name ("one-C", and "A-con" starts with "ay")
//  - everything else is lowercase, since some voices spell out capitalized pieces
//  - a lone lowercase consonant joins the piece before ("AL-kye-n" -> "al-kyen")
export function sayRespelling(guide) {
  return String(guide).trim().replace(/[’']/g, '').split(/\s+/).map(word => {
    const parts = word.split('-').filter(Boolean);
    if (parts.length > 1 && parts.every(p => p.length === 1)) return parts.join(' ').toLowerCase();   // "p-k-a": letters
    const ps = [];
    for (const p of parts) {
      if (ps.length && /^[^aeiouyA-Z]$/.test(p)) ps[ps.length - 1] += p; else ps.push(p);
    }
    return ps.map((p, k) => {
      if (/^[A-Z]$/.test(p)) return p;
      let syl = p.toLowerCase();
      const next = (ps[k + 1] || '').toLowerCase();
      const onset = (next.match(/^(sh|ch|th|ph|zh|[^aeiouy])/) || [''])[0];
      if (/(^|[^aeiou])(ih|eh|uh)$/.test(syl)) {
        if (/^[rwyh]/.test(onset)) {
          // (closing with r, w, y or h would change the vowel: "puh-REN" stays)
        } else if (onset) {
          const close = onset === 'k' || (onset === 'c' && !/^c[eiy]/.test(next)) ? 'ck' : onset === 'c' ? 's' : onset;
          syl = syl.slice(0, -1) + close;                       // "sih" + "lish" -> "sil"
        } else if (k === ps.length - 1 && syl.length > 2) {
          syl = syl.replace(/uh$/, 'a').replace(/ih$/, 'ee');   // "shuh" -> "sha"
        }
      }
      return syl;
    }).join('-');
  }).join(' ');
}

// The site's pronunciation list (data/pronunciations.csv): word -> respelling.
let LEXICON = new Map();
// Respellings (packet guides and the list) are off for now: too many pieces were spelled out
// letter by letter. Off, the voice says the word as written and skips its guide.
let RESPELL = false;
export function useRespellings(on) { RESPELL = !!on; }
export function setPronunciations(csvText) {
  const map = new Map();
  for (const line of String(csvText || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#,\s][^,]*?)\s*,\s*([^,]+?)\s*$/);
    if (m && m[1].toLowerCase() !== 'word') map.set(m[1].toLowerCase(), sayRespelling(m[2]));
  }
  LEXICON = map;
  return map.size;
}

// "Cepheids," -> "sef-ee-idz," (plurals and possessives of listed words too).
const WORD_CH = 'A-Za-zÀ-ÿ';
function fromLexicon(text) {
  if (!LEXICON.size) return null;
  const m = String(text).match(new RegExp(`^([^${WORD_CH}]*)([${WORD_CH}][${WORD_CH}'’-]*[${WORD_CH}])([^${WORD_CH}]*)$`));
  if (!m) return null;
  const [, pre, word, post] = m;
  const look = w => {
    const poss = /['’]s$/.test(w) ? 's' : '';                         // "Euler’s" -> "oy-lers"
    const k = w.toLowerCase().replace(/['’]s$/, '');
    if (LEXICON.has(k)) return LEXICON.get(k) + poss;
    if (/s$/.test(k) && LEXICON.has(k.slice(0, -1))) return LEXICON.get(k.slice(0, -1)) + 's';
    return null;
  };
  const whole = look(word);
  if (whole) return pre + whole + post;
  if (word.includes('-')) {                                            // "Diels-Alder"
    const parts = word.split('-');
    const said = parts.map(look);
    if (said.some(Boolean)) return pre + parts.map((p, i) => said[i] || p).join(' ') + post;
  }
  return null;
}

// Does a guide's first sound fit the word's first letters? ("nye-DAIR" for Cnidaria, "zy" for xylem)
const SILENT = { cn: 'n', gn: 'n', kn: 'n', pn: 'n', ps: 's', pt: 't', mn: 'n', ct: 't', ph: 'f', rh: 'r', wh: 'w', x: 'z' };
const GUIDE_SILENT = { kn: 'n', gn: 'n', wr: 'r', ph: 'f' };
const ALIKE = { c: 'ks', k: 'c', g: 'j', j: 'hy', p: 'f', w: 'v', v: 'w', s: 'zc', z: 'xs', q: 'k', t: 'c' };
function startsAlike(word, guide) {
  const w = word.toLowerCase().replace(/^[^a-z0-9]+/, '');
  let g = guide.toLowerCase().replace(/^[^a-z]+/, '');
  if (!w || !g) return false;
  if (GUIDE_SILENT[g.slice(0, 2)]) g = GUIDE_SILENT[g.slice(0, 2)] + g.slice(2);   // "knee-ANN-der-thols"
  if (w[0] === 'k' && g[0] === 'n' && w[1] !== 'n') return false;
  if (/^\d/.test(w)) return true;
  if (/^[aeiouy]/.test(w) && /^[aeiouyhw]/.test(g)) return true;          // vowels drift: "eu" = "yoo"
  const two = w.match(/^(cn|gn|kn|pn|ps|pt|mn|ct|ph|rh|wh|x)/);
  if (two && g.startsWith(SILENT[two[1]])) return true;
  if (w.startsWith('ch') && /^(sh|ch|k)/.test(g)) return true;
  return g[0] === w[0] || (ALIKE[w[0]] || '').includes(g[0]);
}
const letterCount = s => (String(s).match(/[A-Za-zÀ-ÿ]/g) || []).length;
// Math written as plain text: numbers, operators, single letters ("x"), "squared"
const mathyText = s => {
  const t = String(s || '').trim();
  if (!t) return false;
  return /[\d=+−–×÷^*/<>≤≥√π|]|(^|[^A-Za-z])-|-($|[^A-Za-z])|[A-Za-z]\(|^\(?[A-Za-z]{1,2}\)/.test(t) ||
    /^\(?(?:[A-Z][a-z]?){2,}\)?[,.;:]?$/.test(t) ||                     // a formula: HCl, NaOH
    /^\(?[A-Za-z]\)?[,.;:]?$/.test(t) || /^(squared|cubed|sqrt)[,.;:]?$/i.test(t);
};
// Remove a bracket that isn't read, keeping what's before and after it.
function dropBracket(out, tokens, i, j, at, close) {
  const before = tokens[i].t.slice(0, at), lastTok = tokens[j].t;
  const after = speakableText(lastTok.slice(lastTok.indexOf(close) + 1));
  for (let m = i; m <= j; m++) out[m] = '';
  out[i] = speakableText(before);
  out[j] = (out[j] ? out[j] + ' ' : '') + after;
}

// One spoken string per token, so speech can restart from the word where reading resumed.
export function spokenTokens(tokens) {
  const out = tokens.map(t => speakableText(spokenForm(t)));
  const guided = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.intro || t.m) continue;
    const open = t.t.match(/[[(]/);
    if (!open || open.index > 0 && /[A-Za-z]/.test(t.t[open.index - 1])) {
      // a guide right after the word with no space: "Parenchyma[pair-EN-kih-ma]"
      if (!open) continue;
    }
    // find the closing bracket within the next few tokens
    const close = open[0] === '[' ? ']' : ')';
    let j = i, text = t.t.slice(open.index + 1);
    while (!text.includes(close) && j + 1 < tokens.length && j - i < 80) { j++; text += ' ' + tokens[j].t; }   // (a reading can be long)
    const k = text.indexOf(close);
    if (k < 0) continue;
    const inner = text.slice(0, k);
    // "$3x^2$ [read as: 3 x squared]": the guide is how the math should sound, so it is
    // read instead of the math just before it (rather than both).
    let inner2 = inner;
    // "[read slowly]": an instruction to the reader, not something to say
    if (/^\s*(?:read\s+(?:slowly|carefully|twice|clearly|out\b|digits|each|the\s+letters|letters|individually)|reader[’']?s?\s+note|note\s+to\s+(?:the\s+)?reader)/i.test(inner)) {
      dropBracket(out, tokens, i, j, open.index, close);
      i = j;
      continue;
    }
    const reading = inner.match(/^\s*(?:(?:read|reads|say)\s*(?::|\bas\b\s*:?|\s(?=\S))|pronounced?\s*:?)\s*(.+?)\s*$/i);
    let sayWord = false;
    if (reading) {
      const before = t.t.slice(0, open.index);
      const lastTok = tokens[j].t;
      const after = lastTok.slice(lastTok.indexOf(close) + 1);
      // What the reading is for: $math$ just before, or math written out in plain text
      // ("x squared + y squared +4x−6y = 0 [READ: x squared plus y squared plus 4 x ...]").
      let start = i;
      if (!before.trim() || mathyText(before)) {
        // (never past a list label like "2)" or the start of a line: those belong to other items)
        while (start > 0 && i - start < 30 && !tokens[start].br) {
          const prev = tokens[start - 1];
          if (prev.intro || prev.lab || /^\(?(?:\d{1,2}|[IVX]{1,4}|[a-hWXYZ])[).:]$/.test(prev.t) || !(prev.m || mathyText(prev.t))) break;
          start--;
        }
      }
      // (a stressed syllable in capitals, "cyclo-hex-EEN", would be spelled out: lowercase it)
      const said = reading[1].replace(/\S*[a-z]-[A-Z]{2,}\S*|\S*[A-Z]{2,}-[a-z]\S*/g, w => w.toLowerCase());
      if (start < i || mathyText(before)) {
        for (let n = start; n <= j; n++) out[n] = '';
        out[i] = speakableText(`${mathyText(before) ? '' : before} ${said}${after}`.trim());
        i = j;
        continue;
      }
      // After a word: how to say that word ("chord [READ: kord]"), a pronunciation guide.
      const words = reading[1].split(/\s+/);
      const saying = words.length <= 3 && /^[A-Za-z’' -]+$/.test(reading[1]) && !words.some(w => READING_WORDS.test(w)) && /[A-Za-z]/.test(before || tokens[i - 1]?.t || '');
      if (saying) { sayWord = true; inner2 = reading[1]; }
      else {
        // something else to read out ("[READ: big O of n]" with no math before it): read it
        for (let n = i; n <= j; n++) out[n] = '';
        out[i] = speakableText(`${before} ${said}${after}`.trim());
        i = j;
        continue;
      }
    }
    const kind = sayWord || isPronunciation(open[0], inner);
    if (!kind) continue;
    const before = t.t.slice(0, open.index);            // "Parenchyma" in "Parenchyma[pair-EN-kih-ma]"
    const lastTok = tokens[j].t;
    const after = speakableText(lastTok.slice(lastTok.indexOf(close) + 1).replace(/^-/, ' '));
    if (!RESPELL) {                                      // say the word, skip the guide
      if (kind === 'weak') continue;                     // ("(deelz-ahl-der)" may not be a guide: read as written)
      for (let m = i; m <= j; m++) out[m] = '';
      out[i] = speakableText(before);
      out[j] = (out[j] ? out[j] + ' ' : '') + after;
      i = j;
      continue;
    }
    // The words the guide is for: those just before it whose length fits the guide and whose
    // first sound matches ("Brassica oleracea (BRASS-ih-kuh oh-luh-RAY-see-uh)").
    let said = sayRespelling(inner2);
    const gl = letterCount(inner2), guideWords = said.split(' ').length;
    let best = null;
    for (let n = 0; n <= 4; n++) {                       // n = whole tokens taken from before this one
      const start = i - n;
      if (start < 0) break;
      if (n > 0 && (tokens[start].intro || tokens[start].m || tokens[start].lab)) break;
      const words = [...tokens.slice(start, i).map(x => x.t), before].filter(w => letterCount(w));
      if (words.filter((w, k) => !extraWord(w, words[k + 1])).length > guideWords) break;
      const span = words.join(' ').trim();
      if (!letterCount(span)) continue;
      const ratio = letterCount(span) / Math.max(1, gl);
      if (ratio < 0.45 || ratio > 2.2 || !startsAlike(span, inner2)) continue;
      const score = Math.abs(Math.log(ratio));
      if (!best || score < best.score) best = { start, score };
    }
    // A code, symbol or number just before ("X0 [X-oh]", "(111) [one-one-one]", "Km [kay-emm]",
    // "$R^{2}$ [R-two]"): the guide says how to read it.
    if (!best && kind !== 'weak') {
      const prev = letterCount(before) || /\d/.test(before) ? null : tokens[i - 1];
      const code = x => x.m || /\d|[^\x00-\x7f]/.test(x.t) || letterCount(x.t) <= 3;
      if (before && (/\d|[^\x00-\x7f]/.test(before) || letterCount(before) <= 3)) best = { start: i, score: 1 };
      else if (prev && !prev.intro && !prev.lab && code(prev)) best = { start: i - 1, score: 1 };
    }
    if (!best && (kind === 'weak' || sayWord)) continue;   // doesn't fit a word: read it as written
    for (let m = i; m <= j; m++) out[m] = '';
    if (best) {
      // a word on the site's list is said as listed: the list is checked by ear, guides vary
      const spanText = [...tokens.slice(best.start, i).map(x => x.t), before].join(' ').trim();
      const listed = !/\s/.test(spanText) && fromLexicon(spanText);
      if (listed) said = listed;
      const first = best.start < i ? tokens[best.start].t : before;
      const lead = (first.match(/^[“"‘']*/) || [''])[0];
      for (let m = best.start; m < i; m++) out[m] = '';
      out[best.start] = speakableText(lead) + said;
      for (let m = best.start; m <= j; m++) guided[m] = true;
    } else {
      out[i] = speakableText(before);                     // can't tell which word it's for: say the word
    }
    out[j] = (out[j] ? out[j] + ' ' : '') + after;
    i = j;
  }
  // "$30^{\circ}$C": the scale is the next token
  for (let i = 0; i + 1 < tokens.length; i++) {
    const m = /degrees\s*$/.test(out[i] || '') && (out[i + 1] || '').match(/^([CFK])([,.;:)?!]*)$/);
    if (m) out[i + 1] = SCALE[m[1]] + m[2];
  }
  // Words on the site's pronunciation list
  for (let i = 0; RESPELL && i < tokens.length; i++) {
    const t = tokens[i];
    if (guided[i] || t.intro || t.m || t.lab || !out[i]) continue;
    const said = fromLexicon(out[i]);
    if (said) out[i] = said;
  }
  return out;
}
