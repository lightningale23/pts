// The strong pass through Claude Code (`claude -p`) instead of the API, so it uses a Claude subscription's usage
// (owner, 2026-11-24) rather than paid API tokens. Same prompt as batch_api.mjs (rubric, anchors, examples), one
// fresh call per batch of questions: nothing carries over between calls, unlike the v2 Claude Code raters, whose
// conversations grew batch after batch (a week's usage for 16% of the bank).
//
// Run it on a computer where Claude Code is signed in (claude.ai login, not an API key):
//   node importer/difficulty/v2/rate_cc.mjs --limit 500            (500 more questions, hardest-rated first)
//   node importer/difficulty/v2/rate_cc.mjs --dry-run              (what it would do; nothing sent)
//   node importer/difficulty/v2/batch_api.mjs export               (mixes the ratings in: STRONG_WEIGHT)
// Options: --model opus|sonnet (default opus; questions another model rated are skipped unless --again) --size 40 (questions per call) --parallel 2 --effort medium
//          --order hard|bank (default hard: Haiku's highest ratings first, where most of its mistakes are)
//          --claude PATH (the claude command, default "claude")
//          --wait [MIN]: when a call fails (usage limit), wait MIN minutes (default 15) and try again instead of
//          stopping, so it carries on after the limit resets; --hours H stops it H hours after the start. With --wait it
//          keeps using every reset until the weekly limit or Ctrl+C.
// It stops by itself when a call fails (usage limit reached, signed out...); run it again later and it carries
// on where it stopped. Ratings go to api-v5/cc-<model>/ as "id rating share%" lines, one file per call.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ALL, byId, render, system, loadAll, loadRatings, shuffle, strongDir, strongRated, ROOT, parseReply } from './batch_api.mjs';

const o = { model: 'opus', size: 40, parallel: 2, order: 'hard', claude: 'claude' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2), v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; }
}
const OUT = strongDir(`cc-${o.model}`);
const stored = new Map(fs.readFileSync(path.join(ROOT, 'data/difficulty.csv'), 'utf8').trim().split('\n').slice(1)
  .map(l => l.split(',')).map(([id, d]) => [id, +d]));
const cal = [...loadRatings({ calOnly: true })].map(([id, d]) => ({ id, d }));

// Questions without a rating from this model yet. Hardest-rated first: Haiku's top half holds ~80% of the
// questions where it and the v2 raters differ by 1.5 or more (mostly easy questions it rated hard).
// Skips questions any strong model has rated (Opus's first 211 aren't redone by Sonnet); --again: only this model's.
const have = o.again ? loadAll(OUT) : strongRated();
let todo = ALL.filter(q => !have.has(q.id));
if (o.order === 'hard') todo.sort((a, b) => (stored.get(b.id) ?? 0) - (stored.get(a.id) ?? 0));
if (o.limit) todo = todo.slice(0, +o.limit);
// Within what's sent, neighbours by subject (like the API passes), pictures 8 a call.
const groupOrder = (a, b) => (a.group || '').localeCompare(b.group || '') || (a.subcat || '').localeCompare(b.subcat || '') || a.id.localeCompare(b.id);
const plain = todo.filter(q => !q.image).sort(groupOrder), pics = todo.filter(q => q.image).sort(groupOrder);
const size = Math.max(5, +o.size);
const chunks = [];
for (let i = 0; i < plain.length; i += size) chunks.push(plain.slice(i, i + size));
for (let i = 0; i < pics.length; i += 8) chunks.push(pics.slice(i, i + 8));
console.log(`${have.size} questions already rated${o.again ? ` by ${o.model}` : ' by a strong model'}; ${todo.length} to rate now in ${chunks.length} calls (${o.parallel} at a time)`);
if (!chunks.length) process.exit(0);

// Claude Code runs in an empty folder, so the repo's CLAUDE.md isn't read into every call; pictures are copied there.
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'pts-rate-'));
const SYS = path.join(WORK, 'system.txt');
fs.writeFileSync(SYS, `${system()}\n\nYou are running without tools except, when a question has a picture, Read to open it. Reply with the rating lines only.`);

function prompt(qs) {
  const checks = shuffle(cal).slice(0, 2).filter(c => !qs.some(q => q.id === c.id)).map(c => byId.get(c.id));
  const items = shuffle([...qs, ...checks]);
  const text = items.map((q, i) => {
    let t = render(i + 1, q);
    if (q.image) {
      const f = `pic-${q.id}${path.extname(q.image)}`;
      fs.copyFileSync(path.join(ROOT, q.image), path.join(WORK, f));
      t = t.replace('(its picture is attached just below)', `(its picture is the file ${f}: open it with Read before rating)`);
    }
    return t;
  }).join('\n\n');
  return { items, text: `Rate these ${items.length} questions.\n\n${text}` };
}

function run(text, withPics) {
  return new Promise(resolve => {
    const args = ['-p', '--model', o.model, '--system-prompt-file', SYS, '--output-format', 'json', '--no-session-persistence',
      '--strict-mcp-config', '--tools', withPics ? 'Read' : '', ...(withPics ? ['--allowedTools', 'Read'] : []),
      ...(o.effort ? ['--effort', o.effort] : [])];
    // Windows runs claude.cmd through cmd.exe, which drops an empty argument unless it's quoted.
    const win = process.platform === 'win32';
    const p = spawn(win ? `"${o.claude}"` : o.claude, win ? args.map(a => `"${a}"`) : args, { cwd: WORK, shell: win, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => resolve({ error: e.message }));
    p.on('close', code => {
      let j = null;
      try { j = JSON.parse(out); } catch { /* not JSON */ }
      if (code !== 0 || !j || j.is_error) resolve({ error: (j?.result || err || out || `exit ${code}`).slice(0, 300) });
      else resolve({ result: String(j.result || ''), cost: j.total_cost_usd });
    });
    p.stdin.end(text);
  });
}

if (o['dry-run']) {
  const { text } = prompt(chunks[0]);
  console.log(`system prompt ${fs.statSync(SYS).size} characters; first call ${text.length} characters. Nothing sent (--dry-run).`);
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log(`command: ${o.claude} -p --model ${o.model} --system-prompt-file ${SYS} --output-format json --no-session-persistence --strict-mcp-config --tools ""`);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
let next = 0, done = 0, stopped = '';
const deadline = Date.now() + (+(o.hours) || 1e6) * 3600000;
const drift = [];
async function worker() {
  while (!stopped && next < chunks.length) {
    const n = next++;
    const { items, text } = prompt(chunks[n]);
    let r = await run(text, items.some(q => q.image));
    // --wait: a failed call (usage limit) waits and tries again, until it works or --hours have passed since the start.
    while (r.error && o.wait && !stopped && Date.now() < deadline) {
      const mins = Math.max(1, +(o.wait === true ? 15 : o.wait));
      console.log(`${new Date().toLocaleTimeString()}: call ${n + 1} failed (${r.error.replace(/\s+/g, ' ').slice(0, 120)}); trying again in ${mins} minutes. Ctrl+C stops (ratings so far are saved).`);
      await new Promise(res => setTimeout(res, mins * 60000));
      r = await run(text, items.some(q => q.image));
    }
    if (r.error) { stopped = r.error; break; }
    const parsed = parseReply(r.result);
    const lines = [];
    items.forEach((q, i) => {
      const p = parsed.get(i + 1);
      if (!p) return;
      const c = cal.find(c => c.id === q.id);
      if (c) drift.push(p.d - c.d);
      lines.push(p.pct ? `${q.id} ${p.d} ${p.pct}%` : `${q.id} ${p.d}`);
    });
    fs.writeFileSync(path.join(OUT, `${stamp}-${n}.txt`), `${lines.join('\n')}\n`);
    done += lines.length;
    console.log(`call ${n + 1}/${chunks.length}: ${lines.length} of ${items.length} ratings read (${done} so far)`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, +o.parallel) }, worker));
fs.rmSync(WORK, { recursive: true, force: true });
if (drift.length) {
  const m = drift.reduce((t, x) => t + x, 0) / drift.length, a = drift.reduce((t, x) => t + Math.abs(x), 0) / drift.length;
  console.log(`hidden checks: off by ${a.toFixed(2)} on average (bias ${m >= 0 ? '+' : ''}${m.toFixed(2)}) over ${drift.length}`);
}
if (stopped) console.log(`Stopped: ${stopped}\nRun it again later (usage limits reset); it carries on where it stopped.`);
console.log(`${done} ratings written to ${path.relative(ROOT, OUT)}/. Then: node importer/difficulty/v2/batch_api.mjs export`);
