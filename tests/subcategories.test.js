import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QuestionSource, normalizeRow, matchesFilters, facets, parseQuestions, SUBCATEGORY_ORDER, subcatKey } from '../js/questions.js';

const rows = [];
const add = (subject, subcategory, n, type = 'TOSS-UP') => {
  for (let i = 0; i < n; i++) {
    rows.push(normalizeRow({ set: 'S', round: subcategory, num: String(i), type, subject, subcategory, question: `${subject} ${subcategory} ${type} ${i}?`, answer: 'X' }));
  }
};
add('Biology', 'Genetics & Molecular Biology', 10); add('Biology', 'Ecology', 10); add('Biology', 'Botany', 10);
add('Chemistry', 'Organic Chemistry', 10); add('Chemistry', 'Acids & Bases', 10);
add('Physics', 'Optics', 10);
add('Biology', 'Genetics & Molecular Biology', 5, 'BONUS'); add('Biology', 'Ecology', 5, 'BONUS');

const count = f => {
  const c = {};
  for (const q of rows) if (q.type === 'tossup' && matchesFilters(q, f)) c[`${q.subject}/${q.subcat}`] = (c[`${q.subject}/${q.subcat}`] || 0) + 1;
  return c;
};
const G = subcatKey('Biology', 'Genetics & Molecular Biology');

test('the subcategory column is read', () => {
  assert.equal(rows[0].subcat, 'Genetics & Molecular Biology');
  const [q] = parseQuestions('id,set,round,num,type,subject,question,answer,subcategory\nabc,S,1,1,TOSS-UP,Physics,Q?,A,Optics\n');
  assert.equal(q.subcat, 'Optics');
  assert.equal(q.id, 'abc');
});

test('picking only subcategories gives only those', () => {
  assert.deepEqual(count({ subjects: [], subcats: [G] }), { 'Biology/Genetics & Molecular Biology': 10 });
});

test('a ticked subject with subcategories picked is narrowed to them; other ticked subjects stay whole', () => {
  assert.deepEqual(count({ subjects: ['Biology', 'Chemistry'], subcats: [G] }),
    { 'Biology/Genetics & Molecular Biology': 10, 'Chemistry/Organic Chemistry': 10, 'Chemistry/Acids & Bases': 10 });
});

test('no subcategories picked: subjects work as before', () => {
  assert.equal(Object.keys(count({ subjects: [], subcats: [] })).length, 6);
  assert.deepEqual(Object.keys(count({ subjects: ['Physics'] })), ['Physics/Optics']);
});

test('random draw and bonuses respect subcategories', () => {
  const src = new QuestionSource(rows, { typeMode: 'tb', order: 'random', filters: { subjects: [], subcats: [G] } });
  for (let i = 0; i < 30; i++) assert.equal(src.next().subcat, 'Genetics & Molecular Biology');
  const t = rows.find(q => q.subject === 'Biology' && q.type === 'tossup' && q.subcat === 'Genetics & Molecular Biology');
  for (let i = 0; i < 5; i++) assert.equal(src.bonusFor(t)?.subcat, 'Genetics & Molecular Biology');
});

test('a whole subject next to another subject\'s subcategories still gets bonuses', () => {
  const src = new QuestionSource(rows, { typeMode: 'tb', order: 'random', filters: { subjects: ['Biology'], subcats: [subcatKey('Physics', 'Optics')] } });
  const t = rows.find(q => q.subject === 'Biology' && q.type === 'tossup' && q.subcat === 'Botany');
  assert.ok(src.bonusFor(t), 'a Biology bonus');
});

test('facets list subcategories in the site order', () => {
  const f = facets(rows);
  const bio = f.subcats.find(([s]) => s === 'Biology')[1].map(([n]) => n);
  assert.deepEqual(bio, ['Genetics & Molecular Biology', 'Botany', 'Ecology']);
});

test('every subcategory in the banks is in SUBCATEGORY_ORDER', () => {
  for (const file of ['data/questions.csv', 'data/osb-questions.csv', 'data/visual-bonuses.csv']) {
    const qs = parseQuestions(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    for (const [subject, list] of facets(qs).subcats) {
      for (const [name] of list) assert.ok(SUBCATEGORY_ORDER[subject]?.includes(name), `${file}: ${subject} / ${name}`);
    }
  }
});
