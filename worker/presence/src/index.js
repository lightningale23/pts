// pts presence: one Durable Object holds a WebSocket from every open copy of the site and
// tells them all how many people that is (tabs from one IP count once) whenever it changes.
//   wss://<worker>/online     the site's connection (gets {"online": N} messages)
//   https://<worker>/online   the count once, as JSON
//   POST https://<worker>/report   a question report from the site → a GitHub issue (see report.js)
//   POST https://<worker>/dev/...  the dev page's password and sessions (see devauth.js)
//   POST https://<worker>/dev/online  (signed in) who is connected: IP, rough location, browser
//                                     (see visitors.js; kept only on the open socket, never stored)
// Connections use the hibernation API, so an idle connection costs nothing; the site's
// keep-alive "ping" is answered by Cloudflare without waking the object.
import { DurableObject } from 'cloudflare:workers';
import { handleReport, corsHeaders } from './report.js';
import { DevAuth } from './devauth.js';
import { tagRequest, visitorFrom, summarize, countPeople } from './visitors.js';

const json = (body, origin) => new Response(JSON.stringify(body), {
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': origin || '*', 'cache-control': 'no-store' },
});

export class Presence extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  visitors(except) {
    return this.ctx.getWebSockets().filter(ws => ws !== except)
      .map(ws => { try { return ws.deserializeAttachment(); } catch { return null; } });
  }

  // People, not tabs: several tabs from one IP count once (countPeople in visitors.js).
  count(except) { return countPeople(this.visitors(except)); }

  // Tell every tab the count, but only when it changed; `only` (a new tab) is told either way.
  broadcast({ except, before, only } = {}) {
    const n = this.count(except);
    const msg = JSON.stringify({ online: n });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || (n === before && ws !== only)) continue;
      try { ws.send(msg); } catch { /* closing */ }
    }
  }

  // Site-wide limit on reports, so a stuck button or a flood can't fill the issue list.
  // Keeps only the times of recent reports (nothing about who sent them).
  async allowReport() {
    const now = Date.now();
    const times = ((await this.ctx.storage.get('reportTimes')) || []).filter(t => now - t < 86400e3);
    const lastHour = times.filter(t => now - t < 3600e3).length;
    if (lastHour >= 40 || times.length >= 200) return false;
    times.push(now);
    await this.ctx.storage.put('reportTimes', times);
    return true;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/dev/online') return this.devOnline(request);
    if (path.startsWith('/dev/')) {
      const [status, body] = await new DevAuth(this.ctx.storage, this.env).handle(request);
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }
    if (path === '/report-allow') return new Response(JSON.stringify({ ok: await this.allowReport() }));
    if (request.headers.get('Upgrade') !== 'websocket') return json({ online: this.count() }, request.headers.get('Origin'));
    const before = this.count();
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment(visitorFrom(request));
    this.broadcast({ before, only: pair[1] });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // The dev page's Online tab: who is connected right now (signed-in sessions only).
  async devOnline(request) {
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (request.method !== 'POST') return reply(405, { ok: false, error: 'POST' });
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!(await new DevAuth(this.ctx.storage, this.env).verify(token))) return reply(401, { ok: false, error: 'signed-out' });
    return reply(200, { ok: true, ...summarize(this.visitors()) });
  }

  async webSocketMessage(ws, message) {
    if (message === 'count') ws.send(JSON.stringify({ online: this.count() }));
  }

  // A tab left: the count before counts it whether or not getWebSockets() still lists it.
  left(ws) {
    let mine = null;
    try { mine = ws.deserializeAttachment(); } catch { /* none */ }
    this.broadcast({ except: ws, before: countPeople([...this.visitors(ws), mine]) });
  }

  async webSocketClose(ws) { this.left(ws); }
  async webSocketError(ws) { this.left(ws); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const dev = /^\/dev\/(login|check|password|logout|online)$/.test(url.pathname);
    if (url.pathname !== '/online' && url.pathname !== '/report' && !dev) return new Response('pts presence\n', { status: 404 });
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    // (local testing from http://localhost is always allowed)
    if (allowed.length && origin && !allowed.includes(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return new Response('origin not allowed\n', { status: 403 });
    }
    const site = env.PRESENCE.get(env.PRESENCE.idFromName('site'));
    if (dev) {
      const cors = { ...corsHeaders(origin), 'access-control-allow-headers': 'content-type, authorization' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const res = await site.fetch(request);
      return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    }
    if (url.pathname === '/report') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
      return handleReport(request, env, origin, async () => (await (await site.fetch('https://do/report-allow')).json()).ok);
    }
    return site.fetch(request.headers.get('Upgrade') === 'websocket' ? tagRequest(request) : request);
  },
};
