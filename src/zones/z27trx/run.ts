// The run state of one z27TRX game: the globals the original keeps next to the nodes (DAT_05d5d16c timeout, DAT_05d5d190 clock, DAT_05d5d170 score, DAT_05d5d228 the
// bridge record, DAT_05d5d2ac the volcano the rex is at ...) plus the hooks the nodes call (sound, speech, rumble, random numbers). DOM-free: the node tests and the
// browser game build the same objects.
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { NO_GROUND } from '../../game/collision.ts';
import { RUN } from './consts.ts';
import { getTickCount } from '../../game/crt.ts';
import { crtRand, randFrom, pickFrom } from '../common/crtrand.ts';
import type { RandSource } from '../common/crtrand.ts';

/** FUN_004435a0 / FUN_004433f0 / FUN_004435b0 / FUN_00443590: the zone's sound slots by sound-table id */
export interface TrxSound {
  /** 2D play / refresh (FUN_004435a0) */
  play(id: number): void;
  /** 3D play / refresh at a position (FUN_004433f0), plays only inside the table's maximum distance */
  at(id: number, pos: ArrayLike<number>): void;
  /** stop (FUN_004435b0 / FUN_004434b0) */
  stop(id: number): void;
  /** is the slot sounding (FUN_00443590) */
  playing(id: number): boolean;
}

/**
 * random numbers of the original: FUN_004388ae(max) = rand() / 32767 * max on the CRT's rand (0 .. 32767), and the integer draws of the zone are `ftol(FUN_004388ae(ms)) % n` (or `& 1`) with
 * `ms` = FUN_00435c91() = GetTickCount() - the program's start tick, passed as a float32. Tests inject a seeded source and a fixed clock.
 */
export interface TrxRandom {
  /** a float in [0, max] (FUN_004388ae) */
  float(max: number): number;
  /** an integer 0 .. n-1 (`ftol(FUN_004388ae(FUN_00435c91())) % n` / `& 1`) */
  int(n: number): number;
}
const fr = Math.fround;
/**
 * `source` = the C runtime's rand() (0 .. 32767: the shared generator src/game/crt.ts by default, tests inject a scripted one); `clock` = FUN_00435c91, the milliseconds since the zone's start
 * (the real GetTickCount() - base; it only scales the random pick). The float32 evaluation order of FUN_004388ae is src/zones/common/crtrand.ts.
 */
export function makeRandom(source: RandSource = crtRand, clock: () => number = zoneClock()): TrxRandom {
  return {
    float: (max) => randFrom(source, max),
    int: (n) => (n <= 1 ? 0 : pickFrom(source, clock(), n)),
  };
}
/** FUN_00435c91 with the clock base of the zone's start (FUN_00435c81) */
function zoneClock(): () => number { const base = getTickCount(); return () => (getTickCount() - base) >>> 0; }

/** the rex's `trexfeet` emitter (DAT_05d5d2b8, started by FUN_0076b070): the calls the rex node makes on it (FUN_00442a20 gate 2 / 1 / 1 = on and 1 / 1 / 1 = off, FUN_00442a00 = its parent matrix, FUN_0044ebd0 slot 0 = the force) */
export interface TrxFx {
  feetOn(): void;
  feetOff(): void;
  /** the parent matrix = the rex record's live matrix */
  feetMatrix(): void;
  /** override slot 0 (fForce) */
  feetForce(v: number): void;
}

/** a sound sink that records the calls (tests) or drops them */
export class NullSound implements TrxSound {
  log: { op: 'play' | 'at' | 'stop'; id: number }[] = [];
  counts = new Map<string, number>();
  private on = new Set<number>();
  private note(op: 'play' | 'at' | 'stop', id: number) {
    if (this.log.length < 4000) this.log.push({ op, id });
    const k = `${op}:${id}`;
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
  }
  play(id: number) { this.note('play', id); this.on.add(id); }
  at(id: number) { this.note('at', id); this.on.add(id); }
  stop(id: number) { this.note('stop', id); this.on.delete(id); }
  playing(id: number) { return this.on.has(id); }
  count(op: 'play' | 'at' | 'stop', id: number) { return this.counts.get(`${op}:${id}`) ?? 0; }
}

export class TrxRun {
  /** DAT_05d5d16c: the clock ran out */
  timeout = false;
  /** DAT_05d5d190: the clock the HUD shows (ticks left) */
  clock = 5400;
  /** DAT_05d5d170: the score of the finished run (0 for a loss) */
  score = 0;
  /** DAT_05d5d228: the bridge record (BRDG) the rex's height is tested against */
  bridge: GameRecord | null = null;
  /** DAT_05d5d2ac: the volcano whose rumble is on */
  volcano: GameRecord | null = null;
  /** DAT_009da5dc: the camera mode flag the arrival camera sets (0x2260000) */
  arrivalCamera = false;
  /** the end phase asked for the arrival fog (FUN_00442d90(34, 250, ...)): the zone game applies it */
  arrivalFog = false;
  /** the records the nodes address (set by `prepareTrx`) */
  pepp!: GameRecord;
  drkr!: GameRecord;
  sound: TrxSound = new NullSound();
  rng: TrxRandom = makeRandom();
  fx: TrxFx = { feetOn() { /* */ }, feetOff() { /* */ }, feetMatrix() { /* */ }, feetForce() { /* */ } };
  /** FUN_00439bf8 + FUN_00435a11: speak a line of the zone table (false while speech is busy) */
  say: (id: string) => boolean = () => false;
  /** diagnostics: every spoken line */
  spoken: string[] = [];
  /** the rumble hook of FUN_00438518 (strength, ticks left); 0, 0 = off */
  rumble: (strength: number, ticks: number) => void = () => { /* no force feedback */ };
  /** the rumble tables (floats at 0x93db68, ints at 0x93db80), read from the executable */
  rumbleTime: number[] = [30, 20, 25, 15, 40, 15];
  rumbleStrength: number[] = [60, 40, 60, 110, 60, 30];
  /** the 2D HUD state of the frame (FUN_0076a39b writes the strings into DAT_05d4dd20 / DAT_05d4dd3c) */
  hitsText = '0';
  hudDim = false;

  speak(id: string) { this.spoken.push(id); return this.say(id); }
}

/** FUN_0043ce45(pos, 4.0): the terrain height below (x, y, z): the ray from y + 4 down 300 against the ground record (radius 1.0, skin 0.1, minus 0.1); NO_GROUND (-1e38) when it hits nothing */
export function groundAt(w: World, x: number, y: number, z: number): number {
  const g = w.col.groundRec;
  if (!g) return fr(NO_GROUND);
  // FUN_0043ce45: the ray starts at y + 4 (a float32 sum), the engine returns the float32 hit point; FUN_004425f0 subtracts 0.1 (float32) and rounds
  const h = w.col.rayRecord(g, [fr(x), fr(fr(y) + RUN.GROUND_UP), fr(z)], [0, -RUN.GROUND_DOWN, 0], 3, 1.0, fr(0.1));
  return h ? fr(fr(h.point[1]) - fr(0.1)) : fr(NO_GROUND);
}

/** the 4-character name of a record as the zone loop's dword compares see it (FUN_0085e470 upper-cases every character) */
export const nameOf = (r: GameRecord) => r.name.toUpperCase();
