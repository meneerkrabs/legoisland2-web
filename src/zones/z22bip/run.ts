// The state z22BIP's behaviour nodes share (the original's globals DAT_05d5cxxx / 05d5dxxx of the zone) and what they need from the host (sounds, speech, the
// random numbers). Pure TypeScript, no DOM: the zone game (src/zones/z22BIP.ts) fills `sound` / `say`, the node tests use the defaults.
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { BipSpline } from './spline.ts';
import type { PlaneNode } from './plane.ts';
import type { TakeoffNode } from './takeoff.ts';
import type { JohnnyNode } from './johnny.ts';
import { srand, randF } from '../../game/crt.ts';

/** record names the zone code finds by index (byte offset / 0x68 of FUN_0070814f / FUN_00707800 / FUN_00708457) */
export const REC = { PLANE: 74, JOHNNY: 75, PROP: 76, BANANA: 117, MELON: 118 } as const;
/** record names the code tests with strncmp (FUN_00709258 / FUN_00709fac) */
export const NAME = { MONKEY: 'MNK', BANANA_TARGET: 'BANT', ROPE_TARGET: 'DTR', ROPE_HIT: 'DTH', FUEL: 'FUEL', PALM: 'PALM', BANANA_PICKUP: 'BANP', LAND: 'LAND' } as const;

/** game variable 0xfa: the plane's mode, a bit per behaviour (the gates of the five nodes of PEPP) */
export const VAR_MODE = 0xfa;
export const MODE = { FLY: 2, RECOVER: 4, TAKEOFF: 8, LAND: 0x10 } as const;

/** sound slots (FUN_00708640): sound-table id and kind */
export const SOUNDS = {
  // 3D (FUN_004433b0)
  chimpThrow: { id: 0x7d, kind: '3d' }, hitChimp1: { id: 0x7a, kind: '3d' }, hitChimp2: { id: 0x7b, kind: '3d' }, hitChimp3: { id: 0x7c, kind: '3d' },
  chatter3: { id: 0x77, kind: '3d' }, chatter2: { id: 0x78, kind: '3d' }, chatter1: { id: 0x79, kind: '3d' }, melonFly: { id: 0x7e, kind: '3d' },
  onTarget: { id: 0x8e, kind: '3d' }, riverAmb: { id: 0x8f, kind: '3d' }, planeIdle: { id: 0x91, kind: '3d' },
  rockHit: { id: 0x2e5, kind: '3d' }, rmSmack: { id: 0x2e4, kind: '3d' }, rmChuck: { id: 0x2e3, kind: '3d' },
  // 2D (FUN_00443580)
  planeFlight: { id: 0x6b, kind: '2d' }, takeOff: { id: 0x6c, kind: '2d' }, fuelAlarm: { id: 0x6d, kind: '2d' }, windOutOfFuel: { id: 0x6e, kind: '2d' },
  bananaCannon: { id: 0x6f, kind: '2d' }, pickUpFuel: { id: 0x70, kind: '2d' }, hitValley: { id: 0x71, kind: '2d' }, hitValley2: { id: 0x72, kind: '2d' },
  splash: { id: 0x73, kind: '2d' }, melonHit: { id: 0x74, kind: '2d' }, planeFlyoff: { id: 0x75, kind: '2d' }, skidHalt: { id: 0x76, kind: '2d' },
  pickUpBananas: { id: 0x92, kind: '2d' }, jungleAmb: { id: 0x90, kind: '2d' },
} as const;
export type SoundName = keyof typeof SOUNDS;

export interface BipSound {
  /** FUN_004435a0: play / refresh a 2D slot */
  play(n: SoundName): void;
  /** FUN_004433f0: play / refresh a 3D slot at a position (culled beyond the table's maximum distance) */
  at(n: SoundName, pos: ArrayLike<number>): void;
  /** FUN_004435b0 / FUN_004434b0 */
  stop(n: SoundName): void;
  /** FUN_00443600 */
  rate(n: SoundName, hz: number): void;
}
const nullSound: BipSound = { play() { /* silent */ }, at() { /* silent */ }, stop() { /* silent */ }, rate() { /* silent */ } };

export class BipRun {
  world: World | null = null;
  spline!: BipSpline;
  sound: BipSound = nullSound;
  /** FUN_00439bf8 + FUN_00435a11: speak the zone-table line; false when speech is busy */
  say: (id: string) => boolean = (id) => { this.said.push(id); return true; };
  /** the speech lines asked for, in order (tests; the zone game's `say` appends here too) */
  said: string[] = [];
  /** DAT_05d5d040 / DAT_05d5d058 / the csplane node: set by the constructors */
  plane: PlaneNode | null = null;
  takeoff: TakeoffNode | null = null;
  johnny: JohnnyNode | null = null;
  /** DAT_05d5d044: 0 playing, 1 failed (out of fuel and stopped), 3 bronze, 4 silver, 5 gold (and more) */
  result = 0;
  /** DAT_05d5ce14[40] / DAT_05d5d02c: the table of random numbers (-1.248 .. 1.257) and its read index */
  randTable = new Float32Array(40);
  randIdx = 0;
  /** DAT_05d5d04c: the banana clock (ticks), DAT_05d5d050: "out of bananas" spoken, DAT_05d5ceb4: "fuel is low" spoken */
  bananaClock = 0; noAmmoSaid = false; lowFuelSaid = false;
  /** restored content (src/restore/features/cues.ts, popups.ts): an event of the zone (`bip-melon-throw`, `bip-stone-hit`, `bip-lowfuel`, `bip-outoffuel`); null = the original (the zone game sets it only with the option on) */
  cue: ((name: string, pos?: ArrayLike<number>) => void) | null = null;
  /** DAT_05d5ceb8: the plane is within the river's reach (progress 0.1 .. 0.77): the river's sound is positional */
  riverNear = false;
  /** DAT_05d5d028 (fuel percent), DAT_05d5d048 (bananas), DAT_05d5d03c (score): the HUD's copy of the plane's numbers (FUN_007091f6) */
  hudFuel = 100; hudAmmo = 0; hudScore = 0;
  /** DAT_05d5d0b0 .. 05d5d0d0: where the crash happened and the path point it is put back to (FUN_00709fac -> FUN_0070fdc0) */
  crash = { x: 0, y: 0, z: 0, ax: 0, ay: 0, az: 0, headingNow: 0, headingPath: 0 };
  /** records by index, set up by the zone game */
  recs: { plane: GameRecord; johnny: GameRecord; prop: GameRecord } | null = null;
  /** how many times the leaf particle was asked for (FUN_00442a20) */
  leafBursts = 0;
  /** the zone's hook for that call: FUN_00442a20(DAT_05d5cd6c, 2, 1, 1) + FUN_00442a40(DAT_05d5cd6c) (set by the zone game when a particle engine exists) */
  onLeaf: (() => void) | null = null;
  /** diagnostics */
  stats = { bananasFired: 0, monkeyHits: 0, targetHits: 0, bantHits: 0, fuelCans: 0, bananaPickups: 0, crashes: 0, melonHits: 0, stoneHits: 0 };
  /** the 40 random numbers: srand(1) of the shared C runtime generator (src/game/crt.ts), then FUN_004388ae(0x40204189) - 1.248 (FUN_0070b7b2); the one zone with a fixed seed */
  initRandom() {
    srand(1);
    for (let i = 0; i < 40; i++) this.randTable[i] = Math.fround(randF(f32(0x40204189)) - f32(0x3f9fbe77));
    this.randIdx = 0;
  }
  /** the next value of the table (the index wraps after 0x27) */
  nextRandom(): number { const v = this.randTable[this.randIdx]; this.randIdx = this.randIdx === 0x27 ? 0 : this.randIdx + 1; return v; }
}

/** a float32 from its bit pattern (the immediates of the code) */
export function f32(bits: number): number {
  const b = new DataView(new ArrayBuffer(4));
  b.setUint32(0, bits >>> 0);
  return b.getFloat32(0);
}

/** FUN_00435c91: the REAL milliseconds since the zone's start (the shared clock of src/zones/common/tickrand.ts, started by FUN_00435c81 in z22BIP.ts); the argument of the old tick-derived stand-in is unused */
export { msClock } from '../common/tickrand.ts';

const runs = new WeakMap<World, BipRun>();
/** the run state of a world (created on first use) */
export function bipRun(w: World): BipRun {
  let r = runs.get(w);
  if (!r) { r = new BipRun(); r.world = w; runs.set(w, r); }
  return r;
}
export function dropBipRun(w: World) { runs.delete(w); }
