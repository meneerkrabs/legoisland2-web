// z14OSD: helpers that keep the nodes bit-exact with the original's x87 code (24-bit precision: every operation rounds to float32; checked against the original in tools/tests/m5-z14OSD-emu.mjs).
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { tryCtx } from '../../island/ctx.ts';
import { rand } from '../../island/ambient/common.ts';
import { ctrlExtra } from '../../island/npc/globals.ts';
import type { Controller } from '../../game/controller.ts';
import { PI, TWO_PI, NEG_PI } from './common.ts';

const FB = new DataView(new ArrayBuffer(4));
/** the float32 with the given bit pattern: the data words / literals of the decompile (`0x3e32b884`) written as they appear there (a decimal such as 0.17453293 is NOT the same float) */
export function fb(bits: number): number { FB.setUint32(0, bits >>> 0); return FB.getFloat32(0); }

/**
 * FUN_0042216f(record, focus distance slot): the controller's +0x18 as the original computes it: the XZ distance to the focus record, every step in float32
 * (dx = fz - z ...; `dy` is zeroed before the squares: `dx * dx + 0 * 0 + dz * dz`).
 */
export function distSq32(w: World, rec: GameRecord): number {
  const f = Math.fround, p = w.focus;
  if (!p) return 0;
  const dx = f(p.m[12] - rec.m[12]), dz = f(p.m[14] - rec.m[14]);
  return f(f(f(dx * dx) + 0) + f(dz * dz));
}

const names = new WeakMap<object, Map<number, string>>();
/**
 * `_strncmp(record name, string at va, 4) == 0` of the original (FUN_00085e410 over the first four bytes): the string is read from the executable; it may be LONGER than the name (the Oasis' second
 * tumbleweed pattern is "TUM01": it matches TUM0, not TUM1) or shorter (a NUL ends the comparison).
 */
export function nameIs4(w: World, rec: GameRecord, va: number): boolean {
  const pe = tryCtx(w)?.pe;
  if (!pe) return false;
  let m = names.get(pe);
  if (!m) { m = new Map(); names.set(pe, m); }
  let s = m.get(va);
  if (s === undefined) { s = pe.cstr(va); m.set(va, s); }
  for (let i = 0; i < 4; i++) {
    const x = i < rec.name.length ? rec.name.charCodeAt(i) : 0x20, y = i < s.length ? s.charCodeAt(i) : 0;
    if (x !== y) return false;
    if (y === 0) break;
  }
  return true;
}

/**
 * FUN_004388ae(max) as the original's x87 code returns it (24-bit precision, `fild r; fdiv 32767.0f; fmul max; fst`): rand() / 32767 is rounded to float32, the product with the float32 `max`
 * is rounded again. The shared `rand(max)` (island/ambient/common.ts) computes `r / 32767 * max` in doubles (it is `rand(1)` = r / 32767 exactly there), one rounding later: up to 1 ulp apart.
 */
export function rand32(max: number): number {
  if (max <= 0) return 0;
  return Math.fround(Math.fround(rand(1)) * Math.fround(max));
}

/**
 * FUN_004242f0(record, &dist, r2, cone) with every x87 step rounded to float32 (the shared `pepperSide` of island/npc/globals.ts keeps doubles and reads the framework's double `distSq`):
 * returns the code (0 out of range, 2 in front, 4 behind, 8 beside) and keeps the controller's +0x14 bits (2 / 4 / 8) like the original; the record's heading is wrapped in place.
 */
export function pepperSide32(w: World, rec: GameRecord, ctrl: Controller, r2: number, cone: number): number {
  const f = Math.fround, e = ctrlExtra(ctrl), p = w.focus;
  e.f14 &= ~0xe;
  const dist = distSq32(w, rec);
  if (!(dist < r2) || !p) return 0;
  const k = 0.125;
  let a = f(Math.atan2(f(f(p.m[12] * k) - f(rec.m[12] * k)), f(f(p.m[14] * k) - f(rec.m[14] * k))));
  if (a < NEG_PI) a = f(a + TWO_PI); else if (a > PI) a = f(a - TWO_PI);
  if (rec.ry < NEG_PI) rec.ry = f(rec.ry + TWO_PI); else if (rec.ry > PI) rec.ry = f(rec.ry - TWO_PI);
  let d = f(a - rec.ry);
  if (d < NEG_PI) d = f(d + TWO_PI); else if (d > PI) d = f(d - TWO_PI);
  d = Math.abs(d);
  if (PI < d) d = f(TWO_PI - d);
  let code: number;
  if (cone <= d) code = cone <= f(d - cone) ? 4 : 8;
  else code = 2;
  e.f14 |= code;
  return code;
}
