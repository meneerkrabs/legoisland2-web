// "SGCar" (Common\SGGen\c_src\SGCar.c): the cars Pepper can drive: the ambulance AMBU, the speedsters SPD0 / SPD1 / SPD2 and the police car PCAR.
//   ctor FUN_0088fb35, handler table 0x982c48 = { update FUN_0088ed56, pre-render FUN_0088f816, destroy FUN_0088fbfb, draw FUN_0088f8df }
//   input FUN_0088ebe6 (+ key ramp FUN_0088ea19), ground alignment FUN_0088e440, the leave spot FUN_0088e030 (PepSwitc), camera floor FUN_00422ddc
// The node sits on the car's record behind the car node of speeder.c (WP5, src/island/pizza/speeder.ts) with the car's MOVE_* var as gate (mask 0, the
// constructor forces 0 / 0): the var is a bit field the nodes share: 0x10000000 = Pepper sits in it, 0x20000000 = a car Pepper can take (SGCar sets it
// every tick it does not hold Pepper; speeder.c treats such cars as obstacles). While nobody near presses Ctrl the update returns 0; Ctrl within reach
// makes the car the current vehicle and the pre-render switches Pepper in (PEPPER_CONTROL 8, kind -1).
// Driving: Space accelerates, Alt brakes / reverses, Left / Right steer (only while moving); a second blocked sweep bounces the car back and spins it
// for 20 ticks. Ctrl leaves the car at a free spot next to it (PepSwitc, FUN_0088e030).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { RAMP_TABLE } from '../../game/camera.ts';
import { eulerMatrix, normalise3, toWorld } from '../../zones/exact.ts';
import { ICON, VV, vehicles, cutsceneActive, partPos, leanFrame } from './common.ts';

const fr = Math.fround;

export const CAR_DRIVEN = 0x10000000, CAR_PLAYER = 0x20000000;
const ACCEL = 0.05000000074505806, COAST = 0.02500000037252903, BRAKE = 0.009999999776482582, REVERSE_MAX = -0.75;   // DAT_00892034 / 124 / 030 / 00898a44
const TURN = 0.000750000006519258;                    // DAT_008924f8 (per stick unit, the stick is +-128)
const MOVING = 0.05000000074505806;                   // DAT_00892034 / DAT_00898a40
const CRASH_TICKS = 20.0, CRASH_SPIN = 0.5;           // DAT_0089237c, DAT_0089204c
const LOOK_AHEAD = 8.0, SLOPE = 0.10000000149011612, BACK_MAX = -0.5;
const NO_GROUND_Y = -1000.0;                          // DAT_008920fc
const WHEEL_UP = 1.600000023841858, SWEEP_R = 0.6000000238418579;   // DAT_00892580, 0x3f19999a
const CAM_OFFSET = [0, 12.0, -16.0];                  // DAT_00982ce8
const CAM_EASE = 0.10000000149011612, CAM_NEAR = 13.0;               // DAT_008920cc, DAT_00982b60
const CAM_MIN_UP = 6.400000095367432;                 // DAT_008adbfc (camera preset 0)

/** FUN_0088e440: tilt the car to the ground under four probes 1.5 to the sides / front / back (every operation a float32, like the original's 24-bit x87) */
export function alignToGround(w: World, rec: GameRecord) {
  const off = 1.5, up1 = 0.6000000238418579;   // DAT_008921a8, DAT_0089213c
  const x = rec.x, y = rec.y, z = rec.z;
  // one probe point: the terrain ray (FUN_0043cd62) and the polygon probe (FUN_00441ac0); a hit with an upward normal gives its height
  const probe = (px: number, py: number, pz: number): number => {
    const t = fr(w.col.terrainHeight(px, py, pz, 4.0));
    const h = w.col.probe(rec, [px, py, pz], [0, -16, 0], 3);
    if (h && 0 < h.normal[1]) return fr(h.point[1]);
    if (t <= NO_GROUND_Y) return y;
    return fr(Math.abs(fr(py - y))) <= 4.0 ? t : y;
  };
  const rx = rec.m[0], rz = rec.m[2];
  const pyy = fr(y + up1);
  const ax = fr(x - fr(rx * off)), az = fr(z - fr(rz * off));
  const ay = probe(ax, pyy, az);
  const bx = fr(fr(rx * off) + x), bz = fr(fr(rz * off) + z);
  const by = probe(bx, pyy, bz);
  const fx = rec.m[8], fz = rec.m[10];
  const A = [fr(bx - ax), fr(by - ay), fr(bz - az)];
  const cx = fr(x - fr(fx * off)), cz = fr(z - fr(fz * off));
  const cy = probe(cx, pyy, cz);
  const dx = fr(fr(fx * off) + x), dz = fr(fr(fz * off) + z);
  const dy = probe(dx, pyy, dz);
  const Bv = [fr(dx - cx), fr(dy - cy), fr(dz - cz)];
  normalise3(Bv); normalise3(A);
  const upv = [fr(fr(Bv[1] * A[2]) - fr(Bv[2] * A[1])), fr(fr(Bv[2] * A[0]) - fr(Bv[0] * A[2])), fr(fr(Bv[0] * A[1]) - fr(Bv[1] * A[0]))];
  normalise3(upv);
  const s = fr(Math.sin(rec.ry)), c = fr(Math.cos(rec.ry));
  const d = fr(fr(fr(upv[0] * s) + fr(upv[1] * 0)) + fr(upv[2] * c));
  const f = [fr(s - fr(d * upv[0])), fr(0 - fr(d * upv[1])), fr(c - fr(d * upv[2]))];
  normalise3(f);
  const r = [fr(fr(upv[1] * f[2]) - fr(upv[2] * f[1])), fr(fr(upv[2] * f[0]) - fr(upv[0] * f[2])), fr(fr(upv[0] * f[1]) - fr(upv[1] * f[0]))];
  normalise3(r);
  const m = rec.m;
  m[0] = r[0]; m[1] = r[1]; m[2] = r[2];
  m[4] = upv[0]; m[5] = upv[1]; m[6] = upv[2];
  m[8] = f[0]; m[9] = f[1]; m[10] = f[2];
}

export class CarNode implements BehaviourNode {
  readonly kind = 'SGCar';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  private init = false;
  // node + 0x18 (the input block FUN_0088ebe6 works on)
  rampX = 0x10; rampY = 0x10;     // +0x1c / +0x20
  steer = 0; stickY = 0;          // +0x24 / +0x28
  reset = 0;                      // +0x1a: clear the state when Pepper gets in
  crash = 0;                      // +0x2c: crash timer (0 = driving)
  speed = 0;                      // +0x34: -0.75 .. 1
  vx = 0; vy = 0; vz = 0;         // +0x48 / +0x4c / +0x50

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.init) { this.init = true; w.vars.andNot(this.var, CAR_DRIVEN); }   // FUN_0088fb35
    const G = vehicles(w);
    const v = w.vars.get(this.var);
    if ((v & CAR_DRIVEN) === 0) {
      if (cutsceneActive(w)) return NODE_NONE;
      if ((w.input.pressed & B.CTRL) === 0 || w.pep.mailbox === 0x62 || (w.vars.get(VV.PEPPER_CONTROL) & 1) === 0 || !rec.enabled) {
        if (G.current === rec) { G.carEnter = true; return NODE_STOP; }
        if (ctrl.distSq < G.range && rec.enabled) w.vars.or(VV.ICONS, ICON.CAR);
        if ((v & CAR_PLAYER) === 0) w.vars.or(this.var, CAR_PLAYER);
        return NODE_NONE;
      }
      if (!rec.enabled) return NODE_NONE;
      if (ctrl.distSq < G.range && 0 < ctrl.distSq) { G.current = rec; G.range = ctrl.distSq; }
      return NODE_STOP;
    }
    if (rec !== G.current) return NODE_STOP;
    return this.drive(w, rec);
  }

  /** FUN_0088ea19: the key ramp (the same integer ramp as the walk node) */
  private ramp(held: number) {
    let rx = this.rampX, ry = this.rampY, b1 = false, b2 = false;
    if (held & B.LEFT) { b1 = true; rx = rx < 0x11 ? rx - 3 : 0x10; if (rx < 1) rx = 0; }
    if (held & B.RIGHT) { b1 = true; rx = rx < 0x10 ? 0x10 : rx + 3; if (rx > 0x1f) rx = 0x20; }
    if (held & B.UP) { b2 = true; ry = ry < 0x11 ? ry - 3 : 0x10; if (ry < 1) ry = 0; }
    if (held & B.DOWN) { b2 = true; ry = ry < 0x10 ? 0x10 : ry + 3; if (ry > 0x1f) ry = 0x20; }
    if (!b1) { if (rx > 0x10) { rx -= 4; if (rx < 0x10) rx = 0x10; } if (rx < 0x10) { rx += 4; if (rx > 0x10) rx = 0x10; } }
    if (!b2) { if (ry > 0x10) { ry -= 4; if (ry < 0x10) ry = 0x10; } if (ry < 0x10) { ry += 4; if (ry > 0x10) ry = 0x10; } }
    this.rampY = ry; this.stickY = RAMP_TABLE[ry] - 0x80;
    this.rampX = rx; this.steer = RAMP_TABLE[rx] - 0x80;
  }

  /** FUN_0088ebe6: keys -> speed and yaw (float32 per operation) */
  private input(w: World, rec: GameRecord) {
    const held = w.input.held, dt = w.dt;
    this.ramp(held);
    // (a pad stick beyond +-20 replaces the steering value; the keyboard has none)
    if ((held & B.SPACE) === 0) { if (0 < this.speed) this.speed = fr(this.speed - COAST); }
    else if (1.0 <= this.speed) this.speed = 1.0;
    else this.speed = fr(this.speed + ACCEL);
    if ((held & B.ALT) === 0) { if (this.speed < 0) this.speed = fr(this.speed + COAST); }
    else if (this.speed <= REVERSE_MAX) this.speed = REVERSE_MAX;
    else this.speed = fr(this.speed - BRAKE);
    const turn = fr(fr(this.steer * TURN) * dt);
    if (this.speed <= MOVING) { if (this.speed < -MOVING) rec.ry = fr(rec.ry - turn); }
    else rec.ry = fr(turn + rec.ry);
  }

  private drive(w: World, rec: GameRecord): number {
    const dt = w.dt;
    if (this.reset) {
      this.reset = 0; this.crash = 0; this.speed = 0; this.vx = 0; this.vy = 0; this.vz = 0;
      this.rampX = 0x10; this.rampY = 0x10; this.steer = 0; this.stickY = 0;
    }
    this.input(w, rec);
    const pep = w.focus;
    if (pep) leanFrame(pep, fr(this.steer / 127.0), false);
    const vl = fr(fr(fr(this.vx * this.vx) + fr(this.vy * this.vy)) + fr(this.vz * this.vz));
    if (0 < vl) { eulerMatrix(rec.m, 0, rec.ry, 0, rec.x, rec.y, rec.z); alignToGround(w, rec); }
    const fx = rec.m[8], fy = rec.m[9], fz = rec.m[10];
    const g = fr(w.col.terrainHeight(rec.x, rec.y, rec.z, 4.0));
    if (NO_GROUND_Y < g) rec.y = g;
    w.pep.surfaceAtFeet = w.col.lastSurface();     // DAT_009da9ac
    if (this.crash === 0) { this.vx = fr(this.speed * fx); this.vy = fr(this.speed * fy); this.vz = fr(this.speed * fz); }
    else if (CRASH_TICKS <= this.crash) { this.crash = 0; pep?.anim?.start(0x4c, 0); }
    else { this.crash = fr(fr(1.0 * dt) + this.crash); rec.ry = fr(fr(CRASH_SPIN * dt) + rec.ry); }
    // the road ahead: water stops the car, a slope slows it
    const a = [fr(this.vx * dt), fr(this.vy * dt), fr(this.vz * dt)];
    normalise3(a);
    const ahead = fr(w.col.terrainHeight(fr(rec.x + fr(a[0] * LOOK_AHEAD)), fr(rec.y + fr(a[1] * LOOK_AHEAD)), fr(rec.z + fr(a[2] * LOOK_AHEAD)), 4.0));
    if (w.seaLevel < ahead) {
      if (this.speed <= BACK_MAX) this.speed = BACK_MAX;
      else this.speed = fr(this.speed - fr(SLOPE * fy));
    } else { this.vx = 0; this.vy = 0; this.vz = 0; }
    // the sweep starts between the front wheels (parts 2 / 3) or, backing up, the rear wheels (4 / 5), 1.6 up
    const cur = vehicles(w).current ?? rec;
    const [i1, i2] = this.speed < 0 ? [5, 4] : [2, 3];
    const p1 = toWorld(rec.m, partPos(w, cur, i1) ?? [0, 0, 0]), p2 = toWorld(rec.m, partPos(w, cur, i2) ?? [0, 0, 0]);
    const from = [fr(fr(p1[0] + p2[0]) * 0.5), fr(fr(fr(p1[1] + p2[1]) * 0.5) + WHEEL_UP), fr(fr(p1[2] + p2[2]) * 0.5)];
    let h = w.col.sweep(rec, from, [fr(this.vx * dt), fr(this.vy * dt), fr(this.vz * dt)], 3, SWEEP_R, SWEEP_R);
    if (h) {
      const d = fr(fr(fr(h.normal[0] * this.vx) + fr(h.normal[1] * this.vy)) + fr(h.normal[2] * this.vz));
      this.vx = fr(this.vx - fr(h.normal[0] * d)); this.vy = fr(this.vy - fr(h.normal[1] * d)); this.vz = fr(this.vz - fr(h.normal[2] * d));
      h = w.col.sweep(rec, from, [this.vx, this.vy, this.vz], 3, SWEEP_R, SWEEP_R);
      if (h) { this.vx = -this.vx; this.vz = -this.vz; this.crash = 1.0; pep?.anim?.start(0x4a, 0); }
    }
    rec.x = fr(fr(this.vx * dt) + rec.x);
    rec.z = fr(fr(this.vz * dt) + rec.z);
    // the car camera: the target is Pepper (DAT_009da5d8, his matrix of the last pre-render), the eye eases to (0, 12, -16) in his frame
    const c = w.camera.c;
    const tm = pep ?? rec;
    c[3] = tm.x; c[4] = tm.y; c[5] = tm.z;
    const ideal = toWorld(tm.m, CAM_OFFSET);
    const ease = () => { c[0] = fr(fr(fr(ideal[0] - c[0]) * CAM_EASE) + c[0]); c[1] = fr(fr(fr(ideal[1] - c[1]) * CAM_EASE) + c[1]); c[2] = fr(fr(fr(ideal[2] - c[2]) * CAM_EASE) + c[2]); };
    if (!w.camera.vehicle) {
      if (this.crash === 0) ease();
    } else {
      // DAT_00987660 (the camera.ts "vehicle" flag; in the original it is set for 16-bit display modes)
      const ex = fr(c[0] - c[3]), ey = fr(c[1] - c[4]), ez = fr(c[2] - c[5]);
      const dist = fr(Math.sqrt(fr(fr(fr(ex * ex) + fr(ey * ey)) + fr(ez * ez))));
      if (CAM_NEAR <= dist) {
        if (this.crash === 0) ease();
      } else if (this.speed <= 0) { c[0] = fr(c[0] - fr(c[15] * dt)); c[2] = fr(c[2] - fr(c[17] * dt)); }
      else { c[0] = fr(fr(this.vx * dt) + c[0]); c[2] = fr(fr(this.vz * dt) + c[2]); }
    }
    cameraFloor(w, rec.y);
    return NODE_STOP;
  }

  /** FUN_0088f816 */
  prerender(w: World, rec: GameRecord): void {
    const G = vehicles(w);
    if (!G.carEnter && ((w.input.pressed & B.CTRL) === 0 || w.pep.mailbox === 0x62)) {
      if (G.current === null) { w.vars.or(this.var, CAR_PLAYER); w.vars.andNot(this.var, CAR_DRIVEN); }
      return;
    }
    G.carEnter = false;
    if (G.current !== rec) return;
    if (!cutsceneActive(w)) {
      w.vars.or(this.var, CAR_DRIVEN);
      w.vars.set(VV.PEPPER_CONTROL, 8);
      this.reset = 1;
      G.kind = -1;
    } else G.current = null;
  }
}

/** FUN_00422ddc(camera, y, preset 0): the eye stays at least 6.4 above `y` and sinks by 0.8 per tick when it is more than 32 above that */
export function cameraFloor(w: World, y: number) {
  const c = w.camera.c;
  const lo = fr(CAM_MIN_UP + y);
  if (lo <= c[1]) { if (32.0 < fr(c[1] - lo)) c[1] = fr(c[1] - 0.800000011920929); }
  else c[1] = lo;
}
