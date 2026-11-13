// Auto-fill for the Review tab (dev.html): small, explainable fixes for the rows the packet
// readers got partly wrong. suggestFixes() lists what could change and why; autoFill() applies the
// ones marked safe (auto). Everything here is pure (no DOM), so tests/review-autofill.test.js
// covers it. buildBankModel() learns from the bank: subjects (naive Bayes), a word list (for words
// that lost their spaces) and an index of similar questions (for repeats).

const MC_LETTERS = ['W', 'X', 'Y', 'Z'];
const OPT_FIELDS = ['w', 'x', 'y', 'z'];
const clean = s => String(s ?? '');
const squash = s => clean(s).toLowerCase().replace(/\$|\\text|\\frac|[{}^_\\]/g, '').replace(/[^a-z0-9]/g, '');
// For comparing an answer with the options: signs and operators count ("n + 1" isn't "n − 1"),
// spacing, $, braces and pronunciation guides ("[READ: …]", "(mer-CAH-li)") don't.
const optKey = s => clean(s).replace(/\[[^\]]*\]|\((?:read|pronounced)?[^)]*-[A-Z]+[^)]*\)/g, ' ').toLowerCase()
  .replace(/[−–]/g, '-').replace(/\$|\\text|\\mathrm|[{}\s"'.,;:!?]/g, '');

// ── Subjects named in packet headers ─────────────────────────────────────
const SUBJECT_WORDS = [
  [/^(?:bio(?:logy)?|life\s*sciences?)$/i, 'Biology'],
  [/^chem(?:istry)?$/i, 'Chemistry'],
  [/^phys(?:ics)?$/i, 'Physics'],
  [/^maths?$|^mathematics$/i, 'Mathematics'],
  [/^(?:earth\s*(?:and|&|\/)\s*space(?:\s*sciences?)?|ess|earth\s*sciences?|astronomy|space\s*science)$/i, 'Earth and Space'],
  [/^energy$/i, 'Energy'],
  [/^gen(?:eral)?\.?\s*sci(?:ence)?$/i, 'General Science'],
  [/^computer\s*science$/i, 'Computer Science'],
  [/^geology$/i, 'Geology'],
  [/^phys(?:ical)?\.?\s*ocean(?:ography)?$/i, 'Physical Oceanography'],
  [/^tech(?:nology)?$/i, 'Technology'],
  [/^social\s*sciences?$/i, 'Social Sciences'],
  [/^geography$/i, 'Geography'],
];
export function subjectFromWord(word, subjects = null) {
  const w = clean(word).replace(/\[[^\]]*\]/g, '').replace(/[\s,:;–—-]+$/, '').trim();
  for (const [re, s] of SUBJECT_WORDS) if (re.test(w)) return !subjects || subjects.includes(s) ? s : '';
  return '';
}

// "12) Math – Multiple Choice What is…", "PHYSICS A 10 meter bar…", "Y-Risk – question format What…",
// "14MATH –ShortAnswer What…", "Biology [3] – Multiple Choice …". Returns null when the question
// doesn't start with a header.
const FORMAT_RE = /^(.{0,40}?)[\s,:;–—-]*\b(short\s*-?\s*answer|multiple\s*-?\s*choice|question\s*(?:format|type))\b\s*[-–—:.,]?\s*/i;
export function readHeader(question, subjects = null) {
  const s = clean(question);
  const lead = s.match(/^\s*(?:(?:VISUAL\s+)?(?:TOSS[\s-]*UP|BONUS)\s*)?(?:\[?(?:TU|T|B)?(\d{1,2})\]?\s*[).:]?\s*)?/i);
  const num = lead[1] || '';
  const rest = s.slice(lead[0].length);
  const f = rest.match(FORMAT_RE);
  const prefix = f ? f[1].replace(/\[[^\]]*\]/g, ' ').replace(/[\s,:;–—-]+$/, '').trim() : '';
  // The words before "Short Answer" must look like a header: nothing, a subject, a separator
  // ("Y-Risk –"), capitals, or a few capitalized words ("Synergy"), not "In a multiple choice test".
  const headerish = f && !/[?]/.test(f[1]) && prefix.split(/\s+/).length <= 5 && (!prefix || subjectFromWord(prefix)
    || /[,:;–—-]\s*$/.test(f[1]) || /[–—:]/.test(f[1]) || prefix === prefix.toUpperCase() || /^(?:[A-Z][\w&'-]*\s*){1,3}$/.test(prefix));
  if (headerish) {
    const kind = f[2].toLowerCase().replace(/[\s-]/g, '');  // 'questionformat'/'questiontype': template text
    return {
      header: s.slice(0, lead[0].length + f[0].length).trim(),
      rest: rest.slice(f[0].length).trim(),
      num, subject: subjectFromWord(prefix, subjects), theme: subjectFromWord(prefix) ? '' : prefix,
      format: kind === 'shortanswer' ? 'Short Answer' : kind === 'multiplechoice' ? 'Multiple Choice' : '',
    };
  }
  // A subject alone: in capitals ("PHYSICS A 10 meter…") or followed by a dash ("Physics – A ball…").
  const words = rest.match(/^\S+(?:\s+\S+){0,3}/)?.[0].split(/\s+/) || [];
  for (let k = Math.min(words.length, 4); k >= 1; k--) {
    const cand = words.slice(0, k).join(' ').replace(/[\s,:;–—-]+$/, '');
    const subject = subjectFromWord(cand, subjects);
    if (!subject) continue;
    const after = rest.slice(rest.indexOf(cand) + cand.length);
    const dash = after.match(/^\s*[–—:-]\s*/);
    const caps = cand === cand.toUpperCase() && /[A-Z]{3}/.test(cand) && /^\s+\S/.test(after);
    if (!dash && !caps) return null;
    return { header: s.slice(0, s.length - after.length + (dash ? dash[0].length : 0)).trim(), rest: after.slice(dash ? dash[0].length : 0).trim(), num, subject, theme: '', format: '' };
  }
  return null;
}

// ── Multiple choice options inside the question text ──────────────────────
// Finds W) … X) … Y) … Z) … in order (also "(W)" and, at the start of a line, "W." / "W:").
export function splitOptions(question) {
  const s = clean(question);
  const find = re => {
    const marks = [...s.matchAll(re)].map(m => ({ L: m[1].toUpperCase(), at: m.index, end: m.index + m[0].length }));
    for (let i = 0; i < marks.length; i++) {
      if (marks[i].L !== 'W') continue;
      const seq = [marks[i]];
      for (let j = i + 1; j < marks.length && seq.length < 4; j++) if (marks[j].L === MC_LETTERS[seq.length]) seq.push(marks[j]);
      if (seq.length === 4) return seq;
    }
    return null;
  };
  const seq = find(/(?<=^|[\s$(:;.,?])\(?([WXYZ])\)\s*/g) || find(/^\s*([WXYZ])[.:]\s+/gm);
  if (!seq) return null;
  const opt = (a, b) => s.slice(a.end, b ? b.at : undefined).replace(/\s*\n\s*/g, ' ').replace(/^\s+|[\s;,]+$/g, '');
  const options = seq.map((m, i) => opt(m, seq[i + 1]));
  if (options.some(o => !o)) return null;
  return { stem: s.slice(0, seq[0].at).replace(/[\s(]+$/, '').trim(), options };
}

const PART_RE = /(?:^|\n|[:?.]\s)\s*\(?(?:[1-4]|I{1,3}|IV|[a-d])\s*[).]\s/;
const isMultiPart = (stem, answer) => PART_RE.test(stem) || /(?:^|[\s;,])\(?(?:1|I|a)\)\s*\S.*(?:2|II|b)\)/.test(answer);

// The letter a multiple choice answer means: "X", "X) TEXT", "(X)", or the text of one option.
export function answerLetter(answer, options) {
  const a = clean(answer).trim();
  const m = a.match(/^\(?([WXYZ])\)?(?:\s*[).:]\s*|\s+|$)/i);
  if (m && (/^\(?[WXYZ]\)/i.test(a) || a.length <= 3 || /^[WXYZ][.:]\s/i.test(a))) return m[1].toUpperCase();
  const k = optKey(a);
  const i = k ? options.findIndex(o => optKey(o) === k) : -1;
  return i >= 0 ? MC_LETTERS[i] : '';
}

// ── Answers: "ANSWER:", writer initials, ACCEPT / DO NOT ACCEPT ─────────────
export function splitAlternates(s) {
  let t = clean(s).replace(/(?:any\s+)?equivalents?\s*,?\s*(?:such\s+as|e\.?g\.?|like)\s*:?\s*/ig, '').trim().replace(/\.$/, '').trim();
  if (!t) return [];
  let parts;
  if (t.includes(';')) parts = t.split(';');
  else if (/^[\d\s,and]+$/i.test(t)) parts = [t];
  else parts = t.split(/(?<!\d),\s*|(?<=\d),\s+|,(?!\d)\s*|\s+or\s+/i);
  return parts.map(p => p.trim()).filter(p => p && !/^(?:or\s+)?(?:any\s+)?equivalents?$/i.test(p));
}

const INITIALS = '[A-Z][a-z]?[A-Z]{0,3}';
const WRITER_RE = new RegExp(`\\s*\\[\\s*(${INITIALS}(?:\\s*[/+&,]\\s*${INITIALS})*)\\s*\\]\\s*\\.?\\s*$`);
const WRITER_TAG_RE = new RegExp(`\\s*\\[\\s*(${INITIALS})\\s*\\]\\s+([A-Z][A-Za-z&/ -]{1,24})\\s*$`);  // "[HG] BIOCHEM"
const isRoman = s => /^[IVXLC]+$/.test(s);
const MULTI_ANSWER = /(?:^|[\s;,])\(?(?:1|I|a)\s*[).]\s*\S.*?(?:^|[\s;,])\(?(?:2|II|b)\s*[).]/;
export function cleanAnswerParts(row) {
  let ans = clean(row.answer).replace(/^\s*(?:ANSWER|ANSWR|ANWER|ANS)\s*[:.;-]?\s*/i, '').trim();
  const accept = [], reject = [], writers = [];
  const wt = ans.match(WRITER_TAG_RE);
  if (wt && !isRoman(wt[1])) { writers.push(`${wt[1]} (${wt[2].trim()})`); ans = ans.slice(0, wt.index).trim(); }
  const w = ans.match(WRITER_RE);
  if (w && !isRoman(w[1].replace(/\s/g, ''))) { writers.push(w[1].replace(/\s+/g, ' ')); ans = ans.slice(0, w.index).trim(); }
  // In a multi-part answer an ACCEPT belongs to its part, so it stays where it is.
  if (MULTI_ANSWER.test(ans)) return { answer: ans.replace(/\s+/g, ' ').trim(), accept, reject, writers, multi: true };
  const grab = (kind, body) => {
    const parts = body.split(/[;,]?\s*DO NOT ACCEPT\s*:?/i);
    if (/DO NOT|REJECT/i.test(kind)) reject.push(...splitAlternates(body));
    else { accept.push(...splitAlternates(parts[0])); for (const p of parts.slice(1)) reject.push(...splitAlternates(p)); }
    return '';
  };
  ans = ans.replace(/\(\s*((?:ALSO\s+)?ACCEPT|DO NOT ACCEPT|REJECT)\s*:?\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/gi, (_, k, b) => grab(k, b));
  ans = ans.replace(/\[\s*((?:ALSO\s+)?ACCEPT|DO NOT ACCEPT|REJECT)\s*:?\s*([^[\]]*)\]/gi, (_, k, b) => grab(k, b));
  const tail = ans.match(/[;,]?\s*\b((?:ALSO\s+)?ACCEPT|DO NOT ACCEPT)\s*:\s*(.*)$/i);
  if (tail) { grab(tail[1], tail[2]); ans = ans.slice(0, tail.index); }
  ans = ans.replace(/\s+/g, ' ').replace(/\s+([;,])/g, '$1').trim().replace(/[;,]+$/, '').trim();
  return { answer: ans, accept, reject, writers };
}

const joinAlts = (have, add) => {
  const list = clean(have).split(';').map(x => x.trim()).filter(Boolean);
  for (const a of add) if (!list.some(x => x.toLowerCase() === a.toLowerCase())) list.push(a);
  return list.join('; ');
};
const addNote = (notes, note) => {
  const n = clean(notes).trim();
  return n.toLowerCase().includes(note.toLowerCase()) ? n : [note, n].filter(Boolean).join('; ');
};

// ── Line breaks and math symbols ─────────────────────────────────────────
// PDF lines wrap mid-sentence; keep breaks only before list items (1), I), a), W), bullets).
export function joinLines(text) {
  return clean(text)
    .replace(/(\w)-[ \t]*\n[ \t]*(?=[a-z])/g, '$1-')
    .replace(/[ \t]*\n[ \t]*(?!\(?(?:\d{1,2}|[IVX]{1,4}|[a-e]|[WXYZ])[).:]\s|[-•*]\s)/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const MATH_SYMBOLS = {
  'π': '\\pi', 'θ': '\\theta', 'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'Δ': '\\Delta',
  'λ': '\\lambda', 'μ': '\\mu', 'ω': '\\omega', 'Ω': '\\Omega', 'σ': '\\sigma', 'ρ': '\\rho', 'φ': '\\phi',
  'ε': '\\epsilon', 'τ': '\\tau', 'Σ': '\\Sigma', '×': '\\times', '·': '\\cdot', '÷': '\\div', '≤': '\\le',
  '≥': '\\ge', '≠': '\\neq', '≈': '\\approx', '∞': '\\infty', '±': '\\pm', '→': '\\rightarrow', '°': '^{\\circ}',
};
// Unicode inside $...$ becomes LaTeX (what importer/fix_latex.py does); a unicode minus and
// zero-width spaces are fixed everywhere.
export function fixMathSymbols(text) {
  const s = clean(text).replace(/[​‌‍﻿]/g, '');
  return s.split(/((?<!\\)\$[^$]*(?<!\\)\$)/).map((part, i) => {
    if (i % 2 === 0) return part.replace(/−/g, '-');
    return part.replace(/−/g, '-').replace(/[πθαβγδΔλμωΩσρφετΣ×·÷≤≥≠≈∞±→°]/g, (c, at, str) => {
      const cmd = MATH_SYMBOLS[c];
      return /[A-Za-z]/.test(str[at + 1] || '') && /[a-z]$/i.test(cmd) ? `${cmd} ` : cmd;
    });
  }).join('');
}

// ── What the packet text says about the question (number, toss-up or bonus) ──
export function readPacketMeta(text) {
  const lines = clean(text).split('\n').map(l => l.trim()).filter(Boolean);
  const out = { type: '', num: '' };
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const h = lines[i].match(/^(?:VISUAL\s+)?(TOSS[\s-]*UP|BONUS)\b\s*(\d{1,2})?/i);
    if (h) {
      out.type = /BONUS/i.test(h[1]) ? 'BONUS' : 'TOSS-UP';
      if (h[2]) out.num = h[2];
      continue;
    }
    const n = lines[i].match(/^\[?(\d{1,2})\]?\s*[).:]?\s*(?=[A-Za-z])/);
    if (n) { out.num ||= n[1]; break; }
    if (out.type) break;
  }
  return out;
}

// The packet text can hold more than one question; pick the block for this row (by number and
// type), else the first. Returns {question, answer} with headers and the ANSWER line split off.
export function questionFromText(text, row = {}) {
  const lines = clean(text).split('\n');
  const blocks = [];
  let cur = null;
  const HEAD = /^\s*(?:VISUAL\s+)?(?:TOSS[\s-]*UP|BONUS)\b[\s\d\w]{0,4}$/i;
  const ANS = /^\s*\[?(?:ANSWER|ANSWR|ANWER|ANS)\]?\s*[:.;-]?\s*/i;
  for (const l of lines) {
    if (HEAD.test(l)) { cur = { type: /BONUS/i.test(l) ? 'BONUS' : 'TOSS-UP', body: [], answer: null }; blocks.push(cur); continue; }
    if (!cur) { cur = { type: '', body: [], answer: null }; blocks.push(cur); }
    if (cur.answer != null) { if (ANS.test(l)) continue; cur = { type: '', body: [l], answer: null }; blocks.push(cur); continue; }
    if (ANS.test(l)) cur.answer = l.replace(ANS, '').trim();
    else cur.body.push(l);
  }
  const numOf = b => (b.body.join(' ').match(/^\s*\[?(\d{1,2})\]?\s*[).:]/) || [])[1] || '';
  const real = blocks.filter(b => b.body.join('').trim());
  const pick = real.find(b => numOf(b) && numOf(b) === String(row.num) && (!b.type || !row.type || b.type === row.type))
    || real.find(b => b.type && b.type === row.type) || real[0];
  if (!pick) return null;
  return { question: pick.body.join('\n').trim(), answer: pick.answer || '' };
}

// ── The bank as a model: subjects, words, similar questions ──────────────
const STOP = new Set(('the of and a an to in is are was were be by for on at as with which what that this from or its it '
  + 'how many following their his her has have had not most following would will can than into these those when where '
  + 'there then also into about each such your you one two three four answer questions question give name identify '
  + 'term called known shown').split(/\s+/));
const words = s => clean(s).toLowerCase().replace(/\$[^$]*\$/g, ' ').match(/[a-z]+/g) || [];
const contentWords = s => words(s).filter(w => w.length >= 3 && !STOP.has(w));

export function buildBankModel(questions, { subjects = null } = {}) {
  const vocab = new Map();
  const subj = new Map();       // subject → { docs, total, counts }
  const docs = [];              // { q, set: Set of words }
  const index = new Map();      // word → [doc indices]
  const sets = new Map();       // set name → { year, level, count }
  for (const q of questions) {
    for (const w of words(`${q.question} ${q.answer} ${(q.choices || []).join(' ')}`)) vocab.set(w, (vocab.get(w) || 0) + 1);
    const cw = contentWords(q.question);
    if (q.subject && (!subjects || subjects.includes(q.subject))) {
      let m = subj.get(q.subject);
      if (!m) subj.set(q.subject, (m = { docs: 0, total: 0, counts: new Map() }));
      m.docs++;
      for (const w of cw) { m.counts.set(w, (m.counts.get(w) || 0) + 1); m.total++; }
    }
    const set = new Set(cw);
    if (set.size >= 3) {
      const i = docs.push({ q, set }) - 1;
      for (const w of set) { let a = index.get(w); if (!a) index.set(w, (a = [])); a.push(i); }
    }
    if (q.set) {
      const s = sets.get(q.set) || { year: q.year || '', level: q.level || '', count: 0 };
      s.count++; sets.set(q.set, s);
    }
  }
  let vocabTotal = 0;
  for (const c of vocab.values()) vocabTotal += c;
  const V = new Set([...subj.values()].flatMap(m => [...m.counts.keys()])).size || 1;
  const nDocs = [...subj.values()].reduce((a, m) => a + m.docs, 0) || 1;
  return {
    vocab, vocabTotal,
    setInfo: name => sets.get(name) || null,
    // Naive Bayes over the question's words: [{subject, p}] best first.
    guessSubject(text) {
      const cw = contentWords(text);
      if (!cw.length || !subj.size) return [];
      const scores = [...subj].map(([s, m]) => {
        let lp = Math.log(m.docs / nDocs);
        for (const w of cw) lp += Math.log(((m.counts.get(w) || 0) + 1) / (m.total + V));
        return { subject: s, lp };
      });
      const top = Math.max(...scores.map(x => x.lp));
      const sum = scores.reduce((a, x) => a + Math.exp(x.lp - top), 0);
      return scores.map(x => ({ subject: x.subject, p: Math.exp(x.lp - top) / sum })).sort((a, b) => b.p - a.p);
    },
    // Bank questions sharing most of this one's words (Dice coefficient), best first.
    similar(text, { limit = 3, min = 0.45, answer = '' } = {}) {
      const set = new Set(contentWords(text));
      if (set.size < 3) return [];
      const hits = new Map();
      for (const w of set) {
        const a = index.get(w);
        if (!a || a.length > 4000) continue;
        for (const i of a) hits.set(i, (hits.get(i) || 0) + 1);
      }
      const ak = squash(answer);
      return [...hits].map(([i, shared]) => ({ q: docs[i].q, score: (2 * shared) / (set.size + docs[i].set.size) }))
        .filter(h => h.score >= min).sort((a, b) => b.score - a.score).slice(0, limit)
        .map(h => ({ ...h, sameAnswer: !!ak && squash(h.q.answer).replace(/^[wxyz]/, '') === ak.replace(/^[wxyz]/, '') }));
    },
    // A PDF that lost its ligatures leaves "\u0000ts" or "(cid:…)" for "fits": the letters that make a
    // known word.
    ligatures(text) {
      const changes = [];
      const out = clean(text).replace(/[A-Za-z]*(?:\u0000|\uFFFD|\(cid:\d+\))[A-Za-z]*/g, tok => {
        for (const lig of ['fi', 'fl', 'ff', 'ffi', 'ffl', 'ft', 'th']) {
          const t = tok.replace(/\u0000|\uFFFD|\(cid:\d+\)/g, lig);
          if ((vocab.get(t.toLowerCase()) || 0) >= 2) { changes.push([tok.replace(/\u0000/g, '?'), t]); return t; }
        }
        return tok;
      });
      return { text: out, changes };
    },
    // Splits words that lost their spaces ("thevalue" → "the value") when every piece is a
    // common word and the whole isn't a word at all. Math is left alone.
    respace(text) {
      const changes = [];
      const cost = w => {
        const c = vocab.get(w) || 0;
        if (c < (w.length <= 3 ? 200 : 3) || (w.length === 1 && w !== 'a')) return Infinity;
        return -Math.log(c / vocabTotal);
      };
      const split = tok => {
        const low = tok.toLowerCase(), n = low.length;
        const best = [0], from = [0];
        for (let i = 1; i <= n; i++) {
          best[i] = Infinity;
          for (let j = Math.max(0, i - 20); j < i; j++) {
            const c = best[j] + cost(low.slice(j, i));
            if (c < best[i]) { best[i] = c; from[i] = j; }
          }
        }
        if (!Number.isFinite(best[n])) return null;
        const parts = [];
        for (let i = n; i > 0; i = from[i]) parts.unshift([from[i], i]);
        if (parts.length < 2 || parts.length > 4) return null;
        return parts.map(([a, b]) => tok.slice(a, b)).join(' ');
      };
      const out = clean(text).split(/((?<!\\)\$[^$]*(?<!\\)\$)/).map((part, k) => k % 2 ? part
        : part.replace(/(?<![\w\\'-])([A-Z]?[a-z]{4,})(?![\w'-])/g, tok => {
          if (vocab.get(tok.toLowerCase())) return tok;
          const s = split(tok);
          if (s) changes.push([tok, s]);
          return s || tok;
        })).join('');
      return { text: out, changes };
    },
  };
}

// ── Suggestions ──────────────────────────────────────────────────────────
// ctx: { text (packet text), subjects (the competition's), model (buildBankModel) }.
// Each suggestion: { id, label, detail, auto, apply(row) → row }. `auto` ones are safe enough for
// autoFill; the others are shown for the reviewer to pick.
export function suggestFixes(row, ctx = {}) {
  const r = { ...row };
  const out = [];
  const subjects = ctx.subjects || null;
  const add = (id, label, detail, auto, apply) => out.push({ id, label, detail, auto, apply: x => ({ ...x, ...apply(x) }) });

  // 1. Packet header left at the start of the question.
  const h = readHeader(r.question, subjects);
  if (h && h.rest) {
    const sets = [];
    if (h.subject && h.subject !== r.subject) sets.push(`subject ${h.subject}`);
    if (h.format && h.format !== r.format) sets.push(`format ${h.format}`);
    if (h.num && !clean(r.num).trim()) sets.push(`number ${h.num}`);
    add('header', 'Remove packet header', `Takes "${h.header}" off the question${sets.length ? ` and sets ${sets.join(', ')}` : ''}${h.theme ? ` (theme round "${h.theme}")` : ''}.`, true, x => ({
      question: h.rest,
      ...(h.subject ? { subject: h.subject } : {}),
      ...(h.format ? { format: h.format } : {}),
      ...(h.num && !clean(x.num).trim() ? { num: h.num } : {}),
    }));
  }

  // 2. W) … Z) options typed into the question.
  const split = splitOptions(r.question);
  if (split && split.stem) {
    const L = answerLetter(r.answer, split.options);
    const multi = isMultiPart(split.stem, r.answer);
    add('options', multi ? 'Split W–Z into options (multi-part?)' : 'Split W–Z into options', `Moves the four options out of the question${r.format !== 'Multiple Choice' ? ', makes it Multiple Choice' : ''}${L ? ` and points the answer at ${L})` : ''}.${multi ? ' The question looks like it has several parts, so check that the options belong to the whole question.' : ''}`, !multi, x => {
      // The letter from the tidied answer; the rest (writer initials, ACCEPT) stays for 'Tidy the answer'.
      const raw = clean(x.answer).replace(/^\s*(?:ANSWER|ANSWR|ANWER|ANS)\s*[:.;-]?\s*/i, '').trim();
      const letter = answerLetter(cleanAnswerParts(x).answer, split.options);
      let answer = x.answer;
      if (letter) {
        const lead = raw.match(/^\(?[WXYZ]\)?(?:\s*[).:]\s*|\s+|$)/i);
        const text = lead ? raw.slice(lead[0].length).trim() : raw;
        const bare = !text || WRITER_RE.test(` ${text}`) && !text.replace(WRITER_RE, '').trim();
        answer = `${letter}) ${bare ? `${split.options[MC_LETTERS.indexOf(letter)]} ${text}`.trim() : text}`;
      }
      return { question: split.stem, format: 'Multiple Choice', answer, ...Object.fromEntries(OPT_FIELDS.map((f, i) => [f, split.options[i]])) };
    });
  }

  // 3. Answer: ANSWER: prefix, [AB] writer, (ACCEPT: …), (DO NOT ACCEPT: …).
  const a = cleanAnswerParts(r);
  const qWriter = clean(r.question).match(WRITER_RE);
  if (a.answer !== clean(r.answer).trim() || (qWriter && !isRoman(qWriter[1]))) {
    const bits = [];
    if (a.writers.length || qWriter) bits.push('writer initials to notes');
    if (a.accept.length) bits.push(`accept ${a.accept.join('; ')}`);
    if (a.reject.length) bits.push(`do not accept ${a.reject.join('; ')}`);
    add('answer', 'Tidy the answer', `Answer becomes "${a.answer}"${bits.length ? `; moves ${bits.join(', ')}` : ''}.`, true, x => {
      const p = cleanAnswerParts(x);
      let notes = clean(x.notes), question = x.question;
      const qw = clean(question).match(WRITER_RE);
      if (qw && !isRoman(qw[1])) { question = question.slice(0, qw.index).trim(); p.writers.push(qw[1]); }
      for (const w of [...new Set(p.writers)]) notes = addNote(notes, `writer: ${w}`);
      return { question, answer: p.answer || x.answer, accept: joinAlts(x.accept, p.accept), reject: joinAlts(x.reject, p.reject), notes };
    });
  }

  // 4. MC answer letter and text that disagree, or text with no letter.
  if (r.format === 'Multiple Choice' && OPT_FIELDS.every(f => clean(r[f]).trim())) {
    const opts = OPT_FIELDS.map(f => r[f]);
    const ans = cleanAnswerParts(r).answer;
    const lm = ans.match(/^\(?([WXYZ])\)\s*(.*)$/i);
    const want = optKey(lm ? lm[2] : ans);
    const textIdx = want ? opts.findIndex(o => optKey(o) === want) : -1;
    // Answer keys often shorten the option or drop its pronunciation guide: that's not a disagreement.
    const fits = (t, o) => { const a = optKey(t), b = optKey(o); return !a || !b || a === b || a.includes(b) || b.includes(a); };
    if (lm && lm[2] && (textIdx >= 0 ? textIdx !== MC_LETTERS.indexOf(lm[1].toUpperCase()) : !fits(lm[2], opts[MC_LETTERS.indexOf(lm[1].toUpperCase())]))) {
      const L = lm[1].toUpperCase();
      add('letter', `Trust the letter: ${L})`, `Answer becomes "${L}) ${opts[MC_LETTERS.indexOf(L)]}" (the text "${lm[2]}" doesn't match option ${L}).`, false,
        () => ({ answer: `${L}) ${opts[MC_LETTERS.indexOf(L)]}` }));
      if (textIdx >= 0) add('letter-text', `Trust the text: ${MC_LETTERS[textIdx]})`, `Answer becomes "${MC_LETTERS[textIdx]}) ${opts[textIdx]}", the option whose text matches.`, false,
        () => ({ answer: `${MC_LETTERS[textIdx]}) ${opts[textIdx]}` }));
    } else if (!lm && !/^[WXYZ]$/i.test(ans) && textIdx >= 0) {
      add('letter', `Add the letter ${MC_LETTERS[textIdx]})`, `"${ans}" is option ${MC_LETTERS[textIdx]}.`, true,
        () => ({ answer: `${MC_LETTERS[textIdx]}) ${ans}` }));
    }
  }

  // 5. Number / toss-up or bonus from the packet text.
  if (ctx.text) {
    const m = readPacketMeta(ctx.text);
    if (m.num && !clean(r.num).trim()) {
      add('number', `Number ${m.num}${m.type && m.type !== r.type ? `, ${m.type}` : ''} from the packet`, `The packet text starts with question ${m.num}${m.type ? ` (${m.type})` : ''}.`, true,
        () => ({ num: m.num, ...(m.type ? { type: m.type } : {}) }));
    } else if (m.type && m.type !== r.type && m.num === clean(r.num).trim()) {
      add('type', `Make it a ${m.type}`, `The packet text has it under ${m.type}.`, false, () => ({ type: m.type }));
    }
  }

  // 6. Year and level from the set (the bank's other questions, or the year in its name).
  if (r.set && (!clean(r.year).trim() || !clean(r.level).trim())) {
    const info = ctx.model?.setInfo(r.set);
    const year = clean(r.year).trim() || info?.year || (clean(r.set).match(/\b(?:19|20)\d{2}\b/) || [''])[0];
    const level = clean(r.level).trim() || info?.level || '';
    if (year !== clean(r.year).trim() || level !== clean(r.level).trim()) {
      add('set-info', 'Year and level from the set', `${[year && `Year ${year}`, level && `level ${level}`].filter(Boolean).join(', ')} (from ${info ? 'the bank' : 'the set name'}).`, true,
        () => ({ year, level }));
    }
  }

  // 7. Wrapped lines and spacing.
  const fields = ['question', ...OPT_FIELDS, 'answer'];
  const joined = Object.fromEntries(fields.map(f => [f, f === 'question' ? joinLines(r[f]) : clean(r[f]).replace(/\s*\n\s*/g, ' ').trim()]));
  if (fields.some(f => joined[f] !== clean(r[f]).trim() && clean(r[f]).trim())) {
    add('lines', 'Join wrapped lines', 'Joins lines the PDF broke mid-sentence; list items keep their own lines.', true,
      x => Object.fromEntries(fields.map(f => [f, f === 'question' ? joinLines(x[f]) : clean(x[f]).replace(/\s*\n\s*/g, ' ').trim()])));
  }

  // 8. Unicode math symbols.
  const mathFields = ['question', ...OPT_FIELDS, 'answer', 'accept'];
  if (mathFields.some(f => fixMathSymbols(r[f]) !== clean(r[f]))) {
    add('math', 'Fix math symbols', 'Unicode symbols inside $…$ become LaTeX (π → \\pi), a unicode minus becomes "-", zero-width spaces go.', true,
      x => Object.fromEntries(mathFields.map(f => [f, fixMathSymbols(x[f])])));
  }

  // 9. Words that lost their spaces.
  if (ctx.model) {
    const sp = ctx.model.respace(r.question);
    if (sp.changes.length) {
      add('spacing', `Fix ${sp.changes.length} run-together word${sp.changes.length === 1 ? '' : 's'}`,
        sp.changes.slice(0, 6).map(([a, b]) => `${a} → ${b}`).join(', ') + (sp.changes.length > 6 ? ', …' : ''), lostSpaces(sp.changes),
        x => ({ question: ctx.model.respace(x.question).text }));
    }
  }

  // 9b. Lost ligatures ("\u0000ts" → "fits").
  if (ctx.model) {
    const lf = ['question', ...OPT_FIELDS, 'answer'];
    const ch = lf.flatMap(f => ctx.model.ligatures(r[f]).changes);
    if (ch.length) add('ligatures', `Fix ${ch.length} broken letter${ch.length === 1 ? '' : 's'}`, ch.slice(0, 6).map(([a, b]) => `${a} → ${b}`).join(', '), true,
      x => Object.fromEntries(lf.map(f => [f, ctx.model.ligatures(x[f]).text])));
  }

  // 10. Subject from the words of the question.
  if (ctx.model && r.question) {
    const g = ctx.model.guessSubject(`${r.question} ${OPT_FIELDS.map(f => r[f]).join(' ')} ${r.answer}`)[0];
    const empty = !clean(r.subject).trim() || (subjects && !subjects.includes(r.subject));
    if (g && g.subject !== r.subject && (empty || g.p >= 0.97)) {
      add('subject', `Subject: ${g.subject} (${Math.round(g.p * 100)}%)`, `Guessed from the words of the question${empty ? '' : `; it says ${r.subject} now`}.`, empty,
        () => ({ subject: g.subject }));
    }
  }
  return out;
}

// Run-together words are fixed without asking only when the question clearly lost its spaces:
// three different words, or two where one piece is a short word like "of" or "the".
function lostSpaces(changes) {
  const distinct = new Map(changes.map(([a, b]) => [a.toLowerCase(), b.toLowerCase()]));
  const short = [...distinct.values()].some(b => b.split(' ').some(p => p.length <= 3));
  return distinct.size >= 3 || (distinct.size >= 2 && short);
}

// Applies every safe suggestion, each at most once, until none is left.
export function autoFill(row, ctx = {}) {
  let r = { ...row };
  const applied = [], done = new Set();
  for (let pass = 0; pass < 15; pass++) {
    const f = suggestFixes(r, ctx).find(x => x.auto && !done.has(x.id));
    if (!f) break;
    done.add(f.id);
    const next = f.apply(r);
    if (JSON.stringify(next) !== JSON.stringify(r)) { applied.push(f.label); r = next; }
  }
  return { row: r, applied };
}
