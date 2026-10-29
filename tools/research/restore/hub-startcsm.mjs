#!/usr/bin/env node
// Restore audit (section 9): (ctor 0x51e19c only: 0x51ea3c = the box portals PORS / PZ.. are also named 'StartCSM' by the emulation but have another argument layout)
// per hub node, the StartCSM triggers of the EMULATED set-up (decoded like src/island/trigger/startcsm.ts) and which declared cutscene slots no trigger starts.
//   node --experimental-strip-types tools/research/restore/hub-startcsm.mjs
import { standaloneCtx } from '../../lib/ctx-standalone.mjs';
import { loadExe, sceneOf } from '../../lib/engine-load.mjs';
import { profileFor } from '../../../src/game/setup.ts';
import { decodeStartCsm } from '../../../src/island/trigger/startcsm.ts';
import { ArgView } from '../../../src/island/args.ts';
import '../../../src/zones/index.ts';
const ctx = standaloneCtx(); const pe = loadExe(ctx.dataRoot);
const HUBS = { z07CSI: [15,16,17,19,20,21,22,24,25,27,28,29], z13CAI: [33,51], z14OSD: [34,45], z16PYA: [36,38,40], z23DIP: [47,50], z40OGL: [64,66] };
for (const [zone, nodes] of Object.entries(HUBS)) {
  const scene = sceneOf(ctx, zone); const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
  for (const node of nodes) {
    const m = new Map([[0x58, node], [2, 1]]);
    const emu = profileFor(zone, pe, scene, undefined, { emuVars: { get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) }, archive }).emu;
    const declared = new Map(emu.cutscenes.map((c) => [c.slot, c.name]));
    const started = new Set();
    const rows = [];
    for (const a of emu.attaches.filter((x) => x.ctor === 0x51e19c)) {
      const s = decodeStartCsm(ArgView.of(a));
      if (s.slot >= 0) started.add(s.slot);
      rows.push(`${emu.records[a.record]?.name}: slot ${s.slot}${declared.has(s.slot) ? '=' + declared.get(s.slot) : ''} gate(var ${a.var} mask 0x${(a.mask ?? 0).toString(16)} value ${a.value}) op ${s.op} var ${s.opVar}:=${s.opValue} wps ${s.waypoints?.length ?? 0}`);
    }
    const never = [...declared].filter(([k]) => !started.has(k)).map(([k, v]) => `${k}:${v}`);
    console.log(`${zone} node ${node}: declared ${[...declared].map(([k, v]) => k + ':' + v).join(' ') || '-'}  NOT STARTED BY ANY StartCSM: ${never.join(' ') || '-'}`);
    for (const r of rows) console.log('    ' + r);
  }
}
