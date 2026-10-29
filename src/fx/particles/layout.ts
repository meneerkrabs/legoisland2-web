// Record layouts of the original particle engine (byte offsets of the executable's structures; the TypeScript records are flat buffers with these offsets,
// see core.ts). Indices named `*_D` are DWORD indices (byte offset / 4) for the Float32Array / Int32Array views, names ending in `_B` are byte offsets.
//
//   appearance record  APP_SIZE 0xe8 bytes   (FUN_00450250 loads `.app`; embedded at particle +0x10 and emitter block +0x248)
//   movement record    MOV_SIZE 0x144 bytes  (FUN_00450640 loads `.mov`; embedded at particle +0xf8 and emitter block +0x104)
//   emitter record     EMI_SIZE 0xb4 bytes   (FUN_004509b0 loads `.emi`; embedded at particle +0x23c and emitter block +0x50)
//   emitter block      BLK_SIZE 0x350 bytes  (the "current values" of a source = the template its particles are copied from, plus the pool bookkeeping)
//   particle           PART_SIZE 0x308 bytes (pool element of CParticleArray)
//   source             SRC_SIZE 0x620 bytes  (CParticleSource)

export const APP_SIZE = 0xe8, MOV_SIZE = 0x144, EMI_SIZE = 0xb4, BLK_SIZE = 0x350, PART_SIZE = 0x308, SRC_SIZE = 0x620;
export const APP_DW = APP_SIZE >> 2, MOV_DW = MOV_SIZE >> 2, EMI_DW = EMI_SIZE >> 2, BLK_DW = BLK_SIZE >> 2;
/** the first 0x50 bytes of every file record hold the name (the first line of the file) */
export const NAME_BYTES = 0x50;

/** appearance record (`.app`). In a particle's copy the colour / size / sprite fields are the RUNNING values. */
export const AP = {
  /** iSSprite: first sprite; in a particle the sprite chosen at spawn (`FUN_00451ca0`) */
  SPRITE: 0x54 >> 2,
  /** iESprite */
  ESPRITE: 0x58 >> 2,
  /** iUseModel (always 0 in the data) */
  USEMODEL: 0x5c >> 2,
  /** iMaterial: 0 = state block 6, 1 = 7, 2 = 3 (FUN_00887498) */
  MATERIAL: 0x60 >> 2,
  /** rgbaSColour (8.8 fixed point ints): the running colour of a particle */
  CR: 0x64 >> 2, CG: 0x68 >> 2, CB: 0x6c >> 2, CA: 0x70 >> 2,
  /** rgbaEColour: the colour a particle ends with (the running colour is clamped to it) */
  ER: 0x74 >> 2, EG: 0x78 >> 2, EB: 0x7c >> 2, EA: 0x80 >> 2,
  /** colour change per tick (set at spawn: (end - start) / life) */
  DR: 0x84 >> 2, DG: 0x88 >> 2, DB: 0x8c >> 2, DA: 0x90 >> 2,
  /** fVSColour / fVEColour / fVSAlpha / fVEAlpha: random variation (default -1.0 = none) */
  VSCOL: 0x94 >> 2, VECOL: 0x98 >> 2, VSALPHA: 0x9c >> 2, VEALPHA: 0xa0 >> 2,
  /** fSSize: the running size of a particle; fESize; fVSSize / fVESize: variation (default -1.0) */
  SIZE: 0xa4 >> 2, ESIZE: 0xa8 >> 2, VSSIZE: 0xac >> 2, VESIZE: 0xb0 >> 2,
  /** size change per tick */
  DSIZE: 0xb4 >> 2,
  /** byte: spin on (fSCTIndexInc != 0) */
  SPIN_B: 0xb8,
  /** fSCTIndex: running spin angle index (256 steps per turn) / fSCTIndexInc: spin speed per tick */
  SCT: 0xbc >> 2, SCTINC: 0xc0 >> 2,
  /** the integer angle index (0..255) used to look up the corner offsets */
  ANGLE: 0xc4 >> 2,
  /** 8 floats: u, v of the four corners (set from the sprite index) */
  UV: 0xc8 >> 2,
} as const;

/** movement record (`.mov`) and the runtime fields of a particle's copy */
export const MV = {
  /** fSpeedScale action target: scale of the emission speed vector (`FUN_00454780` case 0x24) */
  SPEEDSCALE: 0x50 >> 2,
  /** fBounce / fDBounce */
  BOUNCE: 0x54 >> 2, DBOUNCE: 0x58 >> 2,
  /** fGround / fDGround (sphere ground friction factors of the collision response) */
  GROUND: 0x5c >> 2, DGROUND: 0x60 >> 2,
  /** fAir / fDAir (velocity factor per tick) */
  AIR: 0x64 >> 2, DAIR: 0x68 >> 2,
  /** runtime: position (a particle's world position; the emission offset is written here) */
  POS: 0xdc >> 2,
  /** runtime: velocity */
  VEL: 0xf8 >> 2,
  /** runtime: emission direction (unit vector from the primitive) */
  DIR: 0x110 >> 2,
  /** vGravity / vDGravity (3 floats each) */
  GRAV: 0x11c >> 2, DGRAV: 0x128 >> 2,
  /** bytes: bRandBounceRot, bRandInitRot (copied to +0x134 at load), bRandBounceAngle */
  RAND_BOUNCE_ROT_B: 0x136, RAND_INIT_ROT_B: 0x138, COPY_B: 0x134, RAND_BOUNCE_ANGLE_B: 0x139,
} as const;

/** emitter record (`.emi`) */
export const EM = {
  /** iMaxParticles (int) */
  MAX: 0x50 >> 2,
  /** byte: lifespan < 0 (unlimited) */
  IMMORTAL_B: 0x54,
  /** fLifespan / fDLifespan (seconds) */
  LIFE: 0x58 >> 2, DLIFE: 0x5c >> 2,
  /** fDensity / fDDensity (per tick) */
  DENS: 0x60 >> 2, DDENS: 0x64 >> 2,
  /** fForce / fDForce (initial speed) */
  FORCE: 0x68 >> 2, DFORCE: 0x6c >> 2,
  /** fIncAngle / fExcAngle (emission cone) */
  INC: 0x70 >> 2, EXC: 0x74 >> 2,
  /** the emitter primitive (SetEmiPrimitive), a 0x3c byte structure at +0x78: type (0 box, 1 line, 2 sphere, 3 ring, 4 circle) */
  PRIM: 0x78 >> 2,
} as const;
/** offsets inside the primitive structure (dword indices relative to EM.PRIM) */
export const PR = { TYPE: 0, M1: 1, M2: 2, M3: 3, P1C: 0x1c >> 2, P20: 0x20 >> 2, P24: 0x24 >> 2, P28: 0x28 >> 2, P2C: 0x2c >> 2, P30: 0x30 >> 2, P34: 0x34 >> 2, P38: 0x38 >> 2 } as const;

/** emitter block (0x350): name 0, emitter record at +0x50, movement at +0x104, appearance at +0x248, bookkeeping at +0x330 */
export const BK = {
  EMI_B: 0x50, MOV_B: 0x104, APP_B: 0x248,
  /** int: live particles of the block */
  COUNT_D: 0x330 >> 2,
  /** float: fractional particles carried to the next tick */
  ACC_D: 0x34c >> 2,
} as const;

/** particle (0x308): header words, then the three embedded records */
export const PT = {
  APP_B: 0x10, MOV_B: 0xf8, EMI_B: 0x23c,
  /** float: remaining life in ticks (0x2f4) and 1 / (life - 1) (0x2f8) */
  LIFE_D: 0x2f4 >> 2, INVLIFE_D: 0x2f8 >> 2,
  /** byte: 0x22d / 0x22f flags (see source.ts), int 0x234 */
} as const;
