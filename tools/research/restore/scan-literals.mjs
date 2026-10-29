#!/usr/bin/env node
// Restore audit (section 9): speech-clip names that are literals in the executable (the code names the clip: `say("OGSGBP26")`) and how many code / data references each literal has (push imm32 + any aligned u32 == VA).
// Literals with total refs <= 1 (`table-only`) are pointed at only by the speech table: no code names the clip. LIMITS: cutscene / FSM / hologram lines are looked up through the .str tag, so most of them show up as
// table-only; only the mini-game prefixes (AD/CA/OG/LE + SG) are informative, and even there a line can be reached through an id computed in code. Treat as a lead list, not a proof.
//   node --experimental-strip-types tools/research/restore/scan-literals.mjs [PREFIX-REGEX]
import fs from 'node:fs';
import { Pe } from '../../../src/formats/exe.ts';
const pe = new Pe(new Uint8Array(fs.readFileSync('/Users/sander/Documents/legoeiland2-web/public/data/le2/LEGO eiland 2.exe')));
const re = new RegExp(process.argv[2] ?? '^(AD|CA|OG|LE)[A-Z]{2}[A-Z]{2}\\d{2}[A-Z_ ]*$');
const table = fs.readFileSync('/tmp/le2-unused/speech-table.tsv', 'latin1').split('\n').map((l) => l.split('\t')[1]).filter(Boolean);
const names = [...new Set(table)].filter((n) => re.test(n));
// every u32 in the image that points into the image, as a multiset
const d = pe.data; const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
const cnt = new Map();
for (const s of pe.sections) for (let i = s.roff; i + 4 <= s.roff + s.rsize; i++) { const v = dv.getUint32(i, true); if (v >= pe.base && v < pe.base + 0x1000000) cnt.set(v, (cnt.get(v) ?? 0) + 1); }
const out = [];
for (const n of names) {
  const vas = pe.findStrings(n).filter((va) => pe.cstr(va, 40).toUpperCase() === n);
  if (!vas.length) continue;
  const refs = vas.map((va) => cnt.get(va) ?? 0);
  out.push({ n, vas: vas.map((v) => v.toString(16)), refs });
}
console.log('speech names with an exe literal:', out.length, 'of', names.length);
const ONLY = process.argv[3] === 'table-only';   // refs <= 1: only the speech table itself points at the literal (no code names the clip)
for (const o of out) if (ONLY ? o.refs.reduce((a, b) => a + b, 0) <= 1 : o.refs.every((r) => r === 0)) console.log('  ' + (ONLY ? 'TABLE-ONLY' : 'NO REFS'), o.n);
const byPrefix = {};
for (const o of out) { const k = o.n.slice(0, 6); (byPrefix[k] ??= { lit: 0, noref: 0 }); byPrefix[k].lit++; if (o.refs.reduce((a, b) => a + b, 0) <= 1) byPrefix[k].noref++; }
console.log(JSON.stringify(byPrefix));
