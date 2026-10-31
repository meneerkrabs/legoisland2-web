// seabed.c of the engine (Common\S...\seabed.c): the three scene nodes of the zone records SEAB (the sea bed), SSEA (the sea plane) and SSKY (the sky dome), attached by every island era and by the hubs.
//   SEAB  ctor FUN_004266ca  vtable 0x8addd0 {update FUN_00426633 (1), pre-render FUN_00426646 (1), destroy FUN_00426759, draw FUN_00426659 (the default draw), loader FUN_004266a2, saver FUN_00426684}
//   SSEA  ctor FUN_00426da4  vtable 0x8ade00 {update FUN_00426a13, pre-render FUN_00426a26, destroy FUN_00426e55, draw FUN_00426a43, loader FUN_00426d7c, saver FUN_00426d5e}
//   SSKY  ctor FUN_00426915  vtable 0x8adde8 {update FUN_004267ac, pre-render FUN_004267bf, destroy FUN_004269ea, draw FUN_004267d2, loader FUN_004268ed, saver FUN_004268cf}
// The nodes' update / pre-render hooks do nothing (they return 1); all of their work is in the DRAW hooks, which the original runs once per drawn frame (= once per sim step of the port's 60 Hz loop) and which move the record's matrix: the port's renderer
// (src/game/render.ts) calls `SkyNode.place` / `SeaNode.place` ONCE PER SIM STEP for the records of the zone that carry them, with the step's camera eye and `SeabedView.dt` = world.dt (the hooks multiply their angle / phase steps by DAT_008b1718), and draws the returned matrix. The node owns the state the original keeps
// in the node struct (the sky's angle, the sea plane's anchor point), which is what the save game holds; the sea's two orbit phases are engine globals (DAT_009da860 / 864) and live in the node of the world.
import { registerCtor } from '../../game/setup.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { RF_NO_COLLIDE } from '../../game/record.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { ad, sb, ml, fr, fromBits } from '../../zones/common/f32.ts';
import { BlockIn, BlockOut, CDF } from '../blockio.ts';

export const CTOR_SEABED = 0x4266ca, CTOR_SEA = 0x426da4, CTOR_SKY = 0x426915;

/** the record's frustum flag (FUN_004267d2 / FUN_00426a43 set it at every draw) */
const FRUSTUM = 1;
/** 0x8920e8: the sky dome's horizontal radius = the engine's fog distance * 1.2 (FUN_00442dc0) */
const SKY_RADIUS = fromBits(0x3f99999a);
/** 0x42c80000: the dome is 100 units higher than the camera; 0x8920c8: the spin per tick; 0x892098 / 0x89207c: the angle's wrap limits -pi / pi (floats), 0x892094: 2 pi */
const SKY_HEIGHT = 100, SKY_SPIN = fromBits(0x39e4c338), NEG_PI = fromBits(0xc0490fdb), POS_PI = fromBits(0x40490fdb), TWO_PI = fromBits(0x40c90fdb);
/** 0x8920d0 (2.5): the plane's scale in ranges; 0x8920cc (0.1): the snap step in scales; 0x8920d8 / 0x8920d4: the two orbit phase speeds per tick; 0x892080: the orbit amplitude 4; 0x892028: the plane starts 2 below the sea level */
const SEA_SCALE = 2.5, SEA_SNAP = fromBits(0x3dcccccd), SEA_PHASE_A = fromBits(0x3c8efa03), SEA_PHASE_B = fromBits(0x3c3f96b2), SEA_ORBIT = 4;

/** the engine's per frame values the draw hooks read: FUN_00443cb0 (far plane), FUN_00442d60 (fog on, fog end as an integer), FUN_0040977c (the fog distance the dome is scaled by), the sea level DAT_009da858, the frame time DAT_008b1718 (ticks) */
export interface SeabedView {
  far: number; fogOn: boolean; fogEnd: number; domeBase: number; seaLevel: number; dt: number;
}

abstract class SceneNode implements BehaviourNode {
  abstract readonly kind: string;
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** the update (and the pre-render) hook of all three: returns 1, nothing else */
  update(_w: World, _rec: GameRecord, _c: Controller): number { return NODE_STOP; }
}

// ================================================================================================ SEAB

export class SeabedNode extends SceneNode {
  readonly kind = 'Seabed';
  /** node +0x18: set to 0 by the constructor, never written afterwards (the only saved word) */
  f18 = 0;
  /** Save block = node +0x18 (saver FUN_00426684 returns 4 and points at node + 0x18, loader FUN_004266a2 = 4 byte memcpy back) */
  saveBlock(): Uint8Array { return new BlockOut(4).f32(0, this.f18).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.f18 = new BlockIn(data).f32(0); }
}

// ================================================================================================ SSKY

export class SkyNode extends SceneNode {
  readonly kind = 'Sky';
  /** node +0x14: the constructor's second argument != 0 (the island: the dome turns) */
  readonly spin: boolean;
  /** node +0x18: the dome's turn angle */
  angle = 0;
  constructor(spin: boolean) { super(); this.spin = spin; }
  /** FUN_00426915: the record is not solid (flag 0x10) */
  ctorInit(_w: World, rec: GameRecord): void { rec.flags |= RF_NO_COLLIDE; }
  /** Save block = node +0x18 (saver FUN_004268cf returns 4 and points at node + 0x18, loader FUN_004268ed = 4 byte memcpy back): the f32 angle */
  saveBlock(): Uint8Array { return new BlockOut(4).f32(0, this.angle).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.angle = new BlockIn(data).f32(0); }

  /** the dome's matrix for an eye position and the dome radius (FUN_0043a742: rotation about y by the angle, the record's own y, scale (r, eye y + 100, r)) */
  private matrixAt(rec: GameRecord, eye: ArrayLike<number>, r: number): Float32Array {
    return buildMatrix(0, this.angle, 0, eye[0], rec.m[13], eye[2], r, ad(eye[1], SKY_HEIGHT), r);
  }

  /**
   * FUN_004267d2, the draw hook: the record gets the dome's matrix for the CURRENT camera eye `eye` (DAT_009da5e8; that is what the save game holds) and its frustum flag, the angle then turns by 0.000436 x
   * the frame time and wraps at +-pi. Returns the matrix to draw, built with the angle before the turn (the same as the record's). `drawEye` is only different from `eye` when a caller still interpolates (the loops run with alpha 1: they pass `eye` twice).
   */
  place(rec: GameRecord, eye: ArrayLike<number>, drawEye: ArrayLike<number>, v: SeabedView): Float32Array {
    rec.flags |= FRUSTUM;
    const r = ml(v.domeBase, SKY_RADIUS);
    const mine = this.matrixAt(rec, eye, r);
    const out = drawEye === eye ? mine : this.matrixAt(rec, drawEye, r);
    rec.m.set(mine);
    if (this.spin) {
      this.angle = ad(ml(SKY_SPIN, fr(v.dt)), this.angle);
      if (NEG_PI <= this.angle) { if (POS_PI < this.angle) this.angle = sb(this.angle, TWO_PI); } else this.angle = ad(this.angle, TWO_PI);
    }
    return out;
  }
}

// ================================================================================================ SSEA

export class SeaNode extends SceneNode {
  readonly kind = 'Sea';
  /** node +0x18 / +0x1c / +0x20: the anchor point the plane follows the camera from (the camera's position at the first draw; x and z move in snap steps, y stays), +0x24: the anchor is set */
  anchor: [number, number, number] = [CDF, CDF, CDF];   // (0xCDCDCDCD until the first draw sets them)
  anchored = 0;
  /** DAT_009da860 / DAT_009da864: the orbit phases (engine globals, not saved) */
  phaseA = 0; phaseB = 0;
  /** FUN_00426da4: the record is not solid (flag 0x10) */
  ctorInit(_w: World, rec: GameRecord): void { rec.flags |= RF_NO_COLLIDE; }
  /** Save block = node +0x18 .. +0x28 (saver FUN_00426d5e returns 0x10 and points at node + 0x18, loader FUN_00426d7c = 16 byte memcpy back): f32 anchor x, y, z and the i32 flag */
  saveBlock(): Uint8Array { return new BlockOut(0x10).f32(0, this.anchor[0]).f32(4, this.anchor[1]).f32(8, this.anchor[2]).i32(0xc, this.anchored).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.anchor = [b.f32(0), b.f32(4), b.f32(8)]; this.anchored = b.i32(0xc);
  }

  /** the plane's matrix for the anchor, the orbit offset and the plane's scale (FUN_0043a742 (0, 0, 0, x, y, z, s, 1, s)) */
  private matrixAt(ax: number, az: number, ox: number, oz: number, v: SeabedView, scale: number): Float32Array {
    return buildMatrix(0, 0, 0, ad(ox, ax), sb(v.seaLevel, 2), ad(oz, az), scale, 1, scale);
  }

  /**
   * FUN_00426a43, the draw hook: the anchor is set at the first draw; the orbit phases advance; the plane's range is the far plane, or the fog end (an integer in the engine) when the fog is on and nearer; the anchor
   * follows the CURRENT camera eye `eye` in steps (x then z, up to 200 rounds); the record gets the matrix (its y is the sea level) and the frustum flag. Returns the matrix to draw (`drawEye` = `eye` since the loops run with alpha 1).
   */
  place(rec: GameRecord, eye: ArrayLike<number>, drawEye: ArrayLike<number>, v: SeabedView): Float32Array {
    if (this.anchored === 0) { this.anchor = [eye[0], eye[1], eye[2]]; this.anchored = 1; }
    rec.flags |= FRUSTUM;
    const far = fr(v.far), fogEnd = fr(v.fogEnd >>> 0);
    const range = far < fogEnd || !v.fogOn ? ml(far, 1) : fogEnd;
    const dt = fr(v.dt);
    this.phaseA = ad(ml(SEA_PHASE_A, dt), this.phaseA);
    this.phaseB = ad(ml(SEA_PHASE_B, dt), this.phaseB);
    // ((cos + (float)sin) * 4): the sine / cosine stay doubles until the sum
    const ox = ml(ad(Math.cos(this.phaseB), fr(Math.sin(this.phaseA))), SEA_ORBIT);
    const oz = ml(ad(Math.sin(this.phaseB), fr(Math.cos(this.phaseA))), SEA_ORBIT);
    let scale = 0;
    for (let n = 0; ;) {
      let moved = false;
      n++;
      const dx = sb(eye[0], this.anchor[0]), dz = sb(eye[2], this.anchor[2]);
      scale = ml(range, SEA_SCALE);
      const step = ml(scale, SEA_SNAP);
      if (step < Math.abs(dx)) { this.anchor[0] = dx <= 0 ? sb(this.anchor[0], step) : ad(step, this.anchor[0]); moved = true; }
      if (step < Math.abs(dz)) { this.anchor[2] = dz <= 0 ? sb(this.anchor[2], step) : ad(step, this.anchor[2]); moved = true; }
      if (!(moved && n < 200)) break;
    }
    const mine = this.matrixAt(this.anchor[0], this.anchor[2], ox, oz, v, scale);
    mine[13] = fr(v.seaLevel);       // *(record + 0x40) = DAT_009da858
    rec.m.set(mine);
    if (drawEye === eye) return mine;
    // the frame's interpolated eye: the anchor follows it the same way (a copy: the node's own anchor is the original's)
    const a = [this.anchor[0], this.anchor[2]];
    for (let n = 0; n < 200; n++) {
      let moved = false;
      const step = ml(ml(range, SEA_SCALE), SEA_SNAP);
      const dx = sb(drawEye[0], a[0]), dz = sb(drawEye[2], a[1]);
      if (step < Math.abs(dx)) { a[0] = dx <= 0 ? sb(a[0], step) : ad(step, a[0]); moved = true; }
      if (step < Math.abs(dz)) { a[1] = dz <= 0 ? sb(a[1], step) : ad(step, a[1]); moved = true; }
      if (!moved) break;
    }
    const out = this.matrixAt(a[0], a[1], ox, oz, v, scale);
    out[13] = fr(v.seaLevel);
    return out;
  }
}

registerCtor(CTOR_SEABED, () => new SeabedNode());
registerCtor(CTOR_SEA, () => new SeaNode());
registerCtor(CTOR_SKY, (at: Attach) => new SkyNode((at.arg ?? 0) !== 0));
