// The chase camera of the walking player (inline in the walk code: FUN_0042c227, 497 lines of the decompile) and its set-up (FUN_00422b50),
// the per-frame view basis (FUN_0043cc5c) (the "wall push" of the island's draw pass, FUN_004229a0, is compiled out of the game).
// Camera struct DAT_009da5e8 as floats: [0..2] eye, [3..5] look-at target, [6..8] up (0,1,0), [9..11] view right, [12..14] view up,
// [15..17] view forward (the last three are the columns of the view matrix, rewritten every frame by FUN_0043cc5c).
// Constants (docs in comments): radius clamp 12..28 (DAT_008ae060 / 064), minimum height above the target 5.6 (10 in vehicles), mid height 9.6
// (11.6), maximum 28 (0x892... literal), target = Pepper + (0, 4, 0) (DAT_008ae1a0..a8), vertical ease 0.1 (0.08 in vehicles).
import type { GameRecord } from './record.ts';
import type { World } from './world.ts';
import { NO_GROUND } from './collision.ts';
import { B } from './input.ts';

/** the walk node's fields the camera code reads / writes (state struct at node + 0x18) */
export interface CameraWalkIO {
  /** node +0x30 / +0x38: camera key ramps 0..32 (centre 16) and the resulting sticks (node +0x34 / +0x3c, -128..127) */
  camRampX: number; camRampY: number; camStickX: number; camStickY: number;
  /** node +0x64: speed factor 0..1, +0x68 / +0x6c / +0x70: velocity */
  speed: number; vx: number; vy: number; vz: number;
}

/** DAT_008ae098: 33 floats: 0, 8, ... 248, 255 (stick value + 128) */
export const RAMP_TABLE = Array.from({ length: 33 }, (_, i) => (i === 32 ? 255 : i * 8));
const CAM_RADIUS_MIN = 12, CAM_RADIUS_MAX = 28;
const CAM_MAX_HEIGHT = 28;

export class ChaseCamera {
  /** the 18 floats of DAT_009da5e8 */
  c = new Float64Array(18);
  /** previous tick's eye / target (render interpolation) */
  prev = new Float64Array(6);
  /** _DAT_009da9c8: vertical camera velocity accumulator */
  vel = 0;
  /** DAT_00987660: non-zero while in a vehicle (changes the heights) */
  vehicle = false;
  /** DAT_009da5e0: camera preset index (offset table 0x8adbf8) */
  preset = 0;

  /** FUN_00422b50 (preset 0): target = pos + (0, 3, 0), eye = offset (0, 6.4, -16) in the record's frame */
  init(rec: GameRecord) {
    const c = this.c;
    c[6] = 0; c[7] = 1; c[8] = 0;
    c[3] = 0 + rec.x; c[4] = 3 + rec.y; c[5] = 0 + rec.z;
    const e = rec.toWorld([0, 6.4, -16]);
    c[0] = e[0]; c[1] = e[1]; c[2] = e[2];
    this.updateView();
    this.vel = 0;
    this.savePrev();
  }

  savePrev() { const c = this.c; for (let i = 0; i < 6; i++) this.prev[i] = c[i]; }

  /** FUN_0043cc5c: the view basis from eye -> target with up (0, 1, 0) (left-handed look-at) */
  updateView() {
    const c = this.c;
    let fx = c[3] - c[0], fy = c[4] - c[1], fz = c[5] - c[2];
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let rx = fz, rz = -fx;
    const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    // up = forward x right
    const ux = fy * rz - fz * 0, uy = fz * rx - fx * rz, uz = fx * 0 - fy * rx;
    c[9] = rx; c[10] = 0; c[11] = rz;
    c[12] = ux; c[13] = uy; c[14] = uz;
    c[15] = fx; c[16] = fy; c[17] = fz;
  }

  /** FUN_0042b8e8: Z / X / C / `<>` move the camera sticks (the same integer ramp as the player's keys) */
  inputRamp(s: CameraWalkIO, held: number) {
    let rx = s.camRampX, ry = s.camRampY, b1 = false, b2 = false;
    if ((held & B.KEY1000) !== 0 && (held & 0xffffdfff) !== 0) { b1 = true; rx = rx < 0x11 ? rx - 3 : 0x10; if (rx < 1) rx = 0; }
    if ((held & B.Z) !== 0 && (held & 0xffffefff) !== 0) { b1 = true; rx = rx < 0x10 ? 0x10 : rx + 3; if (rx > 0x1f) rx = 0x20; }
    if ((held & B.X) !== 0 && (held & 0xffff7fff) !== 0) { b2 = true; ry = ry < 0x11 ? ry - 3 : 0x10; if (ry < 1) ry = 0; }
    if ((held & B.C) !== 0 && (held & 0xffffbfff) !== 0) { b2 = true; ry = ry < 0x10 ? 0x10 : ry + 3; if (ry > 0x1f) ry = 0x20; }
    if (!b1) {
      if (rx > 0x10) { rx -= 4; if (rx < 0x10) rx = 0x10; }
      if (rx < 0x10) { rx += 4; if (rx > 0x10) rx = 0x10; }
    }
    if (!b2) {
      if (ry > 0x10) { ry -= 4; if (ry < 0x10) ry = 0x10; }
      if (ry < 0x10) { ry += 4; if (ry > 0x10) ry = 0x10; }
    }
    s.camRampY = ry; s.camStickY = RAMP_TABLE[ry] - 128;
    s.camRampX = rx; s.camStickX = RAMP_TABLE[rx] - 128;
  }

  /**
   * FUN_0042c227(camera, record matrix, preset, mode, speed, state). `mode`: 0 normal, 1 the camera is further than 28 from Pepper (catch up),
   * 2 closer than 12 while the stick is pushed forward (back off). Not ported: the mouse look (only active while the mouse is captured).
   */
  chase(w: World, rec: GameRecord, mode: number, s: CameraWalkIO) {
    const c = this.c, dt = w.dt, held = w.input.held;
    const col = w.col;
    let moved = false;
    this.inputRamp(s, held);
    const oldTy = c[4];
    let offY = c[1] - c[4];
    const off0X = c[0] - c[3], off0Z = c[2] - c[5];
    let hx = off0X, hz = off0Z;
    let radius = Math.hypot(off0Z, off0X);
    s.camStickX *= 0.25; s.camStickY *= 0.25;
    s.camStickX *= 0.1; s.camStickY *= 0.1;
    // the right / up basis vectors are scaled by the sticks (and stay scaled until the next view update)
    c[9] *= s.camStickX; c[10] *= s.camStickX; c[11] *= s.camStickX;
    hx -= c[9]; hz -= c[11];
    c[12] *= s.camStickY; c[13] *= s.camStickY; c[14] *= s.camStickY;
    offY -= c[13];
    const keepY = offY; // local_2c
    const zoomIn = (held & B.X) !== 0 && (held & B.C) !== 0;
    const zoomOut = (held & B.KEY1000) !== 0 && (held & B.Z) !== 0;
    if (!zoomIn) {
      if (!zoomOut) {
        if (radius >= CAM_RADIUS_MIN) { if (radius > CAM_RADIUS_MAX) radius = CAM_RADIUS_MAX; } else radius = CAM_RADIUS_MIN;
      } else {
        radius = Math.hypot(hz - c[17], hx - c[15]);
        if (radius > CAM_RADIUS_MAX) radius = CAM_RADIUS_MAX;
      }
    } else {
      radius = Math.hypot(hz + c[17], hx + c[15]);
      if (radius < CAM_RADIUS_MIN) radius = CAM_RADIUS_MIN;
    }
    // direction of the orbit offset, scaled to the radius
    let dx = hx, dz = hz;
    { const l = Math.hypot(dx, dz); if (l > 0) { dx /= l; dz /= l; } }
    dx *= radius; dz *= radius; offY = keepY;
    if (mode === 2) {
      if (s.speed <= 0) { c[0] -= c[15] * dt; c[2] -= c[17] * dt; }
      else { c[0] += s.vx * dt; c[2] += s.vz * dt; }
      dx = c[0] - c[3]; dz = c[2] - c[5]; hx = dx; hz = dz;
      radius = Math.hypot(dz, dx);
    } else {
      hx = dx; hz = dz;
      if (mode === 1) {
        const spd = Math.hypot(s.vx, s.vy, s.vz);
        if (spd <= 1) { c[0] += c[15] * dt; c[2] += c[17] * dt; }
        else { c[0] += c[15] * s.speed * dt; c[2] += c[17] * s.speed * dt; }
        dx = c[0] - c[3]; dz = c[2] - c[5]; offY = keepY; hx = dx; hz = dz;
        radius = Math.hypot(dz, dx);
      }
    }
    c[0] = hx + c[3]; c[1] = offY + c[4]; c[2] = hz + c[5];
    // has the record moved away from the old target (squared distance > 0.0064)?
    const tdx = c[3] - rec.x, tdz = c[5] - rec.z;
    if (tdx * tdx + tdz * tdz > 0.0064) moved = true;
    c[3] = 0 + rec.x; c[4] = 4 + rec.y; c[5] = 0 + rec.z;
    // vertical ease of the target (up only; DAT_008920a0 is the double 0.1)
    const diffY = c[4] - oldTy;
    let c0 = 0;
    if (diffY > 0.1) c0 = (this.vehicle ? 0.08 : 0.1) * dt * diffY;
    c[4] += c0;
    c[1] = keepY + c[4];
    const px = c[3], py = c[4] + 1, pz = c[5];            // local_48 / 44 / 40: where the camera sweeps start
    let minH = this.vehicle ? 10 : 5.6;                     // local_34
    let tg = col.terrainHeight(c[0], minH + c[4], c[2], 0);
    if (tg === NO_GROUND) tg = 0;
    tg -= c[4]; if (tg < 0) tg = 0;
    minH += tg;
    const midH = this.vehicle ? 11.6 : 9.6;                 // local_18
    const maxH = CAM_MAX_HEIGHT;                            // local_38
    if (minH >= maxH) minH = maxH - 4;
    const ground = col.groundRec;
    const ignore = w.focus;
    const dX = c[0] - px, dY0 = c[1] - py, dZ = c[2] - pz;   // local_74 / local_d4 / local_6c
    const sw = (y: number, r = 1.0, k = 1.0, dx2 = dX, dz2 = dZ, from: ArrayLike<number> = [px, py, pz]) => col.sweep(ignore, from, [dx2, y, dz2], 0xc3, r, k);
    let vel = this.vel;
    let hitGround = false;       // local_ac
    const hit0 = sw(dY0);
    if (!hit0) {
      let a8: unknown = null, ec: unknown = null;
      if (dY0 + 4 <= maxH) a8 = sw(dY0 + 4);
      if (minH <= dY0 - 4) ec = sw(dY0 - 4);
      if (!a8 || !ec) {
        if (!a8) {
          if (!ec) {
            if (c[1] <= midH + c[4] || !moved) {
              if (minH + c[4] <= c[1] || !moved) {
                if (Math.abs(vel) <= 0.1) vel = 0; else vel *= 0.8;
              } else { if (vel < 0) vel = 0; vel += 0.05; }
            } else { if (vel > 0) vel = 0; vel -= 0.05; }
          } else { if (vel < 0) vel = 0; vel += 0.025; }
        } else { if (vel > 0) vel = 0; vel -= 0.025; }
      } else vel = 0;
    } else {
      hitGround = hit0.rec === ground;
      const a0 = hitGround ? 0.25 : 0.05;
      let a8: unknown = ground ?? true, ec: unknown = ground ?? true;
      if (dY0 + 4 <= maxH) a8 = sw(dY0 + 4);
      if (dY0 - 4 >= 9.6) ec = sw(dY0 - 4);
      if (!a8 && !ec) { /* nothing */ }
      else if (!a8 && ec) { if (vel < 0) vel = 0; vel += a0; }
      else if (a8 && !ec) { if (vel > 0) vel = 0; vel -= a0; }
      else {
        // both directions blocked: try the extreme heights
        const aboveMax = maxH <= dY0;
        let a8b: unknown = ground ?? true;
        if (!aboveMax) a8b = sw(maxH);
        const belowMin = dY0 <= minH;
        let a8c: unknown = ground ?? true;
        if (!belowMin) { ec = sw(minH); a8c = a8b; }
        a8 = a8c;
        if (!a8 || !ec) {
          if (!a8) { if (vel < 0) vel = 0; vel += a0; } else { if (vel > 0) vel = 0; vel -= a0; }
        } else {
          let nx = dX, nz = dZ;
          { const l = Math.hypot(nx, nz); if (l > 0) { nx /= l; nz /= l; } }
          const up = sw(maxH, 1.0, 1.0, nx, nz);
          if (!up) { if (vel < 0) vel = 0; vel += a0; }
          else {
            const f0 = sw(minH, 1.0, 1.0, dX, dZ, [c[0], c[1], c[2]]);
            const a8d = sw(maxH, 0.4, 0.4, 0, 0);
            if (a8d && a8d.rec === ground && !f0) c[1] = minH + c[4];
            vel = 0;
          }
        }
      }
    }
    // clamp the accumulator to +-1, apply
    if (vel <= 1.0) { if (vel < -1) vel = -1; } else vel = 1.0;
    this.vel = vel;
    const bc = hitGround ? 2.0 : 1.0;
    if (vel > 0 || vel < 0) c[1] = 0.8 * vel * bc + c[1];
    const hy = c[1] - c[4];
    if (hy <= maxH) { if (hy < minH) c[1] = minH + c[4]; } else c[1] = maxH + c[4];
    // keep the horizontal distance to the target at `radius`
    let nx = c[0] - c[3], nz = c[2] - c[5];
    { const l = Math.hypot(nx, nz); if (l > 0) { nx /= l; nz /= l; } }
    c[0] = nx * radius + c[3]; c[2] = nz * radius + c[5];
  }

  /**
   * The eye used for drawing. FUN_004229a0 ("wall push": sweep from the target to the eye with radius 4 / skin 1.1 and draw from the hit point, hub
   * zones only) is called at the top of the draw pass FUN_0042271b under `if (0)` (the disassembly at 0x42272f is `xor eax,eax; test eax,eax; je`),
   * i.e. it is compiled out of the shipped game. So the view is simply the eye.
   */
  viewEye(_w: World): [number, number, number] {
    void _w;
    const c = this.c;
    return [c[0], c[1], c[2]];
  }
}
