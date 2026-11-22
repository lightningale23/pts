// Difficulty ratings through the Claude API's Message Batches: one short request per 50 questions, half
// price, no growing conversation (about 1% of the cost of raters in Claude Code). Rubric, anchors,
// easy examples and calculation examples are in the prompt; three hidden calibration questions in each
// request measure drift.
//
// v3 (default since 2026-11-22, owner): Claude Haiku 5.5 rates every question to two decimals, and those
// ratings are the site's numbers as they are (export). v2 rated in half points and calibrated Haiku to the
// Claude Code raters (calibrate, then combine.py); kept for reference.
//
//   set ANTHROPIC_API_KEY first (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."), or put the key alone in
//   importer/difficulty/v2/.api-key (gitignored; never commit it)
//   node importer/difficulty/v2/batch_api.mjs validate [--n 400]   (a cheap check: 400 already-rated questions)
//   node importer/difficulty/v2/batch_api.mjs rate --all            (every question without a v3 rating)
//   node importer/difficulty/v2/batch_api.mjs status                (repeat until every batch says ended)
//   node importer/difficulty/v2/batch_api.mjs collect               (ratings → api-v3/<batch>.txt)
//   node importer/difficulty/v2/batch_api.mjs export                (api-v3 → data/difficulty.csv)
//   options: --model claude-sonnet-5-5, --size 50, --max-tokens 16000 (room to think), --limit N, --dry-run
//
// Questions the model skipped: run rate --all again (it only sends what's missing), collect, export.
// Key issues the model flags go to key-issues.txt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestions } from '../../../js/questions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const RATINGS = path.join(HERE, 'ratings');
const STATE = path.join(HERE, 'api-batches.json');
const RAW = path.join(HERE, 'api');   // v2: the API model's half-point ratings, before calibrate converts them
const RAW3 = path.join(HERE, 'api-v3');   // v3 (the default): Haiku's two-decimal ratings, used as they are
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const API = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');

// ── The bank (as rate.mjs builds it) ──
const SB = [...parseQuestions(read('data/questions.csv')), ...parseQuestions(read('data/visual-bonuses.csv'))]
  .filter(q => q.subject !== 'General Science');
const OSB = parseQuestions(read('data/osb-questions.csv'));
for (const q of SB) q.group = q.subject;
for (const q of OSB) q.group = 'OSB';
const ALL = [...SB, ...OSB];
const byId = new Map(ALL.map(q => [q.id, q]));
const ANCHORS = JSON.parse(fs.readFileSync(path.join(HERE, 'anchors.json'), 'utf8'));
const anchorList = Object.values(ANCHORS).flat().map(([id, d, why]) => ({ id, d, why })).filter(a => byId.has(a.id));

// Calculation questions rated by the Claude Code raters, shown in the prompt because the API model
// overrated routine calculations (validation, 2026-11-22). Left out of validation samples.
const CALC_EXAMPLES = ['5iwhh7', '150e276', '1ej7rvv', 'kfb9qx', 'txi4ow', '1ykyz68', 'wgw6tq', 'l6efak', '1jygrlh', 'pwxd3r',
  '1h1z67a', '1c9xp0v', '7jf70y', '1ksyxrk', 'nkgme3', 'd7nhu3', 'b70viv', '8clcxg', '1acfx3'].filter(id => byId.has(id));

// Easy questions with levels picked by hand (2026-11-22), so the bottom of the scale has examples:
// the v2 prompt's lowest example was 1.5 and the raters' 0s piled up. Left out of validation samples.
const LOW_EXAMPLES = [
  ['1mzgk66', 0.1, 'thylakoids are in chloroplasts, multiple choice: almost every team'],
  ['ptn2t2', 0.25, 'nucleotides in a codon'],
  ['1994yl5', 0.35, 'cones sense color'],
  ['pl64kf', 0.5, 'bacteria divide by binary fission'],
  ['170z0v0', 0.8, 'reduction happens at the cathode, recalled within 5 seconds'],
  ['1xflu0n', 1.3, 'the word amphoteric'],
  ['15ksk61', 1.7, 'Nernst equation as a toss-up: fewer than half of teams get it in time'],
].filter(([id]) => byId.has(id));

function loadRatings({ calOnly = false, raters = false, dir = RATINGS } = {}) {
  const m = new Map();
  if (!fs.existsSync(dir)) return m;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.txt') && (!calOnly || f.startsWith('cal-')) && (!raters || f !== 'api-calibrated.txt')).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      const [id, r] = line.trim().split(/\s+/);
      if (id && r !== undefined && !Number.isNaN(+r) && byId.has(id)) m.set(id, +r);
    }
  }
  return m;
}
const state = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { batches: [] });
const saveState = s => fs.writeFileSync(STATE, `${JSON.stringify(s, null, 1)}\n`);

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    else o._.push(argv[i]);
  }
  return o;
}
let seed = 12345;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const numOrder = new Intl.Collator(undefined, { numeric: true }).compare;
const order = (a, b) => (a.group || '').localeCompare(b.group || '') || (a.subject || '').localeCompare(b.subject || '') ||
  (a.subcat || '').localeCompare(b.subcat || '') || a.type.localeCompare(b.type) || numOrder(a.set, b.set) || a.id.localeCompare(b.id);

// ── Prompt ──
const TYPE = q => (q.type === 'bonus' ? (q.image ? 'VISUAL BONUS' : 'BONUS') : 'TOSS-UP');
function render(n, q) {
  const head = [q.group === 'OSB' ? `OSB ${q.subject}` : q.subject, q.subcat, TYPE(q), q.format === 'mc' ? 'Multiple Choice' : 'Short Answer', q.level || 'HS']
    .filter(Boolean).join(' · ');
  const lines = [`#${n}  [${head}]`];
  if (q.image) lines.push('(its picture is attached just below)');
  lines.push(String(q.question).trim());
  if (q.choices) lines.push(q.choices.map((c, i) => `${'WXYZ'[i]}) ${c}`).join('\n'));
  lines.push(`ANSWER: ${q.answer}${q.accept ? `  (ACCEPT: ${q.accept})` : ''}${q.reject ? `  (DO NOT ACCEPT: ${q.reject})` : ''}`);
  return lines.join('\n');
}
// The rubric's rating sections (definition, how to judge, anchors, calibration notes), without the
// workflow notes and the old expectations about where the bank's median should land.
function rubric() {
  const t = read('importer/difficulty/RUBRIC.md');
  const a = t.indexOf('## The definition'), b = t.indexOf('- The calibration sample');
  return t.slice(a, b > a ? b : t.indexOf('## Rating workflow')).trim();
}
function system() {
  const ex = (d, why, id) => `d = ${d}${why ? `  (${why})` : ''}\n${render('x', byId.get(id)).replace(/^#x\s+/, '')}`;
  const anchors = anchorList.slice().sort((a, b) => a.d - b.d).map(a => ex(a.d, a.why, a.id)).join('\n\n');
  const low = LOW_EXAMPLES.map(([id, d, why]) => ex(d, why, id)).join('\n\n');
  const rated = loadRatings();
  const calc = CALC_EXAMPLES.filter(id => rated.has(id)).sort((a, b) => rated.get(a) - rated.get(b))
    .map(id => ex(rated.get(id), '', id)).join('\n\n');
  return `You give Science Bowl questions a difficulty rating for a practice website. The rubric below is the whole definition; follow it exactly.

${rubric()}

## Reading the scale

d is about the share of teams that get the question right in time (no other team buzzing):

  d:     0     0.25   0.5   1     1.5   2     2.5   3     4     5     6     7     8     9     10
  teams: 100%  89%    79%   63%   50%   40%   32%   25%   16%   10%   6.3%  4%    2.5%  1.6%  1%

The field at an average online invitational is wide: a few national-level teams, a solid middle, and many
newer or casual teams, often strong in only one or two subjects. A question is near 0 only if essentially
every one of those teams, weak ones included, gets it in time; true 0s are very rare. A fact from the
standard high school course that most students have heard of is typically 0.3–1.5. Something a team
learns only from AP-level work or Science Bowl study is typically 2–4.

## Easy questions (the bottom of the scale)

${low}

## Anchor questions (their ratings fix the scale)

${anchors}

## Calculations: rate them by the method, not by how they look

A calculation is rated like knowing its formula whenever a player knows what to do with every number
the moment the question is read: one formula, two quick steps, Vieta's formulas, series and parallel
combinations, Henderson–Hasselbalch, a perpendicular slope. Those are about 0.5–2.5 however many
numbers they contain and however technical they look. If the formula is even slightly awkward, the
method isn't obvious (a trick, symmetry, an insight), there are several dependent steps, or the
arithmetic is genuinely heavy for the time allowed, the rating rises fast. These calculation questions
were rated by careful raters; match them:

${calc}

## Two more common mistakes

- Conceptual questions outside everyday mechanics (nuclear and particle physics, electricity and
  magnetism, thermodynamics, modern physics, optics beyond the basics) are less widely known than their
  short answers suggest. A one-word answer doesn't make a question easy: positron emission gives a
  neutrino is 2.
- The reverse: an easy fact on a fancy-sounding topic is easy. Influenza strains are named for HA and NA
  (about 1); El Niño and La Niña are phases of ENSO (about 1); rare words the question itself explains
  add nothing.

## How to answer

You'll get a numbered batch of questions. For EVERY question, in order, write exactly one line:
#n | what a team must know or do; about what share of teams gets it | rating
Give the rating to two decimals (for example 0.35, 1.80, 4.15, 6.60). Use the decimals: place each question
precisely against the table and the examples instead of rounding to whole or half numbers. No upper limit.
If the answer key is clearly wrong or the question is ambiguous, add " | KEY: what's wrong" at the end of
that line. Write nothing else.`;
}
function picture(q) {
  const f = path.join(ROOT, q.image || '');
  if (!q.image || !fs.existsSync(f)) return null;
  const ext = path.extname(f).slice(1).toLowerCase();
  const media = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }[ext];
  return media ? { type: 'image', source: { type: 'base64', media_type: media, data: fs.readFileSync(f).toString('base64') } } : null;
}
// One request: the questions plus 3 hidden calibration questions, shuffled in.
// room: output tokens for the model's thinking before it answers (Haiku 5.5 thinks first).
function request(customId, qs, cal, model, sys, room = 16000) {
  const checks = shuffle(cal).slice(0, 3).filter(c => !qs.some(q => q.id === c.id)).map(c => byId.get(c.id));
  const items = shuffle([...qs, ...checks]);
  const content = [{ type: 'text', text: `Rate these ${items.length} questions.` }];
  items.forEach((q, i) => {
    content.push({ type: 'text', text: render(i + 1, q) });
    const img = picture(q);
    if (img) content.push(img);
  });
  return {
    entry: { custom_id: customId, params: { model, max_tokens: room + 60 * items.length, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content }] } },
    ids: items.map(q => q.id),
  };
}

// ── API ──
async function api(method, p, body) {
  const keyFile = path.join(HERE, '.api-key');   // gitignored; one line, the key
  const key = process.env.ANTHROPIC_API_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '');
  if (!key) throw new Error('Set ANTHROPIC_API_KEY, or put the key alone in importer/difficulty/v2/.api-key (never commit it).');
  const res = await fetch(p.startsWith('http') ? p : `${API}${p}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p}: HTTP ${res.status} ${text.slice(0, 400)}`);
  return text;
}

async function submit(kind, qs, o) {
  const model = o.model || 'claude-haiku-5-5';
  const size = Math.max(5, +(o.size || 50));
  const cal = [...loadRatings({ calOnly: true })].map(([id, d]) => ({ id, d }));
  const sys = system();
  const plain = qs.filter(q => !q.image).sort(order), pics = qs.filter(q => q.image).sort(order);
  const chunks = [];
  for (let i = 0; i < plain.length; i += size) chunks.push(plain.slice(i, i + size));
  for (let i = 0; i < pics.length; i += 10) chunks.push(pics.slice(i, i + 10));   // pictures are big: 10 a request
  const tag = `${kind}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  const reqs = chunks.map((c, i) => request(`${tag}-${i}`, c, cal, model, sys, +(o['max-tokens'] || 16000)));
  // A batch may hold up to 256 MB: split if the pictures make it big.
  const parts = [];
  let cur = [], bytes = 0;
  for (const r of reqs) {
    const b = JSON.stringify(r.entry).length;
    if (cur.length && (bytes + b > 200e6 || cur.length >= 10000)) { parts.push(cur); cur = []; bytes = 0; }
    cur.push(r); bytes += b;
  }
  if (cur.length) parts.push(cur);
  // Rough cost (batch prices per million tokens, input/output); text ≈ 3.5 characters a token, a picture ≈ 1,600.
  const PRICE = { haiku: [0.05, 0.25], sonnet: [1, 5], opus: [2, 10] };
  const price = PRICE[Object.keys(PRICE).find(k => model.includes(k))];
  const nq = reqs.reduce((n, r) => n + r.ids.length, 0);
  const tin = reqs.reduce((n, r) => n + r.entry.params.messages[0].content.reduce((m, c) => m + (c.type === 'text' ? c.text.length / 3.5 : 1600), 0) + sys.length / 3.5, 0);
  const tout = nq * 250;   // the rating lines plus the model's thinking
  console.log(`about ${(tin / 1e6).toFixed(1)}M input + ${(tout / 1e6).toFixed(2)}M output tokens` +
    (price ? `, roughly $${(tin / 1e6 * price[0] + tout / 1e6 * price[1]).toFixed(2)} (prompt caching makes it less)` : ''));
  if (o['dry-run']) { console.log('--dry-run: nothing sent'); return; }
  const s = state();
  for (const part of parts) {
    const res = JSON.parse(await api('POST', '/v1/messages/batches', { requests: part.map(r => r.entry) }));
    s.batches.push({ id: res.id, kind, model, v: 3, at: new Date().toISOString(), collected: false, requests: Object.fromEntries(part.map(r => [r.entry.custom_id, r.ids])) });
    saveState(s);
    console.log(`submitted ${res.id}: ${part.length} requests, ${part.reduce((n, r) => n + r.ids.length, 0)} questions (incl. 3 hidden checks each), model ${model}`);
  }
  console.log('Check with: node importer/difficulty/v2/batch_api.mjs status   (usually done within an hour)');
}

const short = id => id.replace(/^msgbatch_/, '').replace(/[^\w-]/g, '');
const pendingIds = () => new Set(state().batches.filter(b => !b.collected).flatMap(b => Object.values(b.requests).flat()));

async function cmdValidate(o) {
  const rated = loadRatings();
  const cal = loadRatings({ calOnly: true });
  const anchorIds = new Set(anchorList.map(a => a.id));
  const ex = new Set([...CALC_EXAMPLES, ...LOW_EXAMPLES.map(e => e[0])]);
  const pool = [...rated.keys()].filter(id => !cal.has(id) && !anchorIds.has(id) && !ex.has(id)).map(id => byId.get(id));
  await submit('validate', shuffle(pool).slice(0, +(o.n || 400)), o);
}
async function cmdRate(o) {
  // --all: also the questions the Claude Code raters did, so calibrate can line the two up.
  const rated = o.all ? loadRatings({ dir: RAW3 }) : loadRatings(), busy = pendingIds();
  let todo = ALL.filter(q => !rated.has(q.id) && !busy.has(q.id));
  if (o.limit) todo = todo.slice(0, +o.limit);
  if (!todo.length) { console.log('Nothing left to rate.'); return; }
  console.log(`${todo.length} questions to rate (${rated.size} already rated, ${busy.size} waiting in uncollected batches)`);
  await submit('rate', todo, o);
}
async function cmdStatus() {
  const s = state();
  if (!s.batches.length) { console.log('No batches yet.'); return; }
  for (const b of s.batches) {
    if (b.collected) { console.log(`${b.id}  ${b.kind}  collected`); continue; }
    const r = JSON.parse(await api('GET', `/v1/messages/batches/${b.id}`));
    const c = r.request_counts || {};
    console.log(`${b.id}  ${b.kind}  ${r.processing_status}  done ${c.succeeded ?? 0}, errors ${c.errored ?? 0}, processing ${c.processing ?? 0}`);
  }
}

const spearman = (x, y) => {
  const rank = v => { const idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b]); const r = new Array(v.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++; for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2; i = j + 1; } return r; };
  const a = rank(x), b = rank(y), n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
};
// "#n | reason | rating [| KEY: ...]" lines → Map(n → { d, key })
// Forgiving: "**#3** | ...", "| 3 | ... | 2.5 |" (a table), "3. ... — 2.5", "#3: ... | d = 2.5/10".
export function parseReply(text) {
  const out = new Map();
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/[*`_]/g, '').trim().replace(/^\|\s*/, '');
    const m = line.match(/^#?\s*(\d+)\s*(?:[|.):\-–—]|\s)\s*(.*)$/);
    if (!m || !m[2]) continue;
    let rest = m[2];
    let key = '';
    const k = rest.match(/\|?\s*KEY\s*:\s*(.*)$/i);
    if (k) { key = k[1].replace(/\s*\|\s*$/, '').trim(); rest = rest.slice(0, k.index); }
    rest = rest.replace(/[\s|]+$/, '');
    // The rating is the last number on the line (after "d =" or "rating:" if written that way).
    const r = rest.match(/(?:^|[\s|:=(—–-])(\d+(?:\.\d+)?)\s*(?:\/\s*10)?\s*\)?$/);
    if (!r) continue;
    const d = +r[1];
    if (d >= 0 && d <= 20 && !out.has(+m[1])) out.set(+m[1], { d: Math.round(d * 100) / 100, key });
  }
  return out;
}

async function cmdCollect(o = {}) {
  const s = state();
  if (o.again) {
    const b = s.batches.find(b => b.id === o.again);
    if (!b) throw new Error(`no batch ${o.again} in api-batches.json`);
    b.collected = false;
    if (b.kind === 'rate') { const f = path.join(b.v === 3 ? RAW3 : RAW, `${short(b.id)}.txt`); if (fs.existsSync(f)) fs.unlinkSync(f); }
  }
  const cal = loadRatings({ calOnly: true });
  const before = loadRatings();
  for (const b of s.batches.filter(b => !b.collected)) {
    const info = JSON.parse(await api('GET', `/v1/messages/batches/${b.id}`));
    if (info.processing_status !== 'ended') { console.log(`${b.id}: still ${info.processing_status}`); continue; }
    const body = await api('GET', info.results_url);
    fs.writeFileSync(path.join(HERE, `api-raw-${short(b.id)}.jsonl`), body);   // kept for checking (gitignored)
    const got = new Map(), keys = [], checks = [];
    let failed = 0, missing = 0, shown = false;
    for (const line of body.split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      const ids = b.requests[r.custom_id];
      if (!ids) continue;
      if (r.result?.type !== 'succeeded') { failed++; continue; }
      const text = (r.result.message.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      const parsed = parseReply(text);
      if (parsed.size < ids.length && !shown) {
        shown = true;
        console.log(`  (one reply read only ${parsed.size} of ${ids.length} lines; stop reason ${r.result.message.stop_reason}. Its start:)\n` +
          text.split('\n').slice(0, 6).map(l => `    ${l.slice(0, 160)}`).join('\n'));
      }
      ids.forEach((id, i) => {
        const p = parsed.get(i + 1);
        if (!p) { missing++; return; }
        // A hidden check: its old rating measures drift. v3 keeps Haiku's own rating of it too (every
        // question needs one); v2 didn't (the raters' rating stood).
        if (cal.has(id)) { checks.push([p.d, cal.get(id)]); if (b.v !== 3 || b.kind !== 'rate') return; }
        got.set(id, p.d);
        if (p.key) keys.push(`${id}\tapi-${b.model}\t${p.key}`);
      });
    }
    const mad = checks.length ? checks.reduce((t, [a, c]) => t + Math.abs(a - c), 0) / checks.length : NaN;
    const bias = checks.length ? checks.reduce((t, [a, c]) => t + (a - c), 0) / checks.length : NaN;
    console.log(`${b.id} (${b.kind}, ${b.model}): ${got.size} ratings, ${missing} questions skipped, ${failed} requests failed; hidden checks off by ${mad.toFixed(2)} on average (bias ${bias >= 0 ? '+' : ''}${bias.toFixed(2)}) over ${checks.length}`);
    if (b.kind === 'validate') {
      const pairs = [...got].filter(([id]) => before.has(id) && !cal.has(id)).map(([id, d]) => [d, before.get(id), byId.get(id).group]);
      const report = (label, ps) => {
        if (ps.length < 5) return;
        const sp = spearman(ps.map(p => p[0]), ps.map(p => p[1]));
        const mae = ps.reduce((t, p) => t + Math.abs(p[0] - p[1]), 0) / ps.length;
        const bi = ps.reduce((t, p) => t + p[0] - p[1], 0) / ps.length;
        const w1 = ps.filter(p => Math.abs(p[0] - p[1]) <= 1).length / ps.length;
        console.log(`  ${label.padEnd(18)} n ${String(ps.length).padStart(3)}  Spearman ${sp.toFixed(2)}  MAE ${mae.toFixed(2)}  bias ${bi >= 0 ? '+' : ''}${bi.toFixed(2)}  within 1: ${(100 * w1).toFixed(0)}%`);
      };
      console.log('  agreement with the existing ratings:');
      report('all', pairs);
      for (const g of [...new Set(pairs.map(p => p[2]))].sort()) report(g, pairs.filter(p => p[2] === g));
      console.log('  Good enough if Spearman is about 0.8 or higher and the bias is small; otherwise try --model claude-sonnet-5-5.');
      fs.writeFileSync(path.join(HERE, `api-validate-${short(b.id)}.txt`), [...got].map(([id, d]) => `${id} ${d}`).join('\n') + '\n');
    } else {
      const dir = b.v === 3 ? RAW3 : RAW;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${short(b.id)}.txt`), [...got].map(([id, d]) => `${id} ${d}`).join('\n') + '\n');
      console.log(`  wrote importer/difficulty/v2/${path.basename(dir)}/${short(b.id)}.txt` + (b.v === 3 ? '' : ' (raw; run calibrate to turn them into ratings)'));
    }
    if (keys.length && !o.again) fs.appendFileSync(path.join(HERE, 'key-issues.txt'), keys.join('\n') + '\n');
    b.collected = true;
    saveState(s);
  }
}

// calibrate: convert the API model's ratings to the Claude Code raters' scale, subject by subject, by
// matching percentiles on the questions both rated (equipercentile linking: the model's order is kept,
// the raters' spread and level are taken). Writes ratings/api-calibrated.txt for questions the raters
// didn't do; their own ratings stay as they are.
function cmdCalibrate(o) {
  const human = loadRatings({ raters: true }), model = loadRatings({ dir: RAW });
  if (!model.size) throw new Error('No API ratings yet (run rate --all, then collect).');
  const groups = [...new Set(ALL.map(q => q.group))].sort();
  const pctl = (sorted, v) => { let lo = 0, hi = 0; for (const x of sorted) { if (x < v) lo++; if (x <= v) hi++; } return (lo + hi) / 2 / sorted.length; };
  const at = (sorted, p) => { const i = Math.min(sorted.length - 1, Math.max(0, p * sorted.length - 0.5)); const a = Math.floor(i), b = Math.ceil(i); return sorted[a] + (sorted[b] - sorted[a]) * (i - a); };
  const both = [...model.keys()].filter(id => human.has(id));
  const allPairs = both.map(id => [model.get(id), human.get(id)]);
  const out = [];
  console.log('group               overlap  Spearman  MAE before → after   to convert');
  for (const g of groups) {
    let pairs = both.filter(id => byId.get(id).group === g).map(id => [model.get(id), human.get(id)]);
    const note = pairs.length < 150 ? ' (too few: using all subjects)' : '';
    if (note) pairs = allPairs;
    const ms = pairs.map(p => p[0]).sort((a, b) => a - b), hs = pairs.map(p => p[1]).sort((a, b) => a - b);
    // Above the hardest question both rated, keep going in proportion (so over 10 stays possible).
    const sd = xs => { const m = xs.reduce((t, x) => t + x, 0) / xs.length; return Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / xs.length) || 1; };
    const ratio = sd(hs) / sd(ms), top = ms[ms.length - 1];
    const conv = v => Math.max(0, Math.round((v > top ? hs[hs.length - 1] + (v - top) * ratio : at(hs, pctl(ms, v))) * 2) / 2);
    const fit = pairs.map(([m, h]) => [conv(m), h]);
    const mae = ps => ps.reduce((t, [a, b]) => t + Math.abs(a - b), 0) / ps.length;
    const todo = [...model].filter(([id]) => !human.has(id) && byId.get(id).group === g);
    for (const [id, v] of todo) out.push(`${id} ${conv(v)}`);
    console.log(`${g.padEnd(20)}${String(pairs.length).padStart(7)}  ${spearman(pairs.map(p => p[0]), pairs.map(p => p[1])).toFixed(2).padStart(8)}  ${mae(pairs).toFixed(2).padStart(6)} → ${mae(fit).toFixed(2)}  ${String(todo.length).padStart(11)}${note}`);
  }
  fs.writeFileSync(path.join(RATINGS, 'api-calibrated.txt'), out.join('\n') + '\n');
  const rated = loadRatings();
  console.log(`wrote ratings/api-calibrated.txt (${out.length} questions). Rated now: ${ALL.filter(q => rated.has(q.id)).length} of ${ALL.length}.`);
}

// export: data/difficulty.csv from Haiku's v3 ratings as they are (two decimals); a question without one
// is left out (the site gives it the fallback model's number). Prints the spread per bank.
function cmdExport() {
  const r = loadRatings({ dir: RAW3 });
  if (!r.size) throw new Error('No v3 ratings yet (rate --all, then collect).');
  const rows = ALL.filter(q => r.has(q.id));
  fs.writeFileSync(path.join(ROOT, 'data/difficulty.csv'), `id,d\n${rows.map(q => `${q.id},${+r.get(q.id).toFixed(2)}`).join('\n')}\n`);
  for (const g of ['SB', 'OSB']) {
    const v = ALL.filter(q => (q.group === 'OSB') === (g === 'OSB') && r.has(q.id)).map(q => r.get(q.id)).sort((a, b) => a - b);
    const at = p => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    console.log(`${g}: ${v.length} rated; median ${at(0.5)}, 10th ${at(0.1)}, 90th ${at(0.9)}, 99th ${at(0.99)}, max ${v.at(-1)}; ` +
      `at 0: ${v.filter(x => x === 0).length}, over 10: ${v.filter(x => x > 10).length}, distinct values: ${new Set(v).size}`);
  }
  const missing = ALL.length - rows.length;
  console.log(`wrote data/difficulty.csv (${rows.length} of ${ALL.length}${missing ? `; ${missing} missing: run rate --all again, then collect and export` : ''})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const o = args(process.argv.slice(2));
  const cmd = { validate: cmdValidate, rate: cmdRate, status: cmdStatus, collect: cmdCollect, calibrate: async x => cmdCalibrate(x), export: async () => cmdExport() }[o._[0]];
  if (!cmd) { console.log('Commands: validate [--n 400] | rate --all [--limit N] | status | collect [--again ID] | export   (options: --model, --size, --max-tokens, --dry-run; calibrate is the old v2 step)'); process.exit(1); }
  cmd(o).catch(err => { console.error(err.message); process.exit(1); });
}
