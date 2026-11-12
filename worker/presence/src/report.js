// Question reports: the site's "Report" form posts here, and each report becomes a GitHub issue
// on the site's repo, labeled question-report (a second report on a question that already has an
// open issue is added to it as a comment). Needs the secret GITHUB_TOKEN: a fine-grained token
// with Issues read and write on the repo only (see README.md). Nothing about the sender is kept.

const LABEL = 'question-report';
const REASONS = {
  answer: 'The answer is wrong, or should accept another answer',
  ruling: 'My answer was ruled wrong (or right) by mistake',
  text: 'Typo, missing words or garbled text',
  math: 'Math, formulas or symbols look broken',
  choices: 'The answer choices are wrong or missing',
  picture: "It needs a picture or diagram that isn't shown",
  category: 'Wrong subject or subcategory',
  other: 'Something else',
};

export function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

const reply = (body, status, origin) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(origin) },
});

// Text from players: no @mentions, no breaking out of the quote, length capped.
const str = (v, n) => String(v ?? '').replace(/\r/g, '').slice(0, n);
const safe = (v, n) => str(v, n).replace(/@/g, '@​');
const quote = s => s.split('\n').map(l => `> ${l}`).join('\n');

export function cleanReport(p) {
  if (!p || typeof p !== 'object') return null;
  const id = str(p.id, 20);
  if (!/^[a-z0-9]{3,16}$/i.test(id) || !REASONS[p.reason]) return null;
  const q = p.q && typeof p.q === 'object' ? p.q : {};
  return {
    v: 1, id, reason: p.reason,
    comp: /^[a-z]{2,4}$/.test(p.comp) ? p.comp : 'sb',
    comment: safe(p.comment, 1000).trim(),
    given: safe(p.given, 200),
    ruled: ['right', 'wrong'].includes(p.ruled) ? p.ruled : '',
    where: ['practice', 'questions', 'saved'].includes(p.where) ? p.where : 'practice',
    q: {
      set: safe(q.set, 80), round: safe(q.round, 20), num: safe(q.num, 10), type: safe(q.type, 10), format: safe(q.format, 10),
      subject: safe(q.subject, 40), subcategory: safe(q.subcategory, 60),
      question: safe(q.question, 1500),
      choices: Array.isArray(q.choices) ? q.choices.slice(0, 4).map(c => safe(c, 200)) : [],
      answer: safe(q.answer, 300), image: safe(q.image, 120),
    },
  };
}

export function issueTitle(r) {
  const src = [r.q.set, r.q.round ? (/^\d+$/.test(r.q.round) ? `R${r.q.round}` : r.q.round) : '', r.q.num ? `#${r.q.num}` : ''].filter(Boolean).join(' ');
  return `Question ${r.id}: ${REASONS[r.reason]}${src ? ` (${src})` : ''}`.slice(0, 200);
}

// The issue (or comment) text: readable, then the report as JSON for whoever fixes it.
export function reportBody(r) {
  const where = [r.q.set, r.q.round && (/^\d+$/.test(r.q.round) ? `Round ${r.q.round}` : r.q.round), r.q.num && `#${r.q.num}`].filter(Boolean).join(', ');
  const json = JSON.stringify(r).replace(/`/g, '\\u0060');
  return [
    `**Problem:** ${REASONS[r.reason]}`,
    r.comment ? `**Details:**\n${quote(r.comment)}` : null,
    r.given ? `**Their answer:** ${r.given}${r.ruled ? ` (ruled ${r.ruled})` : ''}` : null,
    '',
    `**Question** \`${r.id}\` (${r.comp.toUpperCase()}, ${[r.q.subject, r.q.type, r.q.format].filter(Boolean).join(' ')}): ${where}`,
    quote(r.q.question || '(no text)'),
    r.q.choices.some(Boolean) ? r.q.choices.map((c, i) => (c ? `> ${'WXYZ'[i]}) ${c}` : '')).filter(Boolean).join('\n') : null,
    `**Answer:** ${r.q.answer}`,
    '',
    '```json',
    json,
    '```',
  ].filter(s => s !== null).join('\n');
}

async function gh(env, path, init = {}) {
  const r = await fetch(`https://api.github.com/repos/${env.REPORT_REPO || 'lightningale23/pts'}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'user-agent': 'pts-report-worker', 'content-type': 'application/json',
    },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

// An open report issue for this question, if there is one.
async function openIssueFor(env, id) {
  const prefix = `Question ${id}:`;
  for (let page = 1; page <= 5; page++) {
    const list = await gh(env, `/issues?labels=${LABEL}&state=open&per_page=100&page=${page}`);
    const hit = list.find(i => !i.pull_request && i.title.startsWith(prefix));
    if (hit || list.length < 100) return hit || null;
  }
  return null;
}

export async function handleReport(request, env, origin, allow) {
  if (request.method !== 'POST') return reply({ ok: false, error: 'POST a report' }, 405, origin);
  if (!env.GITHUB_TOKEN) return reply({ ok: false, error: 'reports are not set up' }, 503, origin);
  const text = await request.text();
  if (text.length > 12000) return reply({ ok: false, error: 'too long' }, 413, origin);
  let r;
  try { r = cleanReport(JSON.parse(text)); } catch { r = null; }
  if (!r) return reply({ ok: false, error: 'bad report' }, 400, origin);
  if (!(await allow())) return reply({ ok: false, error: 'too many reports right now' }, 429, origin);
  try {
    const body = reportBody(r);
    const open = await openIssueFor(env, r.id);
    if (open) {
      await gh(env, `/issues/${open.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Another report:\n\n${body}` }) });
      return reply({ ok: true, issue: open.number, added: true }, 200, origin);
    }
    const made = await gh(env, '/issues', { method: 'POST', body: JSON.stringify({ title: issueTitle(r), body, labels: [LABEL] }) });
    return reply({ ok: true, issue: made.number }, 200, origin);
  } catch (e) {
    return reply({ ok: false, error: String(e.message || e) }, 502, origin);
  }
}
