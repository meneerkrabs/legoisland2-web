// z38PAR: the things that fly around the pilot (behaviour nodes of 0x4676cd .. 0x4684ec): the boat circling the island, the three pterodactyls, the balloon that
// bobs between 400 and 460, the looping seaplane, and the parachute canopy that follows the pilot's pack.
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { parRun } from './par-run.ts';
import { rand, transformPoint } from './util.ts';

abstract class PropNode implements BehaviourNode {
  abstract readonly kind: string;
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  abstract update(w: World, rec: GameRecord): number;
}

/** FUN_004676cd / update FUN_00467520: the boat sails a circle of radius 400 around the origin (angle += 0.003 per tick), heading along the circle + 0.3456 */
export class ParBoat extends PropNode {
  readonly kind = 'ParBoat';
  /** +0x1c: the angle, +0x18: the heading */
  angle = 0; heading = 0;
  update(_w: World, rec: GameRecord): number {
    const y = rec.y, ox = rec.x, oz = rec.z;
    const s = Math.sin(this.angle), c = Math.cos(this.angle);
    this.angle += 0.003 * _w.dt;
    const nx = s * 400, nz = c * 400;
    const h = Math.atan2(nx - ox, nz - oz);
    this.heading = h + 0.3455752;      // 0x3eb0ef3c
    rec.setEuler(0, this.heading, 0, nx, y, nz);
    return NODE_STOP;
  }
}

/** one of the three pterodactyls: the Lissajous path of FUN_004677a0 (x = sin(2 t) R + 35.784, z = cos(t) R + 29.474), flapping at twice the speed */
interface BirdDef { radius: number; y: number; step: number; phase0: number; heading: number; fly: 'birdFly1' | 'birdFly2' | 'birdFly3'; call: 'birdCall1' | 'birdCall2' | 'birdCall3' }
export const BIRDS: BirdDef[] = [
  { radius: 60, y: 934.517, step: 0.016, phase0: 0, heading: -0.15707964, fly: 'birdFly1', call: 'birdCall1' },
  { radius: 65, y: 954.517, step: 0.011, phase0: 8, heading: 0, fly: 'birdFly2', call: 'birdCall2' },
  { radius: 48, y: 944.517, step: 0.014, phase0: 15, heading: 0, fly: 'birdFly3', call: 'birdCall3' },
];
export const BIRD_CENTRE = [35.784, 29.474] as const;   // 0x420f22d1 / 0x41ebcac1

/** FUN_00467d38 / FUN_004677a0 */
export class ParBirds extends PropNode {
  readonly kind = 'ParBirds';
  phase = BIRDS.map((b) => b.phase0);
  private started = false;
  update(w: World): number {
    const run = parRun(w);
    const birds = run.recs.birds;
    if (!this.started) {
      this.started = true;
      // FUN_00467d38: the three clips start at frames 0 / 4 / 8
      birds[0]?.anim?.start(1, 0); birds[1]?.anim?.start(1, 4); birds[2]?.anim?.start(1, 8);
    }
    BIRDS.forEach((def, i) => {
      const rec = birds[i];
      if (!rec) return;
      const pos = [rec.x, rec.y, rec.z];
      if (rand(2) < 1) run.sound.at(def.call, pos);
      run.sound.at(def.fly, pos);
      const t = this.phase[i];
      const nx = Math.sin(2 * t) * def.radius + BIRD_CENTRE[0], nz = Math.cos(t) * def.radius + BIRD_CENTRE[1];
      this.phase[i] += def.step * w.dt;
      const h = Math.atan2(nx - pos[0], nz - pos[2]) + def.heading;
      rec.setEuler(0, h, 0, nx, def.y, nz);
      rec.anim?.advance(2);
    });
    return NODE_STOP;
  }
}

/** FUN_00467fae / FUN_00467e40: the balloon sinks (0.5 per tick) to 400, then rises (0.3 per tick, with its burner sound) to 460 */
export class ParBalloon extends PropNode {
  readonly kind = 'ParBalloon';
  /** +0x18 */
  rising = false;
  update(w: World, rec: GameRecord): number {
    const run = parRun(w);
    let y = rec.y;
    if (!this.rising) {
      y -= 0.5 * w.dt;
      if (y < 400) this.rising = true;
    } else {
      run.sound.at('balloonThrust', [rec.x, rec.y, rec.z]);
      y += 0.3 * w.dt;
      if (460 < y) { this.rising = false; run.sound.stop('balloonThrust'); }
    }
    rec.y = y;
    return NODE_STOP;
  }
}

/** FUN_004681c0 / FUN_00468040: the seaplane loops (angle += 0.027 per tick) on a circle of radius 70 around (-49.7, 705.5, -110) in the YZ plane */
export class ParPlane extends PropNode {
  readonly kind = 'ParPlane';
  update(w: World, rec: GameRecord): number {
    const a = buildMatrix(rec.rx, 0, 0, -49.7, 705.5, -110);
    // local offset (0, 0, 70) through the rotation, then the translation
    const p = transformPoint(a, [0, 0, 70]);
    rec.m.set(a); rec.m[12] = p[0]; rec.m[13] = p[1]; rec.m[14] = p[2];
    rec.rx += 0.027 * w.dt;
    parRun(w).sound.at('planeIdle', [rec.x, rec.y, rec.z]);
    return NODE_STOP;
  }
}

/** FUN_004684ec / FUN_00468338: the canopy opens (scale 0 -> 0.55, +0.05 per tick) when the pilot opens the chute and closes again after the landing; it sits at the pilot's pack */
export class ParCanopy extends PropNode {
  readonly kind = 'ParCanopy';
  /** +0x18: scale */
  scale = 0;
  update(w: World, rec: GameRecord): number {
    const run = parRun(w);
    const R = run.recs, pep = R.pepp;
    // bone 8 of the pilot's rig (the pack): translation of the bone matrix in model space, then into the world with the pilot's matrix
    let pos: number[] = [pep.x, pep.y, pep.z];
    const pose = pep.anim?.pose(1);
    if (pose && pose.length >= 9 * 16) pos = pep.toWorld([pose[8 * 16 + 12], pose[8 * 16 + 13], pose[8 * 16 + 14]]);
    if (run.canopy === 1) { this.scale += 0.05 * w.dt; if (0.55 < this.scale) this.scale = 0.55; }
    if (run.canopy === 2) { this.scale -= 0.05 * w.dt; if (this.scale < 0) this.scale = 0; }
    rec.m.set(buildMatrix(pep.rx, pep.ry, pep.rz, pos[0], pos[1], pos[2], this.scale, this.scale, this.scale));
    rec.scale = [this.scale, this.scale, this.scale];
    if (this.scale <= 0) rec.flags |= 0x8000; else rec.flags &= ~0x8000;
    // the blob shadow of the canopy (FUN_00468250): over land only, flat quad at the ground point of the probe
    const sh = R.shad;
    if (sh) {
      if (run.shadowOn) {
        const g = run.groundHit;
        sh.m.set(buildMatrix(0, Math.atan2(rec.m[8], rec.m[10]), 0, g[0], g[1] + 0.4 * 8, g[2], 2.05, 2.05, 2.05));
        sh.show();
      } else sh.hide();
    }
    return NODE_STOP;
  }
}
