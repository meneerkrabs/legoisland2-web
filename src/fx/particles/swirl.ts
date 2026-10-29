// CParticleSwirl (CParticleSwirl.cpp, swirl lists `.swl`): rings of sprites circling a point. FUN_00451600 (init), FUN_004517f0 (update), FUN_00451ef0 (place a
// sprite), FUN_00451fa0 (ring matrices), FUN_00451f60 (set the parent matrix), FUN_00451760 (re-list while paused).
//
// Per ring (0x130 bytes, byte offsets of the original): +0 app record, +4 points, +8 direction (+1 / -1), +0xc speed, +0x10 radius, +0x14 yaw offset,
// +0x18 / +0x1c sWobble / dWobble, +0x20 wobble phase, +0x24 / +0x30 two copies of the Euler angles, +0x3c wobble offset (added to the x angle), +0x6c local matrix,
// +0xac final matrix (local * parent), +0xec parent matrix (a COPY made by `setMatrix`), +0x12c the particle pool (one particle per point).
import { Rec } from './core.ts';
import type { SwirlDef } from './defs.ts';
import { MV, PT, APP_SIZE } from './layout.ts';
import { matEuler, matIdentity, matMul, transformPoint } from './mat.ts';
import { Pool } from './pool.ts';
import { alphaInit, colourInit, sizeInit, spriteInit, type EngineHost, type MatrixSource } from './source.ts';

const f32 = Math.fround;
const TWO_PI32 = f32(6.2831855);
const RING = 0x130;

class Ring {
  readonly rec = new Rec(RING);
  app: Rec | null = null;
  pool!: Pool;
  readonly f: Float32Array; readonly i: Int32Array;
  constructor() { this.f = this.rec.f; this.i = this.rec.i; }
  /** a float32 view of a matrix at byte offset `o` */
  mat(o: number): Float32Array { return this.f.subarray(o >> 2, (o >> 2) + 16); }
}

export class Swirl {
  /** +0 / +1 / +2 (spawned) */
  active = false; started = false; ended = false;
  /** +4: gate variable, +8: value, +0xa: mask (shorts) */
  gateVar = 0; gateValue = 0; gateMask = 0;
  name = '';
  rings: Ring[] = [];
  /** FUN_00451f60: copy the matrix into every ring (by value) */
  setMatrix(m: MatrixSource, _identity: Float32Array): void {
    const a = typeof m === 'function' ? m() : m;
    for (const r of this.rings) r.mat(0xec).set(a.subarray(0, 16));
  }
  /** FUN_00451760: the paused frame: re-run the ring placement and list the points */
  relist(eng: EngineHost): void {
    for (let k = 0; k < this.rings.length; k++) {
      if (((this.gateMask << 16 >> 16) & eng.getVar(this.gateVar)) === (this.gateValue << 16 >> 16)) {
        ringMatrices(this);
        for (const p of this.rings[k].pool.parts) eng.addDraw(p);
      }
    }
  }
}

/** FUN_00451600(name, pos, rot) */
export function initSwirl(s: Swirl, def: SwirlDef | null, pos: ArrayLike<number>, rot: ArrayLike<number>): void {
  if (!def) return;
  s.name = def.name;
  s.active = true; s.started = false; s.ended = false;
  s.rings = [];
  const px = f32(pos[0]), py = f32(pos[1]), pz = f32(pos[2]);
  for (const d of def.rings) {
    const r = new Ring();
    r.app = d.appRec;
    r.i[1] = d.points; r.i[2] = d.direction; r.f[3] = d.speed; r.f[4] = d.radius; r.f[5] = d.yawOffset; r.f[6] = d.wobbleS; r.f[7] = d.wobbleD;
    r.pool = new Pool(d.points);
    for (let k = 0; k < 3; k++) { r.f[(0x24 >> 2) + k] = f32(rot[k]); r.f[(0x30 >> 2) + k] = f32(rot[k]); }
    matEuler(r.f, 0x6c >> 2, f32(rot[0]), f32(rot[1]), f32(rot[2]), px, py, pz);
    matIdentity(r.f, 0xec >> 2);
    const parent = r.mat(0xec).slice();
    matMul(r.f, 0xac >> 2, parent, 0, r.f, 0x6c >> 2);
    s.rings.push(r);
  }
}

/** FUN_00451fa0: advance the wobble of every ring and rebuild its matrices */
function ringMatrices(s: Swirl): void {
  for (const r of s.rings) {
    const f = r.f;
    f[0x24 >> 2] = f[0x30 >> 2] + f[0x3c >> 2];
    const t = f[0x34 >> 2] + f[0x40 >> 2];
    f[0x28 >> 2] = t;
    const u = f[0x38 >> 2] + f[0x44 >> 2];
    f[0x2c >> 2] = u;
    f[0x3c >> 2] = Math.sin(f[0x20 >> 2]) * f[0x18 >> 2];
    f[0x20 >> 2] = f[0x1c >> 2] + f[0x20 >> 2];
    // position (R + 0x9c ..) is never written: zero
    matEuler(f, 0x6c >> 2, f[0x24 >> 2], f32(t), f32(u), f[0x9c >> 2], f[0xa0 >> 2], f[0xa4 >> 2]);
    matMul(f, 0xac >> 2, r.mat(0xec).slice(), 0, f, 0x6c >> 2);
  }
}

/** FUN_00451ef0(p, matrix): place one sprite on its circle and advance its angle */
function placePoint(p: { rec: Rec; mov: Rec }, m: Float32Array, dt: number): void {
  const f = p.rec.f, a = f[0x154 >> 2], r = f[0x14c >> 2];
  const v = new Float32Array([Math.sin(a) * r, Math.cos(a) * r, 0]);
  transformPoint(p.mov.f.subarray(MV.POS, MV.POS + 3) as Float32Array, 0, m, 0, v, 0);
  f[0x154 >> 2] = f[0x158 >> 2] * dt + f[0x154 >> 2];
}

/** FUN_004517f0 */
export function updateSwirl(s: Swirl, eng: EngineHost): void {
  const ps = eng.ps;
  if (((s.gateMask << 16 >> 16) & eng.getVar(s.gateVar)) !== (s.gateValue << 16 >> 16)) return;
  if (!s.ended) {
    for (const r of s.rings) {
      const step = f32(TWO_PI32 / r.i[1]);
      const yaw = r.f[5];
      for (let j = 0; j < r.i[1]; j++) {
        const p = r.pool.alloc()!;
        if (r.app) p.app.u8.set(r.app.u8.subarray(0, APP_SIZE));
        matIdentity(p.mov.f.subarray(0xac >> 2, 0xac / 4 + 16) as Float32Array, 0);
        const life = ((ps.rnd() * p.emi.f[0x5c >> 2]) + p.emi.f[0x58 >> 2]) * 30;
        p.rec.f[PT.LIFE_D] = life;
        const inv = p.emi.u8[0x54] === 0 ? 1.0 / (life + 1.0) : 1.0;
        p.rec.f[PT.INVLIFE_D] = inv;
        colourInit(p.app, inv, ps);
        alphaInit(p.app, p.rec.f[PT.INVLIFE_D], ps);
        sizeInit(p.app, p.rec.f[PT.INVLIFE_D], ps);
        spriteInit(p.app, ps);
        p.mov.u8[0x137] = 1;
        p.rec.f[0x14c >> 2] = r.f[4];
        p.rec.f[0x154 >> 2] = j * step + yaw;
        p.rec.f[0x158 >> 2] = r.i[2] * r.f[3];
      }
    }
    s.ended = true;
  }
  for (const r of s.rings) {
    ringMatrices(s);
    const m = r.mat(0xac);
    for (const p of r.pool.parts.slice(0, r.i[1])) { placePoint(p, m, eng.dt); eng.addDraw(p); }
  }
}
