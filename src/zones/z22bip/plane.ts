// z22BIP: the biplane in flight, the "Walk.c" behaviour node of the player record PEPP (constructor FUN_0070b7b2, update FUN_00709fac with FUN_0070996a /
// FUN_0070988a / FUN_00709258 / FUN_00708e17 / FUN_007091f6 / FUN_00709c5f, draw FUN_0070b58c). Gated by game variable 0xfa & 2 (flying). Node offsets of the
// original in comments (the node is 0xf10 bytes; the banana projectiles are 30 structs of 0x6c bytes from +0x118).
// Controls (FUN_004376f9 button bits): Left / Right steer, Up pitches the nose down (the altitude falls with +0x40), Down pulls up, Alt raises the thrust, Shift
// brakes (and lowers the thrust), Space fires bananas while the speed is above 320.
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { B } from '../../game/input.ts';
import { eulerMatrix, rotateVector, transformPoint, matThen } from '../common/matrix.ts';
import { eulerRotation } from '../exact.ts';
import { ad, sb, ml, adx, sbx } from '../common/f32.ts';
import { bipRun, f32, msClock, NAME, MODE, VAR_MODE } from './run.ts';
import { randF } from '../../game/crt.ts';
import type { BipRun } from './run.ts';

const F = Math.fround;
/**
 * 0x70af94 .. 0x70afa0: la = atan2 result + headCorr. FUN_0085d640 leaves its result as a full double on the x87 stack (`fst dword` stores a copy, the stack keeps the double), so
 * `fadd dword [headCorr]` adds a float to a DOUBLE and rounds the exact sum once to 24 bits (the double sum rounded to float32 would round twice on a tie): adx.
 */
export const courseHeading = (a: number, headCorr: number): number => F(adx(a, headCorr));
/**
 * 0x70b066 .. 0x70b0c2: the heading stays within +-0.9 rad of the course heading `la`. `fcomp qword` / `fadd qword` / `fsub qword` take the band as a DOUBLE: the compare is exact and the
 * new heading is the exact float + double sum rounded ONCE to 24 bits (adx / sbx), then stored as a float32.
 */
export function clampHeading(la: number, heading: number): number {
  if (sb(la, heading) < -PLANE.HEADING_BAND) heading = F(adx(la, PLANE.HEADING_BAND));
  if (PLANE.HEADING_BAND < sb(la, heading)) heading = F(sbx(la, PLANE.HEADING_BAND));
  return heading;
}

/** constructor address of the node (FUN_00423532's second argument) */
export const CTOR_WALK = 0x70b7b2;

/** the constants of the constructor and the update (float immediates / .rdata values; addresses in the comments) */
export const PLANE = {
  THRUST_STEP: 160,            // +0x20  0x43200000
  THRUST_MAX: f32(0x43a1999a), // +0x24  323.2
  BRAKE_STEP: 0.25,            // +0x2c  0x3e800000
  BRAKE_MAX: f32(0x3ecccccd),  // +0x30  0.4
  STEER_STEP: 0.5,             // +0x38  0x3f000000
  STEER_MAX: f32(0x400ccccd),  // +0x3c  2.2
  PITCH_STEP: 8,               // +0x44  0x41000000
  PITCH_MAX: 128,              // +0x48  0x43000000
  ALT_START: 40,               // +0x4c  0x42200000 (overwritten by the take-off)
  ACCEL_K: 1,                  // +0x54
  THRUST_K: 2,                 // +0x58
  BRAKE_K: 1,                  // +0x5c
  AMMO_START: 1000,            // +0x6c
  FUEL_UNIT: 6825,             // 0x931ef8: one percent of the tank
  FUEL_MAX: 100 * 6825,        // +0x70 (100 * 6825)
  HEADING_START: f32(0xc0151eb8), // +0x7c / +0xa0: -2.33 rad
  SPEED_MAX: 400,              // 0x892394
  FIRE_MIN_SPEED: 320,         // 0x8928c0
  STALL_SPEED: 12,             // 0x892024: at or below, the nose drops by 0.4 per tick instead of the pitch term
  FALL_STALL: f32(0x3ecccccd), // 0x892118
  PITCH_TO_ALT: 0.015625,      // 0x892868
  ALT_MAX: 96,                 // 0x892110
  SPEED_TURN: 1 / 256,         // 0x8928a8: 0.00390625: map units per tick per unit of speed; also the turn-rate factor
  TURN_DIV: 128,               // 0x892100
  BANK_K: f32(0x3c8efa03),     // 0x8920d8: pi / 180
  FUEL_LOW_SAY: 15,            // 0x892074: the speech "fuel warning" below 15 percent
  FUEL_LOW_ALARM: 10,          // 0x892060: the alarm sound below 10 percent
  FUEL_CAN: 50,                // 0x892254 * 6825: a can gives 50 percent
  AMMO_BUNCH: 500,             // +500 bananas (0x1f4)
  CRASH_COST: 100, SPIN_COST: 100,
  ROLL_STEP: f32(0x3eb2b884),  // 0x892150: 20 degrees per tick of the spin-out
  ROLL_END: f32(0x40c90f94),   // 0x8928d0
  TWO_PI: f32(0x40c90fdb),     // 0x892094
  HEADING_BAND: 0.9,           // the doubles 0x892890 / 0x892898 (+-0.9: `fcomp qword` / `fadd qword` / `fsub qword` operands at 0x70b06f .. 0x70b0b3, NOT cast to float): how far the heading may leave the course
  /** 0x8928a0: the double 3.1415927410125732 (= float32 pi): the wrap threshold of the course heading */
  WRAP_LIMIT: f32(0x40490fdb),
  CAM_OFFSET: [0, 6, -20] as const, // 0x40c00000 / 0xc1a00000
  CAM_LERP: f32(0x3d75c28f),   // 0.06 (0x3d75c28f)
  CAM_Y_LERP_K: 8,             // 0x892090
  CAM_ALT_LIFT: f32(0x412f5c29), // 10.96: the camera's y above the altitude while flying
  CAM_TARGET_UP: 4,            // 0x892080
  SOUND_HZ_BASE: 56750, SOUND_HZ_PER_PITCH: -65.5, // doubles 0x8928b0 / 0x8928b8: ftol(pitch * -65.5 + 56750)
  WIND_RATE_MIN: 0,
  /** the four gun mouths in the plane's frame (x, y): +0xedc .. +0xf04, used round robin (+0xf0c) */
  MUZZLE: [[f32(0xbf48b439), f32(0x40160419)], [f32(0x3f48b439), f32(0x40160419)], [f32(0xc0960419), f32(0xbf48b439)], [f32(0x40960419), f32(0xbf48b439)]] as const,
  BANANA_SPEED: f32(0x3fc8b439), // the muzzle velocity (0, 0, 1.5698) rotated by the plane's matrix
  BANANA_SPIN: f32(0x3ecccccd),  // random spin rates up to 0.4
  BANANA_STEP: 10,             // 0x892060: velocity factor per tick
  BANANA_LIFE: 0x14,           // ticks
  BANANA_SCALE: 4,
  MAX_BANANAS: 30,
  PROGRESS_AHEAD: f32(0x3c23d70a), // 0.01: the point of the course the plane is put back to after a crash
  RIVER_FROM: 0.1, RIVER_TO: 0.77,
  /** the score of the medals: result = (score - 3000) / 2000 + 2 (at least 3 once landed) */
  MEDAL_BASE: 3000, MEDAL_STEP: 2000,
} as const;

/** score values of the hits (FUN_00709258) */
export const SCORE = { MONKEY: 700, TARGET: 100, BANANA_TARGET: 20 } as const;
/** squared hit radii (compared with the truncated squared distance): monkey, BANT, DTR */
export const HIT_R2 = { MONKEY: 0x5c, BANT: 0x20, DTR: 0x30 } as const;

export interface Banana {
  /** +0x00: matrix (Euler (0, heading, 0) + position at +0x30), only the position and the heading are used */
  x: number; y: number; z: number; heading: number;
  /** +0x40 velocity */
  vx: number; vy: number; vz: number;
  /** +0x4c birth tick, +0x50 active */
  born: number; active: boolean;
  /** +0x54 spin rates, +0x60 spin angles (the draw FUN_0070b58c adds the rates AFTER it has drawn with the angles: the port adds them in the update, `dax..daz` are the angles the draw of this tick uses) */
  sx: number; sy: number; sz: number; ax: number; ay: number; az: number;
  dax: number; day: number; daz: number;
}
function newBanana(): Banana { return { x: 0, y: 0, z: 0, heading: 0, vx: 0, vy: 0, vz: 0, born: 0, active: false, sx: 0, sy: 0, sz: 0, ax: 0, ay: 0, az: 0, dax: 0, day: 0, daz: 0 }; }

/** the scale matrix of FUN_0070b58c (`local_90`): 4 on the diagonal (0x40800000), 1 in the corner */
const BANANA_SCALE_M = new Float32Array([4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]);
/**
 * FUN_0070b58c (draw): the matrix a banana is drawn with: FUN_0043a5e4(spin angles) then FUN_0043a9e5(scale 4, spin) then FUN_0043a9e5(banana record, that) = ((Euler(spin) x diag(4)) x
 * (Euler(0, heading, 0) + position)), every product the original's float32 evaluation (src/zones/common/matrix.ts). `out` receives it (row-vector 4x4).
 */
export function bananaMatrix(b: Banana, out: Float32Array = new Float32Array(16)): Float32Array {
  const spin = matThen(eulerMatrix(b.dax, b.day, b.daz), BANANA_SCALE_M);
  out.set(matThen(spin, eulerMatrix(0, b.heading, 0, b.x, b.y, b.z)));
  return out;
}

/** FUN_0043abe6: a direction through the rotation part of a row-vector matrix (the original's float32 operations) */
export const rotateDir = (m: ArrayLike<number>, v: ArrayLike<number>): number[] => rotateVector(m, v);
export { transformPoint };
/** FUN_0043a4a1: rebuild the rotation of a record's matrix from Euler angles and keep its translation */
export function setRotation(rec: GameRecord, rx: number, ry: number, rz: number) {
  eulerRotation(rec.m, F(rx), F(ry), F(rz));
}
/** FUN_0043a9e5(out, p2, p3): out = p3 * p2 (row vectors: p3 applies first) */
export const mul4 = matThen;

/**
 * The camera behind the plane (the end of FUN_00709fac, shared by FUN_0070fdc0 Recover and the pre-roll of the take-off): the look-at point is the plane 4 above, the
 * eye x / z ease 6 percent of the way to the point (0, 6, -20) of the plane's frame; y: altitude + 10.96 while flying (`ground` = the plane is on the runway after
 * the landing: the eased value), at most 112.
 */
export function followCamera(w: World, rec: GameRecord, alt: number, flying: boolean) {
  const c = w.camera.c;
  c[3] = rec.x; c[4] = ad(rec.y, PLANE.CAM_TARGET_UP); c[5] = rec.z;
  const p = transformPoint(rec.m, PLANE.CAM_OFFSET);          // FUN_0043ab72
  const k = PLANE.CAM_LERP;
  c[0] = ad(ml(sb(p[0], c[0]), k), c[0]);
  c[2] = ad(ml(sb(p[2], c[2]), k), c[2]);
  c[1] = ad(ml(ml(sb(p[1], c[1]), PLANE.CAM_Y_LERP_K), k), c[1]);
  if (flying) {
    const y = ad(alt, PLANE.CAM_ALT_LIFT);
    c[1] = 0 <= y ? y : 0;
    if (112 < c[1]) c[1] = 112;
  }
}

export class PlaneNode implements BehaviourNode {
  readonly kind = 'Walk';
  var = VAR_MODE; mask = MODE.FLY; value = MODE.FLY;
  stamp = 0xfffffffe;

  // ---- the node's fields (offset of the original)
  thrust = 0;                      // +0x1c
  thrustStep: number = PLANE.THRUST_STEP;   // +0x20 (set to 0 when the course ends)
  brake = 0;                       // +0x28
  steer = 0;                       // +0x34
  pitch = 0;                       // +0x40
  alt: number = PLANE.ALT_START;   // +0x4c: altitude (the record's y)
  speed = 0;                       // +0x60
  impulse = 0;                     // +0x64
  accel = 0;                       // +0x68
  ammo: number = PLANE.AMMO_START; // +0x6c
  fuel: number = PLANE.FUEL_MAX;   // +0x70
  score = 0;                       // +0x74
  heading: number = PLANE.HEADING_START;    // +0x7c
  rolling = false;                 // +0x80: the spin-out after a hit
  rollAngle = 0;                   // +0x84
  pickFlag = 1;                    // +0x98: 1 after a fuel can (0 while the alarm sounds)
  landed = false;                  // +0x9c
  headRef: number = PLANE.HEADING_START;    // +0xa0: the course heading (unwrapped)
  headCorr = 0;                    // +0xa4
  bananas: Banana[] = Array.from({ length: PLANE.MAX_BANANAS }, newBanana);   // +0x118
  muzzle = 0;                      // +0xf0c
  private inited = false;

  /** FUN_0070b7b2 (the constructor): resets what it initialises; the random table is made by the zone game through `BipRun.initRandom` */
  init(w: World) {
    if (this.inited) return;
    this.inited = true;
    const run = bipRun(w);
    run.plane = this;
    run.initRandom();
    run.noAmmoSaid = false; run.lowFuelSaid = false; run.bananaClock = 0; run.result = 0; run.riverNear = false;
    run.hudAmmo = this.ammo; run.hudFuel = this.fuel / PLANE.FUEL_UNIT; run.hudScore = this.score;
  }

  update(w: World, rec: GameRecord): number {
    this.init(w);
    const run = bipRun(w), snd = run.sound, dt = w.dt;
    let b = 0;
    if (!this.rolling) b = w.input.held & ~(B.ESC | B.ANY);
    else {
      this.rollAngle = F(this.rollAngle + PLANE.ROLL_STEP);       // per tick, not scaled by dt (FUN_00709fac: `+0x84 += DAT_00892150`)
      if (PLANE.ROLL_END < this.rollAngle) { this.rollAngle = 0; this.rolling = false; }
    }

    // ---- steering (+0x34): Left has priority over Right; without either it eases back to 0 (the analogue axes of the original are always 0 on the keyboard)
    if (b & B.LEFT) { if (-PLANE.STEER_MAX < this.steer) this.steer = F(this.steer - F(PLANE.STEER_STEP * dt)); }
    else if (b & B.RIGHT) { if (this.steer < PLANE.STEER_MAX) this.steer = F(this.steer + F(PLANE.STEER_STEP * dt)); }
    else this.steer = ease(this.steer, PLANE.STEER_STEP);
    // ---- pitch (+0x40)
    if (b & B.UP) { this.pitch = F(F(PLANE.PITCH_STEP * dt) + this.pitch); if (PLANE.PITCH_MAX < this.pitch) this.pitch = PLANE.PITCH_MAX; }
    else if (b & B.DOWN) { this.pitch = F(this.pitch - F(PLANE.PITCH_STEP * dt)); if (this.pitch < -PLANE.PITCH_MAX) this.pitch = -PLANE.PITCH_MAX; }
    else this.pitch = ease(this.pitch, PLANE.PITCH_STEP);
    // ---- thrust (Alt) and brake (Shift)
    if (b & B.ALT) { if (PLANE.THRUST_MAX <= this.thrust) this.thrust = PLANE.THRUST_MAX; else this.thrust = F(F(this.thrustStep * dt) + this.thrust); }
    if (b & B.SHIFT) {
      if (PLANE.BRAKE_MAX <= this.brake) this.brake = PLANE.BRAKE_MAX; else this.brake = F(F(PLANE.BRAKE_STEP * dt) + this.brake);
      this.thrust = F(this.thrust - this.brake);
    } else this.brake = 0;
    // ---- bananas (Space, above the minimum speed)
    if ((b & B.SPACE) && PLANE.FIRE_MIN_SPEED < this.speed) this.fire(run, rec);

    // ---- the end of the course: the plane's nearest point of the path is past the last segments -> the landing takes over
    run.spline.nearest([rec.x, rec.y, rec.z]);       // FUN_00447800(rec, 0x3d2) -> FUN_004458f0: the flag of the nearest-point search
    if (run.spline.atEnd) {
      this.brake = PLANE.BRAKE_MAX; this.thrust = 0; this.thrustStep = 0;
      w.vars.set(VAR_MODE, MODE.LAND);
    }
    // FUN_00708e17: the river's reach, the score for being ahead of Johnny
    const t = F(run.spline.nearest([rec.x, rec.y, rec.z]));       // `float fVar1 = (float)FUN_004478d0(..)`
    run.riverNear = t <= PLANE.RIVER_TO && !(t < PLANE.RIVER_FROM);
    const jn = run.johnny;
    if (jn) {
      if (jn.progress < t) { this.score = Math.trunc(this.score + dt); jn.ahead = true; } else jn.ahead = false;
    }
    this.moveBananas(run);
    this.hitTests(run);
    run.hudAmmo = this.ammo; run.hudFuel = F(this.fuel / PLANE.FUEL_UNIT); run.hudScore = this.score;       // FUN_007091f6

    // ---- fuel and the engine sound
    if (0 < this.fuel) {
      if (PLANE.FUEL_LOW_ALARM <= run.hudFuel) {
        snd.stop('windOutOfFuel'); snd.stop('fuelAlarm');
        snd.rate('planeFlight', Math.trunc(this.pitch * PLANE.SOUND_HZ_PER_PITCH + PLANE.SOUND_HZ_BASE));
        snd.play('planeFlight');
      } else {
        snd.stop('planeFlight'); snd.play('fuelAlarm');
        this.pickFlag = 0;
      }
    } else {
      this.fuel = 0; this.thrust = 0;
      this.speed = F(this.speed - 10);
      this.alt = F(this.alt - 1);
      snd.stop('fuelAlarm'); snd.stop('planeFlight'); snd.play('windOutOfFuel');
      run.cue?.('bip-outoffuel');
    }
    // ---- speed, fuel use, the low-fuel speech
    let lift = F(PLANE.THRUST_K * this.thrust);
    if (1 < this.speed) lift = F(lift / this.speed);
    const drag = -F(this.brake * PLANE.BRAKE_K);
    this.accel = F(F(lift + drag) * PLANE.ACCEL_K);
    this.speed = F(this.speed + this.accel);
    if (this.speed < 0) this.speed = 0;
    if (PLANE.SPEED_MAX < this.speed) this.speed = PLANE.SPEED_MAX;
    this.fuel = F(this.fuel - this.speed);
    if (run.hudFuel < PLANE.FUEL_LOW_SAY && !run.lowFuelSaid) { run.say('ADSGBI09'); run.lowFuelSaid = true; run.cue?.('bip-lowfuel'); }
    if (this.fuel < 0) this.fuel = 0;
    if (PLANE.FUEL_MAX < this.fuel) this.fuel = PLANE.FUEL_MAX;
    this.speed = F(this.speed + this.impulse);
    if (this.impulse < 0) this.impulse = F(this.impulse + 80);
    if (0 < this.impulse) this.impulse = 0;

    // ---- heading and the step of this tick
    this.heading = F(F(F(F(this.speed * PLANE.SPEED_TURN) * this.steer) / PLANE.TURN_DIV) + this.heading);
    // ((float10)speed * K * sin(heading) * dt): every product rounded to float32 (24-bit x87), sin / cos stay as the CRT returns them
    const sk = F(this.speed * PLANE.SPEED_TURN);
    const dx = F(F(sk * Math.sin(this.heading)) * dt), dz = F(F(sk * Math.cos(this.heading)) * dt);
    rec.ry = this.heading;
    const nx = F(dx + rec.x), nz = F(dz + rec.z);
    if (this.speed <= PLANE.STALL_SPEED) this.alt = F(this.alt - PLANE.FALL_STALL);
    else this.alt = F(this.alt - F(this.pitch * PLANE.PITCH_TO_ALT));
    if (this.alt < 0) this.alt = 0;
    if (PLANE.ALT_MAX < this.alt) this.alt = PLANE.ALT_MAX;
    const ny = this.alt;

    // ---- the course ahead (the position of the plane before this step)
    const sp = run.spline;
    const tAhead = F(sp.nearest([rec.x, rec.y, rec.z]) + PLANE.PROGRESS_AHEAD);
    const ahead = sp.frameB(tAhead);
    const fwdX = ahead[8], fwdZ = ahead[10], aX = ahead[12], aY = ahead[13], aZ = ahead[14];

    // ---- what the plane touches: the 12 edges of a box in front of it
    const hit = this.touch(w, rec);
    if (hit) {
      const nm = hit.name;
      if (nm.startsWith(NAME.FUEL)) {
        snd.play('pickUpFuel');
        this.pickFlag = 1;
        this.fuel = F(F(PLANE.FUEL_CAN * PLANE.FUEL_UNIT) + this.fuel);
        hide(hit);
        run.lowFuelSaid = false;
        run.stats.fuelCans++;
      } else if (nm.startsWith(NAME.PALM)) {
        run.leafBursts++;        // FUN_00442a20(DAT_05d5cd6c, 2, 1, 1) then FUN_00442a40(DAT_05d5cd6c): the leaf particle
        run.onLeaf?.();
      } else if (nm.startsWith(NAME.BANANA_PICKUP)) {
        this.ammo += PLANE.AMMO_BUNCH;
        hide(hit);
        snd.play('pickUpBananas');
        run.noAmmoSaid = false;
        run.stats.bananaPickups++;
      } else if (nm.startsWith(NAME.LAND)) {
        snd.play('hitValley');
        run.say('ADSGBI13');
        this.landedFlagsReset();
        // where the plane is put back to by Recover (FUN_0070fdc0): the point of the course a little ahead and the heading from there on
        const c = run.crash;
        c.x = rec.x; c.y = rec.y; c.z = rec.z;
        c.ax = aX; c.ay = aY; c.az = aZ;
        c.headingNow = this.heading;
        const t2 = F(tAhead + PLANE.PROGRESS_AHEAD);
        const p2 = sp.frameB(t2);
        c.headingPath = F(Math.atan2(F(p2[12] - aX), F(p2[14] - aZ)));
        this.thrust = 0;
        this.score -= PLANE.CRASH_COST;
        run.stats.crashes++;
        w.vars.set(VAR_MODE, MODE.RECOVER);
      }
    }
    // commit the step
    rec.x = nx; rec.y = ny; rec.z = nz;
    if (!this.rolling) {
      // the heading follows the course: the course's heading is tracked through the wrap-around and the plane may stay within 0.9 rad of it
      const a = Math.atan2(fwdX, fwdZ);             // FUN_0085d640 leaves the double on the x87 stack: the sum below rounds once (exactly, courseHeading)
      let la = courseHeading(a, this.headCorr);
      if (PLANE.WRAP_LIMIT < Math.abs(sb(la, this.headRef))) {
        if (this.headRef <= la) { this.headCorr = sb(this.headCorr, PLANE.TWO_PI); la = sb(la, PLANE.TWO_PI); }
        else { this.headCorr = ad(this.headCorr, PLANE.TWO_PI); la = ad(la, PLANE.TWO_PI); }
      }
      this.headRef = la;
      this.heading = clampHeading(la, this.heading);
    }
    if (this.score < 0) this.score = 0;

    // ---- the plane's matrix: pitch (from the pitch input) and the heading (+ the spin-out) first, then the bank about the forward axis
    const bank = F(-F(this.steer * PLANE.BANK_K) * 12);
    const pitchAngle = F(F(this.pitch * PLANE.BANK_K) / 4);
    const A = eulerMatrix(pitchAngle, ad(rec.ry, this.rollAngle), 0, rec.x, rec.y, rec.z);
    const Bm = eulerMatrix(0, 0, bank);
    rec.m.set(matThen(Bm, A));
    rec.rx = pitchAngle;

    // ---- the camera
    followCamera(w, rec, this.alt, !this.landed);

    // ---- the end of the game (FUN_00447800 runs the nearest-point search again, now at the new position)
    run.spline.nearest([rec.x, rec.y, rec.z]);
    if (1 < this.speed || this.fuel !== 0 || run.spline.atEnd) {
      if (this.landed) {
        let r = this.score - PLANE.MEDAL_BASE;
        if (r < 0) r = 0;
        r = Math.trunc(r / PLANE.MEDAL_STEP);
        run.result = (r & 0xff) + 2;
        if (run.result < 3) { run.result = 3; this.score = 100; }
      } else run.result = 0;
    } else run.result = 1;
    return NODE_STOP;
  }

  /** the flags the crash resets (+0x88 .. +0x94: the four "wing" angles of the original, which nothing reads) */
  private landedFlagsReset() { /* +0x88 .. +0x94 = 0 */ }

  /** FUN_00709c5f: the 12 edges of the box (+-2 around a point 4 ahead of the plane), swept outwards with radius 1 / skin 1 against everything; the first record hit */
  private touch(w: World, rec: GameRecord): { name: string; rec: GameRecord } | null {
    const C = BOX_CORNERS.map((c) => transformPoint(rec.m, [c[0], c[1], c[2] + 4]));
    for (const [a, b] of BOX_EDGES) {
      const pa = C[a], pb = C[b];
      const h = w.col.sweep(rec, pa, [sb(pa[0], pb[0]), sb(pa[1], pb[1]), sb(pa[2], pb[2])], 3, 1, 1);
      if (h) return { name: h.rec.name, rec: h.rec };
    }
    return null;
  }

  /** FUN_0070996a: one banana from the next gun mouth */
  private fire(run: BipRun, rec: GameRecord) {
    if (this.ammo === 0) {
      if (!run.noAmmoSaid) { run.say('ADSGBI10'); run.noAmmoSaid = true; }
      return;
    }
    for (const bn of this.bananas) {
      if (bn.active) continue;
      bn.active = true;
      run.sound.play('bananaCannon');
      bn.born = run.bananaClock;
      const mz = PLANE.MUZZLE[this.muzzle];
      const o = rotateDir(rec.m, [mz[0], mz[1], 0]);
      bn.x = F(rec.x + o[0]); bn.y = F(rec.y + o[1]); bn.z = F(rec.z + o[2]);
      bn.heading = this.heading;
      this.muzzle = (this.muzzle + 1) & 3;
      const v = rotateDir(rec.m, [0, 0, PLANE.BANANA_SPEED]);
      bn.vx = F(v[0]); bn.vy = F(v[1]); bn.vz = F(v[2]);
      bn.sx = F(randF(PLANE.BANANA_SPIN)); bn.sy = F(randF(PLANE.BANANA_SPIN)); bn.sz = F(randF(PLANE.BANANA_SPIN));
      bn.ax = bn.ay = bn.az = 0;
      this.ammo -= 1;
      run.stats.bananasFired++;
      break;
    }
  }

  /** FUN_0070988a: the bananas fly 10 times their velocity per tick and live 20 ticks (the clock ticks once per call) */
  private moveBananas(run: BipRun) {
    for (const bn of this.bananas) {
      if (!bn.active) continue;
      if (bn.born + PLANE.BANANA_LIFE < run.bananaClock) { bn.active = false; continue; }
      bn.x = F(F(bn.vx * PLANE.BANANA_STEP) + bn.x); bn.y = F(F(bn.vy * PLANE.BANANA_STEP) + bn.y); bn.z = F(F(bn.vz * PLANE.BANANA_STEP) + bn.z);
      // the draw (FUN_0070b58c) draws with the angles and then turns the banana by its spin rates, once per frame (a banana that is alive at the draw)
      bn.dax = bn.ax; bn.day = bn.ay; bn.daz = bn.az;
      bn.ax = F(bn.ax + bn.sx); bn.ay = F(bn.ay + bn.sy); bn.az = F(bn.az + bn.sz);
    }
    run.bananaClock++;
  }

  /** FUN_00709258: the bananas against the monkeys (700 points, within sqrt(92) of the record), the banana targets BANT (20, sqrt(32)) and the rope targets DTR (100 once each, sqrt(48)) */
  private hitTests(run: BipRun) {
    const w = run.world!;
    const recs = w.records;
    for (const rec of recs) {
      if (!rec.name.startsWith(NAME.MONKEY)) continue;
      const mk = monkeyOf(rec);
      if (!mk || mk.state !== 1) continue;
      for (const bn of this.bananas) {
        if (!bn.active) continue;
        const d2 = Math.trunc(sq(rec.x - bn.x) + sq(rec.y - bn.y) + sq(rec.z - bn.z));
        if (d2 >>> 0 < HIT_R2.MONKEY) {
          this.score += SCORE.MONKEY;
          mk.state = 2;
          const pick = Math.trunc(randF(msClock())) % 3;       // ftol(FUN_004388ae(GetTickCount - start)) % 3: any of the three
          run.sound.at(pick === 0 ? 'hitChimp3' : pick === 1 ? 'hitChimp2' : 'hitChimp1', [rec.x, rec.y, rec.z]);
          run.say('ADSGBI12');
          run.stats.monkeyHits++;
        }
      }
    }
    for (const rec of recs) {
      let kind = 0;
      if (rec.name.startsWith(NAME.BANANA_TARGET)) kind = 1;
      if (rec.name.startsWith(NAME.ROPE_TARGET)) kind = 2;
      if (!kind) continue;
      // `cur` is the original's `local_30`: the record the banana loop measures against. The partner search of a rope-target hit reuses the same variable as its loop
      // pointer, so every later banana of this record in this tick is measured against the partner record (the last record scanned when there is none)
      let cur = rec;
      for (const bn of this.bananas) {
        if (!bn.active) continue;
        const d2 = Math.trunc(sq(cur.x - bn.x) + sq(cur.y - bn.y) + sq(cur.z - bn.z));
        const lim = kind === 1 ? HIT_R2.BANT : HIT_R2.DTR;
        if (d2 >>> 0 >= lim) continue;
        if (kind === 1) {
          this.score += SCORE.BANANA_TARGET;
          run.sound.at('onTarget', [cur.x, cur.y, cur.z]);
          run.stats.bantHits++;
        } else {
          // the rope target's partner record "DTH?" (same last character) carries the slide node: 100 points the first time
          const ch = cur.name[3];
          for (let j = 1; j < recs.length; j++) {
            const o = recs[j];
            cur = o;
            if (o.name.length === 4 && o.name.startsWith(NAME.ROPE_HIT) && o.name[3] === ch) {
              const slide = slideOf(o);
              if (slide && slide.hit === 0) {
                this.score += SCORE.TARGET;
                slide.hit = 1;
                run.sound.at('onTarget', [o.x, o.y, o.z]);
                run.stats.targetHits++;
              }
              break;
            }
          }
        }
        // the banana flies on in a random direction (three numbers of the table: |a|, b, |c|)
        bn.vy = Math.abs(run.nextRandom());
        bn.vx = run.nextRandom();
        bn.vz = Math.abs(run.nextRandom());
      }
    }
  }

  destroy() { /* FUN_0070bbeb frees the node and stops three sounds: the zone exit resets the audio */ }
}

/** FUN_00443300-free helpers the node needs from the other nodes of the zone */
export interface MonkeyLike { state: number }
export interface SlideLike { hit: number }
const monkeyOf = (rec: GameRecord): MonkeyLike | null => (rec.ctrl?.nodes[0] as unknown as MonkeyLike & { kind: string } | undefined)?.kind === 'monkey' ? (rec.ctrl!.nodes[0] as unknown as MonkeyLike) : null;
const slideOf = (rec: GameRecord): SlideLike | null => (rec.ctrl?.nodes[0] as unknown as SlideLike & { kind: string } | undefined)?.kind === 'RopeSld' ? (rec.ctrl!.nodes[0] as unknown as SlideLike) : null;

const sq = (x: number) => x * x;
/** the easing of the steering / pitch back to 0 (no input) */
function ease(v: number, step: number): number {
  if (0 <= v) { if (0 < v) { v = F(v - step); if (v < 0) v = 0; } }
  else { v = F(v + step); if (0 < v) v = 0; }
  return v;
}
/** a picked-up can / banana bunch: the original sets the record's variant to 0 and moves it to the origin */
function hide(h: { rec: GameRecord }) {
  const r = h.rec;
  r.variant = 0; r.m[12] = 0; r.m[13] = 0; r.m[14] = 0;
}

const BOX_CORNERS = [[-2, -2, -2], [2, -2, -2], [2, 2, -2], [-2, 2, -2], [-2, -2, 2], [2, -2, 2], [2, 2, 2], [-2, 2, 2]] as const;
const BOX_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [2, 6], [3, 7], [4, 5], [5, 6], [6, 7], [7, 0]] as const;
