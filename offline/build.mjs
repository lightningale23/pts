// Builds the offline app: a folder that runs the site from disk with no internet.
//
//   cd offline && npm install && node build.mjs
//
// Output: offline/dist/pts-offline/ (open pts.html) and offline/dist/pts-offline.zip.
// It bundles js/ into one classic script (a page opened from disk can't load ES modules),
// turns each data file into a script the fetch shim loads on demand, and copies KaTeX, the
// fonts and the visual-bonus pictures so nothing is fetched from the web. Rerun it after the
// banks change. Internet-only parts (Rooms, Report, Search Google, online badge, Google Sheet,
// GitHub changelog) are switched off in overrides.js and hidden with the CSS below.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(HERE, 'dist');
const OUT = path.join(DIST, 'pts-offline');
const require = createRequire(import.meta.url);
const pkgDir = name => path.dirname(require.resolve(`${name}/package.json`));

const rel = (...p) => path.join(OUT, ...p);
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const write = (to, text) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, text); };

fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(`${OUT}.zip`, { force: true });
fs.mkdirSync(OUT, { recursive: true });

// ── Data files, as scripts ──────────────────────────────────────────────
const DATA = ['questions.csv', 'visual-bonuses.csv', 'osb-questions.csv', 'sample-questions.csv',
  'pronunciations.csv', 'changelog.json'];
const manifest = {};
const counts = {};
for (const name of DATA) {
  const src = path.join(ROOT, 'data', name);
  if (!fs.existsSync(src)) continue;
  const text = fs.readFileSync(src, 'utf8');
  const key = `data/${name}`, script = `app/data/${name}.js`;
  write(rel(script), `(window.__PTS_FILES||(window.__PTS_FILES={}))[${JSON.stringify(key)}]=${JSON.stringify(text)};\n`);
  manifest[key] = script;
  if (name.endsWith('.csv')) counts[name] = text.split('\n').length - 1;
}

// Visual bonus pictures keep their paths (data/visuals/<id>.webp, relative to pts.html).
const visuals = path.join(ROOT, 'data', 'visuals');
if (fs.existsSync(visuals)) fs.cpSync(visuals, rel('data', 'visuals'), { recursive: true });

// ── The site's code, bundled ────────────────────────────────────────────
await build({
  entryPoints: [path.join(HERE, 'entry.js')],
  outfile: rel('app', 'pts.js'),
  bundle: true,
  format: 'iife',
  minify: true,
  define: { __PTS_MANIFEST__: JSON.stringify(manifest) },
  logLevel: 'warning',
});

// ── KaTeX (math) ────────────────────────────────────────────────────────
const katex = path.join(pkgDir('katex'), 'dist');
copy(path.join(katex, 'katex.min.js'), rel('app', 'katex', 'katex.min.js'));
copy(path.join(katex, 'katex.min.css'), rel('app', 'katex', 'katex.min.css'));
for (const f of fs.readdirSync(path.join(katex, 'fonts'))) {
  if (f.endsWith('.woff2')) copy(path.join(katex, 'fonts', f), rel('app', 'katex', 'fonts', f));
}

// ── Fonts (were Google Fonts) ───────────────────────────────────────────
const FONTS = [
  ['Atkinson Hyperlegible', '@fontsource/atkinson-hyperlegible', 'atkinson-hyperlegible', [[400, 'normal'], [700, 'normal'], [400, 'italic']]],
  ['Bricolage Grotesque', '@fontsource/bricolage-grotesque', 'bricolage-grotesque', [[500, 'normal'], [700, 'normal'], [800, 'normal']]],
];
let fontCss = '';
for (const [family, pkg, base, faces] of FONTS) {
  for (const subset of ['latin', 'latin-ext']) {
    for (const [weight, style] of faces) {
      const file = `${base}-${subset}-${weight}-${style}.woff2`;
      const src = path.join(pkgDir(pkg), 'files', file);
      if (!fs.existsSync(src)) continue;
      copy(src, rel('app', 'fonts', file));
      const range = subset === 'latin'
        ? 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
        : 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
      fontCss += `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(fonts/${file}) format('woff2');unicode-range:${range}}\n`;
    }
  }
}
write(rel('app', 'fonts.css'), fontCss);

// ── Styles ──────────────────────────────────────────────────────────────
const OFFLINE_CSS = `
/* Offline app: hide what needs the internet */
.offline .tabs a[data-route="rooms"], .offline .report-btn, .offline #online, .offline #ping,
.offline a[href^="https://www.google.com/search"], .offline #reload-questions { display: none !important; }
`;
write(rel('app', 'style.css'), fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8') + OFFLINE_CSS);
for (const icon of ['apple-touch-icon.png', 'icon-192.png']) {
  const src = path.join(ROOT, 'icons', icon);
  if (fs.existsSync(src)) copy(src, rel('app', 'icons', icon));
}

// ── The page ────────────────────────────────────────────────────────────
const built = new Date();
const builtOn = built.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swaps = [];
const swap = (re, to, what) => {
  const before = html;
  html = html.replace(re, to);
  swaps.push([what, before !== html]);
};
swap(/\s*<link rel="preconnect"[^>]*>/g, '', 'preconnect');
swap(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="app/fonts.css">', 'google fonts');
swap(/<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/katex[^>]*>/, '<link rel="stylesheet" href="app/katex/katex.min.css">', 'katex css');
swap(/<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/katex[^>]*><\/script>/, '<script defer src="app/katex/katex.min.js"></script>', 'katex js');
swap(/<link rel="stylesheet" href="css\/style\.css">/, '<link rel="stylesheet" href="app/style.css">', 'style.css');
swap(/\s*<link rel="manifest"[^>]*>/, '', 'manifest');
swap(/href="icons\//g, 'href="app/icons/', 'icons');
swap(/<script type="module" src="js\/app\.js"><\/script>/, '<script defer src="app/pts.js"></script>', 'app script');
swap(/<title>([^<]*)<\/title>/, '<title>$1 (offline)</title>', 'title');
// Help page: drop the parts about online features, add one about this copy.
swap(/ Once the answer is shown, <b>Search Google<\/b>[^<]*<\/p>/, '</p>', 'help: google');
swap(/\s*<dt><kbd>\/<\/kbd><\/dt><dd>Jump to the chat \(rooms\)<\/dd>/, '', 'help: chat key');
swap(/\s*<h2>Rooms<\/h2>(\s*<p>[\s\S]*?<\/p>){2}/, '', 'help: rooms');
swap(/\s*<p>The green badge[^<]*<\/p>/, '', 'help: badge');
swap(/\s*<p>On an iPhone, tap Share[\s\S]*?<\/p>/, '', 'help: iphone');
swap(/(\s*)<h2>Where the questions come from<\/h2>/, `$1<h2>This offline copy</h2>
        <p>This copy of pts runs from your computer with no internet. Its questions are from ${builtOn}; download a new copy to get questions added since.</p>
        <p>Rooms, Report, Search Google and the online badge need the internet, so they're left out here: use the website for those. Read aloud uses the voices installed on your computer. Your settings, stats and saved questions are kept in this browser on this computer, separate from the website's.</p>
$1<h2>Where the questions come from</h2>`, 'help: offline');
const missed = swaps.filter(([, ok]) => !ok).map(([w]) => w);
if (missed.length) console.warn(`index.html changed; these edits didn't apply: ${missed.join(', ')}`);
write(rel('pts.html'), html);

// ── Launchers and read-me ───────────────────────────────────────────────
for (const f of fs.readdirSync(path.join(HERE, 'launchers'))) {
  const to = rel(f);
  copy(path.join(HERE, 'launchers', f), to);
  if (f.endsWith('.command')) fs.chmodSync(to, 0o755);
  if (f.endsWith('.bat')) write(to, fs.readFileSync(to, 'utf8').replace(/\r?\n/g, '\r\n'));
}

// ── Zip ─────────────────────────────────────────────────────────────────
try {
  execFileSync('zip', ['-qr9X', 'pts-offline.zip', 'pts-offline'], { cwd: DIST });
} catch {
  console.warn('zip not found: the folder is built, but not zipped.');
}

const size = dir => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
const mb = n => `${(n / 1e6).toFixed(1)} MB`;
console.log(`Built ${path.relative(ROOT, OUT)} (${mb(size(OUT))})${fs.existsSync(`${OUT}.zip`) ? `, zip ${mb(fs.statSync(`${OUT}.zip`).size)}` : ''}`);
console.log(Object.entries(counts).map(([k, v]) => `  ${k}: ${v.toLocaleString()} lines`).join('\n'));
