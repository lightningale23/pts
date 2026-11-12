// "Report" on a question: a short form whose answers become a GitHub issue on the site's repo
// (label `question-report`), sent through the Worker at CONFIG.reportApi so players need no
// GitHub account. If the Worker can't be reached, the player can open the same issue on GitHub.
// Reports for a question that already has an open issue are added to it as a comment.
import { $, el, store } from './util.js';
import { CONFIG } from './config.js';
import { plainText } from './text.js';

const KEY = 'pts.reported.v1';   // { [questionId]: time reported }, so the button can say "Reported"

export const REASONS = [
  ['answer', 'The answer is wrong, or should accept another answer'],
  ['ruling', 'My answer was ruled wrong (or right) by mistake'],
  ['text', 'Typo, missing words or garbled text'],
  ['math', 'Math, formulas or symbols look broken'],
  ['choices', 'The answer choices are wrong or missing'],
  ['picture', 'It needs a picture or diagram that isn\'t shown'],
  ['category', 'Wrong subject or subcategory'],
  ['other', 'Something else'],
];
const REASON_LABEL = Object.fromEntries(REASONS);

export function wasReported(id) { return !!(store.get(KEY, {}) || {})[id]; }
function markReported(id) {
  const all = store.get(KEY, {}) || {};
  all[id] = Date.now();
  // keep the newest 500
  const keep = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 500);
  store.set(KEY, Object.fromEntries(keep));
}

const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
function currentComp() {
  try { return new URLSearchParams(location.search).get('comp') || store.get('pts.comp', CONFIG.defaultCompetition || 'sb'); }
  catch { return 'sb'; }
}

// What gets sent: enough to find the question (its ID) and to read the problem without the site.
export function reportPayload(q, { reason, comment = '', given = '', ruled = '', where = 'practice', comp } = {}) {
  return {
    v: 1,
    id: q.id,
    comp: comp || currentComp(),
    reason,
    comment: cut(comment.trim(), 1000),
    given: given ? cut(given, 200) : '',
    ruled: ruled || '',
    where,
    q: {
      set: q.set || '', round: q.round || '', num: q.num || '', type: q.type || '', format: q.format || '',
      subject: q.subject || '', subcategory: q.subcat || q.subcategory || '',
      question: cut(q.question, 1500),
      choices: (q.choices || []).map(c => cut(c, 200)),
      answer: cut(q.choices && q.answerLetter ? `${q.answerLetter}) ${q.answerText}` : q.answer, 300),
      image: q.image || '',
    },
  };
}

export function issueTitle(p) {
  const src = [p.q.set, p.q.round ? (/^\d+$/.test(p.q.round) ? `R${p.q.round}` : p.q.round) : '', p.q.num ? `#${p.q.num}` : ''].filter(Boolean).join(' ');
  return cut(`Question ${p.id}: ${REASON_LABEL[p.reason] || p.reason}${src ? ` (${src})` : ''}`, 200);
}

// The same issue, opened by the player on GitHub (needs a GitHub account).
export function githubIssueUrl(p) {
  const body = [
    `**Problem:** ${REASON_LABEL[p.reason] || p.reason}`,
    p.comment ? `**Details:** ${p.comment}` : '',
    p.given ? `**Their answer:** "${p.given}"${p.ruled ? ` (ruled ${p.ruled})` : ''}` : '',
    '',
    `Question \`${p.id}\` (${p.comp.toUpperCase()}): ${[p.q.set, p.q.round && `Round ${p.q.round}`, p.q.num && `#${p.q.num}`].filter(Boolean).join(', ')}`,
    `> ${plainText(cut(p.q.question, 600)).replace(/\n/g, '\n> ')}`,
    `Answer: ${p.q.answer}`,
    '',
    '```json',
    JSON.stringify({ ...p, q: { ...p.q, question: cut(p.q.question, 600) } }),
    '```',
  ].filter(s => s !== '').join('\n');
  const repo = CONFIG.repo || 'lightningale23/pts';
  return `https://github.com/${repo}/issues/new?labels=question-report&title=${encodeURIComponent(issueTitle(p))}&body=${encodeURIComponent(body)}`;
}

export async function sendReport(p) {
  if (!CONFIG.reportApi) throw new Error('no report address');
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(CONFIG.reportApi, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p), signal: ctl?.signal,
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out.ok) throw new Error(out.error || `HTTP ${r.status}`);
    return out;
  } finally { clearTimeout(timer); }
}

// The report form, in the site's dialog. onDone() runs after a report is sent.
export function openReport(q, { given = '', ruled = '', where = 'practice', onDone } = {}) {
  if (!q?.id) return;
  const d = $('#dialog');
  const reasons = REASONS.filter(([k]) => (k !== 'ruling' || given) && (k !== 'choices' || q.format === 'mc'));
  const form = el('form', { class: 'report-form', method: 'dialog' });
  const comment = el('textarea', {
    id: 'report-comment', rows: 3, maxlength: 1000,
    placeholder: 'What’s wrong? For example: “should also accept ATP” or “choice Y is cut off”.',
  });
  const status = el('p', { class: 'report-status', role: 'status' });
  const send = el('button', { class: 'btn primary', type: 'submit' }, 'Send report');
  const src = [q.set, q.round ? (/^\d+$/.test(q.round) ? `Round ${q.round}` : q.round) : '', q.num ? `#${q.num}` : ''].filter(Boolean).join(', ');
  form.append(
    el('h2', {}, 'Report a problem'),
    el('p', { class: 'meta' }, `${q.subject || ''} ${q.type === 'bonus' ? 'bonus' : 'toss-up'}${src ? `, ${src}` : ''} (ID ${q.id})`),
    el('fieldset', { class: 'report-reasons' }, el('legend', { class: 'sr-only' }, 'What’s wrong?'),
      reasons.map(([k, label]) => el('label', {},
        el('input', { type: 'radio', name: 'reason', value: k, required: true, checked: k === 'ruling' && ruled === 'wrong' }),
        ' ', label))),
    el('label', { class: 'report-comment-label', for: 'report-comment' }, 'Details (optional)'),
    comment,
    given ? el('p', { class: 'meta' }, `Your answer “${given}” is sent with the report.`) : null,
    status,
    el('div', { class: 'actions' },
      el('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Cancel'),
      send));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const reason = form.querySelector('input[name=reason]:checked')?.value;
    if (!reason) { status.textContent = 'Pick what’s wrong first.'; return; }
    if (reason === 'other' && !comment.value.trim()) { status.textContent = 'Say what’s wrong in the details box.'; comment.focus(); return; }
    const p = reportPayload(q, { reason, comment: comment.value, given, ruled, where });
    send.disabled = true;
    status.textContent = 'Sending…';
    try {
      await sendReport(p);
      markReported(q.id);
      onDone?.();
      form.replaceChildren(el('h2', {}, 'Thanks!'),
        el('p', {}, 'Your report was sent. It will be looked at and the question fixed.'),
        el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', onclick: () => d.close() }, 'Close')));
    } catch {
      send.disabled = false;
      status.replaceChildren('Couldn’t send the report from here. ',
        el('a', { href: githubIssueUrl(p), target: '_blank', rel: 'noopener', onclick: () => { markReported(q.id); onDone?.(); } }, 'Open it on GitHub instead'),
        ' (needs a free GitHub account).');
    }
  });
  d.replaceChildren(form);
  d.showModal();
}
