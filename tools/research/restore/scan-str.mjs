#!/usr/bin/env node
// Restore audit (section 9): speech table entries (1731) that no .str line points at, + per-file id gaps.
//   node --experimental-strip-types tools/research/restore/scan-str.mjs [/tmp/le2-unused/story/x]
// needs /tmp/le2-unused/speech-table.tsv (index\tname; made by /tmp/le2-unused/speechtab.mjs = readAudioTables(exe).speech)
import fs from 'node:fs'; import path from 'node:path';
const X = process.argv[2] ?? '/tmp/le2-unused/story/x';
const table = fs.readFileSync('/tmp/le2-unused/speech-table.tsv', 'latin1').split('\n').map((l) => l.split('\t')).map(([i, n]) => [+i, n]);
const byIdx = new Map(table);
const used = new Map();      // idx -> [file:tag]
const files = {};
for (const area of fs.readdirSync(path.join(X, 'messages'))) {
  const d = path.join(X, 'messages', area, 'Data'); if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!/\.str$/i.test(f)) continue;
    const lines = fs.readFileSync(path.join(d, f), 'latin1').split(/\r?\n/).filter(Boolean);
    files[f] = [];
    for (const l of lines) { const m = /^([^:]*):(-?\d+)(.*)$/.exec(l); if (!m) continue; const idx = +m[2]; if (idx < 0) continue; files[f].push({ tag: m[1], idx, text: m[3].trim() }); (used.get(idx) ?? used.set(idx, []).get(idx)).push(f + ':' + m[1]); }
  }
}
const unused = table.filter(([i]) => !used.has(i));
console.log('table entries without any str line:', unused.length);
const by = {};
for (const [i, n] of unused) (by[n.replace(/\d+.*$/, '')] ??= []).push(i + ':' + n);
for (const [k, v] of Object.entries(by)) console.log(k.padEnd(8), v.length, v.join(' '));
// str lines whose idx names a different clip than the tag (cutscene str: tag == clip name)
console.log('\n-- cutscene-style str where tag != table name');
for (const [f, ls] of Object.entries(files)) {
  if (/FSM|HOL/i.test(f)) continue;
  for (const l of ls) { const n = byIdx.get(l.idx); if (n !== l.tag) console.log(f, l.tag, l.idx, n); }
}
