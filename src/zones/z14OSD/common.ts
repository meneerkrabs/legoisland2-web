// z14OSD, the Oasis (M5): helpers shared by the hub's nodes (scorpions, tumbleweeds, gems, Pepper's mode switch) and the loop's HUD.
// Every constant names the address of the original it comes from; the sound handles are the globals the zone's sound loader FUN_006285e0 filled
// (`HubContext.soundOf(addr)` maps such a global to the sound id the EMULATED loader obtained, docs/re/m5/foundation.md 2.1).
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { tryCtx } from '../../island/ctx.ts';
import type { IslandCtx } from '../../island/ctx.ts';

export const f32 = Math.fround;
/** _DAT_0089207c / _DAT_00892094 / _DAT_00892098 (pi, 2 pi, -pi as floats) */
export const PI = f32(3.1415927410125732), TWO_PI = f32(6.2831854820251465), NEG_PI = f32(-3.1415927410125732);
/** the one-step wrap of the original: `if (a < -pi) a += 2 pi; else if (pi < a) a -= 2 pi` */
export const wrapPi = (a: number) => (a < NEG_PI ? f32(a + TWO_PI) : a > PI ? f32(a - TWO_PI) : a);

/** the handle globals of FUN_006285e0 (the zone's sound loader, run by the wrapper before the set-up) */
export const H = {
  /** 3D sound 0x300 (768) / 0x2ff (767) / 0x304 (772): positional ambience of G001 / G000 / G006 (PEPPSW's update FUN_0062b3b0) */
  AMB_G001: 0x5d5bc8c, AMB_G000: 0x5d5bc98, AMB_G006: 0x5d5bc7c,
  /** 2D sound 0x324 (804) and 0x2f9 (761): the loop plays them every frame of mode 2 (FUN_00627c90) */
  LOOP_A: 0x5d5bc88, LOOP_B: 0x5d5bc9c,
  /** 3D sound 0x2fe / 0x2fd (scorpion bite / alert), 2D sound 0x308 (scorpion grab) */
  SCORPION_BITE: 0x5d5bc90, SCORPION_ALERT: 0x5d5bc94, SCORPION_GRAB: 0x5d5bc80,
} as const;

/** FUN_004b0f16 (run by every SGwalk constructor, i.e. by the player chain of the set-up): the walk code's sounds; 0x2f1 = DAT_009da8f4 (a gem is picked up), 0x150 = DAT_009da978 (on the board), 0x106 = DAT_009da940 (off the board), 0x128 = DAT_009da93c (out of the water) */
export const SND = { GEM: 0x2f1, BOARD_ON: 0x150, BOARD_OFF: 0x106, OUT_OF_WATER: 0x128 } as const;

/** the island context (the hub's `HubContext` at run time, a mock in the node tests); the hub's own members are optional */
export interface OsdCtx extends IslandCtx { soundOf?(addr: number): number }
export const ctxOf = (w: World): OsdCtx | undefined => tryCtx(w) as OsdCtx | undefined;

/** the sound id behind a handle global (-1 = unknown) */
export function soundId(w: World, addr: number): number { return ctxOf(w)?.soundOf?.(addr) ?? -1; }
/** FUN_004433f0(handle, &pos): the 3D sound at a position (the audio host culls by the listener's distance) */
export function playAt(w: World, addr: number, pos: readonly [number, number, number]) {
  const id = soundId(w, addr);
  if (id >= 0) ctxOf(w)?.sfxAt(id, pos);
}
/** FUN_004435a0(handle) */
export function play(w: World, addr: number) { const id = soundId(w, addr); if (id >= 0) ctxOf(w)?.sfx(id); }
/** FUN_004435a0 of a sound id the walk code's loader (FUN_004b0f16) holds in a global */
export function playId(w: World, id: number) { ctxOf(w)?.sfx(id); }
/** FUN_004434b0 / FUN_004435b0 */
export function stop(w: World, addr: number) { const id = soundId(w, addr); if (id >= 0) ctxOf(w)?.stopSfx(id); }

export const posOf = (r: GameRecord): [number, number, number] => [r.m[12], r.m[13], r.m[14]];
