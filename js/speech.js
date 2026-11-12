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
//    rates above 2: utterances are a sentence (at most 30 words) and rates stay at or below 2.
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
  const n = (old?.n || 0) + 1;
  const avg = !old ? wps : n <= 8 ? old.wps + (wps - old.wps) / n : old.wps * 0.9 + wps * 0.1;
  all[key] = { wps: avg, n: Math.min(n, 999) };
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
const MAX_WORDS = 30;
const wordCount = s => (String(s).trim() ? String(s).trim().split(/\s+/).length : 0);

// Roughly how long a question takes to read, in ms (for a fallback timer).
export function estimateMs(words, rate) {
  const n = words.reduce((a, w) => a + wordCount(w), 0);
  return (n / (WPS * speechRate(rate))) * 1000;
}

// A short silence before each answer choice (W, X, Y, Z or a numbered statement), in ms at 1×.
export const CHOICE_PAUSE_MS = 400;

// Group tokens into sentences: [{ from, to, text, starts: [char offset of each token], pause }].
// A new sentence also starts at each answer choice, with a pause before it.
function sentences(words, from, breaks) {
  const out = [];
  let cur = null;
  for (let i = from; i < words.length; i++) {
    const w = String(words[i] || '').trim();
    if (breaks.has(i) && cur) { if (cur.text) out.push(cur); cur = null; }
    if (!cur) cur = { from: i, to: i, text: '', starts: [], n: 0, pause: breaks.has(i) && i > from };
    cur.starts.push(cur.text.length + (cur.text ? 1 : 0));
    if (w) { cur.text += (cur.text ? ' ' : '') + w; cur.n += wordCount(w); }
    cur.to = i + 1;
    if ((/[.?!:]$/.test(w) && cur.n >= 3) || cur.n >= MAX_WORDS || i === words.length - 1) { out.push(cur); cur = null; }
  }
  return out.filter(s => s.text);
}

let current = null;

/**
 * Speak a question's tokens from token `from`.
 *   words       spoken form of each token (one string per token)
 *   rate        voice speed setting
 *   onProgress  (i) => called with the index of the token being spoken
 *   onEnd       () => called once everything has been said (not after stop())
 */
export function speakQuestion(words, { voiceURI, voiceInfo, rate, from = 0, breaks = [], onProgress, onEnd } = {}) {
  stopSpeaking();
  if (!ttsSupported || !words?.length) { onEnd?.(); return null; }
  const session = { alive: true, keep: [], timers: [] };
  current = session;
  // rate can be a function, read before each sentence (a player's matched rate settles as
  // this device learns its voice's pace)
  const rateNow = () => speechRate(typeof rate === 'function' ? rate() : rate);
  let r = rateNow();
  const list = sentences(words, from, new Set(breaks));
  let k = 0;

  // The end of the question is reported when the voice's last sentence ends (its 'end' event),
  // so the buzz timer never starts while the voice is still talking. (An earlier version ended
  // early, at a guess of when the last word would be over; with voices that don't report word
  // boundaries the guess came too soon.)
  let endSent = false;
  const sendEnd = () => { if (endSent || !session.alive) return; endSent = true; onEnd?.(); };
  const next = (paused = false) => {
    if (!session.alive) return;
    if (k >= list.length) { sendEnd(); session.alive = false; return; }
    if (list[k].pause && !paused) {
      session.timers.push(setTimeout(() => next(true), CHOICE_PAUSE_MS / r));
      return;
    }
    const s = list[k++];
    r = rateNow();
    const u = new SpeechSynthesisUtterance(s.text);
    const voice = (voiceInfo && matchVoice(voiceInfo).voice) || pickVoice(voiceURI);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
    u.rate = r;
    let boundaries = false, started = 0, finished = false;
    const report = i => {
      if (!session.alive) return;
      onProgress?.(Math.min(s.to - 1, Math.max(s.from, i)));
    };
    u.onstart = () => {
      started = performance.now();
      report(s.from);
      // Estimate the position from the time spent in the sentence until (unless) the
      // browser reports word boundaries itself.
      const est = setInterval(() => {
        if (!session.alive || finished) { clearInterval(est); return; }
        if (boundaries) return;
        const said = ((performance.now() - started) / 1000) * WPS * r; // words so far
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
      // time a sentence that was spoken to the end (not stopped, failed or hung)
      if (started && session.alive && !timedOut && e?.type !== 'error') recordPace(voice, s.n, performance.now() - started, r);
      session.keep = session.keep.filter(x => x !== u);
      report(s.to - 1);
      next();
    };
    u.onend = done;
    u.onerror = done;
    // Generous: 2.5 times the expected time, plus start-up.
    const watchdog = setTimeout(() => { if (!finished && session.alive) { synth.cancel(); done(null, true); } },
      4000 + 2.5 * (1000 * s.n) / (WPS * r));
    session.timers.push(watchdog);
    session.keep.push(u);
    synth.speak(u);
  };
  // (Chrome can ignore a speak() that comes straight after cancel(), so give it a moment.)
  session.timers.push(setTimeout(next, 40));
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
