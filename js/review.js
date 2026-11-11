// Review queue (dev.html → Review tab): questions the packet readers left out, which the
// owner can fix and add. importer/review_queue.py builds review/queue.json; decisions are saved
// to review/decisions.json and importer/apply_review.py (a GitHub Action) adds them to the bank.

export const REVIEW_FIELDS = ['set', 'year', 'level', 'round', 'num', 'type', 'subject', 'format', 'question',
  'w', 'x', 'y', 'z', 'answer', 'accept', 'reject', 'notes'];
export const DECISIONS_PATH = 'review/decisions.json';
export const LOCAL_KEY = 'pts.dev.review.v1';      // decisions not saved to GitHub yet
export const TOKEN_KEY = 'pts.dev.reviewToken';    // a GitHub token, kept in this browser only

// The key merge_into_bank.py uses to spot a question that's already in the bank.
const normKey = t => String(t || '').toLowerCase().replace(/\$|\\text|\\frac|[{}^_]/g, '').replace(/[^a-z0-9]/g, '');
export const bankKey = r => `${normKey(r.question).slice(0, 400)}|${normKey(r.answer).slice(0, 100)}`;

// Why a row can't be added as it is (the same checks apply_review.py makes, plus the subject list).
export function rowProblems(row, subjects = null) {
  const out = [];
  const has = f => String(row[f] ?? '').trim() !== '';
  for (const f of ['set', 'round', 'num', 'subject', 'question', 'answer']) if (!has(f)) out.push(`No ${f === 'num' ? 'number' : f}.`);
  if (!['TOSS-UP', 'BONUS'].includes(row.type)) out.push('Type must be TOSS-UP or BONUS.');
  if (!['Short Answer', 'Multiple Choice'].includes(row.format)) out.push('Format must be Short Answer or Multiple Choice.');
  if (row.format === 'Multiple Choice') {
    if (!['w', 'x', 'y', 'z'].every(has)) out.push('Multiple choice needs all four options.');
    if (!/^[WXYZ]\)/.test(String(row.answer || '').trim())) out.push('A multiple choice answer starts with its letter: "X) TEXT".');
  }
  for (const f of ['accept', 'reject']) if (String(row[f] || '').includes('|')) out.push(`"|" in ${f} splits alternates; write absolute values another way.`);
  if (subjects && has('subject') && !subjects.includes(row.subject)) out.push(`"${row.subject}" isn't one of this competition's subjects.`);
  const dollars = (String(row.question || '').match(/(?<!\\)\$/g) || []).length;
  if (dollars % 2) out.push('An odd number of $ in the question: math is written $...$ and a dollar sign \\$.');
  return out;
}

// A multiple choice answer given as just the letter gets its option text ("X" → "X) VELOCITY").
export function tidyRow(row) {
  const r = { ...row };
  for (const f of REVIEW_FIELDS) r[f] = String(r[f] ?? '').trim();
  r.question = String(row.question ?? '').replace(/[ \t]+\n/g, '\n').trim();
  if (r.format === 'Multiple Choice') {
    const m = r.answer.match(/^\(?([WXYZwxyz])\)?\.?$/);
    if (m) { const L = m[1].toUpperCase(); r.answer = `${L}) ${r['wxyz'['WXYZ'.indexOf(L)]]}`.trim(); }
  } else {
    r.w = r.x = r.y = r.z = '';
  }
  return r;
}

// Status of a queue item: 'added' (in the bank), 'repeat' (was already there), 'dismissed',
// 'add' (approved, waiting for the GitHub Action), or 'todo'. Local edits count first.
export function itemStatus(rid, { saved = {}, local = {}, applied = {} } = {}) {
  if (applied[rid]) return applied[rid].repeat ? 'repeat' : 'added';
  const d = local[rid] || saved[rid];
  if (!d) return 'todo';
  return d.action === 'dismiss' ? 'dismissed' : d.action === 'add' ? 'add' : 'todo';
}

// Saved decisions plus this browser's unsaved ones. {action: 'undo'} removes a saved one;
// decisions for questions already added can't change.
export function mergeDecisions(saved = {}, local = {}, applied = {}) {
  const out = { ...saved };
  for (const [rid, d] of Object.entries(local)) {
    if (applied[rid]) continue;
    if (d.action === 'undo') delete out[rid];
    else out[rid] = d;
  }
  return out;
}

// ── GitHub contents API (the Review tab saves decisions.json with the owner's token) ─────
const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));

export async function ghRead(repo, path, token) {
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=main&t=${Date.now()}`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store',
  });
  if (r.status === 404) return { sha: null, json: null };
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json().catch(() => ({}))).message || r.statusText}`);
  const j = await r.json();
  return { sha: j.sha, json: JSON.parse(unb64(j.content || '') || 'null') };
}

export async function ghWrite(repo, path, token, obj, sha, message) {
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, branch: 'main', content: b64(JSON.stringify(obj, null, 1) + '\n'), ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) {
    const e = new Error(`GitHub ${r.status}: ${(await r.json().catch(() => ({}))).message || r.statusText}`);
    e.status = r.status;
    throw e;
  }
  return (await r.json()).content?.sha;
}
