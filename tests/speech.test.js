import { test } from 'node:test';
import assert from 'node:assert/strict';

// A fake speech engine: each utterance takes `perWord` ms per word; optional word boundaries.
const spoken = [];
let perWord = 10, boundaries = false, hang = false;
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.window = {
  speechSynthesis: {
    getVoices: () => [{ voiceURI: 'local', lang: 'en-US', localService: true, default: true }],
    addEventListener() {},
    speak(u) {
      if (!u.text.trim()) return;
      spoken.push({ text: u.text, rate: u.rate });
      if (hang) return;
      this._cur = u;
      const words = u.text.split(' ');
      u._t = [setTimeout(() => u.onstart?.(), 1)];
      if (boundaries) {
        let c = 0;
        words.forEach((w, k) => { const at = c; u._t.push(setTimeout(() => u.onboundary?.({ name: 'word', charIndex: at }), 2 + k * perWord)); c += w.length + 1; });
      }
      u._t.push(setTimeout(() => u.onend?.(), 3 + perWord * words.length));
    },
    cancel() { for (const t of this._cur?._t || []) clearTimeout(t); },
  },
};
globalThis.performance ??= { now: () => Date.now() };
const { speakQuestion, stopSpeaking, speechRate, estimateMs } = await import('../js/speech.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const Q = ['Biology,', 'Toss-up,', 'Short answer,', 'What', 'organelle', 'makes', 'ATP?', 'It', 'has', 'its', 'own', 'DNA.'];

test('a question is spoken a sentence at a time, at the chosen speed, and ends once', async () => {
  spoken.length = 0; perWord = 5; boundaries = false;
  let ends = 0;
  const seen = [];
  speakQuestion(Q, { voiceURI: 'local', rate: 1.4, onProgress: i => seen.push(i), onEnd: () => ends++ });
  await wait(400);
  assert.deepEqual(spoken.map(s => s.text), ['Biology, Toss-up, Short answer, What organelle makes ATP?', 'It has its own DNA.']);
  assert.ok(spoken.every(s => s.rate === 1.4));
  assert.equal(ends, 1);
  assert.equal(seen.at(-1), Q.length - 1);
  assert.ok(seen.every((v, k) => k === 0 || v >= seen[k - 1]), 'position only moves forward');
});

test('word boundaries from the browser give the exact word being spoken', async () => {
  spoken.length = 0; perWord = 30; boundaries = true;
  let at = -1;
  speakQuestion(Q, { rate: 1, onProgress: i => { at = i; } });
  await wait(40 + 30 * 5.5); // 40 ms start-up, then into the 6th spoken word ("organelle", token 4)
  assert.ok(at >= 3 && at <= 5, `at ${at}`);
  stopSpeaking();
});

test('reading can resume from a word, and stop() cancels without calling onEnd', async () => {
  spoken.length = 0; perWord = 5; boundaries = false;
  let ends = 0;
  speakQuestion(Q, { from: 7, onEnd: () => ends++ });
  await wait(200);
  assert.deepEqual(spoken.map(s => s.text), ['It has its own DNA.']);
  assert.equal(ends, 1);
  spoken.length = 0; perWord = 50;
  speakQuestion(Q, { onEnd: () => ends++ });
  await wait(60);
  stopSpeaking();
  await wait(600);
  assert.equal(spoken.length, 1);
  assert.equal(ends, 1);
});

test('a hung utterance does not stop the question forever', async () => {
  spoken.length = 0; perWord = 5; hang = true;
  let ended = false;
  speakQuestion(['Stuck.', 'Then', 'more.'], { rate: 2, onEnd: () => { ended = true; } });
  await wait(100);
  hang = false;
  await wait(5600); // watchdog: 4 s + 2.5x the expected time
  assert.ok(ended);
  assert.deepEqual(spoken.map(s => s.text), ['Stuck. Then more.']);
});

test('voice speed and time estimates', () => {
  assert.equal(speechRate(1.5), 1.5);
  assert.equal(speechRate('auto'), 1.2);
  assert.equal(speechRate(3), 2);
  assert.ok(Math.abs(estimateMs(['one two three'], 1) - 1034) < 5);
});
