// Difficulty ratings, v2 (see ../RUBRIC.md): batches for a rater, saving with a hidden-anchor check,
// progress, distributions, and the export to data/difficulty.csv.
//
//   node importer/difficulty/v2/rate.mjs next <worker> [--subject S] [--slice k/n] [--size 80] [--random]
//   node importer/difficulty/v2/rate.mjs save <worker> <file>
//   node importer/difficulty/v2/rate.mjs status
//   node importer/difficulty/v2/rate.mjs stats [subject] [--random 10]
//   node importer/difficulty/v2/rate.mjs missing [--ids]
//   node importer/difficulty/v2/rate.mjs export
//
// Subjects: Biology, Chemistry, Physics, Mathematics, "Earth and Space", Energy, "Computer Science", OSB.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestions } from '../../../js/questions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const RATINGS = path.join(HERE, 'ratings');
const WORK = path.join(HERE, 'work');
const QC = path.join(HERE, 'qc.log');
const KEYS = path.join(HERE, 'key-issues.txt');
fs.mkdirSync(RATINGS, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SB = [...parseQuestions(read('data/questions.csv')), ...parseQuestions(read('data/visual-bonuses.csv'))]
  .filter(q => q.subject !== 'General Science');
const OSB = parseQuestions(read('data/osb-questions.csv'));
for (const q of SB) q.group = q.subject;
for (const q of OSB) q.group = 'OSB';
export const ALL = [...SB, ...OSB];
const byId = new Map(ALL.map(q => [q.id, q]));
const ANCHORS = JSON.parse(fs.readFileSync(path.join(HERE, 'anchors.json'), 'utf8'));
const anchorList = Object.entries(ANCHORS).flatMap(([s, l]) => l.map(([id, d, why]) => ({ id, d, why, subject: byId.get(id)?.subject || s })));
const anchorIds = new Set(anchorList.map(a => a.id));

// id → rating from every ratings file (a later line for the same id would be a re-rate; the last wins).
export function loadRatings() {
  const m = new Map();
  for (const f of fs.readdirSync(RATINGS).filter(f => f.endsWith('.txt')).sort()) {
    for (const line of fs.readFileSync(path.join(RATINGS, f), 'utf8').split('\n')) {
      const [id, r] = line.trim().split(/\s+/);
      if (id && r !== undefined && !Number.isNaN(+r)) m.set(id, +r);
    }
  }
  return m;
}

const numOrder = new Intl.Collator(undefined, { numeric: true }).compare;
function subjectList(group) {
  return ALL.filter(q => q.group === group).sort((a, b) =>
    (a.subject || '').localeCompare(b.subject || '') || (a.subcat || '').localeCompare(b.subcat || '') ||
    a.type.localeCompare(b.type) || numOrder(a.set, b.set) || numOrder(a.round, b.round) || numOrder(a.num, b.num) || a.id.localeCompare(b.id));
}

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    else o._.push(argv[i]);
  }
  return o;
}

let seed = Date.now() % 2147483647;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const pick = (arr, k) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };

const TYPE = q => (q.type === 'bonus' ? (q.image ? 'VISUAL BONUS' : 'BONUS') : 'TOSS-UP');
function render(n, q) {
  const head = [q.group === 'OSB' ? `OSB ${q.subject}` : q.subject, q.subcat, TYPE(q), q.format === 'mc' ? 'Multiple Choice' : 'Short Answer', q.level || 'HS']
    .filter(Boolean).join(' · ');
  const lines = [`#${n}  [${head}]`];
  if (q.image) lines.push(`(picture: ${pngFor(q) || q.image})`);
  lines.push(q.question.trim());
  if (q.choices) lines.push(q.choices.map((c, i) => `${'WXYZ'[i]}) ${c}`).join('\n'));
  lines.push(`ANSWER: ${q.answer}${q.accept ? `  (ACCEPT: ${q.accept})` : ''}${q.reject ? `  (DO NOT ACCEPT: ${q.reject})` : ''}`);
  return lines.join('\n');
}
// PNG copies of the pictures (some tools can't read WebP): importer/difficulty/v2/pictures/<id>.png when made.
function pngFor(q) {
  const p = path.join(HERE, 'pictures', `${q.id}.png`);
  return fs.existsSync(p) ? path.relative(ROOT, p) : null;
}

function pending(except) {
  const s = new Set();
  for (const f of fs.readdirSync(WORK).filter(f => f.endsWith('.json'))) {
    if (f === `${except}.json`) continue;
    for (const it of JSON.parse(fs.readFileSync(path.join(WORK, f), 'utf8')).items) s.add(it.id);
  }
  return s;
}

function cmdNext(o) {
  const worker = o._[1];
  if (!worker) throw new Error('next <worker> [--subject S] [--slice k/n] [--size N]');
  const wf = path.join(WORK, `${worker}.json`);
  if (fs.existsSync(wf)) {   // an unsaved batch: show it again
    const w = JSON.parse(fs.readFileSync(wf, 'utf8'));
    printBatch(worker, w);
    return;
  }
  const group = o.subject || 'Biology';
  const size = +(o.size || 80);
  let list = subjectList(group);
  if (!list.length) throw new Error(`no questions in subject ${group}`);
  if (o.slice) {
    const [k, n] = String(o.slice).split('/').map(Number);
    const per = Math.ceil(list.length / n);
    list = list.slice((k - 1) * per, k * per);
  }
  const rated = loadRatings(), busy = pending(worker);
  const open = list.filter(q => !rated.has(q.id) && !anchorIds.has(q.id) && !busy.has(q.id));
  const todo = o.random ? pick(open, size) : open.slice(0, size);   // --random: a mixed sample (calibration)
  if (!todo.length) { console.log(`DONE: nothing left to rate in ${group}${o.slice ? ` slice ${o.slice}` : ''}.`); return; }
  // three hidden anchors: two from this subject (if it has them), one from another
  const own = anchorList.filter(a => a.subject === group), other = anchorList.filter(a => a.subject !== group);
  const anchors = [...pick(own, own.length ? 2 : 0), ...pick(other, own.length ? 1 : 3)];
  const items = todo.map(q => ({ id: q.id }));
  for (const a of anchors) items.splice(Math.floor(rnd() * (items.length + 1)), 0, { id: a.id, anchor: a.d });
  items.forEach((it, i) => { it.n = i + 1; });
  const w = { worker, group, slice: o.slice || null, at: new Date().toISOString(), items };
  fs.writeFileSync(wf, JSON.stringify(w));
  printBatch(worker, w);
}

function printBatch(worker, w) {
  console.log(`BATCH for ${worker}: ${w.items.length} questions (${w.group}${w.slice ? `, slice ${w.slice}` : ''}). Rate every one.`);
  console.log(`Write one line per question, "#n rating" (e.g. "#12 3.5"), and optionally "#n key: <what looks wrong>"`);
  console.log(`for a wrong or ambiguous answer key. Then: node importer/difficulty/v2/rate.mjs save ${worker} <file>\n`);
  for (const it of w.items) console.log(render(it.n, byId.get(it.id)) + '\n');
}

function cmdSave(o) {
  const [, worker, file] = o._;
  const wf = path.join(WORK, `${worker}.json`);
  if (!fs.existsSync(wf)) throw new Error(`no open batch for ${worker}`);
  const w = JSON.parse(fs.readFileSync(wf, 'utf8'));
  const got = new Map(), keys = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const k = line.match(/^\s*#?(\d+)\s*[:.)]?\s*key\s*:\s*(.+)$/i);
    if (k) { keys.push([+k[1], k[2].trim()]); continue; }
    const m = line.match(/^\s*#?(\d+)\s*[:.)=-]?\s+(-?\d+(?:\.\d+)?)\b/);
    if (m) got.set(+m[1], +m[2]);
  }
  const missing = w.items.filter(it => !got.has(it.n)).map(it => `#${it.n}`);
  if (missing.length) { console.log(`REFUSED: no rating for ${missing.join(' ')}. Add them and save again.`); process.exitCode = 1; return; }
  const bad = [...got].filter(([n, r]) => r < 0 || r > 15);
  if (bad.length) { console.log(`REFUSED: ratings outside 0–15: ${bad.map(([n, r]) => `#${n} ${r}`).join(' ')}`); process.exitCode = 1; return; }
  const anchors = w.items.filter(it => it.anchor !== undefined);
  const dev = anchors.map(a => got.get(a.n) - a.anchor);
  const mad = dev.length ? dev.reduce((s, x) => s + Math.abs(x), 0) / dev.length : 0;
  const bias = dev.length ? dev.reduce((s, x) => s + x, 0) / dev.length : 0;
  const rated = w.items.filter(it => it.anchor === undefined);
  const mean = rated.reduce((s, it) => s + got.get(it.n), 0) / rated.length;
  const ok = mad <= 1.0;
  fs.appendFileSync(QC, `${new Date().toISOString()}\t${worker}\t${w.group}\t${rated.length}\tmean ${mean.toFixed(2)}\tanchor-mad ${mad.toFixed(2)}\tbias ${bias >= 0 ? '+' : ''}${bias.toFixed(2)}\t${ok ? 'saved' : 'REFUSED'}\t${anchors.map(a => `${a.id}:${a.anchor}->${got.get(a.n)}`).join(' ')}\n`);
  if (!ok) {
    console.log(`REFUSED: the three calibration questions hidden in this batch were rated ${mad.toFixed(2)} off on average (limit 1.0; you rated them ${bias > 0 ? 'higher' : 'lower'} than the scale). Re-read the rubric and anchors, re-rate the WHOLE batch, and save again.`);
    process.exitCode = 1;
    return;
  }
  fs.appendFileSync(path.join(RATINGS, `${worker}.txt`), rated.map(it => `${it.id} ${got.get(it.n)}`).join('\n') + '\n');
  if (keys.length) fs.appendFileSync(KEYS, keys.map(([n, t]) => `${w.items[n - 1]?.id}\t${worker}\t${t}`).join('\n') + '\n');
  fs.unlinkSync(wf);
  const all = loadRatings();
  const left = subjectList(w.group).filter(q => !all.has(q.id) && !anchorIds.has(q.id)).length;
  console.log(`SAVED ${rated.length} ratings (anchor check ${mad.toFixed(2)} off, bias ${bias >= 0 ? '+' : ''}${bias.toFixed(2)}). ${left} left in ${w.group}.`);
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };
const GROUPS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Earth and Space', 'Energy', 'Computer Science', 'OSB'];

function cmdStatus() {
  const r = loadRatings();
  let tot = 0, done = 0;
  for (const g of GROUPS) {
    const list = subjectList(g);
    const n = list.filter(q => r.has(q.id) || anchorIds.has(q.id)).length;
    tot += list.length; done += n;
    console.log(`${g.padEnd(18)} ${String(n).padStart(6)} / ${list.length}`);
  }
  console.log(`${'All'.padEnd(18)} ${String(done).padStart(6)} / ${tot}`);
}

function cmdStats(o) {
  const r = loadRatings();
  const groups = o._[1] ? [o._[1]] : GROUPS;
  for (const g of groups) {
    const xs = subjectList(g).filter(q => r.has(q.id)).map(q => r.get(q.id));
    if (!xs.length) continue;
    console.log(`${g.padEnd(18)} n ${String(xs.length).padStart(6)}  p10 ${pct(xs, .1)}  p50 ${pct(xs, .5)}  p90 ${pct(xs, .9)}  p99 ${pct(xs, .99)}  max ${Math.max(...xs)}  over10 ${xs.filter(x => x > 10).length}  mean ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)}`);
  }
  // drift: anchor bias and batch mean in order, per worker
  if (fs.existsSync(QC)) {
    const rows = fs.readFileSync(QC, 'utf8').trim().split('\n').map(l => l.split('\t')).filter(c => c[7] === 'saved' && (!o._[1] || c[2] === o._[1]));
    const by = new Map();
    for (const c of rows) { const a = by.get(c[1]) || []; a.push(`${c[4].split(' ')[1]}/${c[6].split(' ')[1]}`); by.set(c[1], a); }
    console.log('\nper worker, batch by batch (mean rating / anchor bias):');
    for (const [k, v] of by) console.log(`  ${k}: ${v.join('  ')}`);
  }
  const n = +(o.random || 10);
  const pool = ALL.filter(q => r.has(q.id) && (!o._[1] || q.group === o._[1]));
  console.log(`\n${n} random rated questions:`);
  for (const q of pick(pool, n)) console.log(`  ${r.get(q.id)}  ${q.id} [${q.group} ${q.type} ${q.format}] ${q.question.replace(/\s+/g, ' ').slice(0, 110)} → ${q.answer.slice(0, 40)}`);
}

function cmdMissing(o) {
  const r = loadRatings();
  const miss = ALL.filter(q => !r.has(q.id) && !anchorIds.has(q.id));
  if (o.ids) { console.log(miss.map(q => q.id).join('\n')); return; }
  const by = new Map();
  for (const q of miss) by.set(q.group, (by.get(q.group) || 0) + 1);
  console.log(`${miss.length} questions have no stored rating.`, Object.fromEntries(by));
}

function cmdExport() {
  const r = loadRatings();
  for (const a of anchorList) r.set(a.id, a.d);
  const rows = ALL.filter(q => r.has(q.id)).map(q => `${q.id},${(+r.get(q.id).toFixed(1))}`);
  fs.writeFileSync(path.join(ROOT, 'data/difficulty.csv'), `id,d\n${rows.join('\n')}\n`);
  console.log(`wrote data/difficulty.csv: ${rows.length} ratings (${ALL.length - rows.length} questions without one)`);
}

const o = args(process.argv.slice(2));
const cmd = { next: cmdNext, save: cmdSave, status: cmdStatus, stats: cmdStats, missing: cmdMissing, export: cmdExport }[o._[0]];
if (!cmd) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 12).join('\n')); process.exit(1); }
cmd(o);
