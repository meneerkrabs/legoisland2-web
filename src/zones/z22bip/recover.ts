// z22BIP: the recovery after a crash into the terrain, the node "Recover" on PEPP (constructor FUN_00710167, update FUN_0070fdc0), gated by game variable
// 0xfa & 4: for 30 ticks the plane is flown from where it hit the ground to a point of the course a little further on (FUN_00709fac saved both points), turning
// to the course's heading; then the flight (mode 2) goes on.
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { bipRun, f32, MODE, VAR_MODE } from './run.ts';
import { followCamera, setRotation } from './plane.ts';

const F = Math.fround;
export const CTOR_RECOVER = 0x710167;
export const RECOVER = { TICKS: 30, RATE: f32(0x3d088889) /* 1 / 30 */ } as const;

export class RecoverNode implements BehaviourNode {
  readonly kind = 'Recover';
  var = VAR_MODE; mask = MODE.RECOVER; value = MODE.RECOVER;
  stamp = 0xfffffffe;

  phase = 0;                  // +0x18
  vel = [0, 0, 0];            // +0x1c .. +0x24
  pos = [0, 0, 0];            // +0x28 .. +0x30
  ticks = 0;                  // +0x34
  turn = 0;                   // +0x3c: heading change per tick

  update(w: World, rec: GameRecord): number {
    const run = bipRun(w), dt = w.dt, cr = run.crash, walk = run.plane!;
    if (this.phase === 0) {
      this.vel = [F(F(cr.ax - cr.x) * RECOVER.RATE), F(F(cr.ay - cr.y) * RECOVER.RATE), F(F(cr.az - cr.z) * RECOVER.RATE)];
      this.pos = [rec.x, rec.y, rec.z];
      this.phase = 1;
      this.turn = F(F(cr.headingPath - cr.headingNow) / 30);
      this.ticks = 0;
    }
    if (this.phase === 1) {
      this.pos[0] = F(this.pos[0] + this.vel[0]); this.pos[1] = F(this.pos[1] + this.vel[1]); this.pos[2] = F(this.pos[2] + this.vel[2]);
      rec.x = this.pos[0]; rec.y = this.pos[1]; rec.z = this.pos[2];
      cr.headingNow = F(F(this.turn * dt) + cr.headingNow);
      rec.ry = cr.headingNow;
      walk.heading = cr.headingNow;
      walk.alt = this.pos[1];
      this.ticks++;
      if (RECOVER.TICKS - 1 < this.ticks) { this.phase = 0; w.vars.set(VAR_MODE, MODE.FLY); }
    }
    setRotation(rec, 0, rec.ry, 0);
    followCamera(w, rec, walk.alt, false);
    return NODE_STOP;
  }
}
