// CParticleSource (CParticleSource.cpp): one running effect. `initSource` = FUN_00454020, `updateSource` = FUN_00452300 (emission, ForNew / ForAll script actions,
// particle movement and ageing), `updateSubBlocks` = FUN_00453410 (the [EMITS] sub-particles of a main particle), the particle initialisers FUN_00453220 /
// FUN_00453360 / FUN_00451ca0 and the emitter primitives FUN_00456d50 .. FUN_00457290.
//
// Every statement was checked against the disassembly; the order of the random table draws is the order of the original (the oracle test compares the table
// index as well as every byte of the records).
import { type Rec, ftol, r24, type PState, U_TABLE, V_TABLE } from './core.ts';
import type { ParDef, ParticleDefs } from './defs.ts';
import { AP, EM, BK, MV, PT, APP_SIZE, EMI_SIZE, MOV_SIZE } from './layout.ts';
import { Block, type Particle, Pool } from './pool.ts';
import { type ActionHost, compileScript, type FrameClock, Manager, runActions } from './actions.ts';
import { matEuler, matIdentity, matMul, matRotY, matRotZ, matEuler0, transformDir, transformPoint, vecNormalize, vecReflect } from './mat.ts';

const f32 = Math.fround;

/** a parent matrix: a live array or a function returning one (the owner's world matrix changes every tick) */
export type MatrixSource = Float32Array | (() => Float32Array);

/** the service the sources need from the engine */
export interface EngineHost {
  ps: PState;
  defs: ParticleDefs;
  /** DAT_05d37030: the identity matrix used when a source has no parent matrix */
  identity: Float32Array;
  clock: FrameClock;
  /** DAT_008b1718: ticks of the last frame (1.0 at 30 Hz) */
  dt: number;
  /** FUN_00417575: a game variable */
  getVar(i: number): number;
  /** FUN_0044f6c0: put a particle on the draw list */
  addDraw(p: Particle): void;
  /** DAT_05d3b0a0 / camera position DAT_009da5e8..f0: the distance based emission scale (set by z27TRX) */
  lod: boolean;
  camera: Float32Array;
  /** FUN_0044f1d0 / FUN_0044f1f0: the engine's pool of extra (splash) sources */
  takeExtra(): Source | null;
  /** the stack slot [esp + 0x2c] of FUN_00452300 (see `collide`): the appearance record of the last particle the main update loop spawned / aged, kept between calls */
  staleApp?: Rec | null;
  giveExtra(s: Source): void;
  /** swept sphere against a collision record (FUN_00441b10): see `CollisionHit` */
  collide?(rec: unknown, pos: Float32Array, vel: Float32Array, radius: number, outNormal: Float32Array, outPoint: Float32Array): boolean;
  /** the worlds's 'PCOL' tag test of the collision list node (DAT_008b85bc) */
  isPcol?(rec: unknown): boolean;
}

/** collision list node (FUN_00456a90 pushes one at the head) */
export interface CollNode { rec: unknown; next: CollNode | null }

const OVERRIDE_COUNT = 0x12;

/** CParticleSource (0x620 bytes). The pointer fields of the original are references. */
export class Source implements ActionHost {
  /** +0 / +1 / +2 */
  active = false; started = false; ended = false;
  /** +0xc */
  name = '';
  /** +0x5c */
  mgr = new Manager();
  /** +0x60 pool size, +0x64 number of [SPLASH] entries, +0x68 number of [EMITS] entries */
  poolSize = 0; nSplash = 0; nEmits = 0;
  /** +0x6c: the sub-particle pools (one per main particle), +0x70: sub-block storage (poolSize * nEmits), +0x74: the [EMITS] blocks of the script */
  subPools: Pool[] | null = null;
  subBlocks: Block[] | null = null;
  subTmpl: Block[] = [];
  /** +0x78 */
  script: ParDef | null = null;
  /** +0x7c: the emitter block; its pool is +0x3b8 */
  tmpl = new Block();
  /** +0x3cc: 18 override slots (flag byte + value dword at +8) set by `setParam` */
  override: { flag: boolean; value: number }[] = Array.from({ length: OVERRIDE_COUNT }, () => ({ flag: false, value: 0 }));
  /** +0x534 */
  cur: Block = this.tmpl;
  /** +0x538: the parent matrix (null = the engine's identity matrix) */
  matrixSrc: MatrixSource | null = null;
  /** +0x53c: local matrix (position / rotation of the source in its parent), +0x57c: world matrix of this tick, +0x5bc: the previous one */
  readonly local = new Float32Array(16);
  readonly world = new Float32Array(16);
  readonly prevWorld = new Float32Array(16);
  /** +0x5fc: movement vector (previous - current position), +0x608 its length (<= 15) */
  readonly vel = new Float32Array(3);
  speed = 0;
  /** +0x60c: collision list */
  coll: CollNode | null = null;
  /** +0x614 */
  flag614 = 0;
  /** +0x618: gate variable, +0x61c: gate value, +0x61e: gate mask (shorts) */
  gateVar = 0; gateValue = 0; gateMask = 0;
  /** ActionHost */
  isNull = false;
  ps!: PState; defs!: ParticleDefs;
  /** FUN_0043a9e5(world, parent, local): recompute the world matrix (after the parent matrix pointer changed) */
  refreshWorld(identity: Float32Array): void { matMul(this.world, 0, this.parent(identity), 0, this.local, 0); }
  /** the parent matrix as a plain array */
  parent(identity: Float32Array): Float32Array {
    const m = this.matrixSrc;
    return m === null ? identity : typeof m === 'function' ? m() : m;
  }
}

/** FUN_00453220(app, inv): colour variation and the per-tick colour change */
export function colourInit(a: Rec, inv: number, ps: PState): void {
  const ai = a.i, af = a.f;
  if (0 <= af[AP.VSCOL]) {
    const m = f32(f32(ps.rnd() * af[AP.VSCOL]) + f32(1.0 - af[AP.VSCOL]));
    ai[AP.CR] = ftol(f32(ai[AP.CR] * m)); ai[AP.CG] = ftol(f32(ai[AP.CG] * m)); ai[AP.CB] = ftol(f32(ai[AP.CB] * m));
  }
  if (0 <= af[AP.VECOL]) {
    const m = f32(f32(ps.rnd() * af[AP.VECOL]) + f32(1.0 - af[AP.VECOL]));
    ai[AP.ER] = ftol(f32(ai[AP.ER] * m)); ai[AP.EG] = ftol(f32(ai[AP.EG] * m)); ai[AP.EB] = ftol(f32(ai[AP.EB] * m));
  }
  ai[AP.DR] = ftol(f32((ai[AP.ER] - ai[AP.CR]) * inv));
  ai[AP.DG] = ftol(f32((ai[AP.EG] - ai[AP.CG]) * inv));
  ai[AP.DB] = ftol(f32((ai[AP.EB] - ai[AP.CB]) * inv));
}

/** the alpha part that follows FUN_00453220 in FUN_00452300 / FUN_00453410 (`inv` is the float32 loaded back from the particle) */
export function alphaInit(a: Rec, inv: number, ps: PState): void {
  const ai = a.i, af = a.f;
  if (0 <= af[AP.VSALPHA]) ai[AP.CA] = ftol(f32(f32(f32(ps.rnd() * af[AP.VSALPHA]) + f32(1.0 - af[AP.VSALPHA])) * ai[AP.CA]));
  if (0 <= af[AP.VEALPHA]) ai[AP.EA] = ftol(f32(f32(f32(ps.rnd() * af[AP.VEALPHA]) + f32(1.0 - af[AP.VEALPHA])) * ai[AP.EA]));
  ai[AP.DA] = ftol(f32((ai[AP.EA] - ai[AP.CA]) * inv));
}

/** FUN_00453360(app, inv): size variation and size change per tick */
export function sizeInit(a: Rec, inv: number, ps: PState): void {
  const af = a.f;
  if (0 <= af[AP.VSSIZE]) af[AP.SIZE] = f32(f32(f32(ps.rnd() * af[AP.VSSIZE]) + f32(1.0 - af[AP.VSSIZE])) * af[AP.SIZE]);
  if (0 <= af[AP.VESIZE]) af[AP.ESIZE] = f32(f32(f32(ps.rnd() * af[AP.VESIZE]) + f32(1.0 - af[AP.VESIZE])) * af[AP.ESIZE]);
  af[AP.DSIZE] = f32(f32(af[AP.ESIZE] - af[AP.SIZE]) * inv);
}

/** FUN_00451ca0(app): pick the sprite (`ftol((e - s + 1) * rnd) + s`) and its four corner texture coordinates. (The mirror modes of DAT_05d478f8 are dead code: the variable is never written.) */
export function spriteInit(a: Rec, ps: PState): void {
  const ai = a.i, af = a.f;
  const s = ai[AP.SPRITE], e = ai[AP.ESPRITE];
  ai[AP.SPRITE] = (ftol(f32((e - s + 1) * ps.rnd())) + s) | 0;   // note: the random draw happens first (idx++), then the multiplication
  const n = ai[AP.SPRITE];
  const col = n & 7, row = n >> 3;
  const u0 = U_TABLE[col], u1 = U_TABLE[col + 1], vA = V_TABLE[row], vB = V_TABLE[row + 1];
  // (u0, vA) (u1, vA) (u1, vB) (u0, vB)
  const o = AP.UV;
  af[o] = u0; af[o + 6] = u0; af[o + 2] = u1; af[o + 4] = u1;
  af[o + 1] = vA; af[o + 3] = vA; af[o + 7] = vB; af[o + 5] = vB;
}

// ---------------------------------------------------------------------------------------------------------------------------
// emitter primitives (FUN_00456d50 and the five it dispatches to). `prim` = the template's primitive structure, `emi` / `mov` = the new particle's records.

const PRIM_D = (BK.EMI_B + EM.PRIM * 4) >> 2;     // dword index of the primitive structure in the block
const TWO_PI32 = f32(6.2831855), PI32 = f32(3.1415927), INV_TWO_PI32 = f32(0.15915494);
/** the constant 0x40c90e56 pushed for the circle angle (slightly below 2 pi) */
const CIRCLE_MAX = new Float32Array(new Uint32Array([0x40c90e56]).buffer)[0];
/** DAT_008b85cc: angle step of the sphere / ring sweep mode for `Points` = 0 .. 11 (the original's data: 2 pi / n for n = 2 .. 9, then 0.314159 and, for 11, whatever follows the table) */
const POINTS = new Float32Array([0, 0, 3.1415927, 2.0943952, 1.5707964, 1.2566371, 1.0471976, 0.8975979, 0.7853982, 0.6981317, 0.31415927, 1.7937076675854021e+25]);

/** the matrix of FUN_00456de0 & co: identity, Y rotation by a random angle inside the cone, Z rotation by a random angle; the emission direction is its third row */
function coneDirection(emi: Rec, mov: Rec, ps: PState): void {
  const m = new Float32Array(16);
  matIdentity(m);
  const a = ps.rnd();
  matRotY(m, 0, f32(f32(f32(emi.f[EM.INC] - emi.f[EM.EXC]) * a) + emi.f[EM.EXC]));
  matRotZ(m, 0, f32(ps.rnd() * TWO_PI32));
  mov.f[MV.DIR] = m[8]; mov.f[MV.DIR + 1] = m[9]; mov.f[MV.DIR + 2] = m[10];
}

/** FUN_00456d50: choose the particle's start position and direction from the primitive */
export function emitPrimitive(blk: Block, emi: Rec, mov: Rec, ps: PState): void {
  const P = blk.rec.f, Pi = blk.rec.i;
  Pi[PRIM_D + 3] = 0x3f800000; Pi[PRIM_D + 1] = 0; Pi[PRIM_D + 2] = 0;
  const q = (o: number) => PRIM_D + (o >> 2);
  const pos = MV.POS;
  switch (Pi[PRIM_D]) {
    case 1: {                                                                          // Line: FUN_00456f00
      const dx = f32(P[q(0x28)] - P[q(0x1c)]);
      const dy = f32(P[q(0x2c)] - P[q(0x20)]);
      const dz = f32(P[q(0x30)] - P[q(0x24)]);
      const r = ps.rnd();
      const yy = f32(r * dy), zz = f32(r * dz);
      mov.f[pos] = f32(f32(dx * r) + P[q(0x1c)]);
      mov.f[pos + 1] = f32(yy + P[q(0x20)]);
      mov.f[pos + 2] = f32(zz + P[q(0x24)]);
      coneDirection(emi, mov, ps);
      break;
    }
    case 2: {                                                                          // Sphere: FUN_00457010
      let rx: number, ry: number;
      if (Pi[q(0x20)] !== 0xd) {
        rx = f32(ps.rnd() * -TWO_PI32); ry = f32(ps.rnd() * -TWO_PI32);
      } else {
        rx = P[q(0x24)]; ry = P[q(0x28)];
        const fVar1 = f32(P[q(0x2c)] + P[q(0x24)]);
        P[q(0x24)] = fVar1;
        const ly = f32(P[q(0x30)] + P[q(0x28)]);
        P[q(0x28)] = ly;
        const pt = POINTS[Pi[q(0x34)]];
        P[q(0x24)] = fVar1 + pt;
        P[q(0x28)] = ly + pt;
      }
      const R = new Float32Array(16);
      matEuler0(R, 0, rx, ry, 0);
      const v = new Float32Array([0, 0, 1]), d = new Float32Array(3);
      transformPoint(d, 0, R, 0, v, 0);
      mov.f[MV.DIR] = d[0]; mov.f[MV.DIR + 1] = d[1]; mov.f[MV.DIR + 2] = d[2];
      const rad = P[q(0x38)];
      mov.f[pos] = rad * mov.f[MV.DIR]; mov.f[pos + 1] = rad * mov.f[MV.DIR + 1]; mov.f[pos + 2] = rad * mov.f[MV.DIR + 2];
      break;
    }
    case 3: {                                                                          // Ring: FUN_00457140
      if (Pi[q(0x20)] !== 0xd) P[q(0x28)] = f32(f32(ps.rnd() * TWO_PI32) - PI32);
      else {
        const v = f32(f32(POINTS[Pi[q(0x30)]] + P[q(0x2c)]) + P[q(0x28)]);
        P[q(0x28)] = v;
        if (v > PI32) P[q(0x28)] = f32(v - TWO_PI32);
        else if (v < -PI32) P[q(0x28)] = f32(v + TWO_PI32);
      }
      const m = new Float32Array(16);
      matIdentity(m);
      const a = ps.rnd();
      matRotY(m, 0, f32(f32(f32(emi.f[EM.INC] - emi.f[EM.EXC]) * a) + emi.f[EM.EXC]));
      matRotZ(m, 0, P[q(0x28)]);
      mov.f[MV.DIR] = m[8]; mov.f[MV.DIR + 1] = m[9]; mov.f[MV.DIR + 2] = m[10];
      const idx = ftol(f32(f32(f32(P[q(0x28)] + PI32) * INV_TWO_PI32) * 256));
      mov.f[pos] = ps.mem[idx] * P[q(0x24)];
      mov.f[pos + 1] = ps.mem[256 + idx] * P[q(0x24)];
      mov.f[pos + 2] = 0;
      break;
    }
    case 4: {                                                                          // Circle: FUN_00457290 (uses the C runtime rand twice)
      const ang = f32(ps.crtRand(CIRCLE_MAX));
      const rad = ps.crtRand(emi.f[(0x94 >> 2)]);
      mov.f[pos] = Math.sin(ang) * rad;
      mov.f[pos + 1] = Math.cos(ang) * rad;
      mov.f[pos + 2] = 0;
      const m = new Float32Array(16);
      matIdentity(m);
      const a = ps.rnd();
      matRotY(m, 0, f32(f32(f32(emi.f[EM.INC] - emi.f[EM.EXC]) * a) + emi.f[EM.EXC]));
      matRotZ(m, 0, f32(ps.rnd() * TWO_PI32));
      mov.f[MV.DIR] = m[8]; mov.f[MV.DIR + 1] = m[9]; mov.f[MV.DIR + 2] = m[10];
      break;
    }
    default: {                                                                         // Box: FUN_00456de0
      const r1 = ps.rnd();
      const X = f32(f32(f32(r1 * P[q(0x1c)]) * 2) - P[q(0x1c)]);
      const r2 = ps.rnd();
      const Y = f32(f32(f32(r2 * P[q(0x20)]) * 2) - P[q(0x20)]);
      const r3 = ps.rnd();
      const Z = f32(f32(f32(r3 * P[q(0x24)]) * 2) - P[q(0x24)]);
      mov.f[pos] = X; mov.f[pos + 1] = Y; mov.f[pos + 2] = Z;
      coneDirection(emi, mov, ps);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// source set-up

/**
 * FUN_00454020(script, matrix, pos, rot): initialise a source from a script. Returns false when there is no script.
 * `pos` / `rot` are the 3 floats each (the original reads them through pointers at call time).
 */
export function initSource(src: Source, script: ParDef | null, matrix: MatrixSource | null, pos: ArrayLike<number>, rot: ArrayLike<number>, eng: EngineHost): boolean {
  if (!script) return false;
  // (the original reads float32 values through pointers: the API takes doubles, round them like a store would)
  matEuler(src.local, 0, f32(rot[0]), f32(rot[1]), f32(rot[2]), f32(pos[0]), f32(pos[1]), f32(pos[2]));
  src.matrixSrc = matrix;
  const par = src.parent(eng.identity);
  src.prevWorld.set(par); src.world.set(par);
  src.active = true; src.started = false;
  src.nEmits = script.nEmits; src.poolSize = script.maxParticles; src.nSplash = script.nSplash;
  src.script = script;
  src.speed = 0; src.vel.fill(0);
  if (script.name.length < 0x50) src.name = script.name;
  src.ps = eng.ps; src.defs = eng.defs;
  // FUN_00454760: the manager is flagged for a restart, the script is compiled against this source
  src.mgr = new Manager();
  src.mgr.resetFlag = true;
  src.mgr.host = src;
  src.tmpl = new Block();
  src.cur = src.tmpl;
  compileScript(script.text, src, 0, eng.clock);
  src.mgr.finish();
  if (src.nEmits === 0) src.subTmpl = [];
  else src.subTmpl = script.emits.slice(0, src.nEmits).map((b) => new Block(b));
  src.tmpl.pool = new Pool(src.poolSize);
  if (script.subMax === 0) { src.subPools = null; src.subBlocks = null; }
  else {
    src.subBlocks = Array.from({ length: src.poolSize * src.nEmits }, () => new Block());
    src.subPools = Array.from({ length: src.poolSize }, () => new Pool(script.subMax));
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------
// FUN_00452300: the per tick update of a source

/** the distance based emission scale of z27TRX (DAT_05d3b0a0): 0 beyond 400, 0.25 beyond 200, 0.5 beyond 120, else 1 */
function emissionScale(src: Source, eng: EngineHost): number {
  if (!eng.lod) return 1.0;
  const m = src.parent(eng.identity);
  const dx = f32(m[12] - eng.camera[0]), dy = f32(m[13] - eng.camera[1]), dz = f32(m[14] - eng.camera[2]);
  const dist = f32(Math.sqrt(f32(f32(f32(dz * dz) + f32(dy * dy)) + f32(dx * dx))));
  // thresholds DAT_05d37070 / 74 / 78 = 50 / 25 / 15 (x 8)
  if (!(dist <= 50 * 8)) return 0;
  if (!(dist <= 25 * 8)) return 0.25;
  if (!(dist <= 15 * 8)) return 0.5;
  return 1.0;
}

/** the override slot -> template field map of FUN_00452300 (types of `setParam`) */
function applyOverrides(src: Source): void {
  const t = src.tmpl.rec;
  const set = (byteOff: number, v: number) => { t.i[byteOff >> 2] = v; };
  for (let i = 0; i < OVERRIDE_COUNT; i++) {
    const o = src.override[i];
    if (!o.flag) continue;
    switch (i) {
      case 0: set(BK.EMI_B + 0x68, o.value); break;     // fForce
      case 2: set(BK.EMI_B + 0x58, o.value); break;     // fLifespan
      case 3: set(BK.EMI_B + 0x5c, o.value); break;     // fDLifespan
      case 4: set(BK.APP_B + 0xa4, o.value); break;     // start size
      case 5: set(BK.APP_B + 0xa8, o.value); break;     // end size
      case 8: set(BK.EMI_B + 0x60, o.value); break;     // fDensity
      case 9: set(BK.EMI_B + 0x64, o.value); break;     // fDDensity
      case 10: set(BK.EMI_B + 0x70, o.value); break;    // fIncAngle
      case 11: set(BK.EMI_B + 0x74, o.value); break;    // fExcAngle
      case 12: set(BK.MOV_B + 0x64, o.value); break;    // fAir
      case 13: set(BK.MOV_B + 0x68, o.value); break;    // fDAir
      case 16: set(BK.MOV_B + 0x54, o.value); break;    // fBounce
      case 17: set(BK.MOV_B + 0x58, o.value); break;    // fDBounce
    }
  }
}

/** random factor `rnd * dev + base` applied to the three physics fields of a new particle and the gravity deviation */
function randomiseMovement(mov: Rec, ps: PState): void {
  const f = mov.f;
  f[MV.AIR] = f32(f32(ps.rnd() * f[MV.DAIR]) + f[MV.AIR]);
  f[MV.GROUND] = f32(f32(ps.rnd() * f[MV.DGROUND]) + f[MV.GROUND]);
  f[MV.BOUNCE] = f32(f32(ps.rnd() * f[MV.DBOUNCE]) + f[MV.BOUNCE]);
}

export function updateSource(src: Source, eng: EngineHost): void {
  const tm = src.tmpl;
  src.cur = tm;
  const gateOk = ((src.gateMask << 16 >> 16) & eng.getVar(src.gateVar)) === (src.gateValue << 16 >> 16);
  if (gateOk) {
    if (src.mgr.resetFlag) { src.mgr.restart(); src.ended = false; }
    src.prevWorld.set(src.world);
    // (DAT_05d3b0d4 is never set: the matrix override block of the original is dead)
    matMul(src.world, 0, src.parent(eng.identity), 0, src.local, 0);
    const v = src.vel;
    v[0] = src.prevWorld[12] - src.world[12]; v[1] = src.prevWorld[13] - src.world[13]; v[2] = src.prevWorld[14] - src.world[14];
    const len = f32(Math.sqrt(f32(f32(f32(v[2] * v[2]) + f32(v[1] * v[1])) + f32(v[0] * v[0]))));
    src.speed = len;
    if (!(len <= 15)) {
      src.speed = 15;
      vecNormalize(v, 0);
      v[0] = v[0] * 15; v[1] = v[1] * 15; v[2] = v[2] * 15;
    }
    const scale = emissionScale(src, eng);
    applyOverrides(src);
    runActions(src.mgr, src, eng.clock);
    if (!src.mgr.resetFlag && !src.ended && tm.rec.i[BK.COUNT_D] < tm.emi.i[EM.MAX]) emit(src, eng, scale);
  }
  updateParticles(src, eng);
}

/** the emission part of FUN_00452300 */
function emit(src: Source, eng: EngineHost, scale: number): void {
  const ps = eng.ps, dt = eng.dt;
  const tm = src.tmpl;
  const E = tm.emi, TF = tm.rec.f;
  // accumulated fractional count
  TF[BK.ACC_D] = f32(f32(f32(f32(ps.rnd() * E.f[EM.DDENS]) + E.f[EM.DENS]) * dt) + TF[BK.ACC_D]);
  let n = ftol(f32(scale * TF[BK.ACC_D]));
  const room = E.i[EM.MAX] - tm.rec.i[BK.COUNT_D];
  if (n >= room) n = room;
  TF[BK.ACC_D] = TF[BK.ACC_D] - n;
  // movement dependent extra
  let total = ftol(f32(f32(f32(E.f[EM.DENS] * dt) + n) * src.speed)) + n;
  if (total >= E.i[EM.MAX]) total = E.i[EM.MAX];
  while (total > 0) {
    const p = tm.allocParticle();
    if (!p) return;
    eng.staleApp = p.app;                        // 0x452788: mov [esp + 0x2c], edi (the new particle's appearance record)
    spawn(src, eng, p);
    total--;
  }
}

/** one new main particle (the loop body of FUN_00452300) */
function spawn(src: Source, eng: EngineHost, p: Particle): void {
  const ps = eng.ps, dt = eng.dt;
  const tm = src.tmpl;
  p.app.u8.set(tm.app.u8.subarray(0, APP_SIZE));
  p.emi.u8.set(tm.emi.u8.subarray(0, EMI_SIZE));
  p.mov.u8.set(tm.mov.u8.subarray(0, MOV_SIZE));
  matIdentity(p.mov.f.subarray(0xac >> 2, 0xac / 4 + 16) as Float32Array, 0);
  const pf = p.rec.f, pi = p.rec.i;
  const app = p.app, emi = p.emi, mov = p.mov;
  if (app.i[AP.USEMODEL] !== 0) throw new Error('particle models (iUseModel) are not supported: the shipped effects never use them');
  // life
  const lifeD = f32(f32(f32(ps.rnd() * emi.f[EM.DLIFE]) + emi.f[EM.LIFE]) * 30);
  pf[PT.LIFE_D] = lifeD;
  let inv: number;
  if (emi.u8[EM.IMMORTAL_B] !== 0) inv = 1.0; else inv = f32(1.0 / f32(lifeD + 1.0));
  const inv32 = f32(inv);
  pf[PT.INVLIFE_D] = inv32;
  colourInit(app, inv32, ps);
  alphaInit(app, pf[PT.INVLIFE_D], ps);
  sizeInit(app, pf[PT.INVLIFE_D], ps);
  spriteInit(app, ps);
  mov.u8[0x137] = 1;                                   // p+0x22f
  // sub blocks
  setupSubBlocks(src, p);
  if (app.u8[AP.SPIN_B] !== 0) {
    if ((ps.rand() & 1) === 0) app.f[AP.SCTINC] = ps.rnd() * app.f[AP.SCTINC];
    else app.f[AP.SCTINC] = -(ps.rnd() * app.f[AP.SCTINC]);
  }
  emitPrimitive(tm, emi, mov, ps);
  // position / direction to world space
  const pos = mov.f.subarray(MV.POS, MV.POS + 3), dir = mov.f.subarray(MV.DIR, MV.DIR + 3);
  const tmp = new Float32Array(3);
  tmp.set(pos); transformPoint(pos, 0, src.world, 0, tmp, 0);
  tmp.set(dir); transformDir(dir, 0, src.world, 0, tmp, 0);
  // velocity = speed * direction
  const speed = f32(f32(ps.rnd() * emi.f[EM.DFORCE]) + emi.f[EM.FORCE]);
  const vel = mov.f.subarray(MV.VEL, MV.VEL + 3);
  vel[0] = speed * dir[0]; vel[1] = speed * dir[1]; vel[2] = speed * dir[2];
  // spread along the velocity over one tick
  const r1 = f32(ps.rnd() * vel[0]);
  const r2 = f32(ps.rnd() * vel[1]);
  const r3 = f32(ps.rnd() * vel[2]);
  const y = f32(dt * r2), z = f32(dt * r3);
  pos[0] = f32(f32(r1 * dt) + pos[0]);
  pos[1] = f32(y + pos[1]); pos[2] = f32(z + pos[2]);
  // inherit the source's movement
  const k = ps.rnd();
  const sv = src.vel;
  const a = f32(k * sv[0]), b = f32(k * sv[1]), c = f32(k * sv[2]);
  pos[0] = f32(a + pos[0]); pos[1] = f32(b + pos[1]); pos[2] = f32(c + pos[2]);
  randomiseMovement(mov, ps);
  // gravity deviation: (r1 - r4) * dg
  const g = mov.f, G = MV.GRAV, DG = MV.DGRAV;
  const d1 = f32(ps.rnd() * g[DG]);
  const d2 = f32(ps.rnd() * g[DG + 1]);
  const d3 = f32(ps.rnd() * g[DG + 2]);
  const d4 = f32(ps.rnd() * g[DG]);
  const d5 = f32(ps.rnd() * g[DG + 1]);
  const d6 = f32(ps.rnd() * g[DG + 2]);
  const gx = f32(d1 - d4), gy = f32(d2 - d5), gz = f32(d3 - d6);
  g[G] = f32(gx + g[G]); g[G + 1] = f32(gy + g[G + 1]); g[G + 2] = f32(gz + g[G + 2]);
  void pi;
}

/** the sub block set-up of a new main particle (the [EMITS] blocks of the script) */
function setupSubBlocks(src: Source, p: Particle): void {
  const n = src.nEmits;
  p.subBlocks = null;
  if (n === 0) return;
  const base = p.id * n;
  const blocks: Block[] = [];
  for (let k = 0; k < n; k++) {
    const b = src.subBlocks![base + k], t = src.subTmpl[k];
    b.app.u8.set(t.app.u8.subarray(0, APP_SIZE));
    b.mov.u8.set(t.mov.u8.subarray(0, MOV_SIZE));
    b.emi.u8.set(t.emi.u8.subarray(0, EMI_SIZE));
    b.pool = src.subPools![p.id];
    b.pool.init();
    blocks.push(b);
  }
  p.subBlocks = blocks;
}

// ---------------------------------------------------------------------------------------------------------------------------
// particle ageing and movement

/** `eps` of the life tests (DAT_008922d8 = 2^-23) */
const EPS = 1.1920928955078125e-07;

/** FUN_00456b30: collision of one particle with the source's collision list. Returns 1 on a (first) hit. */
function collide(src: Source, eng: EngineHost, p: Particle, appArg: Rec = p.app): number {
  // The appearance record the original is given (`param_3`): in the main update loop (FUN_00452300) the register holding it is only reloaded for particles with
  // life > 0, so an immortal particle (life < 0 and the immortal flag) is handed the record of the last particle that was spawned / aged (`eng.staleApp`): its size is
  // the collision radius and its spin speed is the one reset on a hit. (The sub particle loop FUN_00453410 always passes the current particle.)
  const mov = p.mov, app = appArg;
  const radius = app.f[AP.SIZE];
  const posF = mov.f.subarray(MV.POS, MV.POS + 3), velF = mov.f.subarray(MV.VEL, MV.VEL + 3);
  const nrm = new Float32Array(3), pt = new Float32Array(3);
  for (let node = src.coll; node; node = node.next) {
    nrm.fill(0); pt.fill(0);
    const hit = eng.collide ? eng.collide(node.rec, posF, velF, radius, nrm, pt) : false;
    if (mov.i[0] === 0x62627562 && 87 < mov.f[MV.POS + 1]) { p.rec.f[PT.LIFE_D] = 0; return 0; }   // "bubb...": bubbles pop above the water
    if (!hit) continue;
    if (eng.isPcol?.(node.rec)) { p.rec.f[PT.LIFE_D] = 0; return 0; }
    vecReflect(velF, 0, velF, 0, nrm, 0);
    posF[0] = pt[0]; posF[1] = pt[1]; posF[2] = pt[2];
    const bounce = mov.f[MV.BOUNCE];
    if (0 < bounce) {
      velF[0] = r24(bounce * velF[0]); velF[1] = r24(bounce * velF[1]); velF[2] = r24(bounce * velF[2]);
      const l2 = f32(f32(f32(velF[0] * velF[0]) + f32(velF[1] * velF[1])) + f32(velF[2] * velF[2]));
      if (l2 < f32(0.0015)) {
        velF[2] = 0; velF[1] = 0; velF[0] = 0; mov.f[MV.BOUNCE] = 0; app.f[AP.SCTINC] = 0;
        if (mov.u8[0x137] !== 0) mov.u8[0x137] = 0;
      }
      return 1;
    }
    app.f[AP.SCTINC] = 0;
    const was = mov.u8[0x137];
    const g = mov.f[MV.GROUND];
    velF[0] = r24(g * velF[0]); velF[1] = r24(g * velF[1]); velF[2] = r24(g * velF[2]);
    if (was !== 0) { mov.u8[0x137] = 0; return 1; }
    return 0;
  }
  return 0;
}

/** colour / size ageing of a live particle (the common block of FUN_00452300 and FUN_00453410) */
function ageParticle(p: Particle, dt: number): void {
  const a = p.app, ai = a.i, af = a.f;
  ai[AP.CR] = (ai[AP.CR] + ftol(f32(ai[AP.DR] * dt))) | 0;
  ai[AP.CG] = (ai[AP.CG] + ftol(f32(ai[AP.DG] * dt))) | 0;
  ai[AP.CB] = (ai[AP.CB] + ftol(f32(ai[AP.DB] * dt))) | 0;
  const clamp = (cur: number, end: number, d: number) => (d > 0 ? (end < cur ? end : cur) : (end > cur ? end : cur));
  const dR = ai[AP.DR], dG = ai[AP.DG], dB = ai[AP.DB];
  ai[AP.CR] = clamp(ai[AP.CR], ai[AP.ER], dR);
  ai[AP.CG] = clamp(ai[AP.CG], ai[AP.EG], dG);
  ai[AP.CB] = clamp(ai[AP.CB], ai[AP.EB], dB);
  ai[AP.CA] = (ai[AP.CA] + ftol(f32(ai[AP.DA] * dt))) | 0;
  ai[AP.CA] = clamp(ai[AP.CA], ai[AP.EA], ai[AP.DA]);
  af[AP.SIZE] = f32(f32(af[AP.DSIZE] * dt) + af[AP.SIZE]);
}

/**
 * gravity, air resistance and the position step of a particle. The main particles step the position first and collide afterwards (`FUN_00452300`); the sub
 * particles collide between the velocity and the position step (`FUN_00453410`) and re-read the velocity after the collision.
 */
function moveParticle(p: Particle, dt: number, between: (() => void) | null): void {
  const mov = p.mov, f = mov.f;
  const G = MV.GRAV, V = MV.VEL, P = MV.POS;
  const dtgx = r24(dt * f[G]);
  const gy = r24(dt * f[G + 1]), gz = r24(dt * f[G + 2]);
  const air = f[MV.AIR];
  const vxD = r24(r24(dtgx + f[V]) * air);
  f[V] = vxD;
  const vyD = r24(r24(gy + f[V + 1]) * air); f[V + 1] = vyD;
  const vzD = r24(r24(gz + f[V + 2]) * air); f[V + 2] = vzD;
  if (between) {
    between();
    f[P] = r24(r24(dt * f[V]) + f[P]);
    f[P + 1] = r24(r24(dt * f[V + 1]) + f[P + 1]);
    f[P + 2] = r24(r24(dt * f[V + 2]) + f[P + 2]);
    return;
  }
  const dy = r24(dt * f[V + 1]), dz = r24(dt * f[V + 2]);   // (x uses the register value, y / z the stored floats)
  f[P] = r24(r24(vxD * dt) + f[P]);
  f[P + 1] = r24(dy + f[P + 1]);
  f[P + 2] = r24(dz + f[P + 2]);
}

/** the particle loop at the end of FUN_00452300 */
function updateParticles(src: Source, eng: EngineHost): void {
  const dt = eng.dt, tm = src.tmpl;
  let p = tm.startIter();
  while (p) {
    const life = p.rec.f[PT.LIFE_D];
    const immortal = p.emi.u8[EM.IMMORTAL_B] !== 0;
    if (life <= EPS && !immortal) {
      if (src.subPools) {
        if (src.subPools[p.id].used === 0) { tm.remove(p); p = tm.cursor; continue; }
        updateSubBlocks(src, eng, p);
        p = tm.advance();
        continue;
      }
      tm.remove(p);
      if (src.ended && tm.count === 0) eng.giveExtra(src);
      p = tm.cursor;
      continue;
    }
    if (life > EPS) {
      eng.staleApp = p.app;                      // 0x452f16: lea edi, [ebp + 0x10]
      p.rec.f[PT.LIFE_D] = life - dt;
      ageParticle(p, dt);
    }
    moveParticle(p, dt, null);
    if (src.coll && collide(src, eng, p, eng.staleApp ?? p.app)) {
      // splash: activate `nSplash` extra sources. The original multiplies into the extra source's parent matrix POINTER, which is NULL for the engine's extra
      // sources (nothing ever sets it): it would fault. No shipped effect has both a collision list and a [SPLASH] section.
      for (let k = 0; k < src.nSplash; k++) {
        if (eng.takeExtra()) throw new Error('splash source without a parent matrix (the original faults here)');
      }
    }
    eng.addDraw(p);
    if (src.nEmits !== 0) updateSubBlocks(src, eng, p);
    p = tm.advance();
  }
}

/** FUN_00453410: the [EMITS] sub particles of a main particle: emission while it lives, ageing / movement of the existing ones */
function updateSubBlocks(src: Source, eng: EngineHost, p: Particle): void {
  const ps = eng.ps, dt = eng.dt;
  const blocks = p.subBlocks;
  if (!blocks) return;
  const life = p.rec.f[PT.LIFE_D];
  if (EPS < life && src.nEmits > 0) {
    for (let k = 0; k < src.nEmits; k++) {
      const b = blocks[k];
      let n = 0;
      if (b.rec.i[BK.COUNT_D] < b.emi.i[EM.MAX]) {
        const E = b.emi;
        const accD = f32(f32(f32(ps.rnd() * E.f[EM.DDENS]) + E.f[EM.DENS]) + b.rec.f[BK.ACC_D]);
        b.rec.f[BK.ACC_D] = accD;
        n = ftol(accD);
        const room = E.i[EM.MAX] - b.rec.i[BK.COUNT_D];
        if (!(n < room)) n = E.i[EM.MAX] - b.rec.i[BK.COUNT_D];
        b.rec.f[BK.ACC_D] = b.rec.f[BK.ACC_D] - n;
      }
      for (; n > 0; n--) {
        const q = b.allocParticle();
        if (!q) break;
        spawnSub(src, eng, p, b, q);
      }
    }
  }
  for (let k = 0; k < src.nEmits; k++) {
    const b = blocks[k];
    let q = b.startIter();
    while (q) {
      const l = f32(q.rec.f[PT.LIFE_D] - dt);
      q.rec.f[PT.LIFE_D] = l;
      if (!(l > EPS)) {
        if (q.emi.u8[EM.IMMORTAL_B] === 0) { b.remove(q); q = b.cursor; continue; }
        throw new Error('immortal sub particle: the original loops forever here');
      }
      ageParticle(q, dt);
      // gravity / air, collision, then the position step
      moveParticle(q, dt, () => { if (src.coll) collide(src, eng, q!); });
      // the parent block's own velocity inheritance is not applied here
      eng.addDraw(q);
      q = b.advance();
    }
  }
}

/** one new sub particle (the loop body of FUN_00453410) */
function spawnSub(src: Source, eng: EngineHost, parent: Particle, b: Block, q: Particle): void {
  const ps = eng.ps;
  q.app.u8.set(b.app.u8.subarray(0, APP_SIZE));
  q.emi.u8.set(b.emi.u8.subarray(0, EMI_SIZE));
  q.mov.u8.set(b.mov.u8.subarray(0, MOV_SIZE));
  const app = q.app, emi = q.emi, mov = q.mov, pf = q.rec.f;
  const dl = ftol(f32(ps.rnd() * emi.f[EM.DLIFE]));
  const lifeD = f32(f32(dl + emi.f[EM.LIFE]) * 30);
  pf[PT.LIFE_D] = lifeD;
  const li = ftol(lifeD) - 1;
  const invD = f32(1.0 / li);
  pf[PT.INVLIFE_D] = invD;
  const inv32 = pf[PT.INVLIFE_D];
  colourInit(app, invD, ps);                           // (the colour deltas use the register value, not the stored float)
  alphaInit(app, inv32, ps);
  sizeInit(app, inv32, ps);
  spriteInit(app, ps);
  if (app.u8[AP.SPIN_B] !== 0) {
    if ((ps.rand() & 1) === 0) app.f[AP.SCTINC] = ps.rnd() * app.f[AP.SCTINC];
    else app.f[AP.SCTINC] = f32(256 - f32(ps.rnd() * app.f[AP.SCTINC]));
  }
  mov.u8[0x135] = 0; mov.i[0x13c >> 2] = 0;
  matIdentity(mov.f.subarray(0xac >> 2, 0xac / 4 + 16) as Float32Array, 0);
  emitPrimitive(b, emi, mov, ps);
  const pm = parent.mov.f.subarray(0xac >> 2, 0xac / 4 + 16) as Float32Array;
  const pos = mov.f.subarray(MV.POS, MV.POS + 3), dir = mov.f.subarray(MV.DIR, MV.DIR + 3);
  const pv = parent.mov.f.subarray(MV.VEL, MV.VEL + 3);
  const tmp = new Float32Array(3);
  tmp.set(pos); transformPoint(pos, 0, pm, 0, tmp, 0);
  // + rnd * the parent's velocity, once before and once after the direction / speed step
  const x1 = f32(ps.rnd() * pv[0]);
  const y1 = f32(ps.rnd() * pv[1]), z1 = f32(ps.rnd() * pv[2]);
  pos[0] = f32(x1 + pos[0]); pos[1] = f32(y1 + pos[1]); pos[2] = f32(z1 + pos[2]);
  // (the first x product is stored as float32 in the original: `fstp [esp+0x34]`)
  tmp.set(dir); transformDir(dir, 0, pm, 0, tmp, 0);
  const vel = mov.f.subarray(MV.VEL, MV.VEL + 3);
  for (let i = 0; i < 3; i++) vel[i] = f32(f32(f32(ps.rnd() * emi.f[EM.DFORCE]) + emi.f[EM.FORCE]) * vel[i]);
  const r1 = ps.rnd(), r2 = ps.rnd(), r3 = ps.rnd();
  const xx = f32(r1 * pv[0]);
  const yy = f32(r2 * pv[1]), zz = f32(r3 * pv[2]);
  pos[0] = f32(xx + pos[0]); pos[1] = f32(yy + pos[1]); pos[2] = f32(zz + pos[2]);
  mov.f[MV.AIR] = f32(f32(ps.rnd() * mov.f[MV.DAIR]) + mov.f[MV.AIR]);
}
