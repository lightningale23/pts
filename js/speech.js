// Reads questions aloud with the browser's built-in voices (Web Speech API) and keeps
// the voice in step with the words appearing on screen.
//
// Voices talk at very different speeds, so instead of guessing a rate, this speaks
// a few words at a time. Before each phrase it compares where the voice is with
// where the on-screen text is and speeds up or slows down to match, and after each
// phrase it measures how fast this voice really is and remembers it for next time.

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
  synth.addEventListener?.('voiceschanged', loadVoices);
}

export function englishVoices() { return loadVoices(); }

// ── Per-voice speed calibration ─────────────────────────────────────────
// k = speaking time at rate 1 divided by on-screen reading time at 100 wpm.
// A typical voice (~170 words per minute at rate 1) is about 100/170.
const CAL_KEY = 'pts.voiceCalibration.v1';
const DEFAULT_K = 100 / 170;
// Voices installed on the computer (Windows/macOS) speed up much less than the rate asks for,
// so they need a high ceiling; online voices (e.g. Google's in Chrome) stop working above 2.
const MAX_RATE_LOCAL = 10;
const MAX_RATE_ONLINE = 2;
function readCal() { try { return JSON.parse(localStorage.getItem(CAL_KEY) || '{}'); } catch { return {}; } }
function getCal(key) { return readCal()[key] || DEFAULT_K; }
function setCal(key, k) {
  try { const all = readCal(); all[key] = k; localStorage.setItem(CAL_KEY, JSON.stringify(all)); } catch { /* storage off */ }
}

let current = null;

/**
 * Speak `words` (one spoken string per on-screen token).
 *   wpm        on-screen reading speed
 *   units      on-screen time of each token at 100 wpm, in ms (same length as words)
 *   displayed  () => how many tokens are on screen now (omit when the whole question shows at once)
 *   offset     index of words[0] among all the question's tokens
 */
export function speakWords(words, { wpm = 260, voiceURI, units, displayed, offset = 0 } = {}) {
  if (!ttsSupported || !words?.length) return;
  stopSpeaking();
  const session = { alive: true, keep: [] };
  current = session;
  const voice = loadVoices().find(v => v.voiceURI === voiceURI) || null;
  const key = voice?.voiceURI || 'default';
  const maxRate = voice && voice.localService === false ? MAX_RATE_ONLINE : MAX_RATE_LOCAL;

  // Phrases: break at punctuation after a few words, or every 12 words (each new
  // phrase costs a short start-up pause, so not too many).
  const chunks = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const n = i - start + 1;
    if ((/[.?!;:,]$/.test(words[i] || '') && n >= 5) || n >= 12 || i === words.length - 1) {
      chunks.push({ start, end: i + 1 });
      start = i + 1;
    }
  }

  let next = 0;
  const speakNext = () => {
    if (!session.alive || next >= chunks.length) return;
    const c = chunks[next++];
    const text = words.slice(c.start, c.end).filter(Boolean).join(' ');
    if (!text.trim()) { speakNext(); return; }
    const n = c.end - c.start;
    const screenMs100 = units ? units.slice(c.start, c.end).reduce((a, b) => a + b, 0) : n * 600;

    let rate = getCal(key) * wpm / 100;
    if (displayed) {
      // Positive lag: the text is ahead of the voice, so catch up. Negative: wait for the text.
      const lag = displayed() - (offset + c.start);
      if (lag > 1) rate *= 1 + Math.min(1.5, (lag - 1) / n);
      else if (lag < -1) rate *= Math.max(0.65, 1 + (lag + 1) / (2 * n));
    }
    rate = Math.max(0.5, Math.min(maxRate, rate));

    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
    // Timed from the request, so the voice's start-up pause counts too.
    const requestedAt = performance.now();
    let started = false;
    u.onstart = () => { started = true; };
    u.onend = () => {
      if (session.alive && started && n >= 3) {
        const measured = ((performance.now() - requestedAt) * rate) / screenMs100;
        if (measured > 0.1 && measured < 20) setCal(key, getCal(key) * 0.3 + measured * 0.7);
      }
      speakNext();
    };
    u.onerror = () => { if (session.alive) speakNext(); };
    session.keep.push(u); // keeps the utterance alive so Chrome fires onend
    synth.speak(u);
  };
  speakNext();
}

export function stopSpeaking() {
  if (!ttsSupported) return;
  if (current) current.alive = false;
  current = null;
  synth.cancel();
}

// Kept for older callers; the speed is now learned per voice.
export function rateForWpm(wpm) { return Math.max(0.5, Math.min(MAX_RATE_ONLINE, DEFAULT_K * (wpm || 260) / 100)); }
