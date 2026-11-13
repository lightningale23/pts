// The service worker (sw.js) must cache every module the site loads and every CDN file
// index.html uses, or the site breaks offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const lists = new Function('self', `${read('sw.js')}\nreturn { SHELL, DATA, CDN, CDN_CSS };`)({ addEventListener() {} });

function moduleGraph(entry) {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of read(file).matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
      visit(path.posix.join(path.posix.dirname(file), m[1]));
    }
  };
  visit(entry);
  return [...seen];
}

test('every module app.js loads is cached', () => {
  const missing = moduleGraph('js/app.js').filter(f => !lists.SHELL.includes(f));
  assert.deepEqual(missing, []);
});

test('every cached file exists', () => {
  for (const f of [...lists.SHELL, ...lists.DATA]) {
    if (f === './') continue;
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  }
});

test('every CDN file index.html uses is cached', () => {
  const html = read('index.html');
  const urls = [...html.matchAll(/<(?:link[^>]*rel="stylesheet"[^>]*|link[^>]*)href="(https:[^"]+)"|<script[^>]*src="(https:[^"]+)"/g)]
    .map(m => (m[1] || m[2]).replace(/&amp;/g, '&'))
    .filter(u => !u.endsWith('googleapis.com') && !u.endsWith('gstatic.com'));
  assert.ok(urls.length >= 3);
  for (const u of urls) assert.ok([...lists.CDN, ...lists.CDN_CSS].includes(u), u);
});

test('the bank files in config.js are cached', async () => {
  const { CONFIG } = await import('../js/config.js');
  for (const c of Object.values(CONFIG.competitions)) for (const f of c.bankFiles) assert.ok(lists.DATA.includes(f), f);
});
