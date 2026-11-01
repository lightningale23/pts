// RFC 4180 CSV parser: handles quoted fields, escaped quotes and newlines inside quotes.
// Built for large question banks (tens of thousands of rows): fields are cut out with
// slice()/indexOf() instead of being built up one character at a time.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // BOM
  let field = ''; // text gathered for a field that contained quotes
  let start = i;  // start of the current unquoted run
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 34) { // " : copy the quoted run, turning "" into "
      field += text.slice(start, i);
      let j = i + 1;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q < 0) { field += text.slice(j); i = n; break; }
        field += text.slice(j, q);
        if (text.charCodeAt(q + 1) === 34) { field += '"'; j = q + 2; } else { i = q + 1; break; }
      }
      start = i;
    } else if (c === 44) { // ,
      row.push(field + text.slice(start, i));
      field = '';
      start = ++i;
    } else if (c === 10 || c === 13) { // \n or \r\n
      row.push(field + text.slice(start, i));
      field = '';
      rows.push(row);
      row = [];
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      start = ++i;
    } else {
      i++;
    }
  }
  const last = field + text.slice(start, n);
  if (last !== '' || row.length) { row.push(last); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

// Returns array of objects keyed by lowercase, trimmed header names.
export function csvToObjects(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const out = new Array(rows.length - 1);
  for (let r = 1; r < rows.length; r++) {
    const src = rows[r];
    const o = {};
    for (let k = 0; k < headers.length; k++) {
      const h = headers[k];
      if (h) { const v = src[k]; o[h] = v ? v.trim() : ''; }
    }
    out[r - 1] = o;
  }
  return out;
}
