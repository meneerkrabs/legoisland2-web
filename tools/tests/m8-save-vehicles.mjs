// WP-SAVE (vehicles): the save blocks of SGBoat 0x430e6c, SGHeli 0x4325e8, SGCar 0x88fb35, Ptera 0x4bb1a6 and the Ptera ride node 0x4bb582 after GAMEPLAY, and their loaders.
// The family duels of WP-VERIFY M7 (m7-isl-veh-boat / -heli / -car / -ptera: the original's own nodes run natively in the x86 emulation next to the port's, tick by tick, tolerance 0, scripted
// random buttons, boarding, crashes, docking, landing ...) are run UNCHANGED; this file hooks `Duel.prototype.tick`, so that after every tick of every session
//   (a) the ORIGINAL's serializer (vtable +0x14, run natively) and the port node's `saveBlock` are compared byte for byte (+ the +8 state word), for every node of the family;
//   (b) every `LOAD_EVERY` ticks the blocks of an earlier moment of the SAME session (taken from the original with its serializer, `snapshotBlocks`) are loaded into BOTH machines (the original's
//       loader natively, the port's `loadBlock`, `restoreBlocks`); the blocks must then be equal again (loaded == original's node after its own loader, saved again) and the duel goes on, comparing
//       everything of the m7 tests tick by tick (the loaded node must behave like the original's node loaded from the same bytes);
//   (c) in the sync sessions of the m7 tests (the port's float state is copied from the original before every tick) only the tick-start blocks are compared (the state right after a sync).
// Not reproducible bit for bit (compared masked): SGCar's four cached part-matrix pointers (block bytes 0x3c .. 0x4b = node +0x54 .. +0x63, heap addresses of the original process, set by its draw hook).
//   M8V_ONLY=boat,heli,car,ptera   M8V_EVERY=1 (compare every n ticks)   M8V_LOAD=150 (load every n ticks; 0 = off)
import '../lib/m8-cdheap.mjs';
import { Duel, B, lcg, randomKeys } from '../lib/m7-isl-veh-emu.mjs';
import { DOCK_WORDS, PAD_WORDS } from '../../src/island/vehicles/common.ts';
import { buildHubOracle } from '../lib/m8-save.mjs';
import { loadHub } from '../lib/hub-load.mjs';
import { speederDuel, CARS, MOVE_VAR } from '../lib/m7-isl-veh-speeder.mjs';
import { nativeNodes, portNodes, snapshotBlocks, restoreBlocks, origLoad, hex, firstDiff, buildIslandOracle } from '../lib/m8-save.mjs';
import { guarded } from '../lib/inject-guard.mjs';

const FAM = new Set([0x430e6c, 0x4325e8, 0x88fb35, 0x4bb1a6, 0x4bb582]);
const MASK = new Map([[0x88fb35, [[0x3c, 0x4c]]]]);
const EVERY = Number(process.env.M8V_EVERY ?? 1), LOAD = Number(process.env.M8V_LOAD ?? 150);
const ONLY = process.env.M8V_ONLY ? process.env.M8V_ONLY.split(',') : ['boat', 'heli', 'car', 'ptera'];

/** the original's serializer without leaking emulator heap per call (m8-save.mjs `origBlock` allocates 8 / 128 KB bytes per call; here one cell + one buffer per machine) */
function blockOf(emu, node) {
  if (!node.saver) return null;
  const cpu = emu.cpu, mem = cpu.mem;
  const S = (emu.__m8v ??= { cell: emu.alloc(8), buf: emu.alloc(0x1000) });
  mem.w32(S.cell, 0);
  cpu.steps = 0;
  let size = cpu.call(node.saver, [node.ptr, S.cell], { maxSteps: 5_000_000 }) | 0;
  if (size === -1) { mem.w32(S.cell, S.buf); cpu.steps = 0; size = cpu.call(node.saver, [node.ptr, S.cell], { maxSteps: 5_000_000 }) | 0; return mem.read(S.buf, size); }
  return mem.read(mem.r32(S.cell), size);
}

const stats = { compared: 0, blocks: 0, loads: 0, loadedNodes: 0, ctors: new Map(), sessions: 0, maskedBytes: 0 };
const failures = [];
const fail = (m) => { if (failures.length < 40) failures.push(m); else if (failures.length === 40) failures.push('... more failures'); };

/** every node of the family: the original's block against the port's (masked ranges), the +8 state word */
function check(d, why) {
  const W = d.P.world, emu = d.emu;
  for (const [i, r] of W.records.entries()) {
    if (!r.ctrl) continue;
    const on = nativeNodes(emu, i).filter((n) => n.ctor !== 0), pn = portNodes(r);      // (the duel's host stand-in nodes have no constructor: they sit behind the real ones)
    if (on.map((n) => n.ctor).join() !== pn.map((n) => n.ctor).join()) continue;
    on.forEach((o, k) => {
      if (!FAM.has(o.ctor)) return;
      const p = pn[k];
      stats.compared++;
      const s = stats.ctors.get(o.ctor) ?? { n: 0, bad: 0 }; stats.ctors.set(o.ctor, s); s.n++;
      const bad = (m) => { s.bad++; fail(`${d.label} t${d.t} ${why} rec ${i} ${r.name} node ${k} ctor 0x${o.ctor.toString(16)}: ${m}`); };
      if ((p.stamp >>> 0) !== (o.state >>> 0)) bad(`stamp port ${(p.stamp >>> 0).toString(16)} original ${(o.state >>> 0).toString(16)}`);
      const ob = blockOf(emu, o), pb = p.saveBlock ? p.saveBlock(W, r, r.ctrl) : null;
      if (!ob || !pb) { bad(`block port ${pb ? pb.length : 'none'} original ${ob ? ob.length : 'none'}`); return; }
      if (ob.length !== pb.length) { bad(`size port ${pb.length} original ${ob.length}`); return; }
      stats.blocks++;
      const ob2 = ob.slice(), pb2 = pb.slice();
      for (const [a, b] of MASK.get(o.ctor) ?? []) { for (let q = a; q < Math.min(b, ob.length); q++) { ob2[q] = 0; pb2[q] = 0; stats.maskedBytes++; } }
      const x = firstDiff(ob2, pb2);
      if (x >= 0) bad(`byte ${x} differs: original ${hex(ob.subarray(Math.max(0, x - 4), x + 8))} port ${hex(pb.subarray(Math.max(0, x - 4), x + 8))}`);
    });
  }
}

const orig = Duel.prototype.tick;
const per = new WeakMap();
let active = false;
Duel.prototype.tick = function (held) {
  let st = per.get(this);
  if (active && !st) {
    st = { snaps: [] }; per.set(this, st); stats.sessions++;
    // the car test does not run the draw pass: SGCar's draw hook (FUN_0088f8df) accumulates the wheel spin (block +0x18), so the original has to run it
    if (this.o.keepKinds?.includes('SGCar')) this.o.draw = true;
  }
  // a load happens BETWEEN ticks (the game loads in the menu): before the tick, so that the duel's comparisons of this tick (which also look at the draw pass of the same tick) see a consistent state
  if (active && LOAD > 0 && this.t > 0 && this.t % LOAD === 0 && st.snaps.length > 5) {
    const s = st.snaps.shift();
    const n = restoreBlocks(this.P.world, this.emu, s.snap);
    stats.loads++; stats.loadedNodes += n;
    check(this, `after load of t${s.t}`);      // loaded into both machines and saved again: the bytes must be the same
  }
  orig.call(this, held);
  if (!active) return;
  // (sync sessions copy the original's float state into the port before every tick, so the free-running block compare would only measure that copy: they are compared in the free sessions)
  if (this.syncMode) return;
  if (this.t % EVERY === 0) check(this, 'play');
  if (LOAD > 0 && this.t % 25 === 0) { st.snaps.push({ t: this.t, snap: snapshotBlocks(this.emu, this.P.world, FAM) }); if (st.snaps.length > 12) st.snaps.shift(); }
};

/**
 * SGCar inside the island's real chain: the car record carries the speeder.c node (FUN_00538126, draw hook FUN_00537ea9 returns 1 = "handled": the rest of the chain is not drawn) in front of SGCar. SGCar's draw
 * hook (the wheel spin of the block) is only reached in the frames the speeder node did not run: the port's `prerenderSpin` decides that from the ran bits; both are driven here through the same buttons
 * (boarding, driving with random buttons, leaving, the speeder's own AI branch with a scripted route while nobody sits in the car) and the blocks compared every tick (the speeder duel's scripted-route stand-in
 * for the walker, see tools/lib/m7-isl-veh-speeder.mjs).
 */
function carChain(ctx, dt, seed) {
  const d = speederDuel(ctx, { node: 2, dt, keepKinds: ['speeder', 'SGCar'], pepSwitc: true, seat: true, maxFail: 30, failures, draw: true });
  d.label = `chain dt${dt}`;
  d.syncMode = false;
  const W = d.P.world, rnd = lcg(seed);
  const idx = (n) => W.records.findIndex((r) => r.name === n);
  const sc = dt === 1 ? 1 : 2;
  const step = (held) => d.tick(held);
  const run = (n, held = 0) => { for (let i = 0; i < n; i++) step(held); };
  const tap = (bits = 0) => { step(bits | B.CTRL); step(bits); };
  const spinOf = (i) => d.pnode(i, 'SGCar')?.spin ?? 0;
  const seen = { driven: 0, aiTicks: 0, spun: 0, blocked: 0 };
  // the cars drive on their scripted routes (the speeder's AI branch) for a while: SGCar does not run then (its update returns 0)
  for (const i of d.cars) d.route.set(i, { v: 0.4, turn: (t) => 0.01 * Math.sin(t / 30), paused: false });
  run(20 * sc);
  for (const n of ['AMBU', 'SPD0', 'PCAR', 'SPD1']) {
    const i = idx(n), r = W.records[i];
    if (!d.cars.includes(i)) continue;
    d.route.get(i).paused = true;
    run(3 * sc);
    d.placePepper(r.x + 4, r.y + 1, r.z + 3);
    tap();
    if ((d.getVar(MOVE_VAR[n]) & 0x10000000) !== 0) seen.driven++;
    const keys = randomKeys(rnd, [B.SPACE, B.SPACE, B.SPACE | B.LEFT, B.SPACE | B.RIGHT, B.LEFT, B.ALT, 0, B.SPACE | B.UP], 14 * sc);
    for (let t = 0; t < 160 * sc; t++) { step(keys()); if (spinOf(i) !== 0) seen.spun++; }
    tap();                      // leaves the car (its speed stays in the node)
    run(4 * sc);
    // the car is flagged "stopped by an obstacle" (record flag 0x2000): the speeder node runs its AI branch (returns 2, its draw hook handles the record) and Ctrl next to the car makes SGCar run
    // in the same frame: SGCar's draw hook (the wheel spin of the block, speed != 0 here) is NOT reached in that frame
    d.flagsBoth(i, 0x2000, 0);
    const sp0 = spinOf(i);
    tap();
    if (spinOf(i) === sp0) seen.blocked++;
    run(6 * sc);
    d.route.get(i).paused = false;
    run(30 * sc);
    seen.aiTicks += 30 * sc;
  }
  return seen;
}

/**
 * The loaders on arbitrary blocks (a file is not only made by the game: any block of the right size is loaded): random finite floats / integers (flag words 0 / 1: the original keeps them raw, the port
 * as booleans) go through the ORIGINAL's loader natively and the port's `loadBlock`, then both are saved again: the bytes must be the block (the original's serializer and the port's `saveBlock` agree).
 */
function randomLoads(ctx, notes) {
  const B = buildIslandOracle(ctx, 56);                    // era 3: PTER / GLDR, the cars, the three boats, both helicopters
  const rnd = lcg(99);
  const u32 = () => (Math.floor(rnd() * 65536) * 65536 + Math.floor(rnd() * 65536)) >>> 0;
  const flt = () => (rnd() - 0.5) * Math.pow(10, Math.floor(rnd() * 8) - 3);
  // per constructor: [size, fields]; a field = [offset, kind]: 'f' float, 'i' any 32 bit, 'b' byte, 'h' 16 bit, 'z' flag word 0 / 1, 'q' byte 0 / 1, 'r' raw byte run (never interpreted by the node: random too)
  const LAYOUT = {
    0x430e6c: { size: 0x38, f: [[0, 'b'], [2, 'h'], [4, 'f'], [8, 'f'], [0xc, 'f'], [0x10, 'f'], [0x14, 'f'], [0x20, 'i'], [0x24, 'z'], [0x28, 'z'], [0x2c, 'z'], [0x30, 'z'], [0x34, 'i']] },
    0x4325e8: { size: 0x4c, f: [[0, 'b'], [4, 'f'], [8, 'f'], [0xc, 'f'], [0x10, 'h'], [0x14, 'f'], [0x18, 'f'], [0x1c, 'f'], [0x20, 'f'], ...Array.from({ length: 10 }, (_, k) => [0x24 + 4 * k, 'z'])] },
    0x88fb35: { size: 0x4c, f: [[2, 'b'], [4, 'i'], [8, 'i'], [0xc, 'i'], [0x10, 'i'], [0x14, 'f'], [0x18, 'f'], [0x1c, 'f'], [0x24, 'i'], [0x30, 'f'], [0x34, 'f'], [0x38, 'f'], [0x3c, 'i'], [0x40, 'i'], [0x44, 'i'], [0x48, 'i']] },
    0x4bb1a6: { size: 0x70, f: [[4, 'f'], [8, 'b'], [9, 'b'], [0xa, 'q'], [0xb, 'b'], [0xc, 'f'], [0x10, 'f'], [0x14, 'f'], [0x18, 'f'], [0x1c, 'f'], [0x20, 'f'], [0x28, 'f'], [0x60, 'h'], [0x64, 'f'], [0x6c, 'i']] },
    0x4bb582: { size: 8, f: [[0, 'i'], [4, 'i']] },
  };
  let n = 0, bad = 0;
  const W = B.P.world, emu = B.emu;
  for (const [i, r] of W.records.entries()) {
    const on = nativeNodes(emu, i), pn = portNodes(r);
    if (on.map((x) => x.ctor).join() !== pn.map((x) => x.ctor).join()) continue;
    on.forEach((o, k) => {
      const L = LAYOUT[o.ctor];
      if (!L) return;
      const p = pn[k];
      for (let rep = 0; rep < 12; rep++) {
        // unmodelled bytes random too (the node never reads them): start from random bytes everywhere
        const b = new Uint8Array(L.size), dv = new DataView(b.buffer);
        for (let q = 0; q < L.size; q++) b[q] = Math.floor(rnd() * 256);
        for (const [off, kind] of L.f) {
          if (kind === 'f') dv.setFloat32(off, flt(), true); else if (kind === 'i') dv.setUint32(off, u32(), true);
          else if (kind === 'b') dv.setUint8(off, Math.floor(rnd() * 256)); else if (kind === 'h') dv.setInt16(off, Math.floor(rnd() * 65536) - 32768, true);
          else if (kind === 'z') dv.setUint32(off, rnd() < 0.5 ? 1 : 0, true); else if (kind === 'q') dv.setUint8(off, rnd() < 0.5 ? 1 : 0);
        }
        // (the float fields of the original's node are read back as floats by nobody here: the unmodelled floats may be anything)
        origLoad(emu, o, b);
        p.loadBlock(W, r, r.ctrl, b);
        const ob = blockOf(emu, o), pb = p.saveBlock(W, r, r.ctrl);
        n++;
        const x = firstDiff(ob, pb), y = firstDiff(ob, b);
        if (x >= 0) { bad++; fail(`random load ${r.name} ctor 0x${o.ctor.toString(16)} rep ${rep}: original block vs port block differ at byte ${x}: ${hex(ob.subarray(Math.max(0, x - 4), x + 8))} / ${hex(pb.subarray(Math.max(0, x - 4), x + 8))}`); }
        else if (y >= 0 && o.ctor !== 0x430e6c) { bad++; fail(`random load ${r.name} ctor 0x${o.ctor.toString(16)} rep ${rep}: the original's own loader + serializer changed the bytes at ${y}`); }
      }
    });
  }
  notes.push(`random block loads (original loader natively vs port loadBlock, saved again): ${n} loads, ${bad} differing`);
  return n;
}

/**
 * The dock / helipad taken words (DAT_009da9fc 5 dwords, DAT_009daa50 10 dwords) are static process memory: a zone's set-up zeroes only what its own code zeroes, a hub keeps what the island left. Chained check:
 * preset the words (the island's last state), build the zone in the same process, expect the words the DECOMPILED set-up leaves (island FUN_004b6475: dock words 0..3 and pad words 0..9 zeroed; z07CSI
 * FUN_00573527: dock word 0 zeroed; z13CAI FUN_0061b1f4: nothing zeroed; the other hubs write neither) and compare every SGBoat / SGHeli block's tail words of the zone against the native serializer
 * with the same words written into the oracle machine.
 */
function chainedWords(ctx, notes) {
  const PRE_D = [1, 1, 0, 1, 0x7777], PRE_P = [1, 0, 1, 1, 0, 1, 1, 0, 1, 1];
  let n = 0;
  for (const z of ['isl2', 'z07CSI', 'z13CAI', 'z14OSD']) {
    DOCK_WORDS.set(PRE_D); PAD_WORDS.set(PRE_P);
    // (the hub oracle builders start like a fresh process: `loadHub` zeroes the static words; the chain (what the previous zone left) is loaded port-only with `keepVehicleWords`)
    const chainedHub = z.startsWith('isl') ? null : loadHub(ctx, { zone: z, keepVehicleWords: true });
    const afterD = Array.from(DOCK_WORDS), afterP = Array.from(PAD_WORDS);
    const B = z.startsWith('isl') ? buildIslandOracle(ctx, Number(z.slice(3))) : buildHubOracle(ctx, z);
    const zd = z.startsWith('isl') ? 4 : z === 'z07CSI' ? 1 : 0, zp = z.startsWith('isl') ? 10 : 0;
    const isl = z.startsWith('isl'), emem = B.emu.cpu.mem;
    // (the island: zeroed, then the constructors claim docks / pads: the native machine's own words after ITS constructors; its fifth dock word is not zeroed: the preset survives)
    const wantD = isl ? [0, 1, 2, 3].map((i) => emem.r32(0x9da9fc + 4 * i)).concat([PRE_D[4]]) : PRE_D.map((v, i) => (i < zd ? 1 : v));   // z07CSI: word 0 zeroed, then the zone's boat claims its only dock (1)
    const wantP = isl ? PRE_P.map((_, i) => emem.r32(0x9daa50 + 4 * i)) : PRE_P.map((v, i) => (i < zp ? 0 : v));
    n++;
    if (chainedHub) { DOCK_WORDS.set(afterD); PAD_WORDS.set(afterP); }
    if (Array.from(DOCK_WORDS).join() !== wantD.join()) fail(`${z}: dock words after the set-up ${Array.from(DOCK_WORDS)} expected ${wantD}`);
    if (Array.from(PAD_WORDS).join() !== wantP.join()) fail(`${z}: pad words after the set-up ${Array.from(PAD_WORDS)} expected ${wantP}`);
    // the native machine gets the same words (the set-up code of the original is what zeroed them), then every boat / heli block must carry them
    const mem = B.emu.cpu.mem;
    wantD.forEach((v, i) => mem.w32(0x9da9fc + 4 * i, v)); wantP.forEach((v, i) => mem.w32(0x9daa50 + 4 * i, v));
    const W = B.P.world;
    for (const [i, r] of W.records.entries()) {
      const on = nativeNodes(B.emu, i), pn = portNodes(r);
      if (on.map((x) => x.ctor).join() !== pn.map((x) => x.ctor).join()) continue;
      on.forEach((o, k) => {
        if (o.ctor !== 0x430e6c && o.ctor !== 0x4325e8) return;
        const ob = blockOf(B.emu, o), pb = pn[k].saveBlock(W, r, r.ctrl);
        const a = o.ctor === 0x430e6c ? 0x24 : 0x24;
        n++;
        if (hex(ob.subarray(a)) !== hex(pb.subarray(a))) fail(`${z} ${r.name}: taken words in the block: original ${hex(ob.subarray(a))} port ${hex(pb.subarray(a))}`);
      });
    }
  }
  DOCK_WORDS.fill(0); PAD_WORDS.fill(0);
  notes.push(`chained static dock / pad words (island -> island, z07CSI, z13CAI, z14OSD): ${n} checks`);
  return n;
}

const __test = {
  name: 'm8-save-vehicles',
  async run(ctx) {
    active = true;
    const notes = [];
    try {
      for (const f of ONLY) {
        const mod = (await import(`./m7-isl-veh-${f}.mjs`)).default;
        const before = failures.length;
        const t0 = Date.now();
        const res = await mod.run(ctx);
        // (the scripted scenarios of the m7 tests count their own coverage (boardings, landings ...): loading earlier states in between changes those counts; they are asserted by the plain m7 tests)
        for (const x of res.failures) if (!(LOAD > 0 && /^coverage:/.test(x))) failures.push(`[${mod.name}] ${x}`);
        notes.push(`${mod.name}: ${res.checked} duel comparisons, ${res.failures.length} failures, ${failures.length - before} block failures (${Date.now() - t0} ms)`);
      }
    } finally { active = false; }
    if (ONLY.includes('car') && process.env.M8V_CHAIN !== '0') {
      active = true;
      try {
        const t0 = Date.now(), before = failures.length;
        for (const [dt, seed] of [[1, 7], [0.5, 8]]) { const seen = carChain(ctx, dt, seed); notes.push(`car chain dt${dt}: boarded ${seen.driven} cars, ${seen.spun} ticks with a spinning wheel angle, ${seen.blocked} frames where the speeder's draw hook stopped the chain`); }
        notes.push(`car chain (speeder + SGCar, draw pass natively): ${failures.length - before} failures (${Date.now() - t0} ms)`);
      } finally { active = false; }
    }
    Duel.prototype.tick = orig;
    stats.compared += randomLoads(ctx, notes);
    stats.compared += chainedWords(ctx, notes);
    for (const [c, s] of stats.ctors) notes.push(`ctor 0x${c.toString(16)}: ${s.n} node comparisons, ${s.bad} differing`);
    notes.push(`sessions ${stats.sessions}, blocks compared ${stats.blocks}, loads ${stats.loads} (${stats.loadedNodes} node loads), masked bytes ${stats.maskedBytes}`);
    return { checked: stats.compared, failures, notes };
  },
};
export default guarded(__test);
