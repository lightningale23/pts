// Shared pieces of the AI difficulty signals (ladder.mjs, pairwise.mjs): loading the banks, talking
// to a local Ollama server, building prompts, cleaning model replies, and resumable JSONL output.
// Everything runs on the owner's computer with free local models; nothing here costs money.
import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseQuestions } from '../../js/questions.js';
import { assignStages } from '../../js/rounds.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const RUNS = path.join(ROOT, 'importer/difficulty/runs');   // raw results (gitignored)
export const read = f => readFileSync(path.join(ROOT, f), 'utf8');

// The banks as the site sees them: SB = bank + visual bonuses (no General Science), OSB.
export function loadBanks(which = 'all') {
  const out = [];
  if (which === 'all' || which === 'sb') {
    const sb = [...parseQuestions(read('data/questions.csv')), ...parseQuestions(read('data/visual-bonuses.csv'))]
      .filter(q => q.subject !== 'General Science');
    assignStages(sb);
    sb.forEach(q => { q.comp = 'sb'; });
    out.push(...sb);
  }
  if (which === 'all' || which === 'osb') {
    const osb = parseQuestions(read('data/osb-questions.csv'));
    assignStages(osb);
    osb.forEach(q => { q.comp = 'osb'; });
    out.push(...osb);
  }
  return out;
}

// The hand-rated questions: [{ id, rating }].
export function handRatings() {
  const ids = JSON.parse(read('importer/difficulty/sample-ids.json'));
  return read('importer/difficulty/ratings.txt').trim().split('\n')
    .map(l => l.trim().split(/\s+/).map(Number)).map(([i, r]) => ({ id: ids[i], rating: r }));
}

// ── Command line ────────────────────────────────────────────────────────
export function args(argv = process.argv.slice(2)) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) o[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) o[k] = argv[++i];
    else o[k] = true;
  }
  return o;
}

// A seeded random number generator, so samples are the same on every run.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export function shuffle(xs, rand) {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── Ollama ──────────────────────────────────────────────────────────────
export function ollama(host = process.env.OLLAMA_HOST || 'http://localhost:11434') {
  const base = /^https?:/.test(host) ? host.replace(/\/$/, '') : `http://${host}`;
  const post = async (p, body, tries = 3) => {
    for (let t = 1; ; t++) {
      try {
        const res = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const text = await res.text();
        if (!res.ok) throw Object.assign(new Error(`${p}: HTTP ${res.status} ${text.slice(0, 200)}`), { status: res.status });
        return JSON.parse(text);
      } catch (err) {
        if (t >= tries || (err.status && err.status < 500)) throw err;
        await new Promise(r => setTimeout(r, 1000 * t));
      }
    }
  };
  return {
    base,
    // { vision, thinking } for a model (Ollama 0.6+ reports capabilities; older ones: guess from the name).
    async info(model) {
      const r = await post('/api/show', { model });
      const caps = r.capabilities || [];
      const fam = JSON.stringify(r.details || {}) + model;
      return {
        vision: caps.includes('vision') || (!r.capabilities && /llava|vision|vl\b|gemma3:(4|12|27)b/i.test(fam)),
        thinking: caps.includes('thinking'),
      };
    },
    async chat(model, messages, { temperature = 0, seed = 1, maxTokens = 64, thinking = false } = {}) {
      const body = { model, messages, stream: false, options: { temperature, seed, num_predict: maxTokens } };
      if (thinking) body.think = false;   // reasoning models: answer straight away, like a player
      const r = await post('/api/chat', body);
      return r.message?.content ?? '';
    },
  };
}

// Runs fn over items with n at a time; calls progress(done) as they finish.
export async function pool(items, n, fn, progress = () => {}) {
  let next = 0, done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
      progress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

export function progressLine(label, total) {
  const t0 = Date.now();
  let last = 0;
  return done => {
    const now = Date.now();
    if (done < total && now - last < 2000) return;
    last = now;
    const rate = done / ((now - t0) / 1000);
    const eta = rate ? (total - done) / rate : 0;
    const h = Math.floor(eta / 3600), m = Math.round((eta % 3600) / 60);
    process.stderr.write(`\r${label}: ${done}/${total} (${rate.toFixed(1)}/s, about ${h ? `${h} h ` : ''}${m} min left)   `);
    if (done >= total) process.stderr.write('\n');
  };
}

// ── Results files (one JSON object per line; a rerun skips what's done) ──
export function jsonl(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const rows = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  return { rows, add: row => appendFileSync(file, `${JSON.stringify(row)}\n`) };
}

// ── Prompts ─────────────────────────────────────────────────────────────
const TYPE = q => `${q.type === 'bonus' ? 'Bonus' : 'Toss-up'}, ${q.subject}${q.level === 'MS' ? ', middle school' : ''}`;
const choicesText = q => q.choices.map((c, i) => `${'WXYZ'[i]}) ${c}`).join('\n');

// The question as a player hears it. cut < 1: only the first part of a toss-up was read
// (the model "buzzes early"); the choices come at the end, so they aren't heard either.
export function questionText(q, cut = 1) {
  if (cut >= 1) return q.choices ? `${q.question}\n\n${choicesText(q)}` : q.question;
  const words = String(q.question).split(/\s+/);
  return `${words.slice(0, Math.max(3, Math.round(words.length * cut))).join(' ')} …`;
}

export const CONTESTANT = `You are a contestant at the U.S. National Science Bowl. Reply with the answer only: no working, no explanation, no sentence.
- Multiple choice: reply with the letter and the choice, like "X) Mitochondria".
- A question in numbered parts: reply like "1) first answer; 2) second answer".
- A number: give just the number (and units if the question doesn't fix them).
- If the question was cut off, give your best guess anyway.`;

export function contestantMessages(q, cut = 1, image = null) {
  const user = { role: 'user', content: `${TYPE(q)}${q.choices && cut >= 1 ? ', multiple choice' : ''}\n\n${questionText(q, cut)}` };
  if (image) user.images = [image];
  return [{ role: 'system', content: CONTESTANT }, user];
}

// A model's reply as a player's answer: no reasoning blocks, no "The answer is", first line only.
export function cleanAnswer(text) {
  let s = String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
  s = s.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
  s = s.replace(/^\**\s*(final\s+)?answer\s*[:：]\s*\**/i, '')
    .replace(/^(the\s+)?(correct\s+)?answer\s+is\s*:?\s*/i, '')
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .replace(/\.$/, '')
    .trim();
  return s.slice(0, 200);
}

export const JUDGE = `You rate Science Bowl questions for difficulty, from the view of a strong high school Science Bowl player.
Scale: 0-1 trivial everyday knowledge; 2-3 easy textbook fact or one-step calculation; 4-5 typical regional question (solid HS coursework, two-step calculation, moderately rare term); 6-7 hard (AP/college depth, rare topic, calculation that takes real work in 20 s); 8-9 very hard (specialist knowledge few top players have, long calculation); 10+ extreme.
Multiple choice is easier than the same knowledge as short answer. Length, pictures and story setups don't make a question hard by themselves. Toss-ups must be answered within 5 seconds, bonuses within 20.`;

const shown = (q, label) => `Question ${label} (${TYPE(q)}${q.choices ? ', multiple choice' : ''}${q.image ? ', with a picture you can\'t see' : ''}):\n${questionText(q)}\nAnswer: ${q.choices && q.answerLetter ? `${q.answerLetter}) ${q.answerText}` : q.answer}`;

export function judgeMessages(a, b) {
  return [
    { role: 'system', content: JUDGE },
    { role: 'user', content: `${shown(a, 'A')}\n\n${shown(b, 'B')}\n\nWhich question is harder to answer correctly in time? Judge the knowledge or calculation it needs, not its length. Reply with one letter: A or B.` },
  ];
}

// "A" / "B" from a judge's reply, else null.
export function judgeChoice(text) {
  const s = String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
  const m = s.match(/\b([AB])\b/) || s.match(/^\s*\**([ab])\b/);   // capital A/B ("a" is a word)
  return m ? m[1].toUpperCase() : null;
}
