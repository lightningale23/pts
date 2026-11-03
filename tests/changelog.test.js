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
