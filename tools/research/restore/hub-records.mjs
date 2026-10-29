#!/usr/bin/env node
// Restore audit (section 9): records of a hub by name (flags, attach ctor per node) from the EMULATED set-up.
//   node --experimental-strip-types tools/research/restore/hub-records.mjs z07CSI 16,19,22,25,28 CAVL LAR4 BAR4 LGRD BGRD
import { standaloneCtx } from '../../lib/ctx-standalone.mjs';
import { loadExe, sceneOf } from '../../lib/engine-load.mjs';
import { profileFor } from '../../../src/game/setup.ts';
import '../../../src/zones/index.ts';
const [zone, nodes, ...names] = process.argv.slice(2);
const ctx = standaloneCtx(); const pe = loadExe(ctx.dataRoot);
const scene = sceneOf(ctx, zone); const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
for (const node of nodes.split(',').map(Number)) {
  const m = new Map([[0x58, node], [2, 1]]);
  const emu = profileFor(zone, pe, scene, undefined, { emuVars: { get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) }, archive }).emu;
  console.log('node', node);
  for (const n of names) {
    const idx = emu.records.map((r, i) => (r.name?.toUpperCase().startsWith(n) ? i : -1)).filter((i) => i >= 0);
    console.log('  ', n, idx.map((i) => { const r = emu.records[i]; const at = emu.attaches.filter((a) => a.record === i).map((a) => a.ctorName); return `${r.name}#${i} flags=0x${(r.flags ?? 0).toString(16)} attach=[${at.join(',')}]`; }).join('; ') || '(no record)');
  }
}
