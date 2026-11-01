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

// Voice speed (1 = the voice's normal pace). Older saved settings said 'auto'.
export const DEFAULT_RATE = 1.2;
export function speechRate(setting) {
  const r = parseFloat(setting);
  return r > 0 ? Math.min(2, Math.max(0.5, r)) : DEFAULT_RATE;
}

// Words per second at rate 1, for estimates (most voices talk at 160-190 words a minute).
const WPS = 2.9;
const MAX_WORDS = 30;
const wordCount = s => (String(s).trim() ? String(s).trim().split(/\s+/).length : 0);

// Roughly how long a question takes to read, in ms (for a fallback timer).
export function estimateMs(words, rate) {
  const n = words.reduce((a, w) => a + wordCount(w), 0);
  return (n / (WPS * speechRate(rate))) * 1000;
}

// Group tokens into sentences: [{ from, to, text, starts: [char offset of each token] }].
function sentences(words, from) {
  const out = [];
  let cur = null;
  for (let i = from; i < words.length; i++) {
    const w = String(words[i] || '').trim();
    if (!cur) cur = { from: i, to: i, text: '', starts: [], n: 0 };
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
export function speakQuestion(words, { voiceURI, rate, from = 0, onProgress, onEnd } = {}) {
  stopSpeaking();
  if (!ttsSupported || !words?.length) { onEnd?.(); return null; }
  const session = { alive: true, keep: [], timers: [] };
  current = session;
  const r = speechRate(rate);
  const list = sentences(words, from);
  let k = 0;

  const next = () => {
    if (!session.alive) return;
    if (k >= list.length) { session.alive = false; onEnd?.(); return; }
    const s = list[k++];
    const u = new SpeechSynthesisUtterance(s.text);
    const voice = pickVoice(voiceURI);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
    u.rate = r;
    let boundaries = false, started = 0, finished = false;
    const report = i => { if (session.alive) onProgress?.(Math.min(s.to - 1, Math.max(s.from, i))); };
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
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      session.keep = session.keep.filter(x => x !== u);
      report(s.to - 1);
      next();
    };
    u.onend = done;
    u.onerror = done;
    // Generous: 2.5 times the expected time, plus start-up.
    const watchdog = setTimeout(() => { if (!finished && session.alive) { synth.cancel(); done(); } },
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
