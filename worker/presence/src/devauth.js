// Password for dev.html, checked here on the Worker so it never reaches the browser or the repo.
//   POST /dev/login     {password, remember}  → {ok, token, exp}
//   POST /dev/check     (Authorization: Bearer <token>) → {ok, exp}
//   POST /dev/password  (Bearer) {current, next}  → {ok, token, exp}   change the password
//   POST /dev/logout    (Bearer) → {ok}   signs every device out
// The first password is the Worker secret DEV_PASSWORD (`npx wrangler secret put DEV_PASSWORD`).
// A password changed on the dev page is kept here as a salted PBKDF2 hash, and wins until
// DEV_PASSWORD itself is changed, which is also how to reset a forgotten one.
// Sessions are HMAC-signed with a random key kept in the Durable Object; changing the password
// or signing out everywhere replaces the key, so every old session stops working.
// Wrong passwords are limited site-wide (no IPs or anything else about the sender is kept).

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const randomB64u = n => b64u(crypto.getRandomValues(new Uint8Array(n)));

export const LIMITS = {
  failWindowMs: 15 * 60e3,   // wrong passwords counted over this long...
  maxFails: 10,              // ...and this many locks logins until the oldest falls out
  shortDays: 0.5,            // session without "keep me signed in"
  longDays: 30,
  minLength: 8,
  iterations: 100000,        // PBKDF2 (the most Workers allow)
};

async function sha256(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))); }

function same(a, b) {               // constant time for equal lengths
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

async function hmac(keyB64, msg) {
  const key = await crypto.subtle.importKey('raw', fromB64u(keyB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

// A short tag of the DEV_PASSWORD secret, so a changed secret is noticed (the secret itself isn't stored).
const secretTag = async secret => b64u(await sha256(`pts-dev-secret|${secret || ''}`)).slice(0, 16);

export class DevAuth {
  // storage: {get(key), put(key, value)} (a Durable Object's storage, or a Map-like stand-in in tests)
  constructor(storage, env, now = () => Date.now()) { this.storage = storage; this.env = env; this.now = now; }

  async configured() { return Boolean(this.env.DEV_PASSWORD) || Boolean(await this.storage.get('dev.pw')); }

  async passwordOk(given) {
    if (typeof given !== 'string' || !given || given.length > 200) return false;
    const stored = await this.storage.get('dev.pw');
    if (stored && stored.tag === await secretTag(this.env.DEV_PASSWORD)) {
      return same(await pbkdf2(given, fromB64u(stored.salt), stored.iter), fromB64u(stored.hash));
    }
    if (!this.env.DEV_PASSWORD) return false;
    return same(await sha256(given), await sha256(this.env.DEV_PASSWORD));
  }

  async key() {
    let k = await this.storage.get('dev.key');
    if (!k) { k = randomB64u(32); await this.storage.put('dev.key', k); }
    return k;
  }

  async newKey() { const k = randomB64u(32); await this.storage.put('dev.key', k); return k; }

  async issue(days) {
    const exp = this.now() + Math.round(days * 86400e3);
    const body = `v1.${exp}`;
    return { token: `${body}.${await hmac(await this.key(), body)}`, exp };
  }

  async verify(token) {
    const m = /^v1\.(\d{1,16})\.([\w-]{20,})$/.exec(String(token || ''));
    if (!m || Number(m[1]) <= this.now()) return null;
    const want = await hmac(await this.key(), `v1.${m[1]}`);
    return same(enc.encode(want), enc.encode(m[2])) ? { exp: Number(m[1]) } : null;
  }

  async fails() {
    const t = this.now();
    return ((await this.storage.get('dev.fails')) || []).filter(x => t - x < LIMITS.failWindowMs);
  }

  // → [status, body]
  async login({ password, remember } = {}) {
    if (!(await this.configured())) return [503, { ok: false, error: 'not-set-up' }];
    const fails = await this.fails();
    if (fails.length >= LIMITS.maxFails) {
      return [429, { ok: false, error: 'locked', retryAfter: Math.ceil((fails[0] + LIMITS.failWindowMs - this.now()) / 1000) }];
    }
    if (!(await this.passwordOk(password))) {
      fails.push(this.now());
      await this.storage.put('dev.fails', fails);
      return [401, { ok: false, error: 'wrong', left: LIMITS.maxFails - fails.length }];
    }
    return [200, { ok: true, ...(await this.issue(remember ? LIMITS.longDays : LIMITS.shortDays)) }];
  }

  async check(token) {
    const s = await this.verify(token);
    return s ? [200, { ok: true, exp: s.exp }] : [401, { ok: false, error: 'signed-out' }];
  }

  async change(token, { current, next, remember } = {}) {
    if (!(await this.verify(token))) return [401, { ok: false, error: 'signed-out' }];
    if ((await this.fails()).length >= LIMITS.maxFails) return [429, { ok: false, error: 'locked' }];
    if (!(await this.passwordOk(current))) {
      const fails = await this.fails();
      fails.push(this.now());
      await this.storage.put('dev.fails', fails);
      return [401, { ok: false, error: 'wrong' }];
    }
    if (typeof next !== 'string' || next.length < LIMITS.minLength || next.length > 200) return [400, { ok: false, error: 'too-short' }];
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await this.storage.put('dev.pw', {
      salt: b64u(salt), hash: b64u(await pbkdf2(next, salt, LIMITS.iterations)), iter: LIMITS.iterations,
      tag: await secretTag(this.env.DEV_PASSWORD), at: this.now(),
    });
    await this.newKey();                       // every other device is signed out
    return [200, { ok: true, ...(await this.issue(remember ? LIMITS.longDays : LIMITS.shortDays)) }];
  }

  async logout(token) {
    if (!(await this.verify(token))) return [401, { ok: false, error: 'signed-out' }];
    await this.newKey();
    return [200, { ok: true }];
  }

  // The Durable Object hands /dev/* requests here.
  async handle(request) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST') return [405, { ok: false, error: 'POST' }];
    const text = await request.text();
    if (text.length > 2000) return [413, { ok: false, error: 'too long' }];
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { return [400, { ok: false, error: 'bad json' }]; }
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (path === '/dev/login') return this.login(body);
    if (path === '/dev/check') return this.check(token);
    if (path === '/dev/password') return this.change(token, body);
    if (path === '/dev/logout') return this.logout(token);
    return [404, { ok: false, error: 'not found' }];
  }
}
