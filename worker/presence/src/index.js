// pts presence: one Durable Object holds a WebSocket from every open copy of the site and
// tells them all how many there are whenever someone arrives or leaves.
//   wss://<worker>/online     the site's connection (gets {"online": N} messages)
//   https://<worker>/online   the count once, as JSON
// Connections use the hibernation API, so an idle connection costs nothing; the site's
// keep-alive "ping" is answered by Cloudflare without waking the object.
import { DurableObject } from 'cloudflare:workers';

const json = (body, origin) => new Response(JSON.stringify(body), {
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': origin || '*', 'cache-control': 'no-store' },
});

export class Presence extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  count(except) { return this.ctx.getWebSockets().filter(ws => ws !== except).length; }

  broadcast(except) {
    const msg = JSON.stringify({ online: this.count(except) });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(msg); } catch { /* closing */ }
    }
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return json({ online: this.count() }, request.headers.get('Origin'));
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    this.broadcast();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, message) {
    if (message === 'count') ws.send(JSON.stringify({ online: this.count() }));
  }

  async webSocketClose(ws) { this.broadcast(ws); }
  async webSocketError(ws) { this.broadcast(ws); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/online') return new Response('pts presence\n', { status: 404 });
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    // (local testing from http://localhost is always allowed)
    if (allowed.length && origin && !allowed.includes(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return new Response('origin not allowed\n', { status: 403 });
    }
    return env.PRESENCE.get(env.PRESENCE.idFromName('site')).fetch(request);
  },
};
