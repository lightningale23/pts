import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampWpm, WPM_MIN, WPM_MAX } from '../js/settings.js';

test('typewriter reading speed stays within 250 to 1000 wpm', () => {
  assert.equal(WPM_MIN, 250);
  assert.equal(WPM_MAX, 1000);
  assert.equal(clampWpm(100), 250);   // saved under the old 100 minimum
  assert.equal(clampWpm(650), 650);
  assert.equal(clampWpm(1500), 1000);
  assert.equal(clampWpm(undefined), 260);
});
