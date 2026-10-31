// z07CSI, the castle (M5): helpers shared by the hub's nodes. Every constant names the address of the original it comes from. The original runs the x87 in 24-bit precision (the
// Direct3D device leaves it single): every operation of the nodes below rounds to float32 (`f32`); checked bit for bit against the original in tools/tests/m5-z07CSI-*.mjs.
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { tryCtx } from '../../island/ctx.ts';
import type { IslandCtx } from '../../island/ctx.ts';
import { rand } from '../../island/ambient/common.ts';

export const f32 = Math.fround;
const FB = new DataView(new ArrayBuffer(4));
/** the float32 with the given bit pattern: the data words / literals of the decompile (`0x3e32b884`) written as they appear there */
export function fb(bits: number): number { FB.setUint32(0, bits >>> 0); return FB.getFloat32(0); }
/** _DAT_0089207c / _DAT_00892094 / _DAT_00892098 (pi, 2 pi, -pi as floats) */
export const PI = f32(3.1415927410125732), TWO_PI = f32(6.2831854820251465), NEG_PI = f32(-3.1415927410125732);

/**
 * FUN_0042216f(record, focus distance slot): the controller's +0x18 as the original computes it: the XZ distance to the focus record, every step in float32
 * (dx = fz - z ...; `dy` is zeroed before the squares: `dx * dx + 0 * 0 + dz * dz`).
 */
export function distSq32(w: World, rec: GameRecord): number {
  const p = w.focus;
  if (!p) return 0;
  const dx = f32(p.m[12] - rec.m[12]), dz = f32(p.m[14] - rec.m[14]);
  return f32(f32(f32(dx * dx) + 0) + f32(dz * dz));
}

/**
 * FUN_004388ae(max) as the original's x87 code returns it (24-bit precision, `fild r; fdiv 32767.0f; fmul max; fst`): rand() / 32767 is rounded to float32, the product with the float32 `max`
 * is rounded again (the shared `rand(max)` of island/rng.ts does the same two float32 roundings on the shared crt.ts generator; this keeps the argument's float32 test of the original).
 */
export function rand32(max: number): number {
  if (f32(max) <= 0) return 0;
  return f32(f32(rand(1)) * f32(max));
}

/** the hub's context (the HubContext at run time, a mock in the node tests); the hub's own members are optional */
export interface CsiCtx extends IslandCtx { soundOf?(addr: number): number }
export const ctxOf = (w: World): CsiCtx | undefined => tryCtx(w) as CsiCtx | undefined;

/** FUN_004b0f16 (run by every SGwalk constructor, i.e. by the player chain of the set-up): DAT_009da8f4 = the sound 0x2f1 ("collected" chime) */
export const SND = { PICKUP: 0x2f1 } as const;
/** FUN_004435a0(handle of a sound id) */
export function playId(w: World, id: number) { ctxOf(w)?.sfx(id); }
/** the sound id behind a handle global of FUN_00572ef0 (the castle's sound loader: `HubContext.soundOf`), -1 unknown */
export function soundId(w: World, addr: number): number { return ctxOf(w)?.soundOf?.(addr) ?? -1; }
/** FUN_004435a0(DAT_...) */
export function play(w: World, addr: number) { const id = soundId(w, addr); if (id >= 0) ctxOf(w)?.sfx(id); }
/** FUN_004433f0(DAT_..., &pos) */
export function playAt(w: World, addr: number, pos: readonly [number, number, number]) { const id = soundId(w, addr); if (id >= 0) ctxOf(w)?.sfxAt(id, pos); }
/** FUN_004434b0 (stop a 3D sound) / FUN_004435b0 (stop a 2D sound) */
export function stop(w: World, addr: number) { const id = soundId(w, addr); if (id >= 0) ctxOf(w)?.stopSfx(id); }

/**
 * FUN_0043a9e5(dst, a, b) = b * a in the original's row-vector convention, every x87 step rounded to float32 in the order the machine code runs it (verified against the original in the
 * emulator on random matrices: `(b0 * a0 + b1 * a4) + b2 * a8`, the translation row then adds a's translation last). With a = a record's matrix and b = one of its bone matrices
 * (FUN_0043bc58(model, bone)) this is the bone in world space. (The shared `composeBone` of src/island/emitters.ts sums in doubles: up to one float32 ulp apart.)
 */
export function composeBone32(dst: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>, bo = 0): Float32Array {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      let v = f32(f32(f32(b[bo + r * 4] * a[c]) + f32(b[bo + r * 4 + 1] * a[4 + c])) + f32(b[bo + r * 4 + 2] * a[8 + c]));
      if (r === 3) v = f32(v + a[12 + c]);
      dst[r * 4 + c] = v;
    }
    dst[r * 4 + 3] = r === 3 ? 1 : 0;
  }
  return dst;
}
/** FUN_0043bc58(model, bone) + FUN_0043a9e5(dst, record matrix, bone matrix): the bone of a posed record in world space; without a pose the record's own matrix */
export function boneWorld32(dst: Float32Array, rec: GameRecord, bone: number): Float32Array {
  const p = rec.anim?.pose(1);
  if (!p || p.length < bone * 16 + 16) { dst.set(rec.m); return dst; }
  return composeBone32(dst, rec.m, p, bone * 16);
}
