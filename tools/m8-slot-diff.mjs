#!/usr/bin/env node
// WP-SAVE: section by section diff of two .lgo files (node tools/m8-slot-diff.mjs a.lgo b.lgo): header, vars (by name), walker table (by slot), camera, frame counter, object records, decor, entity records (by tag: position, angles,
// flags, node states / blocks), bricks (by slot). Time and checksum are ignored.
import fs from 'node:fs';
import { decodeSave } from '../src/shell/save.ts';
const [fa, fb] = process.argv.slice(2);
const A = decodeSave(new Uint8Array(fs.readFileSync(fa))), B = decodeSave(new Uint8Array(fs.readFileSync(fb)));
const tagName = (t) => String.fromCharCode(t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff, (t >>> 24) & 0xff);
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
let n = 0;
const say = (m) => { n++; console.log(m); };
if (A.subgame !== B.subgame || A.fsmState !== B.fsmState) say(`header: subgame ${A.subgame}/${B.subgame} node ${A.fsmState}/${B.fsmState}`);
for (let i = 0; i < A.vars.length; i++) if (A.vars[i] !== B.vars[i]) say(`var ${i + 15}: ${A.vars[i]} / ${B.vars[i]}`);
for (let k = 0; k < 60; k++) { const a = A.walkers.subarray(k * 0x84, k * 0x84 + 0x84), b = B.walkers.subarray(k * 0x84, k * 0x84 + 0x84); if (!eq(a, b)) { const d = []; for (let q = 0; q < 0x84; q++) if (a[q] !== b[q]) d.push(q.toString(16)); say(`walker ${k} (${tagName(A.walkerTags[k])}/${tagName(B.walkerTags[k])}): bytes +${d.join(',+')}`); } }
if (!eq(A.camera, B.camera)) say(`camera differs ${hex(A.camera.subarray(0, 24))} / ${hex(B.camera.subarray(0, 24))}`);
if (A.frameCounter !== B.frameCounter) say(`frame counter ${A.frameCounter} / ${B.frameCounter}`);
if (A.objects.length !== B.objects.length) say(`object records ${A.objects.length} / ${B.objects.length}`);
else A.objects.forEach((o, i) => { const p = B.objects[i]; if (o.tag !== p.tag || o.animState !== p.animState || !Object.is(o.animFrame, p.animFrame)) say(`object ${tagName(o.tag)}: ${o.animState}:${o.animFrame} / ${tagName(p.tag)} ${p.animState}:${p.animFrame}`); });
for (let i = 0; i < A.decor.length; i++) if (A.decor[i] !== B.decor[i]) say(`decor byte ${i}: ${A.decor[i]} / ${B.decor[i]}`);
if (A.entities.length !== B.entities.length) say(`entity records ${A.entities.length} / ${B.entities.length}`);
A.entities.forEach((e, i) => {
  const f = B.entities[i]; if (!f) return;
  const nm = tagName(e.tag), w = [];
  if (e.tag !== f.tag) w.push(`tag ${tagName(f.tag)}`);
  if (!eq(e.pos, f.pos)) w.push(`pos ${[...e.pos].map((x) => x.toFixed(3))} / ${[...f.pos].map((x) => x.toFixed(3))}`);
  if (!eq(e.euler, f.euler)) w.push(`euler ${[...e.euler].map((x) => x.toFixed(3))} / ${[...f.euler].map((x) => x.toFixed(3))}`);
  if (e.flags !== f.flags) w.push(`flags 0x${e.flags.toString(16)} / 0x${f.flags.toString(16)}`);
  if (e.nodes.length !== f.nodes.length) w.push(`nodes ${e.nodes.length} / ${f.nodes.length}`);
  else e.nodes.forEach((nd, k) => { const m = f.nodes[k]; if (nd.state !== m.state) w.push(`node#${k} state ${nd.state} / ${m.state}`); if ((nd.data === null) !== (m.data === null) || (nd.data && !eq(nd.data, m.data))) { const d = []; if (nd.data && m.data) for (let q = 0; q < Math.min(nd.data.length, m.data.length); q++) if (nd.data[q] !== m.data[q]) d.push(q); w.push(`node#${k} block bytes ${d.join(',')} (${nd.data?.length}b)`); } });
  if (w.length) say(`entity ${nm}#${i}: ${w.join('; ')}`);
});
for (let i = 0; i < 64; i++) { const a = A.bricks[i], b = B.bricks[i]; if ((a === null) !== (b === null)) say(`brick slot ${i}: ${a ? 'used' : 'unused'} / ${b ? 'used' : 'unused'}`); else if (a && !eq(a, b)) { const d = []; for (let q = 0; q < a.length; q++) if (a[q] !== b[q]) d.push(q.toString(16)); say(`brick slot ${i}: ${d.length} bytes differ: +${d.slice(0, 12).join(',+')}`); } }
console.log(n ? `${n} differences` : 'identical');
