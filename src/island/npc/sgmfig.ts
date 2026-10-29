// SGMFIG: the generic talking minifig of the island (Common\SGGen\c_src\SGMFIG.c; also used by CSI, DIP, OGL, PYA, OSD, FSH). Ported from the decompile:
//   FUN_00426151  constructor (vtable 0x8adce0)                 -> SgmfigNode.init
//   FUN_00425c13  update: hide, cutscene reward, ground probe request, Shift candidate, conversation      -> update
//   FUN_00426014  pre-render: separation / fall, pizza reaction, the state word                            -> prerender
//   FUN_0042651e  destroy                                        FUN_004260d6 draw (default draw + _DAT_009da640 = 256: done in prerender here)
//   FUN_004249a6  the conversation while it runs                 -> converse
//   FUN_00424526  NPC separation and falling                     -> separate
//   FUN_0042477f  reaction to a pizza thrown at the NPC          -> pizzaReaction (the hit test FUN_00429183 is WP5's `incomingPizza`)
//   FUN_00425902  the state word (MOVE_<NAME>): where Pepper is, the talk icon, Shift starts a conversation / cutscene -> stateLogic
//   FUN_004252c3  Pepper and the NPC face each other             -> faceEachOther
//   FUN_004254a5  conversation start: lines <NAME>A+B / <NAME>C+D, Pepper's talk pose, the point-the-way target    -> startConversation
// The record's MOVE_<NAME> variable (the node's gate var) is the NPC's state word; bits (docs/re/m4/wp3-npc.md 2):
//   0x100 Pepper near (within the second radius), 0x200 / 0x400 / 0x800 the Turn2Pep requests, 0x1000 | 0x2000 pizza reaction running,
//   0x2000 frozen (no talking), 0x4000 hidden, 0x8000 the Footy kick, 0x20000 no talking this tick, 0x40000 talked (the cutscene was played),
//   0x40000000 no pizza reaction; bits 1 / 2 / 4 / 0x40 select the companion nodes (Human1 routes, Turn2Pep, MeetPepp) the island's set-up attaches.
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { CF_ENABLED, NODE_CONTINUE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED, RF_NPC } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { alignRecordToGround } from '../../game/walk.ts';
import { AnimInstance } from '../../game/anim.ts';
import { parseBlk } from '../../formats/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import { waypoints, MAP_PATH, NPC_SPEED, NPC_TURN_RATE, NPC_RADIUS_MIN, NPC_RADIUS_MAX, NPC_RADIUS_LIMIT } from '../../game/walker.ts';
import type { StepOut } from '../../game/walker.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import type { Pe } from '../../formats/exe.ts';
import { rand, randTrunc } from '../rng.ts';
import { ArgView } from '../args.ts';
import { tryCtx } from '../ctx.ts';
import { ad, sb, ml, fr, sq, fromBits } from '../../zones/common/f32.ts';
import { eulerRotation } from '../../zones/exact.ts';
import { PI, wrapPi, nextSeq, actorCamera, ctrlExtra, groupVarOp, inView, npcGlobals, orVar, pepperSide, probeResult, probeSet } from './globals.ts';
import { incomingPizza } from '../pizza/pizza.ts';
import { customerReward, customerVarOp } from '../pizza/delivery.ts';

export const CTOR_SGMFIG = 0x426151;

// ---- constants (EXE addresses)
/** DAT_008adcf8: the animation sets (stride 0x14, index = argument short +0x28): +0 / +4 pizza catch clips (high / low), +8 talk, +0xc point, +0x10 fall acceleration */
export const ANIM_SET_VA = 0x8adcf8, ANIM_SET_STRIDE = 0x14;
const ANIM_SET_DEFAULT = { catchHigh: 113, catchLow: 121, talk: 130, point: 129, fall: 0.032 };
/** _DAT_008920c0: squared distance at which an NPC pushed back by Pepper returns to its place (2.08^2) */
const RESTORE_DIST2 = fromBits(0x408a71de);
/** _DAT_008920b8: Pepper closer than this pushes the NPC back (FUN_004252c3) */
const PUSH_DIST = fromBits(0x3fa3d70a);
/** _DAT_008920ac / _DAT_008920a8: the pizza reaction needs the NPC near Pepper (squared) or Pepper above it */
const CATCH_DIST2 = fromBits(0x3fd1b717), CATCH_HEIGHT = fromBits(0x4019999a);
/** FUN_00425902: cone of "Pepper in front" (0x3f860a63 = 60 degrees) */
const FRONT_CONE = fromBits(0x3f860a63);
/** FUN_004254a5: conversation timer start (0x42b40000) */
const TALK_TIME = 90;
/** FUN_004249a6: the conversation may end below 30, the point animation is played back from frame 29 - timer below 15 (_DAT_00892038 / _DAT_00892074 / _DAT_008920b4) */
const TALK_MIN = 30, TALK_POINT = 15, TALK_POINT_FRAME = 29;
/** the camera of the conversation: FUN_00422f21(npc, Pepper's yaw + PI, side 1, 3.2, DAT_008add78) and back behind Pepper (side 2, DAT_008add88) */
const CAM_HEIGHT = fromBits(0x404ccccd);
const CAM_NPC_VA = 0x8add78, CAM_PEP_VA = 0x8add88;
const CAM_NPC_DEFAULT = [4, 2, -10], CAM_PEP_DEFAULT = [0, 4, -20];
/** Pepper's clips: talk pose 0x78 (FUN_004254a5), idle 0x1b at the end (FUN_004249a6) */
const PEP_TALK_CLIP = 0x78, PEP_IDLE = 0x1b;
/** _DAT_008920b0: 95 % of the face changes are a mouth frame 0..5 for 6 ticks, the rest an eye frame 6..9 for 2 ticks */
const EXPR_MOUTH_CHANCE = 95;
/** ctor: probe start / fall start velocity (0x40a00000), maximum fall velocity (_DAT_00892080) */
const FALL_START = 5, FALL_MAX = 4;

export interface AnimSet { catchHigh: number; catchLow: number; talk: number; point: number; fall: number }
export function readAnimSet(pe: Pe | undefined, index: number): AnimSet {
  if (!pe) return { ...ANIM_SET_DEFAULT };
  const b = ANIM_SET_VA + index * ANIM_SET_STRIDE;
  const f = new DataView(new ArrayBuffer(4)); f.setUint32(0, pe.u32(b + 0x10), true);
  return { catchHigh: pe.u32(b) | 0, catchLow: pe.u32(b + 4) | 0, talk: pe.u32(b + 8) | 0, point: pe.u32(b + 0xc) | 0, fall: f.getFloat32(0, true) };
}
function readVec(pe: Pe | undefined, va: number, def: number[]): number[] {
  if (!pe) return def;
  const dv = new DataView(new ArrayBuffer(4));
  return [0, 1, 2].map((i) => { dv.setUint32(0, pe.u32(va + i * 4), true); return dv.getFloat32(0, true); });
}

/** the MFIG rig of the island (the records of the NPCs get their animation instance from it: FUN_0043b4e2 is done by the builder in the original) */
export function npcRig(w: World): Blk | null {
  if (w.ext.has('npcRig')) return w.ext.get('npcRig') as Blk | null;
  const ar = tryCtx(w)?.archive;
  let b: Blk | null = null;
  const e = ar?.find('anim/MFIG.blk');
  if (ar && e) { try { b = parseBlk(ar.read(e)); } catch { b = null; } }
  w.ext.set('npcRig', b);
  return b;
}

/** the argument block of FUN_00426151 */
export interface SgmfigArgs {
  /** +0x00: 0 plain, 1 / 2 a customer (talking ends with a reward; 2 also builds a house stage) -> node +0x50 */
  type: number;
  /** +0x04 / +0x08: talk radius and near radius ("metres": squared after * 8; a negative talk radius is used as is) */
  talkR: number; nearR: number;
  /** +0x0c: the state-word bits that must be set before a press of Shift from behind / beside plays the sound */
  mask: number;
  /** +0x10: first clip (-1 none) */
  clip: number;
  /** +0x14: start node of the PATH map (-1 nearest) */
  startNode: number;
  /** +0x18: sound id */
  sound: number;
  /** +0x1c..0x1f: copied to node +0x24..0x27 (not read by the ported code) */
  bytes: number[];
  /** +0x20: cutscene slot played on the first Shift (-1 none) */
  slot: number;
  /** +0x24: lane offset of the walker */
  lane: number;
  /** +0x28: animation set, +0x2a / +0x2c: the variable and the operation (1 set 1, 2 add 1, 3 subtract 1) of the reward */
  animSet: number; rewardVar: number; rewardOp: number;
}
export function decodeSgmfig(a: ArgView): SgmfigArgs {
  return {
    type: a.i16(0), talkR: a.f32(4), nearR: a.f32(8), mask: a.u16(0xc), clip: a.i32(0x10), startNode: a.i32(0x14), sound: a.i32(0x18),
    bytes: [a.u8(0x1c), a.u8(0x1d), a.u8(0x1e), a.u8(0x1f)], slot: a.i16(0x20), lane: a.f32(0x24), animSet: a.i16(0x28), rewardVar: a.i16(0x2a), rewardOp: a.i16(0x2c),
  };
}

const SHIFT = B.SHIFT;
const PC = 0x5e;

export class SgmfigNode implements BehaviourNode {
  readonly kind = 'SGMFIG';
  /** the constructor address (the objective's default target looks for it: src/zones/z02LGI/objective.ts) */
  readonly ctor = CTOR_SGMFIG;
  /** attach order */ readonly seq = nextSeq();
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: SgmfigArgs;
  readonly attach: Attach | null;
  inited = false;
  // ---- node state (offsets of the 0x6c-byte node)
  /** +0x14 / +0x18: squared talk / near radius */ talkR2 = 0; nearR2 = 0;
  /** +0x1c */ needMask = 0;
  /** +0x20: sound (id; the original keeps the handle of FUN_00443580) */ sound = 0;
  /** +0x28 */ animSetIndex = 0; set: AnimSet = { ...ANIM_SET_DEFAULT };
  /** +0x2a / +0x2c */ rewardVar = 0; rewardOp = 0;
  /** +0x32: the clip before the conversation / pizza reaction */ savedClip = 0;
  /** +0x36: falling, +0x37: pushed back by Pepper, +0x38: the conversation camera is due */ falling = 0; pushed = 0; camDue = 0;
  /** +0x3c..+0x44: the place before the push */ saved: [number, number, number] = [0, 0, 0];
  /** +0x48: fall velocity */ fallVel = FALL_START;
  /** +0x4c: talk flags: 2 pointing, 0x10 Pepper in front within the talk radius, 0x40 talking */ talk = 0;
  /** +0x50: the customer type (the objective's default target: `talk50`) */ talk50 = 0;
  /** +0x52: cutscene slot; -10 / -20 / -30 while the cutscene's reward is pending / done */ slot = -1;
  /** +0x54: conversation timer */ timer = 0;
  /** +0x58: which pair of lines (0: A/B, 1: C/D), +0x59: conversations held */ line = 0; talks = 0;
  /** +0x5c / +0x60: the lines whose voice waits for the speech channel (null = none) */ pending: [string, string | null] | null = null;
  /** walker step output */ private out: StepOut = { yaw: 0, dist: 0 };

  constructor(args: SgmfigArgs, attach: Attach | null = null) { this.args = args; this.attach = attach; }

  // ----------------------------------------------------------------------------------------------- FUN_00426151
  init(w: World, rec: GameRecord, ctrl: Controller) {
    if (this.inited) return;
    this.inited = true;
    const a = this.args, ctx = tryCtx(w), g = npcGlobals(w);
    if (this.attach && (this.attach as { ctrlFlags?: number }).ctrlFlags !== undefined) ctrl.flags = (this.attach as { ctrlFlags?: number }).ctrlFlags!;
    const v = w.vars.get(this.var);
    if (!rec.anim) { const rig = npcRig(w); if (rig) rec.anim = new AnimInstance(rig); }
    rec.flags |= RF_NPC;
    g.best = 1e38; g.target = null;
    { const p = ml(a.talkR, 8); this.talkR2 = a.talkR >= 0 ? ml(p, p) : a.talkR; }
    { const p = ml(a.nearR, 8); this.nearR2 = ml(p, p); }
    this.fallVel = FALL_START; this.talk = 0;
    this.needMask = a.mask;
    this.animSetIndex = a.animSet; this.set = readAnimSet(ctx?.pe, a.animSet);
    this.falling = 0; this.talks = 0; this.pushed = 0; this.camDue = 0; this.line = 0;
    if ((v & 0x40000) === 0) { this.talk50 = a.type; this.slot = a.slot; } else { this.talk50 = 0; this.slot = -1; }
    this.rewardVar = a.rewardVar; this.rewardOp = a.rewardOp;
    if (a.clip >= 0) rec.anim?.start(a.clip, 0);
    // FUN_00462d4f(1, rec, start): the controller's walker (created here, shared with the Human1 / Turn2Pep nodes of the record)
    let h = ctrl.walker && waypoints.get(ctrl.walker) ? ctrl.walker : 0;
    if (!h) h = waypoints.create(MAP_PATH, rec, a.startNode);
    ctrl.walker = h;
    if (h) {
      waypoints.setSpeed(h, NPC_SPEED);
      waypoints.setLane(h, a.lane);
      waypoints.setTurnRate(h, NPC_TURN_RATE);
      waypoints.setRadiusMin(h, NPC_RADIUS_MIN);
      waypoints.setRadiusMax(h, NPC_RADIUS_MAX);
      waypoints.setRadiusLimit(h, NPC_RADIUS_LIMIT);
      waypoints.apply(h, rec);
    }
    this.sound = a.sound;
    // onto the ground: terrain height below + 4, then a probe down to it (mask 1)
    const from = [rec.x, ad(rec.y, 4), rec.z];
    let dy = -128;
    const th = w.col.terrainHeight(from[0], from[1], from[2], 0);
    if (-1e38 < th) dy = sb(th, from[1]);
    const hit = w.col.probe(rec, from, [0, dy, 0], 1);
    if (!hit) { if (-1e38 < th) rec.y = th; } else { rec.x = hit.point[0]; rec.y = hit.point[1]; rec.z = hit.point[2]; }
    rec.savePrev();
  }

  // ----------------------------------------------------------------------------------------------- FUN_00425c13
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.inited) this.init(w, rec, ctrl);
    const ctx = tryCtx(w), g = npcGlobals(w);
    let v = w.vars.get(this.var);
    if (v & 0x4000) { rec.flags &= ~RF_ENABLED; return NODE_STOP; }
    if (!(rec.flags & RF_ENABLED)) return NODE_STOP;
    // the reward of the cutscene played on the first Shift (slot -> -10 at the start, -20, -30 = done): one step per update. The original has no cutscene test here:
    // the update pass (FUN_0042226e) skips the controllers whose flag 2 is clear, and the cutscene manager clears it for its actors (FUN_00458fa6: AI off), so a customer
    // that is an actor of his own cutscene advances after it, and one that is not an actor advances during it (controller.ts `updatePass` does the same skip).
    {
      if (this.slot === -10) this.slot = -20;
      else if (this.slot === -20) {
        this.slot = -30;
        if (this.talk50 !== 0) { customerReward(w, this.talk50); this.talk50 = 0; }   // SCORE_LGI / HISCORE_LGI + 1000; type 2: house stage cutscene (WP5 delivery.ts)
        if (this.rewardVar === 0xb0) { v = orVar(w, this.var, 0x40003); groupVarOp(w, rec, 3, 0); }
        else { v = orVar(w, this.var, 0x40001); groupVarOp(w, rec, 1, 0); }
        customerVarOp(w, this.var, this.rewardOp, this.rewardVar);
      }
    }
    if (this.pushed && RESTORE_DIST2 < ctrl.distSq) { rec.x = this.saved[0]; rec.y = this.saved[1]; rec.z = this.saved[2]; this.pushed = 0; }
    // the ground probe of this tick (run by the shared probe pass after the update pass)
    const dyp = this.falling ? -ad(ml(this.fallVel, fr(w.dt)), 4) : fr(-4.4);
    const mask = (ctrl.flags & 0x40) === 0 ? 0x43 : 3;
    if (!this.falling) probeSet(ctrl, [0, 4, 0], [0, dyp, 0], mask, 0xa110);
    else { ctrlExtra(ctrl).f14 |= 0x10; probeSet(ctrl, [0, 4, 0], [0, dyp, 0], mask, 0x2110); }
    if (v & 0x2000) return this.set.catchHigh < 0 ? NODE_CONTINUE : NODE_STOP;
    if (w.input.pressed & SHIFT) {
      // the candidate for Shift: the nearest NPC (the one already talking wins); none while a cutscene / dialog runs or Pepper is not on foot / aiming
      if (!ctx?.cutsceneActive() && g.lock === 0 && (w.vars.get(PC) & 0x11) !== 0) {
        if ((ctrl.flags & 0x40) === 0) {
          if ((this.talk & 0x40) === 0) { if (ctrl.distSq < g.best) { g.best = ctrl.distSq; g.target = rec; } }
          else { g.best = 0; g.target = rec; }
        }
      } else { g.best = -1; g.target = null; }
    }
    if ((this.talk & 0x40) === 0) return NODE_CONTINUE;
    if (!this.converse(w, rec, ctrl)) {
      this.talk &= ~0x40;
      g.lock = 0;
      w.vars.andNot(PC, 0x100);
    }
    return NODE_STOP;
  }

  // ----------------------------------------------------------------------------------------------- FUN_00426014
  prerender(w: World, rec: GameRecord, ctrl: Controller) {
    const v = w.vars.get(this.var);
    this.separate(w, rec, ctrl);
    if (!inView(w, rec)) { if (v & 0xe00) w.vars.andNot(this.var, 0xe00); }
    else if (!this.pizzaReaction(w, rec, ctrl, v)) {
      this.stateLogic(w, rec, ctrl, v);
      if (v & 0x20000) w.vars.andNot(this.var, 0x20000);
    }
    // FUN_004260d6 (the draw hook): the next frame's candidates must be nearer than 16 units
    npcGlobals(w).best = 256;
  }

  // ----------------------------------------------------------------------------------------------- FUN_0042651e
  destroy(w: World, _rec: GameRecord, ctrl: Controller) {
    if (ctrl.walker) { waypoints.free(ctrl.walker); ctrl.walker = 0; }
    const g = npcGlobals(w);
    g.groups = []; g.lock = 0; g.expr = 0;
    tryCtx(w)?.holdCutscene(false);
  }

  // ----------------------------------------------------------------------------------------------- FUN_00424526
  private separate(w: World, rec: GameRecord, ctrl: Controller) {
    if (ctrl.flags & 0x40) {
      // a pizza customer standing on another one's spot steps forward (every difference and sum a float32; |d| is compared with the double 0.1 at 0x8920a0)
      for (const o of w.records) {
        if ((o.flags & RF_NPC) !== 0 || !o.ctrl || (o.ctrl.flags & 0x40) === 0 || o.ctrl === ctrl) continue;
        const dx = sb(rec.x, o.x), dy = sb(rec.y, o.y), dz = sb(rec.z, o.z);
        if (Math.abs(dx) < 0.1 && Math.abs(dz) < 0.1 && dy < 0) {
          const fx = rec.m[8], fy = rec.m[9], fz = rec.m[10];       // (* 1.0f at 0x892020)
          rec.x = ad(fx, rec.x); rec.y = ad(fy, rec.y); rec.z = ad(fz, rec.z);
        }
      }
    }
    if (probeResult(ctrl) === 0) {
      // nothing below: fall (not below the sea)
      this.falling = 1;
      let y = sb(rec.y, this.fallVel);
      if (y < fr(w.seaLevel)) { y = fr(w.seaLevel); this.fallVel = 0; }
      rec.y = y;
      this.fallVel = ad(ml(this.set.fall, fr(w.dt)), this.fallVel);
      if (FALL_MAX < this.fallVel) this.fallVel = FALL_MAX;
    } else { this.fallVel = 0; this.falling = 0; }
  }

  // ----------------------------------------------------------------------------------------------- FUN_0042477f
  private pizzaReaction(w: World, rec: GameRecord, ctrl: Controller, v: number): boolean {
    if (v & 0x40000000) return false;
    const pep = w.focus;
    if (!((ctrl.flags & 0x40) !== 0 || CATCH_DIST2 <= ctrl.distSq || (pep && pep.y <= ad(rec.y, CATCH_HEIGHT)))) return false;
    const hit = incomingPizza(w, rec);     // FUN_00429183 (WP5)
    let r: boolean;
    if (hit.kind === 0) {
      if ((v & 0x2000) === 0) return false;
      r = false;
    } else {
      r = true;
      if ((v & 0x2000) === 0) {
        v = orVar(w, this.var, 0x3000);
        if (this.set.catchHigh >= 0) {
          this.savedClip = rec.anim?.clip ?? 0;
          rec.flags &= ~RF_NPC;
          rec.anim?.start(hit.height - rec.y <= 2 ? this.set.catchLow : this.set.catchHigh, 0);
        }
      }
    }
    if (this.set.catchHigh === -1) {
      if (!r && (v & 0x2000)) w.vars.andNot(this.var, 0x2000);
      r = false;
    } else if (!r) {
      if (rec.anim && rec.anim.advance(1, w.dt) !== 0) {
        rec.flags |= RF_NPC;
        w.vars.andNot(this.var, 0x2000);
        rec.anim.start(this.savedClip, 0);
      }
    } else rec.anim?.advance(1, w.dt);
    return r;
  }

  // ----------------------------------------------------------------------------------------------- FUN_00425902
  private stateLogic(w: World, rec: GameRecord, ctrl: Controller, v: number) {
    if (this.talk & 0x40) return;
    const g = npcGlobals(w), ctx = tryCtx(w);
    let set = 0, clr = 0;
    let { code, dist } = pepperSide(w, rec, ctrl, this.nearR2, FRONT_CONE);
    const shiftOnMe = (w.input.pressed & SHIFT) !== 0 && g.target === rec;
    if (dist <= this.talkR2) {
      // the talk icon of the HUD (INTERACT_ICONS |= 1)
      if ((v & 0x20000) === 0 && (ctrl.flags & 0x10) !== 0 && (rec.flags & RF_ENABLED)) w.vars.or(0xc, 1);
      if (this.talk & 0x10) code = 2;
    } else if (this.line > 0) this.line = 0;
    if (code === 0) { clr = 0x600; this.talk &= ~0x30; }
    else if (code === 2) {
      if (this.talkR2 <= dist) {
        if (this.nearR2 <= dist) { this.talk &= ~0x30; clr = 0x600; }
        else set = 0x700;
      } else {
        this.talk |= 0x10;
        if (shiftOnMe && (v & 0x20000) === 0) {
          // talk: the skateboard goes away, the two face each other, the conversation or the NPC's cutscene starts
          const acc = accessoryOf(w);
          if (acc) acc.flags &= ~RF_ENABLED;
          this.faceEachOther(w, rec);
          if (this.slot < 0 || (v & 0x40000)) this.startConversation(w, rec, ctrl);
          else { ctx?.startCutscene(this.slot); this.slot = -10; }
        }
        set = 0x500; clr = 0x200;
      }
    } else if (this.talkR2 <= dist) { clr = 0x600; this.talk &= ~0x30; }
    else if ((v & this.needMask) === this.needMask) {
      // Pepper behind / beside within the talk radius: Shift calls the NPC (its sound) and makes it turn round (Turn2Pep 0x100 | 0x800)
      if (!shiftOnMe) clr = 0x400;
      else { if (this.sound > 0) ctx?.sfx(this.sound); set = 0xd00; }
    } else if (!shiftOnMe) set = 0x700;
    else { set = 0x500; clr = 0x200; }
    if ((v & set) !== set) v = orVar(w, this.var, set);
    if (v & clr) w.vars.andNot(this.var, clr);
  }

  // ----------------------------------------------------------------------------------------------- FUN_004252c3
  private faceEachOther(w: World, rec: GameRecord) {
    const pep = w.focus;
    if (!pep) return;
    const dx = sb(rec.x, pep.x), dz = sb(rec.z, pep.z);
    const aiming = (w.vars.get(PC) & 0x10) !== 0;
    if (!aiming) {
      pep.ry = wrapPi(fr(Math.atan2(dx, dz)));
      eulerRotation(pep.m, 0, pep.ry, 0);           // FUN_0043a4a1(pepper + 0xc, 0, yaw, 0): the rotation part only
      accessoryAlign(w, pep);                       // FUN_00429e00: Pepper's slope alignment (D7)
    }
    const d = sq(ad(ad(ml(dz, dz), ml(dx, dx)), 0));
    if (d < PUSH_DIST) {
      const k = sb(PUSH_DIST, d);
      if (!this.pushed) this.saved = [rec.x, rec.y, rec.z];
      this.pushed = 1;
      rec.x = sb(rec.x, ml(rec.m[8], k)); rec.y = sb(rec.y, ml(rec.m[9], k)); rec.z = sb(rec.z, ml(rec.m[10], k));
    }
    if (!aiming) w.vars.set(PC, 1);
  }

  // ----------------------------------------------------------------------------------------------- FUN_004254a5
  private startConversation(w: World, rec: GameRecord, ctrl: Controller) {
    const ctx = tryCtx(w), g = npcGlobals(w);
    if (ctx?.cutsceneActive() || g.lock !== 0) return;
    const pep = w.focus;
    g.exprTimer = 0;
    this.talk &= ~2; this.talk |= 0x40;
    this.savedClip = rec.anim?.clip ?? 0;
    this.timer = TALK_TIME;
    ctx?.holdCutscene(true);
    if (pep?.ctrl) pep.ctrl.flags &= ~CF_ENABLED;
    const aiming = (w.vars.get(PC) & 0x10) !== 0;
    if (pep && !aiming) {
      // Pepper onto the ground (terrain below + 4, else 160 down; the probe with mask 0x43 wins)
      const from = [pep.x, ad(pep.y, 4), pep.z];
      let h = w.col.terrainHeight(pep.x, pep.y, pep.z, 4), dy: number;
      if (-80 <= h) dy = sb(h, from[1]); else { h = pep.y; dy = -160; }
      const hit = w.col.probe(pep, from, [0, dy, 0], 0x43);
      pep.y = hit ? hit.point[1] : h;       // (the matrix keeps its rotation: only the translation's y is written)
    }
    this.camDue = 1;
    this.talks = (this.talks + 1) & 0x7f;
    if (pep && !aiming) { pep.anim?.start(PEP_TALK_CLIP, 0); w.pep.mailbox = PEP_TALK_CLIP; }
    let point = true;
    if (this.line < 1) { rec.anim?.start(this.set.talk, 0); point = false; }
    if (this.set.point === -1) { this.line = 0; rec.anim?.start(this.set.talk, 0); point = false; }
    // the lines: <NAME> + 'A' + 2 * line and the next letter (B / D are optional: a missing tag is not spoken)
    const name = rec.name.slice(0, 4);
    const c0 = String.fromCharCode(65 + this.line * 2), c1 = String.fromCharCode(66 + this.line * 2);
    const table = ctx?.text.npc ?? null;
    const has = (id: string) => !!table && table.text(id) !== id;
    const id1 = name + c0, id2 = has(name + c1) ? name + c1 : null;
    if (table) {
      if (ctx && ctx.speechIdle() && ctx.say(table, id1, id2 ?? undefined)) this.pending = null;
      else this.pending = [id1, id2];
    }
    ctx?.cameraHold?.(true);
    if (point) {
      const t = ctx?.objective?.target(rec) ?? null;
      if (!t) this.line = 0;
      else {
        if (ctrl.walker) waypoints.turnToPoint(ctrl.walker, t.pos);
        rec.anim?.start(this.set.point, 0);
        this.talk |= 2;
      }
    }
  }

  // ----------------------------------------------------------------------------------------------- FUN_004249a6
  private converse(w: World, rec: GameRecord, ctrl: Controller): boolean {
    const ctx = tryCtx(w), g = npcGlobals(w);
    const pep = w.focus;
    const speechOn = w.vars.get(9) !== 0;
    let end: boolean;
    if ((w.input.pressed & SHIFT) === 0) {
      if (!this.pending) {
        this.timer = sb(this.timer, ml(1, fr(w.dt)));
        if (TALK_MIN <= this.timer) end = false;
        else {
          end = speechOn ? (ctx?.speechIdle() ?? true) : this.timer < 0;
          if (end) { if ((this.talk & 2) === 0) this.timer = -1; else if (TALK_POINT < this.timer) this.timer = TALK_POINT; }
        }
      } else {
        end = false;
        if (ctx && ctx.speechIdle()) {
          const t = ctx.text.npc;
          if (t) ctx.say(t, this.pending[0], this.pending[1] ?? undefined);
          this.pending = null;
        }
      }
    } else {
      // Shift again: cut it short
      this.timer = -1;
      w.vars.or(PC, 0x100);
      if (speechOn) ctx?.stopSpeech();
      this.pending = null;
      end = true;
    }
    if (this.camDue) {
      this.camDue = 0;
      if (pep) actorCamera(w, rec, ad(pep.ry, PI), 1, CAM_HEIGHT, readVec(ctx?.pe, CAM_NPC_VA, CAM_NPC_DEFAULT));
    }
    if ((this.talk & 2) === 0) rec.anim?.advance(1, w.dt);
    else {
      // pointing: turn towards the target, the point clip runs forward to frame 15 and back
      if (ctrl.walker) {
        const pos = [rec.x, rec.y, rec.z];
        waypoints.step(ctrl.walker, pos, rec.ry, this.out, w.dt);
        rec.ry = this.out.yaw;
        rec.setEuler(rec.rx, rec.ry, rec.rz, pos[0], rec.y, pos[2]);
      }
      if (TALK_POINT <= this.timer) { if (rec.anim && rec.anim.frame < TALK_POINT) rec.anim.advance(1, w.dt); }
      else rec.anim?.seek(TALK_POINT_FRAME - this.timer);
    }
    if (this.timer <= 2) { this.talk &= ~2; if (ctrl.walker) waypoints.turnToPoint(ctrl.walker, null); }
    if (end) {
      if (pep && (w.vars.get(PC) & 0x10) === 0) { pep.anim?.start(PEP_IDLE, 0); w.pep.mailbox = PEP_IDLE; w.vars.set(PC, 1); }
      rec.anim?.start(this.savedClip, 0);
      if (pep?.ctrl) pep.ctrl.flags |= CF_ENABLED;
      ctx?.holdCutscene(false);
      this.line++;
      if (this.line > 1) this.line = 0;
      ctx?.cameraHold?.(false);
      ctx?.expression?.(rec, g.expr);
      if (pep) actorCamera(w, pep, pep.ry, 2, CAM_HEIGHT, readVec(ctx?.pe, CAM_PEP_VA, CAM_PEP_DEFAULT));
      return false;
    }
    // the face of the speaking NPC
    g.exprTimer = sb(g.exprTimer, ml(1, fr(w.dt)));
    if (g.exprTimer <= 0) {
      if (rand(100) <= EXPR_MOUTH_CHANCE) { g.exprTimer = 6; ctx?.expression?.(rec, randTrunc(6)); }
      else { g.exprTimer = 2; ctx?.expression?.(rec, randTrunc(4) + 6); }
    }
    return true;
  }
}

/** DAT_009daa7c: the record hidden while walking (the skateboard of the island): the one Pepper's walk node holds */
function accessoryAlign(w: World, pep: GameRecord) { alignRecordToGround(w, pep); }

function accessoryOf(w: World): GameRecord | null {
  const n = w.focus?.ctrl?.nodes.find((x) => x.kind === 'SGwalk') as { accessory?: GameRecord | null } | undefined;
  return n?.accessory ?? null;
}
