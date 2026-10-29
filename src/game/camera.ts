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
import { toWorld } from '../zones/exact.ts';

// The original runs the x87 in 24-bit precision (Direct3D 7 leaves the control word at 0x7f): every + - * / sqrt result is a float32, so every `fr(...)` below is one operation (or a
// store) of the original; sums of three terms are added in the compiled order (x, y, z; the decompile lists them reversed); only sin / cos / atan2 results are doubles until the next operation.
// Bit-exact against the original's FUN_0042c227 / FUN_0043cc5c / FUN_0042b8e8 in the x86 emulation (tools/tests/m7-walk-*.mjs, m7-walk-cam, tolerance 0).
const fr = Math.fround;
const K = {
  QUARTER: fr(0.25), TENTH: fr(0.1), P05: fr(0.05), P025: fr(0.025), P08: fr(0.08), P8: fr(0.8), MOVED: fr(0.0064), MIN_H: fr(5.6), MID_H: fr(9.6), MID_H_VEH: fr(11.6), R04: fr(0.4), EPS: fr(1e-6),
};

/** FUN_0043cec0 */
function norm3(x: number, y: number, z: number): [number, number, number] {
  const s = fr(fr(fr(x * x) + fr(y * y)) + fr(z * z));
  if (s === 0) return [x, y, z];
  const k = fr(1 / fr(Math.sqrt(s)));
  return [fr(k * x), fr(k * y), fr(k * z)];
}
/** FUN_004171e0: a x b with the first product of every component stored as a float32 before the subtraction */
function cross(a: number[], b: number[]): [number, number, number] {
  return [fr(fr(a[1] * b[2]) - fr(a[2] * b[1])), fr(fr(a[2] * b[0]) - fr(a[0] * b[2])), fr(fr(a[0] * b[1]) - fr(a[1] * b[0]))];
}

/** the walk node's fields the camera code reads / writes (state struct at node + 0x18) */
export interface CameraWalkIO {
  /** node +0x30 / +0x38: camera key ramps 0..32 (centre 16) and the resulting sticks (node +0x34 / +0x3c, -128..127) */
  camRampX: number; camRampY: number; camStickX: number; camStickY: number;
  /** node +0x64: speed factor 0..1, +0x68 / +0x6c / +0x70: velocity */
  speed: number; vx: number; vy: number; vz: number;
}

/** DAT_008ae098: 33 floats: 0, 8, ... 248, 255 (stick value + 128) */
export const RAMP_TABLE = Array.from({ length: 33 }, (_, i) => (i === 32 ? 255 : i * 8));

export class ChaseCamera {
  /** the 18 floats of DAT_009da5e8: float32 storage like the original (the camera rests exactly on its minimum height, the compares `minH + c[4] <= c[1]` are equalities of float32 values) */
  c = new Float32Array(18);
  /** previous tick's eye / target (render interpolation) */
  prev = new Float64Array(6);
  /** _DAT_009da9c8: vertical camera velocity accumulator */
  vel = 0;
  /** DAT_00987660: non-zero while in a vehicle (changes the heights) */
  vehicle = false;
  /** DAT_009da5e0: camera preset index (offset table 0x8adbf8) */
  preset = 0;

  /** FUN_00422b50 (preset 0): target = pos + (0, 3, 0), eye = offset (0, 6.4, -16) in the record's frame (FUN_0043ab72), then the view basis; every operation a float32 */
  init(rec: GameRecord) {
    const c = this.c;
    c[6] = 0; c[7] = 1; c[8] = 0;
    c[3] = fr(0 + rec.x); c[4] = fr(3 + rec.y); c[5] = fr(0 + rec.z);
    const e = toWorld(rec.m, [0, fr(6.4), -16]);
    c[0] = e[0]; c[1] = e[1]; c[2] = e[2];
    this.updateView();
    this.vel = 0;
    this.savePrev();
  }

  savePrev() { const c = this.c; for (let i = 0; i < 6; i++) this.prev[i] = c[i]; }

  /**
   * FUN_0043cc5c(view, camera) -> FUN_004165a5 (LookAtLH): forward z = (target - eye) / |.|, up y = normalise(up - (up . z) z), right x = y x z. The view matrix's columns are copied to
   * c[9..11] (right), c[12..14] (up), c[15..17] (forward).
   */
  updateView() {
    const c = this.c;
    const z0 = [fr(c[3] - c[0]), fr(c[4] - c[1]), fr(c[5] - c[2])];
    let len = fr(Math.sqrt(fr(fr(fr(z0[0] * z0[0]) + fr(z0[1] * z0[1])) + fr(z0[2] * z0[2]))));
    if (!(K.EPS <= len)) return;      // 0x80070057: the matrix is left alone (the original returns an error before touching the basis)
    const z = [fr(z0[0] / len), fr(z0[1] / len), fr(z0[2] / len)];
    const up = [c[6], c[7], c[8]];
    const dot = fr(fr(fr(up[0] * z[0]) + fr(up[1] * z[1])) + fr(up[2] * z[2]));
    let y = [fr(up[0] - fr(dot * z[0])), fr(up[1] - fr(dot * z[1])), fr(up[2] - fr(dot * z[2]))];
    len = fr(Math.sqrt(fr(fr(fr(y[0] * y[0]) + fr(y[1] * y[1])) + fr(y[2] * y[2]))));
    if (len < K.EPS) {
      // the up vector is parallel to the view direction: try (0, 1, 0), then (0, 0, 1)
      y = [fr(0 - fr(z[1] * z[0])), fr(1 - fr(z[1] * z[1])), fr(0 - fr(z[1] * z[2]))];
      len = fr(Math.sqrt(fr(fr(fr(y[0] * y[0]) + fr(y[1] * y[1])) + fr(y[2] * y[2]))));
      if (len < K.EPS) {
        y = [fr(0 - fr(z[2] * z[0])), fr(0 - fr(z[2] * z[1])), fr(1 - fr(z[2] * z[2]))];
        len = fr(Math.sqrt(fr(fr(fr(y[0] * y[0]) + fr(y[1] * y[1])) + fr(y[2] * y[2]))));
        if (len < K.EPS) return;
      }
    }
    y = [fr(y[0] / len), fr(y[1] / len), fr(y[2] / len)];
    const x = cross(y, z);
    c[9] = x[0]; c[10] = x[1]; c[11] = x[2];
    c[12] = y[0]; c[13] = y[1]; c[14] = y[2];
    c[15] = z[0]; c[16] = z[1]; c[17] = z[2];
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
   * 2 closer than 12 while the stick is pushed forward (back off). The mouse (FUN_00437ca5, `w.input.mouse`): its movement since the last tick replaces the camera sticks
   * (before the 0.1 scale), the left button zooms out like `<>` + Z, the right button in like X + C. The browser only reports the movement while the pointer is locked: the
   * chase camera asks the input mapper for the lock (`markMouseLook`) and the mapper gets it on the player's next key press or click.
   */
  chase(w: World, rec: GameRecord, mode: number, s: CameraWalkIO) {
    const c = this.c, dt = fr(w.dt), held = w.input.held;
    const col = w.col;
    const vehicle = this.vehicle;
    this.inputRamp(s, held);
    const oldTy = c[4];                                   // local_80
    let l68 = fr(c[0] - c[3]), l58 = fr(c[1] - c[4]), l60 = fr(c[2] - c[5]);
    let l5c = l68, l54 = l60;
    let l4c = fr(Math.sqrt(fr(fr(fr(l68 * l68) + 0) + fr(l60 * l60))));       // the horizontal distance of the eye to the target
    const mouse = w.input.mouse;                          // local_30 / local_20 / local_1c = FUN_00437ca5(): buttons 0x10 / 0x20 and the movement since the last tick (integers)
    w.input.markMouseLook();
    s.camStickX = fr(s.camStickX * K.QUARTER); s.camStickY = fr(s.camStickY * K.QUARTER);
    // the mouse's movement replaces the camera sticks (before the 0.1 scale)
    if (mouse.dx !== 0 || mouse.dy !== 0) { s.camStickX = fr(mouse.dx); s.camStickY = fr(mouse.dy); }
    s.camStickX = fr(s.camStickX * K.TENTH); s.camStickY = fr(s.camStickY * K.TENTH);
    // the view's right / up axes are scaled by the sticks (and stay scaled until the next view update)
    c[9] = fr(s.camStickX * c[9]); c[10] = fr(s.camStickX * c[10]); c[11] = fr(s.camStickX * c[11]);
    l5c = fr(l5c - c[9]); l54 = fr(l54 - c[11]);
    c[12] = fr(s.camStickY * c[12]); c[13] = fr(s.camStickY * c[13]); c[14] = fr(s.camStickY * c[14]);
    l58 = fr(l58 - c[13]);
    const l2c = l58;
    // the left mouse button zooms out like `<>` + Z, the right button in like X + C
    const zoomIn = (mouse.buttons & 0x20) !== 0 || ((held & 0x4000) !== 0 && (held & 0x8000) !== 0);
    const zoomOut = (mouse.buttons & 0x10) !== 0 || ((held & 0x1000) !== 0 && (held & 0x2000) !== 0);
    if (!zoomIn) {
      if (!zoomOut) {
        if (12 <= l4c) { if (28 < l4c) l4c = 28; } else l4c = 12;
      } else {
        l68 = fr(l5c - c[15]); l60 = fr(l54 - c[17]); l5c = l68; l54 = l60;
        l4c = fr(Math.sqrt(fr(fr(fr(l68 * l68) + 0) + fr(l60 * l60))));
        if (28 < l4c) l4c = 28;
      }
    } else {
      l68 = fr(l5c + c[15]); l60 = fr(l54 + c[17]); l5c = l68; l54 = l60;
      l4c = fr(Math.sqrt(fr(fr(fr(l68 * l68) + 0) + fr(l60 * l60))));
      if (l4c < 12) l4c = 12;
    }
    [l68, , l60] = norm3(l5c, 0, l54);
    l68 = fr(l68 * l4c); l60 = fr(l60 * l4c);
    l58 = l2c;
    if (mode === 2) {
      if (s.speed <= 0) { c[0] = fr(c[0] - fr(c[15] * dt)); c[2] = fr(c[2] - fr(c[17] * dt)); }
      else { c[0] = fr(fr(s.vx * dt) + c[0]); c[2] = fr(fr(s.vz * dt) + c[2]); }
      l68 = fr(c[0] - c[3]); l60 = fr(c[2] - c[5]); l5c = l68; l54 = l60;
      l4c = fr(Math.sqrt(fr(fr(fr(l60 * l60) + fr(l68 * l68)) + 0)));
    } else {
      l5c = l68; l54 = l60;
      if (mode === 1) {
        const sp = Math.sqrt(fr(fr(fr(s.vx * s.vx) + fr(s.vy * s.vy)) + fr(s.vz * s.vz)));
        if (sp <= 1) { c[0] = fr(fr(c[15] * dt) + c[0]); c[2] = fr(fr(c[17] * dt) + c[2]); }
        else { c[0] = fr(fr(fr(c[15] * s.speed) * dt) + c[0]); c[2] = fr(fr(fr(c[17] * s.speed) * dt) + c[2]); }
        l68 = fr(c[0] - c[3]); l60 = fr(c[2] - c[5]); l58 = l2c; l5c = l68; l54 = l60;
        l4c = fr(Math.sqrt(fr(fr(fr(l60 * l60) + fr(l68 * l68)) + 0)));
      }
    }
    c[0] = fr(l5c + c[3]); c[1] = fr(l58 + c[4]); c[2] = fr(l54 + c[5]);
    // has the record moved away from the old target (squared distance > 0.0064)?
    const l74m = fr(c[3] - rec.x), l6cm = fr(c[5] - rec.z);
    const l28 = fr(fr(fr(l6cm * l6cm) + fr(l74m * l74m)) + 0);
    const moved = K.MOVED < l28;
    c[3] = fr(0 + rec.x); c[4] = fr(4 + rec.y); c[5] = fr(0 + rec.z);
    // vertical ease of the target (up only)
    const l48 = c[3], l40 = c[5];
    let lc0 = 0;
    if (fr(c[4] - oldTy) > K.TENTH) lc0 = fr(fr((vehicle ? K.P08 : K.TENTH) * dt) * fr(c[4] - oldTy));
    c[4] = fr(lc0 + c[4]);
    c[1] = fr(l2c + c[4]);
    const l44 = fr(c[4] + 1);
    let l34 = vehicle ? 10 : K.MIN_H;                      // minimum eye height above the target
    let lf4 = col.terrainHeight(c[0], fr(l34 + c[4]), c[2], 0);
    if (lf4 === NO_GROUND) lf4 = 0;
    lf4 = fr(lf4 - c[4]);
    if (lf4 < 0) lf4 = 0;
    l34 = fr(l34 + lf4);
    const l18 = vehicle ? K.MID_H_VEH : K.MID_H;
    const l38 = 28;
    if (28 <= l34) l34 = fr(28 - 4);
    const l74 = fr(c[0] - l48), ld4 = fr(c[1] - l44), l6c = fr(c[2] - l40);
    const ground = col.groundRec;
    const ignore = w.focus;
    const from = [l48, l44, l40];
    const sw = (y: number, r = 1.0, k = 1.0, dx = l74, dz = l6c, f: number[] = from) => col.sweep(ignore, f, [dx, y, dz], 0xc3, r, k);
    let vel = fr(this.vel);
    let ac = false;                 // local_ac: the first sweep hit the ground record
    const hit0 = sw(ld4);
    if (!hit0) {
      let a8: unknown = null, ec: unknown = null;
      let l70 = fr(ld4 + 4);
      if (l70 <= l38) a8 = sw(l70);
      l70 = fr(ld4 - 4);
      if (l34 <= l70) ec = sw(l70);
      if (!a8 || !ec) {
        if (!a8) {
          if (!ec) {
            if (c[1] <= fr(l18 + c[4]) || !moved) {
              if (fr(l34 + c[4]) <= c[1] || !moved) {
                if (Math.abs(vel) <= K.TENTH) vel = 0; else vel = fr(vel * K.P8);
              } else { if (vel < 0) vel = 0; vel = fr(vel + K.P05); }
            } else { if (vel > 0) vel = 0; vel = fr(vel - K.P05); }
          } else { if (vel < 0) vel = 0; vel = fr(vel + K.P025); }
        } else { if (vel > 0) vel = 0; vel = fr(vel - K.P025); }
      } else vel = 0;
    } else {
      ac = hit0.rec === ground;
      const a0 = ac ? K.QUARTER : K.P05;
      let l70 = fr(ld4 + 4);
      let a8: unknown = ground ? true : null;
      if (l70 <= l38) a8 = sw(l70);
      l70 = fr(ld4 - 4);
      let ec: unknown = ground ? true : null;
      if (K.MID_H <= l70) ec = sw(l70);
      if (!a8 || ec) {
        if (!ec || a8) {
          if (a8 && ec) {
            // both directions blocked: try the extreme heights
            const aboveMax = l38 <= ld4;
            let a8b: unknown = ground ? true : null;
            if (!aboveMax) a8b = sw(l38);
            const belowMin = ld4 <= l34;
            let a8c: unknown = ground ? true : null;
            if (!belowMin) { ec = sw(l34); a8c = a8b; }
            a8 = a8c;
            if (!a8 || !ec) {
              if (!a8) { if (vel < 0) vel = 0; vel = fr(vel + a0); } else { if (vel > 0) vel = 0; vel = fr(vel - a0); }
            } else {
              // the horizontal direction to the eye, normalised
              const [nx, , nz] = norm3(l74, 0, l6c);
              const up = sw(l38, 1.0, 1.0, nx, nz);
              if (!up) { if (vel < 0) vel = 0; vel = fr(vel + a0); }
              else {
                const f0 = sw(l34, 1.0, 1.0, l74, l6c, [c[0], c[1], c[2]]);
                const a8d = sw(l38, K.R04, K.R04, 0, 0);
                if ((a8d ? a8d.rec : null) === (ground ?? null) && !f0) c[1] = fr(l34 + c[4]);   // `local_a8 == iVar2`: both 0 (no ground record, no hit) counts as equal
                vel = 0;
              }
            }
          } else { /* the original does nothing here */ }
        } else { if (vel < 0) vel = 0; vel = fr(vel + a0); }
      } else { if (vel > 0) vel = 0; vel = fr(vel - a0); }
    }
    // clamp the accumulator to +-1, apply
    if (vel <= 1.0) { if (vel < -1) vel = -1; } else vel = 1.0;
    this.vel = vel;
    const bc = ac ? 2.0 : 1.0;
    if (vel > 0 || vel < 0) c[1] = fr(fr(fr(K.P8 * vel) * bc) + c[1]);
    const hy = fr(c[1] - c[4]);
    if (hy <= l38) { if (hy < l34) c[1] = fr(l34 + c[4]); } else c[1] = fr(l38 + c[4]);
    // keep the horizontal distance to the target at `radius`
    const [nx, , nz] = norm3(fr(c[0] - c[3]), 0, fr(c[2] - c[5]));
    c[0] = fr(fr(nx * l4c) + c[3]); c[2] = fr(fr(nz * l4c) + c[5]);      // the scaled offset is stored first (0x42d475 ..)
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
