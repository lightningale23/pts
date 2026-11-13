// Offline app: serves the site's data files from scripts next to pts.html, since a page opened
// from disk (file://) can't fetch() files. Each data file is a small classic script that puts the
// file's text in window.__PTS_FILES; it's loaded the first time the site asks for that file.
// Anything else (GitHub, the presence Worker, Google...) fails at once, like being offline.
/* global __PTS_MANIFEST__ */
const MANIFEST = __PTS_MANIFEST__; // { 'data/questions.csv': 'app/data/questions.csv.js', ... }
const files = (window.__PTS_FILES ||= {});
const pending = {};

function loadScript(src) {
  return (pending[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete pending[src]; reject(new TypeError(`Couldn't open ${src}`)); };
    document.head.append(s);
  }));
}

const TYPES = { csv: 'text/csv', json: 'application/json' };

window.fetch = async function offlineFetch(input) {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  const path = url.replace(/^\.\//, '').split(/[?#]/)[0];
  const src = MANIFEST[path];
  if (!src) throw new TypeError(`Not available offline: ${url}`);
  if (!(path in files)) await loadScript(src);
  const ext = path.split('.').pop();
  return new Response(files[path], { status: 200, headers: { 'Content-Type': TYPES[ext] || 'text/plain' } });
};
