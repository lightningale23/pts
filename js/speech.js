// Reads questions aloud with the browser's built-in voices (Web Speech API).
// No audio is downloaded; available voices depend on the device and browser.

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

// Voices speak roughly 170 words per minute at rate 1.
export function rateForWpm(wpm) { return Math.max(0.6, Math.min(3, (wpm || 260) / 170)); }

let generation = 0;

// Speak a list of words. Long text is split into sentence-sized utterances,
// because some browsers cut off a single long utterance part-way through.
export function speakWords(words, { wpm, voiceURI } = {}) {
  if (!ttsSupported || !words?.length) return;
  stopSpeaking();
  const gen = ++generation;
  const voice = loadVoices().find(v => v.voiceURI === voiceURI) || null;
  const chunks = [];
  let cur = [];
  for (const w of words) {
    if (!w) continue;
    cur.push(w);
    if (/[.?!;:,]$/.test(w) && cur.length >= 6 || cur.length >= 22) { chunks.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) chunks.push(cur.join(' '));
  for (const text of chunks) {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rateForWpm(wpm);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
    u.onerror = () => {};
    if (gen === generation) synth.speak(u);
  }
}

export function stopSpeaking() {
  if (!ttsSupported) return;
  generation++;
  synth.cancel();
}
