#!/usr/bin/env node
// Restore audit (section 9): for EVERY story node that maps to a hub: the message files (NPC table, hologram table) the EMULATED set-up loads, and the cutscene slots it declares.
//   node --experimental-strip-types tools/research/restore/hub-texts.mjs
import fs from 'node:fs';
import { standaloneCtx } from '../../lib/ctx-standalone.mjs';
import { loadExe, sceneOf } from '../../lib/engine-load.mjs';
import { profileFor } from '../../../src/game/setup.ts';
import { readStoryFsm, readZoneTable } from '../../../src/shell/tables.ts';
import '../../../src/zones/index.ts';
const ctx = standaloneCtx(); const pe = loadExe(ctx.dataRoot);
const zt = readZoneTable(pe), fsm = readStoryFsm(pe);
for (const zone of ['z07CSI', 'z13CAI', 'z14OSD', 'z16PYA', 'z23DIP', 'z40OGL']) {
  const nodes = { z07CSI: [15,16,17,19,20,21,22,24,25,27,28,29], z13CAI: [33,51], z14OSD: [34,45], z16PYA: [36,38,40], z23DIP: [47,50], z40OGL: [64,66] }[zone];   // = the story nodes of zone ids z90CAS / z90ADV / z90OSD / z90PYA / z90DIP / z90OGL
  const scene = sceneOf(ctx, zone); const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
  console.log(`\n${zone}: story nodes ${nodes.join(',')}`);
  for (const node of nodes) {
    const m = new Map([[0x58, node], [2, 1]]);
    let emu; try { emu = profileFor(zone, pe, scene, undefined, { emuVars: { get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) }, archive }).emu; } catch (e) { console.log(node, 'ERR', e.message); continue; }
    const t = emu.calls.filter((c) => /^textFile2?$/.test(c.name ?? '')).map((c) => `${c.name === 'textFile' ? 'npc' : 'hol'}=${emu.mem.cstr(c.args[0], 80).split('/').pop()}`);
    console.log(`  node ${node}: ${t.join(' ') || '-'}  slots: ${emu.cutscenes.map((c) => c.slot + ':' + c.name).join(' ') || '-'}`);
  }
}
