// z22BIP: the take-off, the node "Takeoff" on PEPP (constructor FUN_0070c36b reads `Runwaystart.SRC`, update FUN_0070c014, the camera FUN_0070bede), gated by
// game variable 0xfa & 8. The plane stands at the start of the course (the spline, FUN_00445680 mode 2) until Johnny, the guide plane (csplane), has started
// (50 ticks), waits 20 ticks more and then flies the first part of the course for 100 ticks, climbing during the last 50; then the flight (mode 2) takes over
// with full speed and the altitude it has reached.
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { bipRun, f32, MODE, VAR_MODE } from './run.ts';
import { transformPoint } from './plane.ts';

const F = Math.fround;
export const CTOR_TAKEOFF = 0x70c36b;

export const TAKEOFF = {
  WAIT: 20,                     // +0x1c  0x41a00000: ticks to wait after Johnny has started
  RUN: 100,                     // +0x20  0x42c80000: ticks of the run
  STEP: f32(0x399d4952),        // +0x30: progress of the course per tick
  CLIMB_FROM: 50,               // 0x892254: the climb starts when the run has 50 ticks left
  CLIMB_ACCEL: f32(0x3ca3d70a), // 0x8922c0: 0.02 per tick
  SPEED: 400,                   // 0x43c80000: the speed the flight starts with
  LIFT: 4,                      // 0x892080: the plane is drawn 4 above the course
  CAM_LERP: f32(0x3f266666),    // 0.65: the camera's ease
  CAM_OFFSET: [0, 6, -20] as const, CAM_TARGET_UP: 4,
} as const;

export interface SrcPoints { pos0: [number, number, number]; rot0: [number, number, number]; pos1: [number, number, number]; rot1: [number, number, number] }
/** a `.SRC` file of the zone (`source/*.src`): tag, count, then 3-float vectors (FUN_00435350 reads them in the order the constructors use) */
export function parseSrc(data: Uint8Array): number[][] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: number[][] = [];
  for (let o = 8; o + 12 <= data.length; o += 12) out.push([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]);
  return out;
}

export class TakeoffNode implements BehaviourNode {
  readonly kind = 'Takeoff';
  var = VAR_MODE; mask = MODE.TAKEOFF; value = MODE.TAKEOFF;
  stamp = 0xfffffffe;

  state = 1;                    // +0x18
  wait: number = TAKEOFF.WAIT;  // +0x1c
  count: number = TAKEOFF.RUN;  // +0x20
  progress = 0;                 // +0x2c: where on the course the plane is
  step: number = TAKEOFF.STEP;  // +0x30
  propPhase = 0;                // +0xb4 (2 once the climb starts; the spinning-up of the propeller, FUN_0070bca0 is never called)
  climb = 0;                    // +0xc8
  climbSpeed = 0;               // +0xcc
  /** Runwaystart.SRC: +0x34 / +0x4c / +0x40 / +0x58 (not used by the update) */
  src: SrcPoints | null = null;

  update(w: World, rec: GameRecord): number {
    const run = bipRun(w), dt = w.dt;
    const jn = run.johnny, walk = run.plane;
    if (jn && jn.waiting === 0 && walk) {
      if (this.state === 0) {
        this.progress = F(F(this.step * dt) + this.progress);
        this.count = F(this.count - F(1 * dt));
        if (this.count < TAKEOFF.CLIMB_FROM) {
          this.propPhase = 2;
          this.climb = F(F(this.climbSpeed * dt) + this.climb);
          this.climbSpeed = F(F(TAKEOFF.CLIMB_ACCEL * dt) + this.climbSpeed);
        }
        if (this.count <= 0) {
          walk.speed = TAKEOFF.SPEED;
          walk.alt = this.climb;
          run.sound.play('planeFlyoff');
          w.vars.set(VAR_MODE, MODE.FLY);
        }
      } else if (this.wait <= 0) this.state = 0;
      else this.wait = F(this.wait - F(1 * dt));
    }
    this.camera(w, rec);
    return NODE_STOP;
  }

  /** FUN_0070bede: the plane takes the spline's frame at the progress (4 above the climb), the camera eases 65 percent of the way to the point behind it */
  camera(w: World, rec: GameRecord) {
    const run = bipRun(w);
    const fr = run.spline.frame(this.progress);
    rec.m.set(fr.m);
    rec.m[13] = F(F(this.climb + TAKEOFF.LIFT) + rec.m[13]);
    const c = w.camera.c;
    c[3] = rec.m[12]; c[4] = F(rec.m[13] + TAKEOFF.LIFT); c[5] = rec.m[14];
    const p = transformPoint(rec.m, TAKEOFF.CAM_OFFSET);
    const k = TAKEOFF.CAM_LERP;
    c[0] = F((p[0] - c[0]) * k + c[0]);
    c[2] = F((p[2] - c[2]) * k + c[2]);
    c[1] = F((p[1] - c[1]) * k + c[1]);
  }
}
