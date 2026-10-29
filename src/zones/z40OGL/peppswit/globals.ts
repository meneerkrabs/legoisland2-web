// What the seven PeppSwit.c constructors of Ogel's island (z40OGL, "Common\Z40OGL\c_src\PeppSwit.c": ctors 0x7e4f9c 0x7e539e 0x7e5ea7 0x7e61e9 0x7e6498 0x7e69a2 0x7e6bb2) share:
// the zone globals of the source file (bss 0x5d5f3xx) and the sound handles the set-up stored in them (docs/re/m5/z40OGL-peppswit.md).
import type { World } from '../../../game/world.ts';
import type { IslandCtx } from '../../../island/ctx.ts';
import { tryCtx } from '../../../island/ctx.ts';
import { rand } from '../../../island/rng.ts';

/** the constructors of PeppSwit.c (FUN_00423532's second argument) */
export const CTOR_OGL = {
  /** Pepper's mode switch (PEPP, the head of the chain): update FUN_007e489b, pre-render FUN_007e4b12 */
  PEPPSWIT: 0x7e4f9c,
  /** Pepper falling into the void (PEPP, gate PEPPER_CONTROL & 0x20): update FUN_007e5138 */
  VOID: 0x7e539e,
  /** the 8 slugs SLG0..SLG7: update FUN_007e5448 */
  SLUG: 0x7e5ea7,
  /** the 5 robots RBT0..RBT4: update FUN_007e5fb4 */
  ROBOT: 0x7e61e9,
  /** the sky dome STAR (record 0): draw FUN_007e62da */
  STAR: 0x7e6498,
  /** the 5 citizens CIT1..CIT5 on their route (after their SGMFIG walker): update FUN_007e6542 */
  CITIZEN: 0x7e69a2,
  /** the hologram HOLO's variable watcher: update FUN_007e6b05 */
  HOLO: 0x7e6bb2,
} as const;

/** the sound handle globals of the zone (bss 0x5d5f3xx) the code of PeppSwit.c plays (VA of the global -> the sound id the set-up stored in it is read from the emulated set-up) */
export const SND = {
  /** DAT_05d5f3b0: the 2D ambience, played by PEPPSWIT's update every tick (FUN_004435a0) */
  AMBIENCE: 0x5d5f3b0,
  /** 2D one-liners, each with a chance of 1 / 300 per tick (r == 297 / 298 / 299 of rand * 300) */
  RAND_297: 0x5d5f334, RAND_298: 0x5d5f32c, RAND_299: 0x5d5f330,
  /** 3D emitters PEPPSWIT updates every tick: the fixed point (20, 49, 101), the records 40 / 42 / 41 */
  POINT: 0x5d5f308, REC40: 0x5d5f324, REC42: 0x5d5f3b8, REC41: 0x5d5f364,
  /** 3D emitters on MNK0..2 played at random (rand * 120: 57 / 58 / 59 ..): records 14 / 13 / 12 */
  MNK57: 0x5d5f368, MNK58: 0x5d5f36c, MNK_REST: 0x5d5f370,
  /** the citizens' own voices in story state 66 (the base): the handles of records 6 .. 10 */
  CIT: [0x5d5f30c, 0x5d5f310, 0x5d5f314, 0x5d5f318, 0x5d5f31c],
  /** the void fall (2D): played while Pepper falls, stopped when he lands */
  FALL: 0x5d5f3b4,
  /** the slugs' own 3D handles by the digit of the record name (SLG0 .. SLG7) */
  SLUG: [0x5d5f390, 0x5d5f398, 0x5d5f394, 0x5d5f3a0, 0x5d5f39c, 0x5d5f3a8, 0x5d5f3a4, 0x5d5f3ac],
  /** the slug catches Pepper: 2D 0x5d5f374 and 0x5d5f328 */
  SLUG_HIT_A: 0x5d5f374, SLUG_HIT_B: 0x5d5f328,
} as const;

/** the zone globals of PeppSwit.c */
export class OglGlobals {
  /** DAT_05d5f3bc: which part of the island the set-up built: 1 = story node 64 (< 0x41), 2 = node 66 (the base) */
  part = 1;
  /** _DAT_05d5f3c0: Pepper's fall speed (PEPPSWIT's pre-render writes it, the void node reads it; saved with the game) */
  fall = 0;
  /** _DAT_05d5f3c4 / DAT_05d5f3c8: the lamp blink timer and phase (FUN_007e42b0) */
  lampTimer = 0; lampPhase = 0;
  /** DAT_009da9a8: the slug that caught Pepper (written by the slug update; nothing in this file reads it) */
  hitBy: number = -1;
  /** handle global -> sound id (from the emulated set-up: IslandSetup.soundHandles) */
  readonly handles = new Map<number, number>();
  /** handle token (the value a global holds, 0x5a000000 + n in the emulation) -> sound id */
  readonly tokens = new Map<number, number>();
}

const KEY = 'ogl.peppswit';
export function oglGlobals(w: World): OglGlobals {
  let g = w.ext.get(KEY) as OglGlobals | undefined;
  if (g) return g;
  g = new OglGlobals();
  w.ext.set(KEY, g);
  const c = tryCtx(w);
  const setup = c?.setup;
  g.part = w.vars.get(0x58) < 0x41 ? 1 : 2;     // FUN_007e3bd1: FUN_007e7c56 (DAT_05d5f3bc = 1) below node 0x41, else FUN_007e8308 (= 2)
  if (setup) {
    const m = setup.mem;
    const part = m.r32(0x5d5f3bc);
    if (part === 1 || part === 2) g.part = part;
    for (const h of setup.soundHandles) {
      if (h.kind === 'music') continue;
      g.handles.set(h.addr, h.id);
      g.tokens.set(m.r32(h.addr) >>> 0, h.id);
    }
  }
  return g;
}

/** the sound id behind a handle global (-1 when the set-up stored none) */
export function soundOf(w: World, addr: number): number { return oglGlobals(w).handles.get(addr) ?? -1; }
/** the sound id behind a handle VALUE (a token of the emulated set-up held in an argument block), -1 when unknown */
export function soundOfToken(w: World, token: number): number { return oglGlobals(w).tokens.get(token >>> 0) ?? -1; }

/** FUN_004435a0(handle): play / refresh a 2D sound */
export function play2d(w: World, addr: number) { const id = soundOf(w, addr); if (id >= 0) tryCtx(w)?.sfx(id); }
/** FUN_004435b0 / FUN_004434b0: stop */
export function stopSound(w: World, addr: number) { const id = soundOf(w, addr); if (id >= 0) tryCtx(w)?.stopSfx(id); }
/** FUN_004433f0(handle, pos): play / update a 3D sound at a position */
export function play3d(w: World, addr: number, pos: readonly [number, number, number]) { const id = soundOf(w, addr); if (id >= 0) tryCtx(w)?.sfxAt(id, pos); }
export function play3dId(w: World, id: number, pos: readonly [number, number, number]) { if (id >= 0) tryCtx(w)?.sfxAt(id, pos); }
export function stopId(w: World, id: number) { if (id >= 0) tryCtx(w)?.stopSfx(id); }

/** FUN_004388ae(max) as an integer (`__ftol` of the x87 value): the C runtime rand() / 32767 * max */
export function randInt(max: number): number { return Math.trunc(rand(max)); }

export const fr = Math.fround;
export type Ctx = IslandCtx;
