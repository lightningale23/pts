// Password screen for dev.html. The password is checked by the presence Worker
// (worker/presence/src/devauth.js), never in this page: the Worker hands back a signed session,
// and the dev tools (js/dev.js) are only loaded once the Worker has accepted it.
import { CONFIG } from './config.js';
import { $, el, store } from './util.js';

const API = String(CONFIG.devAuthApi || '').replace(/\/$/, '');
const KEY = 'pts.dev.session.v1';   // {token, exp}; localStorage when "keep me signed in", else sessionStorage

const theme = store.get('lockout.theme', null);
if (theme) document.documentElement.dataset.theme = theme;

const session = {
  get() {
    for (const s of [sessionStorage, localStorage]) {
      try { const v = JSON.parse(s.getItem(KEY) || 'null'); if (v && v.token && v.exp > Date.now()) return v; } catch { /* ignore */ }
    }
    return null;
  },
  set(v, remember) {
    session.clear();
    try { (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify({ token: v.token, exp: v.exp, remember: !!remember })); } catch { /* ignore */ }
  },
  clear() { for (const s of [sessionStorage, localStorage]) try { s.removeItem(KEY); } catch { /* ignore */ } },
};

async function call(path, body = {}, token) {
  const r = await fetch(`${API}/${path}`, {
    method: 'POST', cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, ...data };
}

const gate = $('#gate');
const msg = $('#gate-msg');
const form = $('#gate-form');
const say = (text, bad = true) => { msg.textContent = text; msg.className = bad ? 'bad' : 'muted'; };

function errorText(res) {
  if (res.error === 'wrong') return `Wrong password.${res.left != null && res.left <= 3 ? ` ${res.left} more tr${res.left === 1 ? 'y' : 'ies'} before logins pause for a while.` : ''}`;
  if (res.error === 'locked') return `Too many wrong passwords. Try again in ${Math.max(1, Math.ceil((res.retryAfter || 900) / 60))} min.`;
  if (res.error === 'not-set-up') return 'No password is set on the server yet. Set one with: npx wrangler secret put DEV_PASSWORD (in worker/presence), then npx wrangler deploy.';
  if (res.error === 'too-short') return 'The new password needs at least 8 characters.';
  return `The server said no (${res.error || res.status}).`;
}

let unlocked = false;
async function unlock(s) {
  if (unlocked) return;
  unlocked = true;
  gate.remove();
  $('#main').hidden = false;
  addAccountButtons(s);
  await import('./dev.js');
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const password = $('#gate-pw').value;
  const remember = $('#gate-remember').checked;
  if (!password) return;
  const go = $('#gate-go');
  go.disabled = true;
  say('Checking…', false);
  try {
    const res = await call('login', { password, remember });
    if (res.ok) { session.set(res, remember); await unlock(session.get()); return; }
    say(errorText(res));
    $('#gate-pw').select();
  } catch {
    say("Couldn't reach the server. Check the connection and try again.");
  } finally { go.disabled = false; }
});

// Header: Lock (this device) and Password (change it, or sign out everywhere).
function addAccountButtons() {
  const head = $('.dev-head');
  const lock = el('button', { class: 'btn small', type: 'button', title: 'Sign out on this device', onclick: () => { session.clear(); location.reload(); } }, 'Lock');
  const pwBtn = el('button', { class: 'btn small', type: 'button', onclick: () => { box.hidden = !box.hidden; if (!box.hidden) $('#pw-cur').focus(); } }, 'Password');
  head.append(pwBtn, lock);

  const out = el('p', { class: 'muted', role: 'status' });
  const box = el('form', { class: 'dev-card', hidden: true, id: 'pw-box' },
    el('h2', {}, 'Dev page password'),
    el('div', { class: 'row' }, el('label', { for: 'pw-cur' }, 'Current'), el('input', { type: 'password', id: 'pw-cur', autocomplete: 'current-password', class: 'grow' })),
    el('div', { class: 'row' }, el('label', { for: 'pw-new' }, 'New'), el('input', { type: 'password', id: 'pw-new', autocomplete: 'new-password', minlength: '8', class: 'grow' })),
    el('div', { class: 'row' }, el('label', { for: 'pw-new2' }, 'New again'), el('input', { type: 'password', id: 'pw-new2', autocomplete: 'new-password', class: 'grow' })),
    el('div', { class: 'row' },
      el('button', { class: 'btn small primary', type: 'submit' }, 'Change password'),
      el('button', {
        class: 'btn small', type: 'button', title: 'Every device, this one too, has to type the password again',
        onclick: async () => {
          const s = session.get();
          try { await call('logout', {}, s && s.token); } catch { /* signed out here anyway */ }
          session.clear(); location.reload();
        },
      }, 'Sign out everywhere'),
    ),
    el('p', { class: 'muted' }, 'Changing it signs out every other device. Forgot it? Run npx wrangler secret put DEV_PASSWORD in worker/presence: a new secret replaces the password set here.'),
    out);
  box.addEventListener('submit', async e => {
    e.preventDefault();
    const cur = $('#pw-cur').value, next = $('#pw-new').value;
    if (next !== $('#pw-new2').value) { out.textContent = "The new passwords don't match."; out.className = 'bad'; return; }
    if (next.length < 8) { out.textContent = 'Use at least 8 characters.'; out.className = 'bad'; return; }
    const s = session.get();
    try {
      const res = await call('password', { current: cur, next, remember: !!(s && s.remember) }, s && s.token);
      if (res.ok) {
        session.set(res, !!(s && s.remember));
        box.reset();
        out.textContent = 'Password changed. Other devices are signed out.'; out.className = 'ok';
      } else if (res.error === 'signed-out') { session.clear(); location.reload(); }
      else { out.textContent = errorText(res); out.className = 'bad'; }
    } catch { out.textContent = "Couldn't reach the server."; out.className = 'bad'; }
  });
  head.after(box);
}

// Start: a saved session still has to be accepted by the Worker.
(async () => {
  if (!API) { say('CONFIG.devAuthApi is blank, so there is no server to check the password.'); form.hidden = true; return; }
  const s = session.get();
  if (s) {
    say('Checking your session…', false);
    try {
      const res = await call('check', {}, s.token);
      if (res.ok) { await unlock(s); return; }
      session.clear();
      say('Signed out. Type the password again.', false);
    } catch {
      say("Couldn't reach the server to check your session. Reload to try again.");
      return;
    }
  } else say('', false);
  form.hidden = false;
  $('#gate-pw').focus();
})();
