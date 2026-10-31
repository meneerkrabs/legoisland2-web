// z10RGB "cannon duel" (the Bull castle, Cedric / "Simon", sub-game 9, story node of the castle arc): constants, record indices, sound ids and the helpers the
// ports of the zone's functions share (docs/re/m6/z10RGB.md). Addresses are VAs of the NL build; the numbers are the immediates / .rdata floats the functions read.

/** constructor addresses of the zone's behaviour nodes (FUN_00423532's second argument, the extraction's `Attach.ctor`) */
export const CTOR = {
  RGBGAME: 0x5f77ad,   // rgbgame, on LAND (record 4): the phase machine, the score, the results (update FUN_005f72c0)
  PEPSWITC: 0x5f4f14,  // zone copy of PepSwitc, on Pepper: the cannons, the aiming, the mode switch (update FUN_005f49c5)
  PEPPHIT: 0x61884d,   // PeppHit, on Pepper, gated var 0xfb & 2 == 2: knocked up by a cannonball (update FUN_006186f2)
  CEDRIC: 0x619863,    // cedric, on CEDR (record 22), gated var 0xfc & 1: hops between the nine cannons (update FUN_00618ba6)
  CANNON: 0x61a57f,    // cannon, on each of the nine cannons CC00..CC08, gated var 0xfa & 1 (update FUN_0061a06a)
  WALK: 0x42f470,      // SGwalk, gated var 0xfb & 1 (the engine's walk node)
} as const;

/** records of the zone's table (index = byte offset the original uses / 0x68) */
export const REC = {
  SEAB: 0, SSEA: 1, SEAE: 2, LAND: 4,
  /** LFG0..LFG6, LFG9 (rig LFLG) and BFG0..BFG7 (rig BFLG): the flags the rgbgame update animates (FUN_005f7d8a), offsets 0x210 .. 0x828 step 0x68 */
  FLAGS: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  /** the big flag BBFG (rig BBFG, not animated by the update) */
  BBFG: 21,
  /** Cedric (CEDR, MFIG rig) */
  CEDR: 22,
  /** the skateboard record (DAT_009daa7c = 0x17) */
  SBRD: 23,
  /** the nine enemy cannons CC00..CC08 (offsets 0x2a40 .. 0x2d80) */
  CC: [104, 105, 106, 107, 108, 109, 110, 111, 112],
  /** the ten cannonballs CB00..CB09 (pool index i = record `CB0i`) */
  CB_FIRST: 113, CB_COUNT: 10,
  /** the ball shadow model */
  CSHD: 123,
  /** the castle (hit like the ground by a ball) */
  BUNS: 124,
  /** Pepper's four cannons CP00..CP03 (offsets 0x36d8 .. 0x3810) */
  CP: [135, 136, 137, 138],
  PEPP: 146,
} as const;
/** the record names the port checks at run time (a mismatch means another build of the data) */
export const REC_NAMES: Record<number, string> = {
  4: 'LAND', 22: 'CEDR', 23: 'SBRD', 104: 'CC00', 112: 'CC08', 113: 'CB04', 118: 'CB06', 123: 'CSHD', 124: 'BUNS', 135: 'CP00', 138: 'CP03', 146: 'PEPP',
};

/** zone-local game variables (SUBGAME: 250..254) and the result variables */
export const VAR = {
  /** 0xfa: the cannons fire while this is 1 (rgbgame ctor: 1; the end of the game: 0) */
  GAME_ON: 0xfa,
  /** COMPLETE_SUB_GAME: set to 1 by the update at the phases 4 and 5 (FUN_005f72c0) */
  COMPLETE_SUB_GAME: 0x53,
  /** 0xfb: the player's mode: 1 walk, 2 hit (PeppHit), 4 in a cannon, 8 out of lives, 0x10 unused (the zone's own PEPPER_CONTROL, gates SGwalk / PeppHit) */
  MODE: 0xfb,
  /** 0xfc: Cedric's gate (1 while the game runs, 0 when the last cannon is gone) */
  CEDRIC_ON: 0xfc,
  /** 0xfd: bit of the player's cannon last lost (1, 2, 4, 8); 0xfe: bit of the enemy cannon last destroyed (1 << k) */
  PEPP_CANNON_BIT: 0xfd, ENEMY_CANNON_BIT: 0xfe,
  TROPHY_RGB: 0x23, HISCORE_RGB: 0x3b,
} as const;
/** PEPPER mode values of VAR.MODE */
export const MODE = { WALK: 1, HIT: 2, CANNON: 4, DEAD: 8, UNUSED: 0x10 } as const;
/** phases of the game (DAT_05d5b338) */
export const PHASE = { INIT: 0, BRIDGE: 1, CROSSED: 2, CANNONS: 3, WON: 4, LOST: 5 } as const;

/** animation clips of the MFIG rig that the zone starts */
export const CLIP = {
  /** Pepper: knocked up / lying on the ground (PeppHit), idle (the walk node's own idle) */
  HIT_FLY: 0x1a, HIT_LAND: 0x93, IDLE: 0x1b,
  /** Cedric: waves (idle on a cannon), the take-off, the two hops */
  CED_WAVE: 0xda, CED_TAKEOFF: 0xd9, CED_HOP_UP: 0xb3, CED_HOP_DOWN: 0xba,
} as const;
/** rigs of the archive the zone binds (FUN_0060aeac: `FUN_0043b4e2(rig table[k], 1)` + clip 1): record -> rig name */
export const RIGS: { name: string; records: readonly number[] }[] = [
  { name: 'LFLG', records: REC.FLAGS.slice(0, 8) },
  { name: 'BFLG', records: REC.FLAGS.slice(8) },
  { name: 'BBFG', records: [REC.BBFG] },
  { name: 'MFIG', records: [REC.CEDR] },
  { name: 'SKBD', records: [REC.SBRD] },
];

/** sound table ids the zone loads (FUN_005f6470; 2D = FUN_00443580, 3D = FUN_004433b0) */
export const SND = {
  // 2D
  WIND: 0x1a2, CROW1: 0x1a4, CROW2: 0x1a3, CANNON_FIRE: 0x18e, CANNON_DRY: 0x18f, CANNON_RELOAD: 0x190, CANNON_READY: 0x191, CANNON_SWIVEL: 0x192, CANNON_TILT: 0x193,
  EXPLODE_2D: 0x1f5,
  // 3D
  CED_CANNON: 0x194, CED_CANNON_HIT: 0x195, HIT_CASTLE: 0x196, BALL_LAND: 0x197, BALL_FLY: 0x198, CED_JUMP1: 0x199, CED_JUMP2: 0x19a, CED_WAVE1: 0x19b, CED_WAVE2: 0x19c,
  CED_LOSE1: 0x19d, CED_LOSE2: 0x19e, SEA: 0x19f, WAVE1: 0x1a0, WAVE2: 0x1a1, NEARMISS1: 0x1f2, NEARMISS2: 0x1f3, NEARMISS3: 0x1f4,
} as const;
export const SOUNDS_2D = [SND.WIND, SND.CROW1, SND.CROW2, SND.CANNON_FIRE, SND.CANNON_DRY, SND.CANNON_RELOAD, SND.CANNON_READY, SND.CANNON_SWIVEL, SND.CANNON_TILT, SND.EXPLODE_2D] as const;
export const SOUNDS_3D = [SND.CED_CANNON, SND.CED_CANNON_HIT, SND.HIT_CASTLE, SND.BALL_LAND, SND.BALL_FLY, SND.CED_JUMP1, SND.CED_JUMP2, SND.CED_WAVE1, SND.CED_WAVE2, SND.CED_LOSE1,
  SND.CED_LOSE2, SND.SEA, SND.WAVE1, SND.WAVE2, SND.NEARMISS1, SND.NEARMISS2, SND.NEARMISS3] as const;

/** the float32 value of a bit pattern (the code writes many constants as hex immediates) */
const cvt = new DataView(new ArrayBuffer(4));
export function f32(bits: number): number { cvt.setUint32(0, bits >>> 0, true); return cvt.getFloat32(0, true); }
/** x87 `__ftol`: truncation towards zero */
export const ftol = (x: number): number => Math.trunc(x);

/** the numbers of the zone's code (immediates / .rdata floats), with the address they are read from */
export const K = {
  /** FUN_005f6340 (the reset): the respawn point on the bridge DAT_05d5b320..28 (-25.45, 12, -16.22), the first shot speed scale, the counts, the gravity of the shots, the score */
  BRIDGE: [f32(0xc1cb999a), f32(0x41400000), f32(0xc181c28f)] as readonly number[],
  SHOT_SPEED: f32(0x40cccccd),       // DAT_0090bc40 = 6.4 (phase 1); FUN_005f72c0 case 2 sets 4.0 (0x40800000) for the cannon phase
  SHOT_SPEED_PHASE3: 4,
  CANNONS: 9,                        // DAT_0090bc44
  LIVES: 4,                          // DAT_0090bc45
  G: f32(0x3d75c28f),                // _DAT_0090bc48 = 0.06: the gravity of the cannonballs and of Cedric's hops (per tick^2)
  SCORE0: 1000,                      // DAT_0090bc50
  /** FUN_005f49c5: Pepper below y = 4 on the bridge: put at the bridge point (_DAT_00892080 = 4.0); the cannon is entered within sqrt(72) (FUN_005f6017: 0x42900000) */
  FALL_Y: 4, ENTER_R2: 72,
  /** FUN_005f56d9: aiming step per tick (_DAT_00892718), the pitch limits (-0.5 / 0.3), the pitch after entering, the cannon is lifted to y = 16 */
  AIM_STEP: f32(0x3b23d70a), PITCH_MIN: -0.5, PITCH_MAX: f32(0x3e99999a), PITCH_FIRST: f32(0xbe99999a), CANNON_Y: 16,
  /** FUN_005f56d9 camera: the zoom while aiming (DAT_0090bb48), the eye (DAT_0090bb50) and the target (DAT_0090bb60) in the cannon's frame */
  AIM_FOV: f32(0x3e570a3d), AIM_EYE: [0, Math.fround(3.878), 0] as readonly number[], AIM_TARGET: [0, Math.fround(5.17), Math.fround(3.209)] as readonly number[],
  /** FUN_005f6120: the muzzle (DAT_0090bb78) in the cannon's frame, the shot speed scale (DAT_0090bb84: 8 first, then 6), the pitch of the ball 2.5 * rx + 0.8, the reload (100 ticks) */
  MUZZLE: [0, Math.fround(4.8), Math.fround(11.2)] as readonly number[], SHOT_SCALE_FIRST: 8, SHOT_SCALE: 6, PITCH_K: 2.5, PITCH_0: f32(0x3f4ccccd), RELOAD: 100,
  /** the gauge in a cannon: 0 .. 100 (the reload), else 0 .. 12 (the cannons left) */
  GAUGE_RELOAD: 100, GAUGE_CANNONS: 12,
  /** the invulnerability after a hit: DAT_0090bdf8 starts at 3.0 and falls by (1/30) * dt * dt per update (FUN_005f72c0: `_DAT_008922bc * DAT_008b1718 * DAT_008b1718`): 90 updates at dt 1, 360 at dt 0.5 */
  BLINK: 3, BLINK_STEP: f32(0x3d08850a),
  /** PeppHit (FUN_00618360): the jump 4.0, gravity 0.5, bounce -0.4, rest below 2.4, the landing waits 30 counter ticks (FUN_00618612; the counter DAT_05d5b340 = ftol(float += 1 * dt)) */
  HIT_VY: 4, HIT_G: 0.5, HIT_BOUNCE: f32(0xbecccccd), HIT_REST: f32(0x4019999a), HIT_WAIT: 30, HIT_CLIP_END: 2,
  /** the player's camera: sub-game 9 moves eye and target by Pepper's velocity (FUN_0042d4b1); the eye starts 8 higher (_DAT_00892090) */
  CAM_RAISE: 8,
  /** the flags wave at rate rand(0.5) + 0.75 (_DAT_008921f0) */
  FLAG_RATE: 0.75,
  /** the ball: the near miss / hit radii (squares 16 / 36), the box |dx|, |dz| < 20 around Pepper, the whistle and ground samples, the splash length 0x32 ticks */
  HIT_R2: 16, MISS_R2: 36, NEAR_BOX: 20, SPLASH: 50,
  /** Cedric: the target scatter 4.5 * 8 = 36 (+-18), the turn step 0.001 per tick, the hop: velocity table at 0x911f78 (9 x 9 floats, halved), flight scale 64, step 0.4, short hop below 20 ticks */
  CED_SCATTER: 36, CED_TURN: f32(0x3a83126f), CED_PERCH: [0, 5, 2] as readonly number[], CED_HOP_TABLE: 0x911f78, CED_SCALE: 64, CED_VY_STEP: f32(0x3ecccccd), CED_SHORT: 20,
  /** the cannon (enemy): the muzzle, the recoil (0, 2, 0) from the attach argument, the delay 0..90, the wait after a shot 50, the recoil rest 0.6 */
  CANNON_DELAY: 90, CANNON_WAIT: 50, RECOIL_REST: f32(0x3f19999a),
  /** the results: gold above 7000, silver above 4000 (score < 0x1b59 / 0xfa1) */
  GOLD: 0x1b59, SILVER: 0xfa1,
} as const;

/** the hop table of Cedric (DAT_00911f78): row = the cannon he stands on, column = the one he jumps to; read from the executable at run time */
export function hopTable(pe: { u32(va: number): number }): number[][] {
  const t: number[][] = [];
  for (let r = 0; r < 9; r++) { const row: number[] = []; for (let c = 0; c < 9; c++) row.push(f32(pe.u32(K.CED_HOP_TABLE + (r * 9 + c) * 4))); t.push(row); }
  return t;
}
