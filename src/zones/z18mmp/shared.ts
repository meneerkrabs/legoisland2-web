// The state the nodes of z18MMP share (the original's globals) and the services they call (sound, music, speech, random numbers).
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { ZoneParticles } from '../../fx/particles/zone.ts';
import { REC, K } from './consts.ts';
import { normalise3 } from '../exact.ts';

/** a position for the 3D sounds */
export interface P3 { x: number; y: number; z: number }

/**
 * Sound / music / speech services of the zone. 3D sounds are played through *handles* (the original keeps one handle per FUN_004433b0 call): a handle is
 * a name; several handles can use the same sound id. `play3D` = FUN_004433f0(handle, position): plays inside the table's maximum distance, refreshes the
 * position, stops outside; `stop` = FUN_004434b0 / FUN_004435b0; `idle` = FUN_004433c0.
 */
export interface MmpSounds {
  /** FUN_004435a0(handle): 2D sound by sound-table id */
  play2D(id: number): void;
  stop2D(id: number): void;
  play3D(handle: string, id: number, p: P3): void;
  stop3D(handle: string): void;
  idle3D(handle: string): boolean;
  /** FUN_004432c0(handle) of the segments loaded at start: the music key */
  music(key: string): void;
  /** FUN_00439bf8 + FUN_00435a11: speak the lines (message ids of MMP.str) */
  say(a: string, b?: string): void;
}
export interface MmpRng {
  /** a uniform float 0 .. x (FUN_004388ae(x)) */
  float(x: number): number;
  /** a uniform integer 0 .. n-1 */
  int(n: number): number;
}
// RNG: the default source (the original's rand() / the clock); the tests and the bots inject a seeded one (`sh.rng`)
export const mathRng: MmpRng = { float: (x) => Math.random() * x, int: (n) => Math.floor(Math.random() * n) };
export const silentSounds: MmpSounds = { play2D() {}, stop2D() {}, play3D() {}, stop3D() {}, idle3D: () => true, music() {}, say() {} };

/** the globals of the zone: DAT_05d5beb0 (seconds), DAT_05d5bef0 (danger), DAT_05d5bff8 (clock stopped), DAT_05d5beec (beep countdown) ... */
export class MmpShared {
  /** DAT_05d5beb0: seconds played; `frac` = the loop's local tick counter (counts 30 ticks per second) */
  seconds = 0; frac = 0;
  /** DAT_05d5bff8: set when Pepper passes the gate: the clock stands still */
  stopClock = false;
  /** DAT_05d5bef0: the danger meter (0 .. 145, the HUD gauge); 145 = game over */
  danger = 0;
  /** DAT_05d5beec: the second the countdown beep plays at next (10 .. 1) */
  warnNext: number = K.WARN_FROM;
  /** DAT_05d5be6c: the puzzle music starts when the first coffin opens (armed when the intro was left) */
  puzzleMusicArmed = false;
  /** DAT_05d5c014[n * 8]: the animation phase of the mummy of coffin n (0 none, 1 rising, 2 up, 3 sinking, 4 leaving, 5 poof, 6 gone) */
  track: number[] = new Array(12).fill(0);
  /** _DAT_05d5c008: the poof timer of the leaving mummies */
  poof = 0;
  /** DAT_05d5bff4 (the walk animation wrapped), DAT_05d5bffc (footstep phase), DAT_05d5c000 (round robin of the step sounds) */
  stepWrap = false; stepPhase = 0; stepRr = 0;
  /** the zone's particle engine (FUN_00442900 in FUN_006a489a); null in node tests without one */
  fx: ZoneParticles | null = null;
  sounds: MmpSounds = silentSounds;
  rng: MmpRng = mathRng;
  /** the records of the zone (filled by `prepareMmp`) */
  records: GameRecord[] = [];
  /** Pepper's node, for the other nodes that read its state */
  pepper: { state: number } | null = null;

  /** the danger meter a hit adds 24 to, capped at 145 */
  hit() { this.danger = Math.fround(this.danger + K.DANGER_HIT); if (K.DANGER_MAX < this.danger) this.danger = K.DANGER_MAX; }
}

/**
 * FUN_0043cec0: normalise a 3-vector (float32 in memory) in place, store by store as the compiled code does: the squared length is stored as a float32, the factor
 * `1 / sqrt(len2)` too, each component is `factor * component` rounded to float32 (x87 arithmetic at 53 bits in between); a null vector stays as it is. The input is rounded
 * to float32 first (the original's operands are float32 locals).
 */
export function normalise(v: number[]): number[] {
  const f = Math.fround;
  v[0] = f(v[0]); v[1] = f(v[1]); v[2] = f(v[2]);
  normalise3(v);      // (src/zones/exact.ts: the x87 runs in 24-bit precision, every operation rounds)
  return v;
}

/** is the record shown (flags & 2) */
export const shown = (r: GameRecord) => (r.flags & 2) !== 0;
/** a record index checker for the nodes: fails loudly when the table of the zone differs from the builder's */
export function rec(world: World, i: number): GameRecord { return world.records[i]; }
export { REC };
