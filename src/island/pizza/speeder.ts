// speeder.c (Common\Z02LGI\c_src\speeder.c, 0x536e16..0x538779): the island's cars (records AMBU the ambulance, SPD0 / SPD1 / SPD2 the "speeders"
// = small toy cars, PCAR the police car) and their drivers (PETE in AMBU, RICH in SPD1, NUBB in SPD0). Ported from the decompile of
//   FUN_00538126  car constructor (node 0x44, handler table 0x8eae90): a ROAD walker (FUN_00462d4f(0, rec, start)), the car tuning           -> SpeederNode
//   FUN_00537689  car update: engine sound, Pepper-driven mode (var bit 0x20000000 / 0x10000000), obstacle ahead -> brake / horn / the car
//                 falls apart (brick burst 0xd)                                                                                         -> SpeederNode.update
//   FUN_00537d54  pre-render: pitch to the ground under both axles (FUN_005373a6), placed between them                                  -> SpeederNode.prerender
//   FUN_00537ea9  draw: the wheels (MATL parts 2..5) roll with the distance driven, the front pair steers                                -> SpeederNode.prerender
//   FUN_005382fb  destroy (engine sound off)    FUN_005380c8 / FUN_005380ed save / load (not ported)
//   FUN_00536f00 / FUN_00536fea / FUN_005370e4  per car: engine stop / engine at the car / horn       FUN_0053727a / FUN_005371eb  engine pitch
//   FUN_005385d3  driver constructor (node 0x28, handler table 0x8eaeb8): the gate moves into the node, sitting clip 0x43                  -> DriverNode
//   FUN_00538346  driver update: in the car while (var & mask) == value, else standing at a PATH node                                     -> DriverNode.update
//   FUN_005383ca  driver pre-render: on the car's seat (MATL part 1), popping up while the car is in bricks                              -> DriverNode.prerender
// The cars do not move by themselves: the Human1 node on the same record (WP3) drives the walker this node creates along its route; SGCar
// (WP6) is Pepper driving it (it sets 0x20000000 in the car's var, 0x10000000 while Pepper sits in it).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE, NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_NO_COLLIDE, RF_NPC } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { MAP_PATH, MAP_ROAD, waypoints } from '../../game/walker.ts';
import { NO_GROUND } from '../../game/collision.ts';
import { registerCtor } from '../../game/setup.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ArgView } from '../args.ts';
import { tryCtx } from '../ctx.ts';
import { partMatrix, setRotation } from '../trigger/parts.ts';
import { PI_F, TWO_PI_F, sfx, sfxAt, wrapOnce } from './common.ts';

export const CTOR_SPEEDER = 0x538126, CTOR_DRIVER = 0x5385d3;

/** record flags the car uses: 0x2000 = stopped by an obstacle (crashed), 0x8000 = in bricks (no mesh), 0x10 = not solid */
export const RF_CAR_STOPPED = 0x2000, RF_IN_BRICKS = 0x8000;
/** car var bits: SGCar's "a player car" / "Pepper sits in it"; the driver node's "in the car this frame" bits */
export const CAR_PLAYER = 0x20000000, CAR_PEPPER_IN = 0x10000000, DRIVER_SEATED = 0x40020000;

/** sound table ids (FUN_004b037e loads them): engine loop / horn per car, Pepper's car engine, the five Shift horns */
export const SND_CAR = {
  ENGINE: { SPD0: 0x2df, SPD1: 0xfa, SPD2: 0xfb, AMBU: 0x2ea, PCAR: 0x2ed } as Record<string, number>,   // Toycar3 / 1 / 2, CarVox2, Toycar2
  HORN: { SPD0: 0x2dd, SPD1: 0x2e6, SPD2: 0x2e7, AMBU: 0x2eb, PCAR: 0x2ee } as Record<string, number>,     // Horn2 / 1 / 2 / 3 / 2
  CRASH: 0x372,          // DAT_05d582c8 (an UNDEFINED entry of the table: silent)
  PEPPER_ENGINE: 0x370,  // Sophie1.wav
  SHIFT_HORNS: [0x375, 0x377, 0x376, 0x378, 0x374] as const,   // r = 1..5 of trunc(random * 6): SepHorn2, 4, 3, 5, 1 (0: none)
} as const;

export const CAR = {
  /** FUN_00538126 walker tuning: speed 0.1333 (0x3e088886), lane 0.5, turn rate 0.1, radii 1 / 2, limit 3 */
  SPEED: 0.13333320617675781, LANE: 0.5, TURN: 0.10000000149011612, RADIUS_MIN: 1.0, RADIUS_MAX: 2.0, RADIUS_LIMIT: 3.0,
  /** the obstacle segment: from pos - fwd * 5.28 (+2 up) along fwd * 25.28 (0x8925c4 / 0x8925c0), radius / skin 4 */
  BACK: 5.28000020980835, AHEAD: 25.280000686645508, LIFT: 2.0, RAY_MASK: 3, RAY_R: 4.0,
  /** off-screen time after which a car Pepper left goes back to where he took it (0x8924dc) */
  RETURN_TICKS: 300,
  /** FUN_005373a6: axle half distance 4, probe from 6 above (0x89228c), no ground below -10000 (0x8925bc), fall probe 8; pitch = -atan2(dy, 8) */
  AXLE: 4.0, PROBE_UP: 6.0, PROBE_FALL: 8.0, NO_GROUND_Y: -10000, AXLE_SPAN: 8.0,
  /** FUN_00537d54: pitch easing per tick (0x892584) */
  PITCH_STEP: 0.03490639850497246,
  /** FUN_00537ea9: wheel roll = 2 * atan(dist * 0.25), steer = (yaw - yaw at the update) * 3 */
  WHEEL_K: 0.25, STEER_K: 3.0,
  /** FUN_0053727a / FUN_005371eb: engine rate 18500 idle .. 22050 (0x8eaeac / 0x8eaea8), +-118.3 per tick, wobble 5 % at 0.02 per tick */
  RATE_IDLE: 18500, RATE_MAX: 22050, RATE_STEP: 118.30000305175781, WOBBLE: 0.05, WOBBLE_STEP: 0.019999999552965164, THROTTLE_KEYS: 0xa3,
  /** the car table DAT_05d58648 (FUN_004b6475): SPD0, AMBU, PCAR, SPD1, SPD2 */
  TABLE: ['SPD0', 'AMBU', 'PCAR', 'SPD1', 'SPD2'] as const,
  /** the brick burst kind of a crash */
  BURST: 0xd,
} as const;

/** the speeder.c globals: DAT_05d586e0 (the car whose engine is Pepper's), DAT_05d586dc (a horn sounded for the current obstacle) */
interface CarGlobals { engineCar: GameRecord | null; honked: boolean; table: GameRecord[] | null }
const KEY = 'speeder';
function globals(w: World): CarGlobals {
  let g = w.ext.get(KEY) as CarGlobals | undefined;
  if (!g) { g = { engineCar: null, honked: false, table: null }; w.ext.set(KEY, g); }
  if (!g.table) g.table = CAR.TABLE.map((n) => w.records.find((r) => r.name === n)).filter((r): r is GameRecord => !!r);
  return g;
}
const carName = (rec: GameRecord) => rec.name.slice(0, 4);
const stopSfx = (w: World, id: number) => { const c = tryCtx(w); if (c) c.stopSfx(id); };

/** FUN_00536f00: the car's engine loop off */
function engineOff(w: World, rec: GameRecord) { const id = SND_CAR.ENGINE[carName(rec)]; if (id !== undefined) stopSfx(w, id); }
/** FUN_00536fea: the engine loop at the car (FUN_004433f0 plays it while the listener is within the sound's range) */
function engineAt(w: World, rec: GameRecord) { const id = SND_CAR.ENGINE[carName(rec)]; if (id !== undefined) sfxAt(w, id, [rec.x, rec.y, rec.z]); }
/** FUN_005370e4: the car's horn, once per obstacle */
function horn(w: World, rec: GameRecord) {
  const g = globals(w);
  if (g.honked) return;
  const id = SND_CAR.HORN[carName(rec)];
  if (id !== undefined) sfxAt(w, id, [rec.x, rec.y, rec.z]);
}

/** FUN_005373a6: the ground under the front / back axle; returns the pitch (unchanged when one of them has no ground) */
export function axlePitch(w: World, rec: GameRecord, front: number[], back: number[]): number {
  const fx = rec.m[8] * CAR.AXLE, fy = rec.m[9] * CAR.AXLE, fz = rec.m[10] * CAR.AXLE;
  const probe = (p: number[]): boolean => {
    const t = w.col.terrainHeight(p[0], p[1], p[2], 0);
    let dy: number = -CAR.PROBE_FALL, found = false;
    if (t > CAR.NO_GROUND_Y && t !== NO_GROUND) { dy = t - p[1]; found = true; }
    const from = [p[0], p[1], p[2]];
    if (found) p[1] = t;
    const h = w.col.probe(rec, from, [0, dy, 0], 0x43);
    if (h) { p[0] = h.point[0]; p[1] = h.point[1]; p[2] = h.point[2]; }
    return found || !!h;
  };
  front[0] = rec.x + fx; front[1] = rec.y + fy + CAR.PROBE_UP; front[2] = rec.z + fz;
  back[0] = rec.x - fx; back[1] = rec.y - fy + CAR.PROBE_UP; back[2] = rec.z - fz;
  const a = probe(front), b = probe(back);
  if (!a || !b) return rec.rx;
  return wrapOnce(-Math.atan2(front[1] - back[1], CAR.AXLE_SPAN));
}

export class SpeederNode implements BehaviourNode {
  readonly kind = 'speeder';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  /** argument +0: the ROAD node the walker starts at (-1 = the nearest) */
  readonly startNode: number;
  private readonly ctrlFlags: number | undefined;
  inited = false;
  /** +0x18 engine wobble phase, +0x1c engine rate */
  wobble = 0; rate: number = CAR.RATE_IDLE;
  /** +0x20: skip the pre-render (never set by the island's code), +0x21: Pepper moved it, +0x24: off-screen ticks */
  skipPrerender = false; moved = false; offTicks = 0;
  /** +0x28..+0x30 / +0x38..+0x40: position and Euler at the update (where Pepper took it; the wheel / steer reference) */
  saved = [0, 0, 0]; savedEuler = [0, 0, 0];
  /** +0x34 wheel angle */
  wheel = 0;
  private front = [0, 0, 0]; private back = [0, 0, 0];

  constructor(args: ArgView, attach?: Attach & { ctrlFlags?: number }) {
    this.var = attach?.var ?? 2; this.mask = attach?.mask ?? 0; this.value = attach?.value ?? 0;
    this.startNode = args.i32(0);
    this.ctrlFlags = attach?.ctrlFlags;
  }

  /** the constructor's work that needs the world (the walker, the box) */
  init(w: World, rec: GameRecord, ctrl: Controller) {
    if (this.inited) return;
    this.inited = true;
    if (this.ctrlFlags !== undefined) ctrl.flags = this.ctrlFlags;
    let h = ctrl.walker && waypoints.get(ctrl.walker) ? ctrl.walker : 0;
    if (!h) h = waypoints.create(MAP_ROAD, rec, this.startNode);
    ctrl.walker = h;
    if (h) {
      waypoints.setSpeed(h, CAR.SPEED); waypoints.setLane(h, CAR.LANE); waypoints.setTurnRate(h, CAR.TURN);
      waypoints.setRadiusMin(h, CAR.RADIUS_MIN); waypoints.setRadiusMax(h, CAR.RADIUS_MAX);
      waypoints.apply(h, rec);
      waypoints.setRadiusLimit(h, CAR.RADIUS_LIMIT);
    }
    this.saved = [rec.x, rec.y, rec.z];
    this.moved = false; this.skipPrerender = false; this.wheel = 0;
    rec.colObj?.setBoxFromFile();   // FUN_004427e0
    const g = globals(w); g.engineCar = null; g.honked = false;
    this.wobble = 0; this.rate = CAR.RATE_IDLE;
    rec.rz = 0;
  }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.inited) this.init(w, rec, ctrl);
    const g = globals(w);
    const v = w.vars.get(this.var);
    if ((v & CAR_PLAYER) !== 0) {
      if ((rec.flags & RF_CAR_STOPPED) === 0 || (v & CAR_PEPPER_IN) !== 0) {
        rec.flags &= ~RF_CAR_STOPPED; rec.flags &= ~RF_NO_COLLIDE;
        if ((v & CAR_PEPPER_IN) === 0) {
          // Pepper left it: the engine is off; out of sight for 300 ticks -> back where he took it
          if (g.engineCar === rec) { g.engineCar = null; stopSfx(w, SND_CAR.PEPPER_ENGINE); }
          if (this.moved) {
            if (!inView(w, rec)) {
              this.offTicks = 1.0 * w.dt + this.offTicks;
              if (this.offTicks > CAR.RETURN_TICKS) {
                rec.rx = this.savedEuler[0]; rec.ry = this.savedEuler[1]; rec.rz = this.savedEuler[2];
                rec.setEuler(rec.rx, rec.ry, rec.rz, this.saved[0], this.saved[1], this.saved[2]);
                this.moved = false;
                engineOff(w, rec);
              }
            } else this.offTicks = 0;
          }
        } else {
          // Pepper drives it: Shift = a random horn, the engine follows the throttle keys
          if ((w.input.pressed & B.SHIFT) !== 0) {
            const r = Math.trunc(Math.random() * 6);
            if (r >= 1 && r <= 5) sfx(w, SND_CAR.SHIFT_HORNS[r - 1]);
          }
          if (!g.engineCar) { engineOff(w, rec); g.engineCar = rec; }
          this.enginePitch(w);
          this.moved = true; this.offTicks = 0;
        }
        return NODE_NONE;
      }
      stopSfx(w, SND_CAR.PEPPER_ENGINE);
    }
    engineAt(w, rec);
    if (w.frame === 0) {
      // the first frame: straight onto the ground
      rec.rx = axlePitch(w, rec, this.front, this.back);
      rec.setEuler(rec.rx, rec.ry, rec.rz, (this.front[0] + this.back[0]) * 0.5, (this.front[1] + this.back[1]) * 0.5, (this.front[2] + this.back[2]) * 0.5);
      this.save(rec);
      return NODE_NONE;
    }
    this.save(rec);
    // something ahead? the cars Pepper drives (var bit 0x20000000), then Pepper himself (box test while flagged 0x40)
    const k1 = CAR.BACK, k2 = CAR.AHEAD;
    const from = [this.saved[0] - rec.m[8] * k1, this.saved[1] - rec.m[9] * k1 + CAR.LIFT, this.saved[2] - rec.m[10] * k1];
    const delta = [rec.m[8] * k2, rec.m[9] * k2, rec.m[10] * k2];
    let hit = false;
    for (const car of g.table ?? []) {
      if (hit) break;
      if (car === rec || !car.ctrl) continue;
      const head = car.ctrl.nodes[0];
      if (!head || (w.vars.get(head.var) & CAR_PLAYER) === 0) continue;
      hit = !!w.col.rayRecord(car, from, delta, CAR.RAY_MASK, CAR.RAY_R, CAR.RAY_R);
    }
    if (!hit) {
      const pep = w.records[16]?.name === 'PEPP' ? w.records[16] : w.focus;
      if (pep) {
        pep.flags |= RF_NPC;
        hit = !!w.col.rayRecord(pep, from, delta, CAR.RAY_MASK, CAR.RAY_R, CAR.RAY_R);
        pep.flags &= ~RF_NPC;
      }
    }
    if (!hit) {
      g.honked = false;
      rec.flags &= ~RF_CAR_STOPPED;
      if ((rec.flags & RF_IN_BRICKS) === 0) rec.flags &= ~RF_NO_COLLIDE;
    } else {
      horn(w, rec);
      sfxAt(w, SND_CAR.CRASH, [rec.x, rec.y, rec.z]);
      g.honked = true;
      engineOff(w, rec);
      if ((rec.flags & RF_IN_BRICKS) === 0) {
        rec.flags |= RF_IN_BRICKS | RF_CAR_STOPPED | RF_NO_COLLIDE;
        tryCtx(w)?.brickBurst?.(rec, CAR.BURST);
      }
    }
    this.skipPrerender = false;
    return NODE_CONTINUE;
  }

  private save(rec: GameRecord) {
    this.saved[0] = rec.x; this.saved[1] = rec.y; this.saved[2] = rec.z;
    this.savedEuler[0] = rec.rx; this.savedEuler[1] = rec.ry; this.savedEuler[2] = rec.rz;
  }

  /** FUN_0053727a: the engine of the car Pepper drives revs up with the throttle keys (0xa3), down to idle without, with a 5 % wobble */
  private enginePitch(w: World) {
    let hz: number;
    if ((w.input.held & CAR.THROTTLE_KEYS) === 0) {
      if (this.rate <= CAR.RATE_IDLE) hz = this.wobbled(CAR.RATE_IDLE, w);
      else { this.rate = this.rate - CAR.RATE_STEP * w.dt; hz = this.rate; }
    } else if (CAR.RATE_MAX <= this.rate) hz = this.wobbled(CAR.RATE_MAX, w);
    else { this.rate = CAR.RATE_STEP * w.dt + this.rate; hz = this.rate; }
    tryCtx(w)?.sfxFreq?.(SND_CAR.PEPPER_ENGINE, Math.trunc(hz));   // FUN_00443600
    sfx(w, SND_CAR.PEPPER_ENGINE);
  }
  /** FUN_005371eb */
  private wobbled(base: number, w: World): number {
    const r = Math.sin(this.wobble) * (base * CAR.WOBBLE) + base;
    this.wobble = CAR.WOBBLE_STEP * w.dt + this.wobble;
    if (this.wobble >= 360) this.wobble = 0;
    return r;
  }

  /** FUN_00537d54 (+ the wheels of the draw hook FUN_00537ea9) */
  prerender(w: World, rec: GameRecord, _c: Controller) {
    void _c;
    if (!this.skipPrerender) {
      const target = axlePitch(w, rec, this.front, this.back);
      if (rec.rx <= target) rec.rx = target - rec.rx > CAR.PITCH_STEP ? rec.rx + CAR.PITCH_STEP : target;
      else rec.rx = rec.rx - target > CAR.PITCH_STEP ? rec.rx - CAR.PITCH_STEP : target;
      rec.setEuler(rec.rx, rec.ry, rec.rz, (this.front[0] + this.back[0]) * 0.5, (this.front[1] + this.back[1]) * 0.5, (this.front[2] + this.back[2]) * 0.5);
    }
    // the wheels: MATL parts 2, 3 (front, steering) and 4, 5 (rear)
    const d = Math.hypot(rec.x - this.saved[0], rec.y - this.saved[1], rec.z - this.saved[2]);
    this.wheel = this.wheel + 2 * Math.atan2(d * CAR.WHEEL_K, 1.0);
    if (this.wheel < -PI_F) this.wheel += TWO_PI_F; else if (this.wheel > PI_F) this.wheel -= TWO_PI_F;
    const steer = (rec.ry - this.savedEuler[1]) * CAR.STEER_K;
    for (let i = 0; i < 4; i++) {
      const m = partMatrix(w, rec, 2 + i);
      if (m) setRotation(m, this.wheel, i < 2 ? steer : 0, 0);
    }
  }

  /** FUN_005382fb */
  destroy(w: World, rec: GameRecord) { engineOff(w, rec); stopSfx(w, SND_CAR.PEPPER_ENGINE); }
}

/** record flag 1 (FUN_00444370); without the shell's frustum service every record counts as in view */
const inView = (w: World, rec: GameRecord) => { const c = tryCtx(w); return c?.inFrustum ? c.inFrustum(rec) : true; };

/** FUN_005385d3: argument +0 the car record, +4 the PATH node where the driver stands when out of the car; the attach's gate (mask / value) is the
 *  "in the car" test, the node itself always runs (its mask / value are 0) */
export class DriverNode implements BehaviourNode {
  readonly kind = 'speederDriver';
  var: number;
  /** the node's own gate is always (0, 0): setupZone's writes of the attach's mask / value are ignored (they are the in-car test below) */
  get mask() { return 0; } set mask(_v: number) { void _v; }
  get value() { return 0; } set value(_v: number) { void _v; }
  stamp = 0xfffffffe;
  /** +0x1c / +0x1e: the in-car test (var & inMask) == inValue */
  readonly inMask: number; readonly inValue: number;
  private carIdx: number;
  /** +0x14 */
  car: GameRecord | null = null;
  /** +0x18 */
  readonly outNode: number;
  /** +0x20: pop-up height while the car is in bricks; +0x24: placed at the out node */
  rise = 0; placed = false;
  private started = false;

  constructor(args: ArgView, attach?: Attach) {
    this.var = attach?.var ?? 2;
    this.inMask = attach?.mask ?? 0; this.inValue = attach?.value ?? 0;
    this.carIdx = args.recIndex(0);
    this.outNode = args.i32(4);
  }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c;
    if (this.carIdx >= 0) { this.car = w.records[this.carIdx] ?? null; this.carIdx = -1; }
    if (!this.started) { this.started = true; rec.anim?.start(0x43, 0); }   // the constructor's FUN_0043b6a3(anim, 0x43, 0)
    if ((w.vars.get(this.var) & this.inMask) === this.inValue) {
      this.placed = false;
      w.vars.or(this.var, DRIVER_SEATED);
      return NODE_STOP;   // seated: the rest of the chain (the driver's walking routes, Turn2Pep) does not run
    }
    if (!this.placed) {
      const p = waypoints.nodePos(MAP_PATH, this.outNode);
      rec.x = p[0]; rec.y = p[1]; rec.z = p[2];
      this.placed = true;
    }
    return NODE_NONE;   // out of the car (0x538399: eax = 0): the driver's other nodes take over
  }

  /** FUN_005383ca: on the seat = MATL part 1 of the car's mesh (+ the pop-up), the car's orientation */
  prerender(w: World, rec: GameRecord, _c: Controller) {
    void _c;
    const car = this.car;
    if (!car) return;
    const seat = partMatrix(w, car, 1);
    const p = car.toWorld(seat ? [seat[12], seat[13], seat[14]] : [0, 0, 0]);
    rec.rx = car.rx; rec.ry = car.ry; rec.rz = car.rz;
    rec.m.set(car.m);
    rec.x = p[0]; rec.y = p[1] + this.rise; rec.z = p[2];
    w.vars.andNot(this.var, DRIVER_SEATED);
    if ((car.flags & 0xc000) === RF_IN_BRICKS) { if (this.rise < 8) this.rise += 1.600000023841858; }
    else if (this.rise <= 0) this.rise = 0;
    else this.rise -= 2.6666600704193115;
  }
}

registerCtor(CTOR_SPEEDER, (a) => new SpeederNode(ArgView.of(a), a));
registerCtor(CTOR_DRIVER, (a) => new DriverNode(ArgView.of(a), a));
