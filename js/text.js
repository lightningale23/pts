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

function pushText(out, text) {
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, li) => {
    let first = true;
    const parts = line.split(/(\$[^$]+\$)/g);
    for (const part of parts) {
      if (!part) continue;
      if (/^\$[^$]+\$$/.test(part)) {
        out.push(tok(part, li > 0 && first, true));
        first = false;
        continue;
      }
      for (const w of part.split(/\s+/)) {
        if (!w) continue;
        out.push(tok(w, li > 0 && first, false));
        first = false;
      }
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
export function tokenDelay(token, wpm) {
  const base = 60000 / Math.max(60, wpm);
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
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.br) html += t.lab ? '<br class="choice-break">' : '<br>';
    else if (i > 0) html += ' ';
    html += `<span class="w">${tokenHtml(t)}</span>`;
  }
  return html;
}

// Render plain text that may contain $math$ (answers, database view).
export function richText(text) {
  return String(text || '').split(/(\$[^$]+\$)/g)
    .map(p => /^\$[^$]+\$$/.test(p) ? renderMath(p) : escapeHtml(p).replace(/\n/g, '<br>'))
    .join('');
}

// Plain-text version of a question for one-line summaries ("$\\sqrt{144}$" → "√144").
const SYMBOLS = { '\\sqrt': '√', '\\times': '×', '\\cdot': '·', '\\pi': 'π', '\\theta': 'θ', '\\Delta': 'Δ', '\\lambda': 'λ', '\\mu': 'μ', '\\omega': 'ω', '\\alpha': 'α', '\\beta': 'β', '\\infty': '∞', '\\le': '≤', '\\ge': '≥', '\\frac': '' };
export function plainText(text) {
  return String(text || '')
    .replace(/\$([^$]*)\$/g, (_, m) => m.replace(/\\[a-zA-Z]+/g, c => SYMBOLS[c] ?? '').replace(/[{}]/g, '').replace(/\^/g, '^'))
    .replace(/\s+/g, ' ')
    .trim();
}
