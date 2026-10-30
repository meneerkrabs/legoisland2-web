// WP-SAVE (hubs z14OSD / z16PYA / z23DIP / z40OGL): the save blocks of the hub nodes at the set-up state, like m8-save-nodes but with the z14OSD code range as an extra host for the
// shared constructors (Gems / scorpion / Tumblewd live in z14OSD's range; z16PYA and z23DIP attach them).  M8_ZONES=z14OSD,... M8_ONLY=0x62ad35,...
import { nativeNodes, portNodes, compareBlocks, origBlock, hex } from '../lib/m8-save.mjs';
import { hubOracle } from '../lib/m8-save-hubs.mjs';
import { RECORDS_BASE } from '../lib/m7-isl-veh-emu.mjs';
/** the zones' roster / decor constructor tails (FUN_00655de3 ..., past `zoneCodeIndex`'s hi): the record variant words after the original's constructors */
const ROSTER_EXEC = { z14OSD: [[0x655000, 0x656500]], z16PYA: [[0x698000, 0x699000]], z23DIP: [[0x765000, 0x765500]], z40OGL: [[0x811000, 0x811700]] };

const ONLY = process.env.M8_ONLY ? new Set(process.env.M8_ONLY.split(',').map((x) => Number(x))) : null;
const ZONES = process.env.M8_ZONES ? process.env.M8_ZONES.split(',') : ['z14OSD', 'z16PYA', 'z23DIP', 'z40OGL'];
export const MINE = new Set([0x629d7e, 0x62ad35, 0x62af8d, 0x62b220, 0x62ba3b, 0x727e84, 0x677350, 0x7281aa, 0x7e31fc, 0x7e4f9c, 0x7e539e, 0x7e5ea7, 0x7e61e9, 0x7e6498, 0x7e69a2, 0x7e6bb2]);

export default {
  name: 'm8-save-hubs',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    for (const z of ZONES) {
      const B = hubOracle(ctx, z, { extraExec: ROSTER_EXEC[z] });
      for (const f of B.failed) failures.push(`${z}: native constructor failed: ${f}`);
      for (const [i, r] of B.P.world.records.entries()) {
        const o = nativeNodes(B.emu, i).map((n) => n.ctor), p = portNodes(r).map((n) => n.ctor);
        const om = o.filter((c) => MINE.has(c)), pm = p.filter((c) => MINE.has(c));
        checked++;
        if (om.join() !== pm.join()) failures.push(`${z} rec ${i} ${r.name}: my constructors: original [${om.map((x) => x.toString(16))}] port [${pm.map((x) => x.toString(16))}]  (full original [${o.map((x) => x.toString(16))}] port [${p.map((x) => x.toString(16))}])`);
      }
      if (process.env.M8_DUMP) for (const [i, r] of B.P.world.records.entries()) for (const n of nativeNodes(B.emu, i)) if ((ONLY ?? MINE).has(n.ctor)) { const b = origBlock(B.emu, n); notes.push(`${z} rec ${i} ${r.name} 0x${n.ctor.toString(16)} state ${n.state.toString(16)} ${b ? hex(b) : '-'}`); }
      { // the records' variant words (+0x64): the original's constructors (the roster / decor tails run natively) against the port's set-up
        const m = B.emu.cpu.mem, dif = [];
        B.P.world.records.forEach((r, i) => { const o = m.r32(RECORDS_BASE + i * 0x68 + 0x64) >>> 0; checked++; if (o !== (r.variant >>> 0)) dif.push(`${r.name}#${i} 0x${o.toString(16)}/0x${(r.variant >>> 0).toString(16)}`); });
        if (dif.length) failures.push(`${z}: ${dif.length} records with another variant word (original / port): ${dif.slice(0, 8).join(', ')}`);
      }
      const res = compareBlocks(B.P.world, B.emu, z, ONLY ?? MINE);
      checked += res.checked;
      for (const f of res.failures.slice(0, 40)) failures.push(f);
      for (const [k, v] of res.byCtor) notes.push(`${z} ${k} saver 0x${v.saver.toString(16)} loader 0x${v.loader.toString(16)} block ${v.size} nodes ${v.n} ${v.bad ? 'DIFFERENT ' + v.bad : 'ok'}`);
    }
    return { checked, failures, notes };
  },
};
