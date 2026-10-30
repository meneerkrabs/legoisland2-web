// WP-SAVE (worker d): the save-block checks of the family duels. `m8Hook(d, only, failures, opts)` wraps `d.tick` of a `Duel` (tools/lib/m7-isl-veh-emu.mjs) so that
//   * every `every` ticks   compareBlocks(port world, original's machine): every node of the `only` constructors, block bytes + +8 state words, tolerance 0;
//   * every `period` ticks  a snapshot of the ORIGINAL's blocks (snapshotBlocks) is taken, `hold` ticks later it is put back into BOTH machines (restoreBlocks: the original's
//                           loader natively, the port's `loadBlock` with the same bytes); the blocks must be equal again (original = snapshot = port) right after the load
//                           and the duel goes on with its own comparisons for the next ticks: the node must behave like the original's node loaded from the same bytes.
// The family tests need no other change: they keep calling `d.tick(...)`.
import { compareBlocks, snapshotBlocks, restoreBlocks, nativeNodes, portNodes, hex, firstDiff, RECORDS_BASE, REC } from './m8-save.mjs';
import { eulerRotation } from '../../src/zones/exact.ts';

const fbits = (v) => { const f = new Float32Array(1); f[0] = v; return new Uint32Array(f.buffer)[0]; };

/**
 * The entity header of FUN_00418ec7 / FUN_00419e82 for the records of the snapshot (position, Euler angles, flags u16 of the ORIGINAL's record), put back into both machines the way the
 * loader does: the original's own FUN_0043a5e4 rebuilds the matrix from the Euler angles natively, the port does the same through `eulerRotation` (src/shell/saveworld.ts applyEntitySection).
 */
export function snapshotRecords(emu, recIdx) {
  const mem = emu.cpu.mem;
  return [...new Set(recIdx)].map((i) => { const a = RECORDS_BASE + i * REC; return { i, pos: [mem.f32(a + 0x3c), mem.f32(a + 0x40), mem.f32(a + 0x44)], eul: [mem.f32(a + 0x4c), mem.f32(a + 0x50), mem.f32(a + 0x54)], flags: mem.r16(a + 0x60) }; });
}
export function restoreRecords(d, snap) {
  const mem = d.emu.cpu.mem;
  for (const s of snap) {
    const a = RECORDS_BASE + s.i * REC, r = d.P.world.records[s.i];
    // the original: Euler angles + flags into the record, FUN_0043a5e4(rec + 0xc, euler, pos) rebuilds the matrix
    for (let k = 0; k < 3; k++) mem.wf32(a + 0x4c + 4 * k, s.eul[k]);
    // (record flag bit 0, the frustum test's result: the renderer recomputes it every frame before the pre-render pass, so the machines keep the current one)
    const fb = mem.r16(a + 0x60) & 1, pfb = r.flags & 1;
    mem.w16(a + 0x60, (s.flags & ~1) | fb);
    d.emu.cpu.steps = 0;
    d.emu.cpu.call(0x43a5e4, [a + 0xc, ...s.eul.map(fbits), ...s.pos.map(fbits)], { maxSteps: 1_000_000 });
    d.emu.dirty?.add(s.i);
    // the port: applyEntitySection
    r.m[12] = s.pos[0]; r.m[13] = s.pos[1]; r.m[14] = s.pos[2];
    r.rx = s.eul[0]; r.ry = s.eul[1]; r.rz = s.eul[2];
    eulerRotation(r.m, r.rx, r.ry, r.rz);
    r.flags = (r.flags & ~0xffff) | (s.flags & ~1) | pfb;
    r.savePrev();
  }
  d.emu.sync?.();
}

export function m8Hook(d, only, failures, o = {}) {
  const every = o.every ?? 7, period = o.period ?? 97, hold = o.hold ?? 31, getLabel = () => o.label ?? d.label ?? 'm8';
  const set = only instanceof Set ? only : new Set(only);
  d.emu.cpu.exec.push([0x419a79, 0x419b17]);   // FUN_00419a79 (record by 4 character tag), called by the pointer translating loaders, runs natively
  const st = d.m8 = { checks: 0, blocks: 0, bad: 0, trips: 0, tripBlocks: 0, ctors: new Set(), ticks: 0 };
  let snap = null, recSnap = null, n = 0;
  const bad = (m) => { st.bad++; if (failures.length < (o.max ?? 40)) failures.push(m); };
  // the oracle's calls allocate scratch buffers in the emulated heap (a bump allocator): give them back after every use
  const scratch = (f) => { const brk = d.emu.brk; try { return f(); } finally { d.emu.brk = brk; } };
  const check = (what) => {
    const lab = `${getLabel()} ${what} t${d.t ?? n}`;
    const r = scratch(() => compareBlocks(d.P.world, d.emu, lab, set));
    st.checks++; st.blocks += r.checked;
    for (const k of r.byCtor.keys()) st.ctors.add(k);
    for (const f of r.failures.slice(0, 5)) bad(f);
    return r;
  };
  const tick = d.tick.bind(d);
  // the load happens at the START of a tick (the family tests read the records right after `d.tick` returns, against what the original drew during it)
  const load = () => {
    restoreRecords(d, recSnap);
    o.beforeLoad?.(d, snap);
    const k = scratch(() => restoreBlocks(d.P.world, d.emu, snap));
    st.trips++; st.tripBlocks += k;
    check('after load');
    // the port's blocks after the load = the loaded bytes (the load must not alter what is saved)
    for (const s of snap) {
      if (!s.bytes) continue;
      const p = portNodes(d.P.world.records[s.i])[s.k];
      const pb = p?.saveBlock?.(d.P.world, d.P.world.records[s.i], d.P.world.records[s.i].ctrl);
      if (!pb) continue;
      const x = firstDiff(s.bytes, pb);
      if (x >= 0) bad(`${getLabel()} load round trip rec ${s.i} node ${s.k} ctor 0x${s.ctor.toString(16)}: byte ${x} loaded ${hex(s.bytes.subarray(Math.max(0, x - 4), x + 8))} saved again ${hex(pb.subarray(Math.max(0, x - 4), x + 8))}`);
    }
    o.afterLoad?.(d, snap);
    snap = null;
  };
  let snapAt = 0, whenN = 0;
  d.tick = (...a) => {
    if (snap && n >= snapAt + hold) load();
    const res = tick(...a);
    n++; st.ticks++;
    if (n % every === 0) check('blocks');
    // a snapshot every `period` ticks, and (when the family test knows the interesting moments) whenever `snapWhen(d)` says so, at most `snapWhenMax` times
    if (!snap && (n % period === 0 || (o.snapWhen && whenN < (o.snapWhenMax ?? 30) && o.snapWhen(d)))) {
      if (n % period !== 0) whenN++;
      snap = scratch(() => snapshotBlocks(d.emu, d.P.world, set)); recSnap = snapshotRecords(d.emu, snap.map((x) => x.i)); snapAt = n;
    }
    return res;
  };
  d.m8check = check; d.m8scratch = scratch;
  return st;
}
/** the note line for a test's notes */
export const m8Note = (st) => `save blocks: ${st.checks} comparisons of ${st.blocks} node blocks (constructors ${[...st.ctors].join(' ')}), ${st.trips} load round trips (${st.tripBlocks} blocks loaded into both machines), ${st.bad} differences`;
