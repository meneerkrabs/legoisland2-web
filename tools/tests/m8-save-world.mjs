// WP-SAVE: the whole save file. The ORIGINAL's writer FUN_00418ec7 runs natively on the machine that holds the original's own set-up state (every node built by the original's constructors) and its bytes
// are compared, section by section, with the port's `captureWorld` + `encodeSave` for the same game (the port's world after the zone game's set-up work). Zones: the island eras and the six hubs.
//   M8_ZONES=isl2,z07CSI node tools/test-formats.mjs --only m8-save-world
import { buildIslandOracle, buildHubOracle, hex, firstDiff, maskRanges, islandLoaderRigs } from '../lib/m8-save.mjs';
import { installSaveHost, syncGlobalsFromPort, originalWrite, RECORDS_BASE } from '../lib/m8-save-world.mjs';
import { setIslandRandom } from '../../src/island/rng.ts';
import { captureWorld, tagOf, listedNodes } from '../../src/shell/saveworld.ts';
import { newSaveFromGame, encodeSave, decodeSave, saveChecksum, VARS_FIRST, VARS_COUNT } from '../../src/shell/save.ts';
import { guarded } from '../lib/inject-guard.mjs';

const STRICT_CLIPS = process.env.M8_STRICT_CLIPS === '1';
const ZONES = process.env.M8_ZONES ? process.env.M8_ZONES.split(',') : ['isl2', 'isl16', 'isl37', 'isl56', 'isl61', 'z07CSI', 'z13CAI', 'z14OSD', 'z16PYA', 'z23DIP', 'z40OGL'];
const tagName = (t) => String.fromCharCode(t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff, (t >>> 24) & 0xff);

const __test = {
  name: 'm8-save-world',
  run(ctx) {
    setIslandRandom(() => 0);
    try { return this.body(ctx); } finally { setIslandRandom(null); }
  },
  body(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 80) failures.push(m); };
    const same = (a, b, what) => { checked++; if (a.length !== b.length || firstDiff(a, b) >= 0) { const d = firstDiff(a, b); bad(`${what}: first difference at ${d}: original ${hex(a.subarray(Math.max(0, d - 4), d + 12))} port ${hex(b.subarray(Math.max(0, d - 4), d + 12))} (lengths ${a.length} / ${b.length})`); } };
    for (const z of ZONES) {
      let B;
      try { B = z.startsWith('isl') ? buildIslandOracle(ctx, Number(z.slice(3)), { animTokens: true, loaderRigs: islandLoaderRigs(ctx, Number(z.slice(3))) }) : buildHubOracle(ctx, z, { animTokens: true }); } catch (e) { bad(`${z}: oracle build failed: ${e.stack || e}`); continue; }
      const { P, emu } = B, W = P.world;
      installSaveHost(emu);
      syncGlobalsFromPort(emu, W);
      // FUN_0042207d(PEPP) at the start of the zone loop: Pepper's walker on PATH (the oracle's set-up ends with the constructors; the port's world setup does this too)
      emu.cpu.steps = 0; emu.cpu.call(0x42207d, [RECORDS_BASE + P.pepper.index * 0x68], { maxSteps: 5_000_000 });
      const TIME = 1234567;
      const o = originalWrite(emu, 0, TIME);
      if (!o.bytes || o.ret !== 1) { bad(`${z}: the original's writer returned ${o.ret}`); continue; }
      const save = newSaveFromGame({ vars: W.vars.a, subgame: W.vars.get(0x59), fsmState: W.vars.get(0x58), time: TIME, ...captureWorld(W) });
      const mine = encodeSave(save);
      const od = decodeSave(o.bytes), pd = decodeSave(mine);
      // sections
      checked++; if (od.subgame !== pd.subgame || od.fsmState !== pd.fsmState || od.time !== pd.time) bad(`${z}: header ${od.subgame},${od.fsmState},${od.time} vs ${pd.subgame},${pd.fsmState},${pd.time}`);
      same(new Uint8Array(od.vars.buffer, od.vars.byteOffset, od.vars.byteLength), new Uint8Array(pd.vars.buffer, pd.vars.byteOffset, pd.vars.byteLength), `${z} vars`);
      same(od.walkers, pd.walkers, `${z} walker table`);
      same(new Uint8Array(od.walkerTags.buffer, od.walkerTags.byteOffset, od.walkerTags.byteLength), new Uint8Array(pd.walkerTags.buffer, pd.walkerTags.byteOffset, pd.walkerTags.byteLength), `${z} walker tags`);
      same(od.camera, pd.camera, `${z} camera`);
      checked++; if (od.frameCounter !== pd.frameCounter) bad(`${z}: frame counter ${od.frameCounter} vs ${pd.frameCounter}`);
      // object records: which records have an animation instance (the clip / frame values of the oracle's instances are the hosted starts of its constructors: reported, not failed, except for the hubs'
      // loader instances which the emulated set-up gives exactly)
      checked++;
      {
        const key = (x) => tagName(x.tag), skipPepper = (x) => tagName(x.tag) !== 'PEPP', full = (x) => `${tagName(x.tag)}:${x.animState}:${x.animFrame}`;
        const sa = od.objects.map(key), sb = pd.objects.map(key);
        if (sa.join() !== sb.join()) {
          const A = new Set(sa), Bs = new Set(sb);
          bad(`${z}: object records differ: original ${sa.length} port ${sb.length}; only original: ${sa.filter((x) => !Bs.has(x)).slice(0, 10)}; only port: ${sb.filter((x) => !A.has(x)).slice(0, 10)}`);
        } else {
          const fa = od.objects.map((x) => (skipPepper(x) ? full(x) : 'PEPP')), fb = pd.objects.map((x) => (skipPepper(x) ? full(x) : 'PEPP'));   // (Pepper's own instance is driven by the walk node, verified by the walk duels; the oracle's is the port's mirror)
          const dif = fa.map((x, i) => (x === fb[i] ? null : `${x} / ${fb[i]}`)).filter(Boolean);
          if (dif.length) (STRICT_CLIPS ? bad : (m) => notes.push(m))(`${z}: ${dif.length} object records with another clip / frame (original / port): ${dif.slice(0, 10).join(', ')}`);
        }
      }
      same(od.decor, pd.decor, `${z} decor blob`);
      // the variant words (+0x64) of the records: not in the file, but the decor blob of the group is refreshed from them and vehicles / outfits read them
      {
        checked++;
        const mem = emu.cpu.mem, dif = [];
        W.records.forEach((r, i) => { const o = mem.r32(RECORDS_BASE + i * 0x68 + 0x64) >>> 0, p = r.variant >>> 0; if (o !== p) dif.push(`${r.name}#${i} 0x${o.toString(16)}/0x${p.toString(16)}`); });
        if (dif.length) bad(`${z}: ${dif.length} records have another variant word (+0x64) (original / port): ${dif.slice(0, 10).join(', ')}`);
      }
      // entity section: record by record, the node lists of both are the same (m8-save-nodes), so the port's structure locates every field in both streams
      const ob = od.entityBytes, pb = pd.entityBytes;
      checked++;
      {
        const layout = [];
        for (const r of W.records) { const nodes = listedNodes(r); if (r.ctrl && nodes.length) layout.push({ r, nodes }); }
        let p = 0;
        const dvo = new DataView(ob.buffer, ob.byteOffset, ob.byteLength), dvp = new DataView(pb.buffer, pb.byteOffset, pb.byteLength);
        const diffs = { flags: [], position: [], euler: [], tag: [], node: [], stamp: [] };
        for (const [ri, e] of save.entities.entries()) {
          const L = layout[ri];
          const seg = (off, len) => [ob.subarray(p + off, p + off + len), pb.subarray(p + off, p + off + len)];
          let [a, b] = seg(0, 4); if (firstDiff(a, b) >= 0) diffs.tag.push(tagName(e.tag));
          [a, b] = seg(4, 12); if (firstDiff(a, b) >= 0) diffs.position.push(`${tagName(e.tag)} (${[0, 1, 2].map((k) => dvo.getFloat32(p + 4 + 4 * k, true).toFixed(2))} / ${[0, 1, 2].map((k) => dvp.getFloat32(p + 4 + 4 * k, true).toFixed(2))})`);
          [a, b] = seg(16, 12); if (firstDiff(a, b) >= 0) diffs.euler.push(`${tagName(e.tag)}`);
          [a, b] = seg(28, 2); if (firstDiff(a, b) >= 0) diffs.flags.push(`${tagName(e.tag)} 0x${dvo.getUint16(p + 28, true).toString(16)}/0x${dvp.getUint16(p + 28, true).toString(16)}`);
          let q = 30;
          for (const [k, n] of e.nodes.entries()) {
            const ctor = L.nodes[k].ctor;
            if (dvo.getUint32(p + q, true) !== dvp.getUint32(p + q, true)) diffs.stamp.push(`${tagName(e.tag)}#${k} 0x${ctor.toString(16)} ${dvo.getUint32(p + q, true).toString(16)}/${dvp.getUint32(p + q, true).toString(16)}`);
            q += 4;
            if (n.data) {
              const sz = n.data.length, x = Uint8Array.from(ob.subarray(p + q + 4, p + q + 4 + sz)), y = Uint8Array.from(pb.subarray(p + q + 4, p + q + 4 + sz));
              for (const [lo, hi] of maskRanges(ctor, x)) for (let t = lo; t < hi && t < sz; t++) { x[t] = 0; y[t] = 0; }
              const d = firstDiff(x, y);
              if (d >= 0) diffs.node.push(`${tagName(e.tag)}#${k} 0x${ctor.toString(16)} byte ${d}`);
              q += 4 + sz + 4;
            }
          }
          p += q + 4;
        }
        for (const [k, v] of Object.entries(diffs)) if (v.length) bad(`${z}: ${v.length} records differ in ${k}: ${v.slice(0, 12).join(', ')}${v.length > 12 ? ' ...' : ''}`);
        if (ob.length !== pb.length) bad(`${z}: entity section lengths: original ${ob.length} port ${pb.length}`);
      }
      // bricks
      checked++;
      const bo = od.bricksRaw ?? Uint8Array.from((od.bricks.flatMap((x) => (x ? [...x] : [0])))), bp = pd.bricksRaw ?? Uint8Array.from((pd.bricks.flatMap((x) => (x ? [...x] : [0]))));
      if (bo.length !== bp.length || firstDiff(bo, bp) >= 0) bad(`${z}: brick blobs differ (original ${bo.length} bytes, port ${bp.length})`);
      checked++; if (od.length !== pd.length) bad(`${z}: file length original ${od.length} port ${pd.length}`);
      notes.push(`${z}: ${od.entities.length} entity records, ${od.objects.length} object records, file ${od.length} bytes`);
    }
    return { checked, failures, notes };
  },
};
export default guarded(__test);
