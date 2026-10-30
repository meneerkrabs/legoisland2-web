// Turn2Pep.c / MeetPepp.c (Common\Zones\z02LGI): the companion nodes of the talking minifigs. Ported from the decompile:
//   FUN_0052ff39  Turn2Pep "A" constructor (vtable 0x8ea948: update FUN_0052fa90, pre-render / draw return 1, destroy FUN_0053001b)
//   FUN_0052fa90  turn to face a record (Pepper) while the state word has 0x100, wave (0x200), play a clip first (0x800); turn back afterwards
//   FUN_005306e5  Turn2Pep "B" constructor (vtable 0x8ea960: update FUN_0053004b, draw = default)
//   FUN_0053004b  face a record / a waypoint (or turn back to the old heading), loop a clip N times then a var operation (FUN_0051dc50), the
//                 synchronised clip of a pair (mode -4), the end toggles the node's own gate bit
//   FUN_00530d69  MeetPepp constructor (vtable 0x8eaa38: update FUN_005309c0, draw = default)
//   FUN_005309c0  play a clip N times while facing a waypoint, then a var operation, then toggle the node's own gate bit
// All three return 1 (Turn2Pep A returns 0 while one of its timers runs: the next node, e.g. Human1, walks on). Bit 0x8000 of the state word: the
// NPC takes the pizza box (FUN_004296a2 on DAT_009da7d4 = WP5's `releaseCarry(carriedPizza(w), npc, ticks)`).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { waypoints } from '../../game/walker.ts';
import type { StepOut } from '../../game/walker.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ad, sb, fr } from '../../zones/common/f32.ts';
import { ArgView } from '../args.ts';
import { BlockIn, BlockOut } from '../blockio.ts';
import { CD_F, CD_I16, CD_I32 } from './cd.ts';
import { carriedPizza, releaseCarry } from '../pizza/carry.ts';
import { actionVarOp } from './globals.ts';

export const CTOR_TURN2PEP_A = 0x52ff39, CTOR_TURN2PEP_B = 0x5306e5, CTOR_MEETPEPP = 0x530d69;

/** Turn2Pep A: a clip frame of 20 before the turn (_DAT_0089237c), the wave pause 180 (0x43340000) */
const T2A_CLIP_FRAME = 20, T2A_WAVE_PAUSE = 180;
/** Turn2Pep B: after 30 ticks (_DAT_00892038) of the idle clip the third clip plays */
const T2B_IDLE_TIME = 30;
/** the lying time of the pizza box the NPC drops (0x43f00000) */
const BOX_TICKS = 480;
/** walker step results */
const STEP_FACING = -3;

const setRot = (rec: GameRecord) => rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z);
/** FUN_00462c18(map, node): the position of a waypoint (the node's first 12 bytes) */
const nodePos = (map: number, node: number) => waypoints.nodePos(map, node);

// =================================================================================================== Turn2Pep A

export interface Turn2PepAArgs { wave: number; idle: number; first: number; target: number }
export function decodeTurn2PepA(a: ArgView): Turn2PepAArgs {
  return { wave: a.i16(0), idle: a.i16(4), first: a.i16(8), target: a.recIndex(0x10) };
}

export class Turn2PepANode implements BehaviourNode {
  readonly kind = 'Turn2PepA';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: Turn2PepAArgs;
  readonly attach: Attach | null;
  /** +0x1a: the timers count (not in sub-game 6) */ timers = -1;
  /** +0x24: heading before the turn, +0x28: turn back, +0x2a: wave pending */ heading = CD_F; back = CD_I16; waved = CD_I16;
  /** +0x2c: wave pause, +0x30: start delay */ pause = 0; delay = 0;
  private out: StepOut = { yaw: 0, dist: 0 };
  // save block: FUN_0052fedb (vtable +0x14) / FUN_0052ff00 (+0x10, memcpy): the 0x10 bytes at node +0x24: +0x00 f32 heading, +0x04 i16 back, +0x06 i16 waved, +0x08 f32 pause, +0x0c f32 delay
  saveBlock(_w: World, _rec: GameRecord, _ctrl: Controller): Uint8Array { return new BlockOut(0x10).f32(0, this.heading).i16(4, this.back).i16(6, this.waved).f32(8, this.pause).f32(0xc, this.delay).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { const b = new BlockIn(data); this.heading = b.f32(0); this.back = b.i16(4); this.waved = b.i16(6); this.pause = b.f32(8); this.delay = b.f32(0xc); }
  constructor(args: Turn2PepAArgs, attach: Attach | null = null) { this.args = args; this.attach = attach; }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (this.timers < 0) this.timers = w.vars.get(0x59) === 6 ? 0 : 1;
    let v = w.vars.get(this.var);
    const ranLast = this.stamp === w.frame;
    const h = ctrl.walker;
    if ((v & 0x200) === 0) this.waved = 0;
    else if (0 < this.pause && this.waved === 0 && this.timers) { this.pause = sb(this.pause, fr(w.dt)); return NODE_NONE; }
    if (!ranLast) {
      if (0 < this.delay && this.timers) { this.delay = sb(this.delay, fr(w.dt)); return NODE_NONE; }
      this.heading = rec.ry;
      if (h) waypoints.pause(h);
      this.back = 0; this.pause = 0;
    }
    let busy = false;
    if (v & 0x800) {
      if (T2A_CLIP_FRAME <= (rec.anim?.frame ?? 0)) v |= 0x400;
      else busy = true;
    }
    if (!busy && h) {
      let turnBack = false;
      if (((((v & 0x400) === 0 && (v & 0x100) !== 0)) || (this.waved !== 0 && (v & 0x200) !== 0)) && this.back !== 0) {
        waypoints.turnToHeading(h, this.heading);
        turnBack = true;
      } else {
        this.back = 0; this.waved = 0;
        waypoints.followRecord(h, w.records[this.args.target] ?? null);
      }
      const pos = [rec.x, rec.y, rec.z];
      const r = waypoints.step(h, pos, rec.ry, this.out, w.dt);
      rec.ry = this.out.yaw;
      if (turnBack && r === STEP_FACING) { rec.ry = this.heading; this.waved = 0; w.vars.andNot(this.var, 0xb00); }
      setRot(rec);
    }
    let clipTurn: boolean;
    if (ranLast) {
      const r = rec.anim?.advance(1, w.dt) ?? 0;
      if (r === 0) clipTurn = false;
      else {
        if ((v & 0x400) === 0 && (v & 0x100) !== 0) this.back = 1;
        rec.anim?.seek(0);
        clipTurn = true;
      }
    } else clipTurn = true;
    if (clipTurn && rec.anim) {
      const clip = rec.anim.clip;
      let want = clip, ok: boolean;
      if ((v & 0x800) === 0) ok = true;
      else if (clip !== this.args.first) { want = this.args.first; ok = false; }
      else { w.vars.andNot(this.var, 0x800); ok = true; }
      if (ok) {
        if ((v & 0x200) === 0 || this.back !== 0) want = this.args.idle;
        else if (clip === this.args.wave) { want = this.args.idle; this.pause = T2A_WAVE_PAUSE; this.waved = this.timers; this.back = this.timers; }
        else want = this.args.wave;
      }
      if (want !== clip) rec.anim.start(want, 0);
    }
    return NODE_STOP;
  }
}

// =================================================================================================== Turn2Pep B

export interface Turn2PepBArgs {
  /** +0x00 first clip (<= 0: none), +0x02 idle clip, +0x04 the clip after 30 ticks of idle, +0x06 mode: >= 0 the clip at the end, -1 turn back, -3 none, -4 in step with `target`'s clip */
  first: number; idle: number; extra: number; mode: number;
  /** +0x08: the record to face, +0x10: frame offset of mode -4 */ target: number; offset: number;
  /** +0x0c / +0x0e: the waypoint to face (node, map) when there is no record */ node: number; map: number;
  /** +0x14 / +0x16: value and op of the var operation after `count` loops (+0x1a), +0x18: the bits that hold the clip at its end */
  opValue: number; op: number; holdMask: number; count: number;
}
export function decodeTurn2PepB(a: ArgView): Turn2PepBArgs {
  return {
    first: a.i16(0), idle: a.i16(2), extra: a.i16(4), mode: a.i16(6), target: a.recIndex(8), offset: a.f32(0x10), node: a.i16(0xc), map: a.i16(0xe),
    opValue: a.i16(0x14), op: a.i16(0x16), holdMask: a.i16(0x18), count: a.i16(0x1a),
  };
}

export class Turn2PepBNode implements BehaviourNode {
  readonly kind = 'Turn2PepB';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: Turn2PepBArgs;
  readonly attach: Attach | null;
  /** +0x30: heading at the start, +0x34: idle time, +0x38: turning back, +0x3a: loops left */ heading = CD_F; idleTime = CD_F; back = CD_I16; loops = CD_I16;
  private out: StepOut = { yaw: 0, dist: 0 };
  // save block: FUN_00530687 (vtable +0x14) / FUN_005306ac (+0x10, memcpy): the 0xc bytes at node +0x30: +0x00 f32 heading, +0x04 f32 idleTime, +0x08 i16 back, +0x0a i16 loops
  saveBlock(_w: World, _rec: GameRecord, _ctrl: Controller): Uint8Array { return new BlockOut(0xc).f32(0, this.heading).f32(4, this.idleTime).i16(8, this.back).i16(0xa, this.loops).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { const b = new BlockIn(data); this.heading = b.f32(0); this.idleTime = b.f32(4); this.back = b.i16(8); this.loops = b.i16(0xa); }
  constructor(args: Turn2PepBArgs, attach: Attach | null = null) { this.args = args; this.attach = attach; }

  private target(w: World): GameRecord | null { return this.args.target >= 0 ? w.records[this.args.target] ?? null : null; }
  /** mode -4: this clip's frame follows the target's frame + offset */
  private syncFrame(w: World, rec: GameRecord, restart: boolean) {
    const t = this.target(w);
    if (!rec.anim) return;
    let f = ad(t?.anim?.frame ?? 0, this.args.offset);
    const len = rec.anim.frameCount;
    if (len < f) {
      if (restart && 0 < this.args.first) rec.anim.start(this.args.idle, 0);
      if (0 < len) while (len < f) f = sb(f, len);
    }
    if (f < 0) f = 0;
    rec.anim.seek(f);
  }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const a = this.args;
    const v = w.vars.get(this.var);
    const ranLast = this.stamp === w.frame;
    const h = ctrl.walker;
    let done = false;
    if (!ranLast) {
      this.heading = rec.ry;
      if (h) waypoints.pause(h);
      this.back = 0;
      this.loops = a.count;
      rec.anim?.start(a.first < 1 ? a.idle : a.first, 0);
      if (a.mode === -4) this.syncFrame(w, rec, false);
    }
    let face = true;                    // local_c (uninitialised = non-zero on the turn-back path)
    if (this.back === 0) {
      const t = this.target(w);
      if (!t) {
        if (a.node < 0) face = false;
        else if (h) waypoints.turnToPoint(h, nodePos(a.map, a.node));
      } else if (h) waypoints.followRecord(h, t);
    } else if (h) waypoints.turnToHeading(h, this.heading);
    let r = STEP_FACING;
    if (face && h) {
      const pos = [rec.x, rec.y, rec.z];
      r = waypoints.step(h, pos, rec.ry, this.out, w.dt);
      rec.ry = this.out.yaw;
    }
    if (this.back === 0) {
      if (ranLast && rec.anim) {
        const hold = this.loops === 0 && (v & a.holdMask) === a.holdMask;
        if (a.mode === -4) this.syncFrame(w, rec, true);
        else if (!hold) {
          if (rec.anim.advance(1, w.dt) !== 0) {
            const clip = rec.anim.clip;
            if (clip === a.idle) {
              if (0 < a.extra) { this.idleTime = ad(this.idleTime, fr(w.dt)); if (T2B_IDLE_TIME < this.idleTime) rec.anim.start(a.extra, 0); }
            } else {
              if (clip === a.first && (v & 0x8000) !== 0) this.dropBox(w, rec, BOX_TICKS);
              rec.anim.start(a.idle, 0);
              this.idleTime = 0;
            }
            if (0 < this.loops) { this.loops--; if (this.loops === 0) actionVarOp(w, rec, a.op, this.var, a.opValue); }
          }
        } else if (advanceOnce(rec, w.dt)) {
          if (a.mode < 0) { done = true; if (a.mode === -1) rec.ry = this.heading; }
          else if (this.back === 0) { this.back = 1; rec.anim.start(a.mode, 0); }
        }
      }
    } else {
      if (r === STEP_FACING) done = true;
      rec.anim?.advance(1, w.dt);
    }
    if (done) {
      if (v & 0x8000) { this.dropBox(w, rec, 0); w.vars.andNot(this.var, 0x8000); }
      toggleGate(w, this);
    }
    setRot(rec);
    return NODE_STOP;
  }

  private dropBox(w: World, rec: GameRecord, ticks: number) { const box = carriedPizza(w); if (box) releaseCarry(box, rec, ticks); }
}

/** FUN_0043b874(anim, 1.0, 0): advance without looping, true at the end */
function advanceOnce(rec: GameRecord, dt: number): boolean { return (rec.anim?.advanceTo(1, dt, 0) ?? 0) !== 0; }

/** the end of Turn2Pep B / MeetPepp: the node's gate bit is cleared when the gate wants it set, set otherwise */
function toggleGate(w: World, n: BehaviourNode) {
  if (n.mask === n.value) w.vars.andNot(n.var, n.mask);
  else w.vars.or(n.var, n.mask);
}

// =================================================================================================== MeetPepp

export interface MeetPeppArgs {
  /** +0x00: clip (-1: the short at +0x30 of the controller's head node) */ clip: number;
  /** +0x04: loops before the var operation, +0x06: op, +0x08: value, +0x0a: the bits that end the node afterwards */ count: number; op: number; opValue: number; endMask: number;
  /** +0x0c / +0x0e: the waypoint to face (node, map; 0 = none) */ node: number; map: number;
}
export function decodeMeetPepp(a: ArgView): MeetPeppArgs {
  return { clip: a.i32(0), count: a.i16(4), op: a.i16(6), opValue: a.i16(8), endMask: a.i16(0xa), node: a.i16(0xc), map: a.i16(0xe) };
}

export class MeetPeppNode implements BehaviourNode {
  readonly kind = 'MeetPepp';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: MeetPeppArgs;
  readonly attach: Attach | null;
  /** +0x24: loops left; -9 = the var operation is done, -10 = finished */ loops = CD_I32;
  private out: StepOut = { yaw: 0, dist: 0 };
  // save block: FUN_00530d0b (vtable +0x14) / FUN_00530d30 (+0x10, memcpy): the 4 bytes at node +0x24: i32 loops
  saveBlock(_w: World, _rec: GameRecord, _ctrl: Controller): Uint8Array { return new BlockOut(4).i32(0, this.loops).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.loops = new BlockIn(data).i32(0); }
  constructor(args: MeetPeppArgs, attach: Attach | null = null) { this.args = args; this.attach = attach; }

  private clip(ctrl: Controller): number {
    if (this.args.clip !== -1) return this.args.clip;
    const head = ctrl.nodes[0] as unknown as { clip30?: number } | undefined;
    return head?.clip30 ?? 0;
  }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const a = this.args;
    const v = w.vars.get(this.var);
    const h = ctrl.walker;
    if (this.stamp === w.frame) {
      const r = rec.anim?.advance(1, w.dt) ?? 0;
      if (r === 0) {
        if (a.node !== 0 && a.map !== 0 && h) {
          const pos = [rec.x, rec.y, rec.z];
          waypoints.step(h, pos, rec.ry, this.out, w.dt);
          rec.ry = this.out.yaw;
          setRot(rec);
        }
      } else if (this.loops === 0) {
        actionVarOp(w, rec, a.op, this.var, a.opValue);
        this.loops = -9;
      } else {
        if (0 < this.loops) this.loops--;
        rec.anim?.start(this.clip(ctrl), 0);
      }
      if (this.loops === -9 && (v & a.endMask) === a.endMask) this.loops = -10;
      if (this.loops === -10) {
        if (v & 0x8000) { const box = carriedPizza(w); if (box) releaseCarry(box, rec, 0); w.vars.andNot(this.var, 0x8000); }
        toggleGate(w, this);
      }
    } else {
      if (a.node !== 0 && a.map !== 0 && h) waypoints.turnToPoint(h, nodePos(a.map, a.node));
      if ((v & 0x8000) !== 0) { const box = carriedPizza(w); if (box) releaseCarry(box, rec, BOX_TICKS); }
      this.loops = a.count;
      rec.anim?.start(this.clip(ctrl), 0);
    }
    return NODE_STOP;
  }
}

// =================================================================================================== Turn2Pep C (FUN_005308f3, vtable 0x8ea978: update FUN_00530832)

/** +0x00: bits, +0x04: the variable, +0x08: -1 never, 1 once, else every tick (era 1: TBOB, BBR0) */
export interface Turn2PepCArgs { bits: number; target: number; mode: number }
export function decodeTurn2PepC(a: ArgView): Turn2PepCArgs { return { bits: a.i32(0), target: a.i32(4), mode: a.i32(8) }; }

/** FUN_00530832: var |= bits while its gate holds (once with mode 1); returns 0, so the next node runs as if this one had not */
export class Turn2PepCNode implements BehaviourNode {
  readonly kind = 'Turn2PepC';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: Turn2PepCArgs;
  readonly attach: Attach | null;
  /** +0x1c */ mode: number;
  // save block: FUN_00530895 (vtable +0x14) / FUN_005308ba (+0x10, memcpy): the 4 bytes at node +0x1c: i32 mode
  saveBlock(_w: World, _rec: GameRecord, _ctrl: Controller): Uint8Array { return new BlockOut(4).i32(0, this.mode).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.mode = new BlockIn(data).i32(0); }
  constructor(args: Turn2PepCArgs, attach: Attach | null = null) { this.args = args; this.attach = attach; this.mode = args.mode; }
  update(w: World): number {
    if (this.mode === -1) return NODE_NONE;
    w.vars.or(this.args.target, this.args.bits);
    if (this.mode === 1) this.mode = -1;
    return NODE_NONE;
  }
}
export const CTOR_TURN2PEP_C = 0x5308f3;
