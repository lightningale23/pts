import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { QuestionSource, normalizeRow, parseQuestions, matchesFilters, facets } from '../js/questions.js';
import { introTokens } from '../js/text.js';
import { metaOf } from '../js/engine.js';

const row = (num, type, subject, extra = {}) => normalizeRow({ set: 'S', round: 'RR1', num: String(num), type, subject, question: `${subject} ${type} ${num}?`, answer: 'X', ...extra });
const tu1 = row(1, 'TOSS-UP', 'Biology');
const vis1 = row(1, 'BONUS', 'Biology', { image: 'data/visuals/abc.webp' });
const bon2 = row(2, 'BONUS', 'Biology');
const tu2 = row(2, 'TOSS-UP', 'Biology');

test('the image column comes through; questions without one have no image', () => {
  assert.equal(vis1.image, 'data/visuals/abc.webp');
  assert.equal('image' in bon2, false);
  assert.equal(vis1.id, row(1, 'BONUS', 'Biology').id, 'the picture does not change the ID');
});

test('visual bonuses are in by default and out when turned off', () => {
  assert.equal(matchesFilters(vis1, {}), true);
  assert.equal(matchesFilters(vis1, { visuals: true }), true);
  assert.equal(matchesFilters(vis1, { visuals: false }), false);
  assert.equal(matchesFilters(bon2, { visuals: false }), true);
  assert.equal(facets([tu1, vis1, bon2]).visuals, 1);
});

test('a toss-up gets its visual bonus only while visual bonuses are on', () => {
  const all = [tu1, vis1, tu2, bon2];
  const on = new QuestionSource(all, { typeMode: 'tb', filters: { subjects: [] } });
  assert.equal(on.bonusFor(tu1), vis1);
  const off = new QuestionSource(all, { typeMode: 'tb', filters: { subjects: [], visuals: false } });
  for (let i = 0; i < 5; i++) assert.notEqual(off.bonusFor(tu1), vis1);
  assert.equal(new QuestionSource(all, { typeMode: 'tb', filters: { visuals: false } }).bonusFor(tu2), bon2);
});

test('bonuses-only practice leaves visual bonuses out when they are off', () => {
  const src = new QuestionSource([tu1, vis1, bon2], { typeMode: 'bonus', order: 'packet', filters: { visuals: false } });
  assert.deepEqual(src.pool.map(q => q.id), [bon2.id]);
});

test('the lead-in and the question info say it is a visual bonus', () => {
  assert.equal(introTokens(vis1)[1].t, 'Visual bonus');
  assert.equal(introTokens(bon2)[1].t, 'Bonus');
  assert.equal(metaOf(vis1).image, vis1.image);
});

test('every visual bonus in the file has its picture', () => {
  const url = new URL('../data/visual-bonuses.csv', import.meta.url);
  if (!existsSync(url)) return;
  const qs = parseQuestions(readFileSync(url, 'utf8'));
  assert.ok(qs.length > 0);
  for (const q of qs) {
    assert.match(q.image || '', /^data\/visuals\/[\w-]+\.webp$/, `${q.id} has no picture`);
    assert.ok(existsSync(new URL(`../${q.image}`, import.meta.url)), `${q.image} is missing`);
  }
});

test('"Visual bonuses only" gives just the visual bonuses, even with the checkbox off', () => {
  const all = [tu1, vis1, tu2, bon2];
  for (const visuals of [true, false]) {
    const src = new QuestionSource(all, { typeMode: 'visual', order: 'packet', filters: { visuals } });
    assert.deepEqual(src.pool.map(q => q.id), [vis1.id]);
  }
});

test('a visual bonus gets the visual bonus time (30 seconds by default), other bonuses the bonus time', async () => {
  const { mock } = await import('node:test');
  const { GameEngine } = await import('../js/engine.js');
  const timerFor = (q, extra = {}) => {
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const s = { wpm: 600, instant: true, typeMode: 'bonus', order: 'packet', filters: {}, buzzWindow: 5, answerTime: 7,
      bonusTime: 20, tossupPts: 4, bonusPts: 10, interruptPenalty: 4, autoNext: 0, teams: false, announce: false, ...extra };
    const src = new QuestionSource([q], s);
    const eng = new GameEngine({ source: src, settings: s });
    const timers = [];
    eng.on('timer', d => timers.push(d));
    eng.addPlayer('a', 'Ana');
    eng.next();
    for (let t = 0; t < 3000; t += 50) mock.timers.tick(50);
    mock.timers.reset();
    return timers.find(t => t.kind === (s.typeMode === 'mixed' ? 'buzz' : 'answer'))?.ms;
  };
  assert.equal(timerFor(vis1), 30000);
  assert.equal(timerFor(vis1, { visualTime: 45 }), 45000);
  assert.equal(timerFor(bon2), 20000);
  assert.equal(timerFor(vis1, { typeMode: 'mixed' }), 30000, 'mixed mode: 30 seconds to buzz');
  assert.equal(timerFor(bon2, { typeMode: 'mixed' }), 20000);
});
