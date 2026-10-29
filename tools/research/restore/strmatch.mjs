// usage: node strmatch.mjs <strRoot> <turbo.tsv>  -> nearest .str line (token Jaccard) for each transcript
import fs from 'node:fs'; import path from 'node:path';
const [root, tsv] = process.argv.slice(2);
const lines = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (/\.str$/i.test(e.name)) for (const l of fs.readFileSync(p, 'latin1').split(/\r?\n/)) { const m = l.match(/^(\w+):(\d+)\s+(.*)$/); if (m) lines.push({ f: e.name, tag: m[1], t: m[3] }); } } })(root);
const norm = s => s.toLowerCase().replace(/[^a-zà-ÿ0-9 ]/g, '').split(/\s+/).filter(Boolean);
const sim = (a, b) => { const A = new Set(a), B = new Set(b); let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i || 1); };
for (const r of fs.readFileSync(tsv, 'utf8').trim().split('\n')) {
  const [n, , t] = r.split('\t'); const a = norm(t); let best = null, bs = 0;
  for (const l of lines) { const s = sim(a, norm(l.t)); if (s > bs) { bs = s; best = l; } }
  console.log(n, bs.toFixed(2), best ? `${best.f} ${best.tag}: ${best.t}` : '', '<=', t);
}
