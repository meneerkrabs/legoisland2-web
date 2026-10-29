// The probe pass of the node framework (FUN_00427233, with the set-up FUN_00427014): the original runs it once per frame between the update pass and the pre-render pass
// (zone loops: `FUN_00427233(records, count); FUN_004225c5(records, count);`). Every record whose controller has an armed probe samples the ground and / or sweeps a segment against the
// collision world at its (follow-)offset, and writes the result back into the controller and, with flag 2, into the record's position: ambient animals, carried props, doors ride the ground this way.
// This module is that function, transliterated (`probePass`) and compared with the original on the x86 emulator (tools/tests/render-probe.mjs). It is pure: the engine calls it needs are injected.
//
// Controller fields (offsets in the original's controller block): +0x0c flags (bit 2 = enabled), +0x14 bit 0x10 (set by the update pass: near the focus), +0x18 / +0x1c (the 0x8000 gate),
// +0x20 offset (the probe's start; flag 1 adds the record's position IN PLACE every frame), +0x2c start (written), +0x38 delta (the segment; flag 8 overwrites it with the contact normal),
// +0x44 skin, +0x48 radius (FUN_00427014 sets 0 and 0.1), +0x4c mask (0 = unarmed; FUN_00427014 sets it, the pass zeroes it after use: ONE probe per arming), +0x50 extra offset,
// +0x5c flags (FUN_00427014 ORs 0x1003), +0x60 timer (32.0 initially when negative), +0x64 result (the hit record, 1 = moved without a hit, 0 = nothing, 0xbabababa = switched off).
//
// Flags (+0x5c): 1 follow the record, 2 write the result into the record, 4 add the extra offset to the result, 8 store normal and contact into the controller, 0x10 ground sample FUN_0043cd62
// (and the probe variant of the sweep), 0x20 ground sample FUN_0043ce45, 0x40 no sweep, 0x200 / 0x400 / 0x8000 throttle (4 / 8 ticks between probes), 0x1000 y-only write and the NPC-record rule,
// 0x2000 needs the controller's near flag, 0x4000 needs the record's frustum bit.

/** `*(controller + 100)` of a controller whose probe was switched off by a throttle or a gate */
export const PROBE_DEAD = 0xbabababa;
/** _DAT_008920c4: the value below which a ground sample means "no ground" (-1e38, the `NO_GROUND` of collision.ts) */
const fr = Math.fround;
const NO_GROUND = fr(-1e38);

export interface ProbeCtrl {
  flags: number;
  near: number;
  d18: number; d1c: number;
  off: [number, number, number];
  start: [number, number, number];
  delta: [number, number, number];
  skin: number; radius: number;
  mask: number;
  extra: [number, number, number];
  pflags: number;
  timer: number;
  result: number | object;
}
export interface ProbeRecord { x: number; y: number; z: number; flags: number; ctrl: ProbeCtrl | null }
export interface ProbeHit { rec: ProbeRecord; point: [number, number, number]; normal: [number, number, number] }
export interface ProbeEnv {
  /** DAT_008b1718: the frame length in 1/30 s ticks (the throttle timers are dt-scaled) */
  dt: number;
  /** FUN_0043cd62(position, 4.0): the terrain height below `p` + 4 (-1e38 = none) */
  ground(p: ArrayLike<number>): number;
  /** FUN_0043ce45(position, 4.0, mask): the same through the second terrain ray */
  ground2(p: ArrayLike<number>, mask: number): number;
  /** FUN_00441270(record, from, delta, normal, point, mask, radius, skin): the nearest hit of the segment against every record (or null); `probe` = FUN_00441ac0 (radius 0.01, skin 0, the ground record skipped) */
  sweep(owner: ProbeRecord, from: ArrayLike<number>, delta: ArrayLike<number>, mask: number, radius: number, skin: number, probe: boolean): ProbeHit | null;
}

/** FUN_00427014(ctrl, offset, delta, mask, flags): arms the probe of a controller */
export function armProbe(c: ProbeCtrl, off: ArrayLike<number>, delta: ArrayLike<number>, mask: number, flags: number) {
  c.result = 0; c.skin = 0; c.radius = fr(0.1);
  c.delta = [delta[0], delta[1], delta[2]];
  c.off = [off[0], off[1], off[2]];
  c.mask = mask; c.pflags = (flags | 0x1003) >>> 0;
  if (c.timer < 0) c.timer = 32;
}

/** a controller with the probe fields zeroed (the original's zero-filled block) */
export function newProbeCtrl(): ProbeCtrl {
  return { flags: 2, near: 0, d18: 0, d1c: 0, off: [0, 0, 0], start: [0, 0, 0], delta: [0, 0, 0], skin: 0, radius: 0, mask: 0, extra: [0, 0, 0], pflags: 0, timer: 0, result: 0 };
}

/** FUN_00427233(records, count) with `DAT_009da868 != 0` (set by the first FUN_00427014) */
export interface ProbeScratch { pos: [number, number, number]; nrm: [number, number, number] }
/**
 * `scratch` = the locals' storage: the original's stack slots keep their value between calls (whatever the frames above left there); pass one object to model that, omitted = zeros each call.
 */
export function probePass(recs: readonly ProbeRecord[], env: ProbeEnv, scratch: ProbeScratch = { pos: [0, 0, 0], nrm: [0, 0, 0] }) {
  // local_20 / local_1c / local_18 (the position) and local_14 / local_10 / local_c (the normal) are locals of the whole pass: a record that stores a normal it never swept for gets the last one an earlier record swept
  let pos = scratch.pos, nrm = scratch.nrm;
  for (const rec of recs) {
    const c = rec.ctrl;
    if (!c) continue;
    if ((c.flags & 2) === 0) { c.result = 0; continue; }
    if (c.mask === 0) { c.result = 0; continue; }
    const off = c.off;
    if ((c.pflags & 0x2000) !== 0 && (c.near & 0x10) === 0) { c.mask = 0; c.result = PROBE_DEAD; continue; }
    if ((c.pflags & 0x4000) !== 0 && (rec.flags & 1) === 0) { c.mask = 0; c.result = PROBE_DEAD; continue; }
    let mode = c.pflags & 0xe00;
    if ((c.pflags & 0x8000) !== 0 && c.d1c < c.d18) mode = 0x400;
    if ((mode & 0x400) === 0) {
      if ((mode & 0x200) !== 0) {
        c.timer = fr(fr(env.dt) + c.timer);
        if (c.timer < 4) { c.mask = 0; c.result = PROBE_DEAD; continue; }
        c.timer = 0;
      }
    } else {
      c.timer = fr(fr(env.dt) + c.timer);
      if (c.timer < 8) { c.mask = 0; c.result = PROBE_DEAD; continue; }
      c.timer = 0;
    }
    if ((c.pflags & 1) !== 0) { off[0] = fr(rec.x + off[0]); off[1] = fr(rec.y + off[1]); off[2] = fr(rec.z + off[2]); }
    let ok = false;
    if ((c.pflags & 0x10) !== 0) {
      c.start[0] = off[0]; c.start[1] = off[1]; c.start[2] = off[2];
      const h = env.ground(off);
      if (h > NO_GROUND) {
        ok = c.delta[1] < fr(h - off[1]);
        if (ok) { c.start[1] = h; c.delta[1] = fr(h - off[1]); }
        pos = [c.start[0], c.start[1], c.start[2]];
      }
    }
    if ((c.pflags & 0x20) !== 0) {
      c.start[0] = off[0]; c.start[1] = off[1]; c.start[2] = off[2];
      const h = env.ground2(off, c.mask);
      if (h > NO_GROUND) {
        if (c.delta[1] < fr(h - off[1])) { c.start[1] = h; c.delta[1] = fr(h - off[1]); ok = true; }
        pos = [c.start[0], c.start[1], c.start[2]];
      }
      c.mask = 3;
    }
    if ((c.pflags & 0x40) === 0) {
      const probe = (c.pflags & 0x30) !== 0;
      const hit = env.sweep(rec, off, c.delta, c.mask, c.radius, c.skin, probe);
      c.result = hit ? hit.rec : 0;
      if (hit) {
        const hr = hit.rec as ProbeRecord;
        // the sweep wrote its contact normal and point into the pass's locals; the NPC rule then puts the ground sample's point back
        nrm = [hit.normal[0], hit.normal[1], hit.normal[2]]; pos = [hit.point[0], hit.point[1], hit.point[2]];
        if ((c.pflags & 0x1000) === 0 || (hr.flags & 0x40) === 0 || !ok) ok = true;
        else { c.result = 0; pos = [c.start[0], c.start[1], c.start[2]]; }
      }
    }
    c.mask = 0;
    if (ok) {
      if (c.result === 0) c.result = 1;
      if ((c.pflags & 4) !== 0) { pos = [fr(pos[0] + c.extra[0]), fr(pos[1] + c.extra[1]), fr(pos[2] + c.extra[2])]; }
      if ((c.pflags & 8) !== 0) { c.delta = [nrm[0], nrm[1], nrm[2]]; c.start = [pos[0], pos[1], pos[2]]; }
      if ((c.pflags & 2) !== 0) {
        if ((c.pflags & 0x1000) === 0) { rec.y = pos[1]; rec.x = pos[0]; rec.z = pos[2]; } else rec.y = pos[1];
      }
    }
  }
  scratch.pos = pos; scratch.nrm = nrm;
}
