// BrickBot.c (Common\Z02LGI\c_src\BrickBot.c) and botPConly.c: the Brickster's bots of eras 1-3 (records BBT0-5 grey, BBR0 / BBG0 / BBB0 / BBY0 the
// coloured ones). Every bot also carries the generic talking-NPC node SGMFIG at position 0 (WP3: walker, ground probe, the pizza reaction that sets
// 0x1000 | 0x2000 in the bot's MOVE var when a pizza comes at it; the bots are targetable (controller flags 0x43) so they never talk) and a Human1
// random walk at the end of the chain. Ported from the decompile:
//   FUN_00531d45  follower constructor (node 0xc0, vtable 0x8eaa90)           -> BotFollowNode
//     FUN_00530e80  update: walk 4 ticks behind the leader (or ride on top of it, type 3), clone its walker
//     FUN_00531286  pre-render: mirror the leader's clip (FUN_00531944 maps it), the tap / spin gags every ~360 ticks
//   FUN_005327b1  hit / collect constructor (node 0x30, vtable 0x8eaaa8)      -> BotHitNode (gate MOVE & 0x1000 in eras 1 / 2, always in era 3)
//     FUN_00531e97  update: the pizza hit (WP5's pizzaHitOn FUN_00429556), the dazed clips, recovery; the shrink after the collect; era 3 wave gag
//     FUN_00532557  pre-render: Pepper within 2 units of a bot in this state collects it: NUM_BOT_HEADS + 1, score, COLORED_BOTHEADS bit by colour
//   FUN_00532acc  "harass" constructor (node 0x1c, vtable 0x8eaac8)           -> BotHarassNode
//     FUN_00532939  update: random face every 6 ticks; a walker it bumped into becomes the leader of its second follower node (MOVE |= 8)
//   FUN_00533ba8  "hide" constructor (node 0x44, vtable 0x8eaae0)             -> BotHideNode
//     FUN_00532bb1  update: keep a waypoint between itself and Pepper (or a record), circling it at the lane radius; peek and wave; move to another
//                   node of the ring DAT_008eaaf8 every 300 ticks, running along the route
//     FUN_00533ac2  pre-render: out-of-view time (frozen after 90 ticks out of view)
//   FUN_0053de63  botPConly constructor (node 0x2c, vtable 0x8eb248)          -> BotPcOnlyNode (BBT5 in era 1)
//     FUN_0053d990 / FUN_0053dc65  near TBOB it tells him (MOVE_TBOB |= 0x20); with MOVE & 2 it walks to and fro and, when it falls, sits dazed
// There is no brick effect in BrickBot.c (no FUN_00447e90 call): a collected bot shrinks (scale 0.9 - 0.2 per tick) in the Explode01.par burst
// and is hidden (MOVE = 0x4000). docs/re/m4/wp11-brickbot.md.
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED, RF_NPC } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { waypoints, MAP_PATH } from '../../game/walker.ts';
import type { StepOut } from '../../game/walker.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import type { Pe } from '../../formats/exe.ts';
import { rand } from '../rng.ts';
import { ad, sb, ml, fr, fromBits } from '../../zones/common/f32.ts';
import { normalise3 } from '../../zones/exact.ts';
import { ArgView } from '../args.ts';
import { BlockIn, BlockOut } from '../blockio.ts';
import { CD_F, CD_I16, CD_I32, CD_U8 } from './cd.ts';
import { EMU_RECORDS_BASE, EMU_RECORD_STRIDE } from '../args.ts';
import { recordOfTag, tagOf } from '../../shell/saveworld.ts';
import { tryCtx } from '../ctx.ts';
import { FX_NONE, GATE_OFF, GATE_ON, HALF_PI as FX_HALF_PI, fxGate, fxMatrix, fxStart, fxStartSwirl, recMatrix, registerFxStart } from '../emitters.ts';
import { pizzaHitOn } from '../pizza/pizza.ts';
import { PI, TWO_PI, nextSeq, actionVarOp, ctrlExtra, groupVarOp, headNodeVarOp, inView } from './globals.ts';

export const CTOR_BOT_FOLLOW = 0x531d45, CTOR_BOT_HIT = 0x5327b1, CTOR_BOT_HARASS = 0x532acc, CTOR_BOT_HIDE = 0x533ba8, CTOR_BOT_PCONLY = 0x53de63;

/** game variables (gamevars.tsv) */
export const BOT_VARS = { NUM_BOT_HEADS: 0x52, COLORED_BOTHEADS: 0x8e, SCORE_LGI: 0xa6, HISCORE_LGI: 0x12, NODE: 0x58, MOVE_TBOB: 0x5c } as const;
/** COLORED_BOTHEADS bits by the third letter of the record name (FUN_00532557: 'B' 8, 'G' 4, 'R' 2, 'Y' 1) */
export const HEAD_BITS: Record<string, number> = { B: 8, G: 4, R: 2, Y: 1 };
/** sounds: the hit (DAT_05d58164 = FUN_004433b0(0x102) Piza_Hit.wav, played at the bot), the collect (DAT_009da8f4 = FUN_00443580(0x2f1) Collect.wav) */
export const BOT_SND = { HIT: 0x102, COLLECT: 0x2f1 } as const;
/** clips (MFIG.blk; names from the set-up's animation dictionary) */
export const BOT_CLIP = {
  SURPRISED: 0x70, PIZZAHIT: 0x94, PIZZADAZED: 0x95, DOUBLEHIT: 0xcf, SIT2STAND: 0x11b,
  SNEAK: 0xb4, WAVE2: 0x90, RUN2: 0xda, TAP1: 0xfe, SPIN: 0x121, RUN1: 0x118,
} as const;
/** the emitters of FUN_005327b1: Explode01.par at (0, 4, 0), swirl01.swl at (0, 3.2, -2) of the bot (both turned -pi/2 about x) */
const FX_EXPLODE = 'Explode01.par', FX_SWIRL = 'swirl01.swl';
const FX_EXPLODE_OFS = [0, 4, 0], FX_SWIRL_OFS = [0, Math.fround(3.2), -2];   // 0x40800000, 0x404ccccd, 0xc0000000

// ---- tuning constants (EXE addresses)
/** FUN_00532557: _DAT_008eaac0 = 4.0: squared XZ distance of Pepper for the collect */
const COLLECT_DIST2 = 4;
/** FUN_00532557: start scale 0x3f666666 (0.9), shrink _DAT_008920f0 (0.2) per tick; state 10 */
const SHRINK_START = fromBits(0x3f666666), SHRINK_RATE = fromBits(0x3e4ccccd);
/** FUN_00531e97: era-3 wave gag pause 0x42700000 (60) */
const WAVE_PAUSE = 60;
/** FUN_00531d45: distance = argument * _DAT_00892090 (8) */
const UNITS = 8;
/** FUN_00530e80: a type-3 follower rides _DAT_00892080 (4) above the leader; FUN_00531286 lowers it _DAT_0089204c (0.5) in clip 0x29 */
const RIDE_HEIGHT = 4, RIDE_DIP = 0.5;
/** FUN_00531286: gag timer _DAT_00892154 (360), reset to -1000 (0xc47a0000) or rand(120) (0x42f00000); the tap / spin coin rand(10) > 5 */
const GAG_TIME = 360, GAG_RESET = -1000, GAG_RAND = 120;
/** FUN_00532bb1: frozen out of view after _DAT_00892598 (90) ticks; relocation every _DAT_008924dc (300); peek after 90; the hiding cone +-10 degrees
 *  (_DAT_0089211c 0.174532); circling speed _DAT_008920f0 (0.2), running speed _DAT_00892118 (0.4) */
const OUT_OF_VIEW = 90, RELOCATE_TIME = 300, PEEK_TIME = 90, HIDE_CONE = fromBits(0x3e32b884), CIRCLE_SPEED = fromBits(0x3e4ccccd), RUN_SPEED = fromBits(0x3ecccccd);
const HALF_PI = fromBits(0x3fc90fdb);     // _DAT_00892220 / 0x3fc90fdb
/** DAT_008eaaf8: the ring of PATH nodes the hiding bot BBT0 moves around (7 shorts) */
export const RING_VA = 0x8eaaf8, RING_LEN = 7;
const RING_DEFAULT = [0x171, 0x172, 0x173, 0x174, 0x175, 0x176, 0x177];
/** FUN_00533ba8: the running clip when the argument has none (0xda BB_RUN2) */
const RUN_CLIP_DEFAULT = 0xda;
/** FUN_00532939: a random face 0..5 every 6 ticks (0x40c00000) */
const FACE_TIME = 6;
/** FUN_00530e80: the follower's face */
const FOLLOW_FACE = 0xe;
/** botPConly FUN_0053d990: TBOB is told when the bot is lower than _DAT_00892110 (96) and within sqrt(_DAT_008921a0 = 576) = 24 units;
 *  FUN_0053dc65: a fall of more than _DAT_008925ec (0.04) per tick, the clip 0x118 for _DAT_0089237c (20) ticks */
const PC_TBOB_Y = 96, PC_TBOB_DIST2 = 576, PC_FALL = 0.04, PC_RUN_TIME = 20;

export function readRing(pe: Pe | undefined): number[] {
  if (!pe) return RING_DEFAULT.slice();
  const out: number[] = [];
  for (let i = 0; i < RING_LEN; i++) out.push((pe.u32(RING_VA + i * 2) << 16) >> 16);
  return out;
}

/** the per-world globals of BrickBot.c */
interface BotGlobals {
  /** DAT_05d586a4: the follower type handed out in turn (0, 1, 2) to followers whose argument is < 1 */
  nextType: number;
  /** DAT_05d586a0: the frame of the spin gag at which the leader is released (never written in the executable: 0) */
  spinRelease: number;
}
function botGlobals(w: World): BotGlobals {
  let g = w.ext.get('brickbot') as BotGlobals | undefined;
  if (!g) { g = { nextType: 0, spinRelease: 0 }; w.ext.set('brickbot', g); }
  return g;
}

/** creation order of the bot nodes = the set-up's attach order (setupZone calls the factories in that order); the constructors' work runs in it */


/** FUN_0043a4a1(rec + 0xc, rx, ry, rz): rotation from the record's Euler angles, translation kept */
const setRot = (rec: GameRecord) => rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z);
const wrap1 = (a: number) => (a < -PI ? ad(a, TWO_PI) : a > PI ? sb(a, TWO_PI) : a);
/** FUN_0043b874(anim, 1.0, 0): advance without looping; 2 at the end (the frame clamps at the frame count) */
function advanceClamp(rec: GameRecord, dt: number): number { return rec.anim?.advanceTo(1, dt, 0) ?? 0; }
/** FUN_0043b76a(anim, 1.0) */
const advance = (rec: GameRecord, dt: number) => rec.anim?.advance(1, dt) ?? 0;
const play = (rec: GameRecord, clip: number, frame = 0) => { rec.anim?.start(clip, frame); };
/** FUN_004239b3(ctrl): the value of the variable of the controller's head node */
function headVar(w: World, r: GameRecord | null): number { const n = r?.ctrl?.nodes[0]; return n ? w.vars.get(n.var) : 0; }

// =================================================================================================== follower FUN_00531d45

export interface BotFollowArgs { leader: number; dist: number; type: number }
export function decodeBotFollow(a: ArgView): BotFollowArgs { return { leader: a.recIndex(0), dist: a.f32(4), type: a.i32(8) }; }

export class BotFollowNode implements BehaviourNode {
  /** attach order */ readonly seq = nextSeq();
  readonly kind = 'BotFollow';
  readonly ctor = CTOR_BOT_FOLLOW;
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: BotFollowArgs;
  inited = false;
  /** +0x94: the leader (argument +0; FUN_00532939 assigns one to the follower whose mask is not 1) */ leader: GameRecord | null = null;
  /** +0x14: the distance behind the leader (argument +4 * 8) */ dist = 0;
  /** +0x18: type 0..2 (the clip variant, FUN_00531944), 3 = rides on top of the leader */ type = 0;
  /** +0x1c / +0x58: 5 places and Euler angles of the leader (a delay of 4 ticks), +0x98: the last written entry */
  hist: number[][] = Array.from({ length: 5 }, () => [CD_F, CD_F, CD_F]);
  eul: number[][] = Array.from({ length: 5 }, () => [CD_F, CD_F, CD_F]);
  idx = 0;
  /** +0xa8 gag timer, +0xac gag state (0 mirror, 1 waiting for the leader's clip to restart, 2 tap, 3 spin), +0xb0 the leader's clip mirrored,
   *  +0xb4 our clip, +0xb8 our frame, +0xbc tap ticks */
  gag = 0; state = 0; leaderClip = -1; ownClip = CD_I32; frame = 0; taps = CD_I32;
  /** block bytes +0x80 .. +0x8c (node +0x9c / +0xa0 / +0xa4): never read or written by the node's code; keep what a loaded block held */
  private pad = new Uint8Array(12).fill(CD_U8);
  constructor(args: BotFollowArgs) { this.args = args; }

  // ----------------------------------------------------------------------------------------------- save block: FUN_00531bbd (vtable +0x14: buffer protocol) / FUN_00531c99 (+0x10)
  // 0xa4 bytes of the node from +0x1c, then 4 bytes: the first dword (the 4 name characters) of the leader record (zeros without one). Block offsets (node offset - 0x1c):
  //   +0x00 5 x (f32 x 3) hist   +0x3c 5 x (f32 x 3) eul   +0x78 u32 the leader POINTER of the original process (a word of the heap of the original: the loader overwrites it from the name
  //   at +0xa4 (FUN_00419a79), so it is no state; written as the oracle machine's record address EMU_RECORDS_BASE + index * 0x68, 0 without a leader)
  //   +0x7c i32 idx   +0x80 / +0x84 / +0x88 (unused words)   +0x8c f32 gag   +0x90 i32 state   +0x94 i32 leaderClip   +0x98 i32 ownClip   +0x9c f32 frame   +0xa0 i32 taps   +0xa4 u32 leader's name tag
  saveBlock(_w: World, _rec: GameRecord, _ctrl: Controller): Uint8Array {
    const o = new BlockOut(0xa8);
    for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) { o.f32(12 * i + 4 * k, this.hist[i][k]); o.f32(0x3c + 12 * i + 4 * k, this.eul[i][k]); }
    const L = this.leader;
    o.u32(0x78, L ? EMU_RECORDS_BASE + L.index * EMU_RECORD_STRIDE : 0).i32(0x7c, this.idx);
    o.bytes.set(this.pad, 0x80);
    o.f32(0x8c, this.gag).i32(0x90, this.state).i32(0x94, this.leaderClip).i32(0x98, this.ownClip).f32(0x9c, this.frame).i32(0xa0, this.taps).u32(0xa4, L ? tagOf(L.name) : 0);
    return o.bytes;
  }
  loadBlock(w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    for (let i = 0; i < 5; i++) { this.hist[i] = [b.f32(12 * i), b.f32(12 * i + 4), b.f32(12 * i + 8)]; this.eul[i] = [b.f32(0x3c + 12 * i), b.f32(0x3c + 12 * i + 4), b.f32(0x3c + 12 * i + 8)]; }
    this.idx = b.i32(0x7c); this.pad = data.slice(0x80, 0x8c);
    this.gag = b.f32(0x8c); this.state = b.i32(0x90); this.leaderClip = b.i32(0x94); this.ownClip = b.i32(0x98); this.frame = b.f32(0x9c); this.taps = b.i32(0xa0);
    this.leader = recordOfTag(w, b.u32(0xa4));      // FUN_00419a79(&tag)
  }

  init(w: World) {
    if (this.inited) return;
    this.inited = true;
    this.leader = this.args.leader >= 0 ? w.records[this.args.leader] ?? null : null;
    this.dist = ml(this.args.dist, UNITS);
    // (+0xb4 `ownClip` / +0xbc `taps` are not written by the constructor FUN_00531d45: they keep 0xCDCDCDCD; the node's code sets them before it reads them: `leaderClip` is -1 until then)
    this.gag = 0; this.frame = 0; this.state = 0;
    if (this.args.type < 1) { const g = botGlobals(w); this.type = g.nextType; g.nextType++; if (2 < g.nextType) g.nextType = 0; }
    else this.type = this.args.type;
  }

  // ----------------------------------------------------------------------------------------------- FUN_00530e80
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.inited) this.init(w);
    const L = this.leader;
    if (!L) return NODE_NONE;
    const lv = headVar(w, L);
    if (lv & 0x4000) { headNodeVarOp(w, L.ctrl, 0x2000000, 2); return NODE_NONE; }
    if ((lv & 0x2000000) === 0) headNodeVarOp(w, L.ctrl, 0x2000000, 0);
    const ranLast = this.stamp === w.frame;
    if (!ranLast) { if (ctrl.walker) waypoints.unregister(ctrl.walker); this.state = 0; }
    if (this.type === 3) {
      // on top of the leader
      rec.rx = L.rx; rec.ry = L.ry; rec.rz = L.rz;
      rec.m.set(L.m);
      rec.y = ad(rec.y, RIDE_HEIGHT);
    } else {
      tryCtx(w)?.expression?.(rec, FOLLOW_FACE);
      const nd = -this.dist;
      const t = [ad(L.x, ml(nd, L.fx)), ad(L.y, ml(nd, L.fy)), ad(L.z, ml(nd, L.fz))];
      let next: number;
      if (ranLast) {
        this.idx++;
        if (this.idx < 5) { next = this.idx + 1; if (4 < next) next = 0; }
        else { this.idx = 0; next = 1; }
        this.hist[this.idx] = t; this.eul[this.idx] = [L.rx, L.ry, L.rz];
      } else {
        this.idx = 4;
        for (let i = 0; i < 5; i++) { this.hist[i] = t.slice(); this.eul[i] = [L.rx, L.ry, L.rz]; }
        next = 0;
      }
      // FUN_0043a340 (rotation, translation 0), then the place; only the yaw (+0x50) is stored
      const e = this.eul[next], p = this.hist[next];
      rec.ry = e[1];
      rec.m.set(buildMatrix(e[0], e[1], e[2], p[0], p[1], p[2]));
    }
    // FUN_0046248a(leader's walker, ours, distance), FUN_0046190f(ours, 1, 2)
    if (L.ctrl?.walker && ctrl.walker) waypoints.clone(L.ctrl.walker, ctrl.walker, this.dist);
    if (ctrl.walker) waypoints.setIgnore(ctrl.walker, 1, 2);
    return NODE_STOP;
  }

  // ----------------------------------------------------------------------------------------------- FUN_00531286
  prerender(w: World, rec: GameRecord, _ctrl: Controller) {
    w.vars.or(this.var, 0x20000);
    const L = this.leader, la = L?.anim, an = rec.anim;
    if (!L || !la || !an) return;
    if (!inView(w, rec)) { this.frame = la.frame; this.leaderClip = -1; this.ownClip = -1; return; }
    let lc = -1, oc = -1;
    let mirror = false;
    if (this.state === 1) {
      const lf = la.frame;
      if (2 <= lf) mirror = true;
      else {
        // the leader's clip restarted: a gag (always the tap for the follower gated on & 1 == 0; type 3 never gets here)
        let tap = 1;
        if (this.type !== 3) tap = (this.mask & 1) === 0 || (this.value & 1) !== 0 ? (rand(10) <= 5 ? 0 : 1) : 1;
        if (tap === 0) { this.state = 3; play(rec, BOT_CLIP.SPIN, lf); this.state = 0; }   // (sic: the state is reset at once)
        else { this.state = 2; play(rec, BOT_CLIP.TAP1, lf); this.ownClip = -1; this.taps = 0; }
      }
    } else if (this.state === 2) {
      const end = advanceClamp(rec, w.dt);
      this.taps++;
      if (end !== 0) { this.state = 0; headNodeVarOp(w, L.ctrl, 2, 0); this.gag = 0; }
    } else if (this.state === 3) {
      // unreachable in the executable (state 3 is replaced by 0 in the same call): kept for completeness
      const end = advanceClamp(rec, w.dt);
      if (end === 0) { if (botGlobals(w).spinRelease <= an.frame) { headNodeVarOp(w, L.ctrl, 4, 0); headNodeVarOp(w, L.ctrl, 0x2000000, 2); } }
      else if (this.mask === this.value) w.vars.andNot(this.var, this.mask);
      else w.vars.or(this.var, this.mask);
    } else mirror = true;
    if (mirror) {
      lc = la.clip; oc = an.clip;
      let f = 0;
      if (oc !== this.ownClip || oc === 0x123) this.leaderClip = -1;
      if (this.leaderClip === -1) {
        const lf = la.frame;
        oc = mapClip(lc, this.type);
        this.ownClip = oc; this.frame = lf; f = lf;
        play(rec, oc, lf);
        this.leaderClip = lc;
      } else if (lc === this.leaderClip) {
        const lf = la.frame;
        if (this.frame <= lf) { f = lf; if (this.frame < sb(lf, 2)) f = ad(this.frame, 2); an.seek(f); }
        else { advance(rec, w.dt); f = an.frame; }
        this.frame = f;
      } else {
        const n = an.frameCount;
        f = an.frame;
        if (sb(n, 2) <= f) { an.seek(sb(n, 1)); oc = mapClip(lc, this.type); this.ownClip = oc; play(rec, oc, 0); this.leaderClip = lc; }
        else an.seek(ad(f, 2));
        this.frame = an.frame;
      }
      const n = an.frameCount;
      if (n <= f) { this.frame = la.frame; an.seek(n - 1); }
      this.gag = ad(ml(1, fr(w.dt)), this.gag);
      if (GAG_TIME < this.gag) {
        if ((lc === 0xd || lc === 0x73) && this.type !== 3) { this.state = 1; this.gag = GAG_RESET; }
        else this.gag = rand(GAG_RAND);
      }
    }
    if (oc === 0x29 && this.type === 3) rec.y = sb(rec.y, RIDE_DIP);
  }
}

/** FUN_00531944(leader's clip, node): the clip a follower plays for the leader's (walk 0xd / 0x73 -> the cheeky walks, wave 0x74 -> the cheeky waves ...) */
export function mapClip(c: number, type: number): number {
  if (type === 3) {
    switch (c) {
      case 0x71: case 0x79: case 0x85: return 0x123;
      case 0x74: return 0x74;
      case 0x78: case 0x82: return 0x78;
      default: return 0x29;
    }
  }
  if (c < 0x8e) {
    if (c === 0x8d) return 0x8e;
    switch (c) {
      case 0xd: case 0x73: return type === 1 ? 0x8d : type !== 2 ? 0x113 : 0x8e;
      case 0x74: return type === 1 ? 0x91 : 0x90;
      case 0x85: return 0x123;
      default: return c;
    }
  }
  switch (c) {
    case 0x8e: return 0x113;
    case 0x90: return 0x91;
    case 0x91: return 0x90;
    case 0x113: return 0x8d;
    default: return c;
  }
}

// =================================================================================================== hit / collect FUN_005327b1

export interface BotHitArgs { victim: number }
export function decodeBotHit(a: ArgView): BotHitArgs { return { victim: a.i16(0) }; }

registerFxStart((w) => { for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) if (n instanceof BotHitNode) n.startFx(w, r); });

export class BotHitNode implements BehaviourNode {
  /** attach order */ readonly seq = nextSeq();
  readonly kind = 'BotHit';
  readonly ctor = CTOR_BOT_HIT;
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: BotHitArgs;
  inited = false;
  /** +0x1c: scale while shrinking, +0x20: dazed clip count, +0x22: 0 / 10 shrinking / -1 gone */ scale = CD_F; count = CD_I16; dying = 0;
  /** +0x24: armed (waiting for the hit), +0x25: the hit reaction is still to start, +0x26: how it was hit (1 pizza, 2 hand-over, 3 fall, -1 forced) */
  armed = 1; fresh = 1; how = CD_I16;
  /** +0x28: the NPC the bot harasses (its MOVE var: |= 0x20000 at the start, |= 1 when the bot is hit), +0x2a: era-3 wave running, +0x2c: wave pause */
  victim = 0; waving = 0; pause = 0;
  /** +0x14 the Explode01 emitter, +0x18 the swirl01 swirl */
  explodeH = FX_NONE; swirlH = FX_NONE;
  constructor(args: BotHitArgs) { this.args = args; }

  // ----------------------------------------------------------------------------------------------- save block: FUN_00532727 (vtable +0x14) / FUN_0053274c (+0x10)
  // the 0x14 bytes at node +0x1c: +0x00 f32 scale, +0x04 i16 count, +0x06 i16 dying, +0x08 u8 armed, +0x09 u8 fresh, +0x0a i16 how, +0x0c i16 victim, +0x0e i16 waving, +0x10 f32 pause
  saveBlock(_w: World, _rec: GameRecord, _ctrl: Controller): Uint8Array {
    return new BlockOut(0x14).f32(0, this.scale).i16(4, this.count).i16(6, this.dying).u8(8, this.armed).u8(9, this.fresh).i16(0xa, this.how).i16(0xc, this.victim).i16(0xe, this.waving).f32(0x10, this.pause).bytes;
  }
  loadBlock(w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.scale = b.f32(0); this.count = b.i16(4); this.dying = b.i16(6); this.armed = b.u8(8); this.fresh = b.u8(9); this.how = b.i16(0xa); this.victim = b.i16(0xc); this.waving = b.i16(0xe); this.pause = b.f32(0x10);
    // the loader switches the swirl on again when the bot was knocked down (count != 0) and is not gone: FUN_0044ea60(swirl, 2, 1, 1)
    if (this.count !== 0 && this.dying !== -1) fxGate(w, this.swirlH, GATE_ON);
  }
  /** the constructor's two emitters (idempotent; `finishEmitters` runs it for every bot, whatever its gate) */
  startFx(w: World, rec: GameRecord) {
    if (this.explodeH === FX_NONE) this.explodeH = fxStart(w, FX_EXPLODE, recMatrix(rec), FX_EXPLODE_OFS, [-FX_HALF_PI, 0, 0], GATE_OFF);
    if (this.swirlH === FX_NONE) this.swirlH = fxStartSwirl(w, FX_SWIRL, FX_SWIRL_OFS, [-FX_HALF_PI, 0, 0], GATE_OFF);
  }

  init(w: World, rec: GameRecord, ctrl: Controller) {
    if (this.inited) return;
    this.inited = true;
    this.dying = 0; this.armed = 1; this.fresh = 1; this.waving = 0; this.pause = 0;
    this.mask = 0; this.value = 0;      // finding BB1: the constructor FUN_005327b1 (4 parameters) writes mask = value = 0 into the node (0x532817 / 0x532820): the attach's gate (eras 1 / 2) is gone, the node runs every tick
    // FUN_0044e920(Explode01, rec + 0xc, 0, 4, 0, -pi / 2, 0, 0, off) and FUN_0044e990(swirl01.swl, ..., (0, 3.2, -2), -pi / 2, off): the ctor's emitters (+0x14 / +0x18)
    this.startFx(w, rec);
    if (ctrl.walker) waypoints.setIgnore(ctrl.walker, 1, 2);
    this.victim = this.args.victim;
    if (1 < this.victim) w.vars.or(this.victim, 0x20000);
  }

  // ----------------------------------------------------------------------------------------------- FUN_00531e97
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.inited) this.init(w, rec, ctrl);
    const node = w.vars.get(BOT_VARS.NODE);
    let v = w.vars.get(this.var);
    if (this.dying !== 0) {
      if (this.dying === -1) { this.gone(w, rec); return NODE_STOP; }
      this.scale = sb(this.scale, ml(SHRINK_RATE, fr(w.dt)));
      if (0 < this.scale) {
        rec.m.set(buildMatrix(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z, this.scale, this.scale, this.scale));
        rec.scale = [this.scale, this.scale, this.scale];
      } else { this.dying = -1; w.vars.set(this.var, 0x4000); this.stopFx(w, rec); this.count = 0; }
      return NODE_STOP;
    }
    if ((v & 0x1000000) === 0) {
      if ((v & 0x4020000) === 0 && (v & 0x3000) === 0) {
        // the wave gag (era 3: the bots dance; Pepper waving at them = SGMFIG's 0x200)
        if (this.waving === 0) {
          if (0x33 < node) {
            if (0 < this.pause) this.pause = sb(this.pause, ml(1, fr(w.dt)));
            if ((v & 0x200) !== 0 && this.pause <= 0) { this.waving = 1; play(rec, BOT_CLIP.SURPRISED); return NODE_STOP; }
          }
          return NODE_NONE;
        }
        if (advance(rec, w.dt) !== 0) { this.waving = 0; this.pause = WAVE_PAUSE; return NODE_NONE; }
        return NODE_STOP;
      }
      if (0x33 < node) return NODE_NONE;
    } else { this.how = -1; v |= 0x3000; }
    if ((v & 0x1000) === 0) {
      if (this.dying < 0) { w.vars.set(this.var, 0); rec.flags &= ~RF_ENABLED; ctrl.flags &= ~2; this.stopFx(w, rec); this.count = 0; }
      return NODE_NONE;
    }
    if ((v & 0x10000) === 0) {
      if (this.armed) {
        if ((v & 0x1000000) === 0) {
          if ((v & 0x2000) === 0) { w.vars.andNot(this.var, 0x1000); return NODE_NONE; }   // the pizza went past
          this.how = pizzaHitOn(w, rec);
          if (this.how !== 0) {
            this.armed = 0;
            w.vars.andNot(this.var, 0xfe); w.vars.or(this.var, 1);
            tryCtx(w)?.sfxAt(BOT_SND.HIT, [rec.x, rec.y, rec.z]);
          }
          // (0x53229e: also without a hit) a pizza at the bot frees the NPC it harasses
          if (2 < this.victim) { w.vars.or(this.victim, 1); groupVarOp(w, rec, 1, 0); w.vars.andNot(this.victim, 0x20000); }
          return NODE_STOP;
        }
        this.how = -1; this.armed = 0;
        w.vars.andNot(this.var, 0xfe); w.vars.or(this.var, 1);
      }
    } else {
      // knocked over by a fall (botPConly 0x11000)
      this.armed = 0; this.how = 3;
      w.vars.andNot(this.var, 0x10000);
    }
    if (this.fresh === 0) {
      if (this.count === 0) {
        const r = advance(rec, w.dt);
        if (r === 1 || r === 2) {
          // back on its feet
          rec.flags |= RF_NPC;
          if (ctrl.walker) waypoints.reregister(ctrl.walker);
          w.vars.andNot(this.var, 0x1000); w.vars.andNot(this.var, 0x1000000);
          fxGate(w, this.swirlH, GATE_OFF);
          this.armed = 1; this.fresh = 1;
        }
      } else {
        ctrlExtra(ctrl).f14 |= 0x10;      // FUN_00427000: the ground probe may run
        if ((v & 0x2000) !== 0) { this.how = pizzaHitOn(w, rec); if (this.how !== 0) this.count = 5; }
        const r = advance(rec, w.dt);
        if (r === 1 || r === 2) {
          if (this.count === 5) { play(rec, BOT_CLIP.PIZZADAZED); this.count--; }
          else { this.count--; if (this.count === 0) play(rec, BOT_CLIP.SIT2STAND); }
        }
      }
    } else {
      // the hit reaction starts: the swirl over the head, no box collision (Pepper can walk into it), the clip by how it was hit
      fxMatrix(w, this.swirlH, recMatrix(rec));     // FUN_0044ea00(swirl, rec + 0xc) + FUN_0044ea60(swirl, 2, 1, 1)
      fxGate(w, this.swirlH, GATE_ON);
      rec.flags &= ~RF_NPC;
      if (this.how === 1) { play(rec, BOT_CLIP.PIZZAHIT); this.count = 5; }
      else if (this.how === 2) { play(rec, BOT_CLIP.DOUBLEHIT); this.count = 5; }
      else { play(rec, BOT_CLIP.PIZZADAZED); this.count = 4; }
      this.fresh = 0;
    }
    return NODE_STOP;
  }

  // ----------------------------------------------------------------------------------------------- FUN_00532557
  prerender(w: World, rec: GameRecord, ctrl: Controller) {
    if (!inView(w, rec) || this.dying !== 0) return;
    if (!(ctrl.distSq < COLLECT_DIST2)) return;
    // collected: the head counts, the bot shrinks away in the explosion
    this.dying = 10; this.scale = SHRINK_START;
    w.vars.add(BOT_VARS.NUM_BOT_HEADS, 1);
    w.vars.add(BOT_VARS.SCORE_LGI, 1000);
    w.vars.add(BOT_VARS.HISCORE_LGI, 1000);
    tryCtx(w)?.sfx(BOT_SND.COLLECT);
    fxMatrix(w, this.explodeH, recMatrix(rec));    // FUN_0044ea00(explode, rec + 0xc) + FUN_0044ea60(explode, 2, 1, 1)
    fxGate(w, this.explodeH, GATE_ON);
    const bit = HEAD_BITS[rec.name.charAt(2)];
    if (bit) w.vars.or(BOT_VARS.COLORED_BOTHEADS, bit);
  }

  private gone(w: World, rec: GameRecord) {
    w.vars.set(this.var, 0x4000);
    this.stopFx(w, rec);
    rec.flags &= ~RF_ENABLED;
    this.count = 0;
  }
  private stopFx(w: World, _rec: GameRecord) { fxGate(w, this.swirlH, GATE_OFF); fxGate(w, this.explodeH, GATE_OFF); }
}

// =================================================================================================== harass FUN_00532acc

export class BotHarassNode implements BehaviourNode {
  /** attach order */ readonly seq = nextSeq();
  readonly kind = 'BotHarass';
  readonly ctor = CTOR_BOT_HARASS;
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  inited = false;
  /** +0x18: face timer */ face = FACE_TIME;
  // save block: FUN_00532a6e (vtable +0x14) / FUN_00532a93 (+0x10, memcpy): the 4 bytes at node +0x18: f32 face timer
  saveBlock(_w: World, _rec: GameRecord, _ctrl: Controller): Uint8Array { return new BlockOut(4).f32(0, this.face).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.face = new BlockIn(data).f32(0); }

  /** FUN_00532acc: the bot's MOVE var is reset unless the bot is gone (0x4000) */
  init(w: World) {
    if (this.inited) return;
    this.inited = true;
    if ((w.vars.get(this.var) & 0x4000) === 0) w.vars.set(this.var, 0);
    this.face = FACE_TIME;
  }

  // ----------------------------------------------------------------------------------------------- FUN_00532939
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.inited) this.init(w);
    this.face = sb(this.face, ml(1, fr(w.dt)));
    if (this.face <= 0) { tryCtx(w)?.expression?.(rec, Math.trunc(rand(6))); this.face = FACE_TIME; }
    const h = ctrl.walker;
    if (h && waypoints.isYielding(h)) {
      const o = waypoints.blockerRecord(h) as GameRecord | null;
      if (o && o.ctrl && (headVar(w, o) & 0x2000000) === 0) {
        for (const n of ctrl.nodes) {
          if (n instanceof BotFollowNode && n.mask !== 1) { n.init(w); n.leader = o; w.vars.or(n.var, 8); break; }
        }
      }
    }
    return NODE_NONE;
  }
}

// =================================================================================================== hide FUN_00533ba8

export interface BotHideArgs { clip: number; node: number; actVar: number; actValue: number; actOp: number; target: number }
export function decodeBotHide(a: ArgView): BotHideArgs {
  return { clip: a.i32(0), node: a.i16(4), actVar: a.i16(6), actValue: a.i16(8), actOp: a.i16(0xa), target: a.recIndex(0xc) };
}

export class BotHideNode implements BehaviourNode {
  /** attach order */ readonly seq = nextSeq();
  readonly kind = 'BotHide';
  readonly ctor = CTOR_BOT_HIDE;
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: BotHideArgs;
  inited = false;
  /** +0x14: the node to hide behind (< 0: the ring DAT_008eaaf8, -2: never move on), +0x16 / +0x18 / +0x1a: var / value / op of FUN_0051dc50 every 300 ticks */
  anchor = -1; actVar = 0; actValue = 0; actOp = 0;
  /** +0x1c: the record to hide from (0 = Pepper), +0x20: the running clip */ target: GameRecord | null = null; runClip = RUN_CLIP_DEFAULT;
  /** +0x24: state (0 hide, 1 peek, 2 run to the new node, 3 go round the old one), +0x28 / +0x2a: old / current ring index */ state = 0; prev = CD_I16; ring = 0;
  /** +0x2c: ticks out of view, +0x30: relocation timer, +0x34: hidden time */ away = 0; reloc = 0; hidden = 0;
  /** +0x38 / +0x3c / +0x40: the node's scratch vector of the circle step (FUN_00532bb1 keeps the last offset from the anchor, (normalised direction) * radius, in the node; in state 3's turn to run it holds the record's first matrix row * radius) */
  circleOff: [number, number, number] = [CD_F, CD_F, CD_F];
  private nodes: number[] = RING_DEFAULT;
  private out: StepOut = { yaw: 0, dist: 0 };
  constructor(args: BotHideArgs) { this.args = args; }

  // ----------------------------------------------------------------------------------------------- save block: FUN_00533b4a (vtable +0x14) / FUN_00533b6f (+0x10, memcpy)
  // the 0x20 bytes at node +0x24: +0x00 i32 state, +0x04 i16 prev, +0x06 i16 ring, +0x08 f32 away, +0x0c f32 reloc, +0x10 f32 hidden, +0x14 / +0x18 / +0x1c f32 circleOff
  saveBlock(_w: World, _rec: GameRecord, _ctrl: Controller): Uint8Array {
    return new BlockOut(0x20).i32(0, this.state).i16(4, this.prev).i16(6, this.ring).f32(8, this.away).f32(0xc, this.reloc).f32(0x10, this.hidden).f32(0x14, this.circleOff[0]).f32(0x18, this.circleOff[1]).f32(0x1c, this.circleOff[2]).bytes;
  }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.state = b.i32(0); this.prev = b.i16(4); this.ring = b.i16(6); this.away = b.f32(8); this.reloc = b.f32(0xc); this.hidden = b.f32(0x10); this.circleOff = [b.f32(0x14), b.f32(0x18), b.f32(0x1c)];
  }

  init(w: World, _rec: GameRecord, ctrl: Controller) {
    if (this.inited) return;
    this.inited = true;
    this.nodes = readRing(tryCtx(w)?.pe);
    this.reloc = 0; this.ring = 0; this.away = 0; this.state = 0; this.hidden = 0;
    this.anchor = this.args.node; this.actVar = this.args.actVar; this.actValue = this.args.actValue; this.actOp = this.args.actOp;
    this.target = this.args.target >= 0 ? w.records[this.args.target] ?? null : null;
    this.runClip = this.args.clip === 0 ? RUN_CLIP_DEFAULT : this.args.clip;
    if (this.anchor < 1 && ctrl.walker) waypoints.teleport(ctrl.walker, this.nodes[this.ring]);
  }

  private anchorNode(i = this.ring) { return this.anchor < 0 ? this.nodes[i] : this.anchor; }

  // ----------------------------------------------------------------------------------------------- FUN_00532bb1
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.inited) this.init(w, rec, ctrl);
    if (OUT_OF_VIEW < this.away) return NODE_STOP;
    const h = ctrl.walker;
    if (this.stamp !== w.frame) {
      play(rec, this.state === 0 ? BOT_CLIP.SNEAK : this.state === 1 ? BOT_CLIP.WAVE2 : this.runClip);
      if ((w.frame < 10 || w.vars.get(BOT_VARS.NODE) === 0x36) && h) waypoints.teleport(h, this.anchor < 1 ? this.nodes[this.ring] : this.anchor);
    }
    const radius = ml(waypoints.get(h)?.lane ?? 0, UNITS);    // FUN_00461ab1: the lane * 8
    const pos = [rec.x, rec.y, rec.z];
    const dt = fr(w.dt);
    switch (this.state) {
      case 1:
        if (advance(rec, w.dt) === 0) break;
        this.state = 0;
        play(rec, BOT_CLIP.SNEAK);
      // falls through
      case 0: {
        if (!this.target) this.target = w.focus;
        const T = this.target;
        if (!T) break;
        const P = waypoints.nodePos(MAP_PATH, this.anchorNode());
        let move: boolean;
        if (this.anchor === -2) move = false;
        else {
          this.reloc = ad(ml(1, dt), this.reloc);
          move = RELOCATE_TIME < this.reloc;
          if (move) this.reloc = 0;
        }
        if (!move) {
          // hide: keep P between the bot and the target, going round P at the lane radius
          const a1 = wrap1(fr(Math.atan2(sb(T.x, P[0]), sb(T.z, P[2]))));       // anchor -> target
          const a2 = wrap1(fr(Math.atan2(sb(P[0], pos[0]), sb(P[2], pos[2]))));   // bot -> anchor
          const d = wrap1(sb(a2, a1));
          const side = d < -HIDE_CONE ? -HALF_PI : HIDE_CONE < d ? HALF_PI : 0;
          if (side !== 0 || this.stamp !== w.frame) { rec.ry = side === 0 ? ad(a2, HALF_PI) : ad(a2, side); setRot(rec); }
          if (side === 0) {
            this.hidden = ad(ml(1, dt), this.hidden);
            if (PEEK_TIME < this.hidden && this.anchor === -1) { this.state = 1; this.hidden = 0; play(rec, BOT_CLIP.WAVE2); setRot(rec); }
          } else {
            ctrlExtra(ctrl).f14 |= 0x10;
            this.circle(rec, P, radius, ml(CIRCLE_SPEED, dt));
            advance(rec, w.dt);
            this.hidden = 0;
          }
        } else if (this.anchor < 0) {
          // move on to the neighbour on the ring that is farther from the target
          const up = this.ring + 1 > 6 ? 0 : this.ring + 1, down = this.ring - 1 < 0 ? 6 : this.ring - 1;
          const Pu = waypoints.nodePos(MAP_PATH, this.nodes[up]), Pd = waypoints.nodePos(MAP_PATH, this.nodes[down]);
          const sq3 = (A: number[]) => { const x = sb(T.x, A[0]), y = sb(T.y, A[1]), z = sb(T.z, A[2]); return ad(ad(ml(x, x), ml(y, y)), ml(z, z)); };
          const du = sq3(Pu), dd = sq3(Pd);
          this.prev = this.ring;
          this.ring = dd <= du ? up : down;
          play(rec, this.runClip);
          this.state = 3;
          if (h) waypoints.goTo(h, this.nodes[this.ring], 0);
        } else {
          if (this.actVar !== 0) actionVarOp(w, rec, this.actOp, this.actVar, this.actValue);
          this.reloc = 0;
        }
        break;
      }
      case 2: {
        ctrlExtra(ctrl).f14 |= 0x10;
        const r = h ? waypoints.step(h, pos, rec.ry, this.out, w.dt) : -1;
        if (h) { rec.x = pos[0]; rec.z = pos[2]; rec.ry = this.out.yaw; }
        setRot(rec);
        if (r === -1) {
          play(rec, BOT_CLIP.SNEAK);
          this.state = 0; this.hidden = 0;
          if (h) waypoints.teleport(h, this.nodes[this.ring]);
        } else {
          this.stepForward(rec, ml(RUN_SPEED, dt));
          advance(rec, w.dt);
        }
        break;
      }
      case 3: {
        // round the old node until the new one is less than 90 degrees off, then run there
        ctrlExtra(ctrl).f14 |= 0x10;
        const Pold = waypoints.nodePos(MAP_PATH, this.nodes[this.prev]), Pnew = waypoints.nodePos(MAP_PATH, this.nodes[this.ring]);
        const aNew = wrap1(fr(Math.atan2(sb(Pnew[0], pos[0]), sb(Pnew[2], pos[2]))));
        const aOld = wrap1(fr(Math.atan2(sb(Pold[0], pos[0]), sb(Pold[2], pos[2]))));
        const d = wrap1(sb(aNew, aOld));
        if (HALF_PI <= fr(Math.abs(d))) {
          rec.ry = 0 <= d ? sb(aOld, HALF_PI) : ad(aOld, HALF_PI);
          setRot(rec);
          this.circle(rec, Pold, radius, ml(CIRCLE_SPEED, dt));
          advance(rec, w.dt);
        } else {
          rec.ry = aNew;
          this.state = 2;
          setRot(rec);
          this.circleOff = [ml(rec.m[0], radius), ml(rec.m[1], radius), ml(rec.m[2], radius)];     // (the node's scratch gets the matrix row * radius)
          this.stepForward(rec, ml(RUN_SPEED, dt));
        }
        break;
      }
    }
    return NODE_STOP;
  }

  /** local_3c / 38 / 34 = speed * dt * forward (the product is `(speed * dt) * m`), added to the position */
  private stepForward(rec: GameRecord, k: number) {
    const sx = ml(k, rec.m[8]), sy = ml(k, rec.m[9]), sz = ml(k, rec.m[10]);
    rec.x = ad(sx, rec.x); rec.y = ad(sy, rec.y); rec.z = ad(sz, rec.z);
  }

  /** step along the facing, then back onto the circle of `radius` round P (in 3D, like the original: FUN_0043cec0 on the offset) */
  private circle(rec: GameRecord, P: number[], radius: number, k: number) {
    this.stepForward(rec, k);
    const d = [sb(rec.x, P[0]), sb(rec.y, P[1]), sb(rec.z, P[2])];
    normalise3(d);
    this.circleOff = [ml(d[0], radius), ml(d[1], radius), ml(d[2], radius)];
    rec.x = ad(P[0], this.circleOff[0]); rec.y = ad(P[1], this.circleOff[1]); rec.z = ad(P[2], this.circleOff[2]);
  }

  // ----------------------------------------------------------------------------------------------- FUN_00533ac2
  prerender(w: World, rec: GameRecord) {
    if (!inView(w, rec)) this.away = ad(ml(1, fr(w.dt)), this.away); else this.away = 0;
  }
}

// =================================================================================================== botPConly FUN_0053de63

export interface BotPcOnlyArgs { nodeA: number; nodeB: number; tbob: number }
export function decodeBotPcOnly(a: ArgView): BotPcOnlyArgs { return { nodeA: a.i32(0), nodeB: a.i32(4), tbob: a.recIndex(8) }; }

export class BotPcOnlyNode implements BehaviourNode {
  readonly kind = 'BotPcOnly';
  readonly ctor = CTOR_BOT_PCONLY;
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: BotPcOnlyArgs;
  /** +0x14 / +0x18 the two PATH nodes, +0x1c TBOB, +0x20 y last tick, +0x24 run time, +0x28 which node, +0x2a arrived, +0x2b falling */
  which = 0; arrived = 0; falling = 0; lastY = CD_F; run = CD_F;
  // save block: FUN_0053de05 (vtable +0x14) / FUN_0053de2a (+0x10, memcpy): the 0xc bytes at node +0x20: +0x00 f32 lastY, +0x04 f32 run, +0x08 i16 which, +0x0a u8 arrived, +0x0b u8 falling
  saveBlock(_w: World, _rec: GameRecord, _ctrl: Controller): Uint8Array { return new BlockOut(0xc).f32(0, this.lastY).f32(4, this.run).i16(8, this.which).u8(0xa, this.arrived).u8(0xb, this.falling).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { const b = new BlockIn(data); this.lastY = b.f32(0); this.run = b.f32(4); this.which = b.i16(8); this.arrived = b.u8(0xa); this.falling = b.u8(0xb); }
  private out: StepOut = { yaw: 0, dist: 0 };
  constructor(args: BotPcOnlyArgs) { this.args = args; }

  // ----------------------------------------------------------------------------------------------- FUN_0053d990
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const v = w.vars.get(this.var);
    if ((v & 2) === 0) {
      const t = this.args.tbob >= 0 ? w.records[this.args.tbob] : null;
      if (t && rec.y < PC_TBOB_Y) {
        const d2 = (t.x - rec.x) ** 2 + (t.y - rec.y) ** 2 + (t.z - rec.z) ** 2;
        if (d2 < PC_TBOB_DIST2) headNodeVarOp(w, t.ctrl, 0x20, 0);
      }
      return NODE_NONE;
    }
    const h = ctrl.walker;
    const nodeOf = (i: number) => (i === 0 ? this.args.nodeA : this.args.nodeB);
    if (this.stamp !== w.frame) {
      if (h) waypoints.moveToPoint(h, waypoints.nodePos(MAP_PATH, nodeOf(this.which)));
      play(rec, BOT_CLIP.RUN1);
      this.run = 0; this.falling = 0;
    }
    const pos = [rec.x, rec.y, rec.z];
    const r = h ? waypoints.step(h, pos, rec.ry, this.out, w.dt) : -1;
    if (r === -1 || this.arrived) {
      if (this.which === 1) {
        w.vars.andNot(this.var, 2);
        if (h) waypoints.teleport(h, nodeOf(this.which));
        this.which = 0; this.falling = 0; this.arrived = 0;
      } else {
        this.which = 1;
        if (h) waypoints.moveToPoint(h, waypoints.nodePos(MAP_PATH, nodeOf(this.which)));
        this.falling = 0; this.arrived = 0;
      }
    } else {
      rec.ry = this.out.yaw;
      rec.setEuler(rec.rx, rec.ry, rec.rz, pos[0], pos[1], pos[2]);
      ctrlExtra(ctrl).f14 |= 0x10;
    }
    // the controller probe starts 4 up behind the bot (c+0x20 = (-fwd.x, 4, -fwd.z)): the bot drops over an edge it walks off
    const p = ctrl.probe;
    if (p && p.mask !== 0) { p.off[0] = -rec.fx; p.off[1] = 4; p.off[2] = -rec.fz; }
    this.lastY = rec.y;
    return NODE_STOP;
  }

  // ----------------------------------------------------------------------------------------------- FUN_0053dc65
  prerender(w: World, rec: GameRecord, ctrl: Controller) {
    const clip = rec.anim?.clip ?? -1;
    const head = ctrl.nodes[0] as { falling?: number } | undefined;
    if ((head?.falling ?? 0) !== 0 || (this.falling !== 0 && PC_FALL < this.lastY - rec.y)) {
      this.run = 0; this.falling = 1;
      if (clip === BOT_CLIP.PIZZADAZED) advance(rec, w.dt); else play(rec, BOT_CLIP.PIZZADAZED);
    } else {
      this.run += w.dt;
      if (clip === BOT_CLIP.RUN1 || this.run <= PC_RUN_TIME) advance(rec, w.dt);
      else if (this.falling === 0) play(rec, BOT_CLIP.RUN1);
      else { this.falling = 0; this.arrived = 1; w.vars.or(this.var, 0x11000); }
    }
  }
}

// =================================================================================================== set-up

/**
 * The constructors' world work for the bots (the factories of `registerCtor` do not see the world): run after the SGMFIG nodes made the walkers
 * (`startIslandNpcs` calls it). In attach order per record, like the original's set-up: FUN_005327b1 (walker ignores others, the victim's 0x20000),
 * FUN_00531d45 (leader, distance, type from the shared counter), FUN_00532acc (MOVE var reset unless gone), FUN_00533ba8 (walker onto the ring).
 */
export function startBrickBots(w: World, others: { seq: number; run: () => void }[] = []) {
  botGlobals(w).nextType = 0;
  const all: { seq: number; run: () => void }[] = [...others];
  for (const rec of w.records) {
    const c = rec.ctrl;
    if (!c) continue;
    for (const n of c.nodes) {
      if (n instanceof BotHitNode) all.push({ seq: n.seq, run: () => n.init(w, rec, c) });
      else if (n instanceof BotFollowNode) all.push({ seq: n.seq, run: () => n.init(w) });
      else if (n instanceof BotHarassNode) all.push({ seq: n.seq, run: () => n.init(w) });
      else if (n instanceof BotHideNode) all.push({ seq: n.seq, run: () => n.init(w, rec, c) });
    }
  }
  all.sort((a, b) => a.seq - b.seq);
  for (const x of all) x.run();
}

/** factories by constructor address (registered by src/island/npc/index.ts) */
export const BRICKBOT_FACTORIES: [number, (a: Attach) => BehaviourNode][] = [
  [CTOR_BOT_FOLLOW, (a) => new BotFollowNode(decodeBotFollow(ArgView.of(a)))],
  [CTOR_BOT_HIT, (a) => new BotHitNode(decodeBotHit(ArgView.of(a)))],
  [CTOR_BOT_HARASS, () => new BotHarassNode()],
  [CTOR_BOT_HIDE, (a) => new BotHideNode(decodeBotHide(ArgView.of(a)))],
  [CTOR_BOT_PCONLY, (a) => new BotPcOnlyNode(decodeBotPcOnly(ArgView.of(a)))],
];
