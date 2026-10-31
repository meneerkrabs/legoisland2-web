// WP-SAVE: the ORIGINAL's file -> the port's reader. The machine that holds the original's nodes (every node built by the original's constructors) runs the original's passes (FUN_0042226e / FUN_004225c5 over the whole
// record array, with the engine hosted as in the m7 oracles) for a number of ticks with scripted buttons: a state only the original's code produced. The original's writer FUN_00418ec7 writes it; a SECOND port
// world (played for a while, so that its state differs) loads that file with the port's reader (`restoreWorld`, the vars first like the shell) and saves again: every section must come out as the original wrote it
// (record headers, node blocks, object records, walker table (links masked: the loader rebuilds them), camera, frame counter, decor).
//   M8_TICKS=120 M8_ZONES=isl2 node tools/test-formats.mjs --only m8-save-original-to-port -v
import { buildIslandOracle, buildHubOracle, hex, firstDiff, maskRanges, islandLoaderRigs } from '../lib/m8-save.mjs';
import { installSaveHost, installMathHosts, syncGlobalsFromPort, originalWrite } from '../lib/m8-save-world.mjs';
import { hold } from '../lib/island-load.mjs';
import { setIslandRandom } from '../../src/island/rng.ts';
import { captureWorld, restoreWorld, listedNodes, tagOf } from '../../src/shell/saveworld.ts';
import { newSaveFromGame, encodeSave, decodeSave, applySaveVars } from '../../src/shell/save.ts';
import { guarded } from '../lib/inject-guard.mjs';

const ZONES = process.env.M8_ZONES ? process.env.M8_ZONES.split(',') : ['isl2', 'isl16', 'isl37', 'isl56'];
const TICKS = Number(process.env.M8_TICKS ?? 120);
const tagName = (t) => String.fromCharCode(t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff, (t >>> 24) & 0xff);
const B_ = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8 };

const __test = {
  name: 'm8-save-original-to-port',
  run(ctx) {
    let seed = 24681357;
    setIslandRandom(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; });
    try { return this.body(ctx); } finally { setIslandRandom(null); }
  },
  body(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 80) failures.push(m); };
    for (const z of ZONES) {
      const opts = { animTokens: true };
      const B = z.startsWith('isl') ? buildIslandOracle(ctx, Number(z.slice(3)), { ...opts, loaderRigs: islandLoaderRigs(ctx, Number(z.slice(3))) }) : buildHubOracle(ctx, z, opts);
      const { P, emu } = B, W = P.world;
      installSaveHost(emu); installMathHosts(emu);
      syncGlobalsFromPort(emu, W);
      emu.cpu.steps = 0; emu.cpu.call(0x42207d, [0x10000000 + P.pepper.index * 0x68], { maxSteps: 5_000_000 });
      // the original plays: scripted buttons
      emu.setFocus(P.pepper.index);
      let held = 0, prev = 0, ran = 0, err = null;
      try {
        for (let t = 0; t < TICKS; t++) {
          if (t % 17 === 0) held = [0, B_.UP, B_.UP | B_.LEFT, B_.UP | B_.RIGHT, B_.DOWN][(t / 17) % 5 | 0];
          emu.passes(held, (held ^ prev) & held, {}); prev = held; ran++;
        }
      } catch (e) { err = e; }
      if (err) notes.push(`${z}: the original's passes stopped after ${ran} ticks: ${String(err.message ?? err).slice(0, 120)}`);
      const TIME = 4242424;
      const o = originalWrite(emu, 0, TIME);
      if (!o.bytes) { bad(`${z}: the original's writer returned ${o.ret}`); continue; }
      const od = decodeSave(o.bytes);
      // a second port world: the same set-up, played for a while, then it loads the original's file
      const Bq = z.startsWith('isl') ? buildIslandOracle(ctx, Number(z.slice(3)), {}) : buildHubOracle(ctx, z, {});
      const Q = Bq.P, QW = Q.world;
      hold(Q, ['ArrowUp'], 40); hold(Q, ['ArrowLeft'], 25);
      applySaveVars({ vars: od.vars }, QW.vars);   // the shell applies the file's variables before the world sections
      const okLoad = restoreWorld(QW, od);
      checked++;
      if (!okLoad) { bad(`${z}: the port's reader stopped before the end of the original's file`); continue; }
      const save2 = newSaveFromGame({ vars: QW.vars.a, subgame: QW.vars.get(0x59), fsmState: QW.vars.get(0x58), time: TIME, ...captureWorld(QW) });
      const mine = encodeSave(save2), pd = decodeSave(mine);
      const cmp = (a, b, what) => { checked++; const d = firstDiff(a, b); if (a.length !== b.length || d >= 0) bad(`${z} ${what}: first difference at ${d}: original ${hex(a.subarray(Math.max(0, d - 4), d + 12))} port after the load ${hex(b.subarray(Math.max(0, d - 4), d + 12))}`); };
      cmp(new Uint8Array(od.vars.buffer), new Uint8Array(pd.vars.buffer), 'vars');
      { const a = Uint8Array.from(od.walkers), b = Uint8Array.from(pd.walkers); for (let k = 0; k < 60; k++) for (let q = 0x24; q < 0x30; q++) { a[k * 0x84 + q] = 0; b[k * 0x84 + q] = 0; } cmp(a, b, 'walker table (links masked)'); }
      cmp(od.camera, pd.camera, 'camera');
      checked++; if (od.frameCounter !== pd.frameCounter) bad(`${z}: frame counter ${od.frameCounter} -> ${pd.frameCounter}`);
      cmp(od.decor, pd.decor, 'decor');
      // objects
      checked++;
      { const key = (x) => `${tagName(x.tag)} ${x.animState}:${x.animFrame}`; const dupT = new Map(); for (const r of QW.records) if (r.anim) dupT.set(tagOf(r.name), (dupT.get(tagOf(r.name)) ?? 0) + 1); const a = od.objects.map(key), b = pd.objects.map(key); const tooBig = (i) => { const r = QW.records.find((q) => tagOf(q.name) === od.objects[i].tag); return !!r?.anim && od.objects[i].animState >= r.anim.clips.length; };   /* the oracle's hosted FUN_0043b6a3 has no rig to check the clip against; the real one refuses a clip >= the rig's clip count */
      const dif = a.map((x, i) => (dupT.get(od.objects[i].tag) > 1 || tooBig(i) || x === b[i] ? null : `${x} -> ${b[i]}`)).filter(Boolean); if (a.length !== b.length || dif.length) bad(`${z}: ${dif.length} object records differ after the port's load (original -> port): ${dif.slice(0, 8).join(', ')}`); }
      // entities
      const layout = []; for (const r of QW.records) { const nodes = listedNodes(r); if (r.ctrl && nodes.length) layout.push({ r, nodes }); }
      const ob = od.entityBytes, pb = pd.entityBytes;
      checked++;
      if (ob.length !== pb.length || firstDiff(ob, pb) >= 0) {
        let p = 0; const diffs = [];
        const tagCount = new Map(); for (const r of QW.records) tagCount.set(tagOf(r.name), (tagCount.get(tagOf(r.name)) ?? 0) + 1);   // records that share a name are all restored from the LAST entry of that name onto the FIRST record (FUN_00419a79): not comparable
        for (const [ri, e] of save2.entities.entries()) {
          let len = 4 + 26 + 4;
          for (const n of e.nodes) len += 4 + (n.data ? 8 + n.data.length : 0);
          const a = Uint8Array.from(ob.subarray(p, p + len)), b = Uint8Array.from(pb.subarray(p, p + len));
          let q = 30;
          for (const [k, n] of e.nodes.entries()) { q += 4; if (n.data) { for (const [lo, hi] of maskRanges(layout[ri].nodes[k].ctor, n.data)) for (let t = lo; t < hi; t++) { a[q + 4 + t] = 0; b[q + 4 + t] = 0; } q += 8 + n.data.length; } }
          const d = tagCount.get(e.tag) > 1 ? -1 : firstDiff(a, b);
          if (d >= 0) {
            const what = d < 4 ? 'tag' : d < 16 ? 'position' : d < 28 ? 'euler' : d < 30 ? 'flags' : 'node data / state';
            let qq = 30, which = '';
            for (const [k, n] of e.nodes.entries()) { const end = qq + 4 + (n.data ? 8 + n.data.length : 0); if (d >= qq && d < end) { which = ` node #${k} ctor 0x${layout[ri].nodes[k].ctor.toString(16)} (+${d - qq - 4 - 4} of ${n.data?.length ?? 0})`; break; } qq = end; }
            diffs.push(`${tagName(e.tag)}: ${what}${which}: original ${hex(a.subarray(Math.max(0, d - 2), d + 8))} port ${hex(b.subarray(Math.max(0, d - 2), d + 8))}`);
          }
          p += len;
        }
        if (diffs.length) bad(`${z}: ${diffs.length} entity records differ after the port's load: ${diffs.slice(0, 8).join(' | ')}`);
      }
      notes.push(`${z}: the original played ${ran} ticks, its file ${od.length} bytes loaded by the port`);
    }
    return { checked, failures, notes };
  },
};
export default guarded(__test);
