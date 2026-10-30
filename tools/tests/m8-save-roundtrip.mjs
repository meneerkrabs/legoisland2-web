// WP-SAVE: port save -> the ORIGINAL's reader. The port's island world plays for a while (scripted keys), its save file is built by the port (`captureWorld` + `encodeSave`), the original's header reader FUN_00419c45
// and body reader FUN_00419e82 run natively on it (the machine whose nodes the original's constructors built), then the original's writer FUN_00418ec7 writes the state it now holds: the file must come out byte
// for byte as the port wrote it (everything the port wrote was accepted and kept by the original's loaders; the reader returned 1 = the whole file was consumed and every marker matched).
//   M8_ZONES=isl2 M8_TICKS=300 node tools/test-formats.mjs --only m8-save-roundtrip -v
import { buildIslandOracle, buildHubOracle, hex, firstDiff, maskRanges, islandLoaderRigs } from '../lib/m8-save.mjs';
import { installSaveHost, syncGlobalsFromPort, originalWrite, originalRead } from '../lib/m8-save-world.mjs';
import { tick, press, hold } from '../lib/island-load.mjs';
import { setIslandRandom } from '../../src/island/rng.ts';
import { captureWorld, listedNodes, tagOf } from '../../src/shell/saveworld.ts';
import { newSaveFromGame, encodeSave, decodeSave } from '../../src/shell/save.ts';

const ZONES = process.env.M8_ZONES ? process.env.M8_ZONES.split(',') : ['isl2', 'isl16', 'isl37', 'isl56', 'isl61', 'z07CSI', 'z13CAI', 'z14OSD', 'z16PYA', 'z23DIP', 'z40OGL'];
const TICKS = Number(process.env.M8_TICKS ?? 240);
const tagName = (t) => String.fromCharCode(t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff, (t >>> 24) & 0xff);
const KEYS = ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ShiftLeft', 'Space'];

export default {
  name: 'm8-save-roundtrip',
  run(ctx) {
    // the builder scripts rand to 0 while it builds both sides; the play that follows draws from a seeded generator (a constant source would spin the animals' `do s = rand(4) while (s == state)` forever)
    let seed = 987654321;
    setIslandRandom(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; });
    try { return this.body(ctx); } finally { setIslandRandom(null); }
  },
  body(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 80) failures.push(m); };
    for (const z of ZONES) {
      const B = z.startsWith('isl') ? buildIslandOracle(ctx, Number(z.slice(3)), { animTokens: true, loaderRigs: islandLoaderRigs(ctx, Number(z.slice(3))) }) : buildHubOracle(ctx, z, { animTokens: true });
      const { P, emu } = B, W = P.world;
      installSaveHost(emu);
      // play: a scripted walk
      let seed = 12345;
      const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      for (let t = 0; t < TICKS; ) {
        const k = KEYS[Math.floor(rnd() * 4)], n = 8 + Math.floor(rnd() * 25);
        hold(P, [k], n); t += n;
        if (rnd() < 0.2) { press(P, 'ShiftLeft'); t += 2; }
      }
      const TIME = 7654321;
      const save = newSaveFromGame({ vars: W.vars.a, subgame: W.vars.get(0x59), fsmState: W.vars.get(0x58), time: TIME, ...captureWorld(W) });
      const mine = encodeSave(save);
      const mineD = decodeSave(mine);
      // the original: variables of the file are what the reader installs; run the reader, then the writer
      syncGlobalsFromPort(emu, W);   // (the writer's own globals start from the port's: the reader replaces them anyway)
      const rd = originalRead(emu, mine, 0);
      checked++;
      if (!rd.ok || rd.ret !== 1) { bad(`${z}: the original's reader ${rd.ok ? 'returned ' + rd.ret : 'rejected the header'}`); continue; }
      emu.cpu.steps = 0; emu.cpu.call(0x421bbe, [0xffffffff], { maxSteps: 50_000_000 });   // the load menu's FUN_00421bbe(-1): the decor blob onto the records
      const o = originalWrite(emu, 0, TIME);
      const od = decodeSave(o.bytes);
      const cmp = (a, b, what) => { checked++; const d = firstDiff(a, b); if (a.length !== b.length || d >= 0) bad(`${z} ${what}: first difference at ${d}: port ${hex(a.subarray(Math.max(0, d - 4), d + 12))} original ${hex(b.subarray(Math.max(0, d - 4), d + 12))}`); };
      cmp(new Uint8Array(mineD.vars.buffer), new Uint8Array(od.vars.buffer), 'vars');
      {   // the loader FUN_00462e75 clears the node-list links (+0x24 .. +0x2f of every walker) and rebuilds them by registering the walkers in slot order: those words are compared after masking
        const a = Uint8Array.from(mineD.walkers), b = Uint8Array.from(od.walkers);
        for (let k = 0; k < 60; k++) for (let q = 0x24; q < 0x30; q++) { a[k * 0x84 + q] = 0; b[k * 0x84 + q] = 0; }
        cmp(a, b, 'walker table (links masked)');
      }
      cmp(new Uint8Array(mineD.walkerTags.buffer), new Uint8Array(od.walkerTags.buffer), 'walker tags');
      cmp(mineD.camera, od.camera, 'camera');
      checked++; if (mineD.frameCounter !== od.frameCounter) bad(`${z}: frame counter ${mineD.frameCounter} -> ${od.frameCounter}`);
      cmp(mineD.decor, od.decor, 'decor');
      // entities with the node masks
      const layout = []; for (const r of W.records) { const nodes = listedNodes(r); if (r.ctrl && nodes.length) layout.push({ r, nodes }); }
      const ob = od.entityBytes, pb = mineD.entityBytes;
      checked++;
      if (ob.length !== pb.length || firstDiff(ob, pb) >= 0) {
        let p = 0; const diffs = [];
        const tagCount = new Map(); for (const r of W.records) tagCount.set(tagOf(r.name), (tagCount.get(tagOf(r.name)) ?? 0) + 1);   // records that share a name are all restored from the LAST entry of that name onto the FIRST record (FUN_00419a79): not comparable
        for (const [ri, e] of save.entities.entries()) {
          let len = 4 + 26 + 4;
          for (const n of e.nodes) len += 4 + (n.data ? 8 + n.data.length : 0);
          // node data masks
          const a = Uint8Array.from(pb.subarray(p, p + len)), b = Uint8Array.from(ob.subarray(p, p + len));
          let q = 30;
          for (const [k, n] of e.nodes.entries()) { q += 4; if (n.data) { for (const [lo, hi] of maskRanges(layout[ri].nodes[k].ctor, n.data)) for (let t = lo; t < hi; t++) { a[q + 4 + t] = 0; b[q + 4 + t] = 0; } q += 8 + n.data.length; } }
          const d = tagCount.get(e.tag) > 1 ? -1 : firstDiff(a, b);
          if (d >= 0) {
            const what = d < 4 ? 'tag' : d < 16 ? 'position' : d < 28 ? 'euler' : d < 30 ? 'flags' : 'node data / state';
            // which node
            let qq = 30, which = '';
            for (const [k, n] of e.nodes.entries()) { const end = qq + 4 + (n.data ? 8 + n.data.length : 0); if (d >= qq && d < end) { which = ` node #${k} ctor 0x${layout[ri].nodes[k].ctor.toString(16)} (+${d - qq - 4 - 4} of ${n.data?.length ?? 0})`; break; } qq = end; }
            diffs.push(`${tagName(e.tag)}: ${what}${which}: port ${hex(a.subarray(Math.max(0, d - 2), d + 8))} original ${hex(b.subarray(Math.max(0, d - 2), d + 8))}`);
          }
          p += len;
        }
        if (diffs.length) bad(`${z}: ${diffs.length} entity records differ after the original's load: ${diffs.slice(0, 8).join(' | ')}`);
      }
      checked++; if (mineD.objects.length !== od.objects.length) bad(`${z}: object records ${mineD.objects.length} -> ${od.objects.length}`);
      else { const dupT = new Map(); for (const r of W.records) if (r.anim) dupT.set(tagOf(r.name), (dupT.get(tagOf(r.name)) ?? 0) + 1); const dif = mineD.objects.map((x, i) => (dupT.get(x.tag) > 1 || x.tag === od.objects[i].tag && x.animState === od.objects[i].animState && Object.is(x.animFrame, od.objects[i].animFrame) ? null : `${tagName(x.tag)} ${x.animState}:${x.animFrame} -> ${od.objects[i].animState}:${od.objects[i].animFrame}`)).filter(Boolean); if (dif.length) bad(`${z}: ${dif.length} object records changed by the original's load: ${dif.slice(0, 8).join(', ')}`); }
      notes.push(`${z}: ${TICKS} ticks played, file ${mineD.length} bytes, the original's reader returned ${rd.ret}`);
    }
    return { checked, failures, notes };
  },
};
