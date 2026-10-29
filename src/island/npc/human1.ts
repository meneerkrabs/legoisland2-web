// Human1: the walking routes of the island's minifigs (Common\Zones\z02LGI\Human1.c, 44 attaches per era). Ported from the decompile:
//   FUN_004bec00  constructor (vtable 0x8da330: update FUN_004be20f, pre-render FUN_004beaec (returns 1), destroy FUN_004bee73, draw FUN_004beb1b (returns 1))
//   FUN_004be20f  update: order the walker to the route's waypoints, stop for Pepper / a car in front, hop over a walker it was told to ignore,
//                 the waypoint actions (wait with a clip, a var operation), the walk clip                                     -> Human1Node.update
//   FUN_004bdea9  the next goal of the random routes (count <= 0: -1 any node, -2 / -3 table 0 / 1 of 0x8da300, -4 / -5 either)   -> pickGoal
//   FUN_004be0e2  arriving at a waypoint: wrap the index, flag 4 hides the record, 1 (2: when out of view) puts it on the node     -> arrive
//   FUN_004bdde2  the waypoint's action: 8 = play its clip and wait, else FUN_0051dc50 on the node's var                          -> action
//   FUN_004bdc90  a car (records 165..168, 172 with the 0x20000000 bit of their head var) 4 units ahead                          -> carAhead
// The walker is the controller's (created by the SGMFIG constructor on the same record, map PATH). The node returns 1 (stops the chain).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { waypoints, STATUS_ROUTE } from '../../game/walker.ts';
import type { StepOut } from '../../game/walker.ts';
import type { Pe } from '../../formats/exe.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ad, sb, ml, fr, fromBits } from '../../zones/common/f32.ts';
import { rand, randTrunc } from '../rng.ts';
import { ArgView } from '../args.ts';
import { tryCtx } from '../ctx.ts';
import { nextSeq, actionVarOp, ctrlExtra, inView, pepperSide, probeSet } from './globals.ts';

export const CTOR_HUMAN1 = 0x4bec00;

/** DAT_008da300: two tables of 6 PATH nodes for the random routes -2 / -3 / -4 / -5 (read from the EXE) */
export const RANDOM_NODES_VA = 0x8da300;
const RANDOM_NODES_DEFAULT = [[26, 31, 96, 99, 307, 345], [44, 46, 47, 113, 119, 282]];
/** default walk / idle clip (0x78) */
const CLIP_DEFAULT = 0x78;
/** the hop over a walker (clip 0x116, 10 degrees of the arc per tick up to 90, 6 units high: _DAT_0089211c / _DAT_00892554 / _DAT_0089228c) */
const CLIP_HOP = 0x116, HOP_STEP = fromBits(0x3e32b884), HOP_MAX = fromBits(0x3fc90f94), HOP_HEIGHT = 6;
/** stop for Pepper: in front (80 degrees, 0x3fb2b884) within 2.4 (0x4019999a, compared with the squared distance) */
const PEP_STOP_R2 = fromBits(0x4019999a), PEP_STOP_CONE = fromBits(0x3fb2b884);
/** the wait after a stop (0x41f00000) */
const STOP_WAIT = 30;
/** out of the island: back to PATH node 164 (|x| > 600, |y| > 300, |z| > 600) */
const LOST_XZ = 600, LOST_Y = 300, LOST_NODE = 0xa4;
/** _DAT_00892284: moving at all */
const MOVE_EPS = fromBits(0x38d1b717);
/** FUN_00427014(ctrl, (0, sin(hop) * 6, 0), (0, -16, 0), 0x41, 0x110): the ground probe while hopping */
const HOP_PROBE_MASK = 0x41, HOP_PROBE_FLAGS = 0x110;
/** the debug heap / stack fill 0xcccccccc read as a float (a local of the original that is not written on one path) */
const UNSET_F = -107374176.0;
/** the cars FUN_004b6475 lists at DAT_05d58648 (record offsets 0x43d8, 0x4370, 0x4648, 0x4440, 0x44a8) */
export const CAR_RECORDS = [166, 165, 172, 167, 168];

export interface Waypoint { node: number; wait: number; action: number; flag: number; clip: number }
export interface Human1Args {
  /** +0x50: count (signed: <= 0 a random route), +0x51: restart at the first waypoint when the node starts again */
  count: number; restart: number;
  /** waypoints: node +0x00 + 2i, wait / value +0x14 + 2i, action +0x3c + i, arrival flag +0x46 + i, clip +0x28 + 2i (0 -> 0x78) */
  points: Waypoint[];
  /** +0x52: walk clip, +0x54: idle clip (0 -> 0x78), +0x58: speed scale (> 0) */
  walkClip: number; idleClip: number; speedScale: number;
}
export function decodeHuman1(a: ArgView): Human1Args {
  const count = a.i8(0x50);
  const points: Waypoint[] = [];
  for (let i = 0; i < count; i++) {
    const clip = a.i16(0x28 + i * 2);
    points.push({ node: a.i16(i * 2), wait: a.i16(0x14 + i * 2), action: a.u8(0x3c + i), flag: a.u8(0x46 + i), clip: clip === 0 ? CLIP_DEFAULT : clip });
  }
  const idle = a.i16(0x54);
  return { count, restart: count < 1 ? 0 : a.u8(0x51), points, walkClip: a.i16(0x52), idleClip: idle === 0 ? CLIP_DEFAULT : idle, speedScale: a.f32(0x58) };
}

export function readRandomNodes(pe: Pe | undefined): number[][] {
  if (!pe) return RANDOM_NODES_DEFAULT;
  return [0, 1].map((t) => Array.from({ length: 6 }, (_, i) => pe.u32(RANDOM_NODES_VA + (t * 6 + i) * 4) | 0));
}

export class Human1Node implements BehaviourNode {
  readonly kind = 'Human1';
  /** attach order */ readonly seq = nextSeq();
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: Human1Args;
  readonly attach: Attach | null;
  inited = false;
  /** +0x1a: walk clip (-1 without an animation instance), +0x1c: idle clip */ walkClip = -1; idleClip = CLIP_DEFAULT;
  /** +0x20: speed */ speed = 0;
  /** +0x28: the node of the waypoint passed last (-1), +0x2a: the waypoint index, +0x2b: the waypoint whose action is due (-1) */ passed = -1; index = 0; due = -1;
  /** +0x2c: hop angle, +0x30: hopping, +0x31: walk-clip restart countdown, +0x33: stopped */ hop = 0; hopping = 0; restartClip = 0; stopped = 0;
  /** +0x34: wait */ wait = 0;
  private random: number[][] = RANDOM_NODES_DEFAULT;
  private out: StepOut = { yaw: 0, dist: 0 };

  constructor(args: Human1Args, attach: Attach | null = null) { this.args = args; this.attach = attach; }

  /** FUN_004bec00 (needs the controller's walker, made by the SGMFIG constructor at position 0) */
  init(w: World, rec: GameRecord, ctrl: Controller) {
    if (this.inited) return;
    this.inited = true;
    this.random = readRandomNodes(tryCtx(w)?.pe);
    this.wait = 0; this.hop = 0; this.hopping = 0; this.restartClip = 0; this.stopped = 0;
    this.index = 0; this.passed = -1; this.due = -1;
    this.idleClip = this.args.idleClip;
    this.walkClip = rec.anim ? this.args.walkClip : -1;
    this.speed = waypoints.get(ctrl.walker)?.speed ?? 0;
    if (0 < this.args.speedScale) this.speed = fr(this.speed * this.args.speedScale);
  }

  private get count() { return this.args.count; }
  private entry(i: number): Waypoint { return this.args.points[i] ?? { node: 0, wait: 0, action: 0, flag: 0, clip: CLIP_DEFAULT }; }

  // ----------------------------------------------------------------------------------------------- FUN_004be20f
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.inited) this.init(w, rec, ctrl);
    const h = ctrl.walker;
    const ranLast = this.stamp === w.frame;
    if (this.wait <= 0) {
      if (LOST_XZ < Math.abs(rec.x) || LOST_Y < Math.abs(rec.y) || LOST_XZ < Math.abs(rec.z)) waypoints.setNode(h, LOST_NODE, rec);
      const notRoute = waypoints.status(h) !== STATUS_ROUTE;
      let goal = waypoints.goalOf(h);
      if (!ranLast && this.args.restart) this.index = 0;
      if (!ranLast || (0 < this.count && goal !== this.entry(this.index).node) || notRoute) {
        if (this.count < 1) { if (this.count === -5) goal = this.pickGoal(h, 0); }
        else { this.arrive(w, rec, ctrl); goal = this.entry(this.index).node; }
        waypoints.goTo(h, goal, 0);
        waypoints.setSpeed(h, this.speed);
        waypoints.resume(h);
      }
      const pos = [rec.x, rec.y, rec.z];
      let yaw = rec.ry;
      let code = rec.anim ? pepperSide(w, rec, ctrl, PEP_STOP_R2, PEP_STOP_CONE).code : 0;
      if (code !== 2 && this.carAhead(w, rec)) code = 2;
      let res: number;
      let playIdle = false;
      this.out.dist = 0;
      if (code === 2) {
        // Pepper (or a car) in the way: stand and wait
        res = waypoints.toOf(h);
        waypoints.pause(h);
        this.stopped = 1;
        if (rec.anim && 0 < this.idleClip) playIdle = true;
        this.wait = STOP_WAIT;
      } else {
        if (this.stopped) { waypoints.resume(h); this.stopped = 0; }
        res = waypoints.step(h, pos, yaw, this.out, w.dt);
        yaw = this.out.yaw;
        if (!waypoints.isYielding(h)) {
          if (waypoints.isBlocked(h)) {
            if (this.count < 0) { goal = this.pickGoal(h, 1); waypoints.goTo(h, goal, 0); }
            if (rec.anim && 0 < this.idleClip) { playIdle = true; this.wait = STOP_WAIT; }
          }
        } else this.hopping = 1;
      }
      // the hop over the walker ahead (clip 0x116, up and down along sin)
      if (this.hopping === 0) {
        if (0 < this.hop) {
          this.hop = sb(this.hop, ml(HOP_STEP, fr(w.dt)));
          if (this.hop < 0) { this.hop = 0; if (this.walkClip >= 0) rec.anim?.start(this.walkClip, 0); }
          // the original passes `&local_48`, a local of FUN_004be20f that only the rising branch below assigns: here it still holds the debug stack fill 0xcccccccc (float -1.0737418e8)
          probeSet(ctrl, [0, fr(Math.sin(this.hop) * HOP_HEIGHT), 0], [UNSET_F, UNSET_F, UNSET_F], HOP_PROBE_MASK, HOP_PROBE_FLAGS);
        }
      } else {
        if (HOP_MAX <= this.hop) this.hopping = 0;
        else {
          if (rec.anim && rec.anim.clip !== CLIP_HOP) rec.anim.start(CLIP_HOP, 0);
          this.hop = ad(ml(HOP_STEP, fr(w.dt)), this.hop);
          if (HOP_MAX <= this.hop) { this.hop = HOP_MAX; this.hopping = 0; }
        }
        probeSet(ctrl, [0, fr(Math.sin(this.hop) * HOP_HEIGHT), 0], [0, -16, 0], HOP_PROBE_MASK, HOP_PROBE_FLAGS);
      }
      if (res === -1 && this.count === 1) {
        this.due = this.index;
        this.action(w, rec);
        return NODE_NONE;   // M5 (z07CSI worker): asm 0x4be7f8 `xor eax, eax; jmp 0x4beadd` = this path returns 0 (not "ran": the chain goes on to the next nodes); every other path returns 1
      } else {
        ctrlExtra(ctrl).f14 |= 0x10;               // FUN_00427000: the ground probe of the SGMFIG node may run
        if (playIdle) rec.anim?.start(this.idleClip, 0);
        if (this.passed !== res && this.passed >= 0) {
          if (this.due >= 0) this.action(w, rec);
          this.passed = -1; this.due = -1;
        }
        if (res === goal || res === -1) {
          if (this.count < 1) waypoints.goTo(h, this.pickGoal(h, 0), 1);
          else if (this.count !== 1) {
            this.due = this.index; this.passed = goal;
            this.index++;
            if (this.arrive(w, rec, ctrl)) { pos[0] = rec.x; pos[1] = rec.y; pos[2] = rec.z; }
            waypoints.goTo(h, this.entry(this.index).node, 1);
          }
        }
        rec.ry = yaw;
        rec.setEuler(rec.rx, rec.ry, rec.rz, pos[0], pos[1], pos[2]);
        if (ranLast) {
          if (this.restartClip === 1) { if (this.walkClip >= 0) rec.anim?.start(this.walkClip, 0); this.restartClip = 0; }
          else if (this.walkClip >= 0 && rec.anim && MOVE_EPS < this.out.dist && this.wait <= 0 && rec.anim.advance(1, w.dt) !== 0) {
            if (this.hop <= 0) rec.anim.start(this.walkClip, rec.anim.frame);
            else rec.anim.start(CLIP_HOP, 0);
          }
          if (this.restartClip) this.restartClip--;
        } else if (this.walkClip >= 0 && rec.anim && rec.anim.clip !== this.walkClip) this.restartClip = 2;
      }
    } else {
      this.wait = sb(this.wait, ml(1, fr(w.dt)));
      if (rec.anim) { rec.anim.advance(1, w.dt); if (this.wait <= 0) this.restartClip = 2; }
    }
    return NODE_STOP;
  }

  /** FUN_004bdea9(count, walker, blocked): the next goal of a random route */
  private pickGoal(h: number, blocked: number): number {
    const code = this.count;
    const wk = waypoints.get(h);
    if (!wk) return 0;
    if (code === -5 || blocked) {
      // turn round: a table node whose route from the node ahead leads back over the node passed last
      let t = code === -3 ? 1 : 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < 6; i++) {
          const e = this.random[t][i];
          const r = waypoints.route(wk.map, wk.to, e);
          if (r === wk.from && r !== wk.to) return e;
        }
        t = t === 0 ? 1 : 0;
      }
    }
    const rnd = (x: number) => randTrunc(x);     // FUN_004388ae + __ftol
    if (code === -1) return rnd(waypoints.mapCount(wk.map));
    const i = rnd(6);
    if (code === -2) return this.random[0][i];
    if (code === -3) return this.random[1][i];
    if (code === -4 || code === -5) return rand(10) < 5 ? this.random[0][i] : this.random[1][i];
    return rnd(waypoints.mapCount(wk.map));
  }

  /** FUN_004be0e2: true when the record was put on the node */
  private arrive(w: World, rec: GameRecord, ctrl: Controller): boolean {
    if (this.count <= this.index) this.index = 0;
    const e = this.entry(this.index);
    if (e.flag === 4) { rec.flags &= ~RF_ENABLED; return false; }
    if (e.flag !== 0 && (e.flag === 1 || (e.flag === 2 && !inView(w, rec)))) {
      rec.rz = 0; rec.rx = 0;
      waypoints.setNode(ctrl.walker, e.node, rec);
      this.due = this.index;
      this.passed = e.node;
      return true;
    }
    return false;
  }

  /** FUN_004bdde2: the action of waypoint `due` */
  private action(w: World, rec: GameRecord) {
    if (this.count < 1) return;
    const e = this.entry(this.due);
    if (e.action === 8) {
      rec.anim?.start(e.clip, 0);
      this.wait = e.wait;
    } else actionVarOp(w, rec, e.action, this.var, e.wait);
  }

  /** FUN_004bdc90: a driving car (its head node's var has 0x20000000) within the ray (x, y + 2, z) + forward * 4 */
  private carAhead(w: World, rec: GameRecord): boolean {
    const from = [rec.x, ad(rec.y, 2), rec.z], d = [ml(rec.fx, 4), ml(rec.fy, 4), ml(rec.fz, 4)];
    for (const i of CAR_RECORDS) {
      const car = w.records[i];
      if (!car || car === rec || !car.ctrl) continue;
      const head = car.ctrl.nodes[0];
      if (!head || (w.vars.get(head.var) & 0x20000000) === 0) continue;
      if (w.col.rayRecord(car, from, d, 3, 1, 1)) return true;
    }
    return false;
  }
}
