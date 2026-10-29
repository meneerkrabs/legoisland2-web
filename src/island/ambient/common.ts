// Shared helpers of the WP7 node family (ambient life, music, the island's director; docs/re/m4/wp7-ambient.md):
//   - FUN_004388ae (rand) with a replaceable source for tests,
//   - the animation instances the island loader gives records 9..66 (FUN_004f645b @0x519c09; the port's setupZone only gives PEPP one),
//   - the island's sound handles (FUN_004b037e: global handle -> sound id), read from the executable's code at run time,
//   - the frustum flag (IslandCtx.inFrustum, FUN_00444370), sounds through the island context, the terrain snap of the controller probe.
import { buildMatrix } from '../../formats/matrix.ts';
import { parseBlk } from '../../formats/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import type { Pe } from '../../formats/exe.ts';
import { AnimInstance } from '../../game/anim.ts';
import { RF_FRUSTUM } from '../../game/record.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { NO_GROUND } from '../../game/collision.ts';
import { tryCtx } from '../ctx.ts';

/** _DAT_0089207c / _DAT_00892094 (pi, 2 pi as floats) */
export const PI = 3.1415927410125732, TWO_PI = 6.2831854820251465, HALF_PI = 1.5707963705062866;
/** the one-step wrap of the original (`if a < -pi a += 2pi; else if a > pi a -= 2pi`) */
export const wrapPi = (a: number) => (a < -PI ? a + TWO_PI : a > PI ? a - TWO_PI : a);
/** __ftol: truncation */
export const ftol = (x: number) => Math.trunc(x);
/** float32 rounding (the original keeps node state in floats) */
export const f32 = Math.fround;

// ------------------------------------------------------------------------------------------------ rand

let source: () => number = Math.random;
/** tests: a deterministic source in [0, 1) (null = Math.random) */
export function setAmbientRandom(f: (() => number) | null) { source = f ?? Math.random; }
/** FUN_004388ae(max): `rand() / 32767 * max` (0 for max <= 0) */
export function rand(max: number): number {
  if (max <= 0) return 0;
  return (Math.floor(source() * 32768) / 32767) * max;
}

// ------------------------------------------------------------------------------------------------ the frustum flag

/** record flag 1 (FUN_00444370): the island context's test when it has one, else the flag itself when something set it, else "in view" */
export function inView(w: World, rec: GameRecord): boolean {
  const c = tryCtx(w);
  if (c?.inFrustum) return c.inFrustum(rec);
  if (w.ext.get('frustum')) return (rec.flags & RF_FRUSTUM) !== 0;
  return true;
}

// ------------------------------------------------------------------------------------------------ sounds

/** FUN_004433f0(handle, pos) */
export function sfxAt(w: World, id: number, pos: readonly [number, number, number]) {
  if (id < 0) return;
  const c = tryCtx(w);
  if (c) c.sfxAt(id, pos); else w.playSound(id);
}
/** FUN_004435a0 */
export function sfx(w: World, id: number) { if (id < 0) return; const c = tryCtx(w); if (c) c.sfx(id); else w.playSound(id); }
/** FUN_004434b0 / FUN_004435b0 */
export function stopSfx(w: World, id: number) { if (id < 0) return; tryCtx(w)?.stopSfx(id); }
export const recPos = (r: GameRecord): [number, number, number] => [r.x, r.y, r.z];

/** FUN_004b037e: the island's sound handles. The function is a straight list of `push id; call 0x4433b0 (3D) / 0x443580 (2D); add esp, 4; mov [global], eax`
 *  followed by copies `mov reg, [src]; mov [dst], reg` (the director's cue table DAT_05d58214..). */
export const FN_ISLAND_SOUNDS = 0x4b037e, FN_ISLAND_SOUNDS_END = 0x4b0b1d;
const LOAD_3D = 0x4433b0, LOAD_2D = 0x443580;
export interface SoundHandle { id: number; is3d: boolean }
const handleCache = new WeakMap<Pe, Map<number, SoundHandle>>();
/** global handle address -> sound id (+ whether it was loaded as a 3D sound) */
export function islandSoundHandles(pe: Pe): Map<number, SoundHandle> {
  let m = handleCache.get(pe);
  if (m) return m;
  m = new Map();
  const u8 = (a: number) => pe.u32(a) & 0xff;
  let a = FN_ISLAND_SOUNDS;
  let pending: number | null = null;
  let lastLoad: SoundHandle | null = null;
  let movSrc: number | null = null;
  while (a < FN_ISLAND_SOUNDS_END) {
    const op = u8(a);
    if (op === 0x68) { pending = pe.u32(a + 1); a += 5; continue; }              // push imm32
    if (op === 0x6a) { pending = (u8(a + 1) << 24) >> 24; a += 2; continue; }      // push imm8
    if (op === 0xe8) {                                                             // call rel32
      const t = (a + 5 + (pe.u32(a + 1) | 0)) >>> 0;
      lastLoad = (t === LOAD_3D || t === LOAD_2D) && pending !== null ? { id: pending, is3d: t === LOAD_3D } : null;
      pending = null; a += 5; continue;
    }
    if (op === 0x83 && u8(a + 1) === 0xc4) { a += 3; continue; }                   // add esp, imm8
    if (op === 0xa3) {                                                             // mov [abs], eax
      const dst = pe.u32(a + 1);
      if (lastLoad) { m.set(dst, lastLoad); lastLoad = null; }
      else if (movSrc !== null && m.has(movSrc)) m.set(dst, m.get(movSrc)!);
      movSrc = null; a += 5; continue;
    }
    if (op === 0xa1) { movSrc = pe.u32(a + 1); a += 5; continue; }                 // mov eax, [abs]
    if (op === 0x8b && (u8(a + 1) & 0xc7) === 0x05) { movSrc = pe.u32(a + 2); a += 6; continue; }   // mov r32, [abs]
    if (op === 0x89 && (u8(a + 1) & 0xc7) === 0x05) {                              // mov [abs], r32
      const dst = pe.u32(a + 2);
      if (movSrc !== null && m.has(movSrc)) m.set(dst, m.get(movSrc)!);
      movSrc = null; a += 6; continue;
    }
    if (op === 0xc3) break;
    a++;   // prologue / chkesp bytes
  }
  handleCache.set(pe, m);
  return m;
}
/** the sound id behind a handle global (-1 when unknown) */
export function soundOf(w: World, handle: number): number {
  const c = tryCtx(w);
  if (!c) return -1;
  return islandSoundHandles(c.pe).get(handle)?.id ?? -1;
}

// ------------------------------------------------------------------------------------------------ animation instances of the loader

/** FUN_004f645b @0x519c09..0x51a8f0: `rec[r].anim = FUN_0043b4e2(rigs[k], 1); FUN_0043b6a3(rec[r].anim, 1, 0)` for records 9..66; rigs = SKBD, MFIG, SWFT, RBBT, PTER (0x8dbe28..) */
export const RIG_ASSIGN_START = 0x519c09, RIG_ASSIGN_END = 0x51a8f0;
export const RIG_NAMES_VA = [0x8dbe28, 0x8dbe44, 0x8dbe60, 0x8dbe7c, 0x8dbe98];
const ANIM_NEW = 0x43b4e2;
const rigCache = new WeakMap<Pe, Map<number, string>>();
/** record index -> rig name (`SWFT`) of the island loader's animation instances */
export function islandRigs(pe: Pe): Map<number, string> {
  let m = rigCache.get(pe);
  if (m) return m;
  m = new Map();
  const names = RIG_NAMES_VA.map((va) => { const s = pe.cstr(va); const b = s.split('\\').pop() ?? ''; return b.replace(/\.blk$/i, ''); });
  const u8 = (a: number) => pe.u32(a) & 0xff;
  for (let a = RIG_ASSIGN_START; a < RIG_ASSIGN_END; a++) {
    if (u8(a) !== 0xe8 || ((a + 5 + (pe.u32(a + 1) | 0)) >>> 0) !== ANIM_NEW) continue;
    // back: `mov reg, [0x9837fc]` then `mov reg2, [reg]` / `[reg + disp8]`, `push reg2`
    let k = -1;
    for (let b = a - 12; b < a; b++) {
      if (pe.u32(b) !== 0x009837fc) continue;
      const modrm = u8(b + 5);
      k = (modrm & 0xc0) === 0x40 ? u8(b + 6) / 4 : 0;
      break;
    }
    // forward: `mov ecx, [0x983804]` then `mov [ecx + disp32], eax` (89 81 disp32)
    let off = -1;
    for (let b = a + 5; b < a + 24; b++) if (u8(b) === 0x89 && u8(b + 1) === 0x81) { off = pe.u32(b + 2); break; }
    if (k < 0 || off < 0 || (off - 8) % 0x68 !== 0) continue;
    m.set((off - 8) / 0x68, names[k] ?? '');
  }
  rigCache.set(pe, m);
  return m;
}

const blkKey = 'ambient.rigs';
/** the record's animation instance; created like the loader does (rig of `islandRigs`, clip 1 frame 0) when the port's set-up gave it none */
export function ensureAnim(w: World, rec: GameRecord): AnimInstance | null {
  if (rec.anim) return rec.anim;
  const c = tryCtx(w);
  if (!c) return null;
  const name = islandRigs(c.pe).get(rec.index);
  if (!name) return null;
  let rigs = w.ext.get(blkKey) as Map<string, Blk | null> | undefined;
  if (!rigs) { rigs = new Map(); w.ext.set(blkKey, rigs); }
  if (!rigs.has(name)) {
    const e = c.archive.find(`anim/${name}.blk`);
    let b: Blk | null = null;
    if (e) { try { b = parseBlk(c.archive.read(e)); } catch { b = null; } }
    rigs.set(name, b);
  }
  const blk = rigs.get(name);
  if (!blk) return null;
  rec.anim = new AnimInstance(blk);
  rec.anim.start(1, 0);
  return rec.anim;
}

// ------------------------------------------------------------------------------------------------ matrices

/** FUN_0043a5e4(rec + 0xc, rx, ry, rz, x, y, z) with the record's Euler fields */
export function rebuild(rec: GameRecord) { rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z); }
/** FUN_0043a4a1(m, rx, ry, rz): rotation rebuilt, translation kept */
export function setRot(m: Float32Array, rx: number, ry: number, rz: number) { m.set(buildMatrix(rx, ry, rz, m[12], m[13], m[14])); }
/** FUN_0043a742(m, rx, ry, rz, x, y, z, sx, sy, sz) */
export function setScaled(m: Float32Array, rx: number, ry: number, rz: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  m.set(buildMatrix(rx, ry, rz, x, y, z, sx, sy, sz));
}

// ------------------------------------------------------------------------------------------------ the controller probe (terrain snap)

/**
 * FUN_00427014(ctrl, offset, delta, mask 3, 0x50) as the ambient nodes use it: the probe pass FUN_00427233 (not ported as a pass) puts the record on the
 * ground found by a ray from pos + offset along delta (flags 0x1053: y only, written back). Approximation: the ground record's ray (FUN_004425f0) from
 * pos + offset; the hit is taken when it lies within the segment.
 */
export function groundSnap(w: World, rec: GameRecord, up: number, down: number) {
  const top = rec.y + up;
  const h = w.col.groundRay(rec.x, top, rec.z);
  if (h === NO_GROUND) return;
  if (h <= top && h >= top + down) rec.y = h;
}
