// The kids' jump node (gaps S3): constructor FUN_004bf329 (Common\...\Human1.c's second family; handler table 0x8da358 = { update FUN_004beec5, pre-render FUN_004bf03e, destroy
// FUN_004bf598, draw FUN_004bf28f, save FUN_004bf2f0 / FUN_004bf2cb (the 4 bytes at +0x2c) }), attached by the era functions to XXX0 / XXX1 / XXX2 (the three kids) twice:
//   pos 2, gate MOVE_XXXn (0x73 / 0x74 / 0x75) & 4 == 4, arguments { 0.25 (0x3e800000), 0, -1, 0x122, 0x84, 1 }: a jump
//   pos 3, gate & 2 == 3 (never true: dead in the original), arguments { 0.05, 0 / -4, -5, 0, 0, 0 }
// The node plays the kid's jump clip (P4 = 0x84) and launches the head node (SGMFIG, FUN_00426151) into a ballistic arc: it sets the head's falling flag (+0x36) and fall velocity
// (+0x48, the SGMFIG fall code of sgmfig.ts then moves the record: y -= velocity, velocity += the animation set's gravity DAT_008add08 + 0x14 * set). When the arc ends the
// clip is finished and the node clears (mask == value) or sets its own gate bit.
//   constructor: H = P0 * 8 (0x892090); lift = P1 > 0 ? P1 : H * 0.1 (0x8920cc); the target height T = lift + H; g = the head's animation set gravity.
//     first loop, t = 1, 2, ... < 600 (0x89238c): c += t - 1; v = t * g; y = t * v - c * g; the first t with y > T gives the launch velocity: node +0x18 = -v, local_30 = t
//     second loop, i = 0, 1, ... < t: c += i - 1 (from 0); y = v * i - c * g; the first i with y > lift gives local_8 = i
//     node +0x1c = t + i (+ 10 (0x892060) when the clip P4 > 0); when P3 > 1 the game variable P3 := ftol(+0x1c + 0.5)
//   update FUN_004beec5 (the decompile lost its return value; read from the code): the node's state (+0x2c) restarts at 0 when the node did not run in the previous frame;
//     P2 < 0 (-1: always; < -1: only from frame -P2 of the clip on), P2 >= 0 (the walker is on the route, at waypoint P2, not yet "arrived" (+0x2e), and its squared distance
//     to the lane point <= its speed); returns 0 (not run) or 1 (P5 != 0) / 2
//   pre-render FUN_004bf03e: clip P4 < 1: state 4; else states 0 start the clip, 1 wait for frame 10, 2 launch (head falling = 1, fall velocity = -v) then wait for the landing
//     (head falling == 0 -> seek frame 26), 3 loop again when P5 == 0 and the frame is < 27; P5 != 0: the clip advances once per tick (FUN_0043b874) and its end finishes the
//     node (state 0, +0x2e = 1, gate bit toggled)
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { waypoints } from '../../game/walker.ts';
import { ArgView } from '../args.ts';
import { readAnimSet } from './sgmfig.ts';
import type { SgmfigNode } from './sgmfig.ts';
import { tryCtx } from '../ctx.ts';
import { nextSeq } from './globals.ts';

export const CTOR_LAUNCH = 0x4bf329;
const f32 = Math.fround;
/** 0x892090 (8.0), 0x8920cc (0.1), 0x89238c (600), 0x892060 (10), 0x89204c (0.5), 0x8924cc (26), 0x892588 (27) */
const SCALE = 8, LIFT_FACTOR = f32(0.10000000149011612), T_LIMIT = 600, WAIT_FRAME = 10, HALF = 0.5, HOLD_FRAME = 26, LOOP_FRAME = 27;
/** the debug heap fill 0xcccccccc as a float (a local the first loop leaves unset when it finds no t) */
const UNSET = -107374176.0;

export interface LaunchArgs { dist: number; lift: number; waypoint: number; variable: number; clip: number; once: number }
export function decodeLaunch(a: ArgView): LaunchArgs {
  return { dist: a.f32(0), lift: a.f32(4), waypoint: a.i32(8), variable: a.i32(0xc), clip: a.i32(0x10), once: a.i32(0x14) };
}

/** the constructor's arithmetic: `v` (the launch velocity, node +0x18 = -v), the flight time (+0x1c) */
export function launchArc(args: LaunchArgs, gravity: number): { velocity: number; time: number } {
  const g = f32(gravity);
  const H = f32(args.dist * SCALE);
  const lift = args.lift > 0 ? f32(args.lift) : f32(H * LIFT_FACTOR);
  const target = f32(lift + H);
  let c = 0, v = 0, t30 = UNSET, vel = 0;
  for (let t = 1; t < T_LIMIT; t = f32(t + 1)) {
    c = f32(f32(t - 1) + c);
    v = f32(t * g);
    const y = f32(f32(t * v) - f32(c * g));
    if (target < y) { vel = -v; t30 = t; break; }
  }
  c = 0;
  let i8 = 0;
  for (let i = 0; ; i = f32(i + 1)) {
    if (t30 <= i) break;
    c = f32(f32(i - 1) + c);
    const y = f32(f32(-vel * i) - f32(c * g));
    if (lift < y) { i8 = i; break; }
  }
  let time = f32(t30 + i8);
  if (0 < args.clip) time = f32(time + WAIT_FRAME);
  return { velocity: vel, time };
}

/** FUN_0043b874(anim, 1.0, 0): advance without looping; 2 at the end (the frame clamps at the frame count) */
function advanceOnce(rec: GameRecord, dt: number): number {
  const an = rec.anim;
  if (!an || !an.clipData) return 0;
  an.frame += dt;
  const n = an.frameCount;
  if (n < an.frame) { an.frame = n; return 2; }
  return 0;
}

export class LaunchNode implements BehaviourNode {
  readonly kind = 'launch';
  readonly ctor = CTOR_LAUNCH;
  /** attach order */ readonly seq = nextSeq();
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: LaunchArgs;
  /** +0x18 (-v) and +0x1c (the flight time) */
  velocity = 0; time = 0;
  /** +0x2c state, +0x2e arrived */
  state = 0; arrived = 0;
  private started = false;
  constructor(args: LaunchArgs) { this.args = args; }
  static of(a: Attach) { return new LaunchNode(decodeLaunch(ArgView.of(a))); }

  /** the constructor's world work (needs the head node of the controller: FUN_004239d9) */
  init(w: World, _rec: GameRecord, ctrl: Controller) {
    void _rec;
    if (this.started) return;
    this.started = true;
    const head = ctrl.nodes[0] as SgmfigNode | undefined;
    const set = readAnimSet(tryCtx(w)?.pe, head?.animSetIndex ?? 0);
    const arc = launchArc(this.args, set.fall);
    this.velocity = arc.velocity; this.time = arc.time;
    if (1 < this.args.variable) w.vars.set(this.args.variable, Math.trunc(f32(this.time + HALF)));
  }

  /** FUN_004beec5 */
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.started) this.init(w, rec, ctrl);
    const a = this.args;
    if (this.stamp !== w.frame) this.state = 0;
    if (this.state === 0) {
      if (a.waypoint < 0) {
        if (a.waypoint < -1) { if ((rec.anim?.frame ?? 0) < -a.waypoint) return 0; }
      } else {
        const h = ctrl.walker;
        const st = waypoints.status(h);
        if (st === 0 || (st !== 3 && st !== 2)) return 0;
        const wk = waypoints.get(h);
        if (!wk) return 0;
        if (wk.to !== a.waypoint) { this.arrived = 0; return 0; }
        if (this.arrived !== 0) return 0;
        if (!(wk.dist2 <= wk.speed)) return 0;
      }
    }
    return a.once !== 0 ? 1 : 2;
  }

  /** FUN_004bf03e */
  prerender(w: World, rec: GameRecord, ctrl: Controller): void {
    const a = this.args;
    let launch = false;
    if (a.clip < 1) {
      if (this.state !== 4) { this.state = 4; launch = true; }
    } else {
      const an = rec.anim;
      const head = ctrl.nodes[0] as SgmfigNode | undefined;
      switch (this.state) {
        case 0: this.state = 1; an?.start(a.clip, 0); break;
        case 1: if (WAIT_FRAME <= (an?.frame ?? 0)) { this.state = 2; launch = true; } break;
        case 2:
          if (!head || head.falling === 0) { this.state = 3; an?.seek(HOLD_FRAME); }
          else if (HOLD_FRAME < (an?.frame ?? 0)) an?.seek(25);
          break;
        case 3:
          if (a.once === 0 && (an?.frame ?? 0) < LOOP_FRAME) { this.arrived = 1; this.state = 0; }
          break;
      }
      if (a.once !== 0 && advanceOnce(rec, w.dt) !== 0) {
        this.arrived = 1; this.state = 0;
        if (this.mask === this.value) w.vars.andNot(this.var, this.mask); else w.vars.or(this.var, this.mask);
      }
    }
    if (launch) {
      const head = ctrl.nodes[0] as SgmfigNode | undefined;
      if (head) { head.fallVel = this.velocity; head.falling = 1; }
    }
  }
}
