// WP-SAVE, pizza / speeder / footy / SUPE / train families: helpers on top of tools/lib/m8-save.mjs (additive, nothing of the shared files is edited).
//  * the debug heap: the original is a Visual Studio 2003 DEBUG build (FUN_00433d38 -> FUN_00858d30 -> __nh_malloc_dbg): a fresh node block is filled with 0xCD, so every node byte the constructor
//    never writes is 0xCD in a real save. The emulation's allocator hook (tools/lib/m7-zone-emu.mjs, 0x433d38) hands out zeroed memory; `withCdHeap` makes it fill 0xCD for the duration of a test
//    (it patches `IslEmu.prototype.initHosts`, which runs after the ZoneEmu constructor installed the hook), and `cdHeap(emu)` does the same for one machine (Duel option `beforeAttach`).
//  * `compareMasked`: `compareBlocks` with byte masks for the words that cannot be reproduced (the stack garbage the carry node's saver FUN_00429baa copies, the model / animation pointers of a
//    record header) and with the saver cell reused (the shared `origBlock` allocates a 128 KB buffer per call, a per-tick comparison would exhaust the heap).
//  * `blockTick`: hook `Duel.prototype.tick` so that every tick of a family's duel test also compares the save blocks and, at intervals, runs the load round trip (snapshot -> change -> restore into
//    both machines -> blocks equal again -> the duel goes on comparing).
import { IslEmu } from './m7-isl-veh-emu.mjs';
import { Duel } from './m7-isl-veh-emu.mjs';
import { nativeNodes as nativeAll, portNodes, hex, firstDiff } from './m8-save.mjs';

/** the original's nodes of a record that the port lists too: the duel tests' scripted stand-ins (emulator stubs without a constructor) are the port's constructor-less helper nodes */
export const nativeNodes = (emu, i) => nativeAll(emu, i).filter((n) => n.ctor);

/** the original's loader natively (`origLoad` of m8-save.mjs with the bytes buffer reused) */
export function origLoadFast(emu, node, bytes) {
  if (!node.loader) return false;
  const cpu = emu.cpu, mem = cpu.mem;
  const s = (emu.__m8 ??= { cell: emu.alloc(16), buf: emu.alloc(0x2000) });
  s.load ??= emu.alloc(0x2000);
  mem.write(s.load, bytes);
  cpu.steps = 0;
  cpu.call(node.loader, [node.ptr, s.load], { maxSteps: 5_000_000 });
  return true;
}

/** like `snapshotBlocks`: every node's +8 word and block of the original now */
export function snapshotFast(emu, world, only = null) {
  const out = [];
  for (const [i] of world.records.entries()) nativeNodes(emu, i).forEach((n, k) => { if (!only || only.has(n.ctor)) out.push({ i, k, ctor: n.ctor, state: n.state, bytes: origBlockFast(emu, n) }); });
  return out;
}

/** like `restoreBlocks` (FUN_00419e82's per node steps): the +8 word, the original's loader natively, the port's `loadBlock` with the same bytes; returns the number of nodes loaded */
export function restoreFast(world, emu, snap) {
  let n = 0;
  for (const s of snap) {
    const o = nativeNodes(emu, s.i)[s.k], rec = world.records[s.i], p = portNodes(rec)[s.k];
    if (!o || !p || o.ctor !== s.ctor || p.ctor !== s.ctor) throw new Error(`restoreFast: node ${s.k} of record ${s.i} is not constructor 0x${s.ctor.toString(16)}`);
    emu.cpu.mem.w32(o.ptr + 8, s.state);
    p.stamp = s.state >>> 0;
    if (s.bytes && o.loader) { origLoadFast(emu, o, s.bytes); p.loadBlock?.(world, rec, rec.ctrl, s.bytes); n++; }
  }
  return n;
}

/** the debug heap fill of 0x433d38 (FUN_00433d38(size, ...)) in one machine */
export function cdHeap(emu) {
  const mem = emu.cpu.mem;
  natives(emu);
  emu.cpu.hooks.set(0x433d38, (c) => { const n = c.arg(0), p = emu.alloc(n); for (let i = 0; i < n; i++) mem.w8(p + i, 0xcd); c.eax = p; });
}

/**
 * FUN_00419a79 (record lookup by 4 character tag, 0x419a79..0x419b17), which the pointer-translating loaders call, lies outside the executable ranges of the island machines: an unhosted call returns 0 (no record).
 * Run it natively (it reads the record array at DAT_00983804 / the count DAT_00983800 the machine mirrors).
 */
export function natives(emu) { emu.cpu.exec.push([0x419a79, 0x419b17]); }

/** run `fn` with every IslEmu built inside it using the debug heap fill (restored afterwards) */
export async function withCdHeap(fn) {
  const orig = IslEmu.prototype.initHosts;
  IslEmu.prototype.initHosts = function () { orig.call(this); cdHeap(this); natives(this); };
  try { return await fn(); } finally { IslEmu.prototype.initHosts = orig; }
}

/** the original's serializer natively; the cell / the write buffer are allocated once per machine */
export function origBlockFast(emu, node) {
  if (!node.saver) return null;
  const cpu = emu.cpu, mem = cpu.mem;
  const s = (emu.__m8 ??= { cell: emu.alloc(16), buf: emu.alloc(0x2000) });
  mem.w32(s.cell, 0);
  cpu.steps = 0;
  let size = cpu.call(node.saver, [node.ptr, s.cell], { maxSteps: 5_000_000 }) | 0;
  if (size === -1) {
    mem.w32(s.cell, s.buf);
    cpu.steps = 0;
    size = cpu.call(node.saver, [node.ptr, s.cell], { maxSteps: 5_000_000 }) | 0;
    return mem.read(s.buf, size);
  }
  return mem.read(mem.r32(s.cell), size);
}

/**
 * Byte ranges of a block that cannot be compared (returned as [lo, hi) pairs), by constructor.
 *  0x429d1b (carry, FUN_00429baa): the second half is `memcpy(out, carrier ? carrier : &local, 0x24)`. With no carrier (word 0 or 1) the 0x24 bytes are read from the saver's own stack frame starting at
 *  its local_18: local_18 (the word), local_14 (DAT_009da8bc), local_10 (u16 DAT_009da8c0) + 2 bytes of stack padding (garbage), local_c (0x24), local_8 (the destination address in the save buffer),
 *  the saved ebp, the return address and the two arguments (node, cell): block bytes 0x2e..0x2f and 0x34..0x47 are stack / heap addresses of the process. With a carrier they are the first 0x24 bytes of the
 *  carrier's record header: +4 (model pointer) and +8 (animation instance pointer) are heap addresses (block bytes 0x28..0x2f).
 */
export function maskRanges(ctor, ob, afterRestore = false) {
  if (ctor === 0x429d1b) {
    // after a restore the carrier's record header is read live from the carrier again (it moved since the snapshot): only the node's own 0x28 bytes come back from the loaded bytes
    if (afterRestore) return [[0x24, 0x48]];
    const w = ob[0x24] | (ob[0x25] << 8) | (ob[0x26] << 16) | (ob[0x27] << 24);
    return (w === 0 || w === 1) ? [[0x2e, 0x30], [0x34, 0x48]] : [[0x28, 0x30]];
  }
  return [];
}

/** like `compareBlocks`: { checked, failures, byCtor } with the masks above; `only` = Set of constructor addresses */
export function compareMasked(world, emu, label, only = null) {
  const out = { checked: 0, failures: [], byCtor: new Map() };
  for (const [i, r] of world.records.entries()) {
    const on = nativeNodes(emu, i), pn = portNodes(r);
    if (on.map((n) => n.ctor).join() !== pn.map((n) => n.ctor).join()) continue;
    on.forEach((o, k) => {
      const p = pn[k];
      if (only && !only.has(o.ctor)) return;
      out.checked++;
      const key = '0x' + o.ctor.toString(16);
      let s = out.byCtor.get(key); if (!s) out.byCtor.set(key, (s = { n: 0, bad: 0, size: -1 }));
      s.n++;
      const fail = (m) => { s.bad++; if (out.failures.length < 100) out.failures.push(`${label} rec ${i} ${r.name} node ${k} ctor ${key}: ${m}`); };
      if ((p.stamp >>> 0) !== (o.state >>> 0)) fail(`stamp port ${(p.stamp >>> 0).toString(16)} original ${(o.state >>> 0).toString(16)}`);
      const ob = origBlockFast(emu, o);
      if (ob) s.size = ob.length;
      if (!!p.loadBlock !== !!o.loader) fail(`loader: port ${!!p.loadBlock} original ${!!o.loader}`);
      const pb = p.saveBlock ? p.saveBlock(world, r, r.ctrl) : null;
      if (ob === null && pb === null) return;
      if (ob === null || pb === null) { fail(`save block: port ${pb ? pb.length + ' bytes' : 'none'} original ${ob ? ob.length + ' bytes' : 'none'}`); return; }
      if (ob.length !== pb.length) { fail(`size port ${pb.length} original ${ob.length}`); return; }
      const masked = maskRanges(o.ctor, ob);
      const a = Uint8Array.from(ob), b = Uint8Array.from(pb);
      for (const [lo, hi] of masked) for (let q = lo; q < hi; q++) { a[q] = 0; b[q] = 0; }
      const d = firstDiff(a, b);
      if (d >= 0) fail(`byte ${d} differs: original ${hex(ob.subarray(Math.max(0, d - 4), d + 8))} port ${hex(pb.subarray(Math.max(0, d - 4), d + 8))}`);
    });
  }
  return out;
}

/** the blocks of one tick must be equal after a restore too: compare a snapshot's bytes with what both machines hold now */
export function blocksEqualSnapshot(world, emu, snap, label, failures, max = 30) {
  for (const s of snap) {
    if (!s.bytes) continue;
    const o = nativeNodes(emu, s.i)[s.k], p = portNodes(world.records[s.i])[s.k];
    const ob = origBlockFast(emu, o), pb = p.saveBlock(world, world.records[s.i], world.records[s.i].ctrl);
    const m = maskRanges(s.ctor, s.bytes, true);
    const norm = (x) => { const y = Uint8Array.from(x); for (const [lo, hi] of m) for (let q = lo; q < hi; q++) y[q] = 0; return y; };
    for (const [who, b] of [['original', ob], ['port', pb]]) {
      const d = firstDiff(norm(s.bytes), norm(b));
      if (d >= 0 && failures.length < max) failures.push(`${label} rec ${s.i} node ${s.k} ctor 0x${s.ctor.toString(16)}: after restore the ${who}'s block differs from the loaded bytes at byte ${d}: loaded ${hex(s.bytes.subarray(Math.max(0, d - 4), d + 8))} now ${hex(b.subarray(Math.max(0, d - 4), d + 8))}`);
    }
  }
}

/**
 * Hook `Duel.prototype.tick`: after every tick (`every`) the blocks of `only` are compared (compareMasked) into the duel's failure list, and every `roundTrip` ticks a snapshot of the ORIGINAL's blocks
 * is taken, `roundTrip / 3` ticks later restored into both machines (original loader natively, port `loadBlock`) and compared again. `o.poke(duel)` runs right after each tick, before the comparison (a scenario that sets node state the duel's own scripts never reach, in both machines). Returns { stats, off() }.
 */
export function blockTick(only, o = {}) {
  const every = o.every ?? 1, roundTrip = o.roundTrip ?? 53;
  const proto = Duel.prototype, orig = proto.tick;
  const stats = { compares: 0, nodes: 0, restores: 0, restoredNodes: 0, byCtor: new Map() };
  proto.tick = function (held) {
    orig.call(this, held);
    o.poke?.(this);
    const W = this.P.world, label = `${this.label ?? 'duel'} t${this.t}`;
    const fl = [];
    if (this.t % every === 0) {
      const r = compareMasked(W, this.emu, label, only);
      stats.compares++; stats.nodes += r.checked;
      for (const [k, v] of r.byCtor) { const a = stats.byCtor.get(k) ?? { n: 0, bad: 0, size: v.size }; a.n += v.n; a.bad += v.bad; stats.byCtor.set(k, a); }
      for (const f of r.failures) fl.push('block: ' + f);
    }
    if (roundTrip > 0) {
      if (this.t % roundTrip === 0) this.__snap = snapshotFast(this.emu, W, only);
      else if (this.__snap && this.t % roundTrip === Math.max(1, Math.floor(roundTrip / 3))) {
        const n = restoreFast(W, this.emu, this.__snap);
        stats.restores++; stats.restoredNodes += n;
        blocksEqualSnapshot(W, this.emu, this.__snap, label, fl);
        this.__snap = null;
      }
    }
    for (const f of fl.slice(0, 5)) this.fail(f);
  };
  return { stats, off() { proto.tick = orig; } };
}
