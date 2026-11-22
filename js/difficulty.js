// Difficulty ratings: every question gets a number on a 0–10 scale (it can go past 10 for the
// hardest; 5 is a typical question in the bank), worked out from the question itself. Rounds
// and sets get the average of their questions. Nothing comes from players' results, so the
// same bank always gives the same numbers, in every browser and in rooms.
//
// What raises a question's number (weights in WEIGHTS):
//   level        middle school questions are easier than high school ones
//   type         bonuses are harder than toss-ups (more time, but harder by design)
//   format       multiple choice is easier than short answer (the answer is on the screen)
//   stage        later rounds of a tournament (elimination, finals) are written harder
//   jargon       rare words: how few questions in the bank use the question's rarest words
//   obscurity    a rare answer (few questions mention it) is harder than a familiar one
//   familiarity  an answer that's the answer to many questions in the bank is easier
//   length       long questions carry more to keep track of
//   calculation  a number to work out (short answer especially, and on a bonus more so)
//   numbers      given values in the question
//   lists        select-all and ordering lists: every item is one more thing to get right
//   parts        answers in parts (1) ... 2) ...) must all be right
//   picture      a visual bonus has a picture to read too
//   set          a question from a set whose questions are hard overall is likely harder
// The content measures (jargon, obscurity, familiarity, length) are compared with the rest of
// the bank (z-scores), and the total is put on the scale with the bank's average at 5 and
// each standard deviation worth SPREAD points.

import { listPick } from './text.js';
import { el } from './util.js';

export const WEIGHTS = {
  ms: -1.6, bonus: 0.9, mc: -0.8,
  stage: { rr: 0, early: 0.2, mid: 0.4, late: 0.65, other: 0.25 },
  jargon: 0.55, obscurity: 0.75, obscurityMc: 0.35, familiarity: -0.3, familiarityMc: -0.1, length: 0.35,
  calc: 0.5, calcBonus: 0.3, calcMcFactor: 0.5, number: 0.08, maxNumbers: 8,
  listItem: 0.12, listAll: 0.3, listOrder: 0.2, part: 0.35, picture: 0.2,
  set: 1.0, setShrink: 20,
};
export const SPREAD = 1.9;

const STOP = new Set(`the and for are was were with that this which what from into its has have had been being
than then them they their there these those when where who whom whose why how not but all any each one two three
four five six both also only such can could would should will shall may might must per about above after again
against below between during before under over very more most less least other same some own out off our you your
his her him she he it of to in on at by an or as is be do does did a i if so no nor too us we me my
following called known used use uses using give name identify what's which's term type types refer refers
answer question choice statement statements correct true false best given number value units unit`.split(/\s+/));

const MATH = /\$(?:\\\$|[^$])+\$/g;
// Lower-case content words of a piece of text (math left out, plurals folded).
export function contentWords(text) {
  const s = String(text || '').replace(MATH, ' ').replace(/\\\$/g, ' ').toLowerCase();
  const out = [];
  for (let w of s.split(/[^a-z'-]+/)) {
    if (w.length < 3) continue;
    if (/^['-]|['-]$|'s$/.test(w)) w = w.replace(/^['-]+|'s$|['-]+$/g, '');
    if (w.length > 4 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
    if (w.length > 2 && !STOP.has(w)) out.push(w);
  }
  return out;
}

// The answer's own text: the option for multiple choice, else the key without
// parentheses, ACCEPT notes and alternates.
export function answerCore(q) {
  if (q.choices && q.answerText) return q.answerText;
  return String(q.answer || '')
    .replace(/\((?:[^()]|\([^()]*\))*\)|\[[^\]]*\]/g, ' ')
    .split(/\s*(?:;|\bACCEPT\b|\bDO NOT\b|\bOR\b|\(|\[)/)[0]
    .trim();
}

// A short answer that's a number or an expression to work out ("12", "3/4", "$2\sqrt{3}$ m/s").
export function isCalculation(q) {
  const a = answerCore(q);
  if (q.choices) return q.choices.filter(Boolean).length >= 3 && q.choices.every(c => !c || (/\d/.test(c) && contentWords(c).length <= 2));
  return /\d/.test(a) && contentWords(a).length <= 2 && !/^[1-9IV]+\s*[).:]/.test(a.trim());
}

// How many parts an answer key has ("1) X; 2) Y" → 2), else 0.
export function keyParts(answer) {
  const s = String(answer || '');
  if (!/^\s*\(?(?:1|I)\s*[).:–-]/.test(s)) return 0;
  let n = 1;
  const re = /(?:^|[\s;,])\(?(\d|I{1,3}|IV|V|VI)\s*[).:–]/g;
  const ROM = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  for (const m of s.matchAll(re)) {
    const v = /\d/.test(m[1]) ? +m[1] : ROM.indexOf(m[1]) + 1;
    if (v === n + 1) n++;
  }
  return n >= 2 ? n : 0;
}

const numbersIn = text => (String(text || '').match(/(?<![a-z])\d+(?:\.\d+)?/gi) || []).length;
const stemOf = q => String(q.question || '');

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function zScorer(xs) {
  const m = mean(xs);
  const sd = Math.sqrt(mean(xs.map(x => (x - m) ** 2))) || 1;
  return x => (x - m) / sd;
}
const round2 = x => Math.round(x * 100) / 100;

// Rates every question (sets q.difficulty) and returns the averages for sets and rounds:
// { sets: Map(set → number), rounds: Map(roundKey(set, round) → number) }.
export function rateDifficulty(questions, W = WEIGHTS) {
  const job = difficultyJob(questions, W);
  return job.finish();
}

// The same in slices, so a big bank can be rated while the page stays responsive:
// job.step(ms) works for about ms milliseconds and returns the result once done (else null);
// job.finish() does the rest at once.
export function difficultyJob(questions, W = WEIGHTS) {
  const it = difficultySteps(questions, W);
  let result = null;
  const run = until => {
    if (result) return result;
    do {   // at least one slice per call
      const r = it.next();
      if (r.done) result = r.value;
    } while (!result && performance.now() < until);
    return result;
  };
  return {
    get result() { return result; },
    step: ms => run(performance.now() + ms),
    finish: () => run(Infinity),
  };
}

const CHUNK = 1500;   // questions between pauses
function* difficultySteps(questions, W) {
  const qs = questions.filter(Boolean);
  if (!qs.length) return { sets: new Map(), rounds: new Map() };
  // How many questions use each word (one entry per word: {n, last, idf}), and how many share each answer.
  const df = new Map(), answers = new Map();
  const entries = (text, i, out) => {
    for (const w of contentWords(text)) {
      let e = df.get(w);
      if (!e) df.set(w, (e = { n: 0, last: -1, idf: 0 }));
      if (e.last !== i) { e.last = i; e.n++; }
      if (out) out.push(e);
    }
    return out;
  };
  const words = [];
  for (let i = 0; i < qs.length; i++) {
    if (i % CHUNK === 0) yield;
    const q = qs[i];
    const core = answerCore(q);
    const stem = entries(stemOf(q), i, []);
    const ans = entries(core, i, []);
    if (q.choices) for (const c of q.choices) entries(c, i, null);
    const key = core.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key) answers.set(key, (answers.get(key) || 0) + 1);
    words.push({ stem, ans, key });
  }
  const N = qs.length;
  for (const e of df.values()) e.idf = Math.log((N + 1) / (e.n + 1));
  const feats = [];
  for (let i = 0; i < qs.length; i++) {
    if (i % CHUNK === 0) yield;
    const q = qs[i];
    const { stem, ans, key } = words[i];
    let r1 = 0, r2 = 0, r3 = 0, k = 0;   // the three rarest words of the question
    for (const e of stem) {
      if (e.last === -2 - i) continue;   // counted already
      e.last = -2 - i; k++;
      const v = e.idf;
      if (v > r1) { r3 = r2; r2 = r1; r1 = v; } else if (v > r2) { r3 = r2; r2 = v; } else if (v > r3) r3 = v;
    }
    const calc = isCalculation(q);
    let ansSum = 0, ansN = 0;
    for (const e of ans) if (e.last !== -2 - i) { e.last = -2 - i; ansSum += e.idf; ansN++; }
    const text = stemOf(q);
    feats.push({
      jargon: k ? (r1 + r2 + r3) / Math.min(3, k) : 0,
      obscurity: !calc && ansN ? ansSum / ansN : null,
      familiarity: Math.log(1 + (key ? answers.get(key) : 0)),
      length: Math.log(1 + stem.length + numbersIn(text) + (text.match(MATH) || []).length),
      calc,
    });
  }
  yield;
  const z = {};
  for (const k of ['jargon', 'length', 'familiarity']) z[k] = zScorer(feats.map(f => f[k]));
  z.obscurity = zScorer(feats.map(f => f.obscurity).filter(x => x !== null));

  // What the question's words and answer say about it.
  const content = feats.map((f, i) => {
    const mc = qs[i].format === 'mc';
    return W.jargon * z.jargon(f.jargon)
      + (f.obscurity === null ? 0 : (mc ? W.obscurityMc : W.obscurity) * z.obscurity(f.obscurity))
      + (mc ? W.familiarityMc : W.familiarity) * z.familiarity(f.familiarity)
      + W.length * z.length(f.length);
  });
  // What its place and shape say.
  const raw = [];
  for (let i = 0; i < qs.length; i++) {
    if (i % CHUNK === 0) yield;
    const q = qs[i];
    const mc = q.format === 'mc', bonus = q.type === 'bonus';
    let r = content[i];
    if (q.level === 'MS') r += W.ms;
    if (bonus) r += W.bonus;
    if (mc) r += W.mc;
    r += W.stage[q.stage] ?? 0;
    if (feats[i].calc) r += (W.calc + (bonus ? W.calcBonus : 0)) * (mc ? W.calcMcFactor : 1);
    r += W.number * Math.min(W.maxNumbers, numbersIn(stemOf(q)));
    const pick = listPick(q);
    if (pick) r += W.listItem * pick.n + (pick.mode === 'all' ? W.listAll : W.listOrder);
    const parts = keyParts(q.answer);
    if (parts) r += W.part * (parts - 1);
    if (q.image) r += W.picture;
    raw.push(r);
  }
  // A set's questions as a whole: shrunk toward the bank for small sets.
  const bySet = new Map();
  qs.forEach((q, i) => { if (!bySet.has(q.set)) bySet.set(q.set, []); bySet.get(q.set).push(content[i]); });
  const all = mean(content);
  const setShift = new Map([...bySet].map(([s, xs]) => [s, W.set * (mean(xs) - all) * xs.length / (xs.length + W.setShrink)]));
  raw.forEach((r, i) => { raw[i] = r + setShift.get(qs[i].set); });

  const toScale = zScorer(raw);
  qs.forEach((q, i) => { q.difficulty = onScale(raw[i], toScale); });
  return averages(qs);
}

// 5 + SPREAD points per standard deviation; below 1 it bends toward 0 without reaching it,
// so the easiest questions still keep their order.
function onScale(r, z) {
  const d = 5 + SPREAD * z(r);
  return round2(d >= 1 ? d : Math.exp(d - 1));
}

export const roundKey = (set, round) => `${set}\u0001${round}`;

// Average difficulty of each set and each round of a set.
export function averages(questions) {
  const sets = new Map(), rounds = new Map();
  const add = (m, k, d) => { const a = m.get(k) || [0, 0]; a[0] += d; a[1]++; m.set(k, a); };
  for (const q of questions) {
    if (typeof q.difficulty !== 'number') continue;
    add(sets, q.set, q.difficulty);
    add(rounds, roundKey(q.set, q.round), q.difficulty);
  }
  const avg = m => new Map([...m].map(([k, [s, n]]) => [k, round2(s / n)]));
  return { sets: avg(sets), rounds: avg(rounds) };
}

// "5.46" for display.
export const formatDifficulty = d => (typeof d === 'number' ? d.toFixed(2) : '');

// A band name for a number, for colors and screen readers.
export function difficultyBand(d) {
  return d < 3 ? 'easy' : d < 5 ? 'medium' : d < 7 ? 'hard' : d < 9 ? 'very hard' : 'extreme';
}

export const DIFFICULTY_NOTE = 'Rated from 0 (easiest) to 10 (hardest); the hardest few go past 10. 5 is a typical question.';

// The colored "Difficulty 5.46" pill. what: 'question' | 'round' | 'set'; short drops the word.
export function difficultyBadge(d, { what = 'question', short = false, extra = '' } = {}) {
  if (typeof d !== 'number') return null;
  const band = difficultyBand(d);
  const label = what === 'question' ? 'Difficulty' : `${what[0].toUpperCase()}${what.slice(1)} difficulty`;
  return el('span', {
    class: 'diff', dataset: { band: band.replace(' ', '-') },
    title: `${label} ${formatDifficulty(d)} (${band}${what === 'question' ? '' : `: the average of its questions`}). ${DIFFICULTY_NOTE}${extra ? ` ${extra}` : ''}`,
  }, short ? '' : `${what === 'question' ? 'Difficulty' : label} `, el('b', {}, formatDifficulty(d)));
}
