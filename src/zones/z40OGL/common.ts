// z40OGL, Ogel's island (M5): helpers shared by the hub's own nodes and its loop code. Every constant names the address of the original it comes from.
// The sound handles are the globals the zone's sound loader FUN_007e3350 filled (`HubContext.soundOf(addr)` maps such a global to the sound id the EMULATED loader got).
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { tryCtx } from '../../island/ctx.ts';
import type { IslandCtx } from '../../island/ctx.ts';

export const f32 = Math.fround;

/** the hub's context (a `HubContext` at run time, a mock in the node tests): the hub's own members are optional */
export interface OglCtx extends IslandCtx {
  soundOf?(addr: number): number;
  /** the runner's services (null before `bind` / in the node tests): the audio host gives the exact 3D slot of a handle */
  readonly zoneCtx?: { sh: { audio: OglAudio } } | null;
}
/** what the nodes need of the audio host (src/shell/audiohost.ts): the n-th 3D slot a zone list loaded for a sound id and the sink's per-slot play / stop */
export interface OglAudio {
  slot?(kind: '2d' | '3d', id: number, n?: number): unknown | null;
  ga?: { sfx: { play3D(slot: never, pos: { x: number; y: number; z: number }): void; stop(slot: never): void } } | null;
}
export const ctxOf = (w: World): OglCtx | undefined => tryCtx(w) as OglCtx | undefined;

/** the sound handles of FUN_007e3350 of the ten krystals (DAT_05d5f338 ...: all 3D sound 0x267 = 615, the loop of a krystal), in the ORDER of the loads (= the slot number of sound 615's 3D slots): KST0 .. KST9 */
export const KST_HANDLES = [0x5d5f338, 0x5d5f340, 0x5d5f33c, 0x5d5f354, 0x5d5f350, 0x5d5f35c, 0x5d5f358, 0x5d5f348, 0x5d5f344, 0x5d5f34c] as const;
/** the generic collect jingle DAT_009da8f4 = FUN_00443580(0x2f1) (Collect.wav), loaded by the walk code's FUN_004b0f16 (zone list 'WALK') */
export const SND_COLLECT = 0x2f1;

export const posOf = (r: GameRecord): [number, number, number] => [r.m[12], r.m[13], r.m[14]];

/** FUN_004433f0(handle, &pos) of one krystal handle: the 3D loop at the record's position (the audio host culls by the listener's distance) */
export function playKrystal(w: World, n: number, pos: readonly [number, number, number]) {
  const c = ctxOf(w);
  if (!c) return;
  const id = c.soundOf?.(KST_HANDLES[n]) ?? -1;
  if (id < 0) return;
  const au = c.zoneCtx?.sh.audio, slot = au?.slot?.('3d', id, n);
  if (au?.ga && slot) { try { au.ga.sfx.play3D(slot as never, { x: pos[0], y: pos[1], z: pos[2] }); } catch { /* silent */ } return; }
  c.sfxAt(id, pos);
}
/** FUN_004434b0(handle): stop that handle's 3D slot */
export function stopKrystal(w: World, n: number) {
  const c = ctxOf(w);
  if (!c) return;
  const id = c.soundOf?.(KST_HANDLES[n]) ?? -1;
  if (id < 0) return;
  const au = c.zoneCtx?.sh.audio, slot = au?.slot?.('3d', id, n);
  if (au?.ga && slot) { try { au.ga.sfx.stop(slot as never); } catch { /* silent */ } return; }
  c.stopSfx(id);
}
/** FUN_004435a0 of a sound id */
export function playId(w: World, id: number) { ctxOf(w)?.sfx(id); }
