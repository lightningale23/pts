// Difficulty ratings: every question gets a number on a 0–10 scale (the hardest go past 10),
// worked out from the question itself; rounds and sets get the average of their questions.
// Nothing comes from players' results, so every browser (and every room) sees the same numbers.
//
// How: each question is described by FEATURES (below), and a linear model turns them into a
// number. The model's weights were fitted to hand ratings of a sample of 444 questions from
// both banks, rated against a fixed rubric (importer/difficulty/: RUBRIC.md, the ratings, and
// fit.py, which refits and writes MODEL here). The features that matter most:
//   niche       the question's technical words: rare in everyday English (js/english-words.js)
//               AND rare in the bank (few questions ever mention them). Common-English words
//               like "calendar" or "snail" don't count, however rare in the bank; neither do
//               people's names in story questions ("Anurag throws...") or pronunciation guides.
//   answer      how technical and how rare the answer is, and how often the bank asks for it
//   calculation a number to work out, with how much there is to work with (given numbers,
//               math, radicals/π/fractions in the answer) and how long the setup is
//   format      multiple choice (the answer is on the screen) vs short answer; toss-up vs bonus;
//               middle vs high school; select-all and ordering lists; answers in parts
//   set         the set's questions as a whole (a set full of niche questions is a hard set)
//   ai          optional: how hard local AI models of different sizes found it (the "model ladder",
//               data/ai-difficulty.csv from importer/difficulty/ladder.mjs + ladder_fit.py). Used
//               only once fit.py has given it a weight; questions without a value get `aiMissing`.
// Round stage and length on their own count for little: a long question isn't a hard one.

import { listPick } from './text.js';
import { el } from './util.js';

// Fitted by importer/difficulty/fit.py (ridge regression on the hand ratings); don't edit by hand.
// MODEL-START
export const MODEL = {"intercept":0.7718,"weights":{"ms":-0.0407,"bonus":0.5206,"mc":0.1819,"early":1.0529,"mid":1.3067,"late":1.7671,"other":0.8045,"math":0.1593,"phys":-0.3717,"chem":0.18,"bio":-0.3455,"ess":0.2469,"energy":-0.7229,"cs":-0.9085,"niche":0.1839,"niche2":-0.0226,"tech":0.0437,"ansNiche":1.3193,"ansTech":-0.6969,"ansFam":0.2152,"mcAnsNiche":-0.1588,"ansWords":0.7979,"calc":-0.6717,"calcLen":0.1694,"calcNums":0.1029,"calcMath":0.2515,"hardForm":-2.0873,"nums":-0.0811,"len":0.486,"listN":-0.1907,"listAll":0.7359,"listOrder":0.7825,"parts":0.2045,"picture":-0.3893,"negation":0.1276,"ansNums":2.6044,"saAnsNiche":1.4781,"bonusCalc":0.2082,"calcHardForm":1.0246,"setNiche":5.3289,"setTech":7.4423,"setLen":-2.5574},"center":3.467,"stretch":1.308};
// MODEL-END

const STOP = new Set(`the and for are was were with that this which what from into its has have had been being
than then them they their there these those when where who whom whose why how not but all any each one two three
four five six both also only such can could would should will shall may might must per about above after again
against below between during before under over very more most less least other same some own out off our you your
his her him she he it of to in on at by an or as is be do does did a i if so no nor too us we me my
following called known used use uses using give name identify term type types refer refers
answer question choice statement statements correct true false best given number value units unit read`.split(/\s+/));

// Words that follow a person's name in story questions ("Anurag throws a ball").
const NARRATIVE = new Set(`is was has had wants wanted notices noticed finds found throws threw observes observed decides
decided places placed uses used takes took puts rolls rolled buys bought walks walked studies studied discovers discovered
measures measured drops dropped sees saw owns plays played makes made gets got tries tried needs holds held says said
ties tied pushes pushed feels felt grows grew dissolves dissolved checks checked scored types typed creates created builds
built draws drew picks picked tosses tossed flips flipped chooses chose lives loves likes thinks knows believes claims
realizes realized sets runs ran drives drove jumps jumped swims eats ate drinks licks frolicking is will would can
accidentally just really wishes wished starts started begins began goes went comes came looks looked shoots shot kicks
kicked fires fired mixes mixed heats heated cools cooled adds added pours poured connects connected attaches attached
designs designed models modeled plots plotted graphs graphed writes wrote reads computes computed calculates calculated
spins spun swings swung lifts lifted carries carried sends sent receives received`.split(/\s+/));

const MATH = /\$(?:\\\$|[^$])+\$/g;
const GUIDE = /\[[^\]]*\]|\((?:read|pronounced|say)[^)]*\)/gi;   // [read: ...], [tell-en-SEH-fuh-lawn]

// Ranks of everyday English words (1 = most common), from js/english-words.js.
export function englishRanks(list) {
  const m = new Map();
  String(list || '').split(' ').forEach((w, i) => { if (w && !m.has(w)) m.set(w, i + 1); });
  return m;
}

// How technical a word is, 0 (everyday) to 1 (not among the 25,000 commonest English words).
export function technical(w, english) {
  if (!english || !english.size) return 0.5;
  const r = english.get(w) ?? english.get(`${w}s`) ?? (w.endsWith('e') ? english.get(`${w}d`) : undefined);
  if (!r) return 1;
  return Math.max(0, Math.min(1, (Math.log10(r) - 3) / 1.4));   // rank 1,000 → 0, ~25,000 → 1
}

// Lower-case content words (math, guides, common words and people's names left out; plurals folded).
export function contentWords(text, english) {
  const s = String(text || '').replace(MATH, ' ').replace(GUIDE, ' ').replace(/\\\$/g, ' ');
  const toks = s.split(/[^A-Za-z'-]+/);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    let w = toks[i];
    if (w.length < 3) continue;
    if (/^['-]|['-]$|'s$/.test(w)) w = w.replace(/^['-]+|'s$|['-]+$/g, '');
    const lower = w.toLowerCase();
    if (english && /^[A-Z][a-z]+$/.test(w) && !english.has(lower) && isName(toks, i)) continue;
    let v = lower;
    if (v.length > 4 && v.endsWith('s') && !/(ss|us|is)$/.test(v)) v = v.slice(0, -1);
    if (v.length > 2 && !STOP.has(v)) out.push(v);
  }
  return out;
}

// A capitalized word used as a person's name: followed by a story verb, or "X and Y".
function isName(toks, i) {
  const next = (toks[i + 1] || '').toLowerCase();
  if (NARRATIVE.has(next)) return true;
  if (next === 'and' && /^[A-Z][a-z]+$/.test(toks[i + 2] || '')) return true;
  if ((toks[i - 1] || '') === 'and' && /^[A-Z][a-z]+$/.test(toks[i - 2] || '')) return true;
  return false;
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

// A short answer that's a number or an expression to work out ("12", "3/4", "$2\sqrt{3}$ m/s"),
// or multiple choice whose options are all numbers.
export function isCalculation(q) {
  const a = answerCore(q);
  if (q.choices) return q.choices.filter(Boolean).length >= 3 && q.choices.every(c => !c || (/\d/.test(c) && contentWords(c).length <= 2));
  if (answerNumbers(q) >= 3 && !/^\s*\(?[1-9IV]+\s*[).:]/.test(a)) return true;   // a matrix, a list of values
  return /\d/.test(a) && contentWords(a).length <= 2 && !/^[1-9IV]+\s*[).:]/.test(a.trim());
}

// How many numbers the answer has to give (a matrix inverse has nine).
export function answerNumbers(q) {
  if (q.choices) return 0;
  return (String(q.answer || '').replace(/\[[^\]]*\]/g, ' ').match(/-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/g) || []).length;
}

// An answer you'd have to work to get into its form: radicals, π, fractions, powers, logs.
export function hardForm(q) {
  const a = q.choices ? (q.answerText || '') : answerCore(q);
  return /sqrt|√|\\sqrt|\\pi|π|\bpi\b|\\frac|\d\s*\/\s*\d|[\d)}]\s*\^|\be\^|\bln\b|\blog\b|\\cdot|×\s*10/i.test(a);
}

// How many parts an answer key has ("1) X; 2) Y" → 2), else 0.
export function keyParts(answer) {
  const s = String(answer || '');
  if (!/^\s*\(?(?:1|I|A)\s*[).:–-]/.test(s)) return 0;
  const ROM = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  let n = 1;
  for (const m of s.matchAll(/(?:^|[\s;,])\(?(\d|I{1,3}|IV|V|VI|[A-F])\s*[).:–]/g)) {
    const v = /\d/.test(m[1]) ? +m[1] : ROM.includes(m[1]) ? ROM.indexOf(m[1]) + 1 : m[1].charCodeAt(0) - 64;
    if (v === n + 1) n++;
  }
  return n >= 2 ? n : 0;
}

const numbersIn = text => (String(text || '').replace(GUIDE, ' ').match(/(?<![a-z])\d+(?:\.\d+)?/gi) || []).length;
const mathIn = text => (String(text || '').match(MATH) || []).length;
const SUBJECTS = { Mathematics: 'math', Physics: 'phys', Chemistry: 'chem', Biology: 'bio', 'Earth and Space': 'ess', Energy: 'energy', 'Computer Science': 'cs' };
const STAGES = ['early', 'mid', 'late', 'other'];
const top = (xs, k) => xs.sort((a, b) => b - a).slice(0, k);
const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round2 = x => Math.round(x * 100) / 100;

export const FEATURES = [
  'ms', 'bonus', 'mc', 'early', 'mid', 'late', 'other',
  'math', 'phys', 'chem', 'bio', 'ess', 'energy', 'cs',
  'niche', 'niche2', 'tech', 'ansNiche', 'ansTech', 'ansFam', 'mcAnsNiche', 'ansWords',
  'calc', 'calcLen', 'calcNums', 'calcMath', 'hardForm', 'nums',
  'len', 'listN', 'listAll', 'listOrder', 'parts', 'picture', 'negation',
  'ansNums', 'saAnsNiche', 'bonusCalc', 'calcHardForm', 'setNiche', 'setTech', 'setLen',
  'ai', 'aiMissing',
];

// Does the model use the AI ladder (so data/ai-difficulty.csv is worth loading)?
export const usesAi = (model = MODEL) => Boolean(model.weights.ai || model.weights.aiMissing);

// data/ai-difficulty.csv (id,ai) → Map(id → number).
export function parseAiCsv(text) {
  const m = new Map();
  for (const line of String(text || '').split(/\r?\n/).slice(1)) {
    const [id, v] = line.split(',');
    if (id && v !== undefined && v !== '' && Number.isFinite(+v)) m.set(id.trim(), +v);
  }
  return m;
}

// The heavy part, in slices (see difficultyJob): word statistics of the whole bank, then each
// question's features, then the model.
function* difficultySteps(questions, english, model, ai = null) {
  const qs = questions.filter(Boolean);
  if (!qs.length) return { sets: new Map(), rounds: new Map() };
  const CHUNK = 1500;
  const df = new Map(), answers = new Map();
  const entries = (text, i, out) => {
    for (const w of contentWords(text, english)) {
      let e = df.get(w);
      if (!e) df.set(w, (e = { n: 0, last: -1, rare: 0, tech: technical(w, english) }));
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
    const stem = entries(q.question, i, []);
    const ans = entries(core, i, []);
    if (q.choices) for (const c of q.choices) entries(c, i, null);
    const key = core.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key) answers.set(key, (answers.get(key) || 0) + 1);
    words.push({ stem, ans, key });
  }
  // Bank rarity: 1 for a word in one question, 0.5 in about 7, 0 in 50 or more (a topic the
  // bank asks about that often is standard material). Scaled to a bank of SB's size.
  const scale = 42000 / qs.length;
  for (const e of df.values()) e.rare = Math.max(0, Math.min(1, 1 - Math.log(e.n * scale) / Math.log(50)));

  const feats = [];
  for (let i = 0; i < qs.length; i++) {
    if (i % CHUNK === 0) yield;
    feats.push(featuresOf(qs[i], words[i], answers, ai));
  }
  // The set's questions as a whole (shrunk toward the bank for small sets).
  const bySet = new Map();
  qs.forEach((q, i) => { const a = bySet.get(q.set) || []; a.push(i); bySet.set(q.set, a); });
  const setMean = k => {
    const all = avg(feats.map(f => f[k]));
    return new Map([...bySet].map(([s, is]) => [s, (avg(is.map(i => feats[i][k])) - all) * is.length / (is.length + 20)]));
  };
  const setNiche = setMean('niche'), setTech = setMean('tech'), setLen = setMean('len');
  yield;
  qs.forEach((q, i) => {
    feats[i].setNiche = setNiche.get(q.set);
    feats[i].setTech = setTech.get(q.set);
    feats[i].setLen = setLen.get(q.set);
    if (model.capture) model.capture.set(q.id, feats[i]);
    else q.difficulty = scoreOf(feats[i], model);
  });
  return averages(qs);
}

// One question's features (see FEATURES). w: its words as entries from the bank's word table;
// ai: Map(id → model ladder difficulty), or null when there's no ladder data at all.
function featuresOf(q, w, answers, ai) {
  const mc = q.format === 'mc' ? 1 : 0;
  const seen = new Set(), vals = [];
  let techN = 0;
  for (const e of w.stem) {
    if (seen.has(e)) continue;
    seen.add(e);
    vals.push(e.tech * e.rare);
    if (e.tech >= 0.7) techN++;
  }
  const niches = top(vals, 2);
  const calc = isCalculation(q) ? 1 : 0;
  const ansVals = calc ? [] : [...new Set(w.ans)];
  const len = Math.log(1 + w.stem.length + numbersIn(q.question) + mathIn(q.question));
  const nums = Math.min(8, numbersIn(q.question));
  const pick = listPick(q);
  const parts = keyParts(q.answer);
  const subj = SUBJECTS[q.subject];
  const f = {
    ms: q.level === 'MS' ? 1 : 0, bonus: q.type === 'bonus' ? 1 : 0, mc,
    niche: niches[0] || 0, niche2: niches[1] || 0,
    tech: Math.min(6, techN) / 6,
    ansNiche: ansVals.length ? Math.max(...ansVals.map(e => e.tech * e.rare)) : 0,
    ansTech: ansVals.length ? Math.max(...ansVals.map(e => e.tech)) : 0,
    ansFam: calc ? 0 : Math.log(1 + (w.key ? answers.get(w.key) || 0 : 0)),
    ansWords: Math.min(5, ansVals.length) / 5,
    calc, calcLen: calc * len, calcNums: calc * nums, calcMath: calc * Math.min(6, mathIn(q.question)),
    hardForm: calc && hardForm(q) ? 1 : 0, nums,
    len, listN: pick ? pick.n : 0, listAll: pick?.mode === 'all' ? 1 : 0, listOrder: pick?.mode === 'order' ? 1 : 0,
    parts: parts ? parts - 1 : 0, picture: q.image ? 1 : 0,
    negation: /\b(NOT|LEAST|EXCEPT|FALSE)\b/.test(q.question) ? 1 : 0,
    ansNums: Math.min(9, answerNumbers(q)) / 9,
    setNiche: 0, setTech: 0, setLen: 0,
    ai: 0, aiMissing: 0,
  };
  if (ai && ai.size) {
    const v = ai.get(q.id);
    if (typeof v === 'number') f.ai = v; else f.aiMissing = 1;
  }
  f.mcAnsNiche = mc * f.ansNiche;
  f.saAnsNiche = (1 - mc) * (1 - calc) * f.ansNiche;   // a rare answer you have to come up with yourself
  f.bonusCalc = f.bonus * calc;
  f.calcHardForm = calc * f.hardForm * len;
  for (const s of STAGES) f[s] = q.stage === s ? 1 : 0;
  for (const s of Object.values(SUBJECTS)) f[s] = subj === s ? 1 : 0;
  return f;
}

// The model's number for a set of features, put on the 0–10 scale. Below 1 it bends toward 0
// without reaching it, so the easiest questions keep their order; there's no top.
const weightLists = new WeakMap();
export function scoreOf(f, model = MODEL) {
  let ws = weightLists.get(model);
  if (!ws) weightLists.set(model, (ws = Object.entries(model.weights)));
  let r = model.intercept;
  for (const [k, w] of ws) r += w * (f[k] || 0);
  const d = model.center + (r - model.center) * model.stretch;
  return round2(d >= 1 ? d : Math.exp(d - 1));
}

// Features of every question, for importer/difficulty/fit.py (no model applied).
export function bankFeatures(questions, english, ai = null) {
  const out = new Map();
  const it = difficultySteps(questions, english, { intercept: 0, weights: {}, center: 0, stretch: 1, capture: out }, ai);
  let r;
  do r = it.next(); while (!r.done);
  return out;
}

// Rates every question (sets q.difficulty) and returns the averages for sets and rounds:
// { sets: Map(set → number), rounds: Map(roundKey(set, round) → number) }.
// english: englishRanks(list) of js/english-words.js; ai: parseAiCsv(data/ai-difficulty.csv) or null.
export function rateDifficulty(questions, english, model = MODEL, ai = null) {
  return difficultyJob(questions, english, model, ai).finish();
}

// The same in slices, so a big bank can be rated while the page stays responsive:
// job.step(ms) works for about ms milliseconds and returns the result once done (else null);
// job.finish() does the rest at once.
export function difficultyJob(questions, english, model = MODEL, ai = null) {
  const it = difficultySteps(questions, english, model, ai);
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
  const mean = m => new Map([...m].map(([k, [s, n]]) => [k, round2(s / n)]));
  return { sets: mean(sets), rounds: mean(rounds) };
}

// "5.46" for display.
export const formatDifficulty = d => (typeof d === 'number' ? d.toFixed(2) : '');

// A band name for a number (tooltips and screen readers).
export function difficultyBand(d) {
  return d < 2 ? 'easy' : d < 4 ? 'standard' : d < 6 ? 'tough' : d < 8 ? 'hard' : d < 10 ? 'very hard' : 'extreme';
}

export const DIFFICULTY_NOTE = 'Difficulty from 0 (easiest) to 10 (hardest); the very hardest go past 10.';

// The gold difficulty number. what: 'question' | 'round' | 'set'.
export function difficultyBadge(d, { what = 'question', extra = '' } = {}) {
  if (typeof d !== 'number') return null;
  const label = what === 'question' ? 'Difficulty' : `${what === 'set' ? 'Set' : 'Round'} difficulty`;
  const text = `${label} ${formatDifficulty(d)}: ${difficultyBand(d)}${what === 'question' ? '' : ' (the average of its questions)'}.`;
  return el('span', { class: 'diff', title: `${text} ${DIFFICULTY_NOTE}${extra ? ` ${extra}` : ''}`, 'aria-label': text }, formatDifficulty(d));
}
