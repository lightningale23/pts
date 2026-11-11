// Every official answer must be accepted by the site's own checker.
// MC: the letter and the keyed option's text. Short answer: the printed answer (each "OR" part,
// with and without optional words, pronunciation guides removed) and every listed alternate.
//
//   node importer/check_answers.mjs data/questions.csv [sets.json] [fails.json]
// sets.json: optional JSON list of set names to check (default: all). Writes the rejected
// answers to fails.json when given.
import { readFileSync, writeFileSync } from 'node:fs';
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const js = new URL('../js/', import.meta.url);
const { parseQuestions } = await import(new URL('questions.js', js));
const { checkAnswer, setVocabulary, hideRoots, showRoots } = await import(new URL('checker.js', js));
const only = process.argv[3] ? new Set(JSON.parse(readFileSync(process.argv[3], 'utf8'))) : null;
const qs = parseQuestions(readFileSync(process.argv[2], 'utf8'));
setVocabulary(qs.flatMap(q => [q.answer, q.accept, ...(q.choices || [])]));
const split = s => s.split(/\s*;\s*/).map(x => x.trim()).filter(Boolean);
const fails = [];
let checked = 0, tried = 0;
for (const q of qs) {
  if (only && !only.has(q.set)) continue;
  checked++;
  const cands = [];
  if (q.choices && q.answerLetter) {
    cands.push(q.answerLetter);
    if (q.answerText) cands.push(q.answerText);
  } else {
    let main = hideRoots(q.answer);
    const alts = [];
    main = main.replace(/[([]\s*(?:also accept|accept)\s*:?\s*([^()[\]]*)[)\]]/gi, (_, a) => { alts.push(...split(a.replace(/\s*,\s*(?=[A-Za-z])/g, ';'))); return ' '; });
    main = main.replace(/[([]\s*(?:do not accept|don't accept|reject|prompt on)[^()[\]]*[)\]]/gi, ' ');
    main = main.replace(/\[[^\]]*\]/g, ' ').replace(/\((?:read|pronounced)[^)]*\)/gi, ' ');
    for (const part of main.split(/\s+\bOR\b\s+/)) {
      const p = part.trim(); if (!p) continue;
      cands.push(showRoots(p).replace(/\s+/g, ' '));
      const bare = p.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
      if (bare && bare !== p && /[A-Za-z0-9]/.test(bare)) cands.push(showRoots(bare));
    }
    cands.push(...[...alts, ...split(q.accept || '')].flatMap(a => a.split(/\s+or\s+/i)));
  }
  for (const c of [...new Set(cands)].filter(Boolean)) {
    tried++;
    const r = checkAnswer(q, c);
    if (!r.correct) fails.push({ set: q.set, round: q.round, num: q.num, type: q.type, id: q.id, given: c, answer: q.answer, accept: q.accept, reason: r.reason });
  }
}
if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(fails, null, 1));
console.log(`questions checked ${checked}, answers tried ${tried}, rejected ${fails.length}`);
const by = {};
for (const f of fails) by[f.set] = (by[f.set] || 0) + 1;
console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' | '));
for (const f of fails.slice(0, 30)) console.log(`  ${f.set} ${f.round} #${f.num} ${f.type} [${f.id}] typed "${f.given}" for "${f.answer}" (${f.reason})`);
