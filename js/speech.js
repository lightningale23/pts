// Reads questions aloud with the browser's built-in voices (Web Speech API).
//
// The voice follows the screen: each word is spoken when it appears, never before. If the
// voice is still talking when more words appear, the words that piled up are spoken
// together as one phrase as soon as it finishes, so it catches up without racing. The
// speaking rate stays fixed (the "Voice speed" setting), instead of being guessed and
// adjusted from timings, which varied too much between voices, browsers and devices.
//
// Browser quirks handled here:
//  - Chrome drops the 'end' event of an utterance nobody holds a reference to (kept in `keep`).
//  - Chrome's online voices stop silently on long utterances (~15 s) and refuse rates above 2:
//    phrases are at most 16 words and rates stay at or below 2.
//  - An utterance can hang without ever ending: a watchdog moves on after a generous timeout.
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

// The chosen voice, or a voice installed on the device: online voices (Google's in Chrome)
// take a moment to start every phrase, which makes them lag behind the text.
function pickVoice(voiceURI) {
  const vs = loadVoices();
  return vs.find(v => v.voiceURI === voiceURI)
    || vs.find(v => v.default && v.localService)
    || vs.find(v => v.localService && /^en[-_]US/i.test(v.lang))
    || vs.find(v => v.localService)
    || null;
}

export const VOICE_RATES = [['auto', 'Match reading speed'], ['0.8', '0.8×'], ['1', '1×'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['1.75', '1.75×'], ['2', '2×']];

// "Match reading speed": about 200 words a minute per 1× of rate, kept in a range every
// voice handles well.
export function speechRate(setting, wpm) {
  const fixed = parseFloat(setting);
  if (fixed > 0) return Math.min(2, Math.max(0.5, fixed));
  return Math.min(1.7, Math.max(0.9, (wpm || 260) / 200));
}

const MAX_PHRASE = 16;
let current = null;

class Reader {
  constructor({ voiceURI, rate }) {
    this.voiceURI = voiceURI;
    this.rate = rate;
    this.queue = [];
    this.busy = false;
    this.alive = true;
    this.keep = [];
    this.watchdog = null;
  }

  push(text) {
    if (!this.alive || !text || !String(text).trim()) return;
    this.queue.push(String(text).trim());
    this.pump();
  }

  pump() {
    if (!this.alive || this.busy || !this.queue.length) return;
    // Everything waiting, as one phrase: up to 16 words, ending at a sentence break if there is one.
    const take = [];
    let words = 0;
    while (this.queue.length && words < MAX_PHRASE) {
      const w = this.queue.shift();
      take.push(w);
      words += w.split(/\s+/).length;
      if (/[.?!;:]$/.test(w) && words >= 4 && this.queue.length) break;
    }
    // Only when it has fallen well behind does it speak a little faster (at most 1.25×).
    const behind = words + this.queue.length;
    const rate = Math.min(2, this.rate * (behind > 6 ? Math.min(1.25, 1 + (behind - 6) * 0.03) : 1));

    const u = new SpeechSynthesisUtterance(take.join(' '));
    const voice = pickVoice(this.voiceURI);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
    u.rate = rate;
    this.busy = true;
    const done = () => {
      if (u.finished) return;
      u.finished = true;
      clearTimeout(this.watchdog);
      this.keep = this.keep.filter(x => x !== u);
      this.busy = false;
      this.pump();
    };
    u.onend = done;
    u.onerror = done;
    // A hung utterance: about 0.9 s per word at 1×, plus start-up time.
    this.watchdog = setTimeout(() => { if (!u.finished && this.alive) { synth.cancel(); done(); } }, 2500 + (900 * words) / rate);
    this.keep.push(u);
    synth.speak(u);
  }

  stop() {
    this.alive = false;
    this.queue = [];
    clearTimeout(this.watchdog);
  }
}

// Start reading a question. Push each word's spoken form as it appears on screen.
export function startReading({ voiceURI, rate }) {
  stopSpeaking();
  if (!ttsSupported) return null;
  current = new Reader({ voiceURI, rate });
  return current;
}

export function stopSpeaking() {
  if (!ttsSupported) return;
  if (current) current.stop();
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
