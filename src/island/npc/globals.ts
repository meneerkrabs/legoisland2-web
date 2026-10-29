// State the original's NPC code (Common\SGGen SGMFIG.c / Human1.c / Turn2Pep.c / MeetPepp.c) keeps in globals, kept per world (`npcGlobals(w)`), and the
// small engine helpers these nodes share: the controller probe (FUN_00427014 / FUN_00427000 / FUN_00427233), the "where is Pepper" test FUN_004242f0,
// the actor-relative camera FUN_00422f21, the var operations FUN_004238f9 / FUN_0051dc50, and the NPC groups (FUN_0042407f / FUN_004240d1).
// The "point the way" target (FUN_00424e37) is the story's objective (WP8: `IslandCtx.objective`). docs/re/m4/wp3-npc.md.
import type { Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { armControllerProbe } from '../../game/probehost.ts';
import type { ProbeCtrl } from '../../game/probe.ts';
import { newProbeCtrl } from '../../game/probe.ts';
import { eulerMatrix, rotateVector } from '../../zones/common/matrix.ts';
import { ad, sb, ml, fr } from '../../zones/common/f32.ts';
import { tryCtx } from '../ctx.ts';
import { finishEmitters } from '../emitters.ts';
import { npcAction } from '../pizza/delivery.ts';

/** _DAT_0089207c / _DAT_00892094 / _DAT_00892098: float32 pi, 2 pi, -pi (0x40490fdb, 0x40c90fdb, 0xc0490fdb) */
export const PI = fr(Math.PI), TWO_PI = fr(2 * Math.PI), NEG_PI = -PI;
/** the wrap of the original: `if (-pi <= a) { if (pi < a) a -= 2 pi } else a += 2 pi` (float32 constants and operations) */
export const wrapPi = (a: number) => (NEG_PI <= a ? (PI < a ? sb(a, TWO_PI) : a) : ad(a, TWO_PI));

/** the island's NPC globals (addresses of the original) */
export class NpcGlobals {
  /** _DAT_009da640: the squared distance of the best talk candidate this frame (1e38 at set-up, 256 after every frame: the draw hook FUN_004260d6) */
  best = fr(1e38);
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

// ------------------------------------------------------------------------------------------------ the controller's probe block (FUN_00427014 / FUN_00427233)

/**
 * The probe block of a controller made by FUN_0042382c: +0x1c = 512.0 (the 0x8000 gate), +0x60 timer = -1.0 (FUN_00427014 makes it 32.0 on the first request: the first throttled probe
 * of a far NPC runs at once, then every 8th tick = finding D2). The pass itself is the shared, oracle-verified `probePass` (src/game/probe.ts, run by `World.tick`).
 */
export function probeBlock(c: Controller): ProbeCtrl {
  if (!c.probe) { const p = newProbeCtrl(); p.timer = -1; p.d1c = 512; c.probe = p; }
  return c.probe;
}

/** controller +0x14 bits written by FUN_004242f0 (2 in front, 4 behind, 8 beside) and FUN_00427000 (0x10: the probe may run); the draw pass zeroes the word every frame (`clearNear`, finding D3) */
export interface CtrlExtra { f14: number }
export function ctrlExtra(c: Controller): CtrlExtra {
  const p = probeBlock(c);
  return { get f14() { return p.near; }, set f14(v: number) { p.near = v >>> 0; } };
}
/** FUN_0042271b: controller +0x14 = 0 after the draw of every record */
export function clearNear(w: World) { for (const rec of w.records) if (rec.ctrl?.probe) rec.ctrl.probe.near = 0; }

/**
 * FUN_004242f0(rec, &dist, r2, cone): dist = the controller's squared XZ distance to Pepper; within r2: 2 when Pepper stands within `cone` of the record's
 * heading, 8 beside (cone .. 2 cone), 4 behind; 0 out of range. Every operation float32 (24-bit x87), atan2 / fabs of the CRT.
 */
export function pepperSide(w: World, rec: GameRecord, ctrl: Controller, r2: number, cone: number): { code: number; dist: number } {
  const p0 = probeBlock(ctrl);
  const dist = ctrl.distSq;
  p0.near = (p0.near & ~0xe) >>> 0;
  if (!(dist < r2) || !w.focus) return { code: 0, dist };
  const p = w.focus;
  const K = 0.125;
  let a = fr(Math.atan2(sb(ml(p.x, K), ml(rec.x, K)), sb(ml(p.z, K), ml(rec.z, K))));
  a = wrapPi(a);
  rec.ry = wrapPi(rec.ry);
  let d = wrapPi(sb(a, rec.ry));
  d = fr(Math.abs(d));
  if (PI < d) d = sb(TWO_PI, d);
  let code: number;
  if (cone <= d) code = cone <= sb(d, cone) ? 4 : 8;
  else code = 2;
  p0.near |= code;
  return { code, dist };
}

/** the result of the last probe (+0x64): 0 nothing hit (falling), 1 / a record hit, BABA skipped this tick */
export const PROBE_SKIPPED = 0xbabababa;
export function probeResult(c: Controller): number | GameRecord { return (c.probe?.result as number | GameRecord | undefined) ?? 0; }

/** FUN_00427014(ctrl, from, delta, mask, flags): request the probe for this tick (flags | 0x1003) */
export function probeSet(c: Controller, from: readonly number[], delta: readonly number[], mask: number, flags: number) {
  probeBlock(c);
  armControllerProbe(c, from, delta, mask, flags);
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
 * test from story node 8 on. Writes the chase camera's eye / target (DAT_009da5e8 / DAT_009da5f4). Float32 per operation.
 */
export function actorCamera(w: World, rec: GameRecord, yaw: number, side: number, height: number, v: readonly number[]) {
  const c = w.camera.c;
  c[3] = rec.x; c[5] = rec.z; c[4] = ad(rec.y, fr(height));
  const m = eulerMatrix(0, fr(yaw), 0);
  const rot = (o: readonly number[]) => rotateVector(m, o);
  const put = (d: number[]) => { c[0] = ad(c[3], d[0]); c[1] = ad(c[4], d[1]); c[2] = ad(c[5], d[2]); };
  const R = fr(2.4);
  let d = rot(sideOffset(side & 0xff, v));
  if ((side & 0x1000) !== 0 && w.vars.get(0x58) >= 8) { put(d); return; }
  const from = [c[3], c[4], c[5]];
  if (!w.col.sweep(rec, from, d, 3, R, 0)) { put(d); return; }
  for (const s of SIDES) {
    if (s === (side & 0xff)) continue;
    const ds = rot(sideOffset(s, v));
    if (!w.col.sweep(rec, from, ds, 3, R, 0)) { put(ds); return; }
  }
  d = rot(sideOffset(side & 0xff, v));
  put(d);
}

/** FUN_00427233 itself is the shared `runProbePass` (World.tick); this hook only runs the one-time emitter start of the first tick and installs nothing else. */
export function islandProbePass(w: World) {
  finishEmitters(w);   // the first tick's constructors have created their emitters: FUN_0044e8d0 (once)
}

/** creation order of the nodes with constructor work = the set-up's attach order (setupZone calls the factories in that order): `startIslandNpcs` runs the constructors' world work in it (finding D1) */
let creation = 0;
export const nextSeq = () => creation++;
