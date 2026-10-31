// SupaStat.c, the train (Common\Z02LGI\c_src\SupaStat.c 0x53c337..0x53de05): records TRNL (the locomotive), TRNT (tender) and TRNC (carriage) run
// round the island's rail loop on the ROAD waypoint map, stop at the two stations (platform records 5 and 6) with a whistle, and Pepper can ride the
// locomotive (Ctrl on a platform: PEPPER_CONTROL = 0x80; Up / Space faster, Down / Alt slower and stop, Left / Right look to a side, Ctrl at a
// platform gets off). Ported from the decompile of
//   FUN_0053d66c  constructor (node 0x40, handler table 0x8eb170): walker on map 0 from node 99 to 0x65, the followers keep their distance   -> TrainNode
//   FUN_0053c6eb  update: station stops, the speed factor DAT_05d586e4, the route DAT_008eb188 {95, 97, 99, 101, 105}, curve roll, the ride
//                 (Pepper's seat, camera, controls), the board / leave icons, the engine sound                                             -> TrainNode.update
//   FUN_0053d2ad  pre-render: Pepper gets on (DAT_009daa80 == this record) / off (a platform beside the locomotive)                          -> TrainNode.prerender
//   FUN_0053c565  a platform beside: probe 8 units to the right (then the left) from 8 above, 16 down; record 5 or 6 = a platform           -> platformBeside
//   FUN_0053d935  destroy (sounds off)    FUN_0053d48e (draw = the default)    FUN_0053d4ca / FUN_0053d5a3 save / load -> TrainNode.saveBlock / loadBlock
// The other constructor of SupaStat.c, FUN_0053c337 (SUPE, update FUN_0053adc3 533 lines), is `src/island/pizza/supe.ts`.
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { MAP_ROAD, waypoints } from '../../game/walker.ts';
import type { StepOut } from '../../game/walker.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { registerCtor } from '../../game/setup.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ad, sb, ml, sq, fr } from '../../zones/common/f32.ts';
import { toWorld } from '../../zones/exact.ts';
import { ArgView } from '../args.ts';
import { tryCtx } from '../ctx.ts';
import { FX_NONE, GATE_ON, HALF_PI, fxStart, recMatrix, registerFxStart } from '../emitters.ts';
import { vehicles, mul } from '../vehicles/common.ts';
import { sfx, sfxAt } from './common.ts';
import { BlockIn, BlockOut } from '../blockio.ts';

export const CTOR_TRAIN = 0x53d66c;
// every locomotive creates its smoke at construction, whatever its gate: started by `finishEmitters` too
registerFxStart((w) => { for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) if (n instanceof TrainNode) n.startSmoke(w, r); });

/** sound ids: the whistle (Trainwis.wav), the running and the coasting loop (ToyTrain2.wav twice), the bell on Shift while riding (Trainwis) */
export const SND_TRAIN = { WHISTLE: 0xfc, RUN: 0xf9, COAST: 0x163, BELL: 0xfc } as const;
export const FX_SMOKE = 'trainsmoke01.par';

export const TRAIN = {
  /** the constructor's walker tuning: start node 99, speed 0.1, lane 0, turn rate 0.1, radii 2 / 2, first goal 0x65, limit 30 */
  START: 99, SPEED: 0.10000000149011612, TURN: 0.10000000149011612, RADIUS: 2.0, FIRST_GOAL: 0x65, LIMIT: 30.0,
  /** DAT_008eb188: the loop (the route index starts at 3) */
  ROUTE: [95, 97, 99, 101, 105] as const, ROUTE_START: 3,
  /** the station nodes: leaving the approach to one of them starts the stop */
  STATIONS: [0x61, 0x69] as const,
  /** speed factor steps (0x892034) and limits; stop time (0x43160000) */
  ACCEL: 0.05000000074505806, MIN: 0.10000000149011612, MAX: 2.0, STOP_TICKS: 150,
  /** curve roll: only above factor 1.5 (0x8921a8), 1 degree per tick (0x8920d8), drawn x3 */
  ROLL_FROM: 1.5, ROLL_STEP: 0.01745319925248623, ROLL_DRAW: 3.0,
  /** Pepper's seat on the locomotive (DAT_008eb1a0..a8), the lean (DAT_008eb1ac), the side step 0.1 */
  SEAT: [1.0, 4.5, -6.5] as const, LEAN: -0.7853939533233643, SEAT_STEP: 0.10000000149011612,
  /** the ride camera: eye towards loco * (0, 3.6, -16) (DAT_008eb1b0) by 0.075 (DAT_008eb1bc) when further than 0.8, look-at loco + 2.8 up */
  CAM_EYE: [0, 3.5999999046325684, -16] as const, CAM_EASE: 0.07500000298023224, CAM_MIN2: 0.6399999856948853, CAM_LOOK_UP: 2.799999952316284,
  /** FUN_00422ddc(cam, y + 6, 0): eye at least 6.4 above (DAT_008adbfc), coming down 0.8 per tick when more than 32 above */
  CAM_FLOOR: 6.400000095367432, CAM_CEIL: 32, CAM_DOWN: 0.800000011920929, CAM_REF_UP: 6,
  /** FUN_0053c565: side distance 8, probe from 8 up, 16 down (mask 3); the platform records */
  SIDE: 8, PLATFORMS: [5, 6] as const,
  /** the board probe from Pepper: 4 up, 8 down (mask 3) */
  PEP_UP: 4, PEP_DOWN: 8,
  /** the clips: Pepper sitting 0x43, standing again 0x1b */
  CLIP_SIT: 0x43, CLIP_IDLE: 0x1b,
  /** PEPPER_CONTROL while riding / walking; INTERACT_ICONS bits: 0x10 can board, 0x40 can leave */
  PC_RIDE: 0x80, PC_WALK: 1, ICON_BOARD: 0x10, ICON_LEAVE: 0x40,
} as const;

/** the SupaStat.c train globals: DAT_05d586e4 the speed factor of all three cars, DAT_05d586f0 Pepper looks to the right, DAT_05d586ec just boarded */
interface TrainGlobals { factor: number; lookRight: boolean; boarded: boolean }
function tg(w: World): TrainGlobals {
  let g = w.ext.get('train') as TrainGlobals | undefined;
  if (!g) { g = { factor: 1.0, lookRight: false, boarded: false }; w.ext.set('train', g); }
  return g;
}

/** FUN_0053c565(rec, out, side): a platform (record 5 / 6) `side` units to the right of `rec` (else to its left); out = the spot on it */
export function platformBeside(w: World, rec: GameRecord, out: number[], side: number = TRAIN.SIDE): boolean {
  const dx = ml(-side, rec.m[0]), dy = ml(-side, rec.m[1]), dz = ml(-side, rec.m[2]);
  const x = rec.x, y = ad(rec.y, 8), z = rec.z;
  for (const s of [1, -1]) {
    const f = s > 0 ? ad : sb;
    out[0] = f(x, dx); out[1] = f(y, dy); out[2] = f(z, dz);
    const h = w.col.probe(rec, out, [0, -16, 0], 3);
    if (h && (h.rec === w.records[TRAIN.PLATFORMS[0]] || h.rec === w.records[TRAIN.PLATFORMS[1]])) { out[1] = h.point[1]; return true; }
  }
  return false;
}

/** Pepper stands on a platform: probe from (x, y + 4, z) 8 down hits record 5 or 6 */
function onPlatform(w: World, P: GameRecord): boolean {
  const h = w.col.probe(P, [P.x, ad(P.y, TRAIN.PEP_UP), P.z], [0, -TRAIN.PEP_DOWN, 0], 3);
  return !!h && (h.rec === w.records[TRAIN.PLATFORMS[0]] || h.rec === w.records[TRAIN.PLATFORMS[1]]);
}

export class TrainNode implements BehaviourNode {
  readonly kind = 'train';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  private leaderIdx: number;
  private readonly ctrlFlags: number | undefined;
  inited = false;
  /** +0x14: the car in front (null = the locomotive) */
  leader: GameRecord | null = null;
  /** +0x1c route index, +0x20 stop ticks, +0x24 the last step result */
  routeIdx: number = TRAIN.ROUTE_START; stopTicks = 0; lastCode = -1;
  /** +0x28 Pepper rides, +0x29 the ride is moving (+0x2a: 2 pad bytes, 0xCD) */
  riding = false; moving = false; pad2a = 0xcdcd;
  /** +0x2c..+0x34 Pepper's seat, +0x38 the curve roll */
  seat: number[] = [TRAIN.SEAT[0], TRAIN.SEAT[1], TRAIN.SEAT[2]]; roll = 0;
  /** +0x3c the coasting sound (else the running one): a byte that the constructor leaves 0xCD (its test `node[5] == 0` reads the uninitialised +0x14, see `init`), so the loop is the coasting one until a station stop writes it;
   *  +0x3d 0 cruise / 1 speeding up / 2 slowing for a station; +0x3e: 2 pad bytes (0xCD) */
  coastByte = 0xcd; phase = 0; pad3e = 0xcdcd;
  get coasting() { return this.coastByte !== 0; }
  set coasting(v: boolean) { this.coastByte = v ? 1 : 0; }
  /** the locomotive's trainsmoke01 emitter (+0x18 of the original's node) */
  smokeH = FX_NONE;
  private out: StepOut = { yaw: 0, dist: 0 };

  constructor(args: ArgView, attach?: Attach & { ctrlFlags?: number }) {
    this.var = attach?.var ?? 2; this.mask = attach?.mask ?? 0; this.value = attach?.value ?? 0;
    this.leaderIdx = args.recIndex(0);
    this.ctrlFlags = attach?.ctrlFlags;
  }

  init(w: World, rec: GameRecord, ctrl: Controller) {
    if (this.inited) return;
    this.inited = true;
    if (this.ctrlFlags !== undefined) ctrl.flags = this.ctrlFlags;
    this.leader = this.leaderIdx >= 0 ? w.records[this.leaderIdx] ?? null : null;
    tg(w).factor = 1.0;
    const x = rec.x, y = rec.y, z = rec.z, ry = rec.ry;
    let h = ctrl.walker && waypoints.get(ctrl.walker) ? ctrl.walker : 0;
    if (!h) h = waypoints.create(MAP_ROAD, rec, TRAIN.START);
    ctrl.walker = h;
    if (h) {
      waypoints.setSpeed(h, TRAIN.SPEED); waypoints.setLane(h, 0); waypoints.setTurnRate(h, TRAIN.TURN);
      waypoints.setRadiusMin(h, TRAIN.RADIUS); waypoints.setRadiusMax(h, TRAIN.RADIUS);
      waypoints.goTo(h, TRAIN.FIRST_GOAL, 0);
      waypoints.setRadiusLimit(h, TRAIN.LIMIT);
    }
    // (FUN_0053d66c 0x53d8c3: `if (node[5] == 0) { whistle; node +0x3c = 0 }` tests the node's +0x14, which is only assigned later (`node[5] = leader`): a fresh debug-heap block holds 0xCDCDCDCD there,
    //  so the whistle and the coasting byte are never reached; the oracle's heap must fill 0xCD for this to show)
    if (h) waypoints.resume(h);
    this.riding = false; this.moving = false;
    this.seat = [TRAIN.SEAT[0], TRAIN.SEAT[1], TRAIN.SEAT[2]];
    rec.x = x; rec.y = y; rec.z = z; rec.ry = ry;
    this.routeIdx = TRAIN.ROUTE_START; this.stopTicks = 0; this.lastCode = -1;
    if (this.leader && h) {
      const dx = sb(x, this.leader.x), dy = sb(y, this.leader.y), dz = sb(z, this.leader.z);
      const d = sq(ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz)));
      waypoints.setStopDistance(h, fr(d * 0.125));   // FUN_004623f0 (walker units)
    }
    this.startSmoke(w, rec);
  }

  /**
   * Save block = node +0x1c .. +0x40 (0x24 bytes) + 8 bytes of the train globals (saver FUN_0053d4ca, 0x2c bytes; loader FUN_0053d5a3):
   * 0x00 i32 routeIdx (+0x1c)   0x04 f32 stopTicks (+0x20)   0x08 i32 lastCode (+0x24)   0x0c u8 riding (+0x28)   0x0d u8 moving   0x0e u16 pad (0xCDCD)   0x10 f32[3] seat (+0x2c)   0x1c f32 roll (+0x38)
   * 0x20 u8 coasting (+0x3c)   0x21 u8 phase (+0x3d)   0x22 u16 pad (0xCDCD)   0x24 f32 DAT_05d586e4 (the speed factor of all three cars)   0x28 u32 DAT_05d586f0 (Pepper looks to the right).
   * The loader copies the node bytes back and the two words into the globals (every train car does it: the last one saved wins, they hold the same values).
   */
  saveBlock(w: World, rec: GameRecord, ctrl: Controller): Uint8Array {
    if (!this.inited) this.init(w, rec, ctrl);
    const g = tg(w), b = new BlockOut(0x2c);
    b.i32(0x00, this.routeIdx).f32(0x04, this.stopTicks).i32(0x08, this.lastCode).u8(0x0c, this.riding ? 1 : 0).u8(0x0d, this.moving ? 1 : 0).u16(0x0e, this.pad2a);
    for (let k = 0; k < 3; k++) b.f32(0x10 + 4 * k, this.seat[k]);
    b.f32(0x1c, this.roll).u8(0x20, this.coastByte).u8(0x21, this.phase).u16(0x22, this.pad3e).f32(0x24, g.factor).u32(0x28, g.lookRight ? 1 : 0);
    return b.bytes;
  }
  loadBlock(w: World, rec: GameRecord, ctrl: Controller, data: Uint8Array): void {
    if (!this.inited) this.init(w, rec, ctrl);   // (the constructor ran at the set-up; the zone game's startPizzaNodes does it right after it)
    const g = tg(w), b = new BlockIn(data);
    this.routeIdx = b.i32(0x00); this.stopTicks = b.f32(0x04); this.lastCode = b.i32(0x08); this.riding = b.u8(0x0c) !== 0; this.moving = b.u8(0x0d) !== 0; this.pad2a = b.u16(0x0e);
    for (let k = 0; k < 3; k++) this.seat[k] = b.f32(0x10 + 4 * k);
    this.roll = b.f32(0x1c); this.coastByte = b.u8(0x20); this.phase = b.u8(0x21); this.pad3e = b.u16(0x22);
    g.factor = b.f32(0x24); g.lookRight = b.u32(0x28) !== 0;
  }

  /** FUN_0044e920 at 0x53d915 (the constructor, locomotive only): the smoke, always on (gate 2 / 1 / 1), bound to the record's matrix. The particle engine of the zone game
   *  comes after the set-up (this node is initialised by startPizzaNodes): retried every update until it exists. */
  startSmoke(w: World, rec: GameRecord) {
    if (this.leaderIdx < 0 && this.smokeH === FX_NONE) this.smokeH = fxStart(w, FX_SMOKE, recMatrix(rec), [0, 10, 7.25], [-HALF_PI, 0, 0], GATE_ON);
  }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.inited) this.init(w, rec, ctrl);
    this.startSmoke(w, rec);
    const g = tg(w), V = vehicles(w);
    const h = ctrl.walker;
    const P = w.focus;
    const loco = !this.leader;
    const dt = fr(w.dt);
    if (this.stopTicks > 0) {
      this.stopTicks = sb(this.stopTicks, ml(1.0, dt));
      if (this.stopTicks <= 0) {
        if (loco) { sfxAt(w, SND_TRAIN.WHISTLE, [rec.x, rec.y, rec.z]); this.coasting = false; }
        if (h) waypoints.resume(h);
        this.phase = 1;
      }
    } else {
      const yaw0 = rec.ry;
      const pos = [rec.x, rec.y, rec.z];
      let yaw = yaw0;
      let code = -0x33333334;   // the original's uninitialised local when the ride stands still
      if (!this.riding || this.moving) {
        if (loco && !this.riding) {
          if (this.phase === 2) {
            g.factor = sb(g.factor, TRAIN.ACCEL);
            if (g.factor < TRAIN.MIN) { this.stopTicks = TRAIN.STOP_TICKS; if (h) waypoints.pause(h); }
          } else if (this.phase === 1) {
            g.factor = ad(g.factor, TRAIN.ACCEL);
            if (g.factor > 1.0) { g.factor = 1.0; this.phase = 0; }
          }
        }
        if (h) {
          waypoints.setSpeedScale(h, g.factor);
          code = waypoints.step(h, pos, yaw, this.out, w.dt);
          yaw = this.out.yaw;
          if (code === TRAIN.ROUTE[this.routeIdx]) {
            this.routeIdx++;
            if (this.routeIdx > 4) this.routeIdx = 0;
            waypoints.goTo(h, TRAIN.ROUTE[this.routeIdx], 1);
          } else if (code !== this.lastCode && loco && (this.lastCode === TRAIN.STATIONS[0] || this.lastCode === TRAIN.STATIONS[1]) && !this.riding) {
            this.phase = 2;
            sfxAt(w, SND_TRAIN.WHISTLE, [rec.x, rec.y, rec.z]);
            this.coasting = true;
          }
        }
      }
      rec.ry = yaw;
      // the lean in curves (fast only)
      const target = g.factor <= TRAIN.ROLL_FROM ? 0 : ml(sb(yaw, yaw0), g.factor);
      if (Math.abs(sb(this.roll, target)) >= TRAIN.ROLL_STEP) this.roll = target <= this.roll ? sb(this.roll, TRAIN.ROLL_STEP) : ad(this.roll, TRAIN.ROLL_STEP);
      else this.roll = target;
      mul(buildMatrix(0, 0, ml(this.roll, TRAIN.ROLL_DRAW), 0, 0, 0), buildMatrix(rec.rx, rec.ry, rec.rz, pos[0], pos[1], pos[2]), rec.m);
      this.lastCode = code;
      if (this.riding && P) this.ride(w, rec, P, g, h);
    }
    // the icons, and Ctrl on a platform chooses this locomotive
    const spot = [0, 0, 0];
    if (V.range <= ctrl.distSq || this.riding) {
      if (this.riding && platformBeside(w, rec, spot)) w.vars.or(0x0c, TRAIN.ICON_LEAVE);
    } else if (P && platformBeside(w, rec, spot) && onPlatform(w, P)) w.vars.or(0x0c, TRAIN.ICON_BOARD);
    if (P && (w.input.pressed & B.CTRL) !== 0 && loco && (w.vars.get(0x5e) & 1) !== 0 && ctrl.distSq < V.range && onPlatform(w, P)) {
      V.current = rec;
      V.range = ctrl.distSq;
      P.anim?.start(TRAIN.CLIP_SIT, 0);
    }
    if (loco) sfxAt(w, this.coasting ? SND_TRAIN.COAST : SND_TRAIN.RUN, [rec.x, rec.y, rec.z]);   // (each after FUN_004434b0 of the other: one plays)
    return NODE_STOP;
  }

  /** the ride part of FUN_0053c6eb: Pepper on the seat, the camera behind the locomotive, the throttle */
  private ride(w: World, rec: GameRecord, P: GameRecord, g: TrainGlobals, h: number) {
    const dt = fr(w.dt);
    const sx = g.lookRight ? -TRAIN.SEAT[0] : TRAIN.SEAT[0];
    if (Math.abs(sb(sx, this.seat[0])) >= TRAIN.SEAT_STEP) this.seat[0] = this.seat[0] <= sx ? ad(this.seat[0], TRAIN.SEAT_STEP) : sb(this.seat[0], TRAIN.SEAT_STEP);
    else this.seat[0] = sx;
    const lean = this.seat[0] >= 0 ? TRAIN.LEAN : -TRAIN.LEAN;
    mul(buildMatrix(0, 0, lean, 0, 0, 0), rec.m, P.m);
    const p = toWorld(rec.m, this.seat);
    P.x = p[0]; P.y = p[1]; P.z = p[2];
    P.rx = 0; P.ry = rec.ry; P.rz = 0;
    w.pep.surfaceAtFeet = -1;
    P.anim?.start(TRAIN.CLIP_SIT, 0);
    const c = w.camera.c;
    c[3] = rec.x; c[5] = rec.z; c[4] = ad(rec.y, TRAIN.CAM_LOOK_UP);
    const e = toWorld(rec.m, TRAIN.CAM_EYE);
    let dx = sb(e[0], c[0]), dy = sb(e[1], c[1]), dz = sb(e[2], c[2]);
    if (ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz)) > TRAIN.CAM_MIN2) {
      const k = Math.min(TRAIN.CAM_EASE, 1);
      dx = ml(ml(k, dt), dx); dy = ml(ml(k, dt), dy); dz = ml(ml(k, dt), dz);
      c[0] = ad(c[0], dx); c[1] = ad(c[1], dy); c[2] = ad(c[2], dz);
      const floor = ad(TRAIN.CAM_FLOOR, fr(ad(P.y, TRAIN.CAM_REF_UP)));   // FUN_00422ddc
      if (c[1] < floor) c[1] = floor; else if (sb(c[1], floor) > TRAIN.CAM_CEIL) c[1] = sb(c[1], TRAIN.CAM_DOWN);
    }
    const held = w.input.held;
    if (held & B.LEFT) g.lookRight = true;
    if (held & B.RIGHT) g.lookRight = false;
    if ((held & (B.SPACE | B.UP)) === 0) {
      if ((held & (B.ALT | B.DOWN)) !== 0 && this.moving) {
        g.factor = sb(g.factor, ml(TRAIN.ACCEL, dt));
        if (g.factor < TRAIN.MIN) {
          g.factor = TRAIN.MIN;
          if (h) waypoints.pause(h);
          if (!this.leader) { sfxAt(w, SND_TRAIN.WHISTLE, [rec.x, rec.y, rec.z]); this.coasting = true; }
          this.moving = false;
        }
      }
    } else {
      if (!this.moving) {
        if (!this.leader) { sfxAt(w, SND_TRAIN.WHISTLE, [rec.x, rec.y, rec.z]); this.coasting = false; }
        if (h) waypoints.resume(h);
        this.moving = true;
      }
      g.factor = ad(ml(TRAIN.ACCEL, dt), g.factor);
      if (g.factor > TRAIN.MAX) g.factor = TRAIN.MAX;
    }
  }

  /** FUN_0053d2ad: get on (chosen by the update) / off (Ctrl with a platform beside) */
  prerender(w: World, rec: GameRecord, ctrl: Controller) {
    const g = tg(w), V = vehicles(w);
    const P = w.focus;
    if (!P) return;
    if (!this.riding) {
      if ((w.input.pressed & B.CTRL) !== 0 && !this.leader && V.current === rec) {
        w.vars.set(0x5e, TRAIN.PC_RIDE);
        this.riding = true; this.stopTicks = 0;
        w.pep.surfaceAtFeet = -1;
        this.moving = false;
        g.factor = TRAIN.MIN; g.boarded = true;
        this.phase = 0;
      }
    } else {
      if ((w.input.pressed & B.SHIFT) !== 0) sfx(w, SND_TRAIN.BELL);
      const spot = [0, 0, 0];
      if (((w.input.pressed & B.CTRL) !== 0 || !g.boarded) && (platformBeside(w, rec, spot) || !g.boarded)) {
        P.setEuler(0, P.ry, 0, spot[0], spot[1], spot[2]);
        P.rx = 0; P.rz = 0;
        if (ctrl.walker) waypoints.pause(ctrl.walker);
        if (!this.leader) { sfxAt(w, SND_TRAIN.WHISTLE, [rec.x, rec.y, rec.z]); this.coasting = true; }
        this.stopTicks = TRAIN.STOP_TICKS;
        this.riding = false; this.moving = true;
        w.pep.mailbox = TRAIN.CLIP_IDLE;
        P.anim?.start(TRAIN.CLIP_IDLE, 0);
        w.vars.set(0x5e, TRAIN.PC_WALK);
        V.current = null;
        g.boarded = false;
        this.phase = 2;
      }
    }
  }

  /** FUN_0053d935 */
  destroy(w: World) { tryCtx(w)?.stopSfx(SND_TRAIN.RUN); tryCtx(w)?.stopSfx(SND_TRAIN.COAST); }
}

registerCtor(CTOR_TRAIN, (a) => new TrainNode(ArgView.of(a), a));
