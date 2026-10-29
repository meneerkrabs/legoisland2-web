// The island's small animals (Common\Zone\...\Bunny.c family, docs/re/m4/wp7-ambient.md "Animals"):
//   Bunny     ctor FUN_004b2149, table 0x8d91f0 {update FUN_004b18fb, prerender FUN_004b1ffb, destroy FUN_004b23ac, draw FUN_004b20af}  (RBT0-4)
//   Butterfly ctor FUN_004b2d44, table 0x8d9230 {update FUN_004b24f8, prerender FUN_004b2539, destroy FUN_004b2f25, draw FUN_004b2b75}  (BFS0-9, BFG0-9)
//   Swift leader ctor FUN_004b31db, table 0x8d9250 {update FUN_004b2f64, prerender/draw return 1: the leader record is not drawn by it}  (SFT9, pos 0)
//   Swift     ctor FUN_004b3a92, table 0x8d9268 {update FUN_004b35f9, prerender FUN_004b39de, draw FUN_004b39f8}  (SFT0-9; SFT9 carries both)
// Node fields keep the byte offset of the original's node block in their comments. The constructors read the record when they are attached; the port
// does that on the first update (`init`), which sees the same record state.
import { registerCtor } from '../../game/setup.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_NO_COLLIDE } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { parseMan } from '../../formats/anim.ts';
import type { Pe } from '../../formats/exe.ts';
import { ArgView } from '../args.ts';
import { tryCtx } from '../ctx.ts';
import { PI, TWO_PI, wrapPi, ftol, rand, inView, sfxAt, soundOf, recPos, ensureAnim, rebuild, setRot, setScaled, groundSnap } from './common.ts';

export const CTOR_BUNNY = 0x4b2149, CTOR_BUTTERFLY = 0x4b2d44, CTOR_SWIFT_LEADER = 0x4b31db, CTOR_SWIFT = 0x4b3a92;

/** record 16 = PEPP (`DAT_00983804 + 0x6bc` / `+0x680`) */
const PEPP = 16;

/** the globals of the family (per world) */
export class AnimalGlobals {
  /** DAT_05d582f8: bunnies startled this frame (Shift near them); five at once give the extra score once (prerender FUN_004b1ffb) */
  pokes = 0;
  /** DAT_008d9208: the three burrows {x, y, z}; y is -1 in the executable until the first bunny puts them on the terrain */
  burrows: [number, number, number][] | null = null;
  /** _DAT_008d9248 / _DAT_05d582fc: the butterfly nearest to Pepper this frame (reset by the draw hook; nothing reads it) */
  nearestD = 1e38; nearest: GameRecord | null = null;
}
const GKEY = 'ambient.animals';
export function animalGlobals(w: World): AnimalGlobals {
  let g = w.ext.get(GKEY) as AnimalGlobals | undefined;
  if (!g) { g = new AnimalGlobals(); w.ext.set(GKEY, g); }
  return g;
}

const peF32 = (pe: Pe, va: number) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, pe.u32(va), true); return b.getFloat32(0, true); };

/** 0x7e967699 (1e38): "outside the box" of FUN_004b1330 / FUN_004b23dc */
const FAR = 1e38;

abstract class Node implements BehaviourNode {
  abstract readonly kind: string;
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  abstract update(w: World, rec: GameRecord, ctrl: Controller): number;
}

// ================================================================================================ Bunny

/** DAT_008d9208: burrow table (3 x {x, y, z}) */
export const BURROWS_VA = 0x8d9208;
const BUNNY_SOUND = 0x05d58138;   // handle of sound 0x103 (FUN_004b037e)

export class BunnyNode extends Node {
  readonly kind = 'Bunny';
  readonly args: ArgView;
  private inited = false;
  home: [number, number, number] = [0, 0, 0];   // +0x14
  range = 0;           // +0x20 = arg0 * 8
  range2 = 0;          // +0x24
  quarter2 = 0;        // +0x28 = (range / 2)^2
  reach = 1;           // +0x2c
  speed = 0;           // +0x30 = arg1 * 8
  state = 2;           // +0x34 (0 sit, 1 sit 2, 2 hop, 3 to the burrow, 4 into it, 5 out of the next one, 6 startled)
  saved = 0;           // +0x38
  count = 0;           // +0x3c
  off = 0;             // +0x40 ticks out of view
  burrow = 0;          // +0x44
  bored = 0;           // +0x48
  constructor(args: ArgView) {
    super();
    this.args = args;
    const a0 = args.f32(0), a1 = args.f32(4);
    this.speed = a1 * 8;
    this.range = a0 * 8; this.range2 = this.range * this.range;
    const q = a0 * 8 * 0.5; this.quarter2 = q * q;
  }

  /** the constructor FUN_004b2149 (run on the first update) */
  private init(w: World, rec: GameRecord) {
    this.inited = true;
    this.home = [rec.x, rec.y, rec.z];
    ensureAnim(w, rec)?.start(2, 0);
    rec.ry = PI - rand(TWO_PI);
    const g = animalGlobals(w);
    if (!g.burrows) {
      const c = tryCtx(w);
      g.burrows = [0, 1, 2].map((i) => c ? [peF32(c.pe, BURROWS_VA + i * 12), peF32(c.pe, BURROWS_VA + i * 12 + 4), peF32(c.pe, BURROWS_VA + i * 12 + 8)] as [number, number, number] : [0, -1, 0]);
      // FUN_0043cd62(burrow, 40.0): the terrain below each burrow (when its y is still the executable's -1)
      if (g.burrows[0][1] < 0) for (const b of g.burrows) b[1] = w.col.terrainHeight(b[0], b[1], b[2], 40);
    }
    // FUN_00441ac0(rec, pos + (0, 8, 0), (0, -24, 0), mask 3): put the bunny on what lies below it (the probe skips the ground record)
    const hit = w.col.probe(rec, [rec.x, rec.y + 8, rec.z], [0, -24, 0], 3);
    if (hit) rec.y = hit.point[1];
    // (the constructor does not rebuild the matrix: the placed heading moves the bunny until the first turn)
  }

  /** FUN_004b1330: the vector to the home and its squared length (FAR when the signed x / z difference exceeds the range) */
  private homeDelta(rec: GameRecord, d: number[]): number {
    d[0] = this.home[0] - rec.x; d[1] = this.home[1] - rec.y; d[2] = this.home[2] - rec.z;
    if (d[0] <= this.range && d[2] <= this.range) return d[2] * d[2] + d[1] * d[1] + d[0] * d[0];
    return FAR;
  }

  /** FUN_004b13f4: wander inside the half range, else turn to the home by at most 0.25 */
  private steer(rec: GameRecord) {
    const d = [0, 0, 0];
    const d2 = this.homeDelta(rec, d);
    if (d2 <= this.quarter2) rec.ry = (0.1 - rand(0.2)) + rec.ry;
    else {
      const yaw = Math.atan2(d[0], d[2]);
      const t = wrapPi(yaw - rec.ry);
      if (Math.abs(t) >= 0.25) rec.ry += t >= 0 ? 0.25 : -0.25; else rec.ry = yaw;
    }
    rec.ry = wrapPi(rec.ry);
    rebuild(rec);
  }

  /** FUN_004b17eb: the next state when the count runs out */
  private choose(): number {
    if (this.state === 6) { this.state = this.saved; return this.state; }
    if (this.bored < 10) this.bored++;
    else if (Math.fround(rand(1)) > 0.93) {
      this.bored = 0; this.state = 3;
      this.burrow = Math.min(2, ftol(rand(3)));
      return 3;
    }
    let s: number;
    do s = ftol(rand(4)); while (s === this.state);
    if (s > 2) s = 2;
    this.state = s;
    return s;
  }

  /** FUN_004b1712 + FUN_004b1647: enter a state (count, facing, clip) */
  private enter(w: World, rec: GameRecord, s: number) {
    const g = animalGlobals(w);
    switch (s) {
      case 0: this.count = ftol(rand(2)); break;
      case 1: this.count = 0; break;
      case 2: this.count = ftol(rand(5)); this.steer(rec); break;
      case 3: {
        this.count = 100;
        const b = g.burrows![this.burrow];
        rec.ry = rec.ry - wrapPi(rec.ry - Math.atan2(b[0] - rec.x, b[2] - rec.z));    // FUN_004b15b7 (FUN_00433450)
        rebuild(rec);
        break;
      }
      case 6: this.count = 0; break;
    }
    const clip = s === 0 ? 1 : s === 1 ? 3 : s === 6 ? 4 : 2;
    rec.anim?.start(clip, 0);
  }

  update(w: World, rec: GameRecord, c: Controller): number {
    if (!this.inited) this.init(w, rec);
    const g = animalGlobals(w);
    const B = g.burrows!;
    if (c.distSq < 256) this.off = 0;
    if (this.off < 101) {
      if (this.state < 4 && (w.input.pressed & 0x40) !== 0 && c.distSq < 64) {
        this.saved = this.state;
        g.pokes++;
        this.state = 6;
        const p = w.records[PEPP] ?? rec;
        sfxAt(w, soundOf(w, BUNNY_SOUND), recPos(p));
        this.enter(w, rec, 6);
      }
      let r = 0;
      const anim = rec.anim;
      if (anim) r = anim.advance(this.state <= 1 || this.state === 6 ? 1 : 2, w.dt);
      if (r !== 0) {
        this.count--;
        if (this.count < 0) this.enter(w, rec, this.choose());
        else if (this.state === 2) this.steer(rec);
      }
      let v = -1;
      switch (this.state) {
        case 2: {
          const d = [0, 0, 0];
          const d2 = this.homeDelta(rec, d);
          if (this.range2 < d2) {
            const yaw = Math.atan2(d[0], d[2]);
            if (Math.abs(rec.ry - yaw) > 0.1) { rec.ry = yaw; rebuild(rec); }
          }
          v = this.speed;
          break;
        }
        case 3: {
          const b = B[this.burrow];
          if (Math.abs(b[0] - rec.x) < this.reach && Math.abs(b[2] - rec.z) < this.reach) { this.state = 4; rec.rx = 0.75; rebuild(rec); }
          v = this.speed * 1.5;
          break;
        }
        case 4: {
          const b = B[this.burrow];
          if (2 < b[1] - rec.y) {
            this.state = 5;
            rec.ry = wrapPi(rec.ry + PI);
            rec.rx = -0.75;
            let nb: number;
            do { nb = ftol(rand(3)); if (nb > 2) nb = 2; } while (nb === this.burrow);
            const ox = rec.x - b[0], oy = rec.y - b[1], oz = rec.z - b[2];
            this.burrow = nb;
            const n = B[nb];
            rec.setEuler(rec.rx, rec.ry, rec.rz, ox + n[0], oy + n[1], oz + n[2]);
          }
          v = this.speed * 1.5;
          break;
        }
        case 5: {
          const b = B[this.burrow];
          if (b[1] - rec.y < 0) {
            this.state = 2;
            this.count = ftol(rand(2)) + 2;
            rec.rx = 0;
            rebuild(rec);
          }
          v = this.speed;
          break;
        }
      }
      if (v > 0) {
        const k = this.speed * w.dt;
        rec.x += k * rec.fx; rec.y += k * rec.fy; rec.z += k * rec.fz;
      }
    }
    // FUN_00427014(ctrl, (0, 8, 0), (0, -16, 0), 3, 0x50): the probe pass keeps a hopping bunny on the ground
    if (this.state === 2 || this.state === 3) groundSnap(w, rec, 8, -16);
    return 1;
  }

  /** FUN_004b1ffb */
  prerender(w: World, rec: GameRecord) {
    const g = animalGlobals(w);
    if (g.pokes === 5 && (w.vars.get(0xbd) & 1) === 0) {      // SWITCH_GME_LGI_EXTRA_SCOREITEMS bit 1, SCORE_LGI / HISCORE_LGI + 1000
      w.vars.or(0xbd, 1); w.vars.add(0xa6, 1000); w.vars.add(0x12, 1000);
    }
    g.pokes = 0;
    if (inView(w, rec)) this.off = 0;
    else if (this.off <= 100) this.off++;
  }
}

// ================================================================================================ Butterfly

/** BFG butterflies share BFG0's place as their home (`memcmp(rec, "BFG", 3)`: `DAT_00983804 + 0x3a54` = record 143) */
const BFG_HOME = 143;

export class ButterflyNode extends Node {
  readonly kind = 'Butterfly';
  private inited = false;
  readonly arg0: number;
  home: [number, number, number] = [0, 0, 0];   // +0x14
  start: [number, number, number] = [0, 0, 0];  // +0x20
  range = 0; range2 = 0;   // +0x2c / +0x30
  flap = 1;                // +0x34: the wing scale (1 .. -1)
  flapState = 0;           // +0x38
  cnt = 0;                 // +0x3c
  cnt2 = 0;                // +0x40
  vy = 0.04;               // +0x44 (0x3d23d70a)
  off = 0;                 // +0x48
  follow: GameRecord | null = null;   // +0x4c
  speed = 0.08;            // +0x50 (0x3da3d70a)
  shiftT = 0;              // +0x54
  constructor(args: ArgView) {
    super();
    this.arg0 = args.f32(0);
    this.range = this.arg0 * 8; this.range2 = this.range * this.range;
  }
  private init(w: World, rec: GameRecord) {
    this.inited = true;
    this.start = [rec.x, rec.y, rec.z];
    const h = rec.name.startsWith('BFG') ? w.records[BFG_HOME] ?? rec : rec;
    this.home = [h.x, h.y, h.z];
    rec.flags |= RF_NO_COLLIDE;
  }
  /** FUN_004b24f8 */
  update(w: World, rec: GameRecord, c: Controller): number {
    if (!this.inited) this.init(w, rec);
    const g = animalGlobals(w);
    if (c.distSq < g.nearestD) { g.nearestD = c.distSq; g.nearest = rec; }
    return 1;
  }
  /** FUN_004b23dc: the vector to the home (or the followed record) and its squared XZ length (FAR outside the signed box) */
  private rel(rec: GameRecord, d: number[]): number {
    const t = this.follow;
    if (!t) { d[0] = this.home[0] - rec.x; d[1] = this.home[1] - rec.y; d[2] = this.home[2] - rec.z; }
    else { d[0] = t.x - rec.x; d[1] = t.y - rec.y; d[2] = t.z - rec.z; }
    if (d[0] <= this.range && d[2] <= this.range) return d[2] * d[2] + d[0] * d[0];
    return FAR;
  }
  /** FUN_004b2539 (the movement runs in the pre-render hook) */
  prerender(w: World, rec: GameRecord, c: Controller) {
    if (!inView(w, rec)) {
      if (this.off > 200) return;
      if (this.off === 200) {
        this.flapState = 0; this.cnt = 0; this.cnt2 = 0; this.vy = 0.02; this.flap = 1; this.speed = 0.08;
        rec.x = this.start[0]; rec.y = this.start[1]; rec.z = this.start[2];
        return;
      }
      this.off++;
    } else this.off = 0;
    if ((w.input.pressed & 0x40) === 0) this.shiftT += 1 * w.dt;
    else {
      if (this.shiftT > 4) {
        if (!this.follow && c.distSq < 64) { this.follow = w.focus; this.speed = 0.2; }
      } else { this.follow = null; this.speed = rand(1) * 0.1 + 0.005; }
      this.shiftT = 0;
    }
    if (this.flapState === 0) {
      this.flap -= 0.6667 * w.dt;
      if (this.flap <= -1) { this.flap = -1; this.flapState = 2; }
    } else if (this.flapState === 2) {
      this.flap += 0.6667 * w.dt;
      if (this.flap >= 1) { this.flap = 1; this.flapState = 0; }
    }
    const d = [0, 0, 0];
    const d2 = this.rel(rec, d);
    if (this.follow) this.off = 0;
    if (d2 <= this.range2) {
      if (!this.follow || 2.56 <= d2) {
        const old = this.cnt; this.cnt++;
        if (old > 10) {
          this.cnt = ftol(rand(10));
          rec.ry = PI - rand(TWO_PI);
          if (!this.follow) this.speed = rand(1) * 0.1 + 0.005;
        }
      } else {
        rec.ry = -Math.atan2(d[0], d[2]);
        this.cnt = ftol(rand(10));
      }
    } else {
      rec.ry = Math.atan2(d[0], d[2]);
      this.cnt = ftol(rand(10));
      this.speed = rand(1) * 0.1 + 0.2;
    }
    const y = rec.y + this.vy;
    const floor = this.follow ? this.follow.y + 0.8 : this.home[1];
    if (y < floor) { this.vy = rand(0.1) + 0.1; this.cnt2 = ftol(rand(10)); }
    else if (floor + 6 < y) { this.vy = -(rand(0.1) + 0.1); this.cnt2 = ftol(rand(10)); }
    else {
      const old = this.cnt2; this.cnt2++;
      if (old > 10) {
        this.cnt2 = ftol(rand(10));
        this.vy = 0.1 - rand(0.2);
        this.vy += this.vy >= 0 ? 0.1 : -0.1;
      }
    }
    const s = this.follow ? 2 : 1.5;
    setScaled(rec.m, rec.rx, rec.ry, rec.rz, rec.x, y, rec.z, s, s * this.flap, s);
    const k = this.speed * w.dt;
    rec.x += k * rec.m[8]; rec.y += k * rec.m[9]; rec.z += k * rec.m[10];
  }
  /** FUN_004b2b75: default draw, then the nearest-butterfly globals are reset */
  draw(w: World): number { const g = animalGlobals(w); g.nearestD = FAR; g.nearest = null; return 0; }
}

// ================================================================================================ swifts

/** the spline objects of FUN_004454e0 (Common GSMS SplineBase.cpp, vtable 0x892268): a uniform cubic B-spline through the translations of a `.man`
 *  (x negated, FUN_0043ecd0), `n` = the header's frame count (a missing last frame repeats the previous one: the loader's fread fails and keeps its locals) */
export class BSpline {
  readonly pts: Float32Array;
  readonly n: number;
  constructor(pts: Float32Array, n: number) { this.pts = pts; this.n = n; }
  static fromMan(data: Uint8Array): BSpline {
    const man = parseMan(data);
    const n = man.declaredFrames, tr = man.tracks[0];
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const f = Math.min(i, man.frameCount - 1) * 9;
      pts[i * 3] = -tr[f + 3]; pts[i * 3 + 1] = tr[f + 4]; pts[i * 3 + 2] = tr[f + 5];
    }
    return new BSpline(pts, n);
  }
  /** FUN_00445660 -> vtable[1] (0x4466f0), position part: u = n t, segment i = trunc(u) (clamped to n-1), points i-1 .. i+2 clamped */
  point(t: number, out: number[] = [0, 0, 0]): number[] {
    const n = this.n;
    const u = n * t;
    let i = ftol(u);
    const i0 = Math.max(i - 1, 0);
    if (i >= n) i = n - 1;
    const i2 = Math.min(i + 1, n - 1), i3 = Math.min(i + 2, n - 1);
    const f = u - i, f2 = f * f, f3 = f2 * f;
    const w0 = (-f3 + 3 * f2 - 3 * f + 1) / 6, w1 = (3 * f3 - 6 * f2 + 4) / 6, w2 = (-3 * f3 + 3 * f2 + 3 * f + 1) / 6, w3 = f3 / 6;
    const p = this.pts;
    for (let k = 0; k < 3; k++) out[k] = w0 * p[i0 * 3 + k] + w1 * p[i * 3 + k] + w2 * p[i2 * 3 + k] + w3 * p[i3 * 3 + k];
    return out;
  }
}

/** `\DATA\z02lgi\matanim\bat.man` (0x8d9338) / `swift.man` (0x8d9358) */
const SPLINE_FILES = ['MatAnim/bat.man', 'MatAnim/swift.man'];
const SWIFT_SOUND = 0x05d581e8;   // handle of sound 0xfd

export class SwiftLeaderNode extends Node {
  readonly kind = 'SwiftLeader';
  readonly type: number;     // arg +0: 0 bat.man, 1 swift.man
  spline: BSpline | null = null;   // +0x14
  fast: number;              // +0x18
  slow: number;              // +0x1c
  mode: number;              // +0x20 (0: fly the spline for ever; else perch 500 ticks between laps: the bats)
  clipA: number;             // +0x24
  clipB: number;             // +0x28
  turn: number;              // +0x2c (the followers' turn rate)
  t = 3;                     // +0x30
  perch = 0;                 // +0x34
  state = 0;                 // +0x38 (0 start, 1 perched, 2 fly home, 3 take off, 4 follow)
  homing = 10;               // +0x3c
  /** +0x40: the spline matrix; only its translation (+0x70 .. +0x78) is used: the followers' target */
  target: [number, number, number] = [0, 0, 0];
  private inited = false;
  constructor(args: ArgView) {
    super();
    this.type = args.i32(0);
    this.fast = args.f32(4); this.slow = args.f32(8); this.mode = args.i32(12);
    this.clipA = args.i32(16); this.clipB = args.i32(20); this.turn = args.f32(24);
  }
  private init(w: World) {
    this.inited = true;
    const c = tryCtx(w);
    const f = SPLINE_FILES[this.type];
    const e = f && c ? c.archive.find(f) : undefined;
    if (e && c) { try { this.spline = BSpline.fromMan(c.archive.read(e)); } catch { this.spline = null; } }
    this.eval(0, false);
  }
  private eval(t: number, shift = true) {
    if (!this.spline) return;
    const p = this.spline.point(t);
    this.target = [p[0] - (shift ? 16 : 0), p[1], p[2]];
  }
  /** FUN_004b2f64 */
  update(w: World, rec: GameRecord): number {
    if (!this.inited) this.init(w);
    sfxAt(w, soundOf(w, SWIFT_SOUND), recPos(rec));
    if (this.mode === 0) {
      if (this.state !== 4 && w.frame === this.stamp) this.state = 4;
      this.t += this.slow * w.dt;
    } else {
      if (this.perch < 500) {
        this.perch += 1 * w.dt;
        if (this.homing === 0) this.state = 1; else this.homing = 0;
        return 2;
      }
      if (this.state === 1) { this.state = 3; this.t = 0; } else this.state = 4;
      if (0.5 <= this.t && this.t <= 0.6) this.t += this.slow * w.dt; else this.t += this.fast * w.dt;
    }
    if (1 <= this.t) {
      if (this.mode === 0) this.t = 0;
      else { this.perch = 0; this.state = 2; this.homing = 0; }
    }
    this.eval(this.t);
    return 2;
  }
  /** prerender FUN_004b3149 / draw FUN_004b3163 return 1: the leader's record is not drawn */
  draw(): number { return 1; }
}

/** FUN_004b336d: turn (yaw and pitch, at most dist * turn * dt) towards `target`; 0 when within `min` (in units / 8) */
function steerTo(w: World, rec: GameRecord, target: readonly number[], min: number, turn: number): number {
  const dx = target[0] - rec.x, dy = target[1] - rec.y, dz = target[2] - rec.z;
  const dist = Math.sqrt(dz * dz + dy * dy + dx * dx) * 0.125;
  if (!(min < dist)) return 0;
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(-dy, Math.sqrt(dx * dx + dz * dz));
  const step = dist * turn * w.dt;
  const a = wrapPi(yaw - rec.ry), b = wrapPi(pitch - rec.rx);
  if (step <= Math.abs(a)) rec.ry += a >= 0 ? step : -step; else rec.ry = yaw;
  if (step <= Math.abs(b)) rec.rx += b >= 0 ? step : -step; else rec.rx = pitch;
  setRot(rec.m, rec.rx, rec.ry, rec.rz);
  return 1;
}

export class SwiftNode extends Node {
  readonly kind = 'Swift';
  speed = 2;          // +0x14
  approach = 1;       // +0x18
  start: [number, number, number] = [0, 0, 0];   // +0x1c
  readonly leaderIndex: number;   // +0x28 (record pointer of the argument)
  cnt = 0;            // +0x2c (short)
  perched = 0;        // +0x2e (short)
  dyaw = 0;           // +0x30
  dpitch = 0;         // +0x34
  timer: number;      // +0x38
  private inited = false;
  constructor(args: ArgView) {
    super();
    this.leaderIndex = args.recIndex(0);
    this.timer = rand(200);
  }
  private leader(w: World): SwiftLeaderNode | null {
    const r = w.records[this.leaderIndex];
    const n = r?.ctrl?.nodes[0];      // FUN_004239d9(ctrl): the head node of the leader's controller
    return n instanceof SwiftLeaderNode ? n : null;
  }
  /** FUN_004b35f9 */
  update(w: World, rec: GameRecord): number {
    if (!this.inited) { this.inited = true; this.start = [rec.x, rec.y, rec.z]; ensureAnim(w, rec); }
    const L = this.leader(w);
    if (!L) return 1;
    const anim = rec.anim;
    let moving = false;
    let s = L.state;
    if (s === 2 && this.perched === 0) {
      if (steerTo(w, rec, this.start, 0.25, L.turn) === 0) {
        rec.rx = 0;
        rec.setEuler(rec.rx, rec.ry, rec.rz, this.start[0], this.start[1], this.start[2]);
        this.perched = 1;
        anim?.start(L.clipB, 0);
        this.timer = 0;
      } else { moving = true; L.homing++; }
      s = -1;
    } else if (s === 2) s = 1;
    switch (s) {
      case 0: anim?.start(L.mode === 0 ? L.clipA : L.clipB, 0); break;
      case 1:
        if (0 <= this.timer) this.timer -= 1 * w.dt;
        else if (anim && anim.clipData) {
          // FUN_0043b874(anim, 1.0, 0): advance without wrapping, 2 at the end
          anim.frame += 1 * w.dt;
          if (anim.frameCount < anim.frame) { anim.frame = anim.frameCount; anim.seek(0); this.timer = rand(200); }
        }
        break;
      case 3:
        anim?.start(L.clipA, 0);
        rec.rx = 1.5707963705062866;
        setRot(rec.m, rec.rx, rec.ry, rec.rz);
        moving = true;
        this.perched = 0;
        break;
      case 4:
        if (steerTo(w, rec, L.target, this.approach, L.turn) === 0) {
          if (this.cnt === 0) {
            this.cnt = 1;
            this.dpitch = 0.39269909262657166 - rand(0.7853981852531433);
            this.dyaw = 0.39269909262657166 - rand(0.7853981852531433);
          } else {
            const old = this.cnt; this.cnt++;
            if (old < 20) { rec.rx += this.dpitch; rec.ry += this.dyaw; setRot(rec.m, rec.rx, rec.ry, rec.rz); }
          }
        } else this.cnt = 0;
        moving = true;
        break;
    }
    if (moving) {
      anim?.advance(2, w.dt);
      const k = this.speed * w.dt;
      rec.x += k * rec.fx; rec.y += k * rec.fy; rec.z += k * rec.fz;
    }
    return 1;
  }
}

registerCtor(CTOR_BUNNY, (a: Attach) => new BunnyNode(ArgView.of(a)));
registerCtor(CTOR_BUTTERFLY, (a: Attach) => new ButterflyNode(ArgView.of(a)));
registerCtor(CTOR_SWIFT_LEADER, (a: Attach) => new SwiftLeaderNode(ArgView.of(a)));
registerCtor(CTOR_SWIFT, (a: Attach) => new SwiftNode(ArgView.of(a)));
