// The changelog at the bottom of the help page.
//
// Two sources, merged:
//  - data/changelog.json, written alongside each change ({ date, items: [...] }, newest first)
//  - recent commits to the site's GitHub repo (CONFIG.repo): every line starting with
//    "Changelog:" in a commit message is an entry, so anything pushed with one shows up
//    without editing the JSON. If GitHub can't be reached, the JSON alone is shown.
import { CONFIG } from './config.js';
import { el } from './util.js';

const CACHE_KEY = 'pts.changelog.commits.v1';
const CACHE_MS = 10 * 60 * 1000;
const squash = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '');

// "Changelog: ..." lines from commit messages: [{ date, text }]
export function entriesFromCommits(commits) {
  const out = [];
  for (const c of commits || []) {
    const msg = c?.commit?.message || '';
    const when = c?.commit?.committer?.date || c?.commit?.author?.date;
    if (!when) continue;
    const date = new Date(when).toLocaleDateString('en-CA');     // YYYY-MM-DD, local time
    for (const m of msg.matchAll(/^\s*Changelog:\s*(.+?)\s*$/gim)) out.push({ date, text: m[1] });
  }
  return out;
}

// Merge commit entries into the file's days; an entry already in the file isn't repeated.
export function mergeChangelog(days, extra) {
  const byDate = new Map((days || []).map(d => [d.date, { date: d.date, items: [...(d.items || [])] }]));
  const seen = new Set([...byDate.values()].flatMap(d => d.items.map(squash)));
  for (const e of extra || []) {
    if (seen.has(squash(e.text))) continue;
    seen.add(squash(e.text));
    if (!byDate.has(e.date)) byDate.set(e.date, { date: e.date, items: [] });
    byDate.get(e.date).items.unshift(e.text);
  }
  return [...byDate.values()].filter(d => d.items.length).sort((a, b) => (a.date < b.date ? 1 : -1));
}

async function recentCommits() {
  if (!CONFIG.repo) return [];
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (c && Date.now() - c.at < CACHE_MS) return c.list;
  } catch { /* ignore */ }
  try {
    const r = await fetch(`https://api.github.com/repos/${CONFIG.repo}/commits?per_page=50`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return [];
    const list = entriesFromCommits(await r.json());
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), list })); } catch { /* ignore */ }
    return list;
  } catch { return []; }
}

const longDate = d => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

// Fill the <details> the first time it's opened.
export function setupChangelog(details) {
  if (!details) return;
  const body = details.querySelector('.changelog-body');
  let loaded = false;
  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return;
    loaded = true;
    body.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
    const [days, commits] = await Promise.all([
      fetch('data/changelog.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : [])).catch(() => []),
      recentCommits(),
    ]);
    const all = mergeChangelog(days, commits);
    if (!all.length) { body.replaceChildren(el('p', { class: 'muted' }, "The changelog couldn't be loaded.")); loaded = false; return; }
    body.replaceChildren(...all.map(d => el('section', { class: 'changelog-day' },
      el('h3', {}, longDate(d.date)),
      el('ul', {}, d.items.map(t => el('li', {}, t))))));
  });
}
