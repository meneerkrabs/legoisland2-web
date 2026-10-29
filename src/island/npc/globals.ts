// State the original's NPC code (Common\SGGen SGMFIG.c / Human1.c / Turn2Pep.c / MeetPepp.c) keeps in globals, kept per world (`npcGlobals(w)`), and the
// small engine helpers these nodes share: the controller probe (FUN_00427014 / FUN_00427000 / FUN_00427233), the "where is Pepper" test FUN_004242f0,
// the actor-relative camera FUN_00422f21, the var operations FUN_004238f9 / FUN_0051dc50, and the NPC groups (FUN_0042407f / FUN_004240d1).
// The "point the way" target (FUN_00424e37) is the story's objective (WP8: `IslandCtx.objective`). docs/re/m4/wp3-npc.md.
import type { Controller } from '../../game/controller.ts';
import { CF_ENABLED } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import type { World } from '../../game/world.ts';
import { tryCtx } from '../ctx.ts';
import { npcAction } from '../pizza/delivery.ts';

export const PI = 3.1415927, TWO_PI = 6.2831855;     // _DAT_0089207c / _DAT_00892094 (-PI: _DAT_00892098)
export const wrapPi = (a: number) => (a < -PI ? a + TWO_PI : a > PI ? a - TWO_PI : a);

/** the island's NPC globals (addresses of the original) */
export class NpcGlobals {
  /** _DAT_009da640: the squared distance of the best talk candidate this frame (1e38 at set-up, 256 after every frame: the draw hook FUN_004260d6) */
  best = 1e38;
  /** DAT_009da6d0: the NPC record Shift talks to */
  target: GameRecord | null = null;
  /** DAT_009da844: a conversation / dialog holds the talk lock (the swim code also sets it) */
  lock = 0;
  /** _DAT_009da848: timer of the random face of the speaking NPC; DAT_009da7d0: the face set after a conversation (FUN_0042401c) */
  exprTimer = 0; expr = 0;
  /** DAT_009da7e0..: up to 6 groups of 3 records (FUN_0042407f): a group member's conversation end changes the head-node vars of the others (FUN_004240d1) */
  groups: (GameRecord | null)[][] = [];
}

const KEY = 'npc';
export function npcGlobals(w: World): NpcGlobals {
  let g = w.ext.get(KEY) as NpcGlobals | undefined;
  if (!g) { g = new NpcGlobals(); w.ext.set(KEY, g); }
  return g;
}

/** FUN_0042407f(a, b, c) */
export function npcGroup(w: World, a: GameRecord | null, b: GameRecord | null, c: GameRecord | null) {
  const g = npcGlobals(w);
  if (g.groups.length < 6) g.groups.push([a, b, c]);
}

// ------------------------------------------------------------------------------------------------ variable operations

/** FUN_004238f9(ctrl, value, op): op 0 or, 1 and, 2 and-not, 3 set on the variable of the controller's head node (not for vars < 3) */
export function headNodeVarOp(w: World, ctrl: Controller | null, value: number, op: number): boolean {
  const n = ctrl?.nodes[0];
  if (!n || n.var < 3) return false;
  switch (op) {
    case 0: w.vars.or(n.var, value); break;
    case 1: w.vars.set(n.var, w.vars.get(n.var) & value); break;
    case 2: w.vars.andNot(n.var, value); break;
    case 3: w.vars.set(n.var, value); break;
  }
  return true;
}

/** FUN_004240d1(rec, value, op): the other members of rec's group get `headNodeVarOp` */
export function groupVarOp(w: World, rec: GameRecord, value: number, op: number) {
  for (const grp of npcGlobals(w).groups) {
    if (!grp.includes(rec)) continue;
    for (const o of grp) if (o && o !== rec) headNodeVarOp(w, o.ctrl, value, op);
    return;
  }
}

/** FUN_0051dc50(rec, op, var, value): the var operation of a waypoint / animation count (Human1, Turn2Pep, MeetPepp); WP5's port with the group op */
export function actionVarOp(w: World, rec: GameRecord, op: number, v: number, value: number) {
  npcAction(w, op & 0xffff, v, value, (val, mode) => groupVarOp(w, rec, val, mode));
}

/** FUN_0041761b: or, returning the new value */
export function orVar(w: World, v: number, bits: number): number { w.vars.or(v, bits); return w.vars.get(v); }

// ------------------------------------------------------------------------------------------------ the record in view

/** record flag 1 (in the view frustum, FUN_00444370): the zone game may provide the test (`IslandCtx.inFrustum`); without it every record counts as in view */
export function inView(w: World, rec: GameRecord): boolean {
  if (rec.flags & 1) return true;
  const f = tryCtx(w)?.inFrustum;
  return f ? f(rec) : true;
}

// ------------------------------------------------------------------------------------------------ FUN_004242f0: where is Pepper

/** controller +0x14 bits written by FUN_004242f0 (2 in front, 4 behind, 8 beside) and FUN_00427000 (0x10: the probe may run) */
export interface CtrlExtra { f14: number; probe: Probe | null; probeFrame: number }
const extras = new WeakMap<Controller, CtrlExtra>();
export function ctrlExtra(c: Controller): CtrlExtra {
  let e = extras.get(c);
  if (!e) { e = { f14: 0, probe: null, probeFrame: -1 }; extras.set(c, e); }
  return e;
}

/**
 * FUN_004242f0(rec, &dist, r2, cone): dist = the controller's squared XZ distance to Pepper; within r2: 2 when Pepper stands within `cone` of the record's
 * heading, 8 beside (cone .. 2 cone), 4 behind; 0 out of range.
 */
export function pepperSide(w: World, rec: GameRecord, ctrl: Controller, r2: number, cone: number): { code: number; dist: number } {
  const e = ctrlExtra(ctrl);
  const dist = ctrl.distSq;
  e.f14 &= ~0xe;
  if (!(dist < r2) || !w.focus) return { code: 0, dist };
  const p = w.focus;
  const a = wrapPi(Math.atan2(p.x * 0.125 - rec.x * 0.125, p.z * 0.125 - rec.z * 0.125));
  rec.ry = wrapPi(rec.ry);
  let d = Math.abs(wrapPi(a - rec.ry));
  if (PI < d) d = TWO_PI - d;
  let code: number;
  if (d < cone) code = 2;
  else if (cone <= d - cone) code = 4;
  else code = 8;
  e.f14 |= code;
  return { code, dist };
}

// ------------------------------------------------------------------------------------------------ the controller probe (FUN_00427014 / FUN_00427233)

/** the probe request of a controller (+0x20..+0x64) */
export interface Probe {
  /** +0x20: start (offset from the record with flag 1) */ from: [number, number, number];
  /** +0x38: segment */ delta: [number, number, number];
  /** +0x4c */ mask: number;
  /** +0x5c */ flags: number;
}
/** +0x60 timer (init -1), +0x64 result: 0 nothing hit (falling), 1 / a record hit, BABA skipped this tick */
export const PROBE_SKIPPED = 0xbabababa;
interface ProbeRun { timer: number; result: number | GameRecord }
const probeRuns = new WeakMap<Controller, ProbeRun>();
export function probeResult(c: Controller): number | GameRecord { return probeRuns.get(c)?.result ?? 0; }

/** FUN_00427014(ctrl, from, delta, mask, flags): request the probe for this tick (flags | 0x1003) */
export function probeSet(c: Controller, from: readonly number[], delta: readonly number[], mask: number, flags: number) {
  ctrlExtra(c).probe = { from: [from[0], from[1], from[2]], delta: [delta[0], delta[1], delta[2]], mask, flags: flags | 0x1003 };
}

/**
 * FUN_00427233 for one record (the original runs it for every record after the update pass; here the NPC nodes call it from their pre-render hook,
 * once per tick). Flags: 1 start relative to the record, 2 write the result back (0x1000: y only), 4 / 8 offset / keep normal (not used by the NPCs),
 * 0x10 terrain height first, 0x40 skip the sweep, 0x1000 an NPC hit loses against the terrain, 0x2000 only after FUN_00427000, 0x8000 + distance
 * > c+0x1c (512): only every 8th tick.
 */
export function runProbe(w: World, rec: GameRecord, c: Controller) {
  const e = ctrlExtra(c);
  if (e.probeFrame === w.frame) return;
  e.probeFrame = w.frame;
  let run = probeRuns.get(c);
  if (!run) { run = { timer: -1, result: 0 }; probeRuns.set(c, run); }
  const p = e.probe;
  if (!(c.flags & CF_ENABLED)) { run.result = 0; return; }
  if (!p) { run.result = 0; return; }
  e.probe = null;                              // +0x4c = 0 after the run
  if ((p.flags & 0x2000) && !(e.f14 & 0x10)) { run.result = PROBE_SKIPPED; return; }
  let t = p.flags & 0xe00;
  if ((p.flags & 0x8000) && 512 < c.distSq) t = 0x400;
  if (t & 0x400) {
    run.timer += w.dt;
    if (run.timer < 8) { run.result = PROBE_SKIPPED; return; }
    run.timer = 0;
  } else if (t & 0x200) {
    run.timer += w.dt;
    if (run.timer < 4) { run.result = PROBE_SKIPPED; return; }
    run.timer = 0;
  }
  const from = p.from.slice() as [number, number, number];
  if (p.flags & 1) { from[0] += rec.x; from[1] += rec.y; from[2] += rec.z; }
  const delta = p.delta;
  let ok = false;
  let out: [number, number, number] = [from[0], from[1], from[2]];
  let result: number | GameRecord = 0;
  if (p.flags & 0x10) {
    const h = w.col.terrainHeight(from[0], from[1], from[2], 4);
    if (-1e38 < h) {
      ok = delta[1] < h - from[1];
      if (ok) { out[1] = h; delta[1] = h - from[1]; }
    }
  }
  if (!(p.flags & 0x40)) {
    const hit = (p.flags & 0x30) === 0 ? w.col.sweep(rec, from, delta, p.mask, 0.1, 0) : w.col.probe(rec, from, delta, p.mask);
    if (hit) {
      if ((p.flags & 0x1000) && (hit.rec.flags & 0x40) && ok) { /* an NPC below loses against the terrain */ }
      else { ok = true; result = hit.rec; out = [hit.point[0], hit.point[1], hit.point[2]]; }
    }
  }
  if (ok) {
    if (result === 0) result = 1;
    if (p.flags & 2) {
      if (p.flags & 0x1000) rec.y = out[1];
      else { rec.x = out[0]; rec.y = out[1]; rec.z = out[2]; }
    }
  }
  run.result = result;
}

// ------------------------------------------------------------------------------------------------ FUN_00422f21: the camera beside an actor

/** DAT_008adc6c: the sides tried when the first one is blocked (bytes up to the terminator 6) */
const SIDES = [1, 5, 2, 3, 4];

/** FUN_00422e36(side, out, v) */
function sideOffset(side: number, v: readonly number[]): [number, number, number] {
  switch (side) {
    case 0: return [0, 0, -1.75];
    case 2: return [v[0], v[1], v[2]];
    case 3: return [-v[2], v[1], v[0]];
    case 4: return [v[2], v[1], v[0]];
    case 5: return [v[0], v[1], -v[2]];
    default: return [-v[0], v[1], -v[2]];
  }
}

/**
 * FUN_00422f21(rec, yaw, side, height, v): look at the record (+ height) from the offset `side` of `v` turned by `yaw`; when a sweep from the target to
 * the eye (mask 3, radius 2.4) hits, the other sides are tried (DAT_008adc6c), the first side is used when all are blocked. Side flag 0x1000 skips the
 * test from story node 8 on. Writes the chase camera's eye / target (DAT_009da5e8 / DAT_009da5f4).
 */
export function actorCamera(w: World, rec: GameRecord, yaw: number, side: number, height: number, v: readonly number[]) {
  const c = w.camera.c;
  c[3] = rec.x; c[5] = rec.z; c[4] = rec.y + height;
  const m = buildMatrix(0, yaw, 0, 0, 0, 0);
  const rot = (o: readonly number[]) => [o[0] * m[0] + o[1] * m[4] + o[2] * m[8], o[0] * m[1] + o[1] * m[5] + o[2] * m[9], o[0] * m[2] + o[1] * m[6] + o[2] * m[10]];
  const put = (d: number[]) => { c[0] = c[3] + d[0]; c[1] = c[4] + d[1]; c[2] = c[5] + d[2]; };
  let d = rot(sideOffset(side & 0xff, v));
  if ((side & 0x1000) !== 0 && w.vars.get(0x58) >= 8) { put(d); return; }
  const from = [c[3], c[4], c[5]];
  if (!w.col.sweep(rec, from, d, 3, 2.4, 0)) { put(d); return; }
  for (const s of SIDES) {
    if (s === (side & 0xff)) continue;
    const ds = rot(sideOffset(s, v));
    if (!w.col.sweep(rec, from, ds, 3, 2.4, 0)) { put(ds); return; }
  }
  d = rot(sideOffset(side & 0xff, v));
  put(d);
}
