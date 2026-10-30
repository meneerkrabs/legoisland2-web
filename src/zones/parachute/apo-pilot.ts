// z40aPO: Pepper in a space suit, thrown out of the shuttle over Ogel: the behaviour node of FUN_007d53af (constructor, "Parogel") / FUN_007d3187 (update, 629 lines).
// A copy of the z38PAR pilot (par-pilot.ts) with a launch phase, 15 rings in three groups, asteroids / rock monsters / brickbots in the way and a landing on the planet.
//
// States (node +0x38): 0 the shuttle opens its doors, 1 the shuttle pulls away, 2 free fall (Up / Down tilt, Shift opens the solar wing once it is allowed), 3 the wing opens,
// 4 gliding (Left / Right steer, Up pulls forward), 5 landing animation, 6 game over, 8 bounced off something (the state it came from is kept in +0x3c / the clip in +0x40).
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { B } from '../../game/input.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { apoRun } from './apo-run.ts';
import type { ApoRun } from './apo-run.ts';
import { TWO_PI, ftol, nameStarts, rand, steerYaw, transformPoint } from './util.ts';
import type { Vec3 } from './util.ts';

export const AS = { DOORS: 0, LAUNCH: 1, FALL: 2, OPENING: 3, GLIDE: 4, LANDING: 5, OVER: 6, BOUNCE: 8 } as const;
/** animation clips of the pilot's rig (the same MFIG.blk numbering as z38PAR) */
export const ACLIP = { GLIDE: 1, FALL: 3, OPEN: 4, LAND: 5, BOUNCE: 7, SAD: 8, CHEER: 9, PULL: 10 } as const;

/** constants of the constructor FUN_007d53af and the update (float immediates of the code; addresses of the data in comments) */
export const APO = {
  START_ALT: 2000,            // 0x44fa0000: local_10[5] (also DAT_05d5f0a0)
  GLIDE_REF: 400,             // 0x43c80000: node +0x18
  RADIUS: [22.8, 11.5, 7.6] as const,   // node +0x20 / +0x24 / +0x28: landing radius of target 3 / 2 / 1
  CHUTE_FALL: 0.3,            // 0x3e99999a: node +0x54
  FALL_START: 0.5,            // 0x3f000000: node +0x58
  CAM_LERP: Math.fround(0.15),   // 0x3e19999a: node +0x60
  CAM_OFF: [16, 0, 4] as const,   // node +0x64 / +0x68 / +0x6c
  CAM_LIFT: 0.25,             // 0x3e800000: node +0x74 (times 8)
  GROUP_ALT: [1400, 800, 310] as const,  // node +0x98 / +0x9c / +0xa0: below these heights a group without a passed ring is missed
  RING_POINTS: [250, 500, 750] as const,  // 0xfa / 500 / 0x2ee in the ring table (+0x4 of the 0x14 byte entries)
  LAND_FULL: [1000, 1500, 2000] as const, // 0x892120 / 0x892990 / 0x8923d0: points at the middle of target 3 / 2 / 1
  LAND_BONUS: 800,
  FLARE_COST: 50,
  PITCH_RATE: 0.07,           // 0x3d8f5c29 at 0x89299c (node +0x7c)
  DOOR_STEP: Math.fround(0.02), DOOR_MAX: Math.fround(2.09438), DOOR_CLOSE: Math.fround(0.09),   // 0x8922c0 / 0x8929a8 / 0x8929a0: shuttle doors in state 0 / 1 (float32 constants)
  /** state 0 sets the shuttle's x rotation to 0x4096cbe4 (3 pi / 2) and its y rotation to 0x40490fdb (pi) */
  SHUTTLE_RX: Math.fround(4.712389), SHUTTLE_RY: Math.fround(Math.PI),
  SHUTTLE_DRIFT: [2.5, 1.0, 0.007] as const,   // state 1: x -= 2.5, y -= 1.0, rx += 0.007 per tick
  BOUNCE_SHIFT: 4,            // (60 - frame) >> 4 in state 8 (PAR: >> 3)
  MONSTER_SCALE: 1.2,         // 0x8920e8: the rock monsters' boxes are 20 % larger
} as const;

/** FUN_0043a4a1(m, ax, ay, az): the rotation part of a sub-object matrix from the Euler angles, the translation (m[12..14]) kept */
function setRot(m: Float32Array, ax: number, ay: number, az: number) { m.set(buildMatrix(ax, ay, az, m[12], m[13], m[14])); }

/**
 * FUN_00442a70(rec, ground, size, lift, points, 0): the blob shadow of the wing record on the ground record. A ray (from 150 above the record, 8000 down, mask 3, radius 0.01)
 * finds the centre; four corners at heading +-45 / 135 degrees (heading = atan2(m[8], m[10]) of the record) and `size * 8` out are ray-cast from 250 above the centre height and
 * keep the centre's height when they miss; every height is lifted by `lift * 8`. The five points (corner, centre, corner, corner, corner: the vertex order of the SHAD mesh
 * `para_shad.Msh`) are written to `out` as float32 (the original's DAT_05d5f290); returns null without a centre hit (the points keep their old values).
 */
export function shadowPoints(w: World, rec: GameRecord, ground: GameRecord, size: number, lift: number, out: Float32Array = new Float32Array(15)): Float32Array | null {
  const f = Math.fround;
  const c = w.col.rayRecord(ground, [rec.x, f(rec.y + 150), rec.z], [0, -8000, 0], 3, 0.01, 0);
  if (!c) return null;
  const cx = f(c.point[0]), cy = f(c.point[1]), cz = f(c.point[2]);
  const ang = Math.atan2(rec.m[8], rec.m[10]);
  const r = f(size * 8), top = f(cy + 250);
  out[3] = cx; out[4] = cy; out[5] = cz;
  // corner k: [heading offset, index in `out`]: P0 = +2.356, P1 = +0.785, P2 = -0.785, P3 = -2.356 (0x4016c8b4 / 0x3f48f5c3)
  const A = f(2.356), B = f(0.785);
  const corners: [number, number][] = [[f(ang + A), 0], [f(ang + B), 6], [f(ang - B), 9], [ang - A, 12]];   // the fourth angle is not rounded to float32 before the sin / cos (x87 stack)
  for (const [a, o] of corners) {
    out[o] = f(Math.sin(a) * r + cx); out[o + 1] = top; out[o + 2] = f(Math.cos(a) * r + cz);
    const h = w.col.rayRecord(ground, [out[o], out[o + 1], out[o + 2]], [0, -8000, 0], 3, 0.01, 0);
    if (h) { out[o] = h.point[0]; out[o + 1] = h.point[1]; out[o + 2] = h.point[2]; } else out[o + 1] = cy;
  }
  const up = f(lift * 8);
  for (const k of [1, 4, 7, 10, 13]) out[k] = f(out[k] + up);
  return out;
}

const f = Math.fround;
/** 2 pi / pi as the float32 constants 0x40c90fdb / 0x40490fdb of the node's comparisons */
const F_TWO_PI = f(TWO_PI), F_PI = f(Math.PI);

/**
 * FUN_0043cfee(out, v, n) in the order of the machine code (the decompile's order is not it): d = float(v0 n0 + v1 n1 + v2 n2) (x87 sums, one store), then each component of n is
 * multiplied by -2 and stored as a float, multiplied by d and stored as a float, and out = float(that + v). Three float stores per component.
 */
export function reflect32(v: ArrayLike<number>, n: ArrayLike<number>, out: Vec3): Vec3 {
  const d = f(f(f(v[0] * n[0]) + f(v[1] * n[1])) + f(v[2] * n[2]));     // 24-bit x87: every product and sum rounds
  for (let i = 0; i < 3; i++) out[i] = f(f(f(n[i] * -2) * d) + v[i]);
  return out;
}

/**
 * FUN_0043d5ec(a, b, half, point, normal): the first crossing of the segment a -> b with the faces of the origin-centred box `half`, with all its float32 stores AND side effects: the
 * interpolated coordinates of a face test are written to `point` while the test runs, also when a later condition of the same test fails, so the point can hold the leftovers of failed
 * faces (the normal is only written by a face that was hit). Returns the crossing parameter (1.01 = none).
 */
export function crossBox(a: ArrayLike<number>, b: ArrayLike<number>, h: ArrayLike<number>, P: Float32Array, N: Float32Array): number {
  let c = f(1.01);
  const lerp = (j: number, t: number) => f((b[j] - a[j]) * t + a[j]);
  /** the six face tests: axis i (0 x, 1 y, 2 z), the other two axes j, k; the first sign is tested against the 1.01 constant, the rest against the best t so far */
  for (let i = 0; i < 3; i++) {
    if (a[i] === b[i]) continue;
    const j = i === 0 ? 1 : 0, k = i === 2 ? 1 : 2;
    const inv = f(1 / (b[i] - a[i]));
    let t = f((h[i] - a[i]) * inv);
    const lim = (x: number) => x <= c;
    // the first test of each pair uses the double constant 1.01 (x axis) or the best t so far (the other two axes): as the decompile has it
    if (0 <= t && (i === 0 ? t <= 1.01 : lim(t)) && (P[j] = lerp(j, t), P[j] < h[j]) && -h[j] < P[j] && (P[k] = lerp(k, t), P[k] < h[k]) && -h[k] < P[k]) {
      P[i] = h[i]; N[0] = N[1] = N[2] = 0; N[i] = 1; c = t;
    }
    t = f((-h[i] - a[i]) * inv);
    if (0 <= t && t <= c && (P[j] = lerp(j, t), P[j] < h[j]) && -h[j] < P[j] && (P[k] = lerp(k, t), P[k] < h[k]) && -h[k] < P[k]) {
      P[i] = -h[i]; N[0] = N[1] = N[2] = 0; N[i] = -1; c = t;
    }
  }
  return c;
}

/**
 * FUN_007d3050(rock monster record, prev, cur, point, normal): does the segment prev -> cur cross the record's collision box (centre and half extents of the `.col` box, the
 * half extents 20 % larger)? The point and the normal come back in the world frame.
 */
export function rockBoxHit(rec: GameRecord, prev: ArrayLike<number>, cur: ArrayLike<number>, outPoint: Vec3, outNormal: Vec3, scale = 1.2): boolean {
  const col = rec.colObj?.col;
  if (!col) return false;
  const c = [f(col.center[0]), f(col.center[1]), f(col.center[2])];
  const h = [0, 1, 2].map((k) => scale === 1 ? f(col.halfExtents[k]) : f(f(col.halfExtents[k]) * f(scale)));      // FUN_007d3050 multiplies the half extents by 1.2, FUN_00468590 (z38PAR's pterodactyls) does not
  const a = rec.toLocal(prev).map((v, k) => f(f(v) + c[k])), b = rec.toLocal(cur).map((v, k) => f(f(v) + c[k]));
  const P = new Float32Array(3), N = new Float32Array(3);
  const t = crossBox(a, b, h, P, N);
  if (t < 0 || t > 1) return false;
  const lp = [f(P[0] - c[0]), f(P[1] - c[1]), f(P[2] - c[2])];
  const m = rec.m;
  outPoint[0] = f(lp[0] * m[0] + lp[1] * m[4] + lp[2] * m[8] + m[12]);
  outPoint[1] = f(lp[0] * m[1] + lp[1] * m[5] + lp[2] * m[9] + m[13]);
  outPoint[2] = f(lp[0] * m[2] + lp[1] * m[6] + lp[2] * m[10] + m[14]);
  outNormal[0] = f(N[0] * m[0] + N[1] * m[4] + N[2] * m[8]);
  outNormal[1] = f(N[0] * m[1] + N[1] * m[5] + N[2] * m[9]);
  outNormal[2] = f(N[0] * m[2] + N[1] * m[6] + N[2] * m[10]);
  return true;
}

const noAnim = { clip: 0, frame: 0, start() { return false; }, advance() { return 0; } };

export class ApoPilot implements BehaviourNode {
  readonly kind = 'ApoPilot';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;

  state: number = AS.DOORS;       // +0x38
  prevState = 0; prevClip = 0;    // +0x3c / +0x40
  landed = false;                 // +0x48
  steerDir = 0;                   // +0x44
  yawRate = 0;                    // +0x4c
  fallTarget = 0;                 // +0x50
  fall: number = APO.FALL_START;  // +0x58
  fwd = Math.fround(Math.fround(0.5) * Math.fround(0.17));   // +0x5c (the constructor stores 0.5 * 0.17, 0x3f000000 * 0x3e2e147b; the glide overwrites it)
  camLerp: number = APO.CAM_LERP; // +0x60
  camOff: Vec3 = [APO.CAM_OFF[0], APO.CAM_OFF[1], APO.CAM_OFF[2]];   // +0x64 / +0x68 / +0x6c
  door: Vec3 = [0, 0, 0];         // +0x80 / +0x84 / +0x88
  /** the live sub-object matrices 1 / 2 / 3 of the shuttle mesh (FUN_0043ea60(model of SHTL, 1 / 2 / 3)): the doors and the hatch; the renderer draws their groups with them (GameRenderer.partMatrices) */
  parts: Float32Array[] | null = null;
  bounce: Vec3 = [0, 0, 0];       // +0x8c / +0x90 / +0x94
  /** the target heights of the landing test: target 3 + 3, target 2, target 1 + 2 (node +0x2c / +0x30 / +0x34) */
  landY: Vec3 = [0, 0, 0];
  private inited = false;

  init(w: World, rec: GameRecord) {
    if (this.inited) return;
    this.inited = true;
    const run = apoRun(w);
    const R = run.recs;
    this.landY = [R.targets[2].y + 3, R.targets[1].y + 0, R.targets[0].y + 2];
    rec.x = 0; rec.y = APO.START_ALT; rec.z = 0;
    rec.rx = rec.ry = rec.rz = 0;
    rec.setEuler(0, 0, 0, 0, APO.START_ALT, 0);
    rec.savePrev();
    rec.flags &= ~0x10;                    // the port's walk set-up makes the player non-solid; in this zone the brickbots and rocks can touch it
    if (R.shad) { R.shad.x = 0; R.shad.y = 0; R.shad.z = 0; R.shad.hide(); }
    rec.anim?.start(ACLIP.FALL, 0);
    run.startAlt = APO.START_ALT; run.y = APO.START_ALT;
    run.ring.fill(0); run.group = [false, false, false]; run.chuteOk = false; run.score = 0; run.height = 0; run.landBonus = 0; run.canopy = 0;
    run.over = false; run.aborted = false; run.monstersWoke = false;
  }

  update(w: World, rec: GameRecord): number {
    this.init(w, rec);
    const run = apoRun(w);
    const R = run.recs, snd = run.sound;
    const held = w.input.held, dt = w.dt;
    const anim = (rec.anim ?? noAnim) as typeof noAnim & { start(c: number, f?: number): boolean; advance(r: number, dt?: number): number };
    run.tick++;
    const clip0 = anim.clip, frame0 = anim.frame;       // the pose the last draw left in the animation's buffer (FUN_0043bc58 at the end of the update)

    let ex = rec.x, ey = rec.y, ez = rec.z;
    const px = ex, py = ey, pz = ez;
    snd.play('breath');                                  // node +0xb4 stays 0: the breathing loop is refreshed every tick
    if (R.palace) snd.at('palace', [R.palace.x, R.palace.y, R.palace.z]);
    // a group whose ring was passed: the beacon of its target is heard, the distance to the target is kept for the landing test
    const dist = (t: GameRecord) => Math.hypot(ex - t.x, ey - t.y, ez - t.z);
    let d3 = 0, d2 = 0, d1 = 0;
    if (run.group[0]) { snd.at('beacon1', [R.targets[2].x, R.targets[2].y, R.targets[2].z]); d3 = dist(R.targets[2]); }
    if (run.group[1]) { snd.at('beacon2', [R.targets[1].x, R.targets[1].y, R.targets[1].z]); d2 = dist(R.targets[1]); }
    if (run.group[2]) { snd.at('beacon1', [R.targets[0].x, R.targets[0].y, R.targets[0].z]); d1 = dist(R.targets[0]); }

    switch (this.state) {
      case AS.DOORS: {
        anim.advance(1, dt);
        const sh = R.shtl;
        if (sh) { sh.rx = APO.SHUTTLE_RX; sh.ry = APO.SHUTTLE_RY; sh.setEuler(sh.rx, sh.ry, sh.rz, sh.x, sh.y, sh.z); }
        this.turnDoors();
        const d = this.door, k = APO.DOOR_STEP * dt;
        d[0] = Math.fround(d[0] - k); d[1] = Math.fround(d[1] + k); d[2] = Math.fround(d[2] + k);
        if (APO.DOOR_MAX < d[2]) {
          this.camOff = [0, 0, 0];
          this.state = AS.LAUNCH;
          snd.play('launch');
        }
        break;
      }
      case AS.LAUNCH: {
        anim.advance(1, dt);
        const sh = R.shtl;
        snd.stop('engine');
        if (this.door[2] <= 0) { sh?.hide(); this.state = AS.FALL; }
        else {
          if (sh) {
            sh.y = Math.fround(sh.y - APO.SHUTTLE_DRIFT[1] * dt); sh.x = Math.fround(sh.x - APO.SHUTTLE_DRIFT[0] * dt);
            sh.rx = Math.fround(sh.rx + Math.fround(APO.SHUTTLE_DRIFT[2]) * dt);
            sh.setEuler(sh.rx, sh.ry, sh.rz, sh.x, sh.y, sh.z);
          }
          this.turnDoors();
          const d = this.door, k = Math.fround(APO.DOOR_CLOSE) * dt;
          d[0] = Math.fround(d[0] + k); d[1] = Math.fround(d[1] - k); d[2] = Math.fround(d[2] - k);
        }
        break;
      }
      case AS.FALL: {
        if (this.camLerp < Math.fround(0.85)) this.camLerp = Math.fround(this.camLerp + Math.fround(0.1) * dt);   // float32 node field (+0x60): the oracle test shows the 0.85 limit is crossed at 0.85000008
        // a group without a passed ring when the pilot is below its height is missed (the flag of the group's last ring becomes 2)
        const sum = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += run.ring[i]; return s; };
        if (py < APO.GROUP_ALT[0] && run.ring[4] !== 2 && sum(0, 5) === 0) run.ring[4] = 2;
        if (py < APO.GROUP_ALT[1] && run.ring[9] !== 2 && sum(5, 10) === 0) run.ring[9] = 2;
        if (py < APO.GROUP_ALT[2] && run.ring[14] !== 2) { if (sum(10, 15) === 0) run.ring[14] = 2; else run.fx?.goldOn(); }   // else: FUN_00442a20(T_gold, 2, 1, 1)
        if (anim.clip === ACLIP.FALL) anim.advance(1, dt);
        const step = f(f(APO.PITCH_RATE) * dt);                  // +0x7c
        if (held & B.UP) { rec.rx = f(rec.rx + step); if (F_TWO_PI < rec.rx) rec.rx = f(rec.rx - F_TWO_PI); }
        if (held & B.DOWN) { rec.rx = f(rec.rx - step); if (rec.rx < 0) rec.rx = f(rec.rx + F_TWO_PI); }
        this.fallTarget = f(f(Math.abs(Math.sin(rec.rx) * f(0.4))) + f(0.4));
        const glide = f(Math.sin(2 * rec.rx));
        // FUN_00443600(accel, ftol((fall - 0.4) * 25840 + 32000)): the constants 0x892998 / 0x892994 (z38PAR has its own: 17215 / 9114)
        snd.rate('accel', ftol(f(f(f(this.fallTarget - f(0.4)) * 25840) + 32000)));   // (24-bit x87: every operation rounds to float32)
        snd.play('accel');
        // FUN_0043ac78 + FUN_0043ad29(matrix, ry): the third row of a y rotation (sin ry, 0, cos ry) as float32
        ex = f(ex + f(glide * dt * f(Math.sin(rec.ry))));
        ez = f(ez + f(glide * dt * f(Math.cos(rec.ry))));
        this.fall = this.fallTarget;
        if (run.height <= 0) {
          this.state = AS.LANDING;
          ex = rec.x; ey = rec.y; ez = rec.z;
          const hit = w.col.sweep(rec, [ex, ey, ez], [f(px - ex), f(py - ey), f(pz - ez)], 3, 12, 12);
          if (hit) { if (nameStarts(hit.rec, 'TAR')) snd.play('hitTarget'); else snd.play('smack'); }
        } else ey = f(ey - f(this.fall * dt));
        if (run.chuteOk && (held & B.SHIFT)) {
          run.speak('OGSGPO09');
          this.state = AS.OPENING;
          snd.play('solarOpen'); snd.play('thruster');
          anim.start(ACLIP.OPEN, 0);
          this.fall = f(APO.CHUTE_FALL);
        }
        break;
      }
      case AS.OPENING: {
        if (rec.rx <= 0 || F_TWO_PI <= rec.rx) {
          rec.rx = 0;
          run.canopy = 1;
          const done = anim.advance(1, dt);
          if (done !== 0) {
            this.state = AS.GLIDE;
            anim.start(ACLIP.GLIDE, 0);
            this.camLerp = f(0.35); this.camOff[1] = 0; this.camOff[2] = f(-2.8);
          }
        } else if (F_PI <= rec.rx || rec.rx <= 0) rec.rx = f(rec.rx + f(0.1) * dt);
        else rec.rx = f(rec.rx - f(0.1) * dt);
        ey = f(ey - f(this.fall * dt));
        break;
      }
      case AS.GLIDE: {
        if (anim.clip === ACLIP.GLIDE) anim.advance(1, dt);
        this.fwd = f(f(f(ey + 50) * this.fall) / f(APO.START_ALT + APO.GLIDE_REF));
        if (!(held & B.UP)) {
          if (anim.clip === ACLIP.PULL) {
            anim.advance(-1, dt);
            if (anim.frame < 0) anim.start(ACLIP.GLIDE, 0);
            if (ftol(anim.frame) <= 0) anim.start(ACLIP.GLIDE, 0);
          }
        } else {
          ey = f(f(f(this.fall / 2) * dt) + ey);
          this.fwd = f(this.fwd * 4);
          if (anim.clip === ACLIP.GLIDE) anim.start(ACLIP.PULL, 0);
          else if (ftol(anim.frame) < 0xf) anim.advance(1, dt);
        }
        const m = rec.m;
        const fd = f(this.fwd * dt);
        const bx = f(f(fd * m[8]) * 8), by = f(f(fd * m[9]) * 8), bz = f(f(fd * m[10]) * 8);
        ex = f(ex + bx);
        ey = f(f(ey - f(this.fall * dt)) + by);
        ez = f(ez + bz);
        // landing on a target whose group was passed: close enough and below its height
        const land = (g: number, d: number, r: number, limit: number, full: number) => {
          if (run.group[g] && d < r && ey < limit) { this.landed = true; run.landScore = ftol((r - d) * (full / r)); }
        };
        land(0, d3, APO.RADIUS[0], this.landY[0], APO.LAND_FULL[0]);
        land(1, d2, APO.RADIUS[1], this.landY[1], APO.LAND_FULL[1]);
        land(2, d1, APO.RADIUS[2], this.landY[2], APO.LAND_FULL[2]);
        if (run.group[2] && run.landScore > 10000) run.landScore = 10000;
        if (!this.landed) {
          if (run.height < 0) {
            this.state = AS.LANDING;
            anim.start(ACLIP.LAND, 0);
            snd.play('landOff');
            run.score = 0;
          }
        } else {
          run.landBonus = APO.LAND_BONUS;
          if (anim.clip === ACLIP.PULL) run.landBonus -= ftol(ftol(anim.frame) * APO.FLARE_COST);
          run.score += run.landScore + run.landBonus;
          this.state = AS.LANDING;
          anim.start(ACLIP.LAND, 0);
          snd.play('landOk');
        }
        break;
      }
      case AS.LANDING: {
        snd.stop('thruster');
        this.camLerp = f(0.03); this.camOff[2] = 12; this.camOff[0] = 12;
        if (anim.clip === ACLIP.LAND) {
          const r = anim.advance(1, dt);
          if (r === 1 || r === 2) {
            this.state = AS.OVER;
            anim.start(run.score < 2000 ? ACLIP.SAD : ACLIP.CHEER, 0);
            run.canopy = 2;
          }
        } else { this.state = AS.OVER; run.score = 0; }
        break;
      }
      case AS.OVER:
        run.over = true;
        break;
      case AS.BOUNCE: {
        const frame = ftol(anim.frame);
        const k = f((60 - frame) >> APO.BOUNCE_SHIFT) * dt;
        ex = f(rec.x + f(k * this.bounce[0])); ey = f(rec.y + f(k * this.bounce[1])); ez = f(rec.z + f(k * this.bounce[2]));
        rec.x = ex; rec.y = ey; rec.z = ez;
        const r = anim.advance(1, dt);
        if (r === 1 || r === 2) { this.state = this.prevState; anim.start(this.prevClip, 0); }
        ey = f(ey - f(this.fall * dt));
        rec.x = ex; rec.y = ey; rec.z = ez;
        const hit = w.col.sweep(rec, [ex, ey, ez], [f(px - ex), f(py - ey), f(pz - ez)], 3, f(1.2), f(1.2));
        if (hit && nameStarts(hit.rec, 'OGEL')) this.state = AS.LANDING;
        break;
      }
    }

    if (this.state !== AS.DOORS && this.state !== AS.LAUNCH) {
      steerYaw(this, held);
      if (this.state === AS.FALL || this.state === AS.GLIDE) rec.ry = f(rec.ry + this.yawRate * dt);
      rec.setEuler(rec.rx, rec.ry, rec.rz, ex, ey, ez);
      ex = rec.x; ey = rec.y; ez = rec.z;
      this.ground(w, run, ey);
      run.shadowOn = this.state === AS.GLIDE;
    }
    this.camera(w, rec, ex, ey, ez);
    run.y = ey;
    if (this.state === AS.FALL || this.state === AS.GLIDE || this.state === AS.OPENING) this.collide(w, run, rec, [px, py, pz], [ex, ey, ez]);
    // FUN_007d3187's second block (after the original's collision test, so the state is the final one): states 5 / 6 switch the footsmokes off, else bones 2 / 4 refresh their matrices
    if (this.state !== AS.DOORS && this.state !== AS.LAUNCH) run.fx?.pilotTail(this.state, rec, clip0, frame0);
    return NODE_STOP;
  }

  /** FUN_0043a4a1 on the shuttle's sub-objects 1 / 2 / 3 with the current door angles (before the angles move on): part 1 and 2 about y, part 3 about x */
  private turnDoors() {
    const p = this.parts;
    if (!p) return;
    setRot(p[1], 0, this.door[0], 0);
    setRot(p[2], 0, this.door[1], 0);
    setRot(p[3], this.door[2], 0, 0);
  }

  /** FUN_00442a70(wing record, OGEL, 2.0, 0.4, DAT_05d5f290, 0): the ground height + 3.2 under the pilot and the shadow points of the SHAD record (`shadowPoints`) */
  private ground(w: World, run: ApoRun, ey: number) {
    const R = run.recs, from = R.para ?? R.pepp;
    const pts = shadowPoints(w, from, R.ogel, 2.0, 0.4, run.shadow);
    if (pts) { run.groundY = pts[4]; run.groundHit = [pts[3], pts[4] - 0.4 * 8, pts[5]]; }
    run.height = Math.fround(ey - run.groundY);
  }

  /** the end of the update for states 2 / 3 / 4: the forward sweep (radius 1.2) and the three rock monsters' boxes, then what was hit decides */
  private collide(w: World, run: ApoRun, rec: GameRecord, prev: Vec3, cur: Vec3) {
    const R = run.recs, snd = run.sound;
    const delta: Vec3 = [f(cur[0] - prev[0]), f(cur[1] - prev[1]), f(cur[2] - prev[2])];     // forward: this tick's motion, from the new position (cur - prev)
    const hit = w.col.sweep(rec, cur, delta, 3, 1.2, 1.2);
    const point: Vec3 = [0, 0, 0], normal: Vec3 = [0, 0, 0];
    let monster = false;
    for (let i = 0; i < 3 && !monster; i++) {
      if (rockBoxHit(R.rocks[i], prev, cur, point, normal)) { monster = true; snd.play('hitMonster'); }
    }
    if (!hit && !monster) return;
    let ringHit = false;
    if (!monster && hit) {
      for (let i = 0; i < 15; i++) {
        if (nameStarts(hit.rec, R.rc[i].name)) {
          ringHit = true;
          if (run.ring[i] === 0) {
            run.ring[i] = 1;
            R.targets[i < 5 ? 2 : i < 10 ? 1 : 0].flags = 2;
            run.score += APO.RING_POINTS[Math.floor(i / 5)];
            snd.play('thruRing');
            run.group[Math.floor(i / 5)] = true;
          }
        }
      }
    }
    if (ringHit) return;
    if (!monster && hit && nameStarts(hit.rec, 'OGEL')) {
      this.state = AS.LANDING; rec.anim?.start(ACLIP.LAND, 0); run.score = 0;
    } else if (!monster && hit && nameStarts(hit.rec, 'SKY1')) {
      this.state = AS.OVER; run.score = 0; run.aborted = true;
    } else {
      if (!monster && hit) {
        if (nameStarts(hit.rec, 'RK')) snd.play('hitAsteroid');
        if (nameStarts(hit.rec, 'RN')) snd.play('hitRing');
        if (nameStarts(hit.rec, 'BBT')) snd.play('hitBot');
      }
      const n: Vec3 = !monster && hit ? [hit.normal[0], hit.normal[1], hit.normal[2]] : normal;
      if (n[0] === 0 && n[2] === 0) { n[0] = f(rand(2) - 1); n[2] = f(rand(2) - 1); }
      reflect32(delta, n, this.bounce);
      this.bounce[1] = f(-0.2);      // a float32 node field (+0x90)
      this.prevState = this.state;
      const clip = rec.anim?.clip ?? 0;
      if (clip !== ACLIP.BOUNCE) this.prevClip = clip;
      this.state = AS.BOUNCE;
      run.speak('OGSGPO11');
      rec.anim?.start(ACLIP.BOUNCE, 0);
    }
  }

  private camera(w: World, rec: GameRecord, ex: number, ey: number, ez: number) {
    const c = w.camera.c;
    // all float32: the offsets (+0x64 .. +0x6c plus 0, 13.6 and -1.6), the eye, the target (+0x74 * 8 above the pilot), the easing
    const eye = transformPoint(buildMatrix(0, rec.ry, rec.rz, ex, ey, ez), [f(this.camOff[0]), f(f(this.camOff[1]) + f(13.6)), f(f(this.camOff[2]) + f(-1.6))]).map(f);
    c[3] = f(ex); c[4] = f(f(f(APO.CAM_LIFT) * 8) + f(ey)); c[5] = f(ez);
    c[0] = f(f(f(eye[0] - c[0]) * this.camLerp) + c[0]);
    c[2] = f(f(f(eye[2] - c[2]) * this.camLerp) + c[2]);
    c[1] = f(f(f(eye[1] - c[1]) * this.camLerp) + c[1]);
  }
}
