// The model ladder: several local models of different sizes answer every question (like players
// of different strength), and the site's own answer checker marks them. ladder_fit.py then works
// out each question's difficulty from who got it right (item response theory), the way a test's
// questions are rated from students' answers, with models standing in for players.
//
//   ollama pull gemma3:1b   (and the other models; see RUBRIC.md → AI signals)
//   node importer/difficulty/ladder.mjs [--models a,b,c] [--samples 1] [--cuts 0.5,1]
//        [--bank sb|osb|all] [--limit N] [--ids FILE] [--parallel 4] [--host http://localhost:11434]
//
// Results go to importer/difficulty/runs/ladder-<model>.jsonl, one line per answer:
//   { id, r: "<model>@<cut>", s: sample, a: answer, c: 1|0, g: guess floor }
// Stop it any time (Ctrl+C); a rerun skips what's done. A visual bonus is only asked of models
// that can see pictures; the others leave it out (that isn't counted as wrong).
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { checkAnswer, setVocabulary } from '../../js/checker.js';
import { ROOT, RUNS, args, loadBanks, ollama, pool, progressLine, jsonl, contestantMessages, cleanAnswer, rng, shuffle } from './llm.mjs';

// Small to large, so the ladder has rungs at every strength. Any Ollama models work.
export const DEFAULT_MODELS = ['gemma3:1b', 'qwen2.5:1.5b', 'llama3.2:3b', 'gemma3:4b', 'qwen2.5:7b', 'llama3.1:8b', 'gemma3:12b'];

const o = args();
const models = String(o.models || DEFAULT_MODELS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
const samples = Math.max(1, +(o.samples || 1));
const cuts = String(o.cuts || '1').split(',').map(Number).filter(c => c > 0 && c <= 1);
const parallel = Math.max(1, +(o.parallel || 4));
const api = ollama(o.host);

let qs = loadBanks(o.bank || 'all');
setVocabulary(qs.flatMap(q => [q.question, q.answer]));
if (o.ids) {
  const want = new Set(readFileSync(o.ids, 'utf8').split(/[\s,]+/).filter(Boolean));
  qs = qs.filter(q => want.has(q.id));
}
// --limit: a random sample (the same one every run), e.g. to time a model before a full run.
if (o.limit) qs = shuffle(qs, rng(7)).slice(0, +o.limit);

// A visual bonus's picture as base64 (PNG copies from visuals_png.py if there, else the WebP).
function picture(q) {
  if (!q.image) return null;
  const png = path.join(RUNS, 'visuals-png', `${path.basename(q.image).replace(/\.\w+$/, '')}.png`);
  const file = existsSync(png) ? png : path.join(ROOT, q.image);
  return existsSync(file) ? readFileSync(file).toString('base64') : null;
}

for (const model of models) {
  let info;
  try { info = await api.info(model); }
  catch (err) { console.error(`${model}: not available (${err.message}). Pull it with: ollama pull ${model}`); continue; }
  const out = jsonl(path.join(RUNS, `ladder-${model.replace(/[^\w.-]+/g, '_')}.jsonl`));
  const done = new Set(out.rows.map(r => `${r.id}|${r.r}|${r.s}`));
  const jobs = [];
  for (const q of qs) {
    if (q.image && !info.vision) continue;
    for (const cut of cuts) {
      if (cut < 1 && q.type !== 'tossup') continue;   // only toss-ups are buzzed on early
      const r = `${model}@${cut}`;
      for (let s = 0; s < samples; s++) if (!done.has(`${q.id}|${r}|${s}`)) jobs.push({ q, cut, r, s });
    }
  }
  console.error(`${model}${info.vision ? ' (sees pictures)' : ''}: ${jobs.length} answers to get (${done.size} done before)`);
  if (!jobs.length) continue;
  let badPictures = 0;
  await pool(jobs, parallel, async ({ q, cut, r, s }) => {
    let image = null;
    if (q.image) { image = picture(q); if (!image) return; }
    let reply;
    try {
      reply = await api.chat(model, contestantMessages(q, cut, image), {
        temperature: samples > 1 ? 0.7 : 0, seed: 1000 * s + 17, maxTokens: info.thinking ? 96 : 64, thinking: info.thinking,
      });
    } catch (err) {
      if (q.image) { if (!badPictures++) console.error(`\n${model} couldn't read a picture (${err.message}); run visuals_png.py first. Skipping pictures.`); return; }
      console.error(`\n${q.id}: ${err.message}`);
      return;
    }
    const a = cleanAnswer(reply);
    let c = 0;
    try { c = a && checkAnswer(q, a).correct ? 1 : 0; } catch { c = 0; }
    // Guessing floor: with the four choices in view, a blind guess is right a quarter of the time.
    out.add({ id: q.id, r, s, a, c, g: q.choices && cut >= 1 ? 0.25 : 0 });
  }, progressLine(model, jobs.length));
}
console.error('Done. Next: python3 importer/difficulty/ladder_fit.py');
