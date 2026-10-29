// z41MAP: the behaviour nodes of the pizza-making mini-game, ported from the zone code of the original (0x811abc-0x81fd64, constructors listed in
// docs/re/m3/z41MAP.md). DOM-free: everything runs on the world's records, so node tests can drive it with scripted input.
//   Pepper  0x816ba0 (update 0x816562)  picks a topping out of one of the four pots, throws it; camera 0x816220
//   Papa    0x8132e0 (update 0x812399)  swings the pizza base, round state machine, score and result (0x812dbb)
//   mama    0x81611f (update 0x815f30)  Pepper's mother cheering at the side
//   Topping 0x815e1a (update 0x815576)  the toppings in the air (10 slots) and what they hit
//   citizen 0x81483d (update 0x8140cc)  the five Ogel citizens in the queue at the counter
//   Slug    0x81529f (update 0x814f6e)  the slug that crawls along the front
//   Planet  0x814b0f (draw   0x814964)  the rotating planet and galaxy in the sky
// The node's "draw hook" work (placing the record's matrix before the draw) is done at the end of `update`: the renderer reads the record matrices.
import { parseBlk, sampleBlk } from '../../formats/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import type { Archive } from '../../formats/archive.ts';
import { AnimInstance, CLIP_LOOP, POSE_SNAP } from '../../game/anim.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { registerCtor } from '../../game/setup.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import {
  SND, PICK_SOUND, HIT_SOUND, PICKS, TOPPINGS_PER_ROUND, ROUNDS, POINTS_MATCH, POINTS_ROUND, POINTS_CITIZEN, GAUGE_START, GAUGE_DECAY,
  SLOT_POS, CITIZEN_RATES, CITIZEN_CLIPS, CAM_LOOK, CAM_EYE, CAM_EASE, HAND_ROT_Z, HAND_OFFSET, TOPPING_HAND_OFFSET, finishScore,
} from './rules.ts';

/** constructor addresses of the zone (the extraction's attaches, docs/re/zone-setup.md) */
export const CTOR = { PEPPER: 0x816ba0, PAPA: 0x8132e0, MAMA: 0x81611f, TOPPING: 0x815e1a, SLUG: 0x81529f, PLANET: 0x814b0f, CITIZEN: 0x81483d } as const;

const TWO_PI = Math.fround(2 * Math.PI), PI = Math.fround(Math.PI);
const f32 = Math.fround;

// ------------------------------------------------------------------------------------------------ matrix helpers of the engine

const identity = (): Float32Array => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
/** x87 in 24-bit precision (the original's control word 0x7f): every + - * / rounds to float32 */
const mulf = (a: number, b: number) => f32(a * b), addf = (a: number, b: number) => f32(a + b), subf = (a: number, b: number) => f32(a - b);
/** FUN_0043ad29: rotate the columns 0 and 2 (about Y), one rounding per operation as the asm does */
function rotY(m: Float32Array, a: number) {
  const c = f32(Math.cos(a)), s = f32(Math.sin(a));
  const a0 = m[0], a4 = m[4], a8 = m[8];
  m[0] = addf(mulf(s, m[2]), mulf(c, m[0])); m[4] = addf(mulf(s, m[6]), mulf(c, m[4])); m[8] = addf(mulf(s, m[10]), mulf(c, m[8]));
  m[2] = subf(mulf(c, m[2]), mulf(s, a0)); m[6] = subf(mulf(c, m[6]), mulf(s, a4)); m[10] = subf(mulf(c, m[10]), mulf(s, a8));
}
/** FUN_0043af16: rotate the columns 0 and 1 (about Z, opposite sense to the Euler builder) */
function rotZ(m: Float32Array, a: number) {
  const c = f32(Math.cos(a)), s = f32(Math.sin(a));
  const a0 = m[0], a4 = m[4], a8 = m[8];
  m[0] = addf(mulf(s, m[1]), mulf(c, m[0])); m[4] = addf(mulf(s, m[5]), mulf(c, m[4])); m[8] = addf(mulf(s, m[9]), mulf(c, m[8]));
  m[1] = subf(mulf(c, m[1]), mulf(s, a0)); m[5] = subf(mulf(c, m[5]), mulf(s, a4)); m[9] = subf(mulf(c, m[9]), mulf(s, a8));
}
/** FUN_0043a9e5(dst, b, s): dst = s * b for affine 3x4 matrices, ((s0 b0 + s1 b4) + s2 b8) per element, the translation row + b's (asm order, every operation rounded) */
export function mulA(s: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const o = new Float32Array(16);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 4 + c] = addf(addf(mulf(s[r * 4], b[c]), mulf(s[r * 4 + 1], b[4 + c])), mulf(s[r * 4 + 2], b[8 + c]));
  for (let c = 0; c < 3; c++) o[12 + c] = addf(addf(addf(mulf(s[12], b[c]), mulf(s[13], b[4 + c])), mulf(s[14], b[8 + c])), b[12 + c]);
  o[15] = 1;
  return o;
}
/** FUN_0043ab72(out, M, v): v * M with the same operation order as mulA's translation row */
function toWorldExact(m: ArrayLike<number>, v: ArrayLike<number>): number[] {
  return [0, 1, 2].map((c) => addf(addf(addf(mulf(v[0], m[c]), mulf(v[1], m[4 + c])), mulf(v[2], m[8 + c])), m[12 + c]));
}
/** FUN_0043a4a1 / 0043a5e4: the 3x3 part from Euler angles with the original's float32 operations (cos / sin rounded, every product and sum rounded) */
function eulerExact(rx: number, ry: number, rz: number): Float32Array {
  const c1 = f32(Math.cos(rx)), s2 = f32(Math.sin(rx)), c3 = f32(Math.cos(ry)), s4 = f32(Math.sin(ry)), c5 = f32(Math.cos(rz)), s6 = f32(Math.sin(rz));
  const m = new Float32Array(16);
  m[0] = mulf(c5, c3); m[1] = mulf(s6, c3); m[2] = -s4;
  m[4] = subf(mulf(mulf(c5, s4), s2), mulf(s6, c1)); m[5] = addf(mulf(c5, c1), mulf(mulf(s6, s4), s2)); m[6] = mulf(c3, s2);
  m[8] = addf(mulf(s6, s2), mulf(mulf(c5, s4), c1)); m[9] = subf(mulf(mulf(s6, s4), c1), mulf(c5, s2)); m[10] = mulf(c3, c1);
  m[15] = 1;
  return m;
}
function setRotation(m: Float32Array, rx: number, ry: number, rz: number) {
  const t = eulerExact(rx, ry, rz);
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m[i] = t[i];
}
const setPos = (m: Float32Array, x: number, y: number, z: number) => { m[12] = x; m[13] = y; m[14] = z; };

// ------------------------------------------------------------------------------------------------ shared state (the zone's globals)

/** one of the ten topping slots (0x70 bytes at node + 0x1c + 0x70 i) */
export class ToppingSlot {
  /** +0x00: 0 free, 1 in Pepper's hand, 2 flying, 3 flying past the pizza, 4 splat (12 ticks) */
  state = 0;
  /** +0x04: 0 until Pepper has the topping in her hand (frame 17 of the pick-up clip), then 1 */
  active = 0;
  /** +0x08: the topping type (1 green pepper, 2 cheese, 4 tomato, 8 pepperoni) */
  type = 0;
  /** +0x0c: throw direction -1 / 0 / 1 */
  dir = 0;
  /** +0x10: ticks in the air */
  t = 0;
  /** +0x14 / +0x18: the model of the topping (mesh + texture list) = the template record */
  tpl: GameRecord | null = null;
  /** +0x1c: world matrix */
  m = identity();
  /** +0x5c..: start position of the flight (the hand) */
  start: [number, number, number] = [0, 0, 0];
  /** +0x68: spin angle */
  rot = 0;
  /** +0x6c: ticks the splat lasts */
  life = 0;
}

/** the hooks the host fills in (sound, speech, particles); the defaults only record what happened */
export interface MapEnv {
  rng(): number;
  sfx(id: number): void;
  say(id: string): void;
  /** FUN_004433f0: the 3D loop of a topping in the air (null = stop, FUN_004434b0) */
  flight(pos: [number, number, number] | null): void;
  /** FUN_008153c0: the splat particles at a position */
  puff(pos: [number, number, number]): void;
}

/** a small deterministic generator (tests); the game uses the C runtime generator (`gameRandom`, game.ts) */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

export class MapState {
  env: MapEnv;
  /** DAT_00955df8: the queue slots {occupied, record} */
  slots: { occ: number; rec: GameRecord | null }[] = [0, 1, 2, 3, 4].map(() => ({ occ: 0, rec: null }));
  /** DAT_05d5f4a0: citizens that are flying away after being hit */
  hitCitizens = 0;
  /** DAT_05d5f4b0: toppings in the air */
  flying = 0;
  /** DAT_05d5f3e8: 0 running, 1 success, 2 failed (set with the medal at the end) */
  result = 0;
  /** DAT_05d4e138: the HUD gauge */
  gauge = 0;
  /** DAT_05d4e144 + 8 i: the HUD icon of target i (-1 none) */
  hudIcons = [-1, -1, -1, -1];
  /** DAT_05d5f4a4: rotation of the planet / galaxy */
  planetAngle = 0;
  /** DAT_0089df30: the near plane the camera code sets (null until it ran) */
  near: number | null = null;
  papa: PapaNode | null = null;
  mama: MamaNode | null = null;
  pepper: PepperNode | null = null;
  slug: SlugNode | null = null;
  toppings: ToppingNode | null = null;
  rigs: Record<string, Blk> = {};
  /** the pizza stack records PIZ6 .. PIZ2 (the array of FUN_008138bd: records +0x7b8, 0x750, 0x6e8, 0x680, 0x618) */
  stack: GameRecord[] = [];
  /** what happened (tests): the distance of every topping to Papa's hand when it arrived */
  arrivals: { d: number; dx: number; dy: number; dz: number; dir: number }[] = [];
  log: string[] = [];
  spoken: string[] = [];
  sounds: number[] = [];

  constructor() {
    const rng = lcg(1);
    this.env = {
      rng,
      sfx: (id) => { this.sounds.push(id); },
      say: (id) => { this.spoken.push(id); },
      flight: () => { /* silent */ },
      puff: () => { /* none */ },
    };
  }
  sfx(id: number) { this.env.sfx(id); }
  /** FUN_004388ae(x) of the original: a random float in [0, x) */
  rand(x: number): number { return this.env.rng() * x; }
  say(id: string) { this.env.say(id); }
}

const states = new WeakMap<World, MapState>();
/** the state of the zone run of `w` (created on first use) */
export function stateOf(w: World): MapState {
  let s = states.get(w);
  if (!s) { s = new MapState(); states.set(w, s); }
  return s;
}

/** records by name (the zone's code addresses them by `DAT_00983804 + offset`) */
const recOf = (w: World, name: string): GameRecord | undefined => w.records.find((r) => r.name === name);

/** stands in for the animation of a record that has none (the zone's rigs are bound by `bindRigs`; worlds built by other code, e.g. the stub-walk test, have only Pepper's) */
const NO_ANIM = { advance: () => 0, frame: 0, clip: 0, frameCount: 0, start: () => false, pose: () => null } as unknown as AnimInstance;

/** the pose of `a`'s rig at (clip, frame), evaluated like AnimInstance.pose (FUN_0043ba7a): null when the clip does not match the skeleton */
function poseAt(a: AnimInstance, clip: number, frame: number): Float32Array | null {
  const sk = a.rig.skeleton, c = a.rig.clips[clip];
  if (!sk || !c || c.boneCount !== sk.boneCount) return null;
  return sampleBlk(sk, c, frame, (c.flags & CLIP_LOOP) !== 0, undefined, a.noInterp ? 1e9 : POSE_SNAP);
}

/** FUN_0043b874(anim, rate, 0): advance without loop; clamps at the frame count and returns 2 each tick afterwards (the slug's clips) */
function advanceClamp(a: AnimInstance, rate: number, dt: number): number {
  const n = a.frameCount;
  a.frame += rate * dt;
  if (n < a.frame) { a.frame = n; return 2; }
  return 0;
}

// ------------------------------------------------------------------------------------------------ nodes

abstract class MapNode implements BehaviourNode {
  abstract readonly kind: string;
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  protected inited = false;
  /** the constructor's work (needs the record): run once, before the first update (or by `initMapNodes`) */
  abstract init(w: World, rec: GameRecord): void;
  abstract tick(w: World, rec: GameRecord, ctrl: Controller): void;
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.inited) { this.inited = true; this.init(w, rec); }
    this.tick(w, rec, ctrl);
    return NODE_STOP;
  }
  ensureInit(w: World, rec: GameRecord) { if (!this.inited) { this.inited = true; this.init(w, rec); } }
}

/** FUN_00816220: the camera of the game: mode 0 overview of the pizza, 1 close up of Pepper; `smooth` eases the eye by 0.25 per tick */
export function mapCamera(w: World, rec: GameRecord, mode: number, smooth: boolean) {
  const S = stateOf(w);
  const c = w.camera.c;
  const look = CAM_LOOK[mode] ?? CAM_LOOK[0], eye = CAM_EYE[mode] ?? CAM_EYE[0];
  c[3] = addf(rec.x, look[0]); c[4] = addf(rec.y, look[1]); c[5] = addf(rec.z, look[2]);
  const e = toWorldExact(rec.m, eye);
  const dx = subf(e[0], c[0]), dy = subf(e[1], c[1]), dz = subf(e[2], c[2]);
  const d2 = addf(addf(mulf(dz, dz), mulf(dy, dy)), mulf(dx, dx));
  // DAT_0089df30 (the near plane): 3.0 once the overview eye has settled, 1.0 otherwise
  S.near = mode === 0 && d2 < 0.1 ? 3 : 1;
  if (!smooth) { c[0] = e[0]; c[1] = e[1]; c[2] = e[2]; }
  else { const dd = [dx, dy, dz]; for (let i = 0; i < 3; i++) c[i] = addf(mulf(dd[i], CAM_EASE), c[i]); }
  w.camera.updateView();
}

/** Pepper (constructor 0x816ba0): the state machine of FUN_00816562 */
export class PepperNode extends MapNode {
  readonly kind = 'Pepper';
  /** +0x18: 0 start, 1 wait for Papa, 2 pick, 3 picking up, 4 hold (waiting for the throw button), 5 throwing, 6 done */
  state = 0;
  /** +0x1c: the slot of the topping in the hand */
  slot: ToppingSlot | null = null;
  /** +0x20: idle timer (60 ticks) */
  timer = 0;
  rec: GameRecord | null = null;

  init(w: World, rec: GameRecord) {
    const S = stateOf(w);
    S.pepper = this; this.rec = rec;
    rec.anim?.start(4, 0);
    mapCamera(w, rec, 0, false);
    w.camera.savePrev();
  }

  /** FUN_008164d6: the first free slot of the topping node, set up for a topping of `type` whose model is the record `tplName` */
  private allocSlot(w: World, type: number, tpl: GameRecord | undefined): ToppingSlot | null {
    const t = stateOf(w).toppings;
    if (!t) return null;
    const s = t.slots.find((x) => x.active === 0);
    if (!s) return null;
    s.tpl = tpl ?? null; s.state = 1; s.type = type;
    return s;
  }

  tick(w: World, rec: GameRecord) {
    const S = stateOf(w);
    const a = rec.anim;
    const held = w.input.held, pressed = w.input.pressed;
    let cam = 0;
    switch (this.state) {
      case 0: this.state = 1; break;
      case 1:
        if (S.papa && S.papa.state === 2) { this.state = 2; this.timer = 60; }
        break;
      case 2: {
        if (S.flying === 0 && S.hitCitizens === 0) { this.timer -= 1 * w.dt; if (this.timer < 0) cam = 1; }
        for (const p of PICKS) {
          if ((pressed & p.bit) === 0) continue;
          const s = this.allocSlot(w, p.type, recOf(w, p.record));
          this.slot = s;
          if (s) { a?.start(p.clip, 0); this.state = 3; cam = 1; }
          break;
        }
        break;
      }
      case 3: {
        const fin = a ? a.advance(1, w.dt) : 2;
        const frame = a ? Math.trunc(a.frame) : 99;
        const s = this.slot;
        if (16 < frame && s && s.active === 0) {
          const snd = PICK_SOUND[s.type];
          if (snd !== undefined) S.sfx(snd);
          s.active = 1;
        }
        if (frame < 25 && fin !== 2) cam = 1;
        if (fin === 2) { this.state = 4; a?.start(7, 0); }
        break;
      }
      case 4: {
        const frame = a ? Math.trunc(a.frame) : 99;
        if (frame < 14) a?.advance(1, w.dt);
        if (pressed & 0x80) this.state = 5;
        break;
      }
      case 5: {
        const fin = a ? a.advance(1, w.dt) : 2;
        const frame = a ? Math.trunc(a.frame) : 99;
        let dir = 0;
        if (held & 1) dir = -1;
        if (held & 2) dir += 1;
        if (18 <= frame) { throwTopping(w, this.slot, dir); this.slot = null; }
        if (fin === 2) this.state = 6;
        break;
      }
      case 6: this.state = 2; this.timer = 60; break;
    }
    mapCamera(w, rec, cam, true);
  }
}

/** FUN_0081638c: let go of the topping in the hand (slot state 1 -> 2) */
export function throwTopping(w: World, slot: ToppingSlot | null, dir: number) {
  const S = stateOf(w);
  if (!slot || slot.state !== 1) return;
  const th = [SND.THROW1, SND.THROW2, SND.THROW3, SND.THROW4];
  S.sfx(th[Math.floor(S.rand(4)) & 3]);
  if ((Math.floor(S.rand(2)) & 1) === 0) S.sfx(SND.VOCAL2); else S.sfx(SND.VOCAL1);
  slot.state = 2; slot.t = 0; slot.dir = dir;
  S.flying++;
}

/** Papa Brickolini (constructor 0x8132e0): FUN_00812399 */
export class PapaNode extends MapNode {
  readonly kind = 'Papa';
  /** +0x18: 0 start, 1 wait for a citizen at the counter, 2 swing, 3 quick wiggle, 4 hit (JUMPLOOK), 5 recover, 6 round done, 7 deliver, 8 next pizza, 9 result, 10 dance */
  state = 0;
  /** +0x1c: finished rounds */
  level = 0;
  /** +0x20: the dough is in his hand */
  showDough = 1;
  /** +0x24 / +0x28 / +0x2c: position of the record */
  x = 0; y = 0; z = 0;
  /** +0x30: swing offset (3 sin angle, or 0.75 sin angle while wiggling) */
  swing = 0;
  /** +0x34: swing angle */
  angle = 0;
  /** +0x38: matrix of the hand holding the dough (the translation is what the toppings aim at); all zero until the first update like the original's (nothing is drawn with it before) */
  hand: Float32Array = new Float32Array(16);
  /** +0x78: the swing was slowed (wiggle) */
  slow = 0;
  /** +0x84: toppings on the dough (bit mask of types) */
  layers = 0;
  /** +0x8c: angular speed per tick (0.015, +0.0075 per round) */
  speed = f32(0.015);
  /** +0x90: toppings landed this round, +0x94: toppings of this round */
  thrown = 0; count = 0;
  /** +0x98 + 0xc i: target types; +0x9c + 0xc i: landed types; +0xa0 + 0xc i: still wanted */
  target = [-1, -1, -1, -1]; landed = [0, 0, 0, 0]; pending = [0, 0, 0, 0];
  /** +0xc8: time gauge, +0xcc: score, +0xd0: medal */
  gauge = 0; score = 0; medal = 0;
  rec: GameRecord | null = null;

  init(w: World, rec: GameRecord) {
    const S = stateOf(w);
    S.papa = this; this.rec = rec;
    S.stack = ['PIZ6', 'PIZ5', 'PIZ4', 'PIZ3', 'PIZ2'].map((n) => recOf(w, n)).filter((r): r is GameRecord => !!r);
    for (const r of S.stack) r.show();
    rec.anim?.start(10, 0);
    this.place(rec);
  }

  /** the draw hook FUN_00812ea5: identity matrix at (x, y, z) */
  private place(rec: GameRecord) { rec.m.set(identity()); setPos(rec.m, this.x, this.y, this.z); }

  /** FUN_008122a0: this round's wanted toppings */
  newRound(w: World) {
    const S = stateOf(w);
    const n = TOPPINGS_PER_ROUND[this.level] ?? 0;
    this.count = n;
    for (let i = 0; i < 4; i++) {
      if (i < n) {
        const r = Math.min(3, Math.floor(S.rand(4)));
        this.target[i] = 1 << r; this.pending[i] = 1; S.hudIcons[i] = r;
      } else { this.target[i] = -1; this.pending[i] = 0; S.hudIcons[i] = -1; }
    }
  }

  private dec(S: MapState, dt: number) {
    this.gauge = subf(this.gauge, mulf(GAUGE_DECAY, dt));
    if (this.gauge < 0) this.gauge = 0;
    S.gauge = this.gauge;
  }

  tick(w: World, rec: GameRecord) {
    const S = stateOf(w);
    const a = rec.anim ?? NO_ANIM;       // an unprepared world (no rigs bound): the state machine just stalls on the clip events
    const fin = a.advance(1, w.dt);
    const frame = Math.trunc(a.frame);
    if (fin !== 0) S.sfx(SND.PAPA_BOUNCE);
    const bones = a.pose(1);
    if (bones) {
      const off = identity();
      rotZ(off, HAND_ROT_Z);
      setPos(off, HAND_OFFSET[0], HAND_OFFSET[1], HAND_OFFSET[2]);
      const bone = bones.slice(14 * 16, 14 * 16 + 16);
      this.hand = mulA(off, mulA(bone, rec.m));
    }
    switch (this.state) {
      case 0: this.state = 1; break;
      case 1:
        if (S.slots[1].occ !== 0) {
          this.newRound(w);
          this.gauge = GAUGE_START; this.layers = 0; this.thrown = 0;
          this.state = 2;
        }
        break;
      case 2: {
        this.swing = f32(Math.sin(this.angle) * 3);
        let na = addf(mulf(this.speed, w.dt), this.angle);
        if (-PI <= na) { if (PI < na) na = subf(na, TWO_PI); } else na = addf(na, TWO_PI);
        if ((na < 0 && 0 <= this.angle) || (0 <= na && this.angle < 0)) {
          if ((Math.floor(S.rand(2)) & 1) === 0) { this.state = 3; this.slow = 1; }
        }
        this.angle = na;
        this.x = this.swing;
        this.dec(S, w.dt);
        break;
      }
      case 3: {
        this.swing = f32(Math.sin(this.angle) * 0.75);
        let na = this.angle;
        for (let i = 0; i < 4; i++) {
          na = addf(mulf(this.speed, w.dt), na);
          if (-PI <= na) { if (PI < na) na = subf(na, TWO_PI); } else na = addf(na, TWO_PI);
          if ((na < 0 && 0 <= this.angle) || (0 <= na && this.angle < 0)) { this.state = 2; this.slow = 0; break; }
        }
        this.angle = na;
        this.x = this.swing;
        this.dec(S, w.dt);
        break;
      }
      case 4: {
        // hit by a topping: the sentence of the 25 % (OGSGMP08 .. 10), the JUMPLOOK clip
        if (S.rand(4) <= 1) {
          const r = S.rand(3);
          S.say(r <= 1 ? 'OGSGMP08' : r <= 2 ? 'OGSGMP09' : 'OGSGMP10');
        }
        a.start(13, 0);
        this.state = 5;
        this.dec(S, w.dt);
        break;
      }
      case 5:
        if (fin !== 0) {
          this.state = this.slow !== 0 ? 3 : 2;
          a.start(10, 0);
        }
        this.dec(S, w.dt);
        break;
      case 6: {
        let wrong = false;
        this.score += POINTS_ROUND;
        for (let i = 0; i < this.count; i++) if (this.landed[i] !== this.target[i]) wrong = true;
        if (!wrong) {
          this.score += (Math.trunc(this.gauge) * 100) >> 1;
          S.sfx(Math.trunc(S.rand(5)) % 5 < 3 ? SND.PAPA_YEAH : SND.PAPA_CHEERS);
        }
        this.level++;
        this.state = 7;
        a.start(5, 0);
        break;
      }
      case 7:
        if (24 <= frame) {
          releaseCustomer(w);
          this.showDough = 0; this.layers = 0;
          this.state = 8;
        }
        break;
      case 8:
        if (this.level < ROUNDS) {
          if (62 <= frame) {
            S.stack[this.level - 1]?.hide();
            this.showDough = 1;
          }
          if (fin === 2) {
            a.start(10, 0);
            this.state = 1;
            this.speed = f32(this.speed + 0.0075);
            this.showDough = 1;
          }
        } else if (fin !== 0) {
          this.state = 9;
          S.pepper?.rec?.anim?.start(1, 0);
          S.mama?.rec?.anim?.start(1, 0);
        }
        break;
      case 9: {
        this.state = 10;
        const f = finishScore(w.vars, this.score);
        this.medal = f.medal;
        S.result = f.result;
        break;
      }
      case 10:
        if (fin !== 0) a.start(10, 0);
        break;
    }
    this.place(rec);
  }
}

/** FUN_00813e6c: the citizen at the counter has been served and walks off to slot 0 */
function releaseCustomer(w: World) {
  const S = stateOf(w);
  const s1 = S.slots[1];
  if (!s1.occ) return;
  const rec = s1.rec;
  const node = rec?.ctrl?.nodes[0] as CitizenNode | undefined;
  if (!rec || !node) return;
  S.slots[node.slot].occ = 0; S.slots[node.slot].rec = null;
  node.moveTo(rec, 0);
  S.slots[node.slot].occ = 1; S.slots[node.slot].rec = rec;
}

/** FUN_00813e03: a cheese thrown straight at the window hits the citizen waiting at slot 2: true when he gets knocked away */
function hitWaitingCitizen(w: World): boolean {
  const S = stateOf(w);
  if (!S.slots[2].occ) return false;
  const node = S.slots[2].rec?.ctrl?.nodes[0] as CitizenNode | undefined;
  if (node && node.state === 2) { node.state = 3; return true; }
  return false;
}

const F32B = new Float32Array(1), U32B = new Uint32Array(F32B.buffer);
/**
 * FUN_00815576 case 2 writes the landed type to `papa + 0x9c + 12 * idx`, clears `+0xa0 + 12 * idx` and compares `+0x98 + 12 * idx` with the type, with no range check on `idx` (the
 * number of toppings landed this round). The four slots are idx 0..3; a fifth topping that lands before the next round starts (two in the air at once, rapid fire) aliases the node's
 * score (+0xcc) with the type, the medal word (+0xd0) with 0 and compares the type with the bits of the gauge (+0xc8): WP-VERIFY, reproduced by the differential test.
 * A sixth one would write beyond the node's 0xd8 bytes (heap): not modelled. Returns whether the landed type is the wanted one.
 */
function landOnDough(papa: PapaNode, idx: number, type: number): boolean {
  if (idx < 4) { papa.landed[idx] = type; papa.pending[idx] = 0; return papa.target[idx] === type; }
  if (idx === 4) {
    F32B[0] = papa.gauge;
    const same = (U32B[0] | 0) === type;
    papa.score = type; papa.medal = 0;
    return same;
  }
  return false;
}

/** Mama (constructor 0x81611f): FUN_00815f30 */
export class MamaNode extends MapNode {
  readonly kind = 'mama';
  /** +0x18: 0 idle clip, 1 playing, 2 clap, 3 fail */
  state = 1;
  pos: [number, number, number] = [0, 0, 0];
  rec: GameRecord | null = null;
  init(w: World, rec: GameRecord) {
    stateOf(w).mama = this; this.rec = rec;
    rec.anim?.start(11, 0);
    this.pos = [rec.x, rec.y, rec.z];
    this.place(rec);
  }
  /** the draw hook FUN_0081603e: rotated 0x4016cbe4 about Y at her position */
  private place(rec: GameRecord) {
    rec.m.set(identity()); rotY(rec.m, 2.3561945); setPos(rec.m, this.pos[0], this.pos[1], this.pos[2]);
  }
  tick(w: World, rec: GameRecord) {
    const a = rec.anim ?? NO_ANIM;
    const fin = a.advance(1, w.dt);
    switch (this.state) {
      case 0: a.start(11, 0); this.state = 1; break;
      case 1: if (fin === 2) this.state = 0; break;
      case 2: a.start(1, 0); this.state = 1; break;
      case 3: a.start(2, 0); this.state = 1; break;
    }
    this.place(rec);
  }
}

/** the ten topping slots (constructor 0x815e1a, attached to the record TOPD): FUN_00815576 */
export class ToppingNode extends MapNode {
  readonly kind = 'Topping';
  /** +0x18: 1 once the one-off citizen bonus was paid */
  bonus = 0;
  slots: ToppingSlot[] = Array.from({ length: 10 }, () => new ToppingSlot());
  /** Pepper's animation (clip, frame) at the end of the previous tick: what the draw pass left in her pose buffer (null before the first tick) */
  pepperPose: { clip: number; frame: number } | null = null;

  init(w: World) { stateOf(w).toppings = this; }

  /** FUN_0081543e: where a flying topping is now */
  private flightPos(w: World, s: ToppingSlot): [number, number, number] {
    const S = stateOf(w);
    s.t = addf(mulf(1, w.dt), s.t);
    const papaZ = S.papa?.rec?.z ?? 0;
    const K264 = f32(0.264);
    const total = f32(subf(papaZ, s.start[2]) / K264);
    const frac = f32(s.t / total);
    const toY = subf(f32(3.04), s.start[1]);
    const target = s.dir === -1 ? -3 : s.dir === 1 ? 3 : s.start[0];
    const x = addf(mulf(subf(target, s.start[0]), frac), s.start[0]);
    const y = addf(mulf(toY, frac), s.start[1]);
    const z = addf(mulf(s.t, K264), s.start[2]);
    s.m.set(eulerExact(s.rot, 0, 0)); setPos(s.m, x, y, z);
    s.rot = addf(s.rot, f32(0.03));
    return [x, y, z];
  }

  tick(w: World) {
    const S = stateOf(w);
    const papa = S.papa, mama = S.mama, pepper = S.pepper;
    if (!papa || !mama || !pepper) return;
    for (const s of this.slots) {
      if (s.active === 0) continue;
      switch (s.state) {
        case 1: {
          // in Pepper's hand: bone 14 of her rig, shifted by the hand offset
          const prec = pepper.rec!;
          // FUN_0043bc58 reads Pepper's pose buffer, which only the draw pass (FUN_004440f0) fills: it holds the pose of the END OF THE PREVIOUS TICK (clip / frame as the draw saw
          // them), Pepper's own update of this tick has already advanced her clip (WP-VERIFY: found by the differential test); her record matrix is read live
          const bones = this.pepperPose ? poseAt(prec.anim!, this.pepperPose.clip, this.pepperPose.frame) : prec.anim?.pose(1);
          if (bones) {
            const off = identity(); setPos(off, TOPPING_HAND_OFFSET[0], TOPPING_HAND_OFFSET[1], TOPPING_HAND_OFFSET[2]);
            s.m.set(mulA(mulA(off, bones.slice(14 * 16, 14 * 16 + 16)), prec.m));
          }
          s.start = [s.m[12], s.m[13], s.m[14]];
          break;
        }
        case 2: {
          const pos = this.flightPos(w, s);
          S.env.flight(pos);
          if (-1 < pos[2]) {
            S.env.flight(null);
            const h = papa.hand;
            const d = Math.hypot(h[12] - pos[0], h[13] - pos[1], h[14] - pos[2]);
            S.arrivals.push({ d, dx: h[12] - pos[0], dy: h[13] - pos[1], dz: h[14] - pos[2], dir: s.dir });
            if (1 <= d) {
              if (1.5 <= d) { s.state = 3; mama.state = 3; S.log.push('miss'); }
              else {
                papa.state = 4;
                S.env.puff(pos);
                s.state = 4; s.life = 12;
                mama.state = 3;
                S.sfx(SND.HIT_PAPA);
                const r = Math.floor(S.rand(3)) % 3;
                S.sfx(r === 0 ? SND.PAPA_EEK : r === 1 ? SND.PAPA_OUCH : SND.PAPA_YEOW);
                S.log.push('papa');
              }
            } else {
              papa.layers |= s.type;
              S.sfx(HIT_SOUND[s.type] ?? SND.PIZ_CAPS);
              const idx = papa.thrown;
              if (landOnDough(papa, idx, s.type)) { S.sfx(SND.RIGHT_TOP); papa.score += POINTS_MATCH; S.log.push('match'); }
              else { S.sfx(SND.WRONG_TOP); S.log.push('wrong'); }
              papa.thrown = idx + 1;
              if (papa.thrown === papa.count) {
                papa.state = 6;
                if (pepper.state !== 4) pepper.state = 1;
                pepper.rec?.anim?.start(4, 0);
                if (pepper.slot) { pepper.slot.active = 0; pepper.slot.state = 0; pepper.slot = null; }
                S.sfx(SND.PIZ_DONE);
              }
              S.env.puff(pos);
              s.state = 4; s.life = 12;
              mama.state = 2;
              S.sfx(SND.MAMA_CLAP);
              if (S.rand(5) <= 1) S.say('OGSGMP07');
            }
          }
          break;
        }
        case 3: {
          const pos = this.flightPos(w, s);
          if (2.5 < pos[2]) {
            if (S.rand(4) <= 1) {
              const r = S.rand(3);
              S.say(r <= 1 ? 'OGSGMP11' : r <= 2 ? 'OGSGMP12' : 'OGSGMP13');
            }
            S.env.puff(pos);
            s.state = 4; s.life = 12;
            if (s.dir === 0 && s.type === 2) {
              if (hitWaitingCitizen(w)) {
                if (this.bonus === 0) { this.bonus = 1; papa.score += POINTS_CITIZEN; }
                mama.state = 2;
                S.sfx(SND.MAMA_CLAP);
                S.sfx(SND.HIT_CITIZEN);
                S.log.push('citizen');
              } else S.sfx(SND.HIT_WINDOW);
            } else S.sfx(SND.HIT_WINDOW);
          }
          break;
        }
        case 4:
          s.life = Math.trunc(s.life - 1 * w.dt);
          if (s.life < 1) { s.state = 0; s.active = 0; S.flying--; }
          break;
      }
    }
    // the draw pass of this tick (after every update) evaluates Pepper's pose: it is what the next tick's in-hand topping reads
    const pa = pepper.rec?.anim;
    this.pepperPose = pa ? { clip: pa.clip, frame: pa.frame } : null;
  }
}

/** an Ogel citizen in the queue (constructor 0x81483d): FUN_008140cc */
export class CitizenNode extends MapNode {
  readonly kind = 'citizen';
  /** +0x18: 0 waiting to enter, 1 walking, 2 waiting in the queue, 3 hit, 4 flying away, 5 watching a hit, 6 gone */
  state = 0;
  /** +0x1c: slot the citizen is in / walking to */
  slot = 4;
  rate: number;
  /** +0x28: walking steps, +0x2c: progress */
  steps = 0; prog = 0;
  from: [number, number, number] = [0, 0, 0];
  delta: [number, number, number] = [0, 0, 0];
  /** the logical position (the CIT4 model is drawn 2 units further, FUN_008146ea) */
  p: [number, number, number] = [0, 0, 0];
  drawOffset: [number, number, number] = [0, 0, 0];
  rec: GameRecord | null = null;
  constructor(rate = 1) { super(); this.rate = rate; }

  init(w: World, rec: GameRecord) {
    this.rec = rec;
    rec.anim?.start(0, 0);
    this.p = [rec.x, rec.y, rec.z];
    if (rec.name === 'CIT4') this.drawOffset = [0, 0, 2];
    this.write(rec);
  }
  private write(rec: GameRecord) { setPos(rec.m, this.p[0] + this.drawOffset[0], this.p[1] + this.drawOffset[1], this.p[2] + this.drawOffset[2]); }

  /** FUN_0081408f: the free slot in front of `slot` (-1 when this is the counter or the next one is occupied) */
  private freeAhead(S: MapState, slot: number): number {
    if (slot !== 1 && S.slots[slot - 1].occ === 0) return slot - 1;
    return -1;
  }

  /** FUN_00813f1e: start walking to slot `to` */
  moveTo(rec: GameRecord, to: number) {
    if (this.slot === to) return;
    this.prog = 0;
    this.from = [...this.p];
    const t = SLOT_POS[to];
    this.delta = [subf(t[0], this.p[0]), subf(t[1], this.p[1]), subf(t[2], this.p[2])];
    const d = this.delta;
    const dist = f32(Math.sqrt(addf(addf(mulf(d[2], d[2]), mulf(d[1], d[1])), mulf(d[0], d[0]))));
    // FUN_00813f1e: ftol(float(dist / 0.12f) + 0.85f): the float constants 0x892170 / 0x8927e8 (0.12 as a double would change the step count at the boundaries)
    this.steps = Math.trunc(addf(f32(f32(dist / f32(0.12))), f32(0.85)));
    this.slot = to;
    this.state = 1;
    const clip = CITIZEN_CLIPS[4];
    if (rec.anim && clip !== rec.anim.clip) rec.anim.start(clip, 0);
  }

  tick(w: World, rec: GameRecord) {
    const S = stateOf(w);
    const a = rec.anim;
    switch (this.state) {
      case 0: {
        rec.hide();
        const n = this.freeAhead(S, this.slot);
        if (n !== -1 && S.slots[n].occ === 0) {
          S.slots[n].occ = 1; S.slots[n].rec = rec;
          this.slot = 4;
          this.p = [...SLOT_POS[4]];
          rec.show();
          this.moveTo(rec, n);
        }
        break;
      }
      case 1: {
        a?.advance(this.rate, w.dt);
        this.prog = addf(mulf(1, w.dt), this.prog);
        if (this.prog <= this.steps) {
          const f = f32(this.prog / this.steps);
          this.p = [addf(mulf(this.delta[0], f), this.from[0]), addf(mulf(this.delta[1], f), this.from[1]), addf(mulf(this.delta[2], f), this.from[2])];
          rec.ry = f32(Math.atan2(-this.delta[0], -this.delta[2]));
          setRotation(rec.m, rec.rx, rec.ry, rec.rz);
        } else if (this.slot === 0) {
          this.state = 6;
          rec.hide();
        } else {
          const n = this.freeAhead(S, this.slot);
          if (n === -1) {
            this.state = 2;
            const t = SLOT_POS[this.slot];
            this.p = [t[0], t[1], t[2]];
            rec.ry = PI;
            a?.start(CITIZEN_CLIPS[1], 0);
            setRotation(rec.m, rec.rx, rec.ry, rec.rz);
          } else {
            S.slots[this.slot].occ = 0; S.slots[this.slot].rec = null;
            this.moveTo(rec, n);
            S.slots[this.slot].occ = 1; S.slots[this.slot].rec = rec;
          }
        }
        break;
      }
      case 2: {
        a?.advance(this.rate, w.dt);
        if (S.hitCitizens !== 0) {
          this.state = 5;
          a?.start(CITIZEN_CLIPS[2], 0);
        } else if (this.slot !== 1) {
          const n = this.freeAhead(S, this.slot);
          if (n !== -1) {
            S.slots[this.slot].occ = 0; S.slots[this.slot].rec = null;
            this.moveTo(rec, n);
            S.slots[this.slot].occ = 1; S.slots[this.slot].rec = rec;
          }
        }
        break;
      }
      case 3:
        a?.start(CITIZEN_CLIPS[3], 0);
        this.p[1] += 2;
        this.state = 4;
        S.hitCitizens++;
        break;
      case 4:
        a?.advance(this.rate, w.dt);
        this.p[1] = addf(this.p[1], f32(0.024)); this.p[2] = addf(this.p[2], f32(0.24));
        rec.rx = addf(rec.rx, f32(0.1));
        setRotation(rec.m, rec.rx, rec.ry, rec.rz);
        if (f32(18.84955596923828) < rec.rx) {
          rec.hide();
          this.state = 0;
          S.slots[this.slot].occ = 0; S.slots[this.slot].rec = null;
          this.slot = 4;
          rec.rx = 0;
          S.hitCitizens--;
        }
        break;
      case 5: {
        if (S.hitCitizens === 0) {
          this.state = 2;
          rec.ry = PI;
          setRotation(rec.m, rec.rx, rec.ry, rec.rz);
          a?.start(CITIZEN_CLIPS[1], 0);
        } else {
          const hit = S.slots[2].rec;
          if (hit) {
            // the original reads the record's own position (DAT_00955e24 + 0x3c / 0x44); the port's matrix of CIT4 carries the 2 units of its draw hook, so use the node's logical position
            const hp = (hit.ctrl?.nodes.find((n) => n.kind === 'citizen') as CitizenNode | undefined)?.p ?? [hit.x, hit.y, hit.z];
            rec.ry = f32(Math.atan2(subf(hp[0], this.p[0]), subf(hp[2], this.p[2])));
            setRotation(rec.m, rec.rx, rec.ry, rec.rz);
          }
        }
        break;
      }
    }
    this.write(rec);
  }
}

/** the slug (constructor 0x81529f): FUN_00814f6e + the path FUN_00814bd0 */
export class SlugNode extends MapNode {
  readonly kind = 'Slug';
  state = 0;
  /** +0x28 / +0x2c: the two path angles */
  a1 = 0; a2 = 0;
  rec: GameRecord | null = null;
  init(w: World, rec: GameRecord) {
    stateOf(w).slug = this; this.rec = rec;
    rec.anim?.start(2, 0);
  }

  /**
   * FUN_00814bd0: place the slug on its path and turn it along the path (drawn at scale 0.4, FUN_008151c8). The original keeps every intermediate in float32 and the direction is the
   * difference of two nearby path points, so the roundings matter (up to 1e-4 relative in the matrix): replayed here step by step (WP-VERIFY).
   */
  private place(rec: GameRecord) {
    const K4 = 4, K01 = f32(0.1), C1 = f32(0.0087266), C2 = f32(0.0174532);
    const a1 = f32(this.a1), a2 = f32(this.a2);
    // local_cc / local_c4 = (float)(sin * const), local_10 / local_8 the same one step further (the sums a + step are formed in extended precision)
    const p1x = f32(Math.sin(a1) * K4), p1z = f32(Math.sin(a2) * K01);
    const p2x = f32(Math.sin(f32(a1 + C1)) * K4), p2z = f32(Math.sin(f32(a2 + C2)) * K01);     // 24-bit x87: the sum is rounded before sin
    // FUN_0043cec0: len2 = float(x*x + y*y + z*z); k = float(1 / sqrt(len2)); every component = float(k * c)
    const norm = (v: [number, number, number]) => {
      const l2 = f32(f32(f32(v[0] * v[0]) + f32(v[1] * v[1])) + f32(v[2] * v[2]));     // asm order x, y, z, every op rounded (24-bit x87)
      if (l2 === 0) return v;
      const k = f32(1 / f32(Math.sqrt(l2)));
      return [f32(k * v[0]), f32(k * v[1]), f32(k * v[2])] as [number, number, number];
    };
    const t = norm([f32(p2x - p1x), f32(0 - 0), f32(p2z - p1z)]);
    // right = up x forward = (fz, 0, -fx), normalised again
    const r = norm([t[2], 0, -t[0]]);
    const m = rec.m;
    m.set(identity());
    m[0] = r[0]; m[1] = r[1]; m[2] = r[2];
    m[4] = 0; m[5] = 1; m[6] = 0;
    m[8] = t[0]; m[9] = t[1]; m[10] = t[2];
    // translation = float(float(-0.8 * forward) + float(2 * p1 + (1.1, 0, 1))), the position of the path point from DAT_00955f20
    const back = f32(-0.8);
    const px = f32(f32(back * t[0]) + f32(p1x + p1x + f32(1.1))), py = f32(f32(back * t[1]) + f32(0 + 0 + 0)), pz = f32(f32(back * t[2]) + f32(p1z + p1z + 1));
    for (let i = 0; i < 12; i++) if (i % 4 !== 3) m[i] *= 0.4;
    setPos(m, px, py, pz);
  }

  tick(w: World, rec: GameRecord) {
    const a = rec.anim ?? NO_ANIM;
    switch (this.state) {
      case 0:
        if (advanceClamp(a, 1, w.dt) === 2) a.start(2, 0);
        // the node's path angles are floats (+0x28 / +0x2c): every update is rounded
        this.a1 = f32(this.a1 + f32(0.0087266)); this.a2 = f32(this.a2 + f32(0.0174532));
        if (f32(TWO_PI) < this.a2) { this.a2 = f32(this.a2 - f32(TWO_PI)); this.state = 2; }
        if (f32(TWO_PI) < this.a1) this.a1 = f32(this.a1 - f32(TWO_PI));
        this.place(rec);
        break;
      case 2: a.start(3, 0); this.state = 3; break;
      case 3: if (advanceClamp(a, 1, w.dt) === 2) { a.start(2, 0); this.state = 0; } break;
      case 4: a.start(2, 0); break;
      case 5: if (advanceClamp(a, 1, w.dt) === 2) { a.start(2, 0); this.state = 0; } break;
    }
  }
}

/** the planet and the galaxy (constructor 0x814b0f, draw hook FUN_00814964) */
export class PlanetNode extends MapNode {
  readonly kind = 'Planet';
  init() { /* nothing */ }
  tick(w: World, rec: GameRecord) {
    const S = stateOf(w);
    rec.m.set(identity());
    rotY(rec.m, S.planetAngle);
    rotZ(rec.m, -0.5);
    setPos(rec.m, 25, 10, 30);
    const gala = recOf(w, 'GALA');
    if (gala) {
      const x = gala.m[12], y = gala.m[13], z = gala.m[14];
      gala.m.set(identity()); rotZ(gala.m, S.planetAngle); setPos(gala.m, x, y, z);
    }
    S.planetAngle = addf(S.planetAngle, f32(0.005));
  }
}

// ------------------------------------------------------------------------------------------------ registration and set-up

registerCtor(CTOR.PEPPER, () => new PepperNode());
registerCtor(CTOR.PAPA, () => new PapaNode());
registerCtor(CTOR.MAMA, () => new MamaNode());
registerCtor(CTOR.TOPPING, () => new ToppingNode());
registerCtor(CTOR.SLUG, () => new SlugNode());
registerCtor(CTOR.PLANET, () => new PlanetNode());
/** FUN_00813733 attaches the citizens with the animation rates 1.0 / 1.1 / 0.9 / 1.3 / 1.3 to the records CIT1 .. CIT5 (record indices 4, 5, 6, 7, 9) */
const CITIZEN_RECORDS = [4, 5, 6, 7, 9];
registerCtor(CTOR.CITIZEN, (at) => new CitizenNode(CITIZEN_RATES[Math.max(0, CITIZEN_RECORDS.indexOf(at.record))]));

/** the rigs the zone loads (FUN_0081bcf7) and the records they animate (the instances made at 0x81bcf7 + 0x...; clip 1 first) */
export const RIGS: [string, string[]][] = [['MFIG', ['PEPP', 'MAMA', 'PAPA']], ['CIT1', ['CIT1']], ['CIT2', ['CIT2']], ['CIT3', ['CIT3']], ['CIT4', ['CIT4']], ['SLUG', ['SLUG']], ['CIT5', ['CIT5']]];

/** give the records their animation instances (the original creates them in the loader, FUN_0043b4e2(rig, 1) + FUN_0043b6a3(anim, 1, 0)) */
export function bindRigs(w: World, archive: Archive) {
  const S = stateOf(w);
  for (const [rig, names] of RIGS) {
    let blk = S.rigs[rig];
    if (!blk) {
      const e = archive.find(`anim/${rig}.blk`);
      if (!e) continue;
      blk = S.rigs[rig] = parseBlk(archive.read(e));
    }
    for (const n of names) {
      const r = recOf(w, n);
      if (!r) continue;
      r.anim = new AnimInstance(blk);
      r.anim.start(1, 0);
    }
  }
}

/** a plain snapshot of the zone state (tests, the browser bot, `window.__zone.game.debug()`) */
export function snapshot(S: MapState) {
  const p = S.papa, pe = S.pepper;
  const held = pe?.slot ?? null;
  return {
    result: S.result,
    papa: p && {
      state: p.state, level: p.level, score: p.score, medal: p.medal, gauge: p.gauge, angle: p.angle, speed: p.speed, x: p.x, slow: p.slow, thrown: p.thrown, count: p.count,
      target: [...p.target], landed: [...p.landed], pending: [...p.pending], showDough: p.showDough, layers: p.layers, hand: [p.hand[12], p.hand[13], p.hand[14]],
    },
    pepper: pe && { state: pe.state, holding: held ? { type: held.type, active: held.active, startZ: held.start[2] } : null },
    mama: S.mama && { state: S.mama.state },
    flying: S.flying, hit: S.hitCitizens, queue: S.slots.map((q) => q.occ),
    toppings: S.toppings?.slots.map((s) => [s.state, s.active, s.type, s.t]),
    bonus: S.toppings?.bonus ?? 0,
    log: S.log.slice(-8),
  };
}

/** the records that only hold models for the draw code (the toppings, the dough, the layers): never drawn by themselves in the port */
export const MODEL_RECORDS = ['TOPD', 'TOP1', 'TOP2', 'TOP3', 'TOP4', 'TOMA', 'MEAT', 'CHEE', 'GREE', 'TOPP', 'PIZ1'];

/**
 * Prepare a freshly set-up zone world for the nodes: rig instances, the nodes' constructor work (they run lazily before their first update otherwise),
 * the player's walk nodes of the stub chain removed (the zone has its own player node), the planet position of the loop start (FUN_00811abc: 25, 10, 30).
 */
export function prepareWorld(w: World, archive: Archive): MapState {
  const S = stateOf(w);
  bindRigs(w, archive);
  const pep = recOf(w, 'PEPP');
  if (pep?.ctrl) pep.ctrl.nodes = pep.ctrl.nodes.filter((n) => n.kind === 'Pepper');
  const plan = recOf(w, 'PLAN');
  if (plan) setPos(plan.m, 25, 10, 30);
  // M5 audit: the builder (FUN_00816ca0) sets flags 2 on the model holders and nothing in the zone hides them, so the original draws them at the origin through the normal record draw
  // (FUN_00444480: model, flag 2, frustum bit). Only TOPD is not drawn by itself: its node's draw hook (FUN_00815d2b) draws the toppings in the air and returns 1.
  recOf(w, 'TOPD')?.hide();
  for (const r of w.records) {
    for (const node of r.ctrl?.nodes ?? []) (node as unknown as { ensureInit?(w: World, r: GameRecord): void }).ensureInit?.(w, r);
  }
  for (const r of w.records) r.savePrev();
  w.camera.savePrev();
  return S;
}
