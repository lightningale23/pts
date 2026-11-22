// Answer-key check through the Claude API's Message Batches: a strong model reads every question
// and says whether the official answer is right. It only flags; a person (or a Claude Code session)
// checks each flag against the science and fixes the bank by hand. See importer/answers/README.md.
//
//   key: PTS_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."),
//   or the key alone in importer/answers/.api-key (gitignored; never commit it).
//   node importer/answers/check_keys.mjs run [--model claude-opus-5-5] [--size 25] [--limit N] [--sample N] [--ids FILE] [--dry-run]
//   node importer/answers/check_keys.mjs status
//   node importer/answers/check_keys.mjs collect        → flags.tsv (id, model, verdict, fix, why) + usage/cost
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestions } from '../../js/questions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STATE = path.join(HERE, 'batches.json');
const FLAGS = path.join(HERE, 'flags.tsv');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const API = ('https://api.anthropic.com').replace(/\/$/, '');

const SB = [...parseQuestions(read('data/questions.csv')), ...parseQuestions(read('data/visual-bonuses.csv'))]
  .filter(q => q.subject !== 'General Science');
const OSB = parseQuestions(read('data/osb-questions.csv'));
for (const q of SB) q.group = 'SB';
for (const q of OSB) q.group = 'OSB';
export const ALL = [...SB, ...OSB];
const byId = new Map(ALL.map(q => [q.id, q]));

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

const TYPE = q => (q.type === 'bonus' ? (q.image ? 'VISUAL BONUS' : 'BONUS') : 'TOSS-UP');
export function render(n, q) {
  const head = [q.group === 'OSB' ? `Ocean Science Bowl ${q.subject}` : q.subject, TYPE(q),
    q.format === 'mc' ? 'Multiple Choice' : 'Short Answer', q.level === 'MS' ? 'middle school' : 'high school'].join(' · ');
  const lines = [`#${n}  [${head}]  (${q.set}${q.year ? `, ${q.year}` : ''})`];
  if (q.image) lines.push('(its picture is attached just below)');
  lines.push(String(q.question).trim());
  if (q.choices) lines.push(q.choices.map((c, i) => `${'WXYZ'[i]}) ${c}`).join('\n'));
  lines.push(`ANSWER: ${q.answer}${q.accept ? `  (ACCEPT: ${q.accept})` : ''}${q.reject ? `  (DO NOT ACCEPT: ${q.reject})` : ''}`);
  return lines.join('\n');
}

export const SYSTEM = `You check the answer keys of a Science Bowl question bank (US DOE National Science Bowl style, high school and middle school, plus National Ocean Sciences Bowl questions). Players practice with these questions on a website that marks their answers against the key, so a wrong key teaches them something false.

For each question, work out the answer yourself (do every calculation), then compare it with the ANSWER line.

Flag a question only when you are confident there is a real problem a careful expert would agree with:
- WRONG: the key is incorrect (a wrong number, the wrong choice, a false fact, a wrong set of items for "which of the following" / select-all, a wrong order for ranking questions). Give the correct answer.
- AMBIGUOUS: as written, a different answer is equally or more defensible, or two choices are both correct, so the key alone can't be right. Say which answers are defensible.
- BROKEN: the question can't be answered as written (it refers to an earlier question, a missing figure or table, a value or choice is missing or garbled, two choices are the same).

Do NOT flag:
- answers that are right but written loosely, in capitals, with extra words, without units, or rounded the way Science Bowl answers usually are (numbers within the precision the question implies are right);
- missing alternate answers (another acceptable wording the key doesn't list) — that's handled elsewhere;
- facts that were true when the question was written but changed later, unless the question says "currently" and the change is large; mention the year only if it matters;
- style, difficulty, or questions you merely find unusual. Science Bowl uses standard textbook conventions (Campbell Biology, Zumdahl, Halliday, Tarbuck); judge by those.
- a math expression in LaTeX that is just written differently from yours but equal in value.
Pictures: visual bonuses come with their picture; if a visual bonus has no picture, don't call it BROKEN for that alone.

Reply with exactly one line per question, in order, and nothing else:
#n | OK
#n | WRONG | the correct answer | a short reason (one sentence, with the key numbers of your calculation)
#n | AMBIGUOUS | the defensible answers | a short reason
#n | BROKEN | - | what is missing or garbled`;

function picture(q) {
  const f = path.join(ROOT, q.image || '');
  if (!q.image || !fs.existsSync(f)) return null;
  const ext = path.extname(f).slice(1).toLowerCase();
  const media = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }[ext];
  return media ? { type: 'image', source: { type: 'base64', media_type: media, data: fs.readFileSync(f).toString('base64') } } : null;
}
function request(customId, qs, model, room) {
  const content = [{ type: 'text', text: `Check these ${qs.length} questions.` }];
  qs.forEach((q, i) => {
    content.push({ type: 'text', text: render(i + 1, q) });
    const img = picture(q);
    if (img) content.push(img);
  });
  const params = { model, max_tokens: room, system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content }] };
  if (process.env.CHECK_EFFORT) params.output_config = { effort: process.env.CHECK_EFFORT };
  return { entry: { custom_id: customId, params }, ids: qs.map(q => q.id) };
}

async function api(method, p, body) {
  const keyFile = path.join(HERE, '.api-key');
  const key = process.env.PTS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '');
  if (!key) throw new Error('Set ANTHROPIC_API_KEY, or put the key alone in importer/answers/.api-key (never commit it).');
  const res = await fetch(p.startsWith('http') ? p : `${API}${p}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p}: HTTP ${res.status} ${text.slice(0, 400)}`);
  return text;
}

// batch prices per million tokens (input, output, cache read)
const PRICE = { 'opus-5-5': [2, 10], 'sonnet-5-5': [1, 5], 'haiku-5-5': [0.05, 0.25], fable: [4, 20] };
const priceOf = model => PRICE[Object.keys(PRICE).find(k => model.includes(k))] || [2, 10];

const order = (a, b) => a.group.localeCompare(b.group) || a.subject.localeCompare(b.subject) || a.set.localeCompare(b.set) || a.id.localeCompare(b.id);
async function cmdRun(o) {
  const model = o.model || 'claude-opus-5-5';
  const size = Math.max(1, +(o.size || 25));
  const room = +(o['max-tokens'] || 48000);
  const done = new Set(state().batches.flatMap(b => Object.values(b.requests).flat()));
  let todo = ALL.filter(q => o.again || !done.has(q.id));
  if (o.ids) { const want = new Set(fs.readFileSync(o.ids, 'utf8').split(/\s+/).filter(Boolean)); todo = todo.filter(q => want.has(q.id)); }
  if (o.sample) { let s = 7; const r = () => (s = (s * 48271) % 2147483647) / 2147483647; todo = todo.map(q => [r(), q]).sort((a, b) => a[0] - b[0]).slice(0, +o.sample).map(x => x[1]); }
  if (o.limit) todo = todo.slice(0, +o.limit);
  const plain = todo.filter(q => !q.image).sort(order), pics = todo.filter(q => q.image).sort(order);
  const chunks = [];
  for (let i = 0; i < plain.length; i += size) chunks.push(plain.slice(i, i + size));
  for (let i = 0; i < pics.length; i += 8) chunks.push(pics.slice(i, i + 8));
  const tag = `${o.tag || 'check'}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  const reqs = chunks.map((c, i) => request(`${tag}-${i}`, c, model, room));
  const tin = reqs.reduce((n, r) => n + r.entry.params.messages[0].content.reduce((m, c) => m + (c.type === 'text' ? c.text.length / 3.5 : 1600), 0), 0);
  const perQ = +(o['out-per-q'] || 600);
  const [pi, po] = priceOf(model);
  console.log(`${todo.length} questions in ${reqs.length} requests; about ${(tin / 1e6).toFixed(1)}M input tokens + ~${(todo.length * perQ / 1e6).toFixed(1)}M output (thinking, guessed at ${perQ}/question): roughly $${(tin / 1e6 * pi + todo.length * perQ / 1e6 * po).toFixed(0)} with ${model}`);
  if (o['dry-run']) { console.log('--dry-run: nothing sent'); return; }
  const parts = [];
  let cur = [], bytes = 0;
  for (const r of reqs) {
    const b = JSON.stringify(r.entry).length;
    if (cur.length && (bytes + b > 150e6 || cur.length >= 10000)) { parts.push(cur); cur = []; bytes = 0; }
    cur.push(r); bytes += b;
  }
  if (cur.length) parts.push(cur);
  const s = state();
  for (const part of parts) {
    const res = JSON.parse(await api('POST', '/v1/messages/batches', { requests: part.map(r => r.entry) }));
    s.batches.push({ id: res.id, tag, model, at: new Date().toISOString(), collected: false, requests: Object.fromEntries(part.map(r => [r.entry.custom_id, r.ids])) });
    saveState(s);
    console.log(`submitted ${res.id}: ${part.length} requests, ${part.reduce((n, r) => n + r.ids.length, 0)} questions`);
  }
}

async function cmdStatus() {
  for (const b of state().batches) {
    if (b.collected) { console.log(`${b.id}  ${b.tag}  collected`); continue; }
    const r = JSON.parse(await api('GET', `/v1/messages/batches/${b.id}`));
    const c = r.request_counts || {};
    console.log(`${b.id}  ${b.tag}  ${r.processing_status}  done ${c.succeeded ?? 0}, errors ${c.errored ?? 0}, processing ${c.processing ?? 0}`);
  }
}

// "#n | VERDICT | fix | why" → Map(n → {verdict, fix, why})
export function parseReply(text) {
  const out = new Map();
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/[*`]/g, '').trim();
    const m = line.match(/^#?\s*(\d+)\s*[|:.)]\s*(OK|WRONG|AMBIGUOUS|BROKEN)\b\s*\|?\s*(.*)$/i);
    if (!m || out.has(+m[1])) continue;
    const [fix = '', ...why] = m[3].split('|').map(x => x.trim());
    out.set(+m[1], { verdict: m[2].toUpperCase(), fix, why: why.join(' | ') });
  }
  return out;
}

async function cmdCollect() {
  const s = state();
  for (const b of s.batches.filter(b => !b.collected)) {
    const info = JSON.parse(await api('GET', `/v1/messages/batches/${b.id}`));
    if (info.processing_status !== 'ended') { console.log(`${b.id}: still ${info.processing_status}`); continue; }
    const body = await api('GET', info.results_url);
    fs.writeFileSync(path.join(HERE, `raw-${b.id.replace(/\W/g, '')}.jsonl`), body);
    const flags = [];
    let failed = 0, missing = 0, ok = 0, tin = 0, tout = 0, tcache = 0;
    for (const line of body.split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      const ids = b.requests[r.custom_id];
      if (!ids) continue;
      if (r.result?.type !== 'succeeded') { failed++; continue; }
      const msg = r.result.message, u = msg.usage || {};
      tin += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0); tcache += u.cache_read_input_tokens || 0; tout += u.output_tokens || 0;
      const parsed = parseReply((msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n'));
      ids.forEach((id, i) => {
        const p = parsed.get(i + 1);
        if (!p) { missing++; return; }
        if (p.verdict === 'OK') { ok++; return; }
        flags.push([id, b.model, p.verdict, p.fix, p.why].map(x => String(x).replace(/[\t\n]/g, ' ')).join('\t'));
      });
    }
    const [pi, po] = priceOf(b.model);
    console.log(`${b.id} (${b.tag}): ${ok} OK, ${flags.length} flagged, ${missing} not answered, ${failed} requests failed; ` +
      `${(tin / 1e6).toFixed(2)}M in + ${(tcache / 1e6).toFixed(2)}M cached + ${(tout / 1e6).toFixed(2)}M out ≈ $${(tin / 1e6 * pi + tcache / 1e6 * pi * 0.1 + tout / 1e6 * po).toFixed(2)}`);
    if (flags.length) fs.appendFileSync(FLAGS, flags.join('\n') + '\n');
    b.collected = true;
    b.usage = { tin, tcache, tout, ok, flagged: flags.length, missing, failed };
    saveState(s);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const o = args(process.argv.slice(2));
  const cmd = { run: cmdRun, status: cmdStatus, collect: cmdCollect }[o._[0]];
  if (!cmd) { console.log('Commands: run [--model M] [--size 25] [--sample N] [--limit N] [--ids FILE] [--dry-run] | status | collect'); process.exit(1); }
  cmd(o).catch(err => { console.error(err.message); process.exit(1); });
}
