import { test } from 'node:test';
import assert from 'node:assert/strict';

// Rooms, read aloud: a host's device and a player's device, each with its own speech engine, side by
// side in one process (speech.js loaded twice). Each fake voice takes `lag` ms from speak() to its
// first sound and `perWord` ms a word at 1x. The host's 'said' reports reach the player `net` ms later.
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const store = {};
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };

function fakeSynth(uri, opts) {
  return {
    opts, starts: [],
    getVoices: () => [{ voiceURI: uri, name: uri, lang: 'en-US', localService: true, default: true }],
    addEventListener() {},
    speak(u) {
      if (!u.text.trim()) return;
      const words = u.text.split(' ').length;
      this.cur = u;
      u._t = [
        setTimeout(() => { this.starts.push({ text: u.text, at: performance.now(), rate: u.rate }); u.onstart?.(); }, this.opts.lag),
        setTimeout(() => u.onend?.(), this.opts.lag + (this.opts.perWord * words) / u.rate),
      ];
    },
    cancel() { for (const t of this.cur?._t || []) clearTimeout(t); },
  };
}
async function device(uri, opts) {
  const synth = fakeSynth(uri, opts);
  globalThis.window = { speechSynthesis: synth };
  const mod = await import(`../js/speech.js?device=${uri}`);
  // what the device has learned of its voice from earlier questions: its start-up time and pace
  const voice = { voiceURI: uri };
  for (let k = 0; k < 6; k++) { mod.recordLag(voice, opts.lag); mod.recordPace(voice, 10, 10 * opts.perWord, 1); }
  return { synth, mod, uri, lag: 0, learn(lag) { for (let k = 0; k < 40; k++) mod.recordLag(voice, lag); } };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const sentence = (k, n = 10) => Array.from({ length: n }, (_, j) => (j === n - 1 ? `w${k}x${j}.` : `w${k}x${j}`));
const QUESTION = Array.from({ length: 8 }, (_, k) => sentence(k)).flat();

// Host and player read QUESTION together: the host starts at speakAt, the player gets the question
// `late` ms after the host sent it and follows the host's reports.
async function readTogether(host, player, { net = 60, lead = 400, late = net, rate = 1.2 } = {}) {
  host.synth.starts.length = 0; player.synth.starts.length = 0;
  const speakAt = performance.now() + lead;
  let playerSession = null, ended = 0, bothDone;
  const done = new Promise(r => { bothDone = r; });
  const end = () => { if (++ended === 2) bothDone(); };
  host.mod.speakQuestion(QUESTION, {
    voiceURI: host.uri, rate, startAt: speakAt, onEnd: end, minGap: () => player.lag,
    onSentence: info => setTimeout(() => playerSession?.hostSaid(info), net),
  });
  await wait(late);
  playerSession = player.mod.speakQuestion(QUESTION, {
    voiceURI: player.uri, rate, startAt: speakAt, follow: true, baseRate: rate, onEnd: end,
    onSentence: info => setTimeout(() => { player.lag = info.lag; }, net),   // the player tells the host its voice's start-up time
  });
  const total = lead + 8 * (10 * host.synth.opts.perWord / rate + 500) + 1500;
  await Promise.race([done, wait(total)]);
  await wait(net + 5);   // the last reports
  assert.equal(ended, 2, 'both voices finish');
  const h = host.synth.starts, p = player.synth.starts;
  assert.equal(h.length, 8); assert.equal(p.length, 8);
  return { speakAt, drift: h.map((x, k) => Math.round(p[k].at - x.at)), rates: p.map(x => x.rate), host: h };
}

test('rooms: same voice, the player hears every sentence start with the host (within 25 ms)', async () => {
  const host = await device('host-a', { lag: 30, perWord: 45 });
  const player = await device('player-a', { lag: 35, perWord: 45 });
  const { drift, host: h, speakAt } = await readTogether(host, player);
  assert.ok(Math.abs(h[0].at - speakAt) < 25, `host starts on time (${Math.round(h[0].at - speakAt)} ms)`);
  assert.ok(drift.every(d => Math.abs(d) <= 25), `drift ${drift}`);
});

test('rooms: a player whose voice is slower to start: the host leaves it room between sentences', async () => {
  const host = await device('host-b', { lag: 40, perWord: 45 });
  const player = await device('player-b', { lag: 250, perWord: 45 });
  player.lag = 250;   // (reported to the host on an earlier question)
  const { drift, host: h } = await readTogether(host, player);
  assert.ok(drift.every(d => Math.abs(d) <= 25), `drift ${drift}`);
  const gap = h[2].at - h[1].at - (10 * 45) / 1.2 - 40;
  assert.ok(gap > 180 && gap < 260, `host waits ${Math.round(gap)} ms more between sentences`);
});

test('rooms: a player that gets the question late catches up, and one that is early waits', async () => {
  const host = await device('host-c', { lag: 30, perWord: 60 });
  const player = await device('player-c', { lag: 30, perWord: 60 });
  // the question arrives 300 ms after it should have started
  const late = await readTogether(host, player, { lead: 100, late: 400 });
  assert.ok(late.drift[0] > 250, `starts late (${late.drift[0]} ms)`);
  assert.ok(late.rates[0] > 1.2 && late.rates.every(r => r <= 1.2 * 1.06 + 1e-9), `speeds up a little: ${late.rates}`);
  assert.ok(late.drift.at(-1) < late.drift[0] - 150, `catches up: ${late.drift}`);
  // a host whose voice is slow to start (its 'said' reports show it): the player waits for it
  host.synth.opts.lag = 200;
  host.learn(200);   // (as the host's device would over a question or two)
  const early = await readTogether(host, player);
  assert.ok(early.drift.every(d => Math.abs(d) <= 25), `drift ${early.drift}`);
});

test('rooms: a host that says nothing (voice off) holds a player up once at most, briefly', async () => {
  const player = await device('player-d', { lag: 20, perWord: 20 });
  const t0 = performance.now();
  let ended = false;
  player.mod.speakQuestion(QUESTION, { voiceURI: player.uri, rate: 1, startAt: t0 + 50, follow: true, baseRate: 1, onEnd: () => { ended = true; } });
  await wait(8 * (200 + 20) + 50 + 600 + 400);
  assert.ok(ended, 'the question is read to the end');
  const s = player.synth.starts;
  const gaps = s.slice(1).map((x, k) => x.at - s[k].at - 200);
  assert.ok(gaps.filter(g => g > 100).length <= 1, `gaps ${gaps.map(Math.round)}`);
});

test('catch-up and follow arithmetic', async () => {
  const { catchUpRate, followTarget, CATCH_UP } = await import('../js/speech.js?device=math');
  assert.equal(catchUpRate(1.2, 5, 3000), 1.2, 'close enough: no change');
  assert.ok(Math.abs(catchUpRate(1.2, 90, 3000) - 1.2 * 1.03) < 1e-9);
  assert.equal(catchUpRate(1.2, 2000, 3000), 1.2 * (1 + CATCH_UP));
  assert.equal(catchUpRate(1.95, 2000, 3000), 2, 'never past the browser limit');
  const s = { from: 10 }, p = { from: 0 };
  const host = { start: new Map([[0, 1000]]), gap: 30 };
  // the host started p at 1000; this device's p took 2000 ms at 1.06x the host's rate
  const t = followTarget({ s, p, host, mine: { start: 5000, end: 7000, rate: 1.272 }, base: 1.2, pauseMs: 0 });
  assert.ok(Math.abs(t.at - (1000 + 2120 + 30)) < 1e-6, t.at);
  host.start.set(10, 3100);
  assert.deepEqual(followTarget({ s, p, host, mine: null, base: 1.2, pauseMs: 0 }), { at: 3100, now: true });
  assert.deepEqual(followTarget({ s: { from: 20 }, p: { from: 15 }, host, mine: null, base: 1, pauseMs: 0 }), { at: null });
});
