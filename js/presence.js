// The "online" badge in the top bar: how many people have pts open right now.
// It needs the small presence Worker in worker/presence (CONFIG.presenceUrl); without it,
// or if it can't be reached, the badge stays hidden.
import { CONFIG } from './config.js';

const KEEPALIVE_MS = 30000;          // answered by Cloudflare without waking the Worker
const IDLE_CLOSE_MS = 5 * 60000;     // a tab left in the background stops counting after 5 minutes

export function startPresence(badge) {
  const url = CONFIG.presenceUrl;
  if (!badge || !url || typeof WebSocket === 'undefined') return;
  const num = badge.querySelector('.online-n');
  let ws = null, retry = 0, keep = null, idleTimer = null, reconnectTimer = null;

  const show = n => {
    num.textContent = String(n);
    badge.title = `${n} ${n === 1 ? 'person' : 'people'} on pts right now (you included)`;
    badge.setAttribute('aria-label', badge.title);
    badge.hidden = false;
  };

  const connect = () => {
    clearTimeout(reconnectTimer);
    if (ws || document.hidden) return;
    try { ws = new WebSocket(url); } catch { return; }
    ws.onopen = () => {
      retry = 0;
      keep = setInterval(() => { try { ws?.send('ping'); } catch { /* closed */ } }, KEEPALIVE_MS);
    };
    ws.onmessage = e => {
      try { const m = JSON.parse(e.data); if (Number.isFinite(m.online)) show(m.online); } catch { /* "pong" */ }
    };
    ws.onclose = () => {
      clearInterval(keep);
      ws = null;
      badge.hidden = true;
      if (document.hidden) return;
      // try again, waiting longer each time (up to 2 minutes)
      retry++;
      reconnectTimer = setTimeout(connect, Math.min(120000, 2000 * 2 ** Math.min(retry, 6)));
    };
  };
  const close = () => { try { ws?.close(); } catch { /* ignore */ } };

  document.addEventListener('visibilitychange', () => {
    clearTimeout(idleTimer);
    if (document.hidden) idleTimer = setTimeout(close, IDLE_CLOSE_MS);
    else { retry = 0; connect(); }
  });
  addEventListener('pagehide', close);
  connect();
}
