#!/usr/bin/env node
// Restore audit (section 9): per hub node, the talking-NPC records (SGMFIG-like attaches of the EMULATED set-up) vs the tag stems of the node's FSM string file.
//   node --experimental-strip-types tools/research/restore/hub-talkers.mjs
import fs from 'node:fs';
import { standaloneCtx } from '../../lib/ctx-standalone.mjs';
import { loadExe, sceneOf } from '../../lib/engine-load.mjs';
import { profileFor } from '../../../src/game/setup.ts';
import '../../../src/zones/index.ts';
const X = '/tmp/le2-unused/story/x/messages';
const HUBS = { z07CSI: { 16: 'CI/CSIFSM1', 17: 'CI/CSIFSM1', 19: 'CI/CSIFSM2', 20: 'CI/CSIFSM2', 21: 'CI/CSIFSM3', 22: 'CI/CSIFSM4', 25: 'CI/CSIFSM5', 27: 'CI/CSIFSM6', 28: 'CI/CSIFSM6' }, z14OSD: { 34: 'AI/ADVFSM1', 45: 'AI/ADVFSM1' }, z16PYA: { 36: 'AI/ADVFSM2', 38: 'AI/ADVFSM2', 40: 'AI/ADVFSM2' }, z23DIP: { 47: 'AI/ADVFSM3', 50: 'AI/ADVFSM4' }, z40OGL: { 64: 'OG/OGLFSM2', 66: 'OG/OGLFSM2' } };
const ctx = standaloneCtx(); const pe = loadExe(ctx.dataRoot);
const tags = (f) => { const set = new Set(); for (const l of fs.readFileSync(`${X}/${f.replace('/', '/Data/')}.str`, 'latin1').split(/\r?\n/)) { const m = /^([^:]*):/.exec(l); if (m) set.add(m[1].toUpperCase()); } return set; };
for (const [zone, nodes] of Object.entries(HUBS)) {
  const scene = sceneOf(ctx, zone); const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
  for (const [node, fsm] of Object.entries(nodes)) {
    const m = new Map([[0x58, +node], [2, 1]]);
    const emu = profileFor(zone, pe, scene, undefined, { emuVars: { get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) }, archive }).emu;
    const T = tags(fsm); const by = new Map();
    for (const a of emu.attaches) { const n = emu.records[a.record]?.name; (by.get(a.ctorName ?? a.ctor.toString(16)) ?? by.set(a.ctorName ?? a.ctor.toString(16), []).get(a.ctorName ?? a.ctor.toString(16))).push(n); }
    const sg = [...by.entries()].filter(([k]) => /SGMFIG|Human|Talk/i.test(k));
    console.log(`${zone} node ${node} (${fsm}): talker-ctors ${sg.map(([k, v]) => `${k}[${v.length}]`).join(' ')}`);
    for (const [k, v] of sg) { const nolines = v.filter((n) => n && !T.has(n.toUpperCase() + 'A') && !T.has(n.toUpperCase() + 'C')); if (nolines.length) console.log('   no A/C tag for:', nolines.join(' ')); }
    const stems = new Set([...T].map((t) => t.slice(0, -1)));
    const recs = new Set(emu.attaches.map((a) => emu.records[a.record]?.name?.toUpperCase()));
    const noRec = [...stems].filter((s) => !recs.has(s));
    if (noRec.length) console.log('   FSM stems with no attached record:', noRec.join(' '));
  }
}
