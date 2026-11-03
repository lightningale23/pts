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
const store = {};
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
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

test('answer choices are spoken separately, with a short pause before each', async () => {
  spoken.length = 0; perWord = 5; boundaries = false; hang = false;
  const words = ['Which', 'is', 'a', 'noble', 'gas?', 'W,', 'Neon', 'X,', 'Sodium', 'Y,', 'Iron', 'Z,', 'Carbon'];
  const times = [];
  const orig = window.speechSynthesis.speak;
  window.speechSynthesis.speak = function (u) { times.push(Date.now()); return orig.call(this, u); };
  let ended = false;
  speakQuestion(words, { rate: 1, breaks: [5, 7, 9, 11], onEnd: () => { ended = true; } });
  await wait(4000);
  window.speechSynthesis.speak = orig;
  assert.deepEqual(spoken.map(s => s.text), ['Which is a noble gas?', 'W, Neon', 'X, Sodium', 'Y, Iron', 'Z, Carbon']);
  assert.ok(ended);
  for (let k = 1; k < times.length; k++) assert.ok(times[k] - times[k - 1] >= 600, `gap ${times[k] - times[k - 1]} ms`);
});

test("rooms: a player's device uses the host's voice, or the closest one it has", async () => {
  const { matchVoice } = await import('../js/speech.js');
  const orig = window.speechSynthesis.getVoices;
  window.speechSynthesis.getVoices = () => [
    { voiceURI: 'mac-samantha', name: 'Samantha', lang: 'en-US', localService: true },
    { voiceURI: 'edge-aria', name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false },
    { voiceURI: 'g-uk', name: 'Google UK English Female', lang: 'en-GB', localService: false },
    { voiceURI: 'g-us', name: 'Google US English', lang: 'en-US', localService: false },
  ];
  try {
    assert.equal(matchVoice({ uri: 'g-us', name: 'Google US English', lang: 'en-US' }).exact, true);
    assert.equal(matchVoice({ uri: 'other-id', name: 'Samantha', lang: 'en-US' }).voice.voiceURI, 'mac-samantha');
    const aria = matchVoice({ uri: 'win-aria', name: 'Microsoft Aria - English (United States)', lang: 'en-US', local: true });
    assert.equal(aria.exact, false);
    assert.equal(aria.voice.voiceURI, 'edge-aria');
    assert.equal(matchVoice({ uri: 'x', name: 'Google UK English Male', lang: 'en-GB', local: false }).voice.voiceURI, 'g-uk');
    assert.equal(matchVoice({ uri: 'x', name: 'Daniel', lang: 'en-AU', local: true }).voice, null);
  } finally { window.speechSynthesis.getVoices = orig; }
});

test("each voice's pace is learned from the sentences it speaks", async () => {
  const { recordPace, voicePace } = await import('../js/speech.js');
  const v = { voiceURI: 'pace-test' };
  assert.equal(voicePace(v), null);
  assert.equal(recordPace(v, 2, 1000, 1), null);          // too short to time
  assert.equal(recordPace(v, 10, 30000, 1), null);        // a stall, not speech
  recordPace(v, 10, 4000, 1);                             // 2.5 words/s
  assert.equal(voicePace(v), null);                       // one sentence isn't enough
  recordPace(v, 10, 2500, 2);                             // 4 words/s at 2x = 2 words/s at 1x
  assert.ok(Math.abs(voicePace(v).wps - 2.25) < 1e-9, voicePace(v).wps);
  // and from real speaking: 5-word sentences at 220 ms a word (about 4.5 words/s)
  perWord = 220;
  const local = { voiceURI: 'local' };
  await new Promise(done => speakQuestion(['One two three four five.', 'Six seven eight nine ten.'], { rate: 1, onEnd: done }));
  perWord = 10;
  const p = voicePace(local);
  assert.ok(p && p.wps > 4 && p.wps < 5, JSON.stringify(p));
});

test("rooms: a player's different voice is set to the host's pace", async () => {
  const { recordPace, matchedRate, describeVoice } = await import('../js/speech.js');
  const orig = window.speechSynthesis.getVoices;
  window.speechSynthesis.getVoices = () => [{ voiceURI: 'samantha', name: 'Samantha', lang: 'en-US', localService: true }];
  try {
    const sam = { voiceURI: 'samantha' };
    const host = { uri: 'edge-aria', name: 'Microsoft Aria Online (Natural)', lang: 'en-US', local: true, wps: 3.0 };
    assert.equal(matchedRate(host, 1.2), null);            // Samantha's pace isn't known yet
    recordPace(sam, 12, 5000, 1); recordPace(sam, 12, 5000, 1);   // 2.4 words/s
    assert.ok(Math.abs(matchedRate(host, 1.2) - 1.5) < 1e-9);    // 1.2 x 3.0 / 2.4
    assert.equal(matchedRate({ ...host, wps: 9 }, 1.2), 2);      // never past the voices' limit
    assert.equal(matchedRate({ ...host, wps: undefined }, 1.2), null);  // host's pace unknown
    assert.equal(matchedRate({ uri: 'samantha', name: 'Samantha', lang: 'en-US', local: true, wps: 3 }, 1.2), null);  // same voice
    assert.ok(Math.abs(describeVoice('samantha').wps - 2.4) < 1e-9);
  } finally { window.speechSynthesis.getVoices = orig; }
});
