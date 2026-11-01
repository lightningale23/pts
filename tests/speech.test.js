import { test } from 'node:test';
import assert from 'node:assert/strict';

// A fake speech engine: each utterance takes `perWord` ms per word (plus `startup`).
const spoken = [];
let perWord = 10, startup = 0, hang = false;
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.window = {
  speechSynthesis: {
    getVoices: () => [{ voiceURI: 'local', lang: 'en-US', localService: true, default: true }],
    addEventListener() {},
    speak(u) {
      if (!u.text.trim()) return;
      spoken.push({ text: u.text, rate: u.rate, at: Date.now() });
      if (hang) return;
      u._t = setTimeout(() => u.onend?.(), startup + perWord * u.text.split(/\s+/).length);
      this._cur = u;
    },
    cancel() { if (this._cur) clearTimeout(this._cur._t); },
  },
};
const { startReading, stopSpeaking, speechRate } = await import('../js/speech.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

test('a voice that keeps up says each word as it appears, never ahead', async () => {
  spoken.length = 0; perWord = 5; startup = 0;
  const r = startReading({ voiceURI: 'local', rate: 1 });
  for (const w of ['What', 'is', 'the', 'powerhouse', 'of', 'the', 'cell?']) { r.push(w); await wait(25); }
  assert.deepEqual(spoken.map(s => s.text), ['What', 'is', 'the', 'powerhouse', 'of', 'the', 'cell?']);
  stopSpeaking();
});

test('a slower voice says the words that piled up together, then catches up', async () => {
  spoken.length = 0; perWord = 60; startup = 20;
  const r = startReading({ voiceURI: 'local', rate: 1.3 });
  const words = 'Which of the following organelles contains its own circular DNA and ribosomes in eukaryotic cells?'.split(' ');
  for (const w of words) { r.push(w); await wait(20); }
  await wait(1500);
  const said = spoken.map(s => s.text).join(' ');
  assert.equal(said, words.join(' '), 'every word is said once, in order');
  assert.ok(spoken.length < words.length, 'some words were joined into phrases');
  assert.ok(spoken.every(s => s.rate >= 1.3 && s.rate <= 1.3 * 1.25 + 1e-9), 'rate stays fixed, with at most a small catch-up');
  stopSpeaking();
});

test('stopping (a buzz) drops what is waiting; a hung utterance does not block forever', async () => {
  spoken.length = 0; perWord = 50; startup = 0;
  let r = startReading({ voiceURI: 'local', rate: 1 });
  ['one', 'two', 'three', 'four'].forEach(w => r.push(w));
  stopSpeaking();
  await wait(300);
  assert.deepEqual(spoken.map(s => s.text), ['one']);
  assert.equal(r.alive, false);
  hang = true;
  r = startReading({ voiceURI: 'local', rate: 2 });
  r.push('stuck');
  hang = false;
  r.push('next');
  await wait(3200); // watchdog: 2.5 s + 0.9 s per word at 2x
  assert.deepEqual(spoken.map(s => s.text), ['one', 'stuck', 'next']);
  stopSpeaking();
});

test('voice speed: fixed values, or matched to the reading speed within a safe range', () => {
  assert.equal(speechRate('1.5', 260), 1.5);
  assert.equal(speechRate('auto', 260), 1.3);
  assert.equal(speechRate('auto', 100), 0.9);
  assert.equal(speechRate('auto', 650), 1.7);
  assert.equal(speechRate('3', 260), 2);
});
