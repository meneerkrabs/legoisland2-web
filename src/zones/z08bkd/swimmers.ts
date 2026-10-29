// The creatures that swim along the waypoint graph: the fish nodes (FishBeh FUN_005bc592 / FUN_005bc405 with the steering FUN_005bbd62: shark, swordfish, manta rays) and the
// dolphin (DolpBeh FUN_005bf7ce / FUN_005bea80 with FUN_005bf4db / FUN_005bf608), which jumps out of the water when a brick is delivered.
import type { Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { eulerMatrix, setEuler } from './matrix.ts';
import { C, CLIP, FISH_TAIL, f32bits } from './consts.ts';
import { BkdNode } from './env.ts';
import type { Env } from './env.ts';
import { angleDelta, dist2, normalize3, wrapAngle } from './math.ts';

import { fr, ad, sb, ml, dv, asin24 } from '../common/f32.ts';

/** the 13-float movement block (node +0x18 / +0xb4): rates [0] yaw [1] pitch, [3] yaw [4] pitch, [6..8] velocity, [9] turn gain, [10] turn drag, [11] speed, [12] drag */
export type Block = number[];
export const newBlock = (turn: number, drag: number, speed: number, vdrag: number): Block => [0, 0, 0, 0, 0, 0, 0, 0, 0, turn, drag, speed, vdrag];

/** (0, 1, 0) rotated by the matrix of (pitch + pi/2, yaw, 0): the direction the body points in (FUN_0043a340 + FUN_0043abe6) */
function forward(pitch: number, yaw: number): [number, number, number] {
  const m = eulerMatrix(ad(pitch, C.HALF_PI), yaw, 0);
  return [m[4], m[5], m[6]];
}

/** the target angles toward `to` (FUN_005bbd62 / FUN_005bea80): yaw = atan2(dx, dz), pitch = -asin(dy) of the normalised delta, both wrapped */
function targetAngles(from: ArrayLike<number>, to: ArrayLike<number>): { yaw: number; pitch: number } {
  const d = normalize3([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  return { yaw: wrapAngle(fr(Math.atan2(d[0], d[2]))), pitch: wrapAngle(fr(-asin24(d[1]))) };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ fish

/**
 * FUN_005bc592 / FUN_005bc405: a fish follows a closed loop of waypoints (the loop of the attach's tag and link, starting `frac` of the way round) at speed 10, turning toward
 * the next node (FUN_005bbd62) and taking the following node when it is within 3 units.
 */
export class FishNode extends BkdNode {
  readonly kind = 'FishBeh';
  /** node +0x18: the movement block */
  b: Block = newBlock(FISH_TAIL.TURN, FISH_TAIL.DRAG_ANG, FISH_TAIL.SPEED, FISH_TAIL.DRAG);
  /** node +0x58 / +0x6c / +0xe4: the loop of graph nodes and the index of the node it is heading for */
  path: number[] = [];
  index = 0;
  /** the attach's three argument words: tag (also +0xe8), link number, fraction (float bits) */
  readonly args: readonly number[];
  constructor(args: readonly number[]) { super(); this.args = args; }

  /** FUN_005bc592 after the allocation: find the loop, put the fish on its node */
  bind(env: Env, rec: GameRecord) {
    super.bind(env, rec);
    const g = env.graph;
    const start = g.firstWithTag(this.args[0]);
    const frac = f32bits(this.args[2]);
    const r = g.loop(start, this.args[1], frac);
    this.path = r.path;
    this.index = r.index;
    const p = g.nodes[r.node].pos;
    rec.x = p[0]; rec.y = p[1]; rec.z = p[2];
  }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c; void w;
    if (!this.env?.graph) return NODE_STOP;      // not prepared (the generic stub test ticks the set-up alone)
    const g = this.env.graph;
    const pos: [number, number, number] = [rec.x, rec.y, rec.z];
    const target = g.nodes[this.path[this.index]].pos;
    const d2 = dist2(pos, target);
    if (d2 < C.NINE) { this.index++; if (this.index === this.path.length) this.index = 0; }
    steer(this.env, rec, this.b, target, 1.0);
    return NODE_STOP;
  }
}

/**
 * FUN_005bbd62(rec, block, target, speedScale): turn toward the target with the node's turn gain (a fraction of the angle gap / pi), snap to it within 5 degrees, accelerate along
 * the new heading (speed * scale, drag -2) and move; the matrix takes pitch and yaw; the clip advances one frame.
 */
function steer(env: Env, rec: GameRecord, B: Block, target: ArrayLike<number>, scale: number) {
  const dt = env.clock.dt;
  const pos = [rec.x, rec.y, rec.z];
  const t = targetAngles(pos, target);
  const cmd = (want: number, cur: number): { v: number; dist: number } => {
    const a = angleDelta(want, cur);
    let v = 0;
    if (a.dir === 1) v = ml(B[9], a.frac);
    if (a.dir === -1) v = sb(v, ml(B[9], a.frac));
    return { v, dist: a.dist };
  };
  const yaw = cmd(t.yaw, B[3]), pitch = cmd(t.pitch, B[4]);
  B[0] = ml(ad(yaw.v, ml(B[10], B[0])), dt);
  B[1] = ml(ad(pitch.v, ml(B[1], B[10])), dt);
  let ny = ad(ml(dt, B[0]), B[3]), np = ad(ml(B[1], dt), B[4]);
  if (yaw.dist < C.FIVE_DEG) ny = t.yaw;
  if (pitch.dist < C.FIVE_DEG) np = t.pitch;
  ny = wrapAngle(ny); np = wrapAngle(np);
  const f = forward(np, ny);
  const k = ml(B[11], scale);
  B[6] = ad(ml(ad(ml(f[0], k), ml(B[12], B[6])), dt), B[6]);
  B[7] = ad(ml(ad(ml(f[1], k), ml(B[12], B[7])), dt), B[7]);
  B[8] = ad(ml(ad(ml(f[2], k), ml(B[12], B[8])), dt), B[8]);
  setEuler(rec, np, ny, 0, ad(ml(B[6], dt), rec.x), ad(ml(B[7], dt), rec.y), ad(ml(B[8], dt), rec.z));
  B[3] = ny; B[4] = np;
  rec.anim?.advance(1.0, env.world.dt);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ dolphin

/**
 * The dolphin patrols the waypoints of the bridge area (group 1 and the three link nodes, tagged 1 by the constructor). When a brick is delivered (`BkdState.dolphinMessage`:
 * 1 or 2) it swims to one of three nodes near the link nodes (route FUN_005bf608), rises to the link node above the surface, jumps (clip 2 / 5, a ballistic arc with gravity
 * 24), dives back (clip 3, pitch + pi) and returns to patrolling.
 */
export class DolphinNode extends BkdNode {
  readonly kind = 'DolpBeh';
  b: Block = newBlock(f32bits(0x445a2a3d), 0, 10, -2);
  /** +0xe8: 0 patrol, 1 to the goal, 2 / 3 up to the link node, 4 in the air, 5 back to the goal node */
  state = 0;
  /** +0xec: the message (1: small jump, 2: big jump) */
  kindOfJump = 0;
  /** +0xf4 / +0xf8 / +0xfc: speed, target speed, acceleration */
  speed = 4; targetSpeed = 4; accel = 0;
  /** +0x118: which of the three link pairs */
  pick = 0;
  /** +0x100 ..: [link node, its neighbour] x 3 */
  links: number[] = [];
  /** +0x34: the patrol node; +0x24: the previous patrol node / the route index (-1: recompute) */
  patrolNode = 0; prev = -1;
  /** +0x28: the goal position of the route; +0x34 is shared in the route code as the goal node (kept apart here) */
  goalPos: [number, number, number] = [0, 0, 0];
  private goalNode = -1;
  private route: number[] = [];
  private routeIdx = -1;
  /** DAT_05d5ab90: a jump clip is playing */
  jumping = false;

  bind(env: Env, rec: GameRecord) {
    super.bind(env, rec);
    this.links = env.graph.tagUntagged(1);
    this.patrolNode = this.links[1];
    this.prev = -1;
    const p = env.graph.nodes[this.patrolNode].pos;
    rec.x = p[0]; rec.y = p[1]; rec.z = p[2];
    rec.anim?.start(CLIP.DLPH_DOLSWIM, 0);
  }

  /** FUN_005bf4db: at the patrol node (within 3 units) pick one of its neighbours that is not the last node or a link node */
  private patrol(pos: ArrayLike<number>): [number, number, number] {
    const g = this.env.graph;
    const cur = g.nodes[this.patrolNode];
    if (dist2(pos, cur.pos) < C.NINE) {
      const cand = cur.nbr.filter((n) => n !== this.prev && n !== this.links[0] && n !== this.links[2] && n !== this.links[4]);
      this.prev = this.patrolNode;
      this.patrolNode = cand[this.env.clock.pick(cand.length)];
    }
    return g.nodes[this.patrolNode].pos;
  }

  /** FUN_005bf608: follow the route to the node nearest the goal position; true when it arrived at its last node (within 5 units) */
  private follow(pos: ArrayLike<number>, out: number[]): boolean {
    const g = this.env.graph;
    const goal = g.nearestWithTag(1, this.goalPos);
    if (goal !== this.goalNode || this.routeIdx === -1) {
      const start = g.nearestWithTag(1, pos);
      this.goalNode = goal;
      this.route = g.route(start, goal);
      this.routeIdx = 0;
    }
    let node = this.route[this.routeIdx];
    if (dist2(pos, g.nodes[node].pos) < 25) {
      if (node === this.route[this.route.length - 1]) return true;
      this.routeIdx++;
      node = this.route[this.routeIdx];
    }
    const p = g.nodes[node].pos;
    out[0] = p[0]; out[1] = p[1]; out[2] = p[2];
    return false;
  }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c; void w;
    const env = this.env, dt = env.clock.dt, g = env.graph, B = this.b;
    let steering = true, airborne = false;
    const msg = env.state.takeDolphinMessage();
    if (msg !== 0 && this.state === 0) {
      this.state = 1; this.kindOfJump = msg;
      this.targetSpeed = 12; this.accel = 12;
      this.pick = env.clock.pick(3);
      this.routeIdx = -1; this.prev = -1;
      const p = g.nodes[this.links[this.pick * 2 + 1]].pos;
      this.goalPos = [p[0], p[1], p[2]];
    }
    const pos: [number, number, number] = [rec.x, rec.y, rec.z];
    let target: number[] = [0, 0, 0];
    switch (this.state) {
      case 0: target = this.patrol(pos).slice(); break;
      case 1:
        if (this.follow(pos, target)) {
          // arrived: the target the frame steers to is the caller's uninitialised local (0xcccccccc = -1.0737418e8 per component)
          target = [fr(-1.0737418e8), fr(-1.0737418e8), fr(-1.0737418e8)];
          if (this.kindOfJump === 1) this.state = 2; else if (this.kindOfJump === 2) this.state = 3;
        }
        break;
      case 2:
        target = g.nodes[this.links[this.pick * 2]].pos.slice();
        if (C.DOLPHIN_RISE_Y < pos[1]) { this.state = 4; this.jumping = true; rec.anim?.start(CLIP.DLPH_JUMP1, 0); this.targetSpeed = 24; this.accel = 40; steering = false; }
        break;
      case 3:
        target = g.nodes[this.links[this.pick * 2]].pos.slice();
        if (C.DOLPHIN_RISE_Y < pos[1]) { this.state = 4; this.jumping = true; rec.anim?.start(CLIP.DLPH_JUMP2, 0); this.targetSpeed = 40; this.accel = 32; steering = false; }
        break;
      case 4:
        steering = false;
        if (pos[1] <= C.SURFACE_Y) {
          if (this.speed < C.ZERO) { this.speed = -this.speed; this.targetSpeed = 4; this.accel = 16; this.state = 5; }
        } else airborne = true;
        break;
      case 5:
        target = g.nodes[this.links[this.pick * 2 + 1]].pos.slice();
        if (dist2(pos, target) < C.NINE) { this.patrolNode = this.links[this.pick * 2 + 1]; this.prev = -1; this.state = 0; }
        break;
    }
    if (this.jumping) {
      const a = rec.anim!;
      if (sb(a.frameCount, C.ONE) < a.frame) { this.jumping = false; a.start(CLIP.DLPH_DOLSWIM, 0); B[4] = ad(B[4], C.PI); }
    }
    let ny: number, np: number;
    if (!steering) { ny = B[3]; np = B[4]; }
    else {
      const t = targetAngles(pos, target);
      const sf = dv(this.speed, C.TWELVE);
      const cmd = (want: number, cur: number): { v: number; dist: number } => {
        const a = angleDelta(want, cur);
        const frac = ml(a.frac, sf);
        let v = 0;
        if (a.dir === 1) v = ml(B[9], frac);
        if (a.dir === -1) v = sb(v, ml(B[9], frac));
        return { v, dist: a.dist };
      };
      const yaw = cmd(t.yaw, B[3]), pitch = cmd(t.pitch, B[4]);
      B[0] = ml(yaw.v, dt); B[1] = ml(pitch.v, dt);
      const iy = ml(dt, B[0]), ip = ml(B[1], dt);
      if (yaw.dist < C.FIVE_DEG || yaw.dist < Math.abs(iy)) { B[0] = 0; ny = t.yaw; } else ny = ad(iy, B[3]);
      if (pitch.dist < C.FIVE_DEG || pitch.dist < Math.abs(ip)) { B[1] = 0; np = t.pitch; } else np = ad(ip, B[4]);
      ny = wrapAngle(ny); np = wrapAngle(np);
    }
    const f = forward(np, ny);
    if (!airborne) {
      if (this.speed !== this.targetSpeed) {
        if (this.targetSpeed <= this.speed) { this.speed = sb(this.speed, ml(this.accel, dt)); if (this.speed < this.targetSpeed) this.speed = this.targetSpeed; }
        else { this.speed = ad(ml(this.accel, dt), this.speed); if (this.targetSpeed < this.speed) this.speed = this.targetSpeed; }
      }
      B[6] = ml(this.speed, f[0]); B[7] = ml(this.speed, f[1]); B[8] = ml(this.speed, f[2]);
    } else {
      this.speed = ad(ml(C.MINUS_TWENTY_FOUR, dt), this.speed);
      B[6] = 0; B[7] = this.speed; B[8] = 0;
    }
    rec.anim?.advance(1.0, env.world.dt);
    setEuler(rec, np, ny, 0, ad(ml(B[6], dt), pos[0]), ad(ml(B[7], dt), pos[1]), ad(ml(B[8], dt), pos[2]));
    B[3] = ny; B[4] = np;
    return NODE_STOP;
  }
}
