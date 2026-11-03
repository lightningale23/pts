// Print the id the site derives for every row of a bank CSV (one per line, in row order).
//   node importer/ids.mjs data/questions.csv
import { readFileSync } from 'node:fs';
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const js = new URL('../js/', import.meta.url);
const { csvToObjects } = await import(new URL('csv.js', js));
const { normalizeRow } = await import(new URL('questions.js', js));
const objs = csvToObjects(readFileSync(process.argv[2], 'utf8'));
process.stdout.write(objs.map(o => { const q = normalizeRow(o); return q ? q.id : 'NULL'; }).join('\n') + '\n');
