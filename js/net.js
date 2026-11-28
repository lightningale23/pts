import { CONFIG } from './config.js';
import { Emitter, randomCode } from './util.js';
import { maskTokens } from './text.js';

// Multiplayer rooms over WebRTC. The host's browser runs the GameEngine and is
// the single source of truth; players send actions (buzz, answer, chat) and get
// every engine event back. This keeps GitHub Pages fully static: the only
// outside service is the free PeerJS broker that introduces browsers to each other.

const PEERJS_SRC = 'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js';

let peerLib = null;
export async function getPeerClass() {
  if (new URLSearchParams(location.search).get('net') === 'local') return LocalPeer; // same-device testing
  if (window.Peer) return window.Peer;
  peerLib ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEERJS_SRC;
    s.onload = () => resolve(window.Peer);
    s.onerror = () => reject(new Error('Could not load the multiplayer library. Check your connection or ad blocker.'));
    document.head.append(s);
  });
  return peerLib;
}

// ── Connection servers ───────────────────────────────────────────────────
// Browsers connect to each other directly when they can (STUN finds a route). Networks that
// block that (school Wi-Fi, VPNs like Cloudflare WARP, managed Chromebooks) need a relay:
// a TURN server, best one reachable on port 443 over TCP/TLS, which looks like web traffic.
// PeerJS's own free TURN servers (port 3478) are tried too, but are often blocked or busy.
export const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];
const ICE_CACHE = 'pts.iceServers.v1';
let icePromise = null;
// CONFIG.iceServers (fixed entries) + CONFIG.iceServersUrl (a URL that returns a list of ICE
// servers as JSON, like Metered's TURN credentials API), fetched once and kept for an hour.
export function iceServers({ fresh = false } = {}) {
  if (icePromise && !fresh) return icePromise;
  icePromise = (async () => {
    let fetched = [];
    if (CONFIG.iceServersUrl) {
      try {
        const c = !fresh && JSON.parse(sessionStorage.getItem(ICE_CACHE) || 'null');
        if (c && c.url === CONFIG.iceServersUrl && Date.now() - c.at < 3600e3) fetched = c.list;
        else {
          const r = await fetch(CONFIG.iceServersUrl, { cache: 'no-store', signal: AbortSignal.timeout?.(6000) });
          const j = r.ok ? await r.json() : [];
          fetched = Array.isArray(j) ? j : (j.iceServers || []);
          try { sessionStorage.setItem(ICE_CACHE, JSON.stringify({ url: CONFIG.iceServersUrl, at: Date.now(), list: fetched })); } catch { /* ignore */ }
        }
      } catch { fetched = []; }
    }
    const own = [...(CONFIG.iceServers || []), ...fetched];
    // With a relay of the site's own, PeerJS's busy TURN servers only slow the search down.
    return [...own, ...(hasRelay(own) ? DEFAULT_ICE.slice(0, 1) : DEFAULT_ICE)];
  })();
  return icePromise;
}
const hasRelay = list => list.some(s => [].concat(s.urls || s.url || []).some(u => /^turns?:/.test(u) && !/peerjs\.com/.test(u)));

async function peerOptions() {
  const opts = { debug: 0, ...(CONFIG.peerOptions || {}) };
  if (!opts.config) opts.config = { iceServers: await iceServers() };
  return opts;
}

// ── A clock shared with the host ─────────────────────────────────────────
// Read aloud, every device speaks the question itself, and the host says when (its own
// performance.now()). A player learns how far its clock is from the host's from the pings it
// sends every 2 s: the host answers with its time, which was read about halfway through the
// round trip. The fastest round trip of the last ones is the most exact (least time to be
// uneven), and recent ones only, as two devices' clocks drift apart by up to a few ms a minute.
export class ClockSync {
  constructor(keep = 15) { this.keep = keep; this.samples = []; }
  // sent: this device's time the ping left; hostNow: the host's time in its answer; got: arrival.
  add(sent, hostNow, got) {
    const rtt = got - sent;
    if (!(rtt >= 0) || !Number.isFinite(hostNow)) return;
    this.samples.push({ rtt, offset: hostNow - (sent + got) / 2 });
    if (this.samples.length > this.keep) this.samples.shift();
  }
  get ready() { return this.samples.length > 0; }
  best() { return this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a), this.samples[0]); }
  // host time → this device's time (null until a ping has come back)
  toLocal(t) { return this.ready && Number.isFinite(t) ? t - this.best().offset : null; }
}

// How far ahead the host starts the voices: enough for its message to reach the slowest player
// (half its round trip) and that device's voice to get going, but never a long wait.
export function speechLead(rtts) {
  const known = rtts.filter(r => Number.isFinite(r));
  if (!known.length) return 0;
  return Math.round(Math.min(900, Math.max(300, Math.max(...known) / 2 + 250)));
}

// Times in engine events that are on the host's clock (players turn them into their own).
const HOST_TIMES = { question: ['speakAt'], resume: ['speakAt'], resumed: ['speakAt'], said: ['start'] };
export function toLocalTimes(ev, data, clock) {
  const keys = HOST_TIMES[ev];
  if (!keys || !data) return data;
  const out = { ...data };
  for (const k of keys) {
    if (!(k in out)) continue;
    const t = clock.toLocal(out[k]);
    if (t == null) delete out[k]; else out[k] = t;
  }
  return out;
}

// ── Host ─────────────────────────────────────────────────────────────────
export class RoomHost extends Emitter {
  constructor(engine) {
    super();
    this.engine = engine;
    this.conns = new Set();
    this.summary = [];
    // players get the question's shape with its words masked, so it can't be read early
    engine.on('*', (ev, data) => this.broadcast({ t: 'ev', ev, data: ev === 'question' && data.layout ? { ...data, layout: maskTokens(data.layout) } : data }));
    // read aloud, the voices start a moment ahead so every player's device starts with the host's
    engine.speechLead = () => speechLead(this.live().map(c => c.rtt));
    engine.speechGap = () => Math.max(0, ...this.live().map(c => c.lag).filter(Number.isFinite));
  }

  // players that are connected and answering pings
  live() { return [...this.conns].filter(c => c.pid && !(c.waitingSince && performance.now() - c.waitingSince > 8000)); }

  async open() {
    const Peer = await getPeerClass();
    const opts = await peerOptions();
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = randomCode(5);
      try {
        this.peer = await new Promise((resolve, reject) => {
          const p = new Peer(CONFIG.peerPrefix + code, opts);
          p.on('open', () => resolve(p));
          p.on('error', err => reject(err));
        });
        this.code = code;
        break;
      } catch (err) {
        if (err?.type !== 'unavailable-id') throw friendly(err);
      }
    }
    if (!this.peer) throw new Error('Could not create a room. Try again.');
    this.peer.off?.('error');
    this.peer.on('error', err => this.emit('error', friendly(err)));
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch { /* ignore */ } });
    this.peer.on('connection', conn => this.accept(conn));
    // Ping every player every 2 s; the host's badge shows the slowest connection.
    this.pingTimer = setInterval(() => this.pingAll(), 2000);
    // Background tabs run timers late; ping right away when the tab is shown again.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.pingAll(); });
    return this.code;
  }

  accept(conn) {
    conn.on('open', () => this.conns.add(conn));
    conn.on('data', msg => this.onMessage(conn, msg));
    conn.on('close', () => {
      this.conns.delete(conn);
      if (conn.pid) {
        const name = this.engine.players.get(conn.pid)?.name;
        this.engine.removePlayer(conn.pid);
        this.system(`${name || 'A player'} left.`);
      }
    });
  }

  onMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'ping') { try { conn.send({ t: 'pong', ts: msg.ts, now: performance.now() }); } catch { /* closed */ } return; }
    if (msg.t === 'pong') { conn.rtt = Math.round(performance.now() - msg.ts); conn.waitingSince = 0; this.reportPing(); return; }
    const e = this.engine;
    if (msg.t === 'join') {
      const pid = String(msg.pid || '').slice(0, 40);
      if (!pid) return;
      conn.pid = pid;
      for (const old of this.conns) {
        if (old !== conn && old.pid === pid) { old.pid = null; this.conns.delete(old); try { old.close(); } catch { /* gone */ } }
      }
      const name = String(msg.name || 'Player').trim().slice(0, 24) || 'Player';
      const wasThere = e.players.has(pid);
      e.addPlayer(pid, name, e.players.get(pid)?.team || '');
      conn.send({ t: 'welcome', snapshot: e.snapshot(), summary: this.summary, teams: !!e.settings.teams, code: this.code });
      this.system(`${name} ${wasThere ? 'rejoined' : 'joined'}.`);
      return;
    }
    const pid = conn.pid;
    if (!pid) return;
    switch (msg.t) {
      case 'buzz': e.buzz(pid, Number.isFinite(msg.at) ? msg.at : undefined); break;
      case 'answer': e.submit(pid, String(msg.text ?? '')); break;
      case 'live': e.live(pid, String(msg.text ?? '')); break;
      case 'chat': e.chat(pid, msg.text); break;
      case 'next': if (['revealed', 'idle', 'empty'].includes(e.phase)) e.next(); break;
      case 'team': if (e.settings.teams) e.updatePlayer(pid, { team: ['A', 'B'].includes(msg.team) ? msg.team : '' }); break;
      case 'name': e.updatePlayer(pid, { name: msg.name }); break;
      // how long this player's voice takes to start (read aloud; see speakQuestion in js/speech.js)
      case 'lag': if (Number.isFinite(msg.ms)) conn.lag = Math.max(0, Math.min(1000, msg.ms)); break;
    }
  }

  pingAll() {
    const now = performance.now();
    for (const c of this.conns) {
      if (!c.pid) continue;
      if (!c.waitingSince) c.waitingSince = now;
      try { c.send({ t: 'ping', ts: now }); } catch { /* closed */ }
    }
    this.reportPing();
  }

  // A player counts as lost only after a ping has gone unanswered for 8 s.
  reportPing() {
    const now = performance.now();
    const players = [...this.conns].filter(c => c.pid).map(c => ({
      name: this.engine.players.get(c.pid)?.name || '?',
      rtt: c.waitingSince && now - c.waitingSince > 8000 ? null : (c.rtt ?? undefined),
    }));
    this.emit('ping', { players });
  }

  setSummary(lines) {
    this.summary = lines;
    this.broadcast({ t: 'room', summary: lines, teams: !!this.engine.settings.teams });
  }

  system(text) {
    this.broadcast({ t: 'sys', text });
    this.emit('sys', text);
  }

  broadcast(msg) {
    for (const c of this.conns) { try { c.send(msg); } catch { /* dropped */ } }
  }

  close() {
    clearInterval(this.pingTimer);
    this.broadcast({ t: 'closed' });
    setTimeout(() => { try { this.peer?.destroy(); } catch { /* ignore */ } }, 150);
  }
}

// ── Player ───────────────────────────────────────────────────────────────
export class RoomClient extends Emitter {
  constructor() { super(); this.clock = new ClockSync(); }

  async join(code, name, pid) {
    const Peer = await getPeerClass();
    this.code = code.toUpperCase();
    const opts = await peerOptions();
    this.peer = await new Promise((resolve, reject) => {
      const p = new Peer(undefined, opts);
      p.on('open', () => resolve(p));
      p.on('error', err => reject(friendly(err)));
    });
    await new Promise((resolve, reject) => {
      let settled = false;
      const conn = this.peer.connect(CONFIG.peerPrefix + this.code, { reliable: true });
      this.conn = conn;
      // The room service answers "no such room" (peer-unavailable) quickly. A room that exists
      // but never connects means this network blocked the connection between the devices.
      const blocked = () => new Error(blockedMessage(this.code, opts.config?.iceServers || []));
      const fail = err => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } };
      const timer = setTimeout(() => fail(blocked()), 20000);
      this.peer.on('error', err => {
        if (!settled) fail(friendly(err, this.code));
        else this.emit('error', friendly(err, this.code));
      });
      conn.on('error', err => { if (err?.type === 'negotiation-failed') fail(blocked()); });
      conn.on('open', () => conn.send({ t: 'join', name, pid }));
      conn.on('data', msg => {
        if (msg?.t === 'ping') { this.send({ t: 'pong', ts: msg.ts }); return; }
        if (msg?.t === 'pong') {
          this.clock.add(msg.ts, msg.now, performance.now());
          this.waitingSince = 0;
          this.emit('ping', { rtt: Math.round(performance.now() - msg.ts) });
          return;
        }
        if (msg?.t === 'welcome' && !settled) { settled = true; clearTimeout(timer); resolve(); this.startPinging(); }
        this.emit('msg', msg?.t === 'ev' ? { ...msg, data: toLocalTimes(msg.ev, msg.data, this.clock) } : msg);
      });
      conn.on('close', () => { clearInterval(this.pingTimer); this.emit('closed'); });
    });
  }

  // Round trip to the host every 2 s. It only counts as lost when a ping has gone
  // unanswered for 8 s, so a background tab whose timers run late isn't misreported.
  startPinging() {
    const ping = () => {
      const now = performance.now();
      if (this.waitingSince && now - this.waitingSince > 8000) this.emit('ping', { rtt: null });
      if (!this.waitingSince) this.waitingSince = now;
      this.send({ t: 'ping', ts: now });
    };
    this.pingTimer = setInterval(ping, 2000);
    this.onVisible = () => { if (!document.hidden) { this.waitingSince = 0; ping(); } };
    document.addEventListener('visibilitychange', this.onVisible);
    ping();
    // a few quick ones at the start, so the clock is right from the first question
    for (const ms of [150, 300, 450, 600, 900]) setTimeout(() => this.send({ t: 'ping', ts: performance.now() }), ms);
  }

  send(msg) { try { this.conn?.open && this.conn.send(msg); } catch { /* dropped */ } }

  leave() {
    clearInterval(this.pingTimer);
    if (this.onVisible) document.removeEventListener('visibilitychange', this.onVisible);
    try { this.conn?.close(); this.peer?.destroy(); } catch { /* ignore */ }
  }
}

function blockedMessage(code, servers) {
  return `Room ${code} exists, but this device couldn't connect to the host. The network is blocking direct connections between devices (common on school Wi-Fi, with VPNs like Cloudflare WARP, and on managed Chromebooks). `
    + (hasRelay(servers)
      ? 'The relay server couldn\'t get through either: check that both devices are online, or try another network.'
      : 'Rooms on networks like this need a relay (TURN) server; the site owner can add one (see "Rooms" in Help).');
}

function friendly(err, code) {
  const type = err?.type;
  if (type === 'peer-unavailable') return new Error(`No room found with code ${code || ''}. Check the code with the host.`);
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return new Error('Could not reach the room service. Check your internet connection and try again.');
  if (type === 'browser-incompatible') return new Error('This browser does not support rooms. Try a current Chrome, Edge, Firefox or Safari.');
  return err instanceof Error ? err : new Error(String(err?.message || err));
}

// ── Same-device transport for testing (open with ?net=local in several tabs) ──
class LocalPeer {
  constructor(id) {
    this.id = id || `p-${Math.random().toString(36).slice(2, 10)}`;
    this.h = {};
    this.conns = new Map();
    this.ch = new BroadcastChannel('lockout-local-net');
    this.ch.onmessage = e => this.onMsg(e.data);
    setTimeout(() => this.fire('open', this.id), 10);
  }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); }
  off(ev) { delete this.h[ev]; }
  fire(ev, ...a) { (this.h[ev] || []).forEach(f => f(...a)); }
  connect(to) {
    const cid = Math.random().toString(36).slice(2);
    const c = new LocalConn(this, to, cid);
    this.conns.set(cid, c);
    this.ch.postMessage({ k: 'hello', from: this.id, to, cid });
    c.timer = setTimeout(() => { if (!c.open) this.fire('error', { type: 'peer-unavailable' }); }, 1500);
    return c;
  }
  onMsg(m) {
    if (m.to !== this.id) return;
    if (m.k === 'hello') {
      const c = new LocalConn(this, m.from, m.cid);
      this.conns.set(m.cid, c);
      this.fire('connection', c);
      this.ch.postMessage({ k: 'ack', from: this.id, to: m.from, cid: m.cid });
      setTimeout(() => c.ready(), 0);
    } else if (m.k === 'ack') this.conns.get(m.cid)?.ready();
    else if (m.k === 'data') this.conns.get(m.cid)?.fire('data', m.data);
    else if (m.k === 'close') { const c = this.conns.get(m.cid); if (c) { c.open = false; c.fire('close'); } }
  }
  reconnect() {}
  destroy() {
    for (const c of this.conns.values()) c.close();
    setTimeout(() => this.ch.close(), 50);
  }
}

class LocalConn {
  constructor(peer, remote, cid) { Object.assign(this, { peer, remote, cid, h: {}, open: false }); }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); }
  fire(ev, ...a) { (this.h[ev] || []).forEach(f => f(...a)); }
  ready() { if (this.open) return; clearTimeout(this.timer); this.open = true; this.fire('open'); }
  send(data) { this.peer.ch.postMessage({ k: 'data', from: this.peer.id, to: this.remote, cid: this.cid, data: JSON.parse(JSON.stringify(data)) }); }
  close() { if (!this.open) return; this.open = false; this.peer.ch.postMessage({ k: 'close', from: this.peer.id, to: this.remote, cid: this.cid }); this.fire('close'); }
}
