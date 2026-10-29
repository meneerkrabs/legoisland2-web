// The zone's passive and simple active objects: the swinging anchor (AnchBeh FUN_005be817), the spinning page (PageBeh FUN_005bf9c6), the five bricks (BrkBeh FUN_005bfcf1),
// the cannon (CannBeh FUN_005bcedf) with its ten balls (CBallBeh FUN_005bc8a0), the clam (ClamBeh FUN_005bdbfa + FUN_005bd9c0), the octopus (OctoBeh FUN_005be2c8) and the
// pirates (PiroBeh FUN_005bd470). Constructors: FUN_005be9f0, 005bfad5, 005c01e8, 005bd2b1, 005bcd17, 005be08a, 005be5e0, 005bd8b4.
import type { Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED, RF_NO_COLLIDE } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { C, CLIP, DIVER, REC, f32bits } from './consts.ts';
import { BkdNode } from './env.ts';
import type { Env } from './env.ts';
import { angleDelta, normalize3, rotateShape, wrapAngle } from './math.ts';
import { bounce, castQuad, swingPush } from './physics.ts';
import { setEuler } from './matrix.ts';

import { fr, ad, sb, ml, dv, sq } from '../common/f32.ts';
const PLANE_Z = DIVER.PLANE_Z;

/** the matrix of a record from its three angles and its place (FUN_0043a5e4(rec + 0xc, rx, ry, rz, x, y, z)) */
const rebuild = (rec: GameRecord, rx: number, ry: number, rz: number) => setEuler(rec, rx, ry, rz, rec.x, rec.y, rec.z);

// ------------------------------------------------------------------------------------------------------------------------------------------------ anchor

/** FUN_005be9f0 / FUN_005be817: the anchor swings like a pendulum between -0.43633 and +0.43633 rad (the speed follows 1 - |angle| / limit + 0.5, cubed) */
export class AnchorNode extends BkdNode {
  readonly kind = 'AnchBeh';
  /** node +0x18: the current angular speed (the push of FUN_005be690 uses it) */
  speed = 0;
  /** node +0x1c: the speed at mid-swing (0xbedf66a5), its sign flips at the limits */
  base = f32bits(0xbedf66a5);

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c; void w;
    const dt = this.env.clock.dt;
    let rz = rec.rz;
    let f = ad(sb(C.ONE, dv(Math.abs(rz), C.ANCHOR_HI)), C.HALF);
    if (C.ONE < f) f = 1;
    const f3 = ml(ml(f, f), f);                  // asm 0x5be898: f * f * f is stored as float32 first (fstp [ebp - 8]), then multiplied by the node's value
    this.speed = ml(this.base, f3);
    rz = ad(ml(this.speed, dt), rz);
    if (C.ZERO < this.base) { if (C.ANCHOR_HI < rz) this.base = -this.base; } else if (rz < C.ANCHOR_LO) this.base = -this.base;
    rec.rz = rz;
    rebuild(rec, 0, 0, rz);
    return NODE_STOP;
  }

  /** FUN_005be690(anchor, pos, &out): the push the swinging arm gives a body at `pos` */
  push(rec: GameRecord, pos: ArrayLike<number>): [number, number, number] {
    return swingPush([rec.x, rec.y, rec.z], rec.rz, this.speed, pos);
  }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ page

/** FUN_005bfad5 / FUN_005bf9c6: the page turns about y at 1.919852 rad/s, at z = 10 */
export class PageNode extends BkdNode {
  readonly kind = 'PageBeh';
  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c; void w;
    rec.ry = wrapAngle(ad(ml(C.OCTO_ANGLE, this.env.clock.dt), rec.ry));
    setEuler(rec, 0, rec.ry, 0, rec.x, rec.y, PLANE_Z);
    return NODE_STOP;
  }
  /** FUN_005bf9b0: taken (hidden) */
  take(rec: GameRecord) { rec.hide(); }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ bricks

/** FUN_005c0351: the brick's collision quad (x +-1.6, y 0.1 .. 0.9, z 10) */
export const BRICK_SHAPE = [[f32bits(0x3fcccccd), f32bits(0x3f666666), 10], [-f32bits(0x3fcccccd), f32bits(0x3f666666), 10], [-f32bits(0x3fcccccd), f32bits(0x3dcccccd), 10], [f32bits(0x3fcccccd), f32bits(0x3dcccccd), 10]];
/** the BALL / cannon-ball quad (FUN_005bcdda): 1.6 x 1.6 */
export const BALL_SHAPE = [[f32bits(0x3f4ccccd), f32bits(0x3f4ccccd), 10], [-f32bits(0x3f4ccccd), f32bits(0x3f4ccccd), 10], [-f32bits(0x3f4ccccd), -f32bits(0x3f4ccccd), 10], [f32bits(0x3f4ccccd), -f32bits(0x3f4ccccd), 10]];

export class BrickNode extends BkdNode {
  readonly kind = 'BrkBeh';
  /** node +0xa0: falling / bouncing after a drop */
  active = false;
  /** node +0xa4: seconds since the drop (10 at the start so the first pickup is allowed; a brick can be picked up again after 4 s) */
  age = 10;
  /** node +0x88 .. +0x9c */
  b = { vx: 0, vy: 0, vz: 0, angVel: 0 };
  /** node +0x7c: the place before the last move */
  last: [number, number, number] = [0, 0, 0];
  private list: GameRecord[] = [];
  private solid = new Set<GameRecord>();
  private anchor: GameRecord | null = null;

  /** FUN_005c01e8: shown and solid; the obstacle list of FUN_005bfcf1 (DAT_05d5ab94: land, anchor, the five bricks, the octopus's parts) */
  bind(env: Env, rec: GameRecord) {
    super.bind(env, rec);
    rec.flags |= RF_ENABLED; rec.flags &= ~RF_NO_COLLIDE;
    const R = env.records;
    this.anchor = R[REC.ANCHOR];
    this.list = [R[REC.LAND], R[REC.ANCHOR], ...REC.BRICKS.map((i) => R[i]), R[REC.OCTC], R[REC.OCTH]];
    this.solid = new Set([R[REC.LAND], ...REC.BRICKS.map((i) => R[i]), R[REC.OCTC], R[REC.OCTH]]);
  }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c;
    const dt = this.env.clock.dt;
    this.age = ad(dt, this.age);
    if (this.active) {
      const pts = rotateShape(BRICK_SHAPE, 4, ad(rec.rz, C.HALF_PI));
      for (const p of pts) { p[0] = ad(p[0], rec.x); p[1] = ad(p[1], rec.y); }
      const q = castQuad(w, pts, 4, rec, this.list);
      let hitSolid = false, hitAnchor = false;
      for (const h of q.hits) { if (this.solid.has(h)) hitSolid = true; if (h === this.anchor) hitAnchor = true; }
      this.b.vy = ad(ml(C.MINUS_TWO, dt), this.b.vy);
      if (hitAnchor) {
        const a = this.env.nodeOf<AnchorNode>(this.anchor!);
        const v = a.push(this.anchor!, [rec.x, rec.y, rec.z]);
        this.b.vx = v[0]; this.b.vy = v[1]; this.b.vz = v[2];
      }
      if (hitSolid) {
        rec.x = this.last[0]; rec.y = this.last[1]; rec.z = this.last[2];
        if (bounce(this.b, [rec.x, rec.y, rec.z], q.normal, q.point)) this.active = false;
      }
      this.last = [rec.x, rec.y, rec.z];
      rec.x = ad(ml(this.b.vx, dt), rec.x);
      rec.y = ad(ml(this.b.vy, dt), rec.y);
      rec.rz = ad(ml(this.b.angVel, dt), rec.rz);
    }
    rebuild(rec, rec.rx, rec.ry, rec.rz);
    return NODE_STOP;
  }

  /** FUN_005bfb7b: a pickup is allowed once 4 s have passed since the drop; the brick is then taken (inactive, hidden, non-solid) */
  tryPickup(rec: GameRecord): boolean {
    const ok = C.FOUR <= this.age;
    if (ok) { this.active = false; rec.flags &= ~RF_ENABLED; rec.flags |= RF_NO_COLLIDE; }
    return ok;
  }

  /** FUN_005bfbe1(brick, pos): put the brick back into the water at (x, y): shown, solid, falling, age 0 */
  drop(rec: GameRecord, pos: ArrayLike<number>) {
    this.active = true; this.age = 0;
    rec.flags |= RF_ENABLED; rec.flags &= ~RF_NO_COLLIDE;
    rec.x = pos[0]; rec.y = pos[1]; rec.z = PLANE_Z;
    rec.rx = 0; rec.ry = 0; rec.rz = 0;
    this.last = [rec.x, rec.y, rec.z];
    this.b = { vx: 0, vy: 0, vz: 0, angVel: 0 };
  }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ cannon and balls

export class BallNode extends BkdNode {
  readonly kind = 'CBallBeh';
  /** node +0xa0 / +0xa4 */
  active = false;
  age = 0;
  b = { vx: 0, vy: 0, vz: 0, angVel: 0 };
  last: [number, number, number] = [0, 0, 0];
  private list: GameRecord[] = [];
  /** DAT_05d5ab88 in the original counts the balls in flight (never read here) */
  static inFlight = 0;

  bind(env: Env, rec: GameRecord) {
    super.bind(env, rec);
    // FUN_005bcd17: DAT_05d5ab10 = { land, anchor, 0 }
    this.list = [env.records[REC.LAND], env.records[REC.ANCHOR]];
  }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c;
    const dt = this.env.clock.dt;
    if (!this.active) return NODE_STOP;
    this.age = ad(dt, this.age);
    const cannon = this.env.records[REC.CANNON];
    if (C.TWENTY < this.age) {
      this.deactivate(rec);
      this.env.nodeOf<CannonNode>(cannon).giveBack(rec);
      return NODE_STOP;
    }
    const pts = rotateShape(BALL_SHAPE, 4, ad(rec.rz, C.HALF_PI));
    for (const p of pts) { p[0] = ad(p[0], rec.x); p[1] = ad(p[1], rec.y); }
    const q = castQuad(w, pts, 4, rec, this.list);
    const hitLand = q.hits.includes(this.env.records[REC.LAND]), hitAnchor = q.hits.includes(this.env.records[REC.ANCHOR]);
    this.b.vy = sb(this.b.vy, ml(C.FOUR, dt));
    if (hitAnchor) {
      const anchor = this.env.records[REC.ANCHOR];
      const v = this.env.nodeOf<AnchorNode>(anchor).push(anchor, [rec.x, rec.y, rec.z]);
      this.b.vx = v[0]; this.b.vy = v[1]; this.b.vz = v[2];
    }
    if (hitLand) {
      rec.x = this.last[0]; rec.y = this.last[1]; rec.z = this.last[2];
      bounce(this.b, [rec.x, rec.y, rec.z], q.normal, q.point);
    }
    this.last = [rec.x, rec.y, rec.z];
    rec.x = ad(ml(this.b.vx, dt), rec.x);
    rec.y = ad(ml(this.b.vy, dt), rec.y);
    rec.rz = ad(ml(this.b.angVel, dt), rec.rz);
    rebuild(rec, rec.rx, rec.ry, rec.rz);
    return NODE_STOP;
  }

  /** FUN_005bc6fb(ball, muzzle, velocity): fired */
  fire(rec: GameRecord, muzzle: ArrayLike<number>, vel: ArrayLike<number>) {
    this.active = true; this.age = 0;
    rec.flags |= RF_ENABLED;
    rec.x = muzzle[0]; rec.y = muzzle[1]; rec.z = 10;
    rec.rx = 0; rec.ry = 0; rec.rz = 0;
    this.last = [rec.x, rec.y, rec.z];
    this.b = { vx: vel[0], vy: vel[1], vz: 40, angVel: 0 };
    BallNode.inFlight++;
  }
  /** FUN_005bc83d: hidden, inactive */
  deactivate(rec: GameRecord) {
    rec.flags &= ~RF_ENABLED;
    this.active = false;
    BallNode.inFlight--;
  }
  /** FUN_005bc808: twice the ball's velocity is NOT used here: the diver takes the ball's velocity as it is (x, y, z) */
  velocity(): [number, number, number] { return [this.b.vx, this.b.vy, this.b.vz]; }
}

export class CannonNode extends BkdNode {
  readonly kind = 'CannBeh';
  /** node +0x18: seconds until the next shot (1 at the start, 8 after a shot) */
  timer = 1;
  /** node +0x1c ..: the ten balls (null = out of the barrel) */
  slots: (GameRecord | null)[] = [];

  /** FUN_005bd2b1: the ten balls in the pool: the records 67, 56, 59 .. 66 (0x1b38, 0x16c0, 0x17f8 ... 0x1ad0) */
  bind(env: Env, rec: GameRecord) {
    super.bind(env, rec);
    this.slots = REC.BALLS.map((i) => env.records[i]);
  }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c; void w;
    const dt = this.env.clock.dt;
    const diver = this.env.records[REC.PEPP];
    const dx = sb(diver.x, rec.x), dy = sb(diver.y, rec.y), dz = sb(diver.z, rec.z);
    const d2 = ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz));
    if (d2 < C.SIXTEEN_HUNDRED && rec.x <= diver.x) {
      // aim: -atan2(dx, dy) + 5 deg (mirrored below 0), wrapped, clamped to [4.014236, 5.497758]
      const n = normalize3([dx, dy, dz]);                       // FUN_0043cec0 on the vector (float32 stores), then atan2 of its x / y
      let a = ad(-Math.atan2(n[0], n[1]), C.FIVE_DEG);
      if (C.ZERO < a) a = -a;
      a = wrapAngle(a);
      if (C.ANG_HI < a) a = fr(5.497758);
      if (a < C.ANG_LO) a = fr(4.014236);
      const rz = ad(a, C.HALF_PI);
      // (the original only rebuilds the matrix, FUN_0043a5e4(rec + 0xc, 0, 0, rz, pos): the record's +0x54 stays: WP-VERIFY)
      setEuler(rec, 0, 0, rz, rec.x, rec.y, rec.z);
      const c = fr(Math.cos(rz)), s = fr(Math.sin(rz));
      const vel = [ml(c, C.TEN), ml(s, C.TEN)];
      const muzzle = [ad(ml(c, C.FIVE), rec.x), ad(ml(s, C.FIVE), rec.y), 10];
      this.timer = sb(this.timer, dt);
      if (this.timer <= C.ZERO) {
        let i = 0;
        while (i < this.slots.length && this.slots[i] === null) i++;
        if (i !== this.slots.length) {
          const ball = this.slots[i]!;
          this.env.nodeOf<BallNode>(ball).fire(ball, muzzle, vel);
          this.env.sound.at('CANNON', [rec.x, rec.y, rec.z]);
          this.slots[i] = null;
          this.timer = 8;
        }
      }
    }
    return NODE_STOP;
  }

  /** FUN_005bce70(cannon, ball): the ball is hidden and goes back into the first free slot */
  giveBack(ball: GameRecord) {
    ball.flags &= ~RF_ENABLED;
    const i = this.slots.indexOf(null);
    if (i >= 0) this.slots[i] = ball;
  }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ clam

/** FUN_005be08a / FUN_005bdbfa: the clam top opens to -0.785394 (speed -0.87266 rad/s eased near mid-way), waits 4 s, closes; closed on the diver it holds him for 4 s */
export class ClamNode extends BkdNode {
  readonly kind = 'ClamBeh';
  /** node +0x18: the lid's angular speed (negative: opening) */
  speed = f32bits(0xbf5f66a5);
  /** node +0x1c: the diver is held, +0x20: seconds the lid waits */
  holding = false;
  timer = 0;

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c; void w;
    const dt = this.env.clock.dt;
    const pos = [rec.x, rec.y, rec.z];
    let rx = rec.rx;
    let a = ad(rx, C.EIGHTH_PI);
    if (a < C.ZERO) a = -a;
    let ease = ad(sb(C.ONE, dv(a, C.EIGHTH_PI)), C.HALF);
    if (C.ONE < ease) ease = 1;
    ease = ml(ml(ease, ease), ease);
    if (this.speed <= C.ZERO) {
      if (this.timer === C.ZERO) {
        rx = ad(ml(ml(dt, ease), this.speed), rx);
        if (rx < C.MINUS_QUARTER_PI) { this.speed = -this.speed; this.timer = 4; }
        this.env.sound.at('CLAM_OPEN', pos);
        this.holding = false;
      } else {
        this.timer = sb(this.timer, dt);
        if (this.timer < C.ZERO) this.timer = 0;
      }
    }
    if (C.ZERO < this.speed) {
      if (this.timer === C.ZERO) {
        this.env.sound.stop('CLAM_OPEN');
        rx = ad(ml(ml(dt, ease), this.speed), rx);
        if (C.ZERO < rx) {
          this.env.sound.at('CLAM_SHUT', pos);
          this.speed = -this.speed;
          if (this.holding) this.timer = 4;
        }
      } else {
        this.timer = sb(this.timer, dt);
        if (this.timer < C.ZERO) this.timer = 0;
      }
    }
    rec.rx = rx;
    setEuler(rec, rx, rec.ry, rec.rz, rec.x, rec.y, rec.z);
    return NODE_STOP;
  }

  /** FUN_005bdea6(probe, pos, angle): true when `pos` lies on the inner side of the lid plane (the normalised (probe - pos) against (0, cos a, sin a) is negative) */
  static inside(probe: ArrayLike<number>, pos: ArrayLike<number>, angle: number): boolean {
    const c = fr(Math.cos(angle)), s = fr(Math.sin(angle));
    const d = normalize3([probe[0] - pos[0], probe[1] - pos[1], probe[2] - pos[2]]);
    return ad(ad(ml(d[0], 0), ml(d[1], c)), ml(d[2], s)) < C.ZERO;
  }

  /**
   * FUN_005bd9c0(clam, pos, &vel, heading, &angVel): what the lid does to a diver touching it: not held: inside the mouth (above the lid plane) the diver is pushed up
   * (0, 10), outside while the lid opens pushed down (0, -1), outside while it closes he is caught; held: a spring pulls him to (clam x, clam y + 2, 10) (4 x the distance)
   * and he turns toward 80 / 280 degrees at 1.3963 rad/s. Returns the velocity and spin to store (null: unchanged).
   */
  touch(rec: GameRecord, pos: ArrayLike<number>, heading: number): { vel?: [number, number, number]; angVel?: number } {
    const out: { vel?: [number, number, number]; angVel?: number } = {};
    if (!this.holding) {
      const probe = [rec.x, ad(rec.y, C.THREE), rec.z];
      if (!ClamNode.inside(probe, pos, rec.rx)) {
        if (this.speed <= C.ZERO) out.vel = [0, -1, 0];
        else this.holding = true;
      } else out.vel = [0, 10, 0];
      out.angVel = 0;
    }
    if (this.holding) {
      const target = [rec.x, ad(rec.y, C.TWO), 10];
      const d = [sb(target[0], pos[0]), sb(target[1], pos[1]), sb(10, pos[2])];
      const dist = sq(ad(ad(ml(d[0], d[0]), ml(d[1], d[1])), ml(d[2], d[2])));
      normalize3(d);
      const k = ml(dist, C.FOUR);
      out.vel = [ml(k, d[0]), ml(k, d[1]), ml(k, d[2])];
      const want = heading <= C.ZERO || C.PI < heading ? f32bits(0x409c6173) : f32bits(0x3fb2b884);
      const dir = angleDelta(want, heading).dir;
      out.angVel = dir === -1 ? -f32bits(0x3fb2b884) : f32bits(0x3fb2b884);
    }
    return out;
  }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ octopus

/**
 * FUN_005be5e0 / FUN_005be2c8: the octopus's tentacle collider (record 69) swings between rz = 0 and -1.221724 while the octopus's own clip (OCTO_DOOR, frames 0 .. 30 and
 * 30 .. end) plays at 0.15 frames per tick; the speed (node +0x18) doubles as the push strength of FUN_005be130.
 */
export class OctopusNode extends BkdNode {
  readonly kind = 'OctoBeh';
  speed = f32bits(0xbf32b884);
  /** +0x1c, +0x20, +0x24, +0x28: the four phases of the swing (down-limit armed, first half playing, up-limit armed, second half playing) */
  a = false; firstHalf = true; b = false; secondHalf = false;

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c; void w;
    const dt = this.env.clock.dt;
    const arm = this.env.records[REC.OCTC];
    let rz = arm.rz;
    let lo = false, hi = false;
    const anim = rec.anim!;
    const frame = anim.frame, count = anim.frameCount;
    if (C.ZERO < this.speed) {
      if (C.ZERO <= rz) { hi = true; rz = 0; }
      else {
        if (C.CLAM_OPEN_LIM < rz) this.speed = f32bits(0x401135eb);
        rz = ad(ml(ml(this.speed, dt), C.POINT_FIFTEEN), rz);
      }
    } else if (rz <= C.CLAM_SHUT_LIM) { lo = true; rz = fr(-1.2217239); }
    else {
      if (rz < C.CLAM_OPEN_MID) this.speed = f32bits(0xbff5bdb5);
      rz = ad(ml(ml(this.speed, dt), C.POINT_FIFTEEN), rz);
    }
    if (this.firstHalf) {
      if (frame < C.ZERO || C.THIRTY <= frame) { this.firstHalf = false; this.a = true; } else anim.advance(f32bits(0x3e19999a), w.dt);
    }
    if (this.secondHalf) {
      if (frame < C.THIRTY || count * C.ONE <= frame) { this.secondHalf = false; this.b = true; } else anim.advance(f32bits(0x3e19999a), w.dt);
    }
    if (this.a && lo) { this.speed = f32bits(0x3eb2b884); this.a = false; this.secondHalf = true; }
    if (this.b && hi) { this.speed = f32bits(0xbf32b884); this.b = false; this.firstHalf = true; }
    arm.rz = rz;
    setEuler(arm, arm.rx, arm.ry, rz, arm.x, arm.y, arm.z);
    return NODE_STOP;
  }

  /** FUN_005be130(tentacle, pos, &out): the push of the moving tentacle (angle + pi/2) */
  push(arm: GameRecord, pos: ArrayLike<number>): [number, number, number] {
    return swingPush([arm.x, arm.y, arm.z], ad(arm.rz, C.HALF_PI), this.speed, pos);     // fadd [0x892220] before the cos / sin calls (24-bit precision: one float32 result)
  }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ pirates

/**
 * FUN_005bd8b4 / FUN_005bd470: a pirate waits (clip 3, frame 1) until the last brick is taken (`alert`, FUN_005bd400); then, when the diver comes within 10 units, he starts
 * (state 3, jump up, "Pak aan, mijn schatjes" + the boing), turns to face the diver and slashes (state 1) when the diver is within 16 units, holds a brick and the 10 s
 * cooldown of a hit is over; otherwise he idles (state 2). Each state is the clip of the same number.
 */
export class PirateNode extends BkdNode {
  readonly kind = 'PiroBeh';
  /** node +0x18: alerted */
  alerted = false;
  /** +0x1c: engaged */
  engaged = false;
  /** +0x20: the diver is within 16 units */
  near = false;
  /** +0x24: the state / clip (-1: none yet) */
  state = -1;
  /** +0x28: seconds before the next slash after he hit */
  cooldown = 0;

  bind(env: Env, rec: GameRecord) {
    super.bind(env, rec);
    rec.anim?.start(CLIP.PIRO_JUMPUP, 1);   // FUN_005bd8b4: FUN_0043b6a3(anim, 3, 1.0)
  }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c; void w;
    const env = this.env, dt = env.clock.dt;
    const diver = env.records[REC.PEPP];
    const dx = sb(rec.x, diver.x), dy = sb(rec.y, diver.y), dz = sb(rec.z, diver.z);
    if (this.alerted && !this.engaged) {
      if (ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz)) < C.HUNDRED) {
        this.engaged = true; this.near = true; this.state = 3;
        rec.anim?.start(this.state, 1);
        env.sound.play('SKELETON_ANIMATE');
        env.state.speak('CASGBD06');
      }
    }
    if (this.engaged) {
      if (this.cooldown !== C.ZERO) { this.cooldown = sb(this.cooldown, dt); if (this.cooldown < C.ZERO) this.cooldown = 0; }
      const tx = sb(diver.x, rec.x), ty = sb(diver.y, rec.y), tz = sb(diver.z, rec.z);
      this.near = !(C.TWO_FIFTY_SIX <= ad(ad(ml(tx, tx), ml(ty, ty)), ml(tz, tz)));
      const n = normalize3([tx, ty, tz]);                       // FUN_0043cec0, then atan2 of x / z
      const yaw = fr(Math.atan2(n[0], n[2]));
      // (the original only rebuilds the matrix: FUN_0043a5e4(rec + 0xc, 0, yaw, 0, pos); the record's +0x50 is not written: WP-VERIFY)
      setEuler(rec, 0, yaw, 0, rec.x, rec.y, rec.z);
      let ending = false;
      if (this.state !== -1) {
        const a = rec.anim!;
        if (sb(a.frameCount, C.TWO) < a.frame) ending = true;
      }
      if (ending) {
        let next = 2;
        const holds = (env.nodeOf(diver) as unknown as { held: GameRecord | null }).held !== null;
        if (this.state === 3 && this.near && holds) next = 1;
        if (this.state === 2 && this.near && this.cooldown === C.ZERO && holds) next = 1;
        if (this.state === 1 && this.near && this.cooldown === C.ZERO && holds) next = 1;
        if (next !== this.state) { this.state = next; rec.anim?.start(this.state, 1); }
      }
    }
    if (this.state !== -1) rec.anim?.advance(1.0, w.dt);
    return NODE_STOP;
  }

  /** FUN_005bd400: the last brick was taken */
  alert() { this.alerted = true; }
  /** FUN_005bd424: he is slashing */
  slashing(): boolean { return this.state === 1; }
  /** FUN_005bd44c: his blow landed, 10 s of rest */
  rest() { this.cooldown = 10; }
}
