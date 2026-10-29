// M4 WP8: the island's story handler FUN_004b7040 (src/zones/z02LGI/story.ts) against the ORIGINAL code run in the x86 emulation (src/formats/emusetup.ts).
// For every story node 0..72 the set-up FUN_004b6475 calls the handler once; the emulation logs its engine calls (objective setters, message files,
// FUN_00429638), its stores into the record array and its variable writes. (a) With the set-up's own uninitialised `prev` the port must make the same
// calls in the same order, the same record visibility changes (bit 2 of the flags word) and the same variable writes. (b) "Just advanced": a hook on
// FUN_0045c432 (the handler's first call) writes `node - 1` into the handler's `*prev` before the comparisons, so the emulated handler runs the one-shot
// branches (hologram alert FUN_0088d2bc, walker re-pinning FUN_0046140f / FUN_004625d7, var writes) and the port must match again.
// (c) the message files the bands select exist in the messages archive; (d) node 7 leaves with next zone 0x1f; (e) the era <-> island zone id mapping.
import { emulateIslandSetup, recIndexOfPtr, eraOfNode, RECORDS_BASE } from '../../src/formats/emusetup.ts';
import { storyHandler } from '../../src/zones/z02LGI/story.ts';
import { messagePath } from '../../src/zones/z02LGI/ctx.ts';
import { readZoneTable, readStoryFsm } from '../../src/shell/tables.ts';
import { loadExe, sceneOf } from '../lib/engine-load.mjs';

const f32 = (u) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, u >>> 0, true); return b.getFloat32(0, true); };
const rec = (p) => (p === 0 ? -1 : recIndexOfPtr(p >>> 0));

/** the emulated story-handler calls in the port's vocabulary */
function emuCalls(s) {
  const out = [];
  for (const c of s.storyHandler) {
    const a = c.args;
    switch (c.fn) {
      case 0x423ff6: out.push('free1'); break;
      case 0x88d296: out.push('free2'); break;
      case 0x424270: out.push(`record(${rec(a[0])},${f32(a[1])})`); break;
      case 0x424230: out.push(`pair(${rec(a[0])},${rec(a[1])},${f32(a[2])})`); break;
      case 0x42419f: out.push(`four(${a.slice(0, 4).map(rec)})`); break;
      case 0x4242b9: out.push(`node(${a[0]},${f32(a[1])})`); break;
      case 0x423fe0: out.push(`npc(${a[0].toString(16)})`); break;
      case 0x88d280: out.push(`hol(${a[0].toString(16)})`); break;
      case 0x88d2bc: out.push('holo'); break;
      case 0x429638: out.push('pizzaReset'); break;
      case 0x46140f: out.push(`place(${rec(a[2])},${a[1]})`); break;
      case 0x4625d7: out.push(`pin(${rec(a[1])},${a[2]})`); break;
      default: break;   // var functions are compared through varWrites
    }
  }
  return out;
}

/** the port with a recording env; `flags(r)` = the flag word the emulation had for the record */
function portRun(node, prev, flagsOf) {
  const calls = [], vis = [], vw = [];
  const env = {
    cutsceneActive: () => false,
    vars: { get: () => 0, set: (i, v) => vw.push(`${i.toString(16)} set ${v}`), or: (i, v) => vw.push(`${i.toString(16)} or ${v}`), andNot: (i, v) => vw.push(`${i.toString(16)} andnot ${v}`) },
    flags: (r) => flagsOf(r),
    setFlags: (r, v) => vis.push(`${r}:${v & 2}`),
    freeTexts: () => { calls.push('free1'); calls.push('free2'); },
    npcText: (a) => calls.push(`npc(${a.toString(16)})`),
    holText: (a) => calls.push(`hol(${a.toString(16)})`),
    objRecord: (r, rad) => calls.push(`record(${r},${rad})`),
    objPair: (a, b, rad) => calls.push(`pair(${a},${b},${rad})`),
    objFour: (a, b, c, d) => calls.push(`four(${[a, b, c, d]})`),
    objNode: (n, rad) => calls.push(`node(${n},${rad})`),
    holoAlert: () => calls.push('holo'),
    pizzaReset: () => calls.push('pizzaReset'),
    walkerPin: (r, n) => { calls.push(`place(${r},${n})`); calls.push(`pin(${r},${n})`); },
  };
  const ref = { prev, next: -10 };
  const ret = storyHandler(env, ref, node);
  return { calls, vis, vw, ret, ref };
}

export default {
  name: 'm4-wp8-story',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const eq = (msg, a, b) => { checked++; const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) failures.push(`${msg}: ${x} != ${y}`); };
    const pe = loadExe(ctx.dataRoot);
    const scene = sceneOf(ctx, 'z02LGI');
    const archive = ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi');
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const files = new Set();
    let justBands = 0;
    for (let node = 0; node <= 72; node++) {
      for (const just of [false, true]) {
        if (just && node === 0) continue;
        const m = new Map([[0x58, node], [2, 1], [0x4f, 11], [0xb0, 11]]);
        const vars = { get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) };
        const hooks = new Map();
        if (just) {
          hooks.set(0x45c432, (c) => {
            if (c.frames[c.frames.length - 1] === 0x4b7040) {
              c.mem.w32(c.mem.u32(((c.regs[5] >>> 0) + 0xc) >>> 0), node - 1);
              // records without a controller at set-up time (the era-3 walkers of node 0x36): a dummy controller block in the spare page after the
              // record array, walker handle (+0x10) = the record index, so the handler's `*(rec->ctrl + 0x10)` reads are defined
              for (let r = 0; r < scene.records.length; r++) {
                const at = RECORDS_BASE + r * 0x68 + 0x5c;
                if (c.mem.u32(at) === 0) { const blk = RECORDS_BASE + scene.records.length * 0x68 + 0x20 * (r % 64); c.mem.w32(at, blk); c.mem.w32(blk + 0x10, r); }
              }
            }
            c.eax = 0;
          });
        }
        let s;
        try { s = emulateIslandSetup(pe, scene, { vars, archive, hooks }); } catch (e) { failures.push(`node ${node}${just ? ' (just advanced)' : ''}: emulation failed: ${String(e.message ?? e).slice(0, 200)}`); continue; }
        const want = emuCalls(s);
        // the flag word of each record just before the handler's first store (the store's own value tells the bit; the port only needs bit 2 semantics)
        const storeVis = s.stores.filter((x) => x.story && x.field === 0x60).map((x) => `${x.record}:${x.value & 2}`);
        const wantVw = s.varWrites.filter((w) => w.caller === 0x4b7040).map((w) => `${w.var.toString(16)} ${w.op}${w.op === 'set' ? ` ${w.value}` : ''}`);
        const got = portRun(node, just ? node - 1 : 0xcccccccc | 0, () => 2);
        const tag = `node ${node}${just ? ' just advanced' : ''}`;
        eq(`${tag}: calls`, got.calls, want);
        eq(`${tag}: visibility`, got.vis, storeVis);
        eq(`${tag}: var writes`, got.vw.map((x) => x.replace(/ (or|andnot) \d+$/, ' $1')), wantVw.map((x) => x.replace(/ (or|andnot)$/, ' $1')));
        if (just && JSON.stringify(got.calls) !== JSON.stringify(portRun(node, -1, () => 2).calls)) justBands++;
        for (const c of got.calls) { const mm = /^(npc|hol)\((\w+)\)$/.exec(c); if (mm) files.add(parseInt(mm[2], 16)); }
      }
    }
    notes.push(`nodes 0..72 compared with the emulated FUN_004b7040 (set-up call and "just advanced"); ${justBands} nodes have one-shot branches`);
    // (c) the message files
    for (const va of files) {
      const p = messagePath(pe.cstr(va));
      checked++;
      if (!messages?.find(p)) failures.push(`message file ${p} (0x${va.toString(16)}) not in the messages archive`);
    }
    notes.push(`${files.size} message files referenced, all present`);
    // (d) node 7 leaves the island for zone 0x1f
    const r7 = portRun(7, 6, () => 2);
    eq('node 7: exit 2 to zone 0x1f', [r7.ret, r7.ref.next, r7.ref.prev], [2, 0x1f, 7]);
    const r8 = portRun(8, 7, () => 2);
    eq('node 8: stays', [r8.ret, r8.ref.prev], [1, 8]);
    // a running cutscene: nothing, prev unchanged (retried next frame)
    { const ref = { prev: 3, next: -10 }; const calls = []; storyHandler({ cutsceneActive: () => true, freeTexts: () => calls.push('x') }, ref, 4); eq('cutscene running: no call, prev kept', [calls.length, ref.prev], [0, 3]); }
    // record 68 is shown for nodes 0x37..0x3a only
    for (const n of [0x36, 0x37, 0x3a, 0x3b]) eq(`record 68 at node 0x${n.toString(16)}`, portRun(n, -1, () => 2).vis.at(-1), `68:${n >= 0x37 && n <= 0x3a ? 2 : 0}`);
    // (e) eras: every story node whose zone is the island maps to the zone id of its era (2 / 31 / 32 / 33, era 4 = 2)
    const zones = readZoneTable(pe), nodes = readStoryFsm(pe);
    const ERA_ZONE = [2, 31, 32, 33, 2];
    for (let n = 0; n < nodes.length; n++) {
      const z = zones[nodes[n].zone];
      if (z?.archive !== 'z02LGI') continue;
      eq(`node ${n}: island zone id of era ${eraOfNode(n)}`, nodes[n].zone, ERA_ZONE[eraOfNode(n)]);
    }
    return { checked, failures, notes };
  },
};
