import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportPayload, githubIssueUrl } from '../js/report.js';
import { cleanReport, reportBody, issueTitle, handleReport } from '../worker/presence/src/report.js';

const q = {
  id: 'abc123', set: 'MIT 2025', round: '3', num: '12', type: 'tossup', format: 'mc', subject: 'Chemistry',
  question: 'Which is a noble gas?', choices: ['Argon', 'Iron', 'Tin', 'Lead'], answerLetter: 'W', answerText: 'Argon',
};

test('a report carries the question ID, the problem and the player answer', () => {
  const p = reportPayload(q, { reason: 'ruling', comment: '  should accept Ar ', given: 'Ar', ruled: 'wrong', comp: 'sb' });
  assert.equal(p.id, 'abc123');
  assert.equal(p.comment, 'should accept Ar');
  assert.equal(p.q.answer, 'W) Argon');
  const r = cleanReport(JSON.parse(JSON.stringify(p)));
  assert.equal(issueTitle(r), 'Question abc123: My answer was ruled wrong (or right) by mistake (MIT 2025 R3 #12)');
  const body = reportBody(r);
  assert.match(body, /\*\*Their answer:\*\* Ar \(ruled wrong\)/);
  assert.match(body, /> W\) Argon/);
  // the JSON block at the end reads back as the report
  const json = body.split('```json\n')[1].split('\n```')[0];
  assert.deepEqual(JSON.parse(json), r);
  assert.match(githubIssueUrl(p), /^https:\/\/github\.com\/lightningale23\/pts\/issues\/new\?labels=question-report&title=Question%20abc123/);
});

test('reports are checked and cleaned before they become issues', () => {
  assert.equal(cleanReport({ id: 'abc123', reason: 'nonsense' }), null);
  assert.equal(cleanReport({ id: '../x', reason: 'text' }), null);
  const r = cleanReport({ id: 'abc123', reason: 'other', comment: 'hi @someone ```', q: { question: 'x' } });
  assert.ok(!r.comment.includes('@s'), 'no @mentions');
  assert.ok(!reportBody(r).split('```json\n')[1].split('\n```')[0].includes('`'), 'the JSON block stays closed');
});

test('a second report on the same question is added to its open issue', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', url.replace('https://api.github.com/repos/lightningale23/pts', '')]);
    if (url.includes('/issues?')) return new Response(JSON.stringify([{ number: 7, title: 'Question abc123: Typo' }]));
    return new Response(JSON.stringify({ number: 7 }), { status: 201 });
  };
  try {
    const req = new Request('https://w/report', { method: 'POST', body: JSON.stringify(reportPayload(q, { reason: 'text', comp: 'sb' })) });
    const res = await handleReport(req, { GITHUB_TOKEN: 't' }, 'https://lightningale23.github.io', async () => true);
    assert.deepEqual(await res.json(), { ok: true, issue: 7, added: true });
    assert.deepEqual(calls[1], ['POST', '/issues/7/comments']);
    const limited = await handleReport(new Request('https://w/report', { method: 'POST', body: JSON.stringify(reportPayload(q, { reason: 'text' })) }),
      { GITHUB_TOKEN: 't' }, '', async () => false);
    assert.equal(limited.status, 429);
  } finally { globalThis.fetch = realFetch; }
});
