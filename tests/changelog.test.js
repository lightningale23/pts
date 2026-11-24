import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entriesFromCommits, mergeChangelog } from '../js/changelog.js';

test('commit messages give changelog entries from their "Changelog:" lines', () => {
  const commits = [
    { commit: { message: 'Fix a thing\n\nChangelog: Faster loading.\nChangelog: A new button.\n\nCo-Authored-By: x', committer: { date: '2026-11-03T18:00:00Z' } } },
    { commit: { message: 'Refactor, nothing visible', committer: { date: '2026-11-03T17:00:00Z' } } },
  ];
  const e = entriesFromCommits(commits);
  assert.deepEqual(e.map(x => x.text), ['Faster loading.', 'A new button.']);
  assert.match(e[0].date, /^\d{4}-\d\d-\d\d$/);
});

test('commit entries join the file without repeats, newest day first', () => {
  const days = [{ date: '2026-11-02', items: ['Help: this changelog.'] }, { date: '2026-11-01', items: ['Negs.'] }];
  const all = mergeChangelog(days, [
    { date: '2026-11-03', text: 'A new button.' },
    { date: '2026-11-02', text: 'Help: this changelog' },    // already in the file
  ]);
  assert.deepEqual(all.map(d => d.date), ['2026-11-03', '2026-11-02', '2026-11-01']);
  assert.deepEqual(all[1].items, ['Help: this changelog.']);
});

test('only commits newer than the last change to the JSON add entries', () => {
  const at = { committer: { date: '2026-11-24T18:00:00Z' } };
  const commits = [
    { sha: 'c3', commit: { ...at, message: 'New\n\nChangelog: Pushed without the JSON.' } },
    { sha: 'c2', commit: { ...at, message: 'With JSON\n\nChangelog: Shorter wording of the JSON entry.' } },
    { sha: 'c1', commit: { ...at, message: 'Older\n\nChangelog: Progress note.' } },
  ];
  assert.deepEqual(entriesFromCommits(commits, 'c2').map(e => e.text), ['Pushed without the JSON.']);
  assert.equal(entriesFromCommits(commits).length, 3);
});

test('changelog.json: days newest first, no day twice, no entry twice', async () => {
  const { readFileSync } = await import('node:fs');
  const days = JSON.parse(readFileSync(new URL('../data/changelog.json', import.meta.url)));
  const dates = days.map(d => d.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.equal(new Set(dates).size, dates.length);
  const squash = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const seen = new Map();
  for (const d of days) for (const t of d.items) {
    assert.ok(!seen.has(squash(t)), `"${t}" is on ${seen.get(squash(t))} and ${d.date}`);
    seen.set(squash(t), d.date);
  }
});
