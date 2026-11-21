// The dev page's Online tab: what the presence Worker notes about each open copy of the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagRequest, visitorFrom, summarize, describeUA, VISITOR_HEADERS } from '../worker/presence/src/visitors.js';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.1; rv:132.0) Gecko/20100101 Firefox/132.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

test('browser and device labels', () => {
  assert.equal(describeUA(UA.chromeWin), 'Chrome on Windows');
  assert.equal(describeUA(UA.safariIphone), 'Safari on iPhone');
  assert.equal(describeUA(UA.chromeIphone), 'Chrome on iPhone');
  assert.equal(describeUA(UA.edgeWin), 'Edge on Windows');
  assert.equal(describeUA(UA.firefoxMac), 'Firefox on Mac');
  assert.equal(describeUA(UA.chromebook), 'Chrome on Chromebook');
  assert.equal(describeUA(''), '');
});

test('the outer Worker sets the IP and location, overwriting any the visitor sent', () => {
  const req = new Request('https://w/online', { headers: { 'cf-connecting-ip': '203.0.113.7', [VISITOR_HEADERS.ip]: '1.1.1.1', 'user-agent': UA.chromeWin } });
  Object.defineProperty(req, 'cf', { value: { country: 'US', region: 'California', city: 'Irvine' } });
  const tagged = tagRequest(req);
  const v = visitorFrom(tagged, 1000);
  assert.deepEqual(v, { ip: '203.0.113.7', country: 'US', region: 'California', city: 'Irvine', device: 'Chrome on Windows', since: 1000 });
});

test('the list groups tabs from the same IP, longest-connected first', () => {
  const s = summarize([
    { ip: '203.0.113.7', country: 'US', city: 'Irvine', device: 'Chrome on Windows', since: 5000 },
    { ip: '198.51.100.2', country: 'US', city: 'Austin', device: 'Safari on iPhone', since: 2000 },
    { ip: '203.0.113.7', country: 'US', city: 'Irvine', device: 'Safari on iPhone', since: 3000 },
    { ip: '203.0.113.7', country: 'US', city: 'Irvine', device: 'Chrome on Windows', since: 4000 },
    null,   // a socket from before the Worker noted anything
  ], 9000);
  assert.equal(s.online, 5);
  assert.equal(s.people, 3);
  assert.deepEqual(s.visitors.map(v => [v.ip, v.tabs]), [['198.51.100.2', 1], ['203.0.113.7', 3], ['', 1]]);
  const irvine = s.visitors.find(v => v.ip === '203.0.113.7');
  assert.equal(irvine.since, 3000);
  assert.deepEqual(irvine.devices, ['Chrome on Windows', 'Safari on iPhone']);
});
