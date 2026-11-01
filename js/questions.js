import { csvToObjects } from './csv.js';
import { hash, shuffle, store } from './util.js';

// Current DOE categories first; legacy ones (pre-2011 packets) are kept as-is.
export const SUBJECT_ORDER = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Earth and Space', 'Energy',
  'General Science', 'Astronomy', 'Computer Science'];

const SUBJECT_ALIASES = {
  bio: 'Biology', biology: 'Biology', 'life science': 'Biology', 'life sciences': 'Biology',
  chem: 'Chemistry', chemistry: 'Chemistry',
  phys: 'Physics', physics: 'Physics', 'physical science': 'Physics',
  math: 'Mathematics', maths: 'Mathematics', mathematics: 'Mathematics',
  'earth and space': 'Earth and Space', 'earth and space science': 'Earth and Space', 'earth & space': 'Earth and Space',
  'earth & space science': 'Earth and Space', ess: 'Earth and Space', 'earth science': 'Earth and Space',
  'earth/space': 'Earth and Space', astronomy: 'Astronomy',
  energy: 'Energy',
  'general science': 'General Science', 'gen sci': 'General Science',
  'computer science': 'Computer Science', cs: 'Computer Science',
};

export const SUBJECT_SHORT = {
  Biology: 'Bio', Chemistry: 'Chem', Physics: 'Physics', Mathematics: 'Math', 'Earth and Space': 'ESS',
  Energy: 'Energy', 'General Science': 'Gen', Astronomy: 'Astro', 'Computer Science': 'CS',
};

export function normalizeSubject(s) {
  const k = (s || '').trim().toLowerCase();
  if (!k) return 'Uncategorized';
  if (SUBJECT_ALIASES[k]) return SUBJECT_ALIASES[k];
  return k.replace(/\b\w/g, c => c.toUpperCase());
}

const pick = (o, ...keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return ''; };

// Turn a raw sheet row into a normalized question object (or null if unusable).
export function normalizeRow(r) {
  const question = pick(r, 'question', 'text', 'stem');
  const answer = pick(r, 'answer', 'answers');
  if (!question || !answer) return null;

  const typeRaw = pick(r, 'type', 'kind').toLowerCase().replace(/[^a-z]/g, '');
  const type = typeRaw.startsWith('b') ? 'bonus' : 'tossup';

  const choices = ['w', 'x', 'y', 'z'].map(l => pick(r, l, `choice ${l}`, `${l})`));
  const fmtRaw = pick(r, 'format').toLowerCase();
  const isMC = fmtRaw ? /mult|mc|choice/.test(fmtRaw) : choices.some(Boolean);

  const q = {
    set: pick(r, 'set', 'source', 'packet', 'tournament'),
    year: pick(r, 'year'),
    level: (pick(r, 'level', 'division') || '').toUpperCase().startsWith('M') ? 'MS' : (pick(r, 'level', 'division') ? 'HS' : ''),
    round: pick(r, 'round'),
    num: pick(r, 'num', 'number', 'question number', '#'),
    type,
    subject: normalizeSubject(pick(r, 'subject', 'category')),
    format: isMC ? 'mc' : 'sa',
    question,
    choices: isMC ? choices : null,
    answer,
    accept: pick(r, 'accept', 'alternates', 'also accept'),
    reject: pick(r, 'reject', 'do not accept'),
    notes: pick(r, 'notes'),
  };
  if (!q.year) { const m = q.set.match(/\b(19|20)\d{2}\b/); if (m) q.year = m[0]; }

  // Multiple choice: work out the correct letter + text.
  if (q.choices) {
    const m = answer.trim().match(/^\(?([WXYZ])\)?(?:[).:\s-]+(.*))?$/i);
    if (m) {
      q.answerLetter = m[1].toUpperCase();
      q.answerText = (m[2] || q.choices['WXYZ'.indexOf(q.answerLetter)] || '').trim();
    } else {
      const idx = q.choices.findIndex(c => c && c.toLowerCase() === answer.trim().toLowerCase());
      if (idx >= 0) { q.answerLetter = 'WXYZ'[idx]; q.answerText = q.choices[idx]; }
    }
  }
  q.id = pick(r, 'id') || hash([q.set, q.round, q.num, q.type, q.question].join('|'));
  return q;
}

export function parseQuestions(csvText) {
  const seen = new Map();
  const out = [];
  for (const r of csvToObjects(csvText)) {
    const q = normalizeRow(r);
    if (!q) continue;
    const prev = seen.get(q.id);
    if (prev) {
      if (prev.question === q.question && prev.answer === q.answer) continue; // the same question twice
      // Two different questions whose derived IDs collide (likely somewhere in a bank of
      // tens of thousands): keep both, giving the second a longer ID.
      q.id = `${q.id}-${hash([q.question, q.answer, q.round, q.num].join('|'))}`;
      if (seen.has(q.id)) continue;
    }
    seen.set(q.id, q);
    out.push(q);
  }
  return out;
}

// ── Loading ─────────────────────────────────────────────────────────────
const CACHE_KEY = 'lockout.sheetCache.v1';

export function sheetUrl(cfg) {
  if (cfg.sheetCsvUrl) return cfg.sheetCsvUrl;
  if (cfg.sheetId) {
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(cfg.sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(cfg.sheetTab || 'Questions')}`;
  }
  return '';
}

// Loads the question bank files in the repo, plus the Google Sheet if one is set up,
// and merges them (a question in both counts once). Falls back to the samples.
export async function loadQuestions(cfg, { force = false } = {}) {
  const lists = [];
  const sources = [];
  const warnings = [];

  for (const file of cfg.bankFiles || []) {
    try {
      const res = await fetch(file, { cache: force ? 'reload' : 'default' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const qs = parseQuestions(await res.text());
      lists.push(qs);
      sources.push(`${qs.length.toLocaleString()} from the question bank`);
    } catch (err) {
      warnings.push(`Couldn't load ${file} (${err.message || err}).`);
    }
  }

  if (sheetUrl(cfg)) {
    const sheet = await loadSheet(cfg, force);
    if (sheet.questions) {
      lists.push(sheet.questions);
      sources.push(`${sheet.questions.length.toLocaleString()} from the Google Sheet${sheet.note ? ` (${sheet.note})` : ''}`);
    }
    if (sheet.warning) warnings.push(sheet.warning);
  }

  let questions = [];
  const seen = new Set();
  for (const q of lists.flat()) if (!seen.has(q.id)) { seen.add(q.id); questions.push(q); }

  if (!questions.length) {
    const fb = await fetchFallback(cfg);
    questions = fb.questions;
    sources.push('sample questions');
  }
  return {
    questions,
    source: sources.join(' and '),
    updated: Date.now(),
    warning: warnings.length ? warnings.join(' ') : undefined,
  };
}

async function loadSheet(cfg, force) {
  const url = sheetUrl(cfg);
  const cached = store.get(CACHE_KEY, null);
  const fresh = cached && cached.url === url && Date.now() - cached.t < cfg.cacheMinutes * 60e3;
  if (fresh && !force) return { questions: parseQuestions(cached.csv), note: 'saved copy' };
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csv = await res.text();
    if (/^\s*</.test(csv)) throw new Error('got a web page instead of CSV; check the sheet is shared or published');
    const questions = parseQuestions(csv);
    store.set(CACHE_KEY, { url, t: Date.now(), csv }); // may fail silently on very large sheets
    return { questions };
  } catch (err) {
    console.warn('Sheet load failed:', err);
    if (cached && cached.url === url) {
      return { questions: parseQuestions(cached.csv), note: 'offline copy', warning: `Couldn't reach the Google Sheet (${err.message || err}); using the last saved copy.` };
    }
    return { questions: null, warning: `Couldn't load the Google Sheet (${err.message || err}).` };
  }
}

async function fetchFallback(cfg) {
  const res = await fetch(cfg.fallbackCsv);
  const csv = await res.text();
  return { questions: parseQuestions(csv) };
}

// ── Filtering & question order ──────────────────────────────────────────
export function facets(questions) {
  const count = (fn) => {
    const m = new Map();
    for (const q of questions) { const k = fn(q); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const subjects = count(q => q.subject);
  const sortedSubjects = [...subjects.keys()].sort((a, b) => {
    const ia = SUBJECT_ORDER.indexOf(a), ib = SUBJECT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return {
    subjects: sortedSubjects.map(s => [s, subjects.get(s)]),
    sets: [...count(q => q.set)].sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true })),
    levels: [...count(q => q.level)],
    years: [...count(q => q.year)].sort(),
  };
}

export function matchesFilters(q, f, ctx = {}) {
  if (f.subjects?.length && !f.subjects.includes(q.subject)) return false;
  if (f.formats?.length && !f.formats.includes(q.format)) return false;
  if (f.sets?.length && !f.sets.includes(q.set)) return false;
  if (f.level && q.level && q.level !== f.level) return false;
  if (f.yearMin && q.year && +q.year < +f.yearMin) return false;
  if (f.yearMax && q.year && +q.year > +f.yearMax) return false;
  if (f.missedOnly && ctx.missed && !ctx.missed.has(q.id)) return false;
  if (f.unseenOnly && ctx.seen && ctx.seen.has(q.id)) return false;
  return true;
}

const roundKey = (q) => `${q.set}|${q.round}|${q.num}`;
// One shared collator: far faster than localeCompare() when sorting tens of thousands of questions.
const numericCompare = new Intl.Collator(undefined, { numeric: true }).compare;

// Hands the engine one question at a time according to the settings.
export class QuestionSource {
  constructor(all, settings, ctx = {}) {
    this.all = all;
    this.byPair = new Map();
    for (const q of all) if (q.type === 'bonus') this.byPair.set(roundKey(q), q);
    this.queue = [];      // explicitly requested questions (from the database page)
    this.configure(settings, ctx);
  }

  configure(settings, ctx = {}) {
    this.settings = settings;
    this.ctx = ctx;
    const f = settings.filters || {};
    const mode = settings.typeMode || 'mixed';
    const wantType = mode === 'bonus' ? (q => q.type === 'bonus')
      : (mode === 'mixed' || mode === 'all') ? (() => true)
      : (q => q.type === 'tossup');
    this.pool = this.all.filter(q => wantType(q) && matchesFilters(q, f, ctx));
    this.order = settings.order === 'packet'
      ? this.pool.slice().sort((a, b) =>
          numericCompare(a.set, b.set) ||
          numericCompare(String(a.round), String(b.round)) ||
          (+a.num || 0) - (+b.num || 0) || (a.type === 'tossup' ? -1 : 1))
      : shuffle(this.pool);
    this.cursor = 0;
    this.usedBonuses = new Set();
  }

  get size() { return this.pool.length; }
  get remaining() { return this.order.length - this.cursor; }

  enqueue(q) { this.queue.push(q); }

  next() {
    if (this.queue.length) return this.queue.shift();
    if (!this.order.length) return null;
    if (this.cursor >= this.order.length) {
      // Wrap around: reshuffle (random order) or restart (packet order).
      if (this.settings.order !== 'packet') this.order = shuffle(this.pool);
      this.cursor = 0;
    }
    return this.order[this.cursor++];
  }

  // Bonus for a correctly answered toss-up: the paired bonus from the same packet
  // when there is one, otherwise a random bonus in the same subject.
  bonusFor(tossup) {
    const paired = tossup.set && tossup.num ? this.byPair.get(roundKey(tossup)) : null;
    if (paired && paired.subject === tossup.subject) return paired;
    const f = this.settings.filters || {};
    const candidates = this.all.filter(q => q.type === 'bonus' && q.subject === tossup.subject &&
      !this.usedBonuses.has(q.id) && matchesFilters(q, { ...f, subjects: null, missedOnly: false }, this.ctx));
    if (!candidates.length) return paired || null;
    const b = candidates[Math.floor(Math.random() * candidates.length)];
    this.usedBonuses.add(b.id);
    return b;
  }
}
