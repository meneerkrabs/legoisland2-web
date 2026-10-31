// z38PAR: the things that fly around the pilot (behaviour nodes of 0x4676cd .. 0x4684ec): the boat circling the island, the three pterodactyls, the balloon that
// bobs between 400 and 460, the looping seaplane, and the parachute canopy that follows the pilot's pack.
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { parRun } from './par-run.ts';
import { rand, transformPoint } from './util.ts';
import { toWorld as toWorldExact } from '../exact.ts';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const f = Math.fround;

abstract class PropNode implements BehaviourNode {
  abstract readonly kind: string;
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  abstract update(w: World, rec: GameRecord): number;
}

/** FUN_004676cd / update FUN_00467520: the boat sails a circle of radius 400 around the origin (angle += 0.003 per tick), heading along the circle + 0.3456 */
export class ParBoat extends PropNode {
  readonly kind = 'ParBoat';
  /** +0x1c: the angle, +0x18: the heading (float32 node fields: every store rounds, M7 oracle) */
  angle = 0; heading = 0;
  update(_w: World, rec: GameRecord): number {
    parRun(_w).fx?.boatTick(rec);                         // FUN_00442a00(James01, record matrix) first
    const y = rec.y, ox = rec.x, oz = rec.z;
    const s = Math.sin(this.angle), c = Math.cos(this.angle);
    this.angle = f(f(0.003) * _w.dt + this.angle);        // _DAT_00892414 (float 0.003) * DAT_008b1718 + angle, stored as a float
    const nx = f(s * 400), nz = f(c * 400);               // `(float)(sin * 400)`: the position is a float, the deltas are float locals
    const h = Math.atan2(f(nx - ox), f(nz - oz));
    this.heading = f(h + f(0.3455752));                   // 0x3eb0ef3c
    rec.setEuler(0, this.heading, 0, nx, y, nz);
    return NODE_STOP;
  }
}

/** one of the three pterodactyls: the Lissajous path of FUN_004677a0 (x = sin(2 t) R + 35.784, z = cos(t) R + 29.474), flapping at twice the speed */
interface BirdDef { radius: number; y: number; step: number; phase0: number; heading: number; fly: 'birdFly1' | 'birdFly2' | 'birdFly3'; call: 'birdCall1' | 'birdCall2' | 'birdCall3' }
/** `heading` of the first bird is the float 0x892440 (0.15707964f) the original subtracts */
export const BIRDS: BirdDef[] = [
  { radius: 60, y: 934.517, step: 0.016, phase0: 0, heading: -f(0.15707964), fly: 'birdFly1', call: 'birdCall1' },
  { radius: 65, y: 954.517, step: 0.011, phase0: 8, heading: 0, fly: 'birdFly2', call: 'birdCall2' },
  { radius: 48, y: 944.517, step: 0.014, phase0: 15, heading: 0, fly: 'birdFly3', call: 'birdCall3' },
];
export const BIRD_CENTRE = [f(35.784), f(29.474)] as const;   // 0x420f22d1 / 0x41ebcac1 (float constants)

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
      if (rand(50) < 1) run.sound.at(def.call, pos);       // FUN_004677a0: `push 0x42480000` (50.0) before FUN_004388ae, then `< 1.0`: a call about every 50 ticks per bird (M7 oracle: it was rand(2) = every other tick)
      run.sound.at(def.fly, pos);
      const t = this.phase[i];
      const nx = f(f(Math.sin(t + t) * def.radius) + BIRD_CENTRE[0]), nz = f(f(Math.cos(t) * def.radius) + BIRD_CENTRE[1]);   // the product rounds to float32 before the sum (24-bit x87)
      this.phase[i] = f(f(def.step) * w.dt + t);            // the phases are float node fields (+0x1c / +0x20 / +0x24)
      const h = f(Math.atan2(f(nx - pos[0]), f(nz - pos[2])) + def.heading);     // the two differences are stored as floats (24-bit x87: fsub rounds, 0x4678ba .. 0x4678cf) before the atan2
      rec.setEuler(0, h, 0, nx, def.y, nz);
      rec.anim?.advance(2, w.dt);
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
      y = f(y - 0.5 * w.dt);                  // local_1c is a float
      if (y < 400) this.rising = true;
    } else {
      run.sound.at('balloonThrust', [rec.x, rec.y, rec.z]);
      y = f(f(0.3) * w.dt + y);               // _DAT_0089245c is a float constant
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
    rec.rx = f(f(0.027) * w.dt + rec.rx);        // _DAT_00892460 (float) * dt + the record's rx (a float field)
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
    if (pose && pose.length >= 9 * 16) pos = toWorldExact(pep.m, [pose[8 * 16 + 12], pose[8 * 16 + 13], pose[8 * 16 + 14]]);   // FUN_0043ab72 at 24 bit
    // FUN_00468338: the matrix is built with the scale of this moment (FUN_0043a742), THEN the scale moves on (DAT_05d57d30: 1 opening, 2 closing); M7 oracle: the port moved it first
    const s = this.scale;
    rec.m.set(buildMatrix(pep.rx, pep.ry, pep.rz, pos[0], pos[1], pos[2], s, s, s));
    rec.scale = [s, s, s];
    if (s <= 0) rec.flags |= 0x8000; else rec.flags &= ~0x8000;
    if (run.canopy === 1) { this.scale = f(f(0.05) * w.dt + this.scale); if (f(0.55) < this.scale) this.scale = f(0.55); }      // +0x18 is a float (0x3d4ccccd step, 0x3f0ccccd cap)
    if (run.canopy === 2) { this.scale = f(this.scale - f(0.05) * w.dt); if (this.scale < 0) this.scale = 0; }
    // the shadow patch of the canopy (FUN_00468250, only while DAT_05d57de4): the SHAD record (identity matrix, position zeroed by the pilot's constructor) is drawn with its five vertices
    // set to the points of FUN_00442a70 (`run.shadow`, GameRenderer.vertexOverride): a patch that follows the terrain
    const sh = R.shad;
    if (sh) { if (run.shadowOn) { sh.m.set(IDENTITY); sh.show(); } else sh.hide(); }
    return NODE_STOP;
  }
}
