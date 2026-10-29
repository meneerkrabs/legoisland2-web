// The Speedster (behaviour "SpeedStr", SpeedStr.c): the player's car. Constructor FUN_006c6495, update FUN_006c2627 (969 lines), helpers FUN_006c550f (input
// ramps), 006c583e (wheels), 006c5afb / 006c5d84 (car matrix on the ground), 006c61cf (the driver figure), 006c52d9 (shrink), 006c1e70 (spin), 006c2253 (the
// finish), 006c209d (bounce off a record), 006c6d57 (scoring). docs/re/m6/z20DSP.md sections 4 and 5. Field offsets of the original node (0x414 bytes) are in
// the comments; the node is the controller node of record 38 (PEPP, the car).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { AnimInstance } from '../../game/anim.ts';
import { euler24, normalize24, cross24 } from '../common/x87.ts';
import { mulGame } from '../../render/math.ts';
import { DspShared, REC, SND, VAR, STATE, terrain, NO_GROUND } from './shared.ts';

export const CTOR_SPEEDSTR = 0x6c6495;
const f32 = Math.fround;
const F05 = f32(0.05), F08 = f32(0.8), F033 = f32(0.33), F16 = f32(1.6);
const PI = 3.1415927410125732, TWO_PI = 6.2831854820251465;      // DAT_0089207c / DAT_00892094 (floats)

/** the buttons of the loop (DAT_0098383c & 0xff): bit 1 LEFT, 2 RIGHT, 4 UP, 8 DOWN, 0x10 CTRL, 0x20 ALT, 0x40 SHIFT */
export const BTN = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, CTRL: 0x10, ALT: 0x20, SHIFT: 0x40 } as const;

/** start place and heading of the car (FUN_006c6495: x, y, z written into the record, the ground probe after it) */
export const START = { x: -17.3351993560791 /* 0xc18aae7d */, y: 0.8500000238418579 /* 0x3f59999a */, z: 37.5432014465332 /* 0x42162c3d */ } as const;
/** medal thresholds of FUN_006c6d57 (ticks): `t < 2700` gold, `< 3600` silver, `< 4500` bronze (DAT_0092b338 / 33c / 340 = 2700 / 3600 / 4500) */
export const TIME_GOLD = 2700, TIME_SILVER = 3600, TIME_BRONZE = 4500;
/** the score counts 3 points per tick beyond 2100 ticks (70 s): the float 0x45034000 FUN_006c6d57 subtracts from the time */
export const SCORE_BASE = 2100;
/** the clock of the HUD counts down from 150 s (`0x96 - seconds`) */
export const CLOCK_START = 150;
/** FUN_006c2627 constants (the 0x8920xx float table and immediates; see the field comments) */
export const K = {
  /** DAT_00892854 0.033: the force scale of one tick */ FORCE: 0.032999999821186066,
  /** 0x3f800000 + 0x3f800000: the force-to-speed constants of the ctor */
  GRAVITY_Y: f32(-0.0153125) /* DAT_0089285c */,
  PHASE_TICKS: 30 /* +0xf0 (0x41f00000) */,
  WRONG_WAY_TICKS: 90 /* +0xe8 (0x42b40000) */,
  WRONG_WAY_DOT: f32(-0.33) /* DAT_00892834 */,
  FINISH_T: 0.938 /* double at 0x892840 */,
  START_T: 0.0275 /* double at 0x892848 */,
} as const;

/** one of the four wheels: struct of 0x44 bytes at node + 0x288 + 0x44 * k (W[i] = dword i) */
export interface Wheel {
  /** W[0] steer yaw added to the car's heading (ry of the wheel matrix) */
  steer: number;
  /** W[1] roll angle (rx) */
  roll: number;
  /** W[2] roll speed */
  rollSpeed: number;
  /** W[5] radius factor (0.5) */
  radius: number;
  /** W[7..9] local offset of the wheel in the car (the wheel record's place at start) */
  at: [number, number, number];
  /** W[11..13] attach point offsets (+-3.6, 0, +-6.4) used for the speed of the wheel and the ground sampling */
  att: [number, number, number];
  /** W[14..16] world position of the attach point */
  pos: [number, number, number];
  rec: GameRecord;
}

export class SpeedsterNode implements BehaviourNode {
  readonly kind = 'SpeedStr';
  var = 2; mask = 0; value = 0;
  stamp = 0xfffffffe;
  shared: DspShared;
  rec: GameRecord;
  driver: GameRecord;
  readonly wheels: Wheel[] = [];
  // ---- fields by node offset
  /** +0x1c the race clock in ticks (counts while the state is 4 / 5, not during a time bonus) */
  clock = 0;
  /** +0x20 the buttons of the previous tick (for the new-press mask) */
  prevButtons = 0;
  /** +0x24 / +0x28 / +0x2c accelerator ramp, rate, max; +0x30 / +0x34 / +0x38 brake ramp; +0x3c / +0x40 / +0x44 steering ramp */
  accel = 0; accelRate = 0.0625; accelMax = 1;
  brake = 0; brakeRate = 0.125; brakeMax = 1;
  steer = 0; steerRate = 0.0625; steerMax = 1;
  /** +0x58 spin (whirlwind) active, +0x5c phase, +0x60 timer, +0x64 length 15, +0x68 the vertical kick 0.3 */
  spin = 0; spinPhase = 0; spinTimer = 0; spinLen = 15; spinKick = f32(0.30625) /* 0x3e9ccccd */;
  /** +0x6c shrunk, +0x70 phase, +0x74 scale, +0x78 target scale 0.5, +0x7c timer, +0x80 / +0x84 / +0x88 shrink / hold / grow ticks (30 / 150 / 30) */
  shrunk = 0; shrinkPhase = 0; scale = 0; scaleMin = 0.5; shrinkTimer = 0; shrinkIn = 30; shrinkHold = 150; shrinkOut = 30;
  /** +0x8c turbo active, +0x90 timer, +0x94 multiplier 1.15, +0x98 length 60 */
  turbo = 0; turboTimer = 0; turboMul = f32(1.15); turboLen = 60;
  /** +0x9c heading change running, +0xa0 timer, +0xa4 length, +0xa8 from, +0xac to, +0xb0 total turn */
  turn = 0; turnTimer = 0; turnLen = 0; turnFrom = 0; turnTo = 0; turnDelta = 0;
  /** +0xb4 finish autopilot, +0xb8 timer, +0xbc length (60), +0xc0 gain, +0xc4 / +0xcc target x / z, +0xd0 */
  auto = 0; autoTimer = 0; autoLen = 60; autoGain = 0; autoX = 0; autoZ = 0; _d0 = 0;
  /** +0xd4 time bonus active, +0xd8 bonus ticks left, +0xdc bonus length (45) */
  bonus = 0; bonusLeft = 0; bonusLen = 45;
  /** +0xe0 / +0xe4 / +0xe8 / +0xec / +0xf0: wrong-way counter state, phase counter, phase length 30 */
  wrongWay = 0; wrongTimer = 0; wrongLimit = 90; phaseTimer = 0; phaseLen = 30;
  /** +0xf4 / +0xf8: the race started flag / ticks since the start (the original keeps it for the replay) */
  started = 0; startedTicks = 0;
  /** +0x240 current top speed, +0x244 current acceleration scale, +0x248 drag, +0x24c force scale, +0x250 normal accel scale, +0x254 brake force, +0x258 forward speed */
  topSpeed = f32(0.45); accelScale = 0.5; drag = f32(0.075); forceScale = 1; accelNormal = 0.5; brakeForce = 0.5; fwdSpeed = 0;
  /** +0x25c last acceleration, +0x260 normal top speed, +0x264 lateral slip limit, +0x268 angular damping, +0x26c reverse limit */
  lastAccel = 0; topNormal = f32(0.45); slipMax = f32(0.016666668); angDamp = f32(0.2); reverseMax = -0.125;
  /** +0x278 / +0x27c / +0x280 velocity, +0x284 turn rate */
  vx = 0; vy = 0; vz = 0; yawRate = 0;
  /** +0x398 / +0x39c / +0x3a0 ground normal, +0x3a4 on the ground (1 / 0), +0x3a8 suspension bounce, +0x3ac stuck counter, +0x410 turbo speech spoken */
  nx = 0; ny = 1; nz = 0; grounded = 1; bounce = 0; stuck = 0; turboSpoken = 0;
  /** +0x3b0 .. : the three probe points of the body (front, rear, centre) */
  readonly probes: [number, number, number][] = [[0, f32(1.6), f32(3.6)], [0, f32(1.6), f32(-3.6)], [0, f32(1.6), 0]];
  /** the clip of the driver figure chosen this tick (local_124) */
  clip = 10;
  /** the last tick's hit record name / kind (tests, debug) */
  lastHit = '';
  /** crash counters for the results */
  hits = 0;
  /** the replay slot of this tick */
  slot = -1;
  /** the buttons the update reads (tests set them through `inputOverride`) */
  inputOverride: ((held: number) => number) | null = null;
  analog = 0;
  /** the nearest path parameter of the last tick (FUN_004478f0), the debugging view of the camera and the end test */
  pathT = 0;

  constructor(shared: DspShared) { this.shared = shared; this.rec = null as unknown as GameRecord; this.driver = null as unknown as GameRecord; }

  /**
   * FUN_006c6495 once the records exist: the wheel table (W0 = front left WEFL record 37, W1 = front right WEFR 36, W2 = rear left WEBL 35, W3 = rear right WEBR 34),
   * the driver figure (record 13), then `init`
   */
  bind(w: World, rec: GameRecord) {
    this.rec = rec; this.driver = w.records[REC.MFIG];
    const wheelRecs = [w.records[REC.WEFL], w.records[REC.WEFR], w.records[REC.WEBL], w.records[REC.WEBR]];
    const at: [number, number, number][] = ([[-1.832, 1.088, 3.191], [1.832, 1.088, 3.191], [-1.619, 1.088, -3.292], [1.619, 1.088, -3.292]] as [number, number, number][]).map((r) => r.map(f32) as [number, number, number]);   // 0xbfea7efa / 0x3f8b4396 / 0x404c3958, 0xbfcf3b64 / 0xc052b021
    const att: [number, number, number][] = ([[-3.6, 0, 6.4], [3.6, 0, 6.4], [-3.6, 0, -6.4], [3.6, 0, -6.4]] as [number, number, number][]).map((r) => r.map(f32) as [number, number, number]);
    this.wheels.length = 0;
    for (const wr of wheelRecs) wr.colObj = null;          // FUN_006c6495: *(wheel record + 0x58) = 0, the wheels do not collide
    for (let k = 0; k < 4; k++) this.wheels.push({ steer: 0, roll: 0, rollSpeed: 0, radius: 0.5, at: at[k], att: att[k], pos: [0, 0, 0], rec: wheelRecs[k] });
    this.init(w);
  }

  /** FUN_006c6495 body: put the car on its start place, find the ground normal, start the driver clip 10 and pose the wheels */
  init(w: World) {
    const rec = this.rec;
    this.shared.replay.reset();
    rec.x = START.x; rec.y = START.y; rec.z = START.z;
    // FUN_00441ac0(rec, pos, (0, 100, 0), ...): the probe upwards (the ground record is skipped); no hit: normal (0, 1, 0)
    const hit = w.col.probe(rec, [rec.x, rec.y, rec.z], [0, 100, 0], 3);
    let n: [number, number, number] = hit ? [...hit.normal] as [number, number, number] : [0, 1, 0];
    normalize24(n);
    this.nx = n[0]; this.ny = n[1]; this.nz = n[2];
    this.driver.anim?.start(10, 0);
    this.poseWheels(w);
    this.carMatrix(w, 10);
  }

  // ------------------------------------------------------------------ helpers

  /** FUN_006c550f: the input ramps. buttons bit 1 = left (steer to -max), 2 = right, 0x24 accelerate, 0x18 brake / reverse; analog `char` beyond +-0x20 sets the steer directly */
  private ramps(buttons: number, analog: number, dt: number) {
    if ((buttons & 1) === 0) {
      if ((buttons & 2) === 0) {
        const d = f32(f32(this.steerRate * dt) * 2);
        if (this.steer <= d) this.steer = -d <= this.steer ? 0 : f32(this.steer + d); else this.steer = f32(this.steer - d);
      } else {
        let v = f32(this.steer + f32(this.steerRate * dt));
        if (this.steerMax < v) v = this.steerMax;
        this.steer = f32(v);
      }
    } else {
      let v = f32(this.steer - f32(this.steerRate * dt));
      if (v < -this.steerMax) v = -this.steerMax;
      this.steer = f32(v);
    }
    if (analog < -0x20 || analog > 0x20) this.steer = f32((analog << 5) * this.steerMax);
    if ((buttons & 0x24) === 0) this.accel = 0;
    else { let v = f32(this.accel + f32(this.accelRate * dt)); if (this.accelMax < v) v = this.accelMax; this.accel = f32(v); }
    if ((buttons & 0x18) === 0) this.brake = 0;
    else { let v = f32(this.brake + f32(this.brakeRate * dt)); if (this.brakeMax < v) v = this.brakeMax; this.brake = f32(v); }
  }

  /** FUN_006c583e: the four wheels (roll with the speed at the attach point, steer angle, matrix = wheel-local * car) */
  poseWheels(w: World) {
    const car = this.rec, yaw = car.ry, dt = w.dt;
    if (this.grounded !== 0) {
      for (const wh of this.wheels) {
        const om = f32(this.yawRate * 0.0625);
        const lx = wh.att[0], lz = wh.att[2];
        const sin = Math.sin(yaw), cos = Math.cos(yaw);
        const xo = f32(f32(sin * lz) + f32(cos * lx));                 // local_2c
        const zo = f32(f32(cos * lz) + (f32(-sin * lx)));              // local_24
        const vx = f32(-(f32(f32(zo * 0.125) * om)) + this.vx);        // local_3c
        const vz = f32(f32(f32(xo * 0.125) * om) + this.vz);           // local_34
        wh.pos[0] = f32(xo + car.x); wh.pos[1] = f32(0 + car.y); wh.pos[2] = f32(zo + car.z);
        const ws = f32(Math.sin(f32(yaw + wh.steer))), wc = f32(Math.cos(f32(yaw + wh.steer)));
        const proj = f32(f32(f32(ws * vx) + f32(wc * vz)) * 1.0);
        wh.rollSpeed = f32(f32(proj * 8) * wh.radius);
      }
    }
    for (const wh of this.wheels) {
      wh.roll = f32(f32(wh.rollSpeed * dt) + wh.roll);
      const local = euler24(wh.roll, wh.steer, 0, wh.at[0], wh.at[1], wh.at[2]);
      wh.rec.m.set(mulGame(local, car.m));
    }
  }

  /** FUN_006c5afb(car, node, clip): the car's matrix from the yaw, tilted onto the ground (FUN_006c5d84), the shrink scale, the driver (FUN_006c61cf) and the bounce decay */
  carMatrix(w: World, clip: number) {
    const car = this.rec;
    car.m.set(euler24(0, car.ry, 0, car.x, car.y, car.z));
    this.tilt(w);
    if (this.shrunk !== 0) {
      const s = this.scale, m = car.m;
      m[0] *= s; m[4] *= s; m[8] *= s; m[1] *= s; m[5] *= s; m[9] *= s; m[2] *= s; m[6] *= s; m[10] *= s;
    }
    this.poseDriver(w, -this.bounce, this.steer, clip);
    this.bounce = f32(this.bounce - f32(K.GRAVITY_Y * w.dt));
    if (this.bounce > 0) this.bounce = 0;
  }

  /**
   * FUN_006c5d84(matrix, yaw, car, node): the matrix rows from the ground under the four attach points (front-left, front-right, rear-left, rear-right), 24-bit x87:
   * x = (cos ax + az sin) + car.x, z = ((-sin) ax + az cos) + car.z (sin / cos of the float yaw rounded to floats), y = the terrain (FUN_0043ce45, 4 above) or the car's y;
   * N = (P3 - P0) x (P2 - P1) normalised, d = (N.x sin + N.y 0) + N.z cos, F = (sin - d N.x, 0 - d N.y, cos - d N.z) normalised, R = N x F; rows R, N, F.
   */
  private tilt(w: World) {
    const car = this.rec, m = car.m;
    const yaw = f32(car.ry);
    const sin = f32(Math.sin(yaw)), cos = f32(Math.cos(yaw));
    const P: [number, number, number][] = [];
    for (const wh of this.wheels) {
      const ax = wh.att[0], az = wh.att[2];
      const x = f32(f32(f32(cos * ax) + f32(az * sin)) + car.x);
      const z = f32(f32(f32(-sin * ax) + f32(az * cos)) + car.z);
      let y = terrain(w, x, car.y, z, 4.0);
      if (y === NO_GROUND) y = car.y;
      P.push([x, y, z]);
    }
    const v1 = [f32(P[3][0] - P[0][0]), f32(P[3][1] - P[0][1]), f32(P[3][2] - P[0][2])];
    const v2 = [f32(P[2][0] - P[1][0]), f32(P[2][1] - P[1][1]), f32(P[2][2] - P[1][2])];
    const n = [...cross24(v1, v2)];
    normalize24(n);
    const dot = f32(f32(f32(n[0] * sin) + f32(n[1] * 0)) + f32(n[2] * cos));
    const f = [f32(sin - f32(dot * n[0])), f32(0 - f32(dot * n[1])), f32(cos - f32(dot * n[2]))];
    normalize24(f);
    const r = cross24(n, f);
    m[0] = r[0]; m[1] = r[1]; m[2] = r[2];
    m[4] = n[0]; m[5] = n[1]; m[6] = n[2];
    m[8] = f[0]; m[9] = f[1]; m[10] = f[2];
    m[12] = car.x; m[13] = car.y; m[14] = car.z;
  }

  /** FUN_006c61cf(car, lean, steer, clip): the driver figure (record 13, the MFIG rig): clip 10 shows the frame of the steering (0 .. count - 1), other clips play once and fall back to 10 */
  private poseDriver(_w: World, lean: number, steer: number, clip: number) {
    const d = this.driver, a = d.anim;
    if (a) {
      const cur = a.clip;
      const seek = () => { const h = f32((f32(a.frameCount - 1)) * 0.5); a.seek(f32(f32(h * steer) + h)); };
      if (clip === 10 || clip === cur) {
        if (cur === 10) seek();
        else {
          const r = a.advance(1.0);
          if (r !== 0 && cur !== 8) { a.start(10, 0); seek(); }
        }
      } else a.start(clip, 0);
    }
    d.m.set(this.rec.m);
    if (lean > 0) {
      const k = f32(lean * 8);
      d.m[12] += f32(this.rec.m[4] * k); d.m[13] += f32(this.rec.m[5] * k); d.m[14] += f32(this.rec.m[6] * k);
    }
    d.variant = this.rec.variant;
  }

  /** FUN_006c209d(car, hitRecord, node, normal): bounce off the record (the normal's y is zeroed, the velocity is reflected, halved and pushed 0.05 along the normal) */
  private bounceOff(n: [number, number, number]) {
    n[1] = 0;
    norm(n);
    const k = -(f32((f32(f32(n[2] * this.vz) + f32(n[0] * this.vx))) * 1.0));
    this.vx = f32(f32((f32(n[0] + n[0])) * k) + this.vx);
    this.vz = f32(f32((f32(n[2] + n[2])) * k) + this.vz);
    this.vx = f32(this.vx * 0.5); this.vz = f32(this.vz * 0.5);
    this.vx = f32(f32(F05 * n[0]) + this.vx);
    this.vz = f32(f32(n[2] * F05) + this.vz);
    this.yawRate = 0;
  }

  /** FUN_006c52d9: the shrink: 30 ticks down to the target scale (a cosine-shaped ease), 150 ticks small, 30 ticks back; returns true while active */
  private shrinkStep(): boolean {
    this.shrinkTimer = f32(f32(1.0 * 1) + this.shrinkTimer);
    const t = this.shrinkTimer, s1 = this.scaleMin;
    let v = NaN;
    switch (this.shrinkPhase) {
      case 0:
        if (t <= this.shrinkIn) {
          const f = f32((f32(this.shrinkIn - t)) / this.shrinkIn), a = f32((f32(1 - s1)) * f);
          v = f32(f32(f32(f32(a * 0.5) * Math.sin(f32((f32(f + f)) * TWO_PI))) + a) + s1);
        } else { this.shrinkTimer = 0; this.shrinkPhase = 1; v = s1; }
        break;
      case 1:
        v = s1;
        if (this.shrinkHold < t) { this.shared.sounds.play(SND.ENLARGE); this.shrinkPhase = 2; this.shrinkTimer = 0; }
        break;
      case 2:
        if (t <= this.shrinkOut) {
          const f = f32(t / this.shrinkIn), a = f32((f32(1 - s1)) * f);
          v = f32(f32(f32(f32(a * 0.5) * Math.sin(f32((f32(f + f)) * TWO_PI))) + a) + s1);
        } else { this.shrinkTimer = 0; this.shrinkPhase = 3; v = 1; this.shared.set(VAR.SHRINK, 0); }
        break;
      case 3: this.shrunk = 0; v = 1; break;
    }
    this.scale = f32(v);
    this.topSpeed = f32(this.topNormal * v);
    return s1 !== 0;
  }

  /** FUN_006c1e70(car, yaw, target): the whirlwind spin: 15 ticks of a growing turn rate, then it decays, then a heading change to `target` starts; returns true while active */
  private spinStep(yaw: number, target: number): boolean {
    switch (this.spinPhase) {
      case 0:
        this.spinTimer = f32(1.0 + this.spinTimer);
        if (this.spinLen <= this.spinTimer) this.spinPhase = 1;
        this.yawRate = f32(f32((f32(this.spinTimer / this.spinLen)) * 0.7853981852531433) * 16);
        break;
      case 1:
        this.yawRate = f32(this.yawRate - f32(f32(this.yawRate * 0.125) * 1.0));
        if (this.yawRate < 2.7925119400024414) {
          this.yawRate = 0; this.spinPhase = 2;
          this.turn = 1; this.turnTimer = 0; this.turnLen = 10; this.turnTo = target; this.turnFrom = yaw;
          let d = f32(this.turnTo - this.turnFrom);
          while (PI < d) d = f32(d - TWO_PI);
          while (d < PI) d = f32(d + TWO_PI);   // sic: the second loop tests against +pi (the result is turn + 2 pi)
          this.turnDelta = f32(d);
        }
        break;
      case 2: if (this.turn === 0) this.spinPhase = 3; break;
      case 3:
        if (this.grounded !== 0) { this.shared.set(VAR.SPIN, 0); this.spin = 0; this.spinPhase = 3; }
        break;
    }
    return true;
  }

  /** FUN_006c2253: the finish: heading change towards the track direction + 3 pi / 4 at path position 0.958 (0x3f753f7d), the autopilot (60 ticks) to the point on the track */
  private startFinish() {
    const fr = this.shared.track.frame(0.9580000042915344, true);
    const target = f32(Math.atan2(fr.d2[0], fr.d2[2]) + 2.356194496154785);   // DAT_0089282c = 3 pi / 4
    this.turnTo = target;
    this.turnFrom = this.rec.ry;
    if (PI < this.turnTo) this.turnTo = f32(this.turnTo - TWO_PI);
    let d = f32(this.turnTo - this.turnFrom);
    while (PI < d) d = f32(d - TWO_PI);
    while (d < -PI) d = f32(d + TWO_PI);
    this.turnDelta = f32(d);
    this.turnTimer = 0; this.turnLen = 60; this.turn = 1;
    this.autoX = fr.p[0]; this.autoZ = fr.p[2];
    this.autoTimer = 0; this.autoLen = 60; this.autoGain = f32(1.3329999446868896 / 60); this.auto = 1; this._d0 = 0;
  }

  /** FUN_006c6d57: medal, record, score */
  private finishScore(): number {
    const t = this.clock;
    let medal: number;
    if (t >= TIME_GOLD) {
      if (t >= TIME_SILVER) {
        if (t >= TIME_BRONZE) { this.shared.set(VAR.RESULT, 0); medal = 0; }
        else { this.shared.set(VAR.RESULT, 1); this.shared.bertha?.show(3); medal = 1; }
      } else { this.shared.set(VAR.RESULT, 2); this.shared.bertha?.show(4); medal = 2; }
    } else { this.shared.set(VAR.RESULT, 3); this.shared.bertha?.show(2); medal = 3; }
    const best = this.shared.get(VAR.BESTTIME);
    if (t < best) { this.shared.set(VAR.RECORD, 1); this.shared.set(VAR.BESTTIME, Math.trunc(t)); }
    if (this.shared.get(VAR.TROPHY) < medal) this.shared.set(VAR.TROPHY, medal);
    // the score: 10000 - 3 * ftol(max(0, t - 2100)): the asm subtracts the float 0x45034000 (70 s) before the ftol (the decompile lost it)
    let over = f32(t - SCORE_BASE); if (over < 0) over = 0;
    this.shared.score = Math.max(0, f32(10000 - f32(3 * Math.trunc(over))));
    if (this.shared.get(VAR.HISCORE) < this.shared.score) this.shared.set(VAR.HISCORE, this.shared.score);
    return medal;
  }

  // ------------------------------------------------------------------ the update

  update(w: World, rec: GameRecord, _c: Controller): number {
    const sh = this.shared, dt = w.dt;
    const e4 = f32(K.FORCE * dt);                    // local_e4
    let limited = 0;                                 // local_6c
    let free = 1;                                    // local_18
    let clip = 10;                                   // local_124
    let state = sh.get(VAR.STATE);                   // local_64
    const oldX = rec.x, oldY = rec.y, oldZ = rec.z;
    let tCur = sh.track.nearest([rec.x, rec.y, rec.z]);   // local_e8
    this.pathT = tCur;
    this.poseGroundSamples();
    const fallThrough = (): boolean => {
      // states 0 / 1 / 2 / 3 do not run the physics
      this.carWheels(w, clip);
      return true;
    };
    switch (state) {
      case 0: case 1:
        return this.finishTick(w, clip, true);
      case 2: case 3:
        this.phaseTimer = f32(this.phaseTimer + dt);
        if (this.phaseLen < this.phaseTimer) { this.phaseTimer = 0; sh.set(VAR.STATE, f32(state + 1)); }
        return this.finishTick(w, clip, true);
      case 4:
        this.phaseTimer = f32(this.phaseTimer + dt);
        if (this.phaseLen < this.phaseTimer) { this.phaseTimer = 0; sh.set(VAR.STATE, 5); }
        this.poseWheels(w);          // FUN_006c583e only (no FUN_006c5afb): then the race code below runs in the same tick
        break;
      case 7: return NODE_CONTINUE;
    }
    void fallThrough;
    // ---------------------------------------------------------------- default: states 4, 5, 6
    let buttons: number, analog: number;
    if (sh.get(VAR.REPLAY) === 0) {
      buttons = (this.inputOverride ? this.inputOverride(w.input.held) : w.input.held) & 0xff;
      analog = this.analog;
      this.slot = sh.replay.reserve(0xc);
    } else {
      const at = sh.replay.peek();
      if (at < 0) { sh.set(VAR.STATE, STATE.DONE); buttons = 0; analog = 0; }
      else { const s = sh.replay.get(at); buttons = s.buttons & 0xff; analog = s.x; }
    }
    const pressed = (buttons ^ this.prevButtons) & buttons;
    this.prevButtons = buttons;
    if (pressed & 0x40) {
      const r = sh.rng.int(3);
      sh.sounds.play(r === 0 ? SND.HONK1 : r === 1 ? SND.HONK2 : SND.HONK3);
      clip = 6;
    }
    // the clock
    if (this.bonus === 0) {
      if (state !== STATE.FINISH) this.clock = f32(this.clock + dt);
    } else {
      this.started = 1;
      if (this.bonusLeft <= 0) { this.clock = f32(this.clock - this.bonusLeft); this.bonus = 0; sh.tintLeft = 0x7f7f7f; sh.set(VAR.BONUS, 0); }
      this.bonusLeft = f32(this.bonusLeft - dt);
    }
    if (this.started !== 0) this.startedTicks = f32(this.startedTicks + dt);
    sh.clock = this.clock;
    let rem = f32(CLOCK_START - Math.trunc(f32(this.clock / 30)));
    if (rem < 0) rem = 0;
    sh.clockText = `${Math.trunc(f32(rem / 60))}:${String(rem % 60).padStart(2, '0')}`;
    if (sh.get(VAR.SPIN) === 1) {
      this.spin = 1; sh.set(VAR.SPIN, 2);
      this.vx = 0; this.vy = this.spinKick; this.vz = 0;
      this.spinTimer = 0; this.spinPhase = 0; clip = 8;
    }
    if (sh.get(VAR.SHRINK) === 1) {
      this.shrunk = 1; sh.set(VAR.SHRINK, 2);
      sh.sounds.play(SND.SHRINK);
      this.shrinkPhase = 0; this.scale = dt; this.shrinkTimer = 0;
      sh.say('ADSGDS11');
    }
    const yaw = rec.ry;                              // local_b8
    if (this.shrunk !== 0 && this.shrinkStep()) clip = 7;
    if (this.spin !== 0 && this.spinStep(yaw, 0.0)) clip = 7;
    // the turbo ends
    if (this.turbo !== 0) {
      this.turboTimer = f32(this.turboTimer + dt);
      if (this.turboLen <= this.turboTimer) {
        this.topSpeed = this.topNormal; this.accelScale = this.accelNormal; this.turbo = 0;
        sh.tintRight = 0x7f7f7f; sh.set(VAR.TURBO, 0);
      }
    }
    // the heading change (wall bounce, spin recovery, finish)
    if (this.turn !== 0) {
      if (this.turnLen <= this.turnTimer) { this.turn = 0; this.yawRate = 0; }
      else {
        this.turnTimer = f32(this.turnTimer + dt);
        this.yawRate = f32((f32(this.turnDelta * 16)) / this.turnLen);
        buttons = 0;
      }
    }
    // the finish autopilot
    if (this.auto !== 0) {
      this.autoTimer = f32(this.autoTimer + dt);
      if (this.autoLen <= this.autoTimer) { this.vx = 0; this.vz = 0; this.auto = 0; sh.set(VAR.STATE, STATE.DONE); this._d0 = 0; }
      else {
        const g = this.autoGain;
        this.vx = f32(f32((f32(this.autoX - rec.x)) * 0.125) * g);
        this.vz = f32(f32((f32(this.autoZ - rec.z)) * 0.125) * g);
      }
    }
    this.ramps(buttons, analog, dt);
    // ---- the forces along the car's heading (FUN_006c2627 after FUN_006c550f)
    let acc = f32(this.accelScale * this.accel);                 // local_60 = +0x244 * +0x24
    if (this.topSpeed < this.fwdSpeed) acc = this.accelScale;
    acc = f32((f32(this.topSpeed - this.fwdSpeed)) * acc);
    let brakeF: number;                                          // local_1c
    if (0 <= this.fwdSpeed) brakeF = f32(-(f32(this.brake * this.brakeForce)));
    else {
      if (this.reverseMax <= this.fwdSpeed) {
        if (this.auto === 0 && (buttons & 0x24) === 0) brakeF = f32(this.brake * this.brakeForce); else brakeF = 0;
      } else brakeF = this.brakeForce;
      brakeF = f32((f32(brakeF + brakeF)) * (f32(this.reverseMax - this.fwdSpeed)));
    }
    brakeF = f32(-(f32(this.drag * this.fwdSpeed)) + brakeF);
    const total = f32(f32(this.forceScale * f32(acc + brakeF)) * e4);       // asm 0x6c3178..: (forceScale * (acc + brake)) * e4    // local_54
    const newFwd = f32(this.fwdSpeed + total);                   // local_f8
    this.lastAccel = f32(total);
    this.fwdSpeed = f32(newFwd);
    let turnRate = f32(this.steer * 0.7853981852531433);         // local_c8 = steer * pi / 4 (DAT_0089252c)
    this.wheels[0].steer = this.wheels[1].steer = f32(turnRate);   // +0x288 / +0x2cc: the front wheels steer
    // gravity and the slope
    this.vx = f32(this.vx + 0); this.vy = f32(this.vy + K.GRAVITY_Y); this.vz = f32(this.vz + 0);
    const rx = f32(Math.cos(yaw)), rz = f32(-Math.sin(yaw));                                 // the right vector (local_c4, local_c0 = 0, local_bc)
    // R x N: the forward direction along the slope
    const fa = f32(f32(0 * this.nz) - f32(rz * this.ny));
    const fb = f32(f32(rz * this.nx) - f32(rx * this.nz));
    const fc = f32(f32(rx * this.ny) - f32(0 * this.nx));
    let px = f32(fa * total), py = f32(fb * total), pz = f32(fc * total);       // local_50 / 4c / 48
    if (this.grounded !== 0) {
      px = f32(-(f32(this.nx * K.GRAVITY_Y)) + px); py = f32(-(f32(this.ny * K.GRAVITY_Y)) + py); pz = f32(-(f32(this.nz * K.GRAVITY_Y)) + pz);
    }
    this.vx = f32(px + this.vx); this.vy = f32(py + this.vy); this.vz = f32(pz + this.vz);
    // the side slip is cancelled up to the limit
    let side = f32(-(f32(f32(f32(rx * this.vx) + f32(0 * this.vy)) + f32(rz * this.vz))));      // asm 0x6c35a0: (rx vx + 0 vy) + rz vz     // local_cc
    if (side !== 0) {
      const lim = this.slipMax;
      if (lim < side) { limited = 1; side = lim; }
      if (side < -lim) { side = -lim; limited = 1; }
      this.vx = f32(f32(rx * side) + this.vx); this.vz = f32(f32(rz * side) + this.vz); this.vy = f32(f32(0 * side) + this.vy);
    }
    // the push of the whirlwind
    this.vx = f32(sh.push[0] + this.vx); this.vy = f32(sh.push[1] + this.vy); this.vz = f32(sh.push[2] + this.vz);
    sh.push[0] = 0; sh.push[1] = 0; sh.push[2] = 0;
    let nxp = f32(f32((f32(f32(this.vx * dt) + 0)) * 8) + oldX);                // local_88
    let nyp = f32(f32((f32(f32(this.vy * dt) + 0)) * 8) + oldY);                // local_84 (the +16 for the ray comes after the turn rate)
    let nzp = f32(f32((f32(f32(this.vz * dt) + 0)) * 8) + oldZ);                // local_80
    // the turn rate
    turnRate = f32(turnRate * 0.25);
    if (newFwd < 0) turnRate = -turnRate;
    this.yawRate = f32(f32(dt * turnRate) + this.yawRate);
    let newYaw = f32(f32(f32(this.yawRate * dt) * 0.0625) + yaw);          // local_128
    while (PI < newYaw) newYaw = f32(newYaw - TWO_PI);
    while (newYaw < -PI) newYaw = f32(newYaw + TWO_PI);
    this.yawRate = f32(this.yawRate - f32(f32(this.yawRate * dt) * this.angDamp));
    // ---- the ground: a ray down from 16 above the new place against the LAND record
    nyp = f32(nyp + 16.0);
    let groundY = -1e38;                                         // local_fc
    const land = w.records[REC.LAND];
    let gh = null as ReturnType<typeof w.col.rayRecord>;
    if (land) gh = w.col.rayRecord(land, [nxp, nyp, nzp], [0, -800, 0], 3, 0.01, 0.01);
    let gn: [number, number, number];
    if (!gh) gn = [0, 1, 0];
    else { groundY = gh.point[1]; gn = [gh.normal[0], gh.normal[1], gh.normal[2]]; }
    nyp = f32(nyp - 16.0);
    let ground: number;                                          // local_68
    if (groundY === -1e38) ground = oldY;
    else { ground = groundY; norm(gn); this.nx = gn[0]; this.ny = gn[1]; this.nz = gn[2]; }
    if (this.grounded === 0) {
      if (nyp <= ground) {
        this.vy = f32(f32((f32(ground - nyp)) * 0.125) + this.vy);
        nyp = ground; this.grounded = 1;
      }
    } else if (nyp <= ground) {
      nyp = ground;
      this.vy = f32(f32((f32(ground - ground)) * 0.125) + this.vy);
      this.grounded = 1;
    } else this.grounded = 0;
    // ---- the path: where is the car, which way does the track go
    let wall = 0;                                                 // local_1f4
    const tail = sh.track.frame(tCur, true);                      // FUN_00445680(path, local_e8, ., ., 2)
    const trackT = tail.t;                                        // local_f4 / f0 / ec
    if (free !== 0) {
      // the two side probes at the track's left / right: terrain walls (hits named LAND) bounce the car back
      const R = tail.r;
      const from: [number, number, number] = [nxp, f32(nyp + 10), nzp];
      const left: [number, number, number] = [f32(-2 * R[0]), f32(-2 * R[1]), f32(-2 * R[2])];
      const right: [number, number, number] = [f32(2 * R[0]), f32(2 * R[1]), f32(2 * R[2])];
      if (w.col.debug) {   // FUN_00445ba0 x2 (LE2.c:176990 / 176994; Ontwikkelaarshoek): the two side probes, white (left) and blue (right), each from the probe end to the start point
        w.col.debug.line('zone', [from[0] + left[0], from[1] + left[1], from[2] + left[2]], from, 0xffffffff, 0xffffffff);
        w.col.debug.line('zone', [from[0] + right[0], from[1] + right[1], from[2] + right[2]], from, 0xff0000ff, 0xff0000ff);
      }
      const hl = w.col.sweep(rec, from, left, 3, 2.0, 1.6);
      let nrm: number[] = hl ? hl.normal : [0, 0, 0];
      if (hl && hl.rec.name === 'LAND') { wall = 1; this.vy = 0; }
      const hr = w.col.sweep(rec, from, right, 3, 2.0, 1.6);
      if (hr) nrm = hr.normal;
      if (hr && hr.rec.name === 'LAND') { wall = 2; this.vy = 0; }
      // the wall's tangent in the horizontal plane
      // (local_b4, local_b0, local_ac) = (-nz, 0, nx), FUN_0043cec0; the right wall flips both
      const tv = [-nrm[2], 0, nrm[0]];
      normalize24(tv);
      let tx = tv[0], tz = tv[2];
      if (wall === 2) { tx = -tx; tz = -tz; }
      const tHead = f32(Math.atan2(tx, tz));                      // local_268
      if (wall !== 0) {
        free = 0;
        sh.sounds.play(sh.rng.int(2) === 0 ? SND.BUMP1 : SND.BUMP2);
        const sy = f32(Math.sin(newYaw)), cy = f32(Math.cos(newYaw));
        const dotTF = f32(f32(f32(tz * cy) + f32(0 * 0)) + f32(tx * sy));                  // local_2a0
        const dotTV = f32(f32(f32(tz * this.vz) + f32(0 * this.vy)) + f32(tx * this.vx));
        let target: number, ix: number, iz: number;
        if (wall === 1) {
          target = dotTV >= 0 ? f32(tHead + 0.19634954631328583) : f32((f32(tHead + PI)) - 0.19634954631328583);
          ix = tz; iz = -tx;
        } else {
          target = dotTV >= 0 ? f32(tHead - 0.19634954631328583) : f32(f32(tHead + PI) + 0.19634954631328583);
          ix = -tz; iz = tx;
        }
        this.turnTimer = 0; this.turnLen = 10; this.turnFrom = rec.ry; this.turnTo = target;
        let d = f32(target - rec.ry);
        while (PI < d) d = f32(d - TWO_PI);
        while (d < -PI) d = f32(d + TWO_PI);
        this.turnDelta = f32(d); this.turn = 1;
        const k = -(f32(f32(f32(iz * this.vz) + f32(0 * this.vy)) + f32(ix * this.vx)));
        this.vx = f32(f32((f32(ix + ix)) * k) + this.vx);
        this.vz = f32(f32((f32(iz + iz)) * k) + this.vz);
        let dd = Math.abs(dotTF);
        if (dd < F033) dd = F033;
        this.vx = f32(this.vx * dd); this.vz = f32(this.vz * dd);
        this.vx = f32(f32(F05 * ix) + this.vx); this.vz = f32(f32(F05 * iz) + this.vz);
        if (this.grounded !== 0) this.bounce = f32(-0.153125);
      }
    }
    // ---- the general collision: from the car's middle, then along the front and rear probe lines
    const start: [number, number, number] = [rec.x, f32(rec.y + F16), rec.z];
    const dmove: [number, number, number] = [f32(nxp - rec.x), f32(nyp - rec.y), f32(nzp - rec.z)];
    let hit = w.col.sweep(rec, start, dmove, 3, 1.6, 0.8);
    if (hit && hit.rec.name === 'LAND') hit = null;
    let hitNormal: [number, number, number] = hit ? [hit.normal[0], hit.normal[1], hit.normal[2]] : [0, 0, 0];
    if (!hit) {
      const pr = this.probePoints(newYaw, [nxp, nyp, nzp]);
      const v2 = pr[2];
      hit = w.col.sweep(rec, v2, [f32(pr[0][0] - v2[0]), f32(pr[0][1] - v2[1]), f32(pr[0][2] - v2[2])], 3, 1.6, 0.8);
      if (!hit) hit = w.col.sweep(rec, v2, [f32(pr[1][0] - v2[0]), f32(pr[1][1] - v2[1]), f32(pr[1][2] - v2[2])], 3, 1.6, 0.8);
      if (hit) hitNormal = [hit.normal[0], hit.normal[1], hit.normal[2]];
    }
    let hitKind = 'none';
    if (hit && hit.rec.name !== 'LAND') {
      const hr = hit.rec, nm = hr.name;
      this.lastHit = nm;
      this.hitInfo = { point: [...hit.point], normal: [...hit.normal], t: hit.t, polygon: hit.polygon };
      if (nm === 'TIME') {
        if (hr.flags & 2) {
          hitKind = 'time';
          hr.flags &= ~2;
          sh.sounds.play(SND.BONUS);
          this.bonus = 1; this.bonusLeft = f32(this.bonusLeft + this.bonusLen);
          sh.tintLeft = 0xffffff; sh.set(VAR.BONUS, 1);
        }
      } else if (nm === 'TURB') {
        if (hr.flags & 2) {
          hitKind = 'turbo';
          hr.flags &= ~2;
          sh.sounds.play(SND.TURBO);
          if (this.turbo === 0) {
            this.topSpeed = f32(this.topNormal * this.turboMul);
            this.accelScale = f32(this.accelNormal * this.turboMul);
            sh.tintRight = 0xffffff; sh.set(VAR.TURBO, 1);
            this.turbo = 1; clip = 3;
            if (this.turboSpoken === 0) { this.turboSpoken = 1; sh.say('ADSGDS06'); }
          }
          const dv = f32(this.topSpeed - this.fwdSpeed);
          const kf = f32(this.forceScale * dv);
          this.vx = f32(f32(fa * kf) + this.vx); this.vy = f32(f32(fb * kf) + this.vy); this.vz = f32(f32(fc * kf) + this.vz);
          this.turboTimer = 0;
        }
      } else if (nm === 'COW' /* 'COW\0' = 0x574f43: the records are named COW0..2, so this branch of the original never matches them */) {
        hitKind = 'cow'; free = 0; clip = 4;
        this.cowHit(hr);
        this.bounceOff(hitNormal);
        this.rumble(0.7);
      } else if (nm === 'BBBB' || nm === 'BBBA') {
        hitKind = 'rock'; free = 0; clip = 5;
        this.rockHit(hr);
        this.bounceOff(hitNormal);
        sh.sounds.play(SND.CRASH); this.rumble(1.0);
        sh.say('ADSGDS08');
      } else if (nm === 'WHRL') {
        hitKind = 'whirl';
        this.vx = f32(this.vx * F08); this.vz = f32(this.vz * F08);
        this.rumble(0.5);
      } else if (nm === 'CATI' || nm === 'CACT') {
        if (hr.model !== sh.smashedModel) {
          hitKind = 'cactus';
          sh.sounds.play(SND.CACTUS);
          if (sh.smashedModel) hr.model = sh.smashedModel;
          sh.set(VAR.CACTUS, 1);
          this.emitStop(6); this.emitSetMatrix(6, hr.m);       // FUN_00442a40 + FUN_00442a00(cactuspop02, the cactus record's matrix)
          clip = 4;
          this.vx = f32(this.vx * F08); this.vz = f32(this.vz * F08);
          this.rumble(0.5);
        }
      } else {
        // any other solid: the generic crash
        hitKind = 'crash'; free = 0; clip = 5;
        this.bounceOff(hitNormal);
        sh.sounds.play(SND.CRASH); this.rumble(1.0);
        sh.say('ADSGDS07');
      }
      this.hits++;
    }
    this.lastHitKind = hitKind;
    // ---- commit the move (or stay when something was hit)
    if (free === 0) {
      newYaw = rec.ry;
      this.stuck++;
      if (this.stuck > 10) { this.stuck = 0; this.vx = 0; this.vz = 0; }
    } else {
      tCur = sh.track.nearest([nxp, nyp, nzp]);                    // local_e8 of the NEW place
      this.pathT = tCur;
      if (K.START_T <= tCur) {
        rec.ry = newYaw; rec.x = nxp; rec.y = nyp; rec.z = nzp;
      } else {
        // behind the start line: the car is turned along the track and pushed forward
        const f = sh.track.frame(tCur, true);
        this.turnTimer = 0; this.turnLen = 10; this.turnFrom = rec.ry;
        this.turnTo = f32(Math.atan2(f.t[0], f.t[2]));
        let d = f32(this.turnTo - rec.ry);
        while (PI < d) d = f32(d - TWO_PI);
        while (d < -PI) d = f32(d + TWO_PI);
        this.turnDelta = f32(d); this.turn = 1;
        this.vx = f32(F05 * f.t[0]); this.vy = f32(0.153125); this.vz = f32(F05 * f.t[2]);      // (local_128, the new yaw, stays as computed: only the blocked case resets it to the record's)
      }
      this.stuck = 0;
      state = sh.get(VAR.STATE);
      if (state !== STATE.DONE && state !== STATE.FINISH && tCur > K.FINISH_T) {
        this.startFinish();
        clip = 2;
        sh.set(VAR.STATE, STATE.FINISH);
        this.finishScore();
        sh.finished = true;
      }
    }
    // ---- the speed along the heading (the sound, the gauge), the wrong-way counter, the skid dust variables
    const sy = f32(Math.sin(newYaw)), cy = f32(Math.cos(newYaw));
    const sp = f32(f32(this.vz * cy) + f32(this.vx * sy));                      // local_cc
    this.fwdSpeed = f32(sp);
    if (state === STATE.DONE) sh.sounds.stop(SND.ENGINE);
    else {
      sh.sounds.rate(SND.ENGINE, Math.trunc(f32(f32(this.fwdSpeed * 44444.44) + 32000.0)));
      sh.sounds.play(SND.ENGINE);
    }
    const dotTrack = f32(f32(f32(cy * trackT[2]) + f32(0 * trackT[1])) + f32(sy * trackT[0]));
    if (K.WRONG_WAY_DOT <= dotTrack) { this.wrongTimer = 0; sh.set(VAR.WRONG_WAY, 0); }
    else if (this.wrongLimit <= this.wrongTimer) sh.set(VAR.WRONG_WAY, 1);
    else this.wrongTimer = f32(this.wrongTimer + dt);
    this.dustBlock(limited, sp);
    sh.speedMirror = this.fwdSpeed;
    sh.gauge = this.fwdSpeed >= 0 ? f32((f32(this.fwdSpeed / this.topNormal)) * f32(0.6666)) : 0;
    sh.delta[0] = f32(nxp - oldX); sh.delta[1] = f32(nyp - oldY); sh.delta[2] = f32(nzp - oldZ);
    this.carMatrix(w, clip);
    this.poseWheels(w);
    void oldY; void tail;
    return NODE_CONTINUE;
  }

  lastHitKind = 'none';
  /** the last general collision (debug) */
  hitInfo: { point: number[]; normal: number[]; t: number; polygon: number } | null = null;
  /** FUN_006c5723: the force feedback request (the output function FUN_00438518 is an empty stub in the shipped build): nothing to do */
  private rumble(_k: number) { /* FUN_00438518 is a stub */ }

  /** states 0 .. 3: the car is posed (wheels first, then the car matrix) and does nothing else */
  private finishTick(w: World, clip: number, _pre: boolean): number {
    this.poseWheels(w);
    this.carMatrix(w, clip);
    return NODE_CONTINUE;
  }
  private carWheels(w: World, clip: number) { this.poseWheels(w); this.carMatrix(w, clip); }
  /** the four ground sample matrices of the skid dust emitters (FUN_0043a5e4 + FUN_0043a9e5 at the top of the update): particles are not ported */
  private poseGroundSamples() {
    // FUN_006c2627's first lines: four matrices (identity rotation, the places of the wheels 2, 3, 0, 1 (W[7..9]) with y - 2) times the car's matrix (as it is at the start of the update)
    const E = this.shared.emit, car = this.rec;
    // (x, y) of the wheels 2, 3, 0, 1; z of the wheels 2, 3, 2, 3 (the third and fourth call read +0xac / +0xf0 for z: the original's quirk)
    const W = this.wheels, src = [[2, 2], [3, 3], [0, 2], [1, 3]];
    for (let i = 0; i < 4; i++) {
      const p = W[src[i][0]].at, q = W[src[i][1]].at;
      euler24(0, 0, 0, p[0], f32(p[1] - 2.0), q[2], E.local[i]);
      mulGame(E.local[i], car.m, E.m[i]);
    }
  }
  /** FUN_00442a00 / FUN_00442a40 of the skid / dust / cactus emitters (the handles are those of FUN_006bf633) */
  private emitSetMatrix(i: number, m: Float32Array<ArrayBufferLike>) { const f = this.shared.fx, h = this.shared.emit.h[i]; if (f && h !== undefined) f.setMatrix(h, m); }
  private emitStop(i: number) { const f = this.shared.fx, h = this.shared.emit.h[i]; if (f && h !== undefined) f.stop(h); }
  /** the dust / skid block at the end of the update (asm 0x6c4f9e..0x6c519e): the vars 0xfd / 0xfc gate the four `problow` emitters (handles 2 .. 5) */
  private dustBlock(limited: number, sp: number) {
    const sh = this.shared, E = sh.emit;
    if (this.grounded === 0) { sh.set(VAR.DUST, 0); sh.set(VAR.SKID, 0); }
    else if (limited === 0) {
      if (sp <= 0.125) { sh.set(VAR.DUST, 0); sh.set(VAR.SKID, 0); }
      else {
        if (sh.get(VAR.DUST) === 0) {
          mulGame(E.local[0], this.rec.m, E.m[0]); mulGame(E.local[1], this.rec.m, E.m[1]);
          this.emitSetMatrix(4, E.m[0]); this.emitSetMatrix(5, E.m[1]);
        }
        sh.set(VAR.DUST, 1); sh.set(VAR.SKID, 0);
      }
    } else {
      if (sh.get(VAR.DUST) === 0) {
        for (let i = 0; i < 4; i++) mulGame(E.local[i], this.rec.m, E.m[i]);
        for (let i = 0; i < 4; i++) this.emitSetMatrix(2 + i, E.m[i]);
      }
      sh.set(VAR.DUST, 1); sh.set(VAR.SKID, 1);
      for (let i = 0; i < 4; i++) this.emitStop(2 + i);
    }
  }

  /** FUN_006c2458: the world positions of the three body probes for a heading and a place (scaled by the shrink scale while shrunk) */
  private probePoints(yaw: number, pos: [number, number, number]): [number, number, number][] {
    const m = euler24(0, yaw, 0, pos[0], pos[1], pos[2]);
    const out: [number, number, number][] = [];
    for (const p of this.probes) {
      const q = this.shrunk === 0 ? p : [f32(p[0] * this.scale), f32(p[1] * this.scale), f32(p[2] * this.scale)];
      out.push([f32(f32(f32(f32(q[0] * m[0]) + f32(q[1] * m[4])) + f32(q[2] * m[8])) + m[12]), f32(f32(f32(f32(q[0] * m[1]) + f32(q[1] * m[5])) + f32(q[2] * m[9])) + m[13]), f32(f32(f32(f32(q[0] * m[2]) + f32(q[1] * m[6])) + f32(q[2] * m[10])) + m[14])]);
    }
    return out;
  }

  /** FUN_006c0039: a cow was hit (the cow plays its hit clip and a sound) */
  private cowHit(cow: GameRecord) {
    const a = cow.anim;
    if (a && a.clip !== 1) {
      this.shared.sounds.play(this.shared.rng.int(2) === 0 ? SND.COW2 : SND.COW1);
      a.start(1, 0);
    }
  }
  /** FUN_006c0af1: a rock hit: the first node of the hit record's controller is the WalkRock node; its Brickbot plays clip 12 unless it already does (a record without a controller, the bot's own BBBB, crashes the original; here nothing happens) */
  private rockHit(rock: GameRecord) {
    const node = rock.ctrl?.nodes[0] as unknown as { bot?: GameRecord | null } | undefined;
    const a = node?.bot?.anim;
    if (a && a.clip !== 12) a.start(12, 0);
  }

  destroy(): void { /* the sounds stop with the zone */ }
}

const norm = (v: number[]) => { normalize24(v); return v; };
export { REC, AnimInstance };
