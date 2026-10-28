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
  const dx = tx - Math.floor(x), dz = tz - Math.floor(z);
  const c = w.camera.c;
  c[0] += dx; c[2] += dz; c[3] += dx; c[5] += dz;
  rec.x = x + dx; rec.z = z + dz;
}

export class SwimNode implements BehaviourNode {
  readonly kind = 'sgswim';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  /** node +0x18: 0 while the dive clip plays, then the clip's result */
  phase = 0;
  /** node +0x1c: swim speed 0..0.8 */
  speed = 0;
  accessory: GameRecord | null = null;
  constructor(v: number = V.PEPPER_CONTROL, mask: number = PC.SWIM, value: number = PC.SWIM) { this.var = v; this.mask = mask; this.value = value; }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    const dt = w.dt, anim = rec.anim, held = w.input.held;
    if (this.stamp !== w.frame) { this.phase = 0; this.speed = 0; }
    if (this.phase === 0) {
      rec.y = w.seaLevel;
      if (anim) this.phase = anim.advance(1.0, dt);
      w.playSound(SND.DIVE);
      if (this.phase === 2) { anim?.start(CLIP_TREAD, 0); this.accessory?.hide(); }
      rec.rebuildYaw();
    } else {
      if (held & B.LEFT) rec.ry -= 0.08726640045642853;
      if (held & B.RIGHT) rec.ry += 0.08726640045642853;
      if (!(held & B.UP)) {
        if (this.speed <= 0) this.speed = 0;
        else { this.speed -= 0.04; if (this.speed <= 0) anim?.start(CLIP_TREAD, 0); }
      } else if (this.speed >= 0.8) this.speed = 0.8;
      else this.speed += 0.08;
      if (anim && anim.clip !== CLIP_SWIM && this.speed > 0) anim.start(CLIP_SWIM, 0);
      rec.rebuildYaw();
      let vx = this.speed * rec.m[8], vz = this.speed * rec.m[10];
      const from = [rec.x, rec.y + 3.6, rec.z];
      const h = w.col.sweep(rec, from, [vx * dt, 0, vz * dt], 3, 0.4, 0.4);
      if (h) {
        const dot = h.normal[2] * vz * dt + h.normal[1] * 0 + h.normal[0] * vx * dt;
        vx -= h.normal[0] * dot; vz -= h.normal[2] * dot;
        if (w.col.sweep(rec, from, [vx * dt, 0, vz * dt], 3, 0.4, 0.4)) { vx = 0; vz = 0; }
      }
      rec.x += vx * dt; rec.z += vz * dt;
      rec.y = w.seaLevel;
      if (anim) {
        if (anim.clip === CLIP_TREAD) anim.advance(0.5, dt);
        else anim.advance(this.speed * 0.125 * 8, dt);
      }
    }
    wrapWorld(w, rec);
    // swim camera: target above the character, the eye follows the ideal spot behind it halfway per tick and never sinks below 6.4 above the water
    const c = w.camera.c;
    c[3] = rec.x; c[4] = 3 + rec.y; c[5] = rec.z;
    const ideal = rec.toWorld([0, 6.4, -16]);
    c[0] = (ideal[0] - c[0]) * 0.5 + c[0]; c[1] = (ideal[1] - c[1]) * 0.5 + c[1]; c[2] = (ideal[2] - c[2]) * 0.5 + c[2];
    const want = 6.4 + rec.y;
    if (want <= c[1]) { if (c[1] - want > 32) c[1] -= 0.8; } else c[1] = want;
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
    const px = rec.m[8] + rec.x, pz = rec.m[10] + rec.z, py = rec.m[9] + rec.y + 4.0;
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
