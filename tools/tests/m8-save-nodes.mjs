// WP-SAVE: the save block of every node of the island (4 story eras + era 4) and the six hubs, at the state the set-up leaves: the ORIGINAL's constructors build every node natively in the x86
// emulation (tools/lib/m8-save.mjs), the original's serializer (vtable +0x14) writes its block, the port's `saveBlock` must give the same bytes; node lists (constructor sequence per record),
// the existence of a serializer / loader and the +8 state words must agree too.
//   M8_ONLY=0x42f470,0x4bec00  node test.mjs-style focus on constructors;  M8_ZONES=isl2,isl56,z07CSI  zones to run
import { buildIslandOracle, buildHubOracle, nativeNodes, portNodes, compareBlocks } from '../lib/m8-save.mjs';
import { setIslandRandom } from '../../src/island/rng.ts';

const ONLY = process.env.M8_ONLY ? new Set(process.env.M8_ONLY.split(',').map((x) => Number(x))) : null;
const ZONES = process.env.M8_ZONES ? process.env.M8_ZONES.split(',') : ['isl2', 'isl16', 'isl37', 'isl56', 'isl61', 'z07CSI', 'z13CAI', 'z14OSD', 'z16PYA', 'z23DIP', 'z40OGL'];
/** constructors the port does not build yet (placeholders land here until a worker ports them) */
const KNOWN_UNPORTED = new Set([]);

export default {
  name: 'm8-save-nodes',
  run(ctx) {
    // the port's lazy constructor halves (SUPE's destination ...) draw random numbers when the block is first asked for: the oracle's rand is scripted to 0, so is the port's
    setIslandRandom(() => 0);
    try { return this.body(ctx); } finally { setIslandRandom(null); }
  },
  body(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const agg = new Map();
    for (const z of ZONES) {
      let B;
      try { B = z.startsWith('isl') ? buildIslandOracle(ctx, Number(z.slice(3))) : buildHubOracle(ctx, z, z.startsWith('z') ? {} : {}); } catch (e) { failures.push(`${z}: oracle build failed: ${e.message}`); continue; }
      for (const f of B.failed) if (!ONLY) failures.push(`${z}: native constructor failed: ${f}`);
      // structure: the constructor sequence of every record
      for (const [i, r] of B.P.world.records.entries()) {
        const o = nativeNodes(B.emu, i).map((n) => n.ctor), p = portNodes(r).map((n) => n.ctor);
        checked++;
        if (o.join() !== p.join() && !(ONLY && !o.concat(p).some((c) => ONLY.has(c))) && !o.concat(p).every((c) => KNOWN_UNPORTED.has(c) || p.includes(c) === o.includes(c))) failures.push(`${z} rec ${i} ${r.name}: node list original [${o.map((x) => x.toString(16))}] port [${p.map((x) => x.toString(16))}]`);
      }
      const res = compareBlocks(B.P.world, B.emu, z, ONLY);
      checked += res.checked;
      for (const f of res.failures.slice(0, 30)) if (!failures.includes(f)) failures.push(f);
      for (const [k, v] of res.byCtor) { const a = agg.get(k) ?? { n: 0, bad: 0, saver: v.saver, loader: v.loader, size: v.size, zones: new Set() }; a.n += v.n; a.bad += v.bad; if (v.bad && !a.first) a.first = v.first; a.zones.add(z); agg.set(k, a); }
    }
    const hx = (v) => (v ? '0x' + v.toString(16) : '-');
    for (const [k, v] of [...agg].sort((a, b) => Number(a[0]) - Number(b[0]))) notes.push(`${k.padEnd(9)} saver ${hx(v.saver).padEnd(9)} loader ${hx(v.loader).padEnd(9)} block ${String(v.size < 0 ? 'none' : v.size).padStart(4)} bytes  nodes ${String(v.n).padStart(4)}  ${v.bad ? 'DIFFERENT ' + v.bad + '  first: ' + (v.first ?? '') : 'ok'}`);
    notes.push(`constructors compared ${agg.size}; with differing blocks: ${[...agg].filter(([, v]) => v.bad).length}`);
    return { checked, failures, notes };
  },
};
