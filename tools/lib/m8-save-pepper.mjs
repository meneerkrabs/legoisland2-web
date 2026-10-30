// WP-SAVE (Pepper's chain): save blocks of the nodes on PEPP in a `Duel` (tools/lib/m7-isl-veh-emu.mjs): the original's serializer (vtable +0x14, run natively on the node the duel built) against
// the port's `saveBlock`, tick by tick, and the original's loader (vtable +0x10) / the port's `loadBlock` on a block taken earlier. The duel's Pepper chain holds the original's nodes of PepSwitc
// (built by hand with its vtable 0x8d9d18), the skateboard / SGVehic / ... (built by their constructors): they are found by their vtable, the port's node by its `kind`.
import { origBlock, origLoad, hex, firstDiff } from './m8-save.mjs';
import { IslEmu } from './m7-isl-veh-emu.mjs';

/**
 * The original allocates nodes from the DEBUG heap (FUN_00433d38 -> __nh_malloc_dbg): a fresh block holds 0xCD in every byte its constructor does not write (src/game/heapfill.ts). The oracle's hosted
 * allocator hands out zeroed memory, so a harness that builds nodes with the original's constructors pre-fills the emulator's heap (from `emu.brk` on) with 0xCD before the attaches: the
 * constructors then leave exactly the bytes the real ones leave. (`Duel` option `beforeAttach`.)
 */
export function cdFillHeap(emu, n = 0x200000) { emu.cpu.mem.write(emu.brk, new Uint8Array(n).fill(0xcd)); }

/**
 * Runs `build()` (buildIslandOracle / buildHubOracle of tools/lib/m8-save.mjs) with the emulator's heap pre-filled with 0xCD just before the attaches (both builders call `emu.setFocus` right before them), so the
 * original's constructors run on a debug-heap-like block. Returns what `build` returns.
 */
export function withCdHeap(build) {
  const orig = IslEmu.prototype.setFocus;
  IslEmu.prototype.setFocus = function (i) { cdFillHeap(this); return orig.call(this, i); };
  try { return build(); } finally { IslEmu.prototype.setFocus = orig; }
}

/**
 * A `Duel` builds PepSwitc by hand (`rawNode`: the constructor is not run) and SGVehic with the constructor on the zero-filled heap. What the real constructors leave behind: PepSwitc FUN_004bbef8 writes
 * only +0x24 (= 0), so the spot (+0x18 .. +0x23) stays 0xCD; SGVehic FUN_004333c2 leaves +0x14 .. +0x17 at 0xCD. Idempotent (also right in a CD-prefilled heap).
 */
export function cdPatchChain(d) {
  const mem = d.emu.cpu.mem;
  for (const [, list] of d.emu.nodeOf) for (const e of list) {
    const vt = mem.r32(e.ptr + 4);
    if (vt === 0x8d9d18) { for (let k = 0; k < 12; k++) mem.w8(e.ptr + 0x18 + k, 0xcd); mem.w32(e.ptr + 0x24, 0); }
    else if (vt === 0x8ae318) for (let k = 0; k < 4; k++) mem.w8(e.ptr + 0x14 + k, 0xcd);
  }
}

/** original handler table -> the port node's `kind` (the nodes of Pepper's chain that have a serializer) */
export const CHAIN_VT = { 0x8d9d18: 'PepSwitc', 0x8ae318: 'SGVehic', 0x8d2130: 'skate', 0x8ae048: 'SGwalk', 0x982b48: 'sgswim', 0x982b68: 'swimSplash' };

/** the chain nodes both machines have: [{ kind, ptr (the original's node), node (the port's), rec, ri }] */
export function chainPairs(d, kinds = null) {
  const emu = d.emu, mem = emu.cpu.mem, W = d.P.world, out = [];
  for (const [ri, list] of emu.nodeOf) {
    const rec = W.records[ri];
    for (const e of list) {
      const kind = CHAIN_VT[mem.r32(e.ptr + 4)];
      if (!kind || (kinds && !kinds.includes(kind))) continue;
      const node = rec?.ctrl?.nodes.find((n) => n.kind === kind);
      if (node) out.push({ kind, ptr: e.ptr, node, rec, ri });
    }
  }
  return out;
}
const withSaver = (emu, ptr) => { const mem = emu.cpu.mem, vt = mem.r32(ptr + 4); return { ptr, saver: mem.r32(vt + 0x14), loader: mem.r32(vt + 0x10) }; };

/** compare every chain node's `+8` word and block (the original's serializer vs `saveBlock`); `d.fail` per difference, `counter.n` counts the blocks compared */
export function compareChainBlocks(d, counter = null, kinds = null) {
  const emu = d.emu, mem = emu.cpu.mem, W = d.P.world;
  for (const p of chainPairs(d, kinds)) {
    const o = withSaver(emu, p.ptr);
    const ob = origBlock(emu, o), pb = p.node.saveBlock ? p.node.saveBlock(W, p.rec, p.rec.ctrl) : null;
    d.checked++;
    if ((mem.r32(p.ptr + 8) >>> 0) !== (p.node.stamp >>> 0)) d.fail(`${d.label} t${d.t} ${p.kind} +8 word: original ${mem.r32(p.ptr + 8) >>> 0} port ${p.node.stamp >>> 0}`);
    if (counter) { counter.n = (counter.n ?? 0) + 1; counter[p.kind] = (counter[p.kind] ?? 0) + 1; }
    if (!ob || !pb) { d.fail(`${d.label} t${d.t} save block ${p.kind}: original ${ob ? ob.length + ' bytes' : 'none'} port ${pb ? pb.length + ' bytes' : 'none'}`); continue; }
    const df = ob.length !== pb.length ? 0 : firstDiff(ob, pb);
    if (df >= 0) {
      const all = []; for (let i = 0; i < Math.min(ob.length, pb.length); i++) if (ob[i] !== pb[i]) all.push(i);
      if (counter) { counter.diffOffsets ??= {}; for (const i of all) counter.diffOffsets[`${p.kind}+${i}`] = (counter.diffOffsets[`${p.kind}+${i}`] ?? 0) + 1; }
      d.fail(`${d.label} t${d.t} save block ${p.kind}: byte ${df} differs (sizes ${ob.length} / ${pb.length}): original ${hex(ob.subarray(Math.max(0, df - 4), df + 8))} port ${hex(pb.subarray(Math.max(0, df - 4), df + 8))}; differing bytes ${all.slice(0, 24).join(',')}`);
    }
  }
}

/** the original's blocks of the chain now (kind -> bytes), for a later `loadChainBlocks` */
export function snapChainBlocks(d, kinds = null) {
  const out = new Map();
  for (const p of chainPairs(d, kinds)) { const b = origBlock(d.emu, withSaver(d.emu, p.ptr)); if (b) out.set(p.kind, { bytes: Uint8Array.from(b), stamp: d.emu.cpu.mem.r32(p.ptr + 8) >>> 0 }); }
  return out;
}
/** the loader of FUN_00419e82 for these nodes in both machines: the +8 word, then the original's loader natively / the port's `loadBlock` with the same bytes; the blocks are compared right after */
export function loadChainBlocks(d, snap, counter = null) {
  const emu = d.emu, mem = emu.cpu.mem, W = d.P.world;
  for (const p of chainPairs(d, [...snap.keys()])) {
    const s = snap.get(p.kind), o = withSaver(emu, p.ptr);
    mem.w32(p.ptr + 8, s.stamp); p.node.stamp = s.stamp;
    origLoad(emu, o, s.bytes);
    p.node.loadBlock(W, p.rec, p.rec.ctrl, s.bytes);
    if (counter) counter.loads = (counter.loads ?? 0) + 1;
  }
  compareChainBlocks(d, null, [...snap.keys()]);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// PepSwitc's loader (FUN_004bbeba) also runs FUN_0051c800 = FUN_00420674(0) + FUN_004202ef(roster): the decor sets' era table and the roster's stored looks / busy list. Checked in a `switchSession`
// (tools/lib/m7-isl-veh-supe.mjs: the SwapText cycler objects are hosted there, the cycler logic FUN_004439f0 runs natively): the game variables are changed, the busy list dirtied, the loader runs in both machines.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
import { looksOf, decorSetsOf, ROSTER_VA, ROSTER_STRIDE } from '../../src/island/vehicles/looks.ts';
import { lcg } from './m7-isl-veh-emu.mjs';

/**
 * `snapC`: the chain snapshot to load (at least PepSwitc); `vars`: the story nodes (var 0x58) to try; `seed`. Per round: the story node and the roster variables get new values in both worlds, the busy list
 * is dirtied, then `loadChainBlocks` runs the loader of both; the decor era table (DAT_008acb98), the cycler state (part / variant) of every roster entry and the busy list must agree afterwards.
 */
export function pepSwitchLoadRounds(d, snapC, vars, seed, counter = null) {
  const W = d.P.world, mem = d.emu.cpu.mem, rnd = lcg(seed), L = looksOf(W);
  if (!L) return;
  for (const story of vars) {
    d.setVar(0x58, story);
    for (const e of L.entries) if (e.varIdx !== -1 && e.varIdx !== 0x58) d.setVar(e.varIdx, Math.floor(rnd() * 4) + 0x100 * Math.floor(rnd() * 3));
    for (let k = 0; k < 8; k++) { const c = rnd() < 0.5 ? Math.floor(rnd() * L.entries.length) : -1; mem.w32(0x9da590 + 4 * k, c); L.busy[k] = c; }
    loadChainBlocks(d, snapC, counter);
    for (let k = 0; k < 8; k++) { d.checked++; if ((mem.r32(0x9da590 + 4 * k) | 0) !== L.busy[k] || L.busy[k] !== -1) d.fail(`${d.label} PepSwitc load (story ${story}): busy slot ${k}: original ${mem.r32(0x9da590 + 4 * k) | 0} port ${L.busy[k]}`); }
    L.entries.forEach((e, i) => {
      const h = mem.r32(ROSTER_VA + i * ROSTER_STRIDE + 8);
      d.checked += 2;
      if (e.varIdx === -1) return;
      if (h > 0xbabababa || (h !== 0 && h !== 0xbabababa)) {
        d.eq(`PepSwitc load (story ${story}): roster ${i} part`, mem.r32(h + 0xc) | 0, e.part);
        d.eq(`PepSwitc load (story ${story}): roster ${i} variant`, mem.r32(h + 0x10) | 0, e.variant);
      }
    });
    const ds = decorSetsOf(W);
    if (ds) for (let i = 0; i < ds.groups.length && ds.groups[i] !== -1; i++) { d.checked++; d.eq(`PepSwitc load (story ${story}): decor group ${i}`, mem.r32(0x8acb98 + i * 0x18) | 0, ds.groups[i]); }
    if (counter) counter.pepRounds = (counter.pepRounds ?? 0) + 1;
  }
}
