// Pepper's other modes of the island's node chain: "sgswim" (swimming, FUN_0088c740) and "PepSwitc" (the mode switch, FUN_004bb67d).
// PEPPER_CONTROL (var 0x5e) selects the active node: 1 walk (SGwalk), 2 swim (sgswim), 4 skateboard, 8 vehicle, 0x40 Ptera. Only walk <-> swim is ported:
//   walking and the feet go below the sea level -> mode 2, state 0x62 (dive);  swimming and the terrain one unit ahead reaches the sea level -> mode 1,
//   state 0x25 (out of the water) and the character is put on that spot.
import type { BehaviourNode, Controller } from './controller.ts';
import { NODE_CONTINUE, NODE_STOP } from './controller.ts';
import type { GameRecord } from './record.ts';
import type { World } from './world.ts';
import { PC, V } from './vars.ts';
import { B } from './input.ts';
import { ST, SND } from './walk.ts';

const CLIP_SWIM = 9, CLIP_TREAD = 0x41;

/**
 * FUN_0043363c (called at the end of the swim update): the sea is a loop. Beyond +-(L + 16) of the island's centre Pepper (and the camera with him) is
 * moved to the opposite edge: x' = +-L, z' = frac(z) when leaving east / west, z' = +-L, x' = frac(x) when leaving north / south. L = 1040 (tables at
 * 0x8ae370 / 0x8ae3a0 / 0x8ae3d0: 1040 default, 880 in sub-game 6, 1840 in sub-games 10 and 0x16).
 */
export function wrapWorld(w: World, rec: GameRecord) {
  const sub = w.vars.get(V.CURRENT_SUBGAME);
  const L = sub === 6 ? 880 : sub === 10 || sub === 0x16 ? 1840 : 1040;
  const x = rec.x, z = rec.z;
  let tx: number | null = null, tz = 0;
  if (-L - 16 <= z) {
    if (x <= L + 16) {
      if (z <= L + 16) { if (x < -L - 16) { tx = L; tz = 0; } }
      else { tx = 0; tz = -L; }
    } else { tx = -L; tz = 0; }
  } else { tx = 0; tz = L; }
  if (tx === null) return;
  const f = Math.fround;
  const dx = f(tx - Math.floor(x)), dz = f(tz - Math.floor(z));
  const c = w.camera.c;
  c[0] = f(c[0] + dx); c[2] = f(c[2] + dz); c[3] = f(c[3] + dx); c[5] = f(c[5] + dz);
  // (a vehicle that is not the focus record carries Pepper along: `if (param_1 != DAT_009da5d0)`, finding V11)
  const pep = w.focus;
  if (pep && rec !== pep) { pep.x = f(dx + pep.x); pep.z = f(dz + pep.z); }
  rec.x = f(x + dx); rec.z = f(z + dz);
}

const fr = Math.fround;
// float32 constants of the original (read from the executable's data): 0x8926a4, 0x8920d8, 0x8925ec, 0x89212c, 0x892084, 0x898a38, 0x89204c, 0x982b64, the camera table at 0x8adbf8 (row 0)
const K_TURN = fr(0.0872659981250763), K_PAD = fr(0.01745319925248623), K_SLOW = fr(0.04), K_FAST = fr(0.08), K_MAX = fr(0.8), K_SWEEP_Y = fr(3.6), K_BLEND = 0.5, K_VEH = 3;
const CAM_EYE_Y = fr(6.4), CAM_EYE_Z = -16, CAM_TARGET_Y = 3;
/** FUN_00422ddc: the lowest the camera eye may go above the record, per camera preset (table 0x8adbf8 + 4 + 12 * preset; presets 0 .. 5) */
const CAM_MIN_H = [fr(6.4), 1, 1, 1, fr(10.4), 8];

export class SwimNode implements BehaviourNode {
  readonly kind = 'sgswim';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  /** node +0x18: 0 while the dive clip plays, then the clip's result */
  phase = 0;
  /** node +0x1c: swim speed 0..0.8 */
  speed = 0;
  accessory: GameRecord | null = null;
  /** the pad stick (FUN_004376f9 out +4 / +8, -128..127; 0 for the keyboard) */
  padX = 0; padY = 0;
  constructor(v: number = V.PEPPER_CONTROL, mask: number = PC.SWIM, value: number = PC.SWIM) { this.var = v; this.mask = mask; this.value = value; }

  /** FUN_0088c740. Every arithmetic result of the original is a float32 (the x87 runs in 24-bit precision), so every operation is wrapped in Math.fround here, see docs/re/engine-m1.md "Differential test". */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    const dt = fr(w.dt), anim = rec.anim, held = w.input.held;
    const c = w.camera.c;
    if (this.stamp !== w.frame) { this.phase = 0; this.speed = 0; }
    if (this.phase === 0) {
      rec.y = w.seaLevel;
      if (anim) this.phase = anim.advance(1.0, w.dt);
      // the accessory (the pizza / the held item) sinks with the dive (record +0x40 of DAT_009daa7c)
      if (this.accessory) this.accessory.y = fr(this.accessory.y - K_MAX);
      w.playSound(SND.DIVE);
      if (this.phase === 2) { anim?.start(CLIP_TREAD, 0); this.accessory?.hide(); }
      rec.rebuildYaw();
    } else {
      if (held & B.LEFT) rec.ry = fr(rec.ry - K_TURN);
      if (held & B.RIGHT) rec.ry = fr(rec.ry + K_TURN);
      if (!(held & B.UP)) {
        if (this.speed <= 0) this.speed = 0;
        else { this.speed = fr(this.speed - K_SLOW); if (this.speed <= 0) anim?.start(CLIP_TREAD, 0); }
      } else if (K_MAX <= this.speed) this.speed = K_MAX;
      else this.speed = fr(this.speed + K_FAST);
      const px = this.padX | 0, py = this.padY | 0;
      if (px > 0x14 || px < -0x14) rec.ry = fr(fr((px >> 5) * K_PAD) + rec.ry);
      if (py < -0x14) this.speed = -(py >> 1);
      if (anim && anim.clip !== CLIP_SWIM && this.speed > 0) anim.start(CLIP_SWIM, 0);
      rec.rebuildYaw();
      const ux = fr(this.speed * rec.m[8]), uz = fr(this.speed * rec.m[10]);
      const sy = fr(rec.y + K_SWEEP_Y);
      const from = [rec.x, sy, rec.z];
      let vx = fr(ux * dt), vz = fr(uz * dt);
      const h = w.col.sweep(rec, from, [vx, 0, vz], 3, fr(0.4), fr(0.4));
      let mx = ux, mz = uz;
      if (h) {
        // the dot product uses the dt-scaled step, the remaining speed is taken from the unscaled one (identical at dt 1)
        const dot = fr(fr(fr(h.normal[0] * vx) + fr(h.normal[1] * 0)) + fr(h.normal[2] * vz));
        mx = fr(ux - fr(h.normal[0] * dot)); mz = fr(uz - fr(h.normal[2] * dot));
        if (w.col.sweep(rec, [rec.x, sy, rec.z], [mx, 0, mz], 3, fr(0.4), fr(0.4))) { mx = 0; mz = 0; }
      }
      rec.x = fr(fr(mx * dt) + rec.x); rec.z = fr(fr(mz * dt) + rec.z);
      rec.y = w.seaLevel;
      // the camera follows the wrap at +-1840 first (the island's own loop, FUN_0043363c, runs at the end)
      const span = 3680;
      if (-1840 <= rec.x) { if (1840 < rec.x) { c[0] = fr(c[0] - span); c[3] = fr(c[3] - span); rec.x = rec.x - span; } } else { c[0] = fr(c[0] + span); c[3] = fr(c[3] + span); rec.x = rec.x + span; }
      if (-1840 <= rec.z) { if (1840 < rec.z) { c[2] = fr(c[2] - span); c[5] = fr(c[5] - span); rec.z = rec.z - span; } } else { c[2] = fr(c[2] + span); c[5] = fr(c[5] + span); rec.z = rec.z + span; }
      if (anim) {
        if (anim.clip === CLIP_TREAD) anim.advance(0.5, w.dt);
        else anim.advance(this.speed * 0.125 * 8, w.dt);
        // after either advance the stroke's sound (DAT_009da910 = SND_PEPP_SWIM) plays while the frame is 18..20 (a one-shot: no restart while it plays)
        const f = Math.trunc(anim.frame);
        if (0x11 < f && f < 0x15) w.playSound(SND.SWIM);
      }
    }
    // FUN_00422c7e(camera, record matrix, 0, 1): target above the record, eye halfway to the ideal spot behind it (offset (0, 6.4, -16) in the record's frame, FUN_0043ab72)
    const m = rec.m;
    c[3] = fr(0 + m[12]); c[4] = fr(CAM_TARGET_Y + m[13]); c[5] = fr(0 + m[14]);
    const ix = fr(fr(fr(fr(0 * m[0]) + fr(CAM_EYE_Y * m[4])) + fr(CAM_EYE_Z * m[8])) + m[12]);
    const iy = fr(fr(fr(fr(0 * m[1]) + fr(CAM_EYE_Y * m[5])) + fr(CAM_EYE_Z * m[9])) + m[13]);
    const iz = fr(fr(fr(fr(0 * m[2]) + fr(CAM_EYE_Y * m[6])) + fr(CAM_EYE_Z * m[10])) + m[14]);
    c[0] = fr(fr(fr(ix - c[0]) * K_BLEND) + c[0]); c[1] = fr(fr(fr(iy - c[1]) * K_BLEND) + c[1]); c[2] = fr(fr(fr(iz - c[2]) * K_BLEND) + c[2]);
    if (w.camera.vehicle) c[1] = fr(c[1] + K_VEH);
    // FUN_00422ddc: never below the preset's minimum height above the record, sink by 0.8 per tick when more than 32 above it
    const want = fr((CAM_MIN_H[w.camera.preset] ?? CAM_MIN_H[0]) + rec.y);
    if (want <= c[1]) { if (fr(c[1] - want) > 32) c[1] = fr(c[1] - K_MAX); } else c[1] = want;
    wrapWorld(w, rec);
    return NODE_STOP;
  }
}

/**
 * A transition rule of the mode switch: looks at the player in mode `mode` (PEPPER_CONTROL & 0xfff) and returns the new mode and walk-state (clip) to
 * start, or null. Later milestones add the skateboard (Ctrl), vehicles (Ctrl near a vehicle) and the Ptera by pushing rules here.
 */
export type PepperModeRule = (w: World, rec: GameRecord, mode: number) => { mode: number; state: number } | null;
export const pepperModeRules: PepperModeRule[] = [
  // walking and the feet go below the sea level (FUN_004bb67d, mode 1)
  (w, rec, mode) => (mode === PC.WALK && rec.y < w.seaLevel ? { mode: PC.SWIM, state: 0x62 } : null),
  // swimming and the terrain one unit ahead reaches the sea level (mode 2): out of the water on that spot
  (w, rec, mode) => {
    if (mode !== PC.SWIM) return null;
    // float32 locals of FUN_004bb67d (local_10 / local_8 / local_c): the terrain query gets the rounded values
    const px = fr(rec.m[8] + rec.x), pz = fr(rec.m[10] + rec.z), py = fr(rec.m[9] + rec.y + 4.0);
    if (w.seaLevel > w.col.terrainHeight(px, py, pz, 4)) return null;
    w.playSound(SND.LEAVE_WATER);
    rec.y = py; rec.x = px; rec.z = pz;
    return { mode: PC.WALK, state: ST.OUTOFWATER };
  },
];

/** "PepSwitc": switches the mode word (PEPPER_CONTROL) with the rules above. Only the walk <-> swim transitions are implemented. */
export class PepSwitchNode implements BehaviourNode {
  readonly kind = 'PepSwitc';
  var: number = V.PEPPER_CONTROL; mask = 0; value = 0;
  stamp = 0xfffffffe;
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    const word = w.vars.get(V.PEPPER_CONTROL);
    const base = word & 0xfff;
    if (base === PC.WALK) w.vars.set(0xbb, 0);     // PORTAL_VEHICLE
    for (const rule of pepperModeRules) {
      const r = rule(w, rec, base);
      if (!r) continue;
      if (r.state !== 0) { w.pep.mailbox = r.state; rec.anim?.start(r.state, 0); }
      w.vars.set(V.PEPPER_CONTROL, r.mode | (word & PC.INTERACT));
      break;
    }
    return NODE_CONTINUE;
  }
}
