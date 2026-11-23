export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter(f => f !== fn); }
  emit(ev, data) {
    for (const fn of this._h[ev] || []) fn(data);
    for (const fn of this._h['*'] || []) fn(ev, data);
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Short stable hash (FNV-1a, base36) used for question IDs.
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const hasLS = (() => { try { return typeof localStorage !== 'undefined'; } catch { return false; } })();

export const store = {
  get(key, fallback) {
    if (!hasLS) return fallback;
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    if (!hasLS) return false;
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove(key) { if (hasLS) try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

export function pct(n, d) { return d ? Math.round((100 * n) / d) : 0; }

export function randomCode(len = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

// Sliders that are easy to grab: the whole slider takes the pointer, not just its small round head
// (the inputs themselves get no pointer events; CSS). A click, or a tap on a touch screen, moves the
// head there; a drag anywhere moves it. With two inputs on one track (a range), the nearer head moves.
// On touch screens a drag only starts once it goes sideways, so a vertical swipe still scrolls the page.
// Fires the inputs' own 'input' events while moving and 'change' at the end; keys work as usual.
// --thumb on the area is the head's width (the head's centre stops half of it from each end).
export function grabSlider(area, inputs) {
  const fill = input => {
    const f = (+input.value - +input.min) / ((+input.max - +input.min) || 1);
    input.style.setProperty('--fill', `${(f * 100).toFixed(2)}%`);
  };
  const valueAt = (input, x) => {
    const r = input.getBoundingClientRect();
    const thumb = parseFloat(getComputedStyle(area).getPropertyValue('--thumb')) || 0;
    const f = Math.min(1, Math.max(0, (x - r.left - thumb / 2) / Math.max(1, r.width - thumb)));
    const min = +input.min, max = +input.max, step = +input.step || 1;
    return Math.min(max, Math.max(min, +(min + Math.round((f * (max - min)) / step) * step).toFixed(6)));
  };
  // two heads: the one nearer the pointer; when they sit together, the one on the side it went
  const nearest = x => {
    const live = inputs.filter(i => !i.disabled);
    if (live.length < 2) return live[0];
    const [a, b] = live, va = valueAt(a, x);
    const da = Math.abs(va - +a.value), db = Math.abs(va - +b.value);
    if (da !== db) return da < db ? a : b;
    return va < +a.value ? (+a.value <= +b.value ? a : b) : (+a.value <= +b.value ? b : a);
  };
  const set = (input, v) => {
    if (+input.value === v) return;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  for (const i of inputs) { fill(i); i.addEventListener('input', () => fill(i)); }
  area.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const input = nearest(e.clientX);
    if (!input) return;
    const touch = e.pointerType === 'touch';
    const x0 = e.clientX, y0 = e.clientY, start = input.value;
    let dragging = !touch;
    if (!touch) e.preventDefault();   // no text selection while dragging with a mouse
    input.focus({ preventScroll: true, focusVisible: false });   // arrow keys work after; no ring for a click
    if (!touch) set(input, valueAt(input, e.clientX));
    try { area.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const move = ev => {
      if (!dragging) {
        const dx = Math.abs(ev.clientX - x0), dy = Math.abs(ev.clientY - y0);
        if (dx < 6 || dy > dx) return;
        dragging = true;
      }
      set(input, valueAt(input, ev.clientX));
    };
    const end = ev => {
      area.removeEventListener('pointermove', move);
      area.removeEventListener('pointerup', end);
      area.removeEventListener('pointercancel', end);
      if (ev.type === 'pointerup' && !dragging) set(input, valueAt(input, ev.clientX));   // a tap
      if (input.value !== start) input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
  });
}
