// z22BIP: the landing, the node "Landing" on PEPP (constructor FUN_0070e8b0 reads `Runwayend.SRC`, update FUN_0070e42c with FUN_0070e2c5), gated by game variable
// 0xfa & 0x10. When the plane has passed the course's last segments the plane is flown to the first point of the runway in 50 ticks, then slides along the runway
// for 30 ticks (skid sound), with the camera at a fixed place; then it counts as landed (the flight node's +0x9c) and the game ends.
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { bipRun, f32, MODE, VAR_MODE } from './run.ts';
import { setRotation } from './plane.ts';
import { sb, ml } from '../common/f32.ts';
import type { SrcPoints } from './takeoff.ts';

const F = Math.fround;
export const CTOR_LANDING = 0x70e8b0;

export const LANDING = {
  APPROACH: 50,                 // 0x32 ticks to the first point of the runway
  SLIDE: 30,                    // 0x1e ticks along the runway
  RATE: f32(0x3ca3d70a),        // 0.02: 1 / 50 of the way per tick
  RUNWAY_LIFT: 2,               // 0x892210 (double): both runway points are raised by 2
  CAM: [f32(0xc4610000), f32(0x428c0000), f32(0x43c80000)] as const,   // the fixed eye (-900, 70, 400)
  CAM_TARGET_UP: 4,
} as const;

export class LandingNode implements BehaviourNode {
  readonly kind = 'Landing';
  var = VAR_MODE; mask = MODE.LAND; value = MODE.LAND;
  stamp = 0xfffffffe;

  phase = 0;                    // +0x18
  approach: number = LANDING.APPROACH;   // +0x1c (int)
  slide: number = LANDING.SLIDE;         // +0x20 (int)
  /** +0x28 / +0x40 / +0x34 / +0x4c: the runway points (the code adds 2 to y of both positions) */
  p0: [number, number, number] = [0, 0, 0];
  p1: [number, number, number] = [0, 0, 0];
  v1 = [0, 0, 0]; headingApproach = 0;    // +0x58 .. +0x60 / +0x80
  v2 = [0, 0, 0]; headingSlide = 0;       // +0x70 .. +0x78 / +0x84
  pos = [0, 0, 0];                        // +0x64 .. +0x6c
  skid = false;                           // +0x24

  bind(src: SrcPoints) {
    this.p0 = [src.pos0[0], F(src.pos0[1] + LANDING.RUNWAY_LIFT), src.pos0[2]];
    this.p1 = [src.pos1[0], F(src.pos1[1] + LANDING.RUNWAY_LIFT), src.pos1[2]];
  }

  /** FUN_0070e2c5: the velocities and headings of the two parts */
  private setup(rec: GameRecord) {
    const k = LANDING.RATE;
    this.v1 = [ml(sb(this.p0[0], rec.x), k), ml(sb(this.p0[1], rec.y), k), ml(sb(this.p0[2], rec.z), k)];
    this.headingApproach = F(Math.atan2(this.v1[0], this.v1[2]));
    this.approach = LANDING.APPROACH; this.slide = LANDING.SLIDE;
    this.v2 = [ml(sb(this.p1[0], this.p0[0]), k), ml(sb(this.p1[1], this.p0[1]), k), ml(sb(this.p1[2], this.p0[2]), k)];
    this.headingSlide = F(Math.atan2(this.v2[0], this.v2[2]));
  }

  update(w: World, rec: GameRecord): number {
    const run = bipRun(w), snd = run.sound;
    const walk = run.plane!;
    if (this.phase === 0) {
      this.setup(rec);
      this.phase = 1;
      this.pos = [rec.x, rec.y, rec.z];      // +0x64 / +0x68 / +0x6c
    }
    if (this.approach < 1) {
      snd.play('skidHalt');
      snd.stop('windOutOfFuel'); snd.stop('fuelAlarm'); snd.stop('planeFlight');
      this.skid = true;
      setRotation(rec, 0, this.headingSlide, 0);
      this.pos[0] = F(this.pos[0] + this.v2[0]); this.pos[1] = F(this.pos[1] + this.v2[1]); this.pos[2] = F(this.pos[2] + this.v2[2]);
      rec.x = this.pos[0]; rec.y = this.pos[1]; rec.z = this.pos[2];
      this.slide -= 1;
      if (this.slide < 1) {
        this.v2 = [0, 0, 0];
        walk.landed = true;
        w.vars.set(VAR_MODE, MODE.FLY);
        walk.pitch = 0; walk.steer = 0;
        snd.stop('skidHalt');
      }
      walk.heading = this.headingSlide;
    } else {
      walk.alt = F(walk.alt + this.v1[1]);
      setRotation(rec, 0, this.headingApproach, 0);
      this.pos[0] = F(this.pos[0] + this.v1[0]); this.pos[1] = F(this.pos[1] + this.v1[1]); this.pos[2] = F(this.pos[2] + this.v1[2]);
      rec.x = this.pos[0]; rec.y = this.pos[1]; rec.z = this.pos[2];
      this.approach -= 1;
      walk.heading = this.headingApproach;
    }
    const c = w.camera.c;
    c[3] = rec.x; c[4] = F(rec.y + LANDING.CAM_TARGET_UP); c[5] = rec.z;
    c[0] = LANDING.CAM[0]; c[1] = LANDING.CAM[1]; c[2] = LANDING.CAM[2];
    return NODE_STOP;
  }
}
