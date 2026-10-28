// The run state of one z38PAR game: the globals the original keeps in DAT_05d57cf0 .. DAT_05d57d34 (score, ring flags, wind, heights ...) plus the sound slots and the
// records the zone code addresses by index (FUN_00466c36 / FUN_0046a926: PEPP 8, rings 37 / 39 / 38, targets 5 / 7 / 6 ... looked up by name here).
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Vec3 } from './util.ts';
import { SoundBank } from './sound.ts';
import type { SoundBackend, SoundDef } from './sound.ts';

/** the sound slots of FUN_00467370 (id = sound table index; 2D = FUN_00443580, 3D = FUN_004433b0). Comments: the DAT_ slot and the file. */
export const PAR_SOUNDS = {
  ambience: { id: 0x1a, kind: '3d' },     // D4C s_ameri_jungle (looped, played at the land record every tick)
  sea: { id: 0x1b, kind: '3d' },          // D9C sea16_8 (at (x, 0, z) while the ground probe under the pilot hits something)
  planeIdle: { id: 0x1d, kind: '3d' },    // Da4 plane_flight_idle
  balloonThrust: { id: 0x2d, kind: '3d' },// D44 thrust
  birdFly1: { id: 0x24, kind: '3d' },     // D50 ptero_fly
  birdFly2: { id: 0x24, kind: '3d' },     // D58
  birdFly3: { id: 0x24, kind: '3d' },     // D54
  birdCall1: { id: 0x25, kind: '3d' },    // D90 ptero_call1
  birdCall2: { id: 0x27, kind: '3d' },    // D94 ptero_call2
  birdCall3: { id: 0x28, kind: '3d' },    // D60 ptero_call3
  hitRing: { id: 0x29, kind: '2d' },      // D38 hit_ring
  thruRing: { id: 0x2e, kind: '2d' },     // D80 thru_ring
  hitPlane: { id: 0x2b, kind: '2d' },     // D48 hit_plane1
  hitBird: { id: 0x2a, kind: '2d' },      // D40 hit_pterodactyl
  hitBalloon: { id: 0x2c, kind: '2d' },   // Da0 hit_balloon
  chuteOpen: { id: 0x1c, kind: '2d' },    // D7C chute_open4
  landOff: { id: 0x22, kind: '2d' },      // D70 land_off_target
  landOk: { id: 0x21, kind: '2d' },       // D6C land_succes_targ
  splash: { id: 0x23, kind: '2d' },       // D74 splash1
  windFall: { id: 0x18, kind: '2d' },     // D84 wind_freefall (looped)
  windChute: { id: 0x19, kind: '2d' },    // D68 wind_chuteopen (looped)
  flap: { id: 0x2f, kind: '2d' },         // D5C chute_flap_in_wind (looped)
  bigSplash: { id: 0x1f, kind: '2d' },    // D64 bigsplash
  smack: { id: 0x1e, kind: '2d' },        // D88 smack_nochute
  hitTarget: { id: 0x20, kind: '2d' },    // D98 Hit_targnochute
  flyOff: { id: 0x17, kind: '2d' },       // D3C plane_flyoff (played by the loop's skip-the-intro path only)
  accel: { id: 1, kind: '2d' },           // D78 wind_accel_deccel (pitch follows the fall speed)
} as const satisfies Record<string, SoundDef>;
export type ParSound = keyof typeof PAR_SOUNDS;

/** FUN_00466c36 addresses records by index; the names are what the scene gives */
export interface ParRecords {
  pepp: GameRecord; land: GameRecord;
  /** rings 1 (smallest, lowest), 2, 3 (largest, first one passed) = RNG1 / RNG2 / RNG3 */
  rings: [GameRecord, GameRecord, GameRecord];
  /** TAR1 (smallest, 5000 points) ... TAR3 (largest, 1000) */
  targets: [GameRecord, GameRecord, GameRecord];
  para: GameRecord | null; shad: GameRecord | null; boat: GameRecord | null; ball: GameRecord | null; plane: GameRecord | null;
  /** the four PTER records (the fourth is hidden by the pilot's constructor) */
  birds: GameRecord[];
}

export function findParRecords(w: World): ParRecords {
  const by = (n: string) => w.records.find((r) => r.name === n) ?? null;
  const need = (n: string) => { const r = by(n); if (!r) throw new Error(`z38PAR: no record ${n}`); return r; };
  return {
    pepp: need('PEPP'), land: need('LAND'),
    rings: [need('RNG1'), need('RNG2'), need('RNG3')], targets: [need('TAR1'), need('TAR2'), need('TAR3')],
    para: by('PARA'), shad: by('SHAD'), boat: by('BOAT'), ball: by('BALL'), plane: by('PLNE'), birds: w.records.filter((r) => r.name === 'PTER'),
  };
}

/** ring flag values of DAT_05d57d14 / 18 / 1c: 0 not reached, 1 passed, 2 missed (the pilot fell below the ring) */
export const RING_OPEN = 0, RING_HIT = 1, RING_MISSED = 2;

export class ParRun {
  readonly world: World;
  readonly recs: ParRecords;
  sound: SoundBank<ParSound>;
  /** FUN_00439bf8 + FUN_00435a11: speak a message of the zone table (ctx.say); the default drops it */
  say: (id: string) => boolean = () => false;
  /** diagnostics for tests: every spoken id, in order */
  spoken: string[] = [];

  /** DAT_05d57d28: the score (float) */
  score = 0;
  /** DAT_05d57d04: the wind direction (radians) */
  windDir = 0;
  /** DAT_05d57d08: the pilot's height at the end of the previous tick */
  y = 0;
  /** DAT_05d57d0c: the start height (the pilot's node +0x14) */
  startAlt = 1360;
  /** DAT_05d57d00: the height when the altitude gauge was last in its first phase */
  refAlt = 0;
  /** DAT_05d57d14 / d18 / d1c: ring 1 / 2 / 3 */
  ring: [number, number, number] = [0, 0, 0];
  /** DAT_05d57d10: the parachute may be opened (below a quarter of the start height) */
  chuteOk = false;
  /** DAT_05d57d30: canopy animation: 0 closed, 1 opening / open, 2 closing */
  canopy = 0;
  /** DAT_05d57d24: height above the ground under the pilot (y - (ground + 3.2)) */
  height = 0;
  /** DAT_05d57db8: the ground height + 3.2 of the last successful probe (stale over the sea, like the original) */
  groundY = 0;
  /** DAT_05d57d4 4 (DAT_05d57de4): the blob shadow is shown */
  shadowOn = false;
  /** DAT_05d57d2c: the game is over (state 5) */
  over = false;
  /** DAT_05d57d34 / d20: landing score (distance part) and landing bonus (800 minus the flare) */
  landScore = 0; landBonus = 0;
  /** ticks since the start */
  tick = 0;
  /** the last ground hit of the probe under the pilot (the blob shadow is drawn there) */
  groundHit: Vec3 = [0, 0, 0];

  constructor(world: World, backend: SoundBackend | null = null) {
    this.world = world;
    this.recs = findParRecords(world);
    this.sound = new SoundBank<ParSound>(PAR_SOUNDS, backend);
  }

  speak(id: string) { this.spoken.push(id); this.say(id); }
}

const runs = new WeakMap<World, ParRun>();
/** the run of a world (created on first use; the browser game replaces its sound backend / speech hook) */
export function parRun(w: World): ParRun {
  let r = runs.get(w);
  if (!r) { r = new ParRun(w); runs.set(w, r); }
  return r;
}
/** forget the run (a restart of the zone builds a new world anyway) */
export function dropParRun(w: World) { runs.delete(w); }
