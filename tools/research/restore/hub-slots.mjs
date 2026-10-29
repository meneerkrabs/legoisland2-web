#!/usr/bin/env node
// Restore audit (section 9): cutscene slots declared by the EMULATED set-up of every hub per story node.
//   node --experimental-strip-types tools/research/restore/hub-slots.mjs
// (cwd = the repo root; pattern of tools/m5-hub-survey.mjs)
import { standaloneCtx } from '../../lib/ctx-standalone.mjs';
import { loadExe, sceneOf } from '../../lib/engine-load.mjs';
import { profileFor } from '../../../src/game/setup.ts';
import '../../../src/zones/index.ts';
const HUBS = { z07CSI: [15,16,17,19,20,21,22,24,25,27,28,29], z13CAI: [33,51], z14OSD: [34,45], z16PYA: [36,38,40], z23DIP: [47,50], z40OGL: [64,66] };
const ctx = standaloneCtx();
const pe = loadExe(ctx.dataRoot);
for (const [zone, nodes] of Object.entries(HUBS)) {
  const scene = sceneOf(ctx, zone);
  const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
  for (const node of nodes) {
    const m = new Map([[0x58, node], [2, 1]]);
    const emu = profileFor(zone, pe, scene, undefined, { emuVars: { get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) }, archive }).emu;
    console.log(zone, node, 'slots', JSON.stringify(emu.cutsceneSlots), emu.cutscenes.map((c) => `${c.slot}:${c.name}(${c.messages ?? ''})`).join(' '));
  }
}
