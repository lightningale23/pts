import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync, speechLead, toLocalTimes } from '../js/net.js';

test("a player's clock is matched to the host's from the fastest recent ping", () => {
  const c = new ClockSync(5);
  assert.equal(c.toLocal(1000), null, 'unknown until a ping comes back');
  // the host's clock is 5000 ms ahead; the network is uneven (the answer took longer than the ping)
  c.add(100, 5100 + 40, 200);    // 100 ms round trip, 40 there / 60 back: 10 ms off
  c.add(300, 5300 + 10, 320);    // 20 ms round trip: off by 0
  c.add(500, 5500 + 150, 900);   // a slow one
  assert.equal(c.toLocal(10000), 5000);
  // only the last few count (clocks drift apart)
  for (let k = 0; k < 5; k++) c.add(1000 + k * 100, 6000 + k * 100 + 30 + 2, 1000 + k * 100 + 60);
  assert.equal(c.toLocal(10000), 5000 - 2);
  c.add(10, NaN, 20); c.add(30, 40, 20);   // nonsense is ignored
  assert.equal(c.samples.length, 5);
});

test('the voices start ahead by enough for the slowest player, within limits', () => {
  assert.equal(speechLead([]), 0, 'nobody to wait for');
  assert.equal(speechLead([undefined, null]), 0);
  assert.equal(speechLead([20, 40]), 300);
  assert.equal(speechLead([40, 300]), 400);
  assert.equal(speechLead([5000]), 900);
});

test("host times in events are turned into the player's own", () => {
  const c = new ClockSync();
  c.add(0, 1000, 0);
  assert.deepEqual(toLocalTimes('question', { n: 3, speakAt: 1500 }, c), { n: 3, speakAt: 500 });
  assert.deepEqual(toLocalTimes('said', { from: 4, start: 1200, gap: 30 }, c), { from: 4, start: 200, gap: 30 });
  assert.deepEqual(toLocalTimes('buzz', { at: 7 }, c), { at: 7 }, 'positions are not times');
  assert.deepEqual(toLocalTimes('resume', { at: 7, speakAt: 2000 }, new ClockSync()), { at: 7 }, 'no clock yet: no time');
});
