import { Emitter, store } from './util.js';

// Bookmarked questions, saved in this browser. Each keeps a copy of the question so
// it still shows even if the question bank changes or it came from a room.
const KEY = 'pts.bookmarks.v1';

class BookmarkStore extends Emitter {
  constructor() {
    super();
    this.map = new Map((store.get(KEY, []) || []).map(b => [b.qid, b]));
  }
  save() { store.set(KEY, [...this.map.values()]); this.emit('change', this.map.size); }
  has(qid) { return this.map.has(qid); }
  ids() { return new Set(this.map.keys()); }
  list() { return [...this.map.values()].sort((a, b) => b.ts - a.ts); }
  get size() { return this.map.size; }

  add(qid, q) {
    if (!qid) return;
    this.map.set(qid, { qid, ts: Date.now(), q: q ? snapshot(q) : this.map.get(qid)?.q || null });
    this.save();
  }
  remove(qid) { if (this.map.delete(qid)) this.save(); }
  toggle(qid, q) { if (this.has(qid)) this.remove(qid); else this.add(qid, q); return this.has(qid); }

  // Fill in the question text later (a room player only sees it once it's read out).
  update(qid, q) {
    const b = this.map.get(qid);
    if (b && q && !b.q?.question) { b.q = snapshot(q); this.save(); }
  }
  clear() { this.map.clear(); this.save(); }
}

function snapshot(q) {
  const { id, set, round, num, type, subject, format, question, choices, answer, answerLetter, answerText, accept, level } = q;
  return { id, set, round, num, type, subject, format, question, choices, answer, answerLetter, answerText, accept, level };
}

export const Bookmarks = new BookmarkStore();
