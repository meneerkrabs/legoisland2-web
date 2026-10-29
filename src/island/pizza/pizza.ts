// Pizza.c (Common\SGGen\c_src\Pizza.c, 0x427139..0x429e00): Pepper's pizza throw. Ported from the decompile of
//   FUN_0042887c  constructor of the three projectile records PIZ0-2 (gate PIZZAS_THROWN & 1 / 2 / 4)             -> PizzaNode
//   FUN_00427e02  its update (held in the hand until the release frame, then a straight flight with spin)         -> PizzaNode.update
//   FUN_00428520  pre-render: the result of the deferred controller sweep (FUN_00427139 / FUN_004271eb / FUN_00427233) -> PizzaNode.prerender
//   FUN_004285b0  draw: while held the record sits at bone 0xe of the player                                       -> PizzaNode.prerender (see below)
//   FUN_004289c9  destroy (frees the slot)                       FUN_00428694 / FUN_004287a0 save / load (not ported: no save of node state)
//   FUN_0042900b  constructor of the two "hand" pizzas PIZ3 / PIZ4 of eras 1-3 (gate PIZZAS_THROWN & 8 / 0x10)       -> HandPizzaNode
//   FUN_00428a5f  their update (shown between two frames of Pepper's clip 0xc, then the splat)                     -> HandPizzaNode.update
//   FUN_00428d29  their draw (bone 0x10 / 0xe of the player)     FUN_0042912f destroy, FUN_00428e15 / FUN_00428f28 save / load
//   FUN_00427c15  the prelude SGwalk runs on Space: 0 nothing, 1 throw, 2 hand-over                                -> pizzaPrelude
//   FUN_004277d0  launch: pick a free slot (or recycle the furthest pizza)                                       -> launchPizza
//   FUN_00428a0a  start the hand-over window                                                                      -> startHandOver
//   FUN_0042796e  the target in a cone in front of a record (controllers with flag 0x40)                          -> findPizzaTarget
//   FUN_00427cbf  the segment of a flight step against the targetable records                                    -> rayTargets
//   FUN_00429183  NPC side: is a pizza coming at me (1) / am I in reach of the hand-over (2)                       -> incomingPizza
//   FUN_00429556  NPC side (BrickBot): was I hit by a pizza (1) / by the hand-over (2)                             -> pizzaHitOn
//   FUN_0043d2af  segment against a vertical cylinder                                                            -> segCylinder
// The carry node FUN_00429d1b (PIZ3 in eras 0/4, CNST, RHCP, BRIK, PAPA, MAMA) is in carry.ts. Findings and constants: docs/re/m4/wp5-pizza.md.
//
// What the throw is in the game: Space in the walk node (SGwalk FUN_0042d514) asks FUN_00427c15; result 1 plays Throw_1 (walk / idle / sneak, state 0x0b) or
// Throw_2 (running, state 0x42) and launches a pizza that appears in Pepper's hand at frame 14 (4 running) of the throw clip and leaves it at frame 42
// (10): it flies 4 units per tick along Pepper's facing (or at the nearest targetable record within 200 units and about 10 degrees) for at most 144
// units, spinning about its x axis, and splats (Piza_Hit, pizzasplat.par) on the first record it hits. Targetable = controller flag 0x40, which the
// island gives only to the Brickster's bots (controller flags 0x43, eras 1-3): in era 0 the throw is a toy, the talking NPCs dodge it
// (FUN_0042477f, WP3), the deliveries are made by talking (generic NPC FUN_00425c13, delivery.ts).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { CF_ENABLED, CF_TARGETABLE, NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Hit } from '../../game/collision.ts';
import { V } from '../../game/vars.ts';
import { ST, walkHooks } from '../../game/walk.ts';
import { registerCtor } from '../../game/setup.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { tryCtx } from '../ctx.ts';
import { PI_F, TWO_PI_F, cutsceneActive, particles, placeAtBone, sfx, sfxAt, wrapOnce } from './common.ts';

/** constructor addresses */
export const CTOR_PIZZA = 0x42887c, CTOR_HAND_PIZZA = 0x42900b;

/** sound table ids (FUN_004b0f16 loads them into DAT_009da960 / DAT_009da984 / DAT_009da8f0) */
export const SND_PIZZA = { THROW_WALK: 0xff /* Throw_1.wav */, THROW_RUN: 0x2bf /* Throw_2.wav */, HIT: 0x102 /* Piza_Hit.wav */ } as const;
export const FX_THROW = 'throwpizza.par', FX_SPLAT = 'pizzasplat.par';

export const PIZZA = {
  /** 0x892080: flight step per tick */
  STEP: 4.0,
  /** 0x8920ec: range of a throw */
  RANGE: 144.0,
  /** 0x8920f0: spin about x per tick (radians) */
  SPIN: 0.2,
  /** 0x892028: the NPC segment covers [pos - step, pos + step] (delta = 2 * step) */
  SEG: 2.0,
  /** FUN_00427139(..., mask 3, radius 1.0, skin 0.1, flags 0x108): the deferred wall / ground sweep of a flight step */
  PROBE_MASK: 3, PROBE_RADIUS: 1.0, PROBE_SKIN: 0.1,
  /** FUN_00427cbf: the segment against one targetable record (mask 3, radius 1, skin 1) */
  RAY_MASK: 3, RAY_RADIUS: 1.0, RAY_SKIN: 1.0,
  /** FUN_0042796e: search radius^2 (40000 = 200 units), the aim lift (0x8920e0), the distance bands (0x8adf20 / 0x8adf24) with their factors (0.5 / 0.5) */
  TARGET_RANGE_SQ: 40000, AIM_LIFT: 2.666640043258667, NEAR_SQ: 1600, MID_SQ: 6400, NEAR_F: 0.5, MID_F: 0.5,
  /** FUN_00427c15 cone (0x3f490f94 = 45 deg) and the hand-over distance^2 (0x8920e4 = 4.8^2) */
  PRELUDE_CONE: 0.7853939533233643, HAND_DIST_SQ: 23.040000915527344,
  /** FUN_00427e02 release cone (0x3e32b884 = 10 deg) */
  RELEASE_CONE: 0.1745319962501526,
  /** FUN_004277d0 arguments of SGwalk: (start, release) frame of the throw clip: walk / sneak / idle (clip 0x0b), run (clip 0x42) */
  FRAMES_WALK: [14, 42] as const, FRAMES_RUN: [4, 10] as const,
  /** FUN_00428a0a(10, 0x28): the hand-over window of clip 0x0c; the .data defaults DAT_008adf4a = 5, DAT_008adf48 = 30 */
  HAND_WINDOW: [10, 40] as const, HAND_WINDOW_INIT: [5, 30] as const,
  /** the bones: projectile in the hand 0xe, hand pizzas 0x10 (first) / 0xe (second); offset (0, -1, 0) */
  BONE_THROW: 0xe, BONE_HAND1: 0x10, BONE_HAND2: 0xe, HAND_OFF: [0, -1, 0] as const,
  /** FUN_00429183: incoming check box (8 per axis), look-ahead (dir * 10 * 4), cylinder radius / height of the NPC (4 / 5.2), hand reach (0x8adf4c), facing (0x8920f4) */
  INCOMING_BOX: 8, LOOKAHEAD: 40, CYL_R: 4.0, CYL_H: 5.199999809265137, HAND_REACH_SQ: 23.040000915527344, FACING: 0.7853939533233643, HAND_LIFT: 4,
} as const;

/** story nodes where FUN_00427c15 refuses (0x38..0x3c) or always throws without a target (0x35..0x37) */
const NO_THROW = [0x38, 0x3c] as const, BLIND_THROW = [0x35, 0x3c] as const;

// ---------------------------------------------------------------------------------------------------------------- the pizza globals
/** DAT_009da874..: the projectile slots, DAT_009da88c..: the hand pizzas, DAT_009da870: the hand-over target, DAT_008adf48 / 4a: the window */
export class PizzaSystem {
  /** DAT_009da874 / DAT_009da880 (record + node of slot i = the bit 1 << i of PIZZAS_THROWN) */
  slots: (PizzaNode | null)[] = [null, null, null];
  /** DAT_009da88c / 890 + 894 / 898: [0] the first constructed (bone 0x10, owns the splat), [1] the second (bone 0xe) */
  hand: (HandPizzaNode | null)[] = [null, null];
  /** DAT_009da870 */
  target: GameRecord | null = null;
  /** DAT_008adf4a / DAT_008adf48 */
  handStart: number = PIZZA.HAND_WINDOW_INIT[0]; handEnd: number = PIZZA.HAND_WINDOW_INIT[1];
  records: GameRecord[] = [];
}

const KEY = 'pizza';
/**
 * The pizza globals of a world. The constructors of the original register themselves in globals; the factories here do not see the world, so the
 * system is built on first use by scanning the controllers for the nodes (in record order = the attach order of the set-up code).
 */
export function pizzaSystem(w: World): PizzaSystem {
  let s = w.ext.get(KEY) as PizzaSystem | undefined;
  if (s && s.records === w.records) return s;
  s = new PizzaSystem();
  s.records = w.records;
  for (const rec of w.records) {
    for (const n of rec.ctrl?.nodes ?? []) {
      if (n instanceof PizzaNode) { n.rec = rec; if (n.slot >= 0 && !s.slots[n.slot]) s.slots[n.slot] = n; }
      else if (n instanceof HandPizzaNode) {
        n.rec = rec;
        if (!s.hand[0]) { s.hand[0] = n; n.primary = true; n.bone = PIZZA.BONE_HAND1; }
        else if (!s.hand[1]) { s.hand[1] = n; n.primary = false; n.bone = PIZZA.BONE_HAND2; }
      }
    }
  }
  w.ext.set(KEY, s);
  const c = tryCtx(w);
  if (c) c.shared.pizza = s;
  return s;
}

const focusOf = (w: World): GameRecord | null => w.focus;

// ---------------------------------------------------------------------------------------------------------------- targeting
export interface PizzaTarget { rec: GameRecord; dir: [number, number, number]; distSq: number }

/**
 * FUN_0042796e(self, outDir, outRec, cone): the nearest record (3D distance^2 <= 40000) that is visible and has an enabled, targetable controller
 * (flags 2 and 0x40) whose bearing differs from self's yaw by at most `cone` (the difference halved under 80 units). outDir = the normalised vector
 * to it lifted by 2.67. Side effect of the original: self's yaw is wrapped into [-pi, pi] (written back).
 */
export function findPizzaTarget(w: World, self: GameRecord, cone: number): PizzaTarget | null {
  let best: GameRecord | null = null, bestSq: number = PIZZA.TARGET_RANGE_SQ, bx = 0, by = 0, bz = 0;
  const sx = self.x, sy = self.y, sz = self.z;
  for (const r of w.records) {
    const c = r.ctrl;
    if (!r.enabled || !c || (c.flags & CF_TARGETABLE) === 0 || (c.flags & CF_ENABLED) === 0) continue;
    const dx = r.x - sx, dy = r.y - sy, dz = r.z - sz;
    const dsq = dz * dz + dy * dy + dx * dx;
    if (dsq > bestSq) continue;
    const bearing = wrapOnce(Math.atan2(dx, dz));
    self.ry = wrapOnce(self.ry);
    let diff = Math.abs(self.ry - bearing);
    if (diff > PI_F) diff = TWO_PI_F - diff;
    if (dsq < PIZZA.NEAR_SQ) diff *= PIZZA.NEAR_F;
    else if (dsq < PIZZA.MID_SQ) diff *= PIZZA.MID_F;
    if (diff <= cone) { best = r; bestSq = dsq; bx = dx; by = dy + PIZZA.AIM_LIFT; bz = dz; }
  }
  if (!best) return null;
  const l = Math.sqrt(bx * bx + by * by + bz * bz);
  if (l !== 0) { bx /= l; by /= l; bz /= l; }   // FUN_0043cec0
  return { rec: best, dir: [bx, by, bz], distSq: bestSq };
}

/** FUN_00427cbf: the segment (from, delta) against every record with a targetable controller (FUN_00441b10, mask 3, radius 1, skin 1); the nearest hit */
export function rayTargets(w: World, from: readonly number[], delta: readonly number[]): Hit | null {
  let best: Hit | null = null, bestD = 1e38;
  for (const r of w.records) {
    const c = r.ctrl;
    if (!c || (c.flags & CF_TARGETABLE) === 0) continue;
    const h = w.col.rayRecord(r, from, delta, PIZZA.RAY_MASK, PIZZA.RAY_RADIUS, PIZZA.RAY_SKIN);
    if (!h) continue;
    const d = Math.hypot(h.point[0] - from[0], h.point[1] - from[1], h.point[2] - from[2]);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------- Space in the walk node
export const PRELUDE = { NONE: 0, THROW: 1, HAND: 2 } as const;

/** FUN_00427c15(player): 0 = no pizza system / story nodes 0x38..0x3c, 1 = throw, 2 = hand-over (target closer than 4.8 within 45 degrees; sets DAT_009da870) */
export function pizzaPrelude(w: World, player: GameRecord): number {
  const s = pizzaSystem(w);
  if (!s.slots[0]) return PRELUDE.NONE;
  const node = w.vars.get(V.FSM_CURRENT_STATE);
  if (node >= NO_THROW[0] && node <= NO_THROW[1]) return PRELUDE.NONE;
  if (node >= BLIND_THROW[0] && node <= BLIND_THROW[1]) return PRELUDE.THROW;
  const t = findPizzaTarget(w, player, PIZZA.PRELUDE_CONE);
  if (!t) return PRELUDE.THROW;
  // the original tests DAT_009da880 (slot 0's node, always set here); a hand-over without the hand pizzas (eras 0 / 4) would dereference
  // DAT_009da894 = 0 in FUN_00428a0a: the port throws instead (docs/re/m4/wp5-pizza.md)
  if (t.distSq >= PIZZA.HAND_DIST_SQ || !s.slots[0] || !s.hand[0]) return PRELUDE.THROW;
  s.target = t.rec;
  const c = tryCtx(w);
  if (c) c.shared.pizzaTarget = t.rec;
  return PRELUDE.HAND;
}

/**
 * FUN_004277d0(startFrame, releaseFrame): set the first free bit of PIZZAS_THROWN (the node of that slot starts running) with the frames of the
 * player's clip at which the pizza appears in the hand and leaves it. With all three in use, the one that travelled furthest is recycled instead
 * (hidden and reset) and no pizza is launched this time. Returns the slot launched (-1 = recycled / none).
 */
export function launchPizza(w: World, startFrame: number, releaseFrame: number): number {
  const s = pizzaSystem(w);
  const thrown = w.vars.get(V.PIZZAS_THROWN);
  let bestT = -1, bestI = -1, bestBit = 0;
  for (let i = 0, bit = 1; i < 3; i++, bit <<= 1) {
    const n = s.slots[i];
    if ((bit & thrown) === 0) {
      w.vars.or(V.PIZZAS_THROWN, bit);
      if (n) { n.startFrame = startFrame; n.releaseFrame = releaseFrame; n.speed = 16.0; }
      return i;
    }
    if (n && bestT < n.travelled) { bestT = n.travelled; bestI = i; bestBit = bit; }
  }
  if (bestI !== -1) {
    const n = s.slots[bestI]!;
    if (n.rec) n.rec.flags &= ~RF_ENABLED;
    n.stamp = 0xffffffff; n.target = null;
    w.vars.andNot(V.PIZZAS_THROWN, bestBit);
    n.count = 0; n.hit = null; n.clip = -1;
    if (n.rec) { particles(w, FX_SPLAT, 1, n.rec); particles(w, FX_THROW, 1, n.rec); }
  }
  return -1;
}

/** FUN_00428a0a(start, end): the frame window of the hand-over clip; sets the gate bits of both hand pizzas */
export function startHandOver(w: World, start: number, end: number) {
  const s = pizzaSystem(w);
  s.handEnd = end; s.handStart = start;
  for (const h of s.hand) if (h) w.vars.or(h.var, h.value);
}

/**
 * The Space branch of FUN_0042d514 (0x42dad1..0x42dbe7): the prelude, then by the walk state: sneak / walk / idle -> state 0x0b + Throw_1 + launch(14, 42);
 * run / run left / run right -> 0x42 + Throw_2 + launch(4, 10); other states: nothing. Hand-over -> state 0x0c + window (10, 40). Returns the next state.
 */
export function walkSpace(w: World, player: GameRecord, state: number): number {
  const r = pizzaPrelude(w, player);
  if (r === PRELUDE.THROW) {
    switch (state) {
      case ST.SNEAK: case ST.WALK: case ST.IDLE:
        sfx(w, SND_PIZZA.THROW_WALK); launchPizza(w, PIZZA.FRAMES_WALK[0], PIZZA.FRAMES_WALK[1]); return ST.THROW;
      case ST.RUN: case ST.RUNLEFT: case ST.RUNRIGHT:
        sfx(w, SND_PIZZA.THROW_RUN); launchPizza(w, PIZZA.FRAMES_RUN[0], PIZZA.FRAMES_RUN[1]); return ST.THROWRUN;
      default: return 0;
    }
  }
  if (r === PRELUDE.HAND) { startHandOver(w, PIZZA.HAND_WINDOW[0], PIZZA.HAND_WINDOW[1]); return ST.THROW2; }
  return 0;
}
walkHooks.space = walkSpace;

// ---------------------------------------------------------------------------------------------------------------- the projectile
/** FUN_0042887c: node 0x50 bytes, handler table 0x8adf08 { FUN_00427e02, FUN_00428520, FUN_004289c9, FUN_004285b0, load FUN_004287a0, save FUN_00428694 } */
export class PizzaNode implements BehaviourNode {
  readonly kind = 'Pizza';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  /** the record (bound by pizzaSystem) */
  rec: GameRecord | null = null;
  /** +0x1c: slot = index of the lowest bit of the mask among 1 / 2 / 4 (-1: the original leaves the slot unregistered) */
  readonly slot: number;
  /** +0x20..+0x28: flight direction (unit) */
  dir: [number, number, number] = [0, 0, 1];
  /** +0x2c: the record aimed at on release (FUN_0042796e), null = straight */
  target: GameRecord | null = null;
  /** +0x30: the record hit (a targetable one, or whatever the sweep hit) */
  hit: GameRecord | null = null;
  /** +0x34: 16.0 written by the launch (never read) */
  speed = 0;
  /** +0x38 / +0x3c: frames of the player's clip: appear in the hand / leave it */
  startFrame = 0; releaseFrame = 0;
  /** +0x40: the in-flight bit of PIZZAS_THROWN (mask << 8) */
  flightBit = 0;
  /** +0x42: count-down of the end states (6 hit, 5 splat, 4 vanish ... 1 done) */
  count = 0;
  /** +0x44: distance flown */
  travelled = 0;
  /** +0x48: in the hand; +0x49: a sweep is pending for the pre-render */
  held = false; probePending = false;
  /** +0x4a: the player's clip when the pizza appeared (-1 = none) */
  clip = -1;
  /** +0x4c: spin angle (x) */
  spin = 0;
  /** the result of the deferred sweep (controller +0x64 / +0x2c) */
  probe: Hit | null = null;

  constructor(attach?: Pick<Attach, 'var' | 'mask' | 'value'>) {
    this.var = attach?.var ?? V.PIZZAS_THROWN; this.mask = attach?.mask ?? 0; this.value = attach?.value ?? 0;
    let slot = -1;
    for (let i = 0, b = 1; i < 3; i++, b <<= 1) if ((this.mask & 0xffff & b) !== 0) { slot = i; break; }
    this.slot = slot;
  }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c;
    this.rec = rec;
    const P = focusOf(w);
    const pa = P?.anim ?? null;
    if (this.stamp !== w.frame) {
      // first tick of a throw: wait for the start frame, then appear in the hand
      this.held = true;
      if ((pa?.frame ?? 0) < this.startFrame) return NODE_NONE;
      this.clip = pa ? pa.clip : -1;
      this.flightBit = (this.mask << 8) & 0xffff;
      this.hit = null; this.count = 0; this.probePending = false;
      rec.flags |= RF_ENABLED;
      if (P) rec.m.set(P.m);
      this.travelled = 0; this.hit = null; this.spin = 0;
    }
    if (this.count === 0) rec.flags |= RF_ENABLED;
    const x0 = rec.x, y0 = rec.y, z0 = rec.z;
    const dt = w.dt;
    if (this.count === 0) {
      if (!this.held) {
        if (this.hit === null) {
          this.travelled = PIZZA.STEP * dt + this.travelled;
          if (this.travelled <= PIZZA.RANGE) this.flightStep(w, rec, x0, y0, z0, true);
          else this.count = 4;
        } else this.count = 5;
      } else {
        const clip = pa ? pa.clip : -1;
        if ((this.clip < 1 || clip === this.clip) && !cutsceneActive(w)) {
          if ((pa?.frame ?? 0) >= this.releaseFrame && P) {
            // release: along the player's facing, or at a target in a 10 degree cone
            this.held = false;
            this.dir = [P.m[8], P.m[9], P.m[10]];
            rec.ry = P.ry;
            this.target = null;
            const t = findPizzaTarget(w, rec, PIZZA.RELEASE_CONE);
            if (t) { this.dir = t.dir; this.target = t.rec; }
            particles(w, FX_THROW, 0, rec);
            w.vars.or(this.var, this.flightBit);
            particles(w, FX_THROW, 2, rec);
            this.flightStep(w, rec, x0, y0, z0, false);
            this.travelled = PIZZA.STEP * dt + this.travelled;
          }
        } else {
          // the throw clip was interrupted (or a cutscene started): drop the pizza
          rec.flags &= ~RF_ENABLED;
          this.stamp = 0xffffffff;
          this.target = null;
          w.vars.andNot(V.PIZZAS_THROWN, this.mask);
          this.count = 0; this.hit = null; this.clip = -1;
        }
      }
    } else this.count--;
    if (this.count === 1) {
      if (this.var > 2) w.vars.andNot(this.var, this.mask);
      this.count = 0; this.hit = null;
      particles(w, FX_SPLAT, 1, rec); particles(w, FX_THROW, 1, rec);
    } else if (this.count === 4) {
      if (this.var > 2) w.vars.andNot(this.var, this.flightBit);
      particles(w, FX_SPLAT, 1, rec);
      rec.flags &= ~RF_ENABLED;
    } else if (this.count === 5) {
      if (this.var > 2) w.vars.andNot(this.var, this.flightBit);
      particles(w, FX_SPLAT, 0, rec); particles(w, FX_SPLAT, 2, rec); particles(w, FX_THROW, 1, rec);
      sfxAt(w, SND_PIZZA.HIT, [rec.x, rec.y, rec.z]);
      rec.flags &= ~RF_ENABLED;
    }
    return NODE_STOP;
  }

  /** one step of 4 units with the spin; `test`: the flight steps test the segment [pos - step, pos + step] (the release step does not) */
  private flightStep(w: World, rec: GameRecord, x0: number, y0: number, z0: number, test: boolean) {
    const k = PIZZA.STEP * w.dt;
    const sx = k * this.dir[0], sy = k * this.dir[1], sz = k * this.dir[2];
    rec.rx = this.spin;
    this.spin = this.spin - PIZZA.SPIN;
    rec.setEuler(rec.rx, rec.ry, rec.rz, x0 + sx, y0 + sy, z0 + sz);
    particles(w, FX_THROW, 0, rec);
    if (!test) return;
    const from = [x0 - sx, y0 - sy, z0 - sz];
    const delta = [PIZZA.SEG * w.dt * sx, PIZZA.SEG * w.dt * sy, PIZZA.SEG * w.dt * sz];
    const h = rayTargets(w, from, delta);
    this.hit = h ? h.rec : null;
    if (!h) {
      // FUN_00427139: the controller sweep (run by FUN_00427233 between the passes), read back in the pre-render
      this.probe = w.col.sweep(rec, from, delta, PIZZA.PROBE_MASK, PIZZA.PROBE_RADIUS, PIZZA.PROBE_SKIN);
      this.probePending = true;
    } else {
      rec.x = h.point[0]; rec.y = h.point[1]; rec.z = h.point[2];
      this.count = 6;
    }
  }

  /** FUN_00428520 (+ the draw hook FUN_004285b0 while held: the port has no draw pass for nodes, the record follows bone 0xe here) */
  prerender(w: World, rec: GameRecord, _c: Controller) {
    void _c;
    if (rec.enabled && this.probePending) {
      const h = this.probe;
      if (h) { this.hit = h.rec; rec.x = h.point[0]; rec.y = h.point[1]; rec.z = h.point[2]; this.count = 6; }
      this.probePending = false;
    }
    this.probe = null;
    if (this.held && rec.enabled) { const P = focusOf(w); if (P) placeAtBone(rec, P, PIZZA.BONE_THROW, PIZZA.HAND_OFF); }
  }

  /** FUN_004289c9 */
  destroy(w: World) {
    const s = w.ext.get(KEY) as PizzaSystem | undefined;
    if (s && this.slot >= 0 && s.slots[this.slot] === this) s.slots[this.slot] = null;
  }
}

// ---------------------------------------------------------------------------------------------------------------- the hand pizzas (eras 1-3)
/** FUN_0042900b: node 0x34 bytes, handler table 0x8adf30 { FUN_00428a5f, FUN_00428d16 (nop), FUN_0042912f, FUN_00428d29, load FUN_00428f28, save FUN_00428e15 } */
export class HandPizzaNode implements BehaviourNode {
  readonly kind = 'PizzaHand';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  rec: GameRecord | null = null;
  /** first constructed: owns the splat emitter (+0x14; the second has 0xbabababa) */
  primary = true;
  /** +0x1c: bone of the player (0x10 first, 0xe second) */
  bone: number = PIZZA.BONE_HAND1;
  /** +0x20: the NPC in reach (FUN_00429183 writes it), +0x28 its distance^2 */
  reached: GameRecord | null = null; reachedSq = 1e38;
  /** +0x2c: done */
  done = false;
  /** +0x30: the player's frame (truncated), -1 after the end */
  frame = 0;

  constructor(attach?: Pick<Attach, 'var' | 'mask' | 'value'>) {
    this.var = attach?.var ?? V.PIZZAS_THROWN; this.mask = attach?.mask ?? 0; this.value = attach?.value ?? 0;
  }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c;
    this.rec = rec;
    const s = pizzaSystem(w);
    const P = focusOf(w);
    const pa = P?.anim ?? null;
    if (this.stamp === w.frame) {
      if ((pa ? pa.clip : -1) !== ST.THROW2) this.done = true;
    } else { this.reached = null; this.reachedSq = 1e38; }   // 0x7e967699
    if (!this.done) {
      this.frame = Math.trunc(pa?.frame ?? 0);
      if (this.frame < s.handStart) return NODE_NONE;
      rec.flags |= RF_ENABLED;
      particles(w, FX_THROW, 2, rec);
      particles(w, FX_THROW, 0, rec);
      if (s.handEnd < this.frame) {
        rec.flags &= ~RF_ENABLED;
        this.done = true;
        if (this.primary) {
          sfxAt(w, SND_PIZZA.HIT, [rec.x, rec.y, rec.z]);
          const a = s.hand[0]?.rec, b = s.hand[1]?.rec;
          const mid: [number, number, number] = a && b ? [(a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5] : [rec.x, rec.y, rec.z];
          particles(w, FX_SPLAT, 0, rec, mid);
          particles(w, FX_SPLAT, 2, rec, mid);
        }
        particles(w, FX_THROW, 1, rec);
      }
    } else {
      this.done = false;
      rec.flags &= ~RF_ENABLED;
      s.target = null;
      w.vars.andNot(this.var, this.value);
      if (this.primary) particles(w, FX_SPLAT, 1, rec);
      this.frame = -1;
    }
    return NODE_STOP;
  }

  /** FUN_00428d29 (draw hook; run here since the port has no node draw pass) */
  prerender(w: World, rec: GameRecord, _c: Controller) {
    void _c;
    if (!rec.enabled) return;
    const P = focusOf(w);
    if (P) placeAtBone(rec, P, this.bone, PIZZA.HAND_OFF);
  }

  /** FUN_0042912f */
  destroy(w: World) {
    const s = w.ext.get(KEY) as PizzaSystem | undefined;
    if (!s) return;
    for (let i = 0; i < 2; i++) if (s.hand[i] === this) s.hand[i] = null;
  }
}

// ---------------------------------------------------------------------------------------------------------------- NPC-side queries
/**
 * FUN_0043d2af(a, b, base, r, h): the segment a -> b against the vertical cylinder of radius r from base.y to base.y + h. Returns the segment parameter of
 * the contact, -1 for none. Ported with the original's slip: the entry test from below uses (b - a).xz * t - base.xz without + a.xz.
 */
export function segCylinder(a: readonly number[], b: readonly number[], c: readonly number[], r: number, h: number): number {
  const top = h + c[1];
  if (a[1] < c[1]) {
    if (b[1] < c[1]) return -1;
    const t = (top - a[1]) / (b[1] - a[1]);
    const ex = (b[0] - a[0]) * t - c[0], ez = (b[2] - a[2]) * t - c[2];
    if (ez * ez + ex * ex < r * r) return t;
  }
  if (top < a[1]) {
    if (top < b[1]) return -1;
    const t = (top - a[1]) / (b[1] - a[1]);
    const ex = ((b[0] - a[0]) * t + a[0]) - c[0], ez = ((b[2] - a[2]) * t + a[2]) - c[2];
    if (ez * ez + ex * ex < r * r) return t;
  }
  const fx = a[0] - c[0], fz = a[2] - c[2], dx = b[0] - a[0], dz = b[2] - a[2];
  const aa = dz * dz + dx * dx;
  const inv = 1 / (2 * aa);
  let bb = dz * fz + dx * fx; bb = bb + bb;
  const disc = bb * bb - aa * ((fz * fz + fx * fx) - r * r) * 4;
  if (disc <= 0) return -1;
  const sq = Math.sqrt(disc);
  let t = (-bb - sq) * inv;
  const t2 = (-bb + sq) * inv;
  if (t < 0 || t2 < t) t = t2;
  const y = (b[1] - a[1]) * t + a[1];
  return y < c[1] || top < y ? -1 : t;
}

/**
 * FUN_00429183(npc, outHeight): 1 = a flying pizza will pass through the NPC's cylinder within the next 40 units (height = where), 2 = the hand-over
 * is in its last 5 frames and the NPC is within 4.8 units facing Pepper (or is the target; the nearest targetable such NPC becomes the hand pizza's
 * `reached`), height = Pepper's y + 4; 0 = nothing. The NPC dodge logic (FUN_0042477f, WP3) calls it.
 */
export function incomingPizza(w: World, npc: GameRecord): { kind: number; height: number } {
  const thrown = w.vars.get(V.PIZZAS_THROWN);
  if (thrown === 0) return { kind: 0, height: 0 };
  const s = pizzaSystem(w);
  const ctrl = npc.ctrl;
  const nx = npc.x, ny = npc.y, nz = npc.z;
  for (let i = 0; i < 3; i++) {
    const n = s.slots[i], r = n?.rec;
    if (!n || !r || !r.enabled || n.held) continue;
    const px = r.x, py = r.y, pz = r.z;
    if (Math.abs(nx - px) > PIZZA.INCOMING_BOX || Math.abs(nz - pz) > PIZZA.INCOMING_BOX || Math.abs(ny - py) > PIZZA.INCOMING_BOX) continue;
    const b = [n.dir[0] * PIZZA.LOOKAHEAD + px, n.dir[1] * PIZZA.LOOKAHEAD + py, n.dir[2] * PIZZA.LOOKAHEAD + pz];
    const t = segCylinder([px, py, pz], b, [nx, ny, nz], PIZZA.CYL_R, PIZZA.CYL_H);
    if (t >= 0) return { kind: 1, height: (b[1] - py) * t + py };
  }
  const h = s.hand[0];
  if (h && h.rec && h.rec.enabled && ctrl) {
    if (ctrl.distSq > PIZZA.HAND_REACH_SQ) return { kind: 0, height: 0 };
    if (s.handEnd - 5 < h.frame && (thrown & h.mask) !== 0) {
      const P = focusOf(w);
      if (s.target !== npc && P) {
        const bearing = wrapOnce(Math.atan2(P.x - nx, P.z - nz));
        let d = Math.abs(npc.ry - bearing);
        if (d > PI_F) d = TWO_PI_F - d;
        if (d > PIZZA.FACING) return { kind: 0, height: 0 };
      }
      if ((ctrl.flags & CF_TARGETABLE) !== 0 && ctrl.distSq < h.reachedSq) { h.reached = npc; h.reachedSq = ctrl.distSq; }
      return { kind: 2, height: (P?.y ?? ny) + PIZZA.HAND_LIFT };
    }
  }
  return { kind: 0, height: 0 };
}

/** FUN_00429556(npc): story node < 0x34: 1 = a projectile's hit record is the NPC, 2 = the hand pizza reached it; 0 otherwise (BrickBot FUN_00531d45.., WP3) */
export function pizzaHitOn(w: World, npc: GameRecord): number {
  if (w.vars.get(V.FSM_CURRENT_STATE) >= 0x34) return 0;
  const s = pizzaSystem(w);
  for (const n of s.slots) if (n && n.hit === npc) return 1;
  const h = s.hand[0];
  return h && h.rec && h.rec.enabled && h.reached === npc ? 2 : 0;
}

/** the node of the projectile slot `i` (tests / HUD) */
export const pizzaSlot = (w: World, i: number) => pizzaSystem(w).slots[i] ?? null;

registerCtor(CTOR_PIZZA, (a) => new PizzaNode(a));
registerCtor(CTOR_HAND_PIZZA, (a) => new HandPizzaNode(a));
