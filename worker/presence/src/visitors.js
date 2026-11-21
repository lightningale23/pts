// Who's on pts right now, for the dev page's Online tab (POST /dev/online, signed in only).
// Each open copy of the site holds one WebSocket; when it connects, the Worker notes its IP
// address, Cloudflare's rough location for that IP, and a short browser/device label, and keeps
// them on that socket only. Nothing is written to storage or logged: when the tab closes, the
// socket and what was noted about it are gone.

// Headers the outer Worker sets on the request it hands the Durable Object. Any a visitor sends
// themselves are overwritten, so they can't fake another IP.
export const VISITOR_HEADERS = {
  ip: 'x-pts-ip', country: 'x-pts-country', region: 'x-pts-region', city: 'x-pts-city',
};

// The outer Worker: copies the visitor's IP (CF-Connecting-IP) and Cloudflare's location onto
// the request for the Durable Object.
export function tagRequest(request) {
  const headers = new Headers(request.headers);
  const cf = request.cf || {};
  headers.set(VISITOR_HEADERS.ip, request.headers.get('cf-connecting-ip') || '');
  headers.set(VISITOR_HEADERS.country, String(cf.country || ''));
  headers.set(VISITOR_HEADERS.region, String(cf.region || ''));
  headers.set(VISITOR_HEADERS.city, String(cf.city || ''));
  return new Request(request, { headers });
}

// "Chrome on Windows", "Safari on iPhone", ...
export function describeUA(ua) {
  ua = String(ua || '');
  if (!ua) return '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'Chromebook' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [browser, os].filter(Boolean).join(' on ') || ua.slice(0, 60);
}

// The Durable Object: what to keep on a new socket (a WebSocket attachment, at most 2 KB).
export function visitorFrom(request, now = Date.now()) {
  const h = k => String(request.headers.get(VISITOR_HEADERS[k]) || '').slice(0, 80);
  return {
    ip: h('ip'), country: h('country'), region: h('region'), city: h('city'),
    device: describeUA(request.headers.get('user-agent')).slice(0, 80),
    since: now,
  };
}

// The list the dev page gets: one entry per IP, its tabs grouped, longest-connected first.
export function summarize(visitors, now = Date.now()) {
  const byIp = new Map();
  for (const raw of visitors) {
    const v = raw || {};            // a socket from before the Worker noted anything
    const key = v.ip || '(unknown)';
    const g = byIp.get(key) || { ip: v.ip || '', country: v.country || '', region: v.region || '', city: v.city || '', tabs: 0, devices: [], since: v.since || now };
    g.tabs++;
    if (v.device && !g.devices.includes(v.device)) g.devices.push(v.device);
    g.since = Math.min(g.since, v.since || now);
    byIp.set(key, g);
  }
  const list = [...byIp.values()].sort((a, b) => a.since - b.since);
  return { online: visitors.length, people: list.length, visitors: list, at: now };
}
