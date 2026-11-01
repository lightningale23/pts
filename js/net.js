import { CONFIG } from './config.js';
import { Emitter, randomCode } from './util.js';

// Multiplayer rooms over WebRTC. The host's browser runs the GameEngine and is
// the single source of truth; players send actions (buzz, answer, chat) and get
// every engine event back. This keeps GitHub Pages fully static: the only
// outside service is the free PeerJS broker that introduces browsers to each other.

const PEERJS_SRC = 'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js';

let peerLib = null;
async function getPeerClass() {
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

const peerOptions = () => ({ debug: 0, ...(CONFIG.peerOptions || {}) });

// ── Host ─────────────────────────────────────────────────────────────────
export class RoomHost extends Emitter {
  constructor(engine) {
    super();
    this.engine = engine;
    this.conns = new Set();
    this.summary = [];
    engine.on('*', (ev, data) => this.broadcast({ t: 'ev', ev, data }));
  }

  async open() {
    const Peer = await getPeerClass();
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = randomCode(5);
      try {
        this.peer = await new Promise((resolve, reject) => {
          const p = new Peer(CONFIG.peerPrefix + code, peerOptions());
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
    if (msg.t === 'ping') { try { conn.send({ t: 'pong', ts: msg.ts }); } catch { /* closed */ } return; }
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
      case 'buzz': e.buzz(pid); break;
      case 'answer': e.submit(pid, String(msg.text ?? '')); break;
      case 'live': e.live(pid, String(msg.text ?? '')); break;
      case 'chat': e.chat(pid, msg.text); break;
      case 'next': if (['revealed', 'idle', 'empty'].includes(e.phase)) e.next(); break;
      case 'team': if (e.settings.teams) e.updatePlayer(pid, { team: ['A', 'B'].includes(msg.team) ? msg.team : '' }); break;
      case 'name': e.updatePlayer(pid, { name: msg.name }); break;
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
  async join(code, name, pid) {
    const Peer = await getPeerClass();
    this.code = code.toUpperCase();
    this.peer = await new Promise((resolve, reject) => {
      const p = new Peer(undefined, peerOptions());
      p.on('open', () => resolve(p));
      p.on('error', err => reject(friendly(err)));
    });
    await new Promise((resolve, reject) => {
      let settled = false;
      const conn = this.peer.connect(CONFIG.peerPrefix + this.code, { reliable: true });
      this.conn = conn;
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error(`No room found with code ${this.code}.`)); } }, 12000);
      this.peer.on('error', err => {
        if (!settled) { settled = true; clearTimeout(timer); reject(friendly(err, this.code)); }
        else this.emit('error', friendly(err, this.code));
      });
      conn.on('open', () => conn.send({ t: 'join', name, pid }));
      conn.on('data', msg => {
        if (msg?.t === 'ping') { this.send({ t: 'pong', ts: msg.ts }); return; }
        if (msg?.t === 'pong') {
          this.waitingSince = 0;
          this.emit('ping', { rtt: Math.round(performance.now() - msg.ts) });
          return;
        }
        if (msg?.t === 'welcome' && !settled) { settled = true; clearTimeout(timer); resolve(); this.startPinging(); }
        this.emit('msg', msg);
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
  }

  send(msg) { try { this.conn?.open && this.conn.send(msg); } catch { /* dropped */ } }

  leave() {
    clearInterval(this.pingTimer);
    if (this.onVisible) document.removeEventListener('visibilitychange', this.onVisible);
    try { this.conn?.close(); this.peer?.destroy(); } catch { /* ignore */ }
  }
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
