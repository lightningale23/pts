import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignStages, classifyRound } from '../js/rounds.js';

const stagesFor = (set, labels, overrides) => {
  const qs = labels.map(round => ({ set, round }));
  assignStages(qs, overrides);
  return Object.fromEntries(qs.map(q => [q.round, q.stage]));
};

test('RR / DE tournaments: DE split into thirds, finals late', () => {
  const s = stagesFor('Texas', ['RR1', 'RR5', 'DE1', 'DE2', 'DE3', 'DE4', 'DE5', 'DE6', 'DE7', 'Finals1', 'Finals2']);
  assert.equal(s.RR1, 'rr'); assert.equal(s.RR5, 'rr');
  assert.deepEqual([s.DE1, s.DE2, s.DE3], ['early', 'early', 'early']);
  assert.deepEqual([s.DE4, s.DE5], ['mid', 'mid']);
  assert.deepEqual([s.DE6, s.DE7, s.Finals1, s.Finals2], ['late', 'late', 'late', 'late']);
});

test('DE numbering that does not start at 1, plus a seeding round', () => {
  const s = stagesFor('Enloe', ['Seeding', 'RR1', 'DE6', 'DE7', 'DE8', 'DE9', 'DE10', 'DE11', 'DE12']);
  assert.equal(s.Seeding, 'rr');
  assert.equal(s.DE6, 'early'); assert.equal(s.DE10, 'mid'); assert.equal(s.DE12, 'late');
});

test('Prelim / Playoff / Finals naming', () => {
  const s = stagesFor('SSBT', ['Prelim 1', 'Prelim 3', 'Playoff 1', 'Playoff 2', 'Playoff 3', 'Playoff 4', 'Playoff 5', 'Playoff 6', 'Playoff 7', 'Finals', 'Finals 2']);
  assert.equal(s['Prelim 1'], 'rr');
  assert.equal(s['Playoff 1'], 'early'); assert.equal(s['Playoff 4'], 'mid'); assert.equal(s['Playoff 7'], 'late');
  assert.equal(s.Finals, 'late'); assert.equal(s['Finals 2'], 'late');
});

test('numbered-only rounds: first 5 are RR by default, overridable', () => {
  const labels = Array.from({ length: 14 }, (_, i) => `Round ${i + 1}`);
  const s = stagesFor('Berkeley', labels);
  assert.equal(s['Round 5'], 'rr'); assert.equal(s['Round 6'], 'early'); assert.equal(s['Round 14'], 'late');
  const o = stagesFor('Berkeley', labels, { Berkeley: { rr: 7 } });
  assert.equal(o['Round 7'], 'rr'); assert.equal(o['Round 8'], 'early');
});

test('wildcard rounds count as the earliest elimination rounds; extras are Other', () => {
  const s = stagesFor('MIT', ['Round 1', 'Round 6', 'Round 7', 'Round 16', 'Wildcard Round 1']);
  assert.equal(s['Wildcard Round 1'], 'early');
  assert.equal(classifyRound('Replacements 1-3').kind, 'other');
  assert.equal(classifyRound('ESS Supplemental').kind, 'other');
  assert.equal(classifyRound('Round 3 Supplemental').kind, 'numbered');
  assert.equal(classifyRound('SE2').kind, 'elim');
});

test('setRounds lists one set\'s rounds in stage order, numerically', async () => {
  const { setRounds } = await import('../js/questions.js');
  const q = (set, round, stage) => ({ set, round, stage });
  const qs = [q('A', 'DE10', 'late'), q('A', 'RR10', 'rr'), q('A', 'RR2', 'rr'), q('A', 'RR2', 'rr'),
    q('A', 'Finals 1', 'late'), q('A', 'DE2', 'early'), q('B', 'RR1', 'rr'), q('A', '', 'other')];
  const r = setRounds(qs, 'A');
  assert.deepEqual(r.rounds, [['RR2', 2], ['RR10', 1], ['DE2', 1], ['DE10', 1], ['Finals 1', 1]]);
  assert.deepEqual(r.stages.map(s => [s[0], s[2]]), [['rr', 3], ['early', 1], ['late', 2], ['other', 1]]);
});
