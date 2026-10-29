// The run state of one z40aPO game: the globals of DAT_05d5edc0 .. DAT_05d5f2a0 (score, ring flags, heights ...), the sound slots (FUN_007d0cb0) and the records
// the zone code addresses by index (FUN_007d0839 / FUN_007d53af: PEPP 6, targets 3 / 4 / 5, the 15 ring pairs ... looked up by name here).
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { SoundBank } from './sound.ts';
import type { SoundBackend, SoundDef } from './sound.ts';
import type { Vec3 } from './util.ts';
import type { ApoFx } from './apo-fx.ts';

/** the sound slots of FUN_007d0cb0 (id = sound table index; 2D = FUN_00443580, 3D = FUN_004433b0) */
export const APO_SOUNDS = {
  rocket0: { id: 0xe4, kind: '3d' }, rocket1: { id: 0xe4, kind: '3d' }, rocket2: { id: 0xe4, kind: '3d' }, rocket3: { id: 0xe4, kind: '3d' },   // DAT_05d5ede0.. Bot_Rocket3, one slot per brickbot
  rocket4: { id: 0xe4, kind: '3d' }, rocket5: { id: 0xe4, kind: '3d' }, rocket6: { id: 0xe4, kind: '3d' }, rocket7: { id: 0xe4, kind: '3d' },
  palace: { id: 0xf1, kind: '3d' },        // D34 palace_amb (at record PALB every tick)
  beacon1: { id: 0xee, kind: '3d' },       // D38 beacon (at target 3, and again at target 1)
  beacon2: { id: 0xee, kind: '3d' },       // D3c (at target 2)
  rockMonster1: { id: 0xe3, kind: '3d' },  // D20 rockmonster (ROC1)
  rockMonster2: { id: 0xe3, kind: '3d' },  // D1c (ROC2)
  rockMonster3: { id: 0xe3, kind: '3d' },  // D18 (ROC3)
  engine: { id: 0xeb, kind: '2d' },        // D4c main_engine (started in the fade-in of the loop, stopped when the shuttle opens its doors)
  hitTarget: { id: 0xe8, kind: '2d' },     // D30 Hit_targnochute
  breath: { id: 0xde, kind: '2d' },        // D00 breath (every tick)
  hitRing: { id: 0xdf, kind: '2d' },       // D54 hit_ring (a ring's torus)
  hitAsteroid: { id: 0xe0, kind: '2d' },   // D08 hit_asteroid
  hitMonster: { id: 0xe1, kind: '2d' },    // D40 hit_monster
  hitBot: { id: 0xe2, kind: '2d' },        // D28 hit_rocketbot
  solarOpen: { id: 0xe5, kind: '2d' },     // D14 solar_open (the wing opens)
  accel: { id: 0xdd, kind: '2d' },         // D04 2d_accel (pitch follows the fall speed)
  smack: { id: 0xe7, kind: '2d' },         // D50 smack_nochute
  landOk: { id: 0xe9, kind: '2d' },        // D58 landontarget
  landOff: { id: 0xea, kind: '2d' },       // D2c land_offtarget
  launch: { id: 0xed, kind: '2d' },        // D48 launch (the doors are open: Pepper is thrown out)
  thruRing: { id: 0xef, kind: '2d' },      // D10 thru_spacering
  thruster: { id: 0xe6, kind: '2d' },      // D24 Bot_Rocket3 (2D loop while the wing is open)
  boxOpen: { id: 0xec, kind: '2d' },       // D5eddc doos_OPEN (when the game starts)
} as const satisfies Record<string, SoundDef>;
export type ApoSound = keyof typeof APO_SOUNDS;

export interface ApoRecords {
  pepp: GameRecord; shtl: GameRecord | null; ogel: GameRecord; shad: GameRecord | null; para: GameRecord | null; palace: GameRecord | null;
  /** TAR1 (smallest, 2000 points at the middle) .. TAR3 (largest, 1000) */
  targets: [GameRecord, GameRecord, GameRecord];
  /** 15 ring pairs in the order of the ring table: group 1 (RN11 .. RN15, 250 points, shows target 3), group 2 (RN21 .. RN25, 500, target 2), group 3 (RN31 .. RN35, 750, target 1) */
  rn: GameRecord[]; rc: GameRecord[];
  /** BBT0 .. BBT7 */
  bots: GameRecord[];
  /** ROC1 .. ROC3 */
  rocks: GameRecord[];
  /** RKA1 .. RKA8, RKB1 .. RKB6 */
  rka: GameRecord[]; rkb: GameRecord[];
}

export function findApoRecords(w: World): ApoRecords {
  const by = (n: string) => w.records.find((r) => r.name === n) ?? null;
  const need = (n: string) => { const r = by(n); if (!r) throw new Error(`z40aPO: no record ${n}`); return r; };
  const list = (prefix: string, n: number, from = 0) => Array.from({ length: n }, (_, i) => need(`${prefix}${i + from}`));
  const ringNames = (kind: 'RN' | 'RC') => [1, 2, 3].flatMap((g) => [1, 2, 3, 4, 5].map((k) => need(`${kind}${g}${k}`)));
  return {
    pepp: need('PEPP'), shtl: by('SHTL'), ogel: need('OGEL'), shad: by('SHAD'), para: by('PARA'), palace: by('PALB'),
    targets: [need('TAR1'), need('TAR2'), need('TAR3')],
    rn: ringNames('RN'), rc: ringNames('RC'),
    bots: list('BBT', 8), rocks: list('ROC', 3, 1), rka: list('RKA', 8, 1), rkb: list('RKB', 6, 1),
  };
}

export class ApoRun {
  /** the zone's particle emitters (null in node tests without a particle engine) */
  fx: ApoFx | null = null;
  readonly world: World;
  readonly recs: ApoRecords;
  sound: SoundBank<ApoSound>;
  say: (id: string) => boolean = () => false;
  spoken: string[] = [];

  /** DAT_05d5f090: the score */
  score = 0;
  /** DAT_05d5ee60: the height at the end of the previous tick; DAT_05d5f0a0: the start height; DAT_05d5f0a8: height above the ground; DAT_05d5f1ec: gauge reference */
  y = 0; startAlt = 2000; height = 0; refAlt = 0;
  /** DAT_05d5f0d0 + i * 0x14: ring flags (0 open, 1 passed); the flag of the last ring of a group (4, 9, 14) is set to 2 when the group is missed (DAT_05d5f120 / 184 / 1e8) */
  ring = new Uint8Array(15);
  /** DAT_05d5f0b0 / ac / b4: a ring of group 1 / 2 / 3 was passed (its target is shown) */
  group: [boolean, boolean, boolean] = [false, false, false];
  /** DAT_05d5f098: the parachute (solar wing) may be opened */
  chuteOk = false;
  /** DAT_05d5ee64: wing animation: 0 closed, 1 opening / open, 2 closing */
  canopy = 0;
  /** DAT_05d5ee68: the game is over */
  over = false;
  /** DAT_05d5f094: the pilot was destroyed (hit the sky sphere): the brickbots stop */
  aborted = false;
  /** DAT_05d5f0a4: the rock monsters woke up (OGSGPO08 spoken once) */
  monstersWoke = false;
  /** DAT_05d5f09c / d5f0b8 */
  landScore = 0; landBonus = 0;
  /** ground probe (FUN_00442a70 on the OGEL record): the ground height + 3.2, the hit point, the shadow switch (DAT_05d5f208) */
  groundY = 0; groundHit: Vec3 = [0, 0, 0]; shadowOn = false;
  /** DAT_05d5f290: the five points of the shadow patch (FUN_00442a70), the vertices of the SHAD mesh */
  shadow = new Float32Array(15);
  tick = 0;

  constructor(world: World, backend: SoundBackend | null = null) {
    this.world = world;
    this.recs = findApoRecords(world);
    this.sound = new SoundBank<ApoSound>(APO_SOUNDS, backend);
  }
  speak(id: string) { this.spoken.push(id); this.say(id); }
}

const runs = new WeakMap<World, ApoRun>();
export function apoRun(w: World): ApoRun {
  let r = runs.get(w);
  if (!r) { r = new ApoRun(w); runs.set(w, r); }
  return r;
}
export function dropApoRun(w: World) { runs.delete(w); }
