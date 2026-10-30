// The save game part of the waypoint walker table (docs/re/save.md): FUN_00462d8b (writer) and FUN_00462e75 (loader), registered as `saveParts.walkers` (src/shell/saveparts.ts).
//
// File layout of the section (0x1fe0 bytes): the 60 walker structs of 0x84 bytes raw (0x1ef0, the table DAT_05d4e1b0), then 60 dwords: for walker k
//   flags (+0) == 0                      -> the dword at DAT_05d500b0 (never written: 0)
//   else the record pointer +0x14 == 0   -> the dword at DAT_05d500a8 (never written: 0)
//   else                                 -> the first 4 bytes of the record +0x14 points at (its tag; NB: the FOLLOW record, not the +0x08 record)
//
// The struct (offsets as in `Walker`, src/game/walker.ts):
//   +0x00 flags u32          +0x04 map u32            +0x08 record pointer (rebuilt by the loader from the 4 characters at +0x0c)   +0x0c record tag (4 bytes)
//   +0x10 blocker pointer (a walker of the table, static address: exact; the loader does not touch it)      +0x14 follow record pointer (rebuilt by the loader from the tags)
//   +0x18 goal i16  +0x1a to i16  +0x1c next i16  +0x1e from i16  +0x20 lane f32
//   +0x24 / +0x28 / +0x2c links of the node lists 0 / 1 / 2 (walker pointers, static: exact; the loader clears them and FUN_00463f9d rebuilds them)
//   +0x30..+0x38 point f32 x3  +0x3c pointSet u32  +0x40 turnRate +0x44 speed +0x48 speedReduced +0x4c radiusMin +0x50 radiusMax +0x54 curTurn +0x58 headingNext +0x5c headingCur +0x60 heading (f32)
//   +0x64 (no function reads or writes it: `pad64`)  +0x68 segLen2 +0x6c reach +0x70 curve +0x74 radiusLimit +0x78 stopDist2 +0x7c dist2 +0x80 speedScale (f32)
//
// POINTER WORDS. The original's record pointers are heap addresses of the running process; the oracle's convention (tools/lib/m8-save.mjs) is record i = 0x10000000 + i * 0x68, and the port writes the same
// convention. Walker pointers (+0x10 blocker, the links) are addresses in the exe image (0x5d4e1b0 + k * 0x84, the handle 0 "ghost" walker at 0x5d4e12c): exact. What the loader does with each word:
//   +0x08  rebuilt from the tag at +0x0c (FUN_00419a79); a walker whose record is gone is dropped (flags = 0, +0x08 = 0). A walker not in use keeps its raw file word (`Walker.stale.rec`).
//   +0x14  rebuilt from the tag table (0 for a walker not in use).
//   +0x24..+0x2c  cleared, then rebuilt by the node list registration in slot order.
//   +0x10  NOT touched: kept raw (decoded to a table walker, or kept raw in `Walker.stale` for a walker not in use).
// So the port's `applyWalkers` reads exactly what FUN_00462e75 reads from the blob and rebuilds the rest the same way (records by tag, node lists in slot order with FUN_00463f9d).
import type { World } from './world.ts';
import type { GameRecord } from './record.ts';
import { registerSavePart } from '../shell/saveparts.ts';
import type { WalkerBlob } from '../shell/saveparts.ts';
import { waypoints } from './walker.ts';   // (a live binding read at call time only: walker.ts imports this module)
import type { Walker, WalkerRecord, WaypointSystem } from './walker.ts';

const MAX_WALKERS = 60;   // = walker.ts MAX_WALKERS (0x3c)

export const WALKER_BYTES = 0x84, WALKER_TABLE_BYTES = MAX_WALKERS * WALKER_BYTES;   // 0x1ef0
const TABLE_ADDR = 0x5d4e1b0, RECORDS_BASE = 0x10000000, RECORD_BYTES = 0x68;

// (the same two functions as src/shell/saveworld.ts: this module must not import the shell's world code; the walker's tag is the 4 name characters, padded with 0)
function tagOf(name: string | undefined): number {
  let t = 0;
  for (let k = 0; k < 4; k++) t |= (name && k < name.length ? name.charCodeAt(k) & 0xff : 0) << (8 * k);
  return t >>> 0;
}
/** FUN_00419a79: the first record whose 4 name bytes equal the tag (a tag whose first byte is 0 matches nothing) */
function recordOfTag(w: World, tag: number): GameRecord | null {
  if ((tag & 0xff) === 0) return null;
  for (const r of w.records) if (tagOf(r.name) === tag) return r;
  return null;
}

/** the oracle's address of a record: 0x10000000 + index * 0x68 (0 = no record) */
function recPtr(w: World, r: WalkerRecord | null): number {
  if (!r) return 0;
  let i = (r as { index?: number }).index;
  if (i === undefined || w.records[i] !== (r as GameRecord)) { const j = w.records.indexOf(r as GameRecord); if (j >= 0) i = j; }
  return (RECORDS_BASE + (i ?? 0) * RECORD_BYTES) >>> 0;
}
const walkerPtr = (sys: WaypointSystem, x: Walker | null): number => {
  if (!x) return 0;
  const k = sys.slots.indexOf(x);
  return k >= 0 ? (TABLE_ADDR + k * WALKER_BYTES) >>> 0 : x === sys.ghost ? (TABLE_ADDR - WALKER_BYTES) >>> 0 : 0;
};

/** FUN_00462d8b: the table as the original writes it (`sys` defaults to the global table) */
export function captureWalkers(w: World, sys: WaypointSystem = waypoints): WalkerBlob {
  const walkers = new Uint8Array(WALKER_TABLE_BYTES), tags = new Uint32Array(MAX_WALKERS);
  const dv = new DataView(walkers.buffer);
  for (let k = 0; k < MAX_WALKERS; k++) {
    const x = sys.slots[k], o = k * WALKER_BYTES, live = x.flags !== 0;
    dv.setUint32(o, x.flags >>> 0, true);
    dv.setUint32(o + 0x04, x.map >>> 0, true);
    dv.setUint32(o + 0x08, !live && x.stale ? x.stale.rec : recPtr(w, x.rec), true);
    dv.setUint32(o + 0x0c, tagOf(x.recName), true);
    dv.setUint32(o + 0x10, !live && x.stale ? x.stale.blocker : walkerPtr(sys, x.blocker), true);
    dv.setUint32(o + 0x14, recPtr(w, x.follow), true);
    dv.setInt16(o + 0x18, x.goal, true); dv.setInt16(o + 0x1a, x.to, true); dv.setInt16(o + 0x1c, x.next, true); dv.setInt16(o + 0x1e, x.from, true);
    dv.setFloat32(o + 0x20, x.lane, true);
    for (let l = 0; l < 3; l++) dv.setUint32(o + 0x24 + 4 * l, walkerPtr(sys, x.link[l]), true);
    for (let l = 0; l < 3; l++) dv.setFloat32(o + 0x30 + 4 * l, x.point[l], true);
    dv.setUint32(o + 0x3c, x.pointSet >>> 0, true);
    dv.setFloat32(o + 0x40, x.turnRate, true); dv.setFloat32(o + 0x44, x.speed, true); dv.setFloat32(o + 0x48, x.speedReduced, true);
    dv.setFloat32(o + 0x4c, x.radiusMin, true); dv.setFloat32(o + 0x50, x.radiusMax, true); dv.setFloat32(o + 0x54, x.curTurn, true);
    dv.setFloat32(o + 0x58, x.headingNext, true); dv.setFloat32(o + 0x5c, x.headingCur, true); dv.setFloat32(o + 0x60, x.heading, true);
    dv.setUint32(o + 0x64, x.pad64 >>> 0, true);
    dv.setFloat32(o + 0x68, x.segLen2, true); dv.setFloat32(o + 0x6c, x.reach, true); dv.setFloat32(o + 0x70, x.curve, true);
    dv.setFloat32(o + 0x74, x.radiusLimit, true); dv.setFloat32(o + 0x78, x.stopDist2, true); dv.setFloat32(o + 0x7c, x.dist2, true); dv.setFloat32(o + 0x80, x.speedScale, true);
    // the tag dword: DAT_05d500b0 (0) for a free slot, DAT_05d500a8 (0) without a follow record, else the first 4 bytes of the follow record
    tags[k] = !live ? 0 : x.follow ? tagOf(x.follow.name) : 0;
  }
  return { walkers, tags };
}

/**
 * FUN_00462e75: put a table back. The raw struct bytes go into the slots; then the loader's four passes: (1) +0x14 by the tag of the file, (2) the links cleared and +0x08 by the tag at +0x0c,
 * (3) every node list head cleared (nodes 0 .. count-1 of the 4 maps), (4) a walker without record is dropped, the others are entered into the node lists (FUN_00463f9d) in slot order.
 */
export function applyWalkers(w: World, blob: WalkerBlob, sys: WaypointSystem = waypoints): void {
  const dv = new DataView(blob.walkers.buffer, blob.walkers.byteOffset, blob.walkers.byteLength);
  const raw08: number[] = [], raw10: number[] = [];
  for (let k = 0; k < MAX_WALKERS; k++) {
    const x = sys.slots[k], o = k * WALKER_BYTES;
    x.flags = dv.getUint32(o, true);
    x.map = dv.getUint32(o + 0x04, true);
    raw08[k] = dv.getUint32(o + 0x08, true);
    x.recName = nameOfTag(dv.getUint32(o + 0x0c, true));
    raw10[k] = dv.getUint32(o + 0x10, true);
    x.goal = dv.getInt16(o + 0x18, true); x.to = dv.getInt16(o + 0x1a, true); x.next = dv.getInt16(o + 0x1c, true); x.from = dv.getInt16(o + 0x1e, true);
    x.lane = dv.getFloat32(o + 0x20, true);
    x.point = [dv.getFloat32(o + 0x30, true), dv.getFloat32(o + 0x34, true), dv.getFloat32(o + 0x38, true)];
    x.pointSet = dv.getUint32(o + 0x3c, true);
    x.turnRate = dv.getFloat32(o + 0x40, true); x.speed = dv.getFloat32(o + 0x44, true); x.speedReduced = dv.getFloat32(o + 0x48, true);
    x.radiusMin = dv.getFloat32(o + 0x4c, true); x.radiusMax = dv.getFloat32(o + 0x50, true); x.curTurn = dv.getFloat32(o + 0x54, true);
    x.headingNext = dv.getFloat32(o + 0x58, true); x.headingCur = dv.getFloat32(o + 0x5c, true); x.heading = dv.getFloat32(o + 0x60, true);
    x.pad64 = dv.getUint32(o + 0x64, true);
    x.segLen2 = dv.getFloat32(o + 0x68, true); x.reach = dv.getFloat32(o + 0x6c, true); x.curve = dv.getFloat32(o + 0x70, true);
    x.radiusLimit = dv.getFloat32(o + 0x74, true); x.stopDist2 = dv.getFloat32(o + 0x78, true); x.dist2 = dv.getFloat32(o + 0x7c, true); x.speedScale = dv.getFloat32(o + 0x80, true);
    x.link = [null, null, null]; x.stale = null;
  }
  // the blocker words: a walker of the table, kept as the file has it
  const walkerAt = (p: number): Walker | null => {
    if (p === 0) return null;
    const d = (p - TABLE_ADDR) | 0;
    if (d === -WALKER_BYTES) return sys.ghost;
    return d >= 0 && d % WALKER_BYTES === 0 && d / WALKER_BYTES < MAX_WALKERS ? sys.slots[d / WALKER_BYTES] : null;
  };
  // pass 1: +0x14 from the tags (0 for a slot not in use); pass 2: +0x08 from the name at +0x0c
  for (let k = 0; k < MAX_WALKERS; k++) {
    const x = sys.slots[k];
    x.follow = x.flags !== 0 ? recordOfTag(w, blob.tags[k]) : null;
    x.blocker = walkerAt(raw10[k]);
    x.rec = x.flags !== 0 ? recordOfTag(w, tagOf(x.recName)) : null;
  }
  // pass 3: the node lists forget everything
  for (const m of sys.maps) if (m) m.heads.fill(null);
  // pass 4: a walker without record is dropped, the others enter the node lists, in slot order
  for (let k = 0; k < MAX_WALKERS; k++) {
    const x = sys.slots[k];
    const wasLive = x.flags !== 0;
    if (x.rec === null && wasLive) x.flags = 0;     // (the loader leaves +0x08 = 0 for a dropped walker, the file's word for a slot that was not in use)
    if (x.flags !== 0) sys.register(x);
    else x.stale = { rec: wasLive ? 0 : raw08[k], blocker: raw10[k] };
    sys.walkers[k] = x.flags !== 0 ? x : null;
  }
}

/** the 4 characters of a tag dword (a 0 byte ends the name) */
function nameOfTag(t: number): string {
  let s = '';
  for (let k = 0; k < 4; k++) { const c = (t >>> (8 * k)) & 0xff; if (c === 0) break; s += String.fromCharCode(c); }
  return s;
}

registerSavePart('walkers', { capture: (w) => captureWalkers(w), apply: (w, b) => applyWalkers(w, b) });
