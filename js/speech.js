// Reads questions aloud with the browser's built-in voices (Web Speech API), for listen
// mode: the question is only heard, like a real round, and its text appears afterwards.
//
// The question is spoken a sentence at a time at a fixed rate (the Voice speed setting).
// The browser reports which word it's on ('boundary' events) where it can; elsewhere the
// position is estimated from the time spent in the sentence. The position decides where
// a buzz lands in the question, and where reading picks up after a wrong answer.
//
// Browser quirks handled here:
//  - Chrome drops the 'end' event of an utterance nobody holds a reference to (kept in `keep`).
//  - Chrome's online voices stop silently partway through long utterances (~15 s) and refuse
//    rates above 2: utterances are a sentence (a long one cut where a reader would breathe, about
//    10.5 s of speech at most: maxWords) and rates stay at or below 2.
//  - An utterance can hang without ever ending: a watchdog moves on after a generous timeout.
//  - Boundary events don't fire on Android or with some online voices: time-based estimate.
//  - iOS Safari only speaks after a tap or key press: the first one primes the engine.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
export const ttsSupported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined';

let voicesCache = [];
function loadVoices() {
  if (!ttsSupported) return [];
  const all = synth.getVoices();
  if (all.length) voicesCache = all.filter(v => /^en/i.test(v.lang));
  return voicesCache;
}
if (ttsSupported) {
  loadVoices();
  if (synth.addEventListener) synth.addEventListener('voiceschanged', loadVoices);
  else synth.onvoiceschanged = loadVoices; // Safari
}

export function englishVoices() { return loadVoices(); }

// The chosen voice, or one installed on the device: online voices (Google's in Chrome)
// take a moment to start each sentence.
function pickVoice(voiceURI) {
  const vs = loadVoices();
  return vs.find(v => v.voiceURI === voiceURI)
    || vs.find(v => v.default && v.localService)
    || vs.find(v => v.localService && /^en[-_]US/i.test(v.lang))
    || vs.find(v => v.localService)
    || null;
}

// Rooms: the host picks one voice for everyone, so the question is read at the same pace on
// every device. Voices belong to the device and browser, so each player's device looks for
// the same voice (same ID, else same name), then the closest: same maker and accent.
export function describeVoice(voiceURI) {
  const v = pickVoice(voiceURI);
  if (!v) return null;
  const pace = voicePace(v);
  return { uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService, ...(pace ? { wps: +pace.wps.toFixed(3) } : {}) };
}

const maker = name => (String(name).match(/\b(Google|Microsoft|Apple|Samsung|Amazon|eSpeak)\b/i)?.[1] || '').toLowerCase();
const coreName = name => String(name).replace(/\b(Microsoft|Google|Online|\(Natural\)|Natural|Desktop|Enhanced|Premium|Compact)\b|[-–(),]/gi, ' ')
  .replace(/\b(English|United States|United Kingdom|US|UK)\b/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

export function matchVoice(info) {
  if (!info) return { voice: null, exact: false };
  const vs = loadVoices();
  const exact = vs.find(v => v.voiceURI === info.uri) || vs.find(v => v.name === info.name);
  if (exact) return { voice: exact, exact: true };
  const core = coreName(info.name);
  const close = (core && vs.find(v => coreName(v.name) === core)) // "Microsoft Aria Online (Natural)" ~ "Microsoft Aria"
    || vs.find(v => maker(v.name) && maker(v.name) === maker(info.name) && v.lang === info.lang)
    || vs.find(v => v.lang === info.lang && v.localService === info.local)
    || vs.find(v => v.lang === info.lang);
  return { voice: close || null, exact: false };
}

// Voice speed (1 = the voice's normal pace). Older saved settings said 'auto'.
export const DEFAULT_RATE = 1.2;
export function speechRate(setting) {
  const r = parseFloat(setting);
  return r > 0 ? Math.min(2, Math.max(0.5, r)) : DEFAULT_RATE;
}

// Words per second at rate 1, for estimates (most voices talk at 160-190 words a minute).
const WPS = 2.9;

// ── Each voice's real pace ───────────────────────────────────────────────
// Voices differ in speed at the same rate setting (an Apple voice and a Microsoft one can be
// 10-20% apart). Every sentence spoken is timed, and the pace of each voice on this device is
// kept (words per second at 1x). In a room the host's device sends its voice's pace, and a
// player whose device reads with a different voice sets its rate so it keeps the same pace.
const PACE_KEY = 'pts.voicePace.v1';
const voiceKey = v => (v ? v.voiceURI || v.name : '');
function paces() {
  try { return JSON.parse(globalThis.localStorage?.getItem(PACE_KEY) || '{}') || {}; } catch { return {}; }
}
export function voicePace(voice) {
  const p = paces()[voiceKey(voice)];
  return p && p.n >= 2 ? p : null;           // (two sentences before it counts)
}
export function recordPace(voice, words, ms, rate) {
  const key = voiceKey(voice);
  if (!key || words < 4 || ms < 700) return null;
  const wps = words / (ms / 1000) / rate;    // at 1x
  if (!(wps > 1 && wps < 6)) return null;    // a stall or a glitch, not speech
  const all = paces(), old = all[key];
  // a plain average at first, then a slow moving average so one odd sentence barely counts
  const n = (old?.wps ? old.n || 0 : 0) + 1;
  const avg = n === 1 ? wps : n <= 8 ? old.wps + (wps - old.wps) / n : old.wps * 0.9 + wps * 0.1;
  all[key] = { ...old, wps: avg, n: Math.min(n, 999) };   // (keeps the voice's start-up lag, below)
  try { globalThis.localStorage?.setItem(PACE_KEY, JSON.stringify(all)); } catch { /* full or blocked */ }
  return all[key];
}
// The rate this device should use so its voice keeps the host's pace (null: can't tell yet).
export function matchedRate(hostInfo, hostRate) {
  if (!hostInfo?.wps) return null;
  const { voice, exact } = matchVoice(hostInfo);
  if (exact || !voice) return null;          // the same voice keeps the same pace by itself
  const mine = voicePace(voice);
  if (!mine) return null;
  return speechRate(speechRate(hostRate) * hostInfo.wps / mine.wps);
}
const wordCount = s => (String(s).trim() ? String(s).trim().split(/\s+/).length : 0);

// Roughly how long a question takes to read, in ms (for a fallback timer).
export function estimateMs(words, rate) {
  const n = words.reduce((a, w) => a + wordCount(w), 0);
  return (n / (WPS * speechRate(rate))) * 1000;
}

// A short silence before each answer choice (W, X, Y, Z or a numbered statement), in ms at 1×.
export const CHOICE_PAUSE_MS = 400;

// The most words in one utterance: about 10.5 s of speech at this rate (Chrome's online voices stop
// partway through ~15 s ones), 24-40 words.
export const maxWords = rate => Math.max(24, Math.min(40, Math.floor(10.5 * WPS * speechRate(rate))));

// A full stop after these doesn't end a sentence ("Dr. Pepper", "e.g. iron", "J. Robert").
const ABBREV = /^(?:dr|mr|mrs|ms|st|mt|vs|etc|e\.g|i\.e|approx|fig|figs|no|jr|sr|ca|cf|al|inc|co|prof|u\.s|[A-Z])\.$/i;
// Where a long sentence can be cut without a pause sounding odd: after a comma, before a clause.
const CLAUSE = /^(?:which|that|where|when|while|whereas|because|although|though|but|and|or|so|if|since|unless|whose|who|whom|after|before|until|given|assuming|using|including|such|to)$/i;
const PREP = /^(?:in|on|at|for|with|from|by|into|through|between|during|about|under|over|without|within|as)$/i;
// Words a phrase can't end on: never cut right after them ("the Lipid A core of | what molecules").
const GLUE = /^(?:a|an|the|of|to|in|on|at|for|with|from|by|into|and|or|but|that|which|what|its|their|his|her|this|these|those|is|are|was|were|be|been|has|have|had|will|would|can|could|than|very|most|more|each|every|some|any|no|not)$/i;
const bare = w => String(w || '').trim().replace(/^[("“'[]+|[)"”'\],.;:?!]+$/g, '');
function cutStrength(words, j) {
  const prev = String(words[j - 1] || '').trim(), next = String(words[j] || '').trim();
  if (!prev || !next) return 0;
  if (/[,;—–)\]]$/.test(prev) || /^[-—–]$/.test(prev)) return 3;
  if (/[.?!:]$/.test(prev)) return 3;
  if (GLUE.test(bare(prev))) return 0;
  if (/^[([]/.test(next)) return 2.5;
  if (CLAUSE.test(bare(next))) return 2;
  if (PREP.test(bare(next))) return 1;
  return 0;
}

// Cut tokens [a, b) holding n words into utterances of at most `cap` words, at the most natural
// points, keeping the pieces about even (not one long piece and a stub).
function cutLong(words, a, b, cap) {
  const counts = [];
  for (let i = a; i < b; i++) counts.push(wordCount(words[i]));
  const n = counts.reduce((x, y) => x + y, 0);
  if (n <= cap) return [[a, b]];
  const pieces = Math.ceil(n / cap), ideal = n / pieces;
  const low = Math.max(Math.min(6, n), n - cap * (pieces - 1));
  let best = null, w = 0;
  for (let j = a + 1; j < b; j++) {
    w += counts[j - 1 - a];
    if (w < low) continue;
    if (w > cap) break;
    const score = cutStrength(words, j) - 1.5 * Math.abs(w - ideal) / ideal;
    if (!best || score > best.score) best = { j, score };
  }
  if (!best) { // one token longer than the cap (long math): it stays whole
    let acc = 0, j = a;
    while (j < b - 1 && acc + counts[j - a] <= cap) acc += counts[j++ - a];
    best = { j: Math.max(a + 1, j) };
  }
  return [[a, best.j], ...cutLong(words, best.j, b, cap)];
}

// Group tokens into sentences: [{ from, to, text, starts: [char offset of each token], pause }].
// A new sentence also starts at each answer choice, with a pause before it. A sentence longer than
// `cap` words is cut where a reader would breathe (cutLong), not at a fixed word count.
export function sentences(words, from, breaks, cap = maxWords(1.2)) {
  const spans = [];
  let start = from, n = 0;
  for (let i = from; i < words.length; i++) {
    const w = String(words[i] || '').trim();
    if (breaks.has(i) && i > start) { spans.push([start, i]); start = i; n = 0; }
    n += wordCount(w);
    if ((/[.?!:]$/.test(w) && n >= 3 && !ABBREV.test(w)) || i === words.length - 1) { spans.push([start, i + 1]); start = i + 1; n = 0; }
  }
  const out = [];
  for (const [a, b] of spans) {
    cutLong(words, a, b, cap).forEach(([x, y], k) => {
      const cur = { from: x, to: y, text: '', starts: [], n: 0, pause: k === 0 && breaks.has(x) && x > from };
      for (let i = x; i < y; i++) {
        const w = String(words[i] || '').trim();
        cur.starts.push(cur.text.length + (cur.text ? 1 : 0));
        if (w) { cur.text += (cur.text ? ' ' : '') + w; cur.n += wordCount(w); }
      }
      out.push(cur);
    });
  }
  return out.filter(s => s.text);
}

let current = null;

// ── Keeping room players in step with the host ─────────────────────────────
// In a room every device reads the question with its own voice. The host's voice is the one
// that counts (it decides where a buzz lands and when time starts), so players follow it:
//  - The host starts each reading a little ahead (`startAt`, a moment on a clock every device
//    shares, see ClockSync in js/net.js), so the message reaches every player before it's due.
//  - A voice takes a moment from speak() to the first sound (`lag`: a few tens of ms on the
//    device, a few hundred for online voices). Each device learns its own and calls speak() that
//    much early, so the first words come out together.
//  - The host tells players when each sentence started ('said'). A player starts its next sentence
//    when the host's will (the host's last start + that sentence's length + the host's usual gap),
//    waits in silence if it's early, and if it's late speaks that sentence a little faster (at most
//    CATCH_UP) to be back with the host by its end.
//  - Players tell the host how long their voice takes to start; the host leaves at least that much
//    between sentences (`minGap`, at most MAX_GAP), or a slow starter could never start with it.
export const CATCH_UP = 0.06;          // most a player speeds up to catch the host (6%)
export const MAX_GAP = 400;             // most the host waits between sentences for a slow-starting voice
const BEHIND_MS = 8;                    // closer than this counts as together
const WAIT_MAX_MS = 1500;               // longest a player waits for the host's next sentence
const LAG_DEFAULT = { local: 60, online: 250 };

// Each voice's start-up lag on this device (ms from speak() to its 'start' event), kept with its pace.
export function voiceLag(voice) {
  const p = paces()[voiceKey(voice)];
  if (p && p.nl >= 1 && Number.isFinite(p.lag)) return p.lag;
  return voice && voice.localService === false ? LAG_DEFAULT.online : LAG_DEFAULT.local;
}
export function recordLag(voice, ms) {
  const key = voiceKey(voice);
  if (!key || !(ms >= 0 && ms < 2000)) return null;
  const all = paces(), old = all[key] || {};
  const nl = (old.nl || 0) + 1;
  // the median-ish of recent starts: a plain average at first, then a moving one that a single slow
  // start (a network hiccup with an online voice) barely moves
  const lag = !old.nl ? ms : nl <= 5 ? old.lag + (ms - old.lag) / nl : old.lag * 0.85 + Math.min(ms, old.lag * 2 + 50) * 0.15;
  all[key] = { ...old, lag: Math.round(lag * 10) / 10, nl: Math.min(nl, 999) };
  try { globalThis.localStorage?.setItem(PACE_KEY, JSON.stringify(all)); } catch { /* full or blocked */ }
  return all[key];
}

// When a following player should start sentence s (whose previous sentence is p), on this device's
// clock. host: what the host has reported ({start: Map from → ms, gap}); mine: when this device said p
// ({start, end, rate}); base: the host's rate. Returns { at } (null: no word from the host yet) and
// whether the host is already on s (`now`: start at once).
export function followTarget({ s, p, host, mine, base, pauseMs }) {
  if (host.start.has(s.from)) return { at: host.start.get(s.from), now: true };
  if (!p || !host.start.has(p.from) || !mine) return { at: null };
  // the same voice takes as long as it did here, scaled to the host's rate if this device sped up
  const dur = (mine.end - mine.start) * (mine.rate / base);
  return { at: host.start.get(p.from) + dur + pauseMs + host.gap };
}

// The rate for a sentence a following player starts `behind` ms late: up to CATCH_UP faster, enough to
// make the time up over the sentence.
export function catchUpRate(rate, behind, expectMs) {
  if (!(behind > BEHIND_MS) || !(expectMs > 0)) return rate;
  return Math.min(2, rate * (1 + Math.min(CATCH_UP, behind / expectMs)));
}

/**
 * Speak a question's tokens from token `from`.
 *   words       spoken form of each token (one string per token)
 *   rate        voice speed setting (or a function, read before each sentence)
 *   onProgress  (i) => called with the index of the token being spoken
 *   onEnd       () => called once everything has been said (not after stop())
 * Rooms (see above):
 *   startAt     performance.now() time the first words should be heard (default: right away)
 *   onSentence  ({from, start, gap}) => called as each sentence starts (the host sends these on)
 *   follow      true: a player, keeping to the host's sentences fed in with session.hostSaid()
 *   baseRate    the host's rate: sentences are cut and choice pauses timed as the host's are
 */
export function speakQuestion(words, { voiceURI, voiceInfo, rate, from = 0, breaks = [], onProgress, onEnd,
  startAt, onSentence, follow = false, baseRate, minGap = 0 } = {}) {
  stopSpeaking();
  if (!ttsSupported || !words?.length) { onEnd?.(); return null; }
  const session = { alive: true, keep: [], timers: [] };
  current = session;
  // rate can be a function, read before each sentence (a player's matched rate settles as
  // this device learns its voice's pace)
  const rateNow = () => speechRate(typeof rate === 'function' ? rate() : rate);
  let r = rateNow();
  const base = speechRate(baseRate ?? r);
  const list = sentences(words, from, new Set(breaks), maxWords(base));
  const voiceOf = () => (voiceInfo && matchVoice(voiceInfo).voice) || pickVoice(voiceURI);
  const pauseBefore = (s, rr) => (s.pause ? CHOICE_PAUSE_MS / rr : 0);
  // the host's time between one sentence's end and the next one's first sound (its pause aside)
  const gapFor = lag => Math.max(lag, Math.min(MAX_GAP, Number(typeof minGap === 'function' ? minGap() : minGap) || 0));
  let k = 0;
  // when this device said each sentence: from → {start, end, rate}
  const mine = new Map();
  // what the host reported (players): from → start, and its usual gap between sentences
  const host = { start: new Map(), gap: null };
  let lastEnd = null, waiting = null;

  // The end of the question is reported when the voice's last sentence ends (its 'end' event),
  // so the buzz timer never starts while the voice is still talking. (An earlier version ended
  // early, at a guess of when the last word would be over; with voices that don't report word
  // boundaries the guess came too soon.)
  let endSent = false;
  const sendEnd = () => { if (endSent || !session.alive) return; endSent = true; onEnd?.(); };
  const later = (fn, ms) => { const t = setTimeout(fn, Math.max(0, ms)); session.timers.push(t); return t; };

  // Work out when sentence k starts and wait for it.
  const schedule = () => {
    if (!session.alive) return;
    clearTimeout(waiting); waiting = null;
    if (k >= list.length) { sendEnd(); session.alive = false; return; }
    const s = list[k], p = list[k - 1];
    const voice = voiceOf();
    const lag = voiceLag(voice);
    const now = performance.now();
    let target, hostNow = false;
    if (k === 0) target = startAt ?? now;
    else if (follow) {
      const t = followTarget({ s, p, host: { start: host.start, gap: host.gap ?? host.lag ?? lag }, mine: mine.get(p.from), base, pauseMs: pauseBefore(s, base) });
      if (t.at == null) {
        // no word from the host on the last sentence yet: wait for it (hostSaid calls back), not forever,
        // and hardly at all if the host has said nothing (its voice may be off)
        const natural = lastEnd + pauseBefore(s, r) + lag;
        const wait = host.start.size ? WAIT_MAX_MS : k === 1 ? 600 : 0;
        if (now < natural + wait) { waiting = later(schedule, natural + wait - now); return; }
        target = natural;
      } else { target = t.at; hostNow = t.now; }
    } else target = lastEnd + pauseBefore(s, r) + gapFor(lag);
    // Chrome can ignore a speak() that comes straight after cancel(), so the first waits 40 ms at least.
    const at = Math.max(k === 0 ? now + 40 : now, hostNow ? now : target - lag);
    if (at > now + 4) { waiting = later(() => say(s, voice, target, lag), at - now); return; }
    say(s, voice, target, lag);
  };

  const say = (s, voice, target, lag) => {
    if (!session.alive) return;
    waiting = null;
    k++;
    r = rateNow();
    let rr = r;
    // late (a player behind the host, or a message that came after its time): catch up
    const wps = voicePace(voice)?.wps || WPS;
    if (follow) rr = catchUpRate(r, performance.now() + lag - target, (1000 * s.n) / (wps * r));
    const u = new SpeechSynthesisUtterance(s.text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
    u.rate = rr;
    let boundaries = false, started = 0, finished = false;
    const called = performance.now();
    const report = i => {
      if (!session.alive) return;
      onProgress?.(Math.min(s.to - 1, Math.max(s.from, i)));
    };
    u.onstart = () => {
      if (!session.alive) return;
      started = performance.now();
      recordLag(voice, started - called);
      mine.set(s.from, { start: started, end: null, rate: rr });
      // how long the host's voice took to get going after the previous sentence (its pause aside)
      const prev = mine.get(list[k - 2]?.from);
      const gap = prev?.end != null ? Math.max(0, started - prev.end - pauseBefore(s, rr)) : undefined;
      onSentence?.({ from: s.from, start: started, lag: Math.round(voiceLag(voice)), ...(gap != null ? { gap } : {}) });
      report(s.from);
      // Estimate the position from the time spent in the sentence until (unless) the
      // browser reports word boundaries itself.
      const est = setInterval(() => {
        if (!session.alive || finished) { clearInterval(est); return; }
        if (boundaries) return;
        const said = ((performance.now() - started) / 1000) * wps * rr; // words so far
        let acc = 0, i = s.from;
        for (; i < s.to; i++) { acc += wordCount(words[i]); if (acc > said) break; }
        report(i);
      }, 120);
      session.timers.push(est);
    };
    u.onboundary = e => {
      if (e.name && e.name !== 'word') return;
      boundaries = true;
      let i = s.from;
      while (i + 1 < s.to && s.starts[i + 1 - s.from] <= e.charIndex) i++;
      report(i);
    };
    const done = (e, timedOut = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      const end = performance.now();
      // time a sentence that was spoken to the end (not stopped, failed or hung)
      if (started && session.alive && !timedOut && e?.type !== 'error') recordPace(voice, s.n, end - started, rr);
      const m = mine.get(s.from);
      if (m) m.end = end;
      else mine.set(s.from, { start: end, end, rate: rr });   // never started: counts as no time
      lastEnd = end;
      session.keep = session.keep.filter(x => x !== u);
      report(s.to - 1);
      schedule();
    };
    u.onend = done;
    u.onerror = done;
    // Generous: 2.5 times the expected time, plus start-up.
    const watchdog = setTimeout(() => { if (!finished && session.alive) { synth.cancel(); done(null, true); } },
      4000 + 2.5 * (1000 * s.n) / (WPS * rr));
    session.timers.push(watchdog);
    session.keep.push(u);
    synth.speak(u);
  };

  // A player: the host started a sentence (its time already on this device's clock).
  session.hostSaid = ({ from: f, start, gap, lag }) => {
    if (!session.alive || !Number.isFinite(start)) return;
    host.start.set(f, start);
    if (Number.isFinite(lag)) host.lag = lag;
    if (Number.isFinite(gap)) host.gap = host.gap == null ? gap : host.gap * 0.7 + gap * 0.3;
    // waiting for this sentence, or for word of the one before it: decide again now
    if (waiting && (list[k]?.from === f || list[k - 1]?.from === f)) schedule();
  };

  schedule();
  return session;
}

export function stopSpeaking() {
  if (!ttsSupported) return;
  if (current) {
    current.alive = false;
    for (const t of current.timers) { clearTimeout(t); clearInterval(t); }
  }
  current = null;
  synth.cancel();
}

// iOS Safari speaks only after a user gesture: prime the engine on the first tap or key press.
if (ttsSupported && typeof document !== 'undefined') {
  const prime = () => {
    document.removeEventListener('pointerdown', prime, true);
    document.removeEventListener('keydown', prime, true);
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch { /* ignore */ }
  };
  document.addEventListener('pointerdown', prime, true);
  document.addEventListener('keydown', prime, true);
}
