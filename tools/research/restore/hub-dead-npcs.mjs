#!/usr/bin/env node
// Restore audit (section 9): FSM tag stems (= hub record names, 4 chars) per node band whose record is hidden by the set-up (flags 2 -> 0, store address given) / has no record / is not attached as a talker.
//   node --experimental-strip-types tools/research/restore/hub-dead-npcs.mjs
import fs from 'node:fs';
import { standaloneCtx } from '../../lib/ctx-standalone.mjs';
import { loadExe, sceneOf } from '../../lib/engine-load.mjs';
import { profileFor } from '../../../src/game/setup.ts';
import '../../../src/zones/index.ts';
const X = '/tmp/le2-unused/story/x/messages';
const HUBS = { z07CSI: { 16: 'CI/CSIFSM1', 17: 'CI/CSIFSM1', 19: 'CI/CSIFSM2', 20: 'CI/CSIFSM2', 21: 'CI/CSIFSM3', 22: 'CI/CSIFSM4', 25: 'CI/CSIFSM5', 27: 'CI/CSIFSM6', 28: 'CI/CSIFSM6' }, z14OSD: { 34: 'AI/ADVFSM1', 45: 'AI/ADVFSM1' }, z16PYA: { 36: 'AI/ADVFSM2', 38: 'AI/ADVFSM2', 40: 'AI/ADVFSM2' }, z23DIP: { 47: 'AI/ADVFSM3', 50: 'AI/ADVFSM4' }, z40OGL: { 64: 'OG/OGLFSM2', 66: 'OG/OGLFSM2' } };
const ctx = standaloneCtx(); const pe = loadExe(ctx.dataRoot);
const stemsOf = (f) => { const set = new Set(); for (const l of fs.readFileSync(`${X}/${f.replace('/', '/Data/')}.str`, 'latin1').split(/\r?\n/)) { const m = /^([^:]*):/.exec(l); if (m && m[1].length === 5) set.add(m[1].slice(0, 4).toUpperCase()); } return set; };
for (const [zone, nodes] of Object.entries(HUBS)) {
  const scene = sceneOf(ctx, zone); const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
  for (const [node, fsm] of Object.entries(nodes)) {
    const m = new Map([[0x58, +node], [2, 1]]);
    const emu = profileFor(zone, pe, scene, undefined, { emuVars: { get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) }, archive }).emu;
    const out = [];
    for (const s of stemsOf(fsm)) {
      const idx = emu.records.findIndex((r) => r.name?.toUpperCase() === s);
      if (idx < 0) { out.push(`${s}: NO RECORD`); continue; }
      const r = emu.records[idx]; const att = emu.attaches.filter((a) => a.record === idx && /SGMFIG/.test(a.ctorName ?? '')).length;
      const st = emu.stores.filter((x) => x.record === idx && x.field === 0x60 - 0x60 + (x.field)).filter((x) => x.field < 2 + 0x60 && x.size >= 1 && /flags/i.test(String(x.field)) || false);
      if (!(r.flags & 2) || !att) out.push(`${s}#${idx}: ${r.flags & 2 ? 'visible' : 'HIDDEN(flags=' + r.flags.toString(16) + ')'} ${att ? 'attached' : 'NOT attached'}`);
    }
    console.log(`${zone} node ${node} ${fsm}: ${out.join(' | ') || 'all stems visible+attached'}`);
  }
}
