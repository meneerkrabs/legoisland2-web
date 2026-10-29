// The camera of z20DSP: FUN_006bd776, run once per loop iteration in every mode (the Speedster's record is the subject, the path parameter of the car decides the
// heading). docs/re/m6/z20DSP.md section 7.
//   state 0 / 1 (intro, help): an orbit around the car: the eye is (0, 14, -28) rotated by (1 - n / 270) * 5 pi / 4 about the car (n counts up to 270 loop passes)
//   state 2 .. 7:               a chase camera: the eye is (0, 14, -28) in a frame turned by an angle that eases 1/16 per pass towards the heading of the track at the car
//                               (the first pass of state 2 resets the angle to 0); the eye is pushed away from the terrain walls to the left and right of the track
// The target is always 6 above the car.
import type { World } from '../../game/world.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { DspShared, VAR, REC } from './shared.ts';

const PI = 3.1415927410125732, TWO_PI = 6.2831854820251465;
/** DAT_0089281c: the orbit length in passes, DAT_00892818: 5 pi / 4 */
const ORBIT_PASSES = 270, ORBIT_ANGLE = 3.9269697666168213;
/** the eye's offset in the car's frame (0x41600000 / 0xc1e00000), the target's height above the car (DAT_0089228c) */
const EYE = { y: 14.0, z: -28.0 }, TARGET_UP = 6.0;
/** DAT_00892814: half the width of the lateral wall test across the track at the camera */
const SIDE = 9.2;

export class DspCamera {
  /** DAT_05d5c0b4: the orbit counter (reset by the zone loop at its start) */
  orbit = 0;
  /** DAT_05d5c0b0: the chase angle */
  angle = 0;
  /** last wall pushes (diagnostics) */
  pushes = 0;

  /** one pass of FUN_006bd776 followed by FUN_006bd706's view basis */
  step(w: World, sh: DspShared) {
    const state = w.vars.get(VAR.STATE);
    const c = w.camera.c;
    const car = w.records[REC.PEPP];
    if (state === 0 || state === 1) {
      this.orbit += 1.0;
      if (ORBIT_PASSES <= this.orbit) this.orbit = ORBIT_PASSES;
      c[3] = car.m[12]; c[4] = car.m[13] + TARGET_UP; c[5] = car.m[14];
      const a = (1.0 - this.orbit / ORBIT_PASSES) * ORBIT_ANGLE + 0;
      const m = buildMatrix(0, a, 0, car.m[12], car.m[13], car.m[14]);
      const e = tx(m, 0, EYE.y, EYE.z);
      c[0] = e[0]; c[1] = e[1]; c[2] = e[2];
    } else if (state >= 2 && state <= 7) {
      if (state === 2) this.angle = 0;
      c[3] = car.m[12]; c[4] = car.m[13] + TARGET_UP; c[5] = car.m[14];
      const t = sh.track.nearest([car.x, car.y, car.z]);
      const fr = sh.track.frame(t);
      const heading = Math.atan2(fr.t[0], fr.t[2]);
      let d = heading - this.angle;
      if (-PI <= d) { if (PI < d) d -= TWO_PI; } else d += TWO_PI;
      this.angle += 0.0625 * d;
      if (PI < this.angle) this.angle -= TWO_PI;
      if (this.angle < -PI) this.angle += TWO_PI;
      const m = buildMatrix(0, this.angle, 0, car.x, car.y, car.z);
      const e = tx(m, 0, EYE.y, EYE.z);
      // the lateral wall test: a ray from (eye - 9.2 R) to (eye + 9.2 R) against LAND, then back; a front-facing hit pushes the eye away by the length beyond the hit
      const R = fr.r, land = w.records[REC.LAND];
      let lat = [R[0] * SIDE, R[1] * SIDE, R[2] * SIDE];
      let p = [e[0] - lat[0], e[1] - lat[1], e[2] - lat[2]];
      let dl = [lat[0] * 2, lat[1] * 2, lat[2] * 2];
      this.pushes = 0;
      for (let pass = 0; pass < 2; pass++) {
        const hit = land ? w.col.rayRecord(land, p, dl, 3, 0.01, 0.01) : null;
        if (hit && hit.normal[0] * dl[0] + hit.normal[1] * dl[1] + hit.normal[2] * dl[2] < 0) {
          e[0] -= (p[0] + dl[0]) - hit.point[0]; e[1] -= (p[1] + dl[1]) - hit.point[1]; e[2] -= (p[2] + dl[2]) - hit.point[2];
          this.pushes++;
        }
        p = [p[0] + dl[0], p[1] + dl[1], p[2] + dl[2]];
        dl = [-dl[0], -dl[1], -dl[2]];
      }
      // FUN_0043ce45 with no ground record set finds nothing (-1e38): the "stay 12 above the terrain" clamp of the original never applies
      c[0] = e[0]; c[1] = e[1]; c[2] = e[2];
    }
    w.camera.updateView();
  }
}

/** FUN_0043ab72: row-vector transform */
function tx(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
  return [x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14]];
}
