// The island's particle emitters, started exactly like the original does (docs/re/particles.md, gaps S7 / S10): `ctx.fx` is the zone's ZoneParticles; a node calls
// `fxStart` where the original calls FUN_00442960 (name, PARENT MATRIX, local offset, Euler rotation, gate) and keeps the handle, then `fxGate` (FUN_00442a20 /
// FUN_0044ea60), `fxMatrix` (FUN_00442a00), `fxParam` (FUN_0044ebd0), `fxStop` (FUN_00442a40) like the original's nodes.
//   * records: the matrix argument `rec + 0xc` is the record's LIVE matrix (`recMatrix`: a function, so a replaced array is followed too).
//   * static matrices: the emitters of the era functions (bill01 / rocket01 / twinkle03 / zzz) are bound to private matrices DAT_05d58390.. (BSS, zero until the director
//     fills them from a record's bone matrix: `composeBone`, FUN_0043a9e5(dst, record matrix, bone matrix)); `staticMatrix(w, va)` is that buffer.
//   * `startSetupEmitters(w)` replays the particleEmitter calls the emulated set-up recorded (the era functions' FUN_00442960 calls): same arguments, same order, so the
//     handles are the original's; `setupEmitter(w, va)` finds the one bound to a static matrix (the director's DAT_05d585d0 / 05d58384 / 05d58300 handles).
//   * every emitter is created in the first tick; `fx.finish()` (FUN_0044e8d0, the [SPLASH] extras) runs once at the end of it (`finishEmitters`).
import type { GameRecord } from '../game/record.ts';
import type { World } from '../game/world.ts';
import type { IslandSetup } from '../formats/emusetup.ts';
import { recFieldOfPtr } from '../formats/emusetup.ts';
import type { Pe } from '../formats/exe.ts';
import type { ZoneParticles } from '../fx/particles/zone.ts';
import { tryCtx } from './ctx.ts';

/** NO_HANDLE of the engine (0xbabababa: every call ignores it) */
export const FX_NONE = 0xbabababa;
export type Gate = readonly [number, number, number];
/** FUN_00442a20(h, 2, 1, 1) / (h, 1, 1, 1): emit / stop emitting (var 2 always reads 1, var 1 always 0) */
export const GATE_ON: Gate = [2, 1, 1], GATE_OFF: Gate = [1, 1, 1];
export const HALF_PI = Math.fround(1.5707964);   // 0x3fc90fdb (the start calls' rotation about x)

export function fxOf(w: World): ZoneParticles | null {
  const f = tryCtx(w)?.fx as ZoneParticles | null | undefined;
  return f && typeof f.start === 'function' ? f : null;   // (a hub's test double without the engine API: no emitters)
}

/** the live matrix of a record as the engine reads it (the engine keeps the function) */
export function recMatrix(rec: GameRecord): () => Float32Array { return () => rec.m as Float32Array; }

/** FUN_00442960(name, matrix, pos, rot, gate): the handle, FX_NONE without a particle engine */
export function fxStart(w: World, name: string, matrix: Float32Array | (() => Float32Array) | null, pos: ArrayLike<number>, rot: ArrayLike<number>, gate: Gate = GATE_OFF): number {
  const fx = fxOf(w);
  return fx ? fx.start(name, matrix, pos, rot, gate) : FX_NONE;
}
/** FUN_004429a0: a swirl list (the parent matrix comes from `fxMatrix`) */
export function fxStartSwirl(w: World, name: string, pos: ArrayLike<number>, rot: ArrayLike<number>, gate: Gate = GATE_OFF): number {
  const fx = fxOf(w);
  return fx ? fx.startSwirl(name, pos, rot, gate) : FX_NONE;
}
/** FUN_00442a20 / FUN_0044ea60(h, var, mask, value) */
export function fxGate(w: World, h: number, gate: Gate): void { if (h !== FX_NONE) fxOf(w)?.setGate(h, gate); }
/** FUN_00442a00 / FUN_0044ea00(h, matrix) */
export function fxMatrix(w: World, h: number, m: Float32Array | (() => Float32Array)): void { if (h !== FX_NONE) fxOf(w)?.setMatrix(h, m); }
/** FUN_0044ebd0(h, type, value) */
export function fxParam(w: World, h: number, type: number, value: number): void { if (h !== FX_NONE) fxOf(w)?.setParam(h, type, value); }
/** FUN_00442a40(h) */
export function fxStop(w: World, h: number): void { if (h !== FX_NONE) fxOf(w)?.stop(h); }

const fr = Math.fround;
// ---------------------------------------------------------------- bone matrices

/**
 * FUN_0043a9e5(dst, a, b) = b * a in the original's row-vector convention (the 3x3 of `b` through the 3x3 of `a`, `b`'s translation through the 3x3 plus `a`'s translation; the
 * fourth column 0 / 0 / 0 / 1): with a = a record's matrix and b = one of its bone matrices (FUN_0043bc58(model, bone)) this is the bone in world space.
 */
export function composeBone(dst: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>, bo = 0): Float32Array {
  // (the x87 at 24 bit: every product and sum a float32, the adds run x, y, z, the translation row adds `a`'s translation last)
  for (let r = 0; r < 4; r++) {
    const x = b[bo + r * 4], y = b[bo + r * 4 + 1], z = b[bo + r * 4 + 2];
    for (let c = 0; c < 3; c++) {
      let v = fr(fr(fr(x * a[c]) + fr(y * a[4 + c])) + fr(z * a[8 + c]));
      if (r === 3) v = fr(v + a[12 + c]);
      dst[r * 4 + c] = v;
    }
    dst[r * 4 + 3] = r === 3 ? 1 : 0;
  }
  return dst;
}
/** FUN_0043bc58(model, bone) + FUN_0043a9e5(dst, record matrix, bone matrix): the bone of a posed record in world space; without a pose the record's own matrix */
export function boneWorld(dst: Float32Array, rec: GameRecord, bone: number): Float32Array {
  const p = rec.anim?.pose(1);
  if (!p || p.length < bone * 16 + 16) { dst.set(rec.m); return dst; }
  return composeBone(dst, rec.m, p, bone * 16);
}

// ---------------------------------------------------------------- the emulated set-up's emitters + the static matrices

interface FxState { statics: Map<number, Float32Array>; byStatic: Map<number, number>; started: number; finished: boolean }
const KEY = 'island.fx';
function stateOf(w: World): FxState {
  let s = w.ext.get(KEY) as FxState | undefined;
  if (!s) { s = { statics: new Map(), byStatic: new Map(), started: 0, finished: false }; w.ext.set(KEY, s); }
  return s;
}
/** a private matrix of the executable's BSS (DAT_05d58390 ...): zero until the code fills it */
export function staticMatrix(w: World, va: number): Float32Array {
  const s = stateOf(w);
  let m = s.statics.get(va);
  if (!m) { m = new Float32Array(16); s.statics.set(va, m); }
  return m;
}
/** the handle of the set-up emitter bound to the static matrix at `va` (the original's DAT_05d585d0 + 4 k / 05d58384 / 05d58300 ...), FX_NONE when none */
export function setupEmitter(w: World, va: number): number { startSetupEmitters(w); return stateOf(w).byStatic.get(va) ?? FX_NONE; }

/**
 * The particleEmitter calls of the emulated set-up (the era functions FUN_004bf737 / 004bfec3 / 004c0471 / 004c0ce9 and the era-2 function FUN_004c01a0): FUN_00442960(name,
 * matrix, x, y, z, rx, ry, rz, var, mask, value) with the matrix pointer a record's `+ 0xc` or a static buffer. Started in the order of the calls; the engine hands out the
 * same handle numbers as the original's.
 */
export function startSetupEmitters(w: World): void {
  const fx = fxOf(w), c = tryCtx(w);
  const s = stateOf(w);
  if (!fx || !c || s.started) return;   // the zone game installs the particle engine after the set-up: the first user starts them
  s.started = 1;
  const setup: IslandSetup = c.setup, pe: Pe = c.pe;
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  const flt = (bits: number) => { u32[0] = bits >>> 0; return f32[0]; };
  for (const c of setup.calls) {
    if (c.fn !== 0x442960) continue;
    const a = c.args;
    const name = pe.cstr(a[0]);
    const f = recFieldOfPtr(a[1]);
    let matrix: Float32Array | (() => Float32Array) | null = null;
    if (f) {
      const rec = w.records[f.record];
      if (rec && f.field === 0xc) matrix = recMatrix(rec);
    } else if (a[1] >>> 0 >= 0x5d00000) matrix = staticMatrix(w, a[1] >>> 0);
    const gate: Gate = [a[8] | 0, a[9] | 0, a[10] | 0];
    const h = fx.start(name, matrix, [flt(a[2]), flt(a[3]), flt(a[4])], [flt(a[5]), flt(a[6]), flt(a[7])], gate);
    if (!f && a[1] >>> 0 >= 0x5d00000) s.byStatic.set(a[1] >>> 0, h);
  }
}

/** node families whose constructors create emitters register here: `finishEmitters` runs them (once the engine exists) before FUN_0044e8d0 */
const starters: ((w: World) => void)[] = [];
export function registerFxStart(fn: (w: World) => void): void { starters.push(fn); }

/** FUN_0044e8d0 (the [SPLASH] extras of the engine) once, after the first tick's constructors created their emitters */
export function finishEmitters(w: World): void {
  startSetupEmitters(w);
  const s = stateOf(w);
  if (s.finished || !fxOf(w)) return;
  for (const f of starters) f(w);
  s.finished = true;
  fxOf(w)?.finish();
}
