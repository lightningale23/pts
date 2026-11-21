// dev.html's password, checked on the presence Worker (worker/presence/src/devauth.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DevAuth, LIMITS } from '../worker/presence/src/devauth.js';

const store = () => { const m = new Map(); return { get: async k => m.get(k), put: async (k, v) => { m.set(k, v); }, m }; };
const post = (path, body, token) => new Request(`https://w${path}`, {
  method: 'POST', body: JSON.stringify(body || {}), headers: token ? { authorization: `Bearer ${token}` } : {},
});

test('without a password set, nobody gets in', async () => {
  const a = new DevAuth(store(), {});
  assert.deepEqual(await a.login({ password: 'anything' }), [503, { ok: false, error: 'not-set-up' }]);
  assert.equal((await a.check('v1.99999999999999.abcdefghijklmnopqrstuvwxyz'))[0], 401);
});

test('the right password gives a session the Worker accepts; a wrong one or a forged one does not', async () => {
  const a = new DevAuth(store(), { DEV_PASSWORD: 'correct horse' });
  const [st, bad] = await a.login({ password: 'Correct horse' });
  assert.equal(st, 401);
  assert.equal(bad.error, 'wrong');
  const [ok, res] = await a.login({ password: 'correct horse' });
  assert.equal(ok, 200);
  assert.equal((await a.check(res.token))[0], 200);
  // changing the expiry breaks the signature
  const [, , sig] = res.token.split('.');
  assert.equal((await a.check(`v1.${res.exp + 1000}.${sig}`))[0], 401);
  assert.equal((await a.check(''))[0], 401);
  // "keep me signed in" lasts longer
  const [, long] = await a.login({ password: 'correct horse', remember: true });
  assert.ok(long.exp - res.exp > 20 * 86400e3);
});

test('sessions run out', async () => {
  let t = 1e12;
  const a = new DevAuth(store(), { DEV_PASSWORD: 'pw123456' }, () => t);
  const [, res] = await a.login({ password: 'pw123456' });
  t += LIMITS.shortDays * 86400e3 + 1;
  assert.equal((await a.check(res.token))[0], 401);
});

test('too many wrong passwords pause logins, even with the right one', async () => {
  let t = 1e12;
  const a = new DevAuth(store(), { DEV_PASSWORD: 'pw123456' }, () => t);
  for (let i = 0; i < LIMITS.maxFails; i++) assert.equal((await a.login({ password: `nope${i}` }))[0], 401);
  const [st, body] = await a.login({ password: 'pw123456' });
  assert.equal(st, 429);
  assert.ok(body.retryAfter > 0);
  t += LIMITS.failWindowMs + 1;
  assert.equal((await a.login({ password: 'pw123456' }))[0], 200);
});

test('changing the password signs other devices out; a new DEV_PASSWORD secret resets it', async () => {
  const s = store();
  const a = new DevAuth(s, { DEV_PASSWORD: 'first-pass' });
  const [, d1] = await a.login({ password: 'first-pass' });
  const [, d2] = await a.login({ password: 'first-pass' });
  assert.equal((await a.change(d1.token, { current: 'wrong', next: 'second-pass' }))[0], 401);
  assert.equal((await a.change(d1.token, { current: 'first-pass', next: 'short' }))[0], 400);
  const [st, mine] = await a.change(d1.token, { current: 'first-pass', next: 'second-pass' });
  assert.equal(st, 200);
  assert.equal((await a.check(mine.token))[0], 200);
  assert.equal((await a.check(d2.token))[0], 401, 'the other device is signed out');
  assert.equal((await a.login({ password: 'first-pass' }))[0], 401);
  assert.equal((await a.login({ password: 'second-pass' }))[0], 200);
  const stored = s.m.get('dev.pw');
  assert.ok(!JSON.stringify(stored).includes('second-pass'), 'only a hash is kept');
  // the owner forgot it: a new secret wins over the stored password
  const b = new DevAuth(s, { DEV_PASSWORD: 'reset-pass' });
  assert.equal((await b.login({ password: 'second-pass' }))[0], 401);
  assert.equal((await b.login({ password: 'reset-pass' }))[0], 200);
});

test('sign out everywhere', async () => {
  const a = new DevAuth(store(), { DEV_PASSWORD: 'pw123456' });
  const [, x] = await a.login({ password: 'pw123456' });
  const [, y] = await a.login({ password: 'pw123456' });
  assert.equal((await a.logout(x.token))[0], 200);
  assert.equal((await a.check(y.token))[0], 401);
  assert.equal((await a.logout(y.token))[0], 401, 'needs a live session');
});

test('requests are routed by path', async () => {
  const a = new DevAuth(store(), { DEV_PASSWORD: 'pw123456' });
  const [st, res] = await a.handle(post('/dev/login', { password: 'pw123456' }));
  assert.equal(st, 200);
  assert.equal((await a.handle(post('/dev/check', {}, res.token)))[0], 200);
  assert.equal((await a.handle(new Request('https://w/dev/check')))[0], 405);
  assert.equal((await a.handle(post('/dev/login', { password: 'x'.repeat(3000) })))[0], 413);
});
