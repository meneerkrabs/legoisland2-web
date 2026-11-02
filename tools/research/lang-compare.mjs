#!/usr/bin/env node
// Compares two editions of the game cabinet by cabinet (docs/re/language.md section 1): every member of the installed folder (group `Game`) by md5, the speech clips by name, and the speech id
// tables of the two executables (the Dutch one is read at its known address, the other found by the pointer to "LECSIN01"). Needs node >= 22.18 (type stripping).
//   node tools/research/lang-compare.mjs [<Dutch cab dir>] [<other cab dir>]
// cab dir = the folder with data1.hdr, data1.cab, data2.cab (defaults: the local Dutch / English copies under ~/Documents/legoeiland2-extract)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { InstallShieldCab } from '../../src/engine/installshield.ts';
import { Pe } from '../../src/formats/exe.ts';
import { readExeSpeechTable } from '../../src/formats/sound.ts';

const X = path.join(os.homedir(), 'Documents/legoeiland2-extract');
const [dirA = path.join(X, 'iso/LEGO Eiland 2'), dirB = path.join(X, 'en/iso/LEGO Island 2')] = process.argv.slice(2);
const open = async (d) => { const b = (f) => fs.openAsBlob(path.join(d, f)); return InstallShieldCab.open(await b('data1.hdr'), [await b('data1.cab'), await b('data2.cab')]); };
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const [A, B] = [await open(dirA), await open(dirB)];
const mapOf = (c) => new Map(c.files('Game').map((e) => [e.path.toLowerCase(), e]));
const [ma, mb] = [mapOf(A), mapOf(B)];
console.log(`Game files: A ${ma.size}, B ${mb.size}`);
const isSpeech = (k) => k.startsWith('_data/sounds/speech/');
const cls = (k) => (k.startsWith('_data/sounds/') ? 'sounds' : /\.bo[bd]$/.test(k) ? 'archives' : 'other');
const stat = {}; const bump = (k, f) => { (stat[k] ??= { same: 0, differ: 0, onlyB: 0, onlyA: 0 })[f]++; };
const differ = [], onlyB = [], onlyA = [];
for (const [k, e] of mb) {
  if (isSpeech(k)) continue;
  const n = ma.get(k);
  if (!n) { onlyB.push(e.path); bump(cls(k), 'onlyB'); continue; }
  if (md5(await B.read(e)) === md5(await A.read(n))) bump(cls(k), 'same'); else { differ.push(e.path); bump(cls(k), 'differ'); }
}
for (const [k, e] of ma) if (!mb.has(k) && !isSpeech(k)) { onlyA.push(e.path); bump(cls(k), 'onlyA'); }
console.log(stat, '\nDIFFER', differ, '\nB only', onlyB, '\nA only', onlyA);
const clips = (m) => new Map([...m].filter(([k]) => isSpeech(k) && k.endsWith('.mp3')).map(([k, e]) => [k.split('/').pop(), e]));
const [ca, cb] = [clips(ma), clips(mb)];
let same = 0;
for (const [k, e] of cb) { const n = ca.get(k); if (n && md5(await B.read(e)) === md5(await A.read(n))) same++; }
const sum = (m) => [...m.values()].reduce((n, e) => n + e.size, 0);
console.log(`speech: A ${ca.size} clips ${sum(ca)} B, B ${cb.size} clips ${sum(cb)} B; names in both ${[...cb.keys()].filter((k) => ca.has(k)).length} (identical content ${same}), only in B ${[...cb.keys()].filter((k) => !ca.has(k)).length}, only in A ${[...ca.keys()].filter((k) => !cb.has(k)).length}`);
// speech id tables
const exe = async (c, m) => { const e = [...m].find(([k]) => /^[^/]+\.exe$/.test(k) && !/^(setup|browse)/.test(k))?.[1]; return e ? new Pe(await c.read(e)) : null; };
const [pa, pb] = [await exe(A, ma), await exe(B, mb)];
const table = (pe, va0) => { const out = []; for (let va = va0; ; va += 4) { const s = pe.cstr(pe.u32(va), 16); if (pe.offset(pe.u32(va)) < 0 || !/^[A-Za-z0-9_]{4,12}$/.test(s)) break; out.push(s); } return out; };
const ta = readExeSpeechTable(await A.read([...ma].find(([k]) => /^[^/]+\.exe$/.test(k) && !/^(setup|browse)/.test(k))[1]));
let tb = null;
const lec = pb.findStrings('LECSIN01').filter((a) => pb.cstr(a) === 'LECSIN01');
for (const s of pb.sections) for (let o = s.roff; o < s.roff + s.rsize - 4; o += 4) {
  const v = (pb.data[o] | (pb.data[o + 1] << 8) | (pb.data[o + 2] << 16) | (pb.data[o + 3] << 24)) >>> 0;
  if (lec.includes(v)) { const t = table(pb, s.va + (o - s.roff)); if (t.length > 100 && (!tb || t.length > tb.length)) tb = t; }
}
const d = []; for (let i = 0; i < Math.max(ta.length, tb.length); i++) if (ta[i] !== tb[i]) d.push(`${i}: ${ta[i]} / ${tb[i]}`);
console.log(`speech tables: A ${ta.length} ids, B ${tb.length} ids, differing entries ${d.length}`, d);
