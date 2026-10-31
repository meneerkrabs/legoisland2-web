// WP-SAVE (front end): SaveDef.lgo. The ORIGINAL's front end start runs natively (tools/lib/m8-save-fe.mjs: FUN_00444850, FUN_00471070 with every constructor, FUN_0042207d(record 0)), then its writer
// FUN_00418ec7(-2) (FUN_0041ad71 of the loop FUN_00470ac3) writes the file. The port's front end world (feStageRecords / feStageNodes / feStartWalker of src/shell/frontend.ts, the same code runFrontEnd
// runs) is saved with `captureWorld` + `encodeSave`, the way Shell.writeDefaultSave does, and compared section by section:
//   1  structure and node blocks (constructor lists, +8 words, saver / loader presence, block bytes) with `compareBlocks`
//   2  the whole file: header, variables, walker table + tags, camera, frame counter, object records, decor blob, entity records (headers, node states, node blocks), bricks, file length
//   3  port -> original: the port's world plays N ticks (the nodes' own updates), its file is read by the ORIGINAL's reader FUN_00419c45 / FUN_00419e82 in the oracle machine, whose writer then writes the
//      state it holds: the two files must be equal (everything the port wrote was accepted and kept)
//   4  original -> port: the oracle machine's node fields are moved to other values (scripted), the original's writer writes the file, a SECOND port world loads it with the port's reader
//      (`restoreWorld`) and saves again: equal to the original's file
//   M8_FE_SEEDS=1,7 M8_FE_TICKS=1500 node tools/test-formats.mjs --only m8-save-fe -v
import { buildFeOracle, buildFePort, Lcg } from '../lib/m8-save-fe.mjs';
import { nativeNodes, compareBlocks, hex, firstDiff, maskRanges } from '../lib/m8-save.mjs';
import { originalWrite, originalRead, RECORDS_BASE } from '../lib/m8-save-world.mjs';
import { RF_ENABLED, RF_FRUSTUM } from '../../src/game/record.ts';
import { captureWorld, restoreWorld, listedNodes, tagOf } from '../../src/shell/saveworld.ts';
import { newSaveFromGame, encodeSave, decodeSave, applySaveVars } from '../../src/shell/save.ts';
import { guarded } from '../lib/inject-guard.mjs';

const SEEDS = (process.env.M8_FE_SEEDS ?? '12345,7,2026').split(',').map(Number);
const TICKS = Number(process.env.M8_FE_TICKS ?? 1200);
const tagName = (t) => String.fromCharCode(t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff, (t >>> 24) & 0xff);
/** the front end's loop pass of the port (FUN_00444370 flag 1 then the update pass): the butterflies' frustum flags flip at random, Shift is pressed now and then */
function playPort(W, ticks, seed) {
  const sim = new Lcg(seed ^ 0x5a5a);
  const view = new Map();
  for (let t = 0; t < ticks; t++) {
    for (const r of W.records) {
      if ((r.flags & RF_ENABLED) === 0) { r.flags &= ~RF_FRUSTUM; continue; }
      if (sim.int() % 300 === 0) view.set(r, !(view.get(r) ?? true));
      if (view.get(r) ?? true) r.flags |= RF_FRUSTUM; else r.flags &= ~RF_FRUSTUM;
    }
    W.input.pressed = sim.int() % 40 === 0 ? 0x40 : 0;
    W.tick();
  }
}
const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

const __test = {
  name: 'm8-save-fe',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 80) failures.push(m); };
    const same = (a, b, what) => { checked++; if (a.length !== b.length || firstDiff(a, b) >= 0) { const d = firstDiff(a, b); bad(`${what}: first difference at ${d}: original ${hex(a.subarray(Math.max(0, d - 4), d + 12))} port ${hex(b.subarray(Math.max(0, d - 4), d + 12))} (lengths ${a.length} / ${b.length})`); } };
    const gameOf = (W, time) => newSaveFromGame({ vars: W.vars.a, subgame: W.vars.get(0x59), fsmState: W.vars.get(0x58), time, ...captureWorld(W) });

    /** every section of two decoded files (a = original's, b = port's); `ws` = the port world's records (the layout); `label` for the messages */
    const compareFiles = (label, od, pd, W, saveP, opts = {}) => {
      checked++; if (od.subgame !== pd.subgame || od.fsmState !== pd.fsmState || od.time !== pd.time) bad(`${label}: header ${od.subgame},${od.fsmState},${od.time} vs ${pd.subgame},${pd.fsmState},${pd.time}`);
      same(bytesOf(od.vars), bytesOf(pd.vars), `${label} vars`);
      { const a = Uint8Array.from(od.walkers), b = Uint8Array.from(pd.walkers); if (opts.maskLinks) for (let k = 0; k < 60; k++) for (let q = 0x24; q < 0x30; q++) { a[k * 0x84 + q] = 0; b[k * 0x84 + q] = 0; } same(a, b, `${label} walker table`); }
      same(bytesOf(od.walkerTags), bytesOf(pd.walkerTags), `${label} walker tags`);
      same(od.camera, pd.camera, `${label} camera`);
      checked++; if (od.frameCounter !== pd.frameCounter) bad(`${label}: frame counter ${od.frameCounter} vs ${pd.frameCounter}`);
      // object records: tag, clip and frame (all of them: the instances are tokens of the oracle holding what the original's calls wrote)
      checked++;
      {
        const full = (x) => `${tagName(x.tag)}:${x.animState}:${x.animFrame}`;
        const sa = od.objects.map(full), sb = pd.objects.map(full);
        if (sa.join() !== sb.join()) {
          const dif = sa.map((x, i) => (x === sb[i] ? null : `${x} / ${sb[i]}`)).filter(Boolean);
          bad(`${label}: object records differ (original ${sa.length} port ${sb.length}): ${dif.slice(0, 10).join(', ')}`);
        }
      }
      same(od.decor, pd.decor, `${label} decor blob`);
      // entity section, record by record (both lists have the port's structure, checked by compareBlocks)
      const ob = od.entityBytes, pb = pd.entityBytes;
      checked++;
      {
        const layout = [];
        for (const r of W.records) { const nodes = listedNodes(r); if (r.ctrl && nodes.length) layout.push({ r, nodes }); }
        const dvo = new DataView(ob.buffer, ob.byteOffset, ob.byteLength), dvp = new DataView(pb.buffer, pb.byteOffset, pb.byteLength);
        const diffs = { tag: [], position: [], euler: [], flags: [], stamp: [], node: [] };
        let p = 0;
        for (const [ri, e] of saveP.entities.entries()) {
          const L = layout[ri];
          const seg = (off, len) => [ob.subarray(p + off, p + off + len), pb.subarray(p + off, p + off + len)];
          let [a, b] = seg(0, 4); if (firstDiff(a, b) >= 0) diffs.tag.push(tagName(e.tag));
          [a, b] = seg(4, 12); if (firstDiff(a, b) >= 0) diffs.position.push(`${tagName(e.tag)} (${[0, 1, 2].map((k) => dvo.getFloat32(p + 4 + 4 * k, true))} / ${[0, 1, 2].map((k) => dvp.getFloat32(p + 4 + 4 * k, true))})`);
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
              if (d >= 0) diffs.node.push(`${tagName(e.tag)}#${k} 0x${ctor.toString(16)} byte ${d}: original ${hex(x.subarray(Math.max(0, d - 4), d + 8))} port ${hex(y.subarray(Math.max(0, d - 4), d + 8))}`);
              q += 4 + sz + 4;
            }
          }
          p += q + 4;
        }
        for (const [k, v] of Object.entries(diffs)) if (v.length) bad(`${label}: ${v.length} records differ in ${k}: ${v.slice(0, 12).join(', ')}${v.length > 12 ? ' ...' : ''}`);
        if (ob.length !== pb.length) bad(`${label}: entity section lengths: original ${ob.length} port ${pb.length}`);
      }
      const bo = od.bricksRaw ?? Uint8Array.from(od.bricks.flatMap((x) => (x ? [...x] : [0]))), bp = pd.bricksRaw ?? Uint8Array.from(pd.bricks.flatMap((x) => (x ? [...x] : [0])));
      checked++; if (bo.length !== bp.length || firstDiff(bo, bp) >= 0) bad(`${label}: brick blobs differ (original ${bo.length} bytes, port ${bp.length})`);
      checked++; if (od.length !== pd.length) bad(`${label}: file length original ${od.length} port ${pd.length}`);
    };

    for (const seed of SEEDS) {
      const B = buildFeOracle(ctx, seed);
      try {
        const { W, emu } = B;
        const label = `seed ${seed}`;
        // 1. structure + blocks
        {
          let n = 0;
          for (const [i, r] of W.records.entries()) {
            const on = nativeNodes(emu, i).map((x) => x.ctor), pn = listedNodes(r).map((x) => x.ctor);
            checked++; if (on.join() !== pn.join()) bad(`${label}: record ${i} ${r.name}: constructors original [${on.map((c) => c.toString(16))}] port [${pn.map((c) => c.toString(16))}]`);
            n += on.length;
          }
          const cb = compareBlocks(W, emu, label);
          checked += cb.checked;
          for (const f of cb.failures.slice(0, 10)) bad(f);
          notes.push(`${label}: ${n} nodes on ${W.records.filter((r) => listedNodes(r).length).length} records; per constructor: ${[...cb.byCtor].map(([k, s]) => `${k} x${s.n} saver 0x${s.saver.toString(16)} loader 0x${s.loader.toString(16)} size ${s.size}`).join('; ')}`);
        }
        // 2. the whole file
        const TIME = 1234567;
        const o = originalWrite(emu, 0xfffffffe, TIME);
        if (!o.bytes || o.ret !== 1) { bad(`${label}: the original's writer returned ${o.ret}`); continue; }
        checked++; if (!/SaveDef\.lgo$/.test(o.name ?? '')) bad(`${label}: the original wrote ${o.name}`);
        const save = gameOf(W, TIME), mine = encodeSave(save);
        const od = decodeSave(o.bytes), pd = decodeSave(mine);
        compareFiles(label, od, pd, W, save);
        checked++; if (mine.length !== o.bytes.length || firstDiff(mine, o.bytes) >= 0) {
          // bytes outside the masked pointer ranges must be equal: the node pointer words were compared masked above; report the raw difference count only
          let nd = 0; for (let i = 0; i < Math.min(mine.length, o.bytes.length); i++) if (mine[i] !== o.bytes[i]) nd++;
          notes.push(`${label}: the two files differ in ${nd} bytes before masking (checksum words included; the masked ranges are listed in tools/lib/m8-save.mjs maskRanges)`);
        } else notes.push(`${label}: the port's SaveDef.lgo equals the original's byte for byte (${mine.length} bytes)`);
        notes.push(`${label}: ${od.entities.length} entity records, ${od.objects.length} object records, var 0xc5 ${od.vars[0xc5]}, camera ${Array.from(new Float32Array(od.camera.buffer.slice(od.camera.byteOffset, od.camera.byteOffset + 0x48))).map((v) => +v.toFixed(3)).join(',')}`);

        // 3. port -> original: the port plays, the ORIGINAL's reader takes its file, the original's writer writes what it holds
        {
          playPort(W, TICKS, seed);
          const T3 = 7654321;
          const sv = gameOf(W, T3), file = encodeSave(sv), fd = decodeSave(file);
          const rd = originalRead(emu, file, 0);
          checked++;
          if (!rd.ok || rd.ret !== 1) bad(`${label} port -> original: the original's reader ${rd.ok ? 'returned ' + rd.ret : 'rejected the header'}`);
          else {
            const o3 = originalWrite(emu, 0xfffffffe, T3);
            if (!o3.bytes) bad(`${label} port -> original: the original's writer returned ${o3.ret}`);
            else compareFiles(`${label} port -> original`, decodeSave(o3.bytes), fd, W, sv, { maskLinks: true });
            const d = fd.entityBytes; notes.push(`${label}: port played ${TICKS} ticks (Pepper dir ${W.records[0].ctrl.nodes[0].dir}, counter ${W.records[0].ctrl.nodes[0].counter}, train phase ${W.records[44].ctrl.nodes[0].phase}), its ${file.length} byte file read by the original's reader (returned ${rd.ret}), entity section ${d.length} bytes`);
          }
        }
        // 4. original -> port: the oracle machine's node state is moved (the engine's tokens / camera / decor too), the original writes, a second port world reads and saves again
        {
          const mem = emu.cpu.mem, r = new Lcg(seed * 31 + 5), f = (lo, hi) => lo + (hi - lo) * r.next();
          const node = (i, k = 0) => nativeNodes(emu, i)[k].ptr;
          const w32 = (a, v) => mem.w32(a, v | 0), wf = (a, v) => mem.wf32(a, v);
          { const n = node(0); w32(n + 0x24, 0); w32(n + 0x28, r.int() & 1); w32(n + 0x2c, r.int() % 400); wf(n + 0x30, f(0, 399)); w32(n + 0x34, (r.int() % 11) - 1); w32(n + 0x38, r.int() % 60); }
          { const n = node(8); const c = 300 + (r.int() % 300); wf(n + 0x18, c); w32(n + 0x1c, c); }
          { const n = node(44); const c = 1 + (r.int() % 700); wf(n + 0x18, c); w32(n + 0x1c, c); w32(n + 0x20, r.int() & 1); }
          { const n = node(2); const c = r.int() % 600; wf(n + 0x18, c); w32(n + 0x1c, c); w32(n + 0x20, r.int() % 4); }
          for (let i = 35; i <= 41; i++) { const n = node(i); wf(n + 0x34, f(-1, 1)); w32(n + 0x38, [0, 2][r.int() & 1]); w32(n + 0x3c, r.int() % 12); w32(n + 0x40, r.int() % 12); wf(n + 0x44, f(-0.05, 0.05)); w32(n + 0x48, r.int() % 210); w32(n + 0x4c, r.int() & 1 ? RECORDS_BASE : 0); wf(n + 0x50, f(0.01, 0.3)); wf(n + 0x54, f(0, 6)); }
          // records: positions, euler angles, flags (+0x60 word), animation instances (valid clips / frames only: the token host has no rig to refuse a clip like the real FUN_0043b6a3)
          for (const i of [0, 2, 8, 35, 38, 44]) { const a = RECORDS_BASE + i * 0x68; wf(a + 0xc + 4 * 12, f(-40, 40)); wf(a + 0xc + 4 * 13, f(0, 20)); wf(a + 0xc + 4 * 14, f(-10, 60)); wf(a + 0x4c, f(-3, 3)); wf(a + 0x50, f(-3, 3)); wf(a + 0x54, f(-3, 3)); mem.w16(a + 0x60, [0, 2, 3, 0x13][r.int() & 3]); }
          for (let i = 0; i <= 21; i++) {
            const t = mem.r32(RECORDS_BASE + i * 0x68 + 8), rig = W.records[i].anim.rig;
            const c = 1 + (r.int() % Math.min(3, rig.clips.length - 1)), fc = rig.clips[c].frameCount;
            w32(t + 0xc, c); wf(t + 0x10, r.int() % (fc + 1));
          }
          for (let k = 0; k < 18; k++) wf(0x9da5e8 + 4 * k, f(-20, 20));
          w32(0x9da5cc, 100 + (r.int() % 100000));
          for (let i = 0; i < 0x380; i++) mem.w8(0x9d9fd0 + i, r.int() & 0xff);
          for (const v of [0x58, 0x5a, 0x80, 0xa3, 0xc5]) w32(0x8a2d2c + 4 * v, r.int() % 7);
          const T4 = 4242424;
          const o4 = originalWrite(emu, 0xfffffffe, T4);
          checked++;
          if (!o4.bytes) bad(`${label} original -> port: the original's writer returned ${o4.ret}`);
          else {
            const od4 = decodeSave(o4.bytes);
            // a second port world: the same start, played for a while, then it loads the original's file
            const rq = new Lcg(seed + 99);
            const Q = buildFePort(ctx, rq);
            try {
              playPort(Q.W, 300, seed + 3);
              applySaveVars({ vars: od4.vars }, Q.W.vars);
              const ok = restoreWorld(Q.W, od4);
              checked++;
              if (!ok) bad(`${label} original -> port: the port's reader stopped before the end of the original's file`);
              else {
                const sv2 = gameOf(Q.W, T4);
                compareFiles(`${label} original -> port`, od4, decodeSave(encodeSave(sv2)), Q.W, sv2, { maskLinks: true });
              }
            } finally { Q.restore(); }
          }
        }
      } finally { B.restore(); }
    }
    return { checked, failures, notes };
  },
};
export default guarded(__test);
