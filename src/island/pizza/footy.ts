// Footy.c (Common\Z02LGI\c_src\Footy.c, 0x538880..0x539eb0): three small ambient things of the island.
//   BALL: a football the three kids XXX0 / XXX1 / XXX2 kick to each other in the park (eras 0, 2, 3, 4). Now and then (more likely the longer it did
//         not happen) a kick goes astray to PATH node 0xbc and bounces away with smaller and smaller hops, and the receiver runs to fetch it.
//     FUN_0053955e  constructor (node 0xa8, handler table 0x8eb008)              -> FootballNode
//     FUN_00538e0b  update: wait for the kicker / the kick clip / the flight with hops / the roll to the receiver's feet -> FootballNode.update
//     FUN_00538880 next kicker (+ the astray roll)   FUN_0053893d the one after   FUN_00538968 the target   FUN_005389d9 the kick   FUN_00538c4d the roll
//     FUN_0053949d  draw: 0.4 higher while drawn (FootballNode.DRAW_LIFT, for the renderer)       FUN_005394fd / FUN_00539522 save / load (not ported)
//   FLR1 / FLR2: flowers in the garden of STEV (gate MOVE_STEV 0x7c & 0x20 / 0x10): when STEV sets the bit a flower grows from scale 0.5 to 1.5 in 90 ticks,
//         stays 90 ticks, shrinks back and the node clears its gate bit.
//     FUN_005399d8  constructor (node 0x20, table 0x8eb020)   FUN_005396af update   FUN_0053993e draw (default)  -> FlowerNode
//   LOON (eras 3 / 4): bobs up by arg * 8 at 0.08 per tick, waits 90 ticks, goes back down, waits 90 ticks.
//     FUN_00539d44  constructor (node 0x28, table 0x8eb038)   FUN_00539ae4 update   FUN_00539caa draw (default)  -> BobNode
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_NO_COLLIDE } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { MAP_PATH, waypoints } from '../../game/walker.ts';
import { NO_GROUND } from '../../game/collision.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { registerCtor } from '../../game/setup.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ArgView } from '../args.ts';
import { PI_F, TWO_PI_F, sfxAt } from './common.ts';

export const CTOR_FOOTBALL = 0x53955e, CTOR_FLOWER = 0x5399d8, CTOR_BOB = 0x539d44;

/** sound ids: Bounce.wav, FootKick.wav (the flower's two sounds, ids 0 and 2, are Silence.wav: not played) */
export const SND_FOOTY = { BOUNCE: 0x133, KICK: 0x104 } as const;

export const FOOTY = {
  /** the pass: speed 0.8 (0x3f4ccccd), first hop 14 high (0x41600000), phase rate 3.93 / dist (0x407b53d2) or 2 pi / dist astray, the target 0.8 in front of the receiver */
  SPEED: 0.800000011920929, HOP: 14, RATE: 3.9269142150878906, RATE_ASTRAY: 6.2831854820251465, LEAD: 0.800000011920929,
  /** after the first bounce: hops 4 high, the rate doubles; astray: height x 0.286 (0x8925d0), speed x 0.75 (0x8921f0) for 6 hops, then rolling (x 0.9 down to 0.8) */
  HOP2: 4, ASTRAY_HOP: 0.28600001335144043, ASTRAY_SPEED: 0.75, ASTRAY_HOPS: 6, ROLL_DAMP: 0.8999999761581421, ROLL_MIN: 0.800000011920929,
  /** the roll to the next kicker's feet: 0.72 (0x8925cc) */
  FEET: 0.7200000286102295,
  /** the kick clip of the kicker and the frame the ball leaves (> 5) */
  KICK_CLIP: 0x1d, KICK_FRAME: 5,
  /** the astray target (PATH node 0xbc) */
  ASTRAY_NODE: 0xbc,
  /** the spin per tick (0x8920f0) and the ground probe: from 8 up, 40 down, mask 0x2043, radius 0.08, skin 0.4 (FUN_00427139 flags 0x16) */
  SPIN: 0.20000000298023224, PROBE_UP: 8, PROBE_DOWN: 40, PROBE_MASK: 0x2043, PROBE_R: 0.07999999821186066, PROBE_SKIN: 0.4000000059604645,
  /** the kicker MOVE bits: 2 kick, 4 get ready to receive, 8 fetch the astray ball, 6 cleared on the receiver; 0x100 Pepper near (no kick) */
  M_KICK: 2, M_READY: 4, M_FETCH: 8, M_CLEAR: 6, M_PEPPER: 0x100,
  /** FUN_00538880: the astray chance: trunc(random * 10) > 10 - kicks since the last one */
  CHANCE: 10,
} as const;

/** ball states (+0xa4) */
export const BALL = { WAIT: 1, KICK: 2, ROLL: 4, FLY: 8 } as const;

export class FootballNode implements BehaviourNode {
  readonly kind = 'Footy';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  /** FUN_0053949d draws the ball 0.4 higher than its record (the renderer may add it) */
  static readonly DRAW_LIFT = 0.4000000059604645;
  private kidIdx: number[]; private readonly kidVar: number;
  /** +0x14..+0x1c the three kids, +0x20 the var whose value x speed is the "ready" distance */
  kids: (GameRecord | null)[] = [null, null, null];
  inited = false;
  /** +0x24 the kid with the ball, +0x28 the receiver */
  from = 0; to = 0;
  /** +0x2c hop phase 0..pi, +0x30 hop height */
  phase = 0; hop = 0;
  /** +0x34..+0x3c the last offset to the target (1e38 at a kick) */
  last = [1e38, 0, 1e38];
  /** +0x40..+0x48 the target, +0x4c..+0x54 the roll velocity, +0x58 phase rate, +0x5c speed, +0x80.. the kick direction (forward of +0x60) */
  target = [0, 0, 0]; roll = [0, 0, 0]; rate = 0; speed = 0; dir = [0, 0, 1];
  /** +0xa0 the "get ready" distance, +0xa4 state, +0xa5 kicks since astray, +0xa6 astray hop count (0 = a normal pass) */
  ready = 0; state: number = BALL.WAIT; sinceAstray = 0; astray = 0;
  /** the probe result: the ground under the ball (y), for tests */
  ground = 0;

  constructor(args: ArgView, attach?: Attach) {
    this.var = attach?.var ?? 2; this.mask = attach?.mask ?? 0; this.value = attach?.value ?? 0;
    this.kidIdx = [args.recIndex(0), args.recIndex(4), args.recIndex(8)];
    this.kidVar = args.i32(0xc);
  }

  /** FUN_0053955e's work with the world */
  init(w: World, rec: GameRecord) {
    if (this.inited) return;
    this.inited = true;
    this.kids = this.kidIdx.map((i) => (i >= 0 ? w.records[i] ?? null : null));
    this.state = BALL.WAIT; this.to = 0; this.from = 0;
    const k0 = this.kids[0];
    if (k0) rec.m.set(k0.m);
    this.next();
    this.astray = 0; this.sinceAstray = 0;
    rec.flags |= RF_NO_COLLIDE;
    w.vars.set(0x73, 2);   // MOVE_XXX0 = 2: the first kid kicks
  }

  private kidVar_(w: World, i: number): number {
    const k = this.kids[i]; const n = k?.ctrl?.nodes[0];
    return n ? w.vars.get(n.var) : 0;
  }
  /** FUN_004238f9(kid's controller, bits, op): op 0 or, 2 and-not on the var of its first node (vars > 2 only) */
  private kidOp(w: World, i: number, bits: number, op: number) {
    const n = this.kids[i]?.ctrl?.nodes[0];
    if (!n || n.var < 3) return;
    if (op === 0) w.vars.or(n.var, bits); else if (op === 2) w.vars.andNot(n.var, bits); else if (op === 3) w.vars.set(n.var, bits);
  }

  /** FUN_00538880: the receiver becomes the kicker; when the new receiver is kid 1 the dice decide an astray kick */
  private next() {
    this.from = this.to;
    this.to = this.to + 1;
    if (this.to > 2) this.to = 0;
    this.astray = 0;
    if (this.to === 1) {
      const r = Math.trunc(Math.random() * FOOTY.CHANCE);
      if (FOOTY.CHANCE - this.sinceAstray < r) { this.astray = 1; this.sinceAstray = 0; }
      else this.sinceAstray++;
    }
  }
  /** FUN_00538968: the receiver's position, or the astray node */
  private targetPoint(out: number[]) {
    if (this.astray === 0) { const k = this.kids[this.to]; if (k) { out[0] = k.x; out[1] = k.y; out[2] = k.z; } }
    else waypoints.nodePos(MAP_PATH, FOOTY.ASTRAY_NODE, out);
  }

  /** FUN_005389d9: the kick */
  private kick(w: World, rec: GameRecord, ball: number[]) {
    this.targetPoint(this.target);
    const k = this.kids[this.to];
    if (k) { this.target[0] += k.m[8] * FOOTY.LEAD; this.target[1] += k.m[9] * FOOTY.LEAD; this.target[2] += k.m[10] * FOOTY.LEAD; }
    const dx = ball[0] - this.target[0], dy = ball[1] - this.target[1], dz = ball[2] - this.target[2];
    const d = Math.sqrt(dz * dz + dy * dy + dx * dx);
    rec.ry = Math.atan2(dx, dz);
    const m = buildMatrix(0, rec.ry, rec.rz, 0, 0, 0);   // FUN_0043a340(+0x60, 0, ry, rz)
    this.dir = [m[8], m[9], m[10]];
    rec.m.set(buildMatrix(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z));   // FUN_0043a340 on the record (rotation; the translation is set again below)
    this.hop = FOOTY.HOP; this.phase = 0; this.speed = FOOTY.SPEED;
    const n = d / this.speed;
    this.rate = (this.astray === 0 ? FOOTY.RATE : FOOTY.RATE_ASTRAY) / n;
    this.ready = this.speed * w.vars.get(this.kidVar);
    this.kidOp(w, this.to, FOOTY.M_CLEAR, 2);
    if ((this.kidVar_(w, this.from) & 8) === 0) this.kidOp(w, this.from, FOOTY.M_KICK, 0);
    this.last = [1e38, 0, 1e38];
  }

  /** FUN_00538c4d: the roll to the feet */
  private rollTo() {
    if (this.astray !== 0) { this.roll = [0, 0, 0]; return; }
    const p = [0, 0, 0];
    this.targetPoint(p);
    const n = this.kids[this.to + 1 > 2 ? 0 : this.to + 1];
    if (n) {
      const rx = n.m[0] * FOOTY.FEET, ry = n.m[1] * FOOTY.FEET, rz = n.m[2] * FOOTY.FEET;
      p[0] = (p[0] - n.m[8] * FOOTY.FEET) - rx; p[1] = (p[1] - n.m[9] * FOOTY.FEET) - ry; p[2] = (p[2] - n.m[10] * FOOTY.FEET) - rz;
    }
    const k = this.rate / (PI_F - this.phase);
    this.roll = [(p[0] - this.target[0]) * k, 0, (p[2] - this.target[2]) * k];
  }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c;
    if (!this.inited) this.init(w, rec);
    const pos = [rec.x, rec.y, rec.z];
    const dt = w.dt;
    if (this.state & BALL.WAIT) {
      const kid = this.kids[this.from];
      const head = kid?.ctrl?.nodes[0] as (BehaviourNode & { falling?: number }) | undefined;
      if ((head?.falling ?? 0) === 0 && (this.kidVar_(w, this.from) & FOOTY.M_PEPPER) === 0) {
        this.kick(w, rec, pos);
        rec.x = pos[0]; rec.y = pos[1]; rec.z = pos[2];
        this.state = BALL.KICK;
      }
      return NODE_STOP;
    }
    if (this.state & BALL.KICK) {
      const a = this.kids[this.from]?.anim;
      if (a && a.clip === FOOTY.KICK_CLIP && a.frame > FOOTY.KICK_FRAME) {
        this.state = BALL.FLY;
        sfxAt(w, SND_FOOTY.KICK, [rec.x, rec.y, rec.z]);
      }
      return NODE_STOP;
    }
    if ((this.state & BALL.ROLL) === 0) {
      // the flight: hops towards the target until it is passed (or within one step)
      const dx = pos[0] - this.target[0], dy = pos[1] - this.target[1], dz = pos[2] - this.target[2];
      let arrived = false;
      if (Math.abs(this.last[0]) < Math.abs(dx) || Math.abs(this.last[2]) < Math.abs(dz)) arrived = true;
      else if (Math.abs(dx) <= this.speed && Math.abs(dz) <= this.speed) arrived = true;
      else if (Math.abs(dx) <= this.ready && Math.abs(dz) <= this.ready && this.astray === 0) this.kidOp(w, this.to, FOOTY.M_READY, 0);
      this.last = [dx, dy, dz];
      if (!arrived) {
        this.phase = this.rate * dt + this.phase;
        if (this.phase > PI_F) {
          if (this.astray === 0) {
            this.hop = FOOTY.HOP2; this.rate = this.rate + this.rate;
            sfxAt(w, SND_FOOTY.BOUNCE, [rec.x, rec.y, rec.z]);
          } else if (this.astray < FOOTY.ASTRAY_HOPS) {
            this.astray++;
            this.hop = this.hop * FOOTY.ASTRAY_HOP; this.rate = this.rate + this.rate; this.speed = this.speed * FOOTY.ASTRAY_SPEED;
            sfxAt(w, SND_FOOTY.BOUNCE, [rec.x, rec.y, rec.z]);
          } else {
            this.hop = 0;
            if (this.speed > FOOTY.ROLL_MIN) this.speed = this.speed * FOOTY.ROLL_DAMP;
          }
          this.phase = this.phase - PI_F;
        }
        const k = this.speed * dt;
        pos[0] -= k * this.dir[0]; pos[1] -= k * this.dir[1]; pos[2] -= k * this.dir[2];
      } else {
        pos[0] = this.target[0]; pos[2] = this.target[2];
        this.state = BALL.ROLL;
        if (this.astray !== 0) this.kidOp(w, this.to, FOOTY.M_FETCH, 0);
        this.rollTo();
      }
    } else {
      this.phase = this.rate * dt + this.phase;
      if (this.phase > PI_F) {
        this.next();
        this.state = BALL.WAIT;
        sfxAt(w, SND_FOOTY.BOUNCE, [rec.x, rec.y, rec.z]);
      }
      pos[0] += this.roll[0]; pos[1] += this.roll[1]; pos[2] += this.roll[2];
    }
    // spin, then onto the ground with the hop (FUN_00427139 flags 0x16: terrain + probe, offset (0, |sin phase| * hop, 0), written back)
    rec.rx = rec.rx - FOOTY.SPIN;
    if (rec.rx < -TWO_PI_F) rec.rx += TWO_PI_F;
    const from = [pos[0], pos[1] + FOOTY.PROBE_UP, pos[2]];
    let dy = -FOOTY.PROBE_DOWN, y: number | null = null;
    const t = w.col.terrainHeight(from[0], from[1], from[2], 4);
    if (t !== NO_GROUND && t > -1e37 && dy < t - from[1]) { y = t; dy = t - from[1]; }
    const h = w.col.probe(rec, from, [0, dy, 0], FOOTY.PROBE_MASK);
    if (h) { pos[0] = h.point[0]; y = h.point[1]; pos[2] = h.point[2]; }
    if (y !== null) { this.ground = y; pos[1] = y + Math.abs(Math.sin(this.phase)) * this.hop; }
    rec.setEuler(rec.rx, rec.ry, rec.rz, pos[0], pos[1], pos[2]);
    return NODE_STOP;
  }
}

/** FUN_005399d8: args unused; scale 0.5 */
export class FlowerNode implements BehaviourNode {
  readonly kind = 'Flower';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  /** +0x18 ticks, +0x1c scale */
  t = 0; scale = 0.5;
  private started = false;

  constructor(attach?: Attach) { this.var = attach?.var ?? 2; this.mask = attach?.mask ?? 0; this.value = attach?.value ?? 0; }

  private apply(rec: GameRecord) { rec.m.set(buildMatrix(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z, this.scale, this.scale, this.scale)); rec.scale = [this.scale, this.scale, this.scale]; }

  /** the constructor's FUN_0043a742 at scale 0.5 */
  start(rec: GameRecord) { if (!this.started) { this.started = true; this.apply(rec); } }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c;
    this.start(rec);
    if (this.stamp !== w.frame) { this.scale = 0.5; this.t = 0; }
    this.t = 1.0 * w.dt + this.t;
    if (this.t < 90) { this.scale = 0.011111111380159855 * w.dt + this.scale; this.apply(rec); }
    else if (this.t >= 180) {
      if (this.t < 360) {
        this.scale = this.scale - 0.011111100018024445 * w.dt;
        if (this.scale < 0.5) { this.scale = 0.5; this.t = 360; }
        this.apply(rec);
      } else {
        this.scale = 0.5; this.t = 0;
        this.apply(rec);
        if (this.mask === this.value) w.vars.andNot(this.var, this.mask); else w.vars.or(this.var, this.mask);
      }
    }
    return NODE_STOP;
  }
}

/** FUN_00539d44: arg +0 the height in walker units (x 8) */
export class BobNode implements BehaviourNode {
  readonly kind = 'Bob';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  /** +0x14 base y (set on the first update), +0x18 height, +0x1c state 0 up / 1 wait / 2 down / 3 wait, +0x20 offset, +0x24 wait ticks */
  base: number | null = null; height: number; state = 0; off = 0; wait = 0;
  constructor(args: ArgView, attach?: Attach) {
    this.var = attach?.var ?? 2; this.mask = attach?.mask ?? 0; this.value = attach?.value ?? 0;
    this.height = args.f32(0) * 8;
  }
  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c;
    if (this.base === null) this.base = rec.y;
    switch (this.state) {
      case 0: this.off = 0.07999999821186066 * w.dt + this.off; if (this.height < this.off) { this.state = 1; this.wait = 0; } break;
      case 1: this.wait = 1.0 * w.dt + this.wait; if (this.wait >= 90) this.state = 2; break;
      case 2: this.off = this.off - 0.07999999821186066 * w.dt; if (this.off < 0) { this.off = 0; this.state = 3; this.wait = 0; } break;
      case 3: this.wait = 1.0 * w.dt + this.wait; if (this.wait >= 90) this.state = 0; break;
    }
    if (this.state === 0 || this.state === 2) rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x, this.base + this.off, rec.z);
    return NODE_STOP;
  }
}

registerCtor(CTOR_FOOTBALL, (a) => new FootballNode(ArgView.of(a), a));
registerCtor(CTOR_FLOWER, (a) => new FlowerNode(a));
registerCtor(CTOR_BOB, (a) => new BobNode(ArgView.of(a), a));
