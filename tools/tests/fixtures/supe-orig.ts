// FROZEN COPY of src/island/pizza/supe.ts as it was before the developer corner's manual-flight hook (tools/tests/devcorner-vliegen.mjs registers it for a side-by-side
// run: the default flow must stay byte-identical). Do not edit; paths adjusted only.
// SupaStat.c, the other half (Common\Z02LGI\c_src\SupaStat.c): SUPE, the flying super-hero of the island's two railway stations ("Super Station").
// He patrols the OTH waypoint map (a sky network round the hub CTR, node 10, 105 units up), lands at the station at Pepper's end of the island
// (STAT1_IN 0x2f in the south when her z > zoneA, STAT2_IN 6 in the north when z < zoneB) and stands there (the SGMFIG / Turn2Pep nodes of the same
// record let her talk to him), and **rescues Pepper from the railway**: when she stands on the track (surface 9, or surface 10 within 32 units of
// the locomotive) at height 41..48 for 3 ticks (at once when the locomotive is within 24), he swoops to her, picks her up (clip 0x8c backwards,
// PEPPER_CONTROL 0x80), rises over the nearest of ten track nodes (flying along the east line first when she was on it), carries her to the
// nearest helipad exit node, puts her down (clip 0x8c forwards, PEPPER_CONTROL 1) and flies back to the hub. Ported from the decompile of
//   FUN_0053c337  constructor (node 0x54, handler table 0x8eb0f0): the zones, the first goal, the place                 -> SupeNode.init
//   FUN_0053adc3  update: the rescue trigger, the 17 states                                                            -> SupeNode.update
//   FUN_0053c25a  pre-render: MOVE_SUPE |= 0x20000 (no talking) while carrying                                         -> SupeNode.prerender
//   FUN_0053c526  destroy (the flight loop off)   FUN_0053c29d draw = the default   FUN_0053c2fe / FUN_0053c2d9 load / save (not ported)
//   FUN_00539eb1  steering along the OTH route (with the original's turn quirks)                                       -> SupeNode.steer
//   FUN_0053a35d  the landing station for Pepper's z (and the speed doubling)                                          -> SupeNode.landing
//   FUN_0053a3dd  a random OTH node 0..4      FUN_0053a41b nearest track node (DAT_008eb114)      FUN_0053a4f7 nearest helipad exit node
//   FUN_0053a5ea  yaw / pitch / distance to a point    FUN_0053a7d8 turn towards them    FUN_0053aa8e fly at 2.4 per tick
//   FUN_0053a6c2  appear 24 units behind the camera    FUN_0053ac79 Pepper hangs at his hand    FUN_0053ab93 the camera follows him
//   FUN_00539e30  the skateboard's rolling sounds off
// docs/re/m4/wp14-supe.md.
import type { BehaviourNode, Controller } from '../../../src/game/controller.ts';
import { NODE_NONE, NODE_STOP } from '../../../src/game/controller.ts';
import type { GameRecord } from '../../../src/game/record.ts';
import { RF_ENABLED, RF_NO_COLLIDE } from '../../../src/game/record.ts';
import type { World } from '../../../src/game/world.ts';
import { NO_GROUND } from '../../../src/game/collision.ts';
import { MAP_OTH, MAP_PATH, MAP_ROAD, waypoints } from '../../../src/game/walker.ts';
import { buildMatrix } from '../../../src/formats/matrix.ts';
import { registerCtor } from '../../../src/game/setup.ts';
import type { Attach } from '../../../src/formats/zonesetup.ts';
import { tryCtx } from '../../../src/island/ctx.ts';
import { vehicles } from '../../../src/island/vehicles/common.ts';
import { inView } from '../../../src/island/npc/globals.ts';
import { cutsceneActive, sfx } from '../../../src/island/pizza/common.ts';

export const CTOR_SUPE = 0x53c337;

/** sound ids (FUN_00443580 handles of FUN_004b0b37): DAT_05d582f4 the flight loop (Thrust.wav), DAT_05d580fc Pepper put down (Pep_Down.wav), DAT_05d58124 picked up (Pep_Up.wav) */
export const SND_SUPE = { FLY: 0x37b, DOWN: 0x37c, UP: 0x37d } as const;
/** FUN_00539e30: the skateboard's surface loops (DAT_05d57fe0 / fd0 / fe8 / fcc / fdc / fd8 / fc8 / fd4) */
const SKATE_SOUNDS = [0x180, 0x17f, 0x182, 0x185, 0x185, 300, 0x181, 0x184] as const;

export const SUPE = {
  /** the record 158 (TRNL) whose controller distance the trigger reads (DAT_00983804 + 0x408c), Pepper = record 16 for the zone test (+0x6c4) */
  TRAIN_REC: 158, PEP_REC: 16, BOARD_REC: 9,
  /** DAT_009da9ac: the rail (9) / the train's top (10) */
  SURF_RAIL: 9, SURF_TRAIN: 10,
  /** squared distances to the locomotive: 1024 (0x8925e8) surface 10 counts, 576 (0x8921a0) at once */
  TRAIN_NEAR2: 1024, TRAIN_CLOSE2: 576,
  /** the trigger: 3 ticks (0x892200), the timer forced to 4 (0x40800000), Pepper's height window 41 / 48 (0x8925e4 / 0x8925e0) */
  WAIT: 3, WAIT_FORCED: 4, Y_MIN: 41, Y_MAX: 48,
  /** east line test: |Pepper x - x of ROAD 0x67| < 24 (0x8921a4); the camera distance limit 1600 (0x8925dc); appear 24 back, 8 up (0x892090) */
  EAST_NEAR: 24, CAM_FAR: 1600, APPEAR_BACK: 24, APPEAR_UP: 8,
  /** DAT_008eb10c the cruise speed (doubled by FUN_0053a35d), DAT_008eb108 15 ticks of look-ahead, DAT_008eb110 squared arrival 10.24 */
  SPEED: 1.600000023841858, AHEAD: 15, ARRIVE2: 10.239999771118164,
  /** zones: a quarter (0x892134) of the OTH line node 0 .. 0x39 in from both ends; +0x1c / +0x20 a tenth (0x8920cc, unused) */
  ZONE: 0.25, ZONE10: 0.10000000149011612,
  /** OTH nodes: hub, the stations (IN / OUT), the takeoff hub 0x37; the ROAD node of the east line (DAT_008eb114 has the ten track nodes) */
  HUB: 10, STAT2_IN: 6, STAT2_OUT: 0x39, STAT1_IN: 0x2f, STAT1_OUT: 0, VIA: 0x37,
  EAST_A: 0x67, EAST_B: 0x60, TRACK: [0x69, 0x61, 0x63, 0x65, 0x60, 0x62, 0x64, 0x66, 0x67, 0x68] as const,
  /** vertical speeds: 0.8 (0x892084) landing / taking off / rising, 1.6 (0x892580) at the helipad; x alignment 0.4 (0x892118) */
  VY: 0.800000011920929, VY_PAD: 1.600000023841858, ALIGN: 0.4000000059604645,
  /** FUN_0053aa8e: 2.4 per tick (0x8920a8) */
  FLY: 2.4000000953674316,
  /** heights above the targets: 12 (0x892024), 16 (0x8921f4), 80 (0x8921b0); probe 4 up (0x892080), terrain from 8 (0x41000000) / 40 / 4 up */
  UP12: 12, UP16: 16, UP80: 80,
  /** arrival radii and turn rates of the states (the call arguments) */
  R_PEP: 6, R_TRACK: 48, R_PAD_HIGH: 80, R_PAD_LOW: 24, R_PAD: 4,
  TURN5: 0.0872659981250763, TURN15: 0.2617993950843811, TURN20: 0.3490659892559052,
  /** the camera: (0, 10, -14) (DAT_008eb150) / (0, 0, -14) (DAT_008eb160) in his yawed frame, the look-at 4 above him; the eases */
  CAM_A: [0, 10, -14] as const, CAM_B: [0, 0, -14] as const, CAM_LOOK_UP: 4,
  EASE: [0.009999999776482582, 0.019999999552965164, 0.03999999910593033, 0.07999999821186066, 0.20000000298023224] as const,
  /** clips: fly loop 0xd2, grab / land 0x8c, idle 0x78; Pepper idle 0x1b */
  CLIP_FLY: 0xd2, CLIP_GRAB: 0x8c, CLIP_IDLE: 0x78, CLIP_PEP_IDLE: 0x1b,
  /** PEPPER_CONTROL while carried / afterwards; the "no talking" bit of the state word */
  PC: 0x5e, PC_CARRIED: 0x80, PC_WALK: 1, NO_TALK: 0x20000,
} as const;

/** DAT_00987660: 1 in a 16-bit colour display mode (FUN_00409xxx); the port renders 32-bit, so the east-line flight is taken (0) */
const DISPLAY_16BIT = false;

/** the uninitialised words of the node block (debug heap fill 0xCD): float 0xcdcdcdcd, byte 0xcd */
const CD_FLOAT = -431602080, CD_BYTE = -51;

/** the states (+0x38) */
export const ST = {
  STAND: 0, LAND: 1, FLY: 2, FLY_FREE: 3, ARRIVED: 4, TAKEOFF_5: 5, SWOOP: 6, TAKEOFF: 7, LIFT: 8,
  EAST_TURN: 9, EAST_ALIGN: 10, TRACK: 0xb, PAD_HIGH: 0xc, PAD_LOW: 0xd, PAD: 0xe, DROP: 0xf, RISE: 0x10,
} as const;

const fabs = Math.abs;

/** FUN_0053a3dd: trunc(random * 5) until <= 4 */
function randomNode(): number { let i: number; do { i = Math.trunc(Math.random() * 5); } while (i > 4); return i; }

/** FUN_0053a5ea(rec, p): yaw atan2(dx, dz), pitch atan2(-dy, horizontal), the distance */
function aim(rec: GameRecord, p: ArrayLike<number>) {
  const dx = p[0] - rec.x, dy = p[1] - rec.y, dz = p[2] - rec.z;
  const h = Math.sqrt(dz * dz + dx * dx);
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(-dy, h), dist: Math.sqrt(dz * dz + dy * dy + dx * dx) };
}

const wrap = (a: number) => (a < -Math.PI ? a + 2 * Math.PI : a > Math.PI ? a - 2 * Math.PI : a);

/** FUN_0043a4a1(rec + 0xc, rx, ry, rz): the rotation, the position kept */
function setRot(rec: GameRecord, rx: number, ry: number, rz: number) { rec.setEuler(rx, ry, rz, rec.x, rec.y, rec.z); }

/** FUN_0053a7d8(rec, yaw, pitch, rate): turn by `rate` per tick (snap within 2 * rate); 1 when the yaw was reached */
function turnTo(w: World, rec: GameRecord, yaw: number, pitch: number, rate: number): boolean {
  let dy = yaw - rec.ry, dp = pitch - rec.rx;
  rec.rz = dp;
  dy = wrap(dy); dp = wrap(dp);
  let done = false;
  if (fabs(dy) < rate + rate) { rec.ry = yaw; done = true; }
  else if (-rate * w.dt <= dy) rec.ry += rate * w.dt;
  else rec.ry -= rate * w.dt;
  if (fabs(dp) < 2 * rate) rec.rx = pitch;
  else if (-rate * w.dt <= dp) rec.rx += rate * w.dt;
  else rec.rx -= rate * w.dt;
  rec.ry = wrap(rec.ry); rec.rz = wrap(rec.rz); rec.rx = wrap(rec.rx);
  setRot(rec, rec.rx, rec.ry, rec.rz);
  return done;
}

/** FUN_0053aa8e(rec, node, p, radius, rate): turn, then 2.4 forward; 1 when p was within `radius` before the step */
function flyTo(w: World, rec: GameRecord, p: ArrayLike<number>, radius: number, rate: number): boolean {
  const a = aim(rec, p);
  turnTo(w, rec, a.yaw, a.pitch, rate);
  const k = SUPE.FLY * w.dt;
  rec.x += k * rec.fx; rec.y += k * rec.fy; rec.z += k * rec.fz;
  return a.dist < radius * w.dt;
}

/** FUN_0043cd62(p, dy) with NO_GROUND kept apart */
function ground(w: World, p: ArrayLike<number>, dy: number): number { return w.col.terrainHeight(p[0], p[1], p[2], dy); }

export class SupeNode implements BehaviourNode {
  readonly kind = 'supe';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  inited = false;
  /** +0x14 / +0x18: Pepper's z beyond which he lands in the south (0x2f) / north (6); +0x1c / +0x20 the tenth (unused) */
  zoneA = 0; zoneB = 0; zoneA10 = 0; zoneB10 = 0;
  /** +0x24: x of ROAD node 0x67 (the east line) */
  eastX = 0;
  /** +0x28 the destination (OTH), +0x2c the node he flies at, +0x30 the one after it */
  dest = 0; goal = 0; next = 0;
  /** +0x34 the cruise speed */
  speed: number = SUPE.SPEED;
  /** +0x38 the state, +0x39 land at once (never set), +0x3a the steering bits (1 yaw / 2 pitch turning, 4 compute the rates), +0x3b 0 free / 1 detour / 2 landing */
  state: number = ST.FLY; landNow = 0; steerBits = CD_BYTE; mode = 0;
  /** +0x3c / +0x40 the pitch / yaw turn rates of the steering, +0x44 the ticks of a turn */
  pitchRate = CD_FLOAT; yawRate = CD_FLOAT; steerTicks = CD_FLOAT;
  /** +0x48 the track node (ROAD) he rises over, +0x4a the helipad exit node (PATH), +0x4c fly the east line first */
  road = 0; pad = 0; east = 0;
  /** +0x50 the ticks Pepper has been on the rail */
  timer = CD_FLOAT;
  /** DAT_05d586e8: ticks of the pick-up (counted, not read) */
  liftTicks = 0;

  constructor(attach?: Attach) {
    this.var = attach?.var ?? 0xa8; this.mask = attach?.mask ?? 0; this.value = attach?.value ?? 0;
  }

  /** FUN_0053c337 (run on the first update, after the SGMFIG node of the record has put him on the ground as the original's order does) */
  init(w: World, rec: GameRecord) {
    if (this.inited) return;
    this.inited = true;
    const a = waypoints.nodePos(MAP_OTH, 0), b = waypoints.nodePos(MAP_OTH, SUPE.STAT2_OUT);
    const q = (a[2] - b[2]) * SUPE.ZONE;
    this.zoneA = a[2] - q; this.zoneB = b[2] + q;
    const t = (a[2] - b[2]) * SUPE.ZONE10;
    this.zoneA10 = a[2] - t; this.zoneB10 = b[2] + t;
    const l = this.landing(w);
    this.speed = SUPE.SPEED;
    if (l < 0) { this.mode = 0; this.dest = randomNode(); this.goal = SUPE.HUB; this.next = this.goal; this.state = ST.FLY; }
    else { this.mode = 1; this.dest = l; this.goal = l === SUPE.STAT2_IN ? SUPE.STAT2_OUT : SUPE.STAT1_OUT; this.next = this.goal; this.state = ST.STAND; }
    this.landNow = 0;
    const p = waypoints.nodePos(MAP_OTH, this.goal);
    rec.x = p[0]; rec.y = p[1]; rec.z = p[2];
    this.eastX = waypoints.nodePos(MAP_ROAD, SUPE.EAST_A)[0];
    rec.savePrev();
  }

  /** FUN_0053a35d: 0x2f (Pepper's z > zoneA), 6 (z < zoneB) or -1; the speed doubles when the steering bits are 0 */
  landing(w: World): number {
    const pz = w.records[SUPE.PEP_REC]?.z ?? 0;
    if (pz <= this.zoneA) {
      if (this.zoneB <= pz) return -1;
      if (this.steerBits === 0) this.speed = SUPE.SPEED + SUPE.SPEED;
      return SUPE.STAT2_IN;
    }
    if (this.steerBits === 0) this.speed = SUPE.SPEED + SUPE.SPEED;
    return SUPE.STAT1_IN;
  }

  private route(a: number, b: number) { return waypoints.route(MAP_OTH, a, b); }

  /**
   * FUN_00539eb1: retarget within 3.2 of the goal (or 15 ticks before it), aim at the goal; with the steering bits 0 the angles snap (and with 4 the
   * turn rates for the next leg are computed: cot(half the change) / 15, the yaw always from a zero change = infinite); else turn by the rates, which
   * the original does AWAY from the target (`-rate <= d` subtracts), until a bit's angle is within its rate or 15 ticks have passed.
   */
  steer(w: World, rec: GameRecord) {
    let t = waypoints.nodePos(MAP_OTH, this.goal);
    let dx = t[0] - rec.x, dy = t[1] - rec.y, dz = t[2] - rec.z;
    const d2 = dz * dz + dy * dy + dx * dx;
    if (d2 < SUPE.ARRIVE2) {
      this.goal = this.route(this.goal, this.dest);
      this.next = this.route(this.goal, this.dest);
      this.steerBits = 4;
      if (this.goal === this.next) { this.state = ST.ARRIVED; return; }
      t = waypoints.nodePos(MAP_OTH, this.goal);
      dx = t[0] - rec.x; dy = t[1] - rec.y; dz = t[2] - rec.z;
    } else if (d2 < this.speed * SUPE.AHEAD * this.speed * SUPE.AHEAD) {
      this.goal = this.route(this.goal, this.dest);
      this.next = this.route(this.goal, this.dest);
      this.steerBits = 7;
      this.steerTicks = 0;
    }
    const h = Math.sqrt(dz * dz + dx * dx);
    const yaw = Math.atan2(dx, dz), pitch = Math.atan2(-dy, h);
    const dyaw = yaw - rec.ry, dpitch = pitch - rec.rx;
    rec.rz = dpitch;
    if ((this.steerBits & 3) === 0) {
      rec.rx = pitch; rec.ry = yaw;
      if (this.steerBits & 4) {
        this.steerBits = 0;
        const n = waypoints.nodePos(MAP_OTH, this.next);
        const sx = n[0] - t[0], sy = n[1] - t[1], sz = n[2] - t[2];
        const pitch2 = Math.atan2(sy, Math.sqrt(sz * sz + sx * sx));   // (not negated in the original)
        const a = fabs(yaw - rec.ry) * 0.5, b = fabs(pitch2 - rec.rx) * 0.5;
        this.yawRate = Math.cos(a) / (Math.sin(a) * SUPE.AHEAD);
        this.pitchRate = Math.cos(b) / (Math.sin(b) * SUPE.AHEAD);
      }
    } else {
      if (fabs(dyaw) < this.yawRate) { rec.ry = yaw; this.steerBits &= ~1; }
      else if (-this.yawRate * w.dt <= dyaw) rec.ry = rec.ry - this.yawRate * w.dt;
      else rec.ry = this.yawRate * w.dt + rec.ry;
      if (fabs(dpitch) < this.pitchRate) { rec.rx = pitch; this.steerBits &= ~2; }
      else if (-this.pitchRate * w.dt <= dpitch) rec.rx = rec.rx - this.pitchRate * w.dt;
      else rec.rx = this.pitchRate * w.dt + rec.rx;
      this.steerTicks = 1.0 * w.dt + this.steerTicks;
      if (SUPE.AHEAD < this.steerTicks) this.steerBits = 0;
    }
  }

  /** FUN_0053a41b / FUN_0053a4f7: the nearest track node (ROAD) / helipad exit node (PATH, WP6's pad table) to Pepper */
  private nearestTrack(P: GameRecord): number {
    let best = 1e38, bi = -1;
    SUPE.TRACK.forEach((n, i) => { const p = waypoints.nodePos(MAP_ROAD, n); const d = (p[2] - P.z) ** 2 + (p[1] - P.y) ** 2 + (p[0] - P.x) ** 2; if (d < best) { best = d; bi = i; } });
    return SUPE.TRACK[bi < 0 ? 0 : bi];
  }
  private nearestPad(w: World, P: GameRecord): number {
    const pads = vehicles(w).pads;
    let best = 1e38, bi = -1;
    pads.forEach((b, i) => { const p = waypoints.nodePos(b.map, b.exit); const d = (p[2] - P.z) ** 2 + (p[1] - P.y) ** 2 + (p[0] - P.x) ** 2; if (d < best) { best = d; bi = i; } });
    return pads[bi < 0 ? 0 : bi]?.exit ?? 0;
  }

  /** FUN_0053a6c2: 24 units behind the camera eye (on the line to Pepper) and 8 up, facing her */
  private appear(w: World, rec: GameRecord, P: GameRecord) {
    const c = w.camera.c;
    rec.x = c[0]; rec.y = c[1]; rec.z = c[2];
    const d = [P.x - rec.x, P.y - rec.y, P.z - rec.z];
    const l = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (l !== 0) { const k = 1 / Math.sqrt(l); d[0] *= k; d[1] *= k; d[2] *= k; }
    rec.x -= d[0] * SUPE.APPEAR_BACK; rec.y -= d[1] * SUPE.APPEAR_BACK; rec.z -= d[2] * SUPE.APPEAR_BACK;
    rec.y += SUPE.APPEAR_UP;
    const a = aim(rec, [P.x, P.y, P.z]);
    rec.ry = a.yaw; rec.rx = a.pitch;
  }

  /** FUN_0053ac79: PEPPER_CONTROL 0x80, Pepper's matrix = his, 1 below and 1 to the left (minus the up and right rows) */
  private carry(w: World, rec: GameRecord, P: GameRecord) {
    w.vars.set(SUPE.PC, SUPE.PC_CARRIED);
    P.m.set(rec.m);
    P.x -= rec.m[4]; P.y -= rec.m[5]; P.z -= rec.m[6];
    P.x -= rec.m[0]; P.y -= rec.m[1]; P.z -= rec.m[2];
  }

  /** FUN_0053ab93(DAT_009da5e8, rec, off, ease): look at him + 4, the eye eases to `off` in his yawed frame */
  private camera(w: World, rec: GameRecord, off: readonly number[], ease: number) {
    const m = buildMatrix(0, rec.ry, 0, rec.x, rec.y, rec.z);
    const c = w.camera.c;
    c[3] = rec.x; c[4] = rec.y + SUPE.CAM_LOOK_UP; c[5] = rec.z;
    const e = [off[0] * m[0] + off[1] * m[4] + off[2] * m[8] + m[12], off[0] * m[1] + off[1] * m[5] + off[2] * m[9] + m[13], off[0] * m[2] + off[1] * m[6] + off[2] * m[10] + m[14]];
    for (let i = 0; i < 3; i++) c[i] = (e[i] - c[i]) * ease * w.dt + c[i];
  }

  private stopSkate(w: World) { const c = tryCtx(w); if (c) for (const id of SKATE_SOUNDS) c.stopSfx(id); }
  private trackPoint(up: number): number[] { const p = waypoints.nodePos(MAP_ROAD, this.road); p[1] += up; return p; }
  private padPoint(up: number): number[] { const p = waypoints.nodePos(MAP_PATH, this.pad); p[1] += up; return p; }
  private rise(w: World, rec: GameRecord, y: number) {
    if (rec.y < y) rec.y = SUPE.VY * w.dt + rec.y;
    if (y < rec.y) rec.y = y;
  }
  /** Pepper keeps / takes the fly clip (states 0xd / 0xe) */
  private pepFly(P: GameRecord) { if (P.anim?.clip === SUPE.CLIP_FLY) P.anim.advance(1.0); else P.anim?.start(SUPE.CLIP_FLY, 0); }
  /** a cutscene took over: back to free flight towards the hub, non-solid */
  private toHub(rec: GameRecord) {
    rec.anim?.start(SUPE.CLIP_FLY, 0);
    rec.flags |= RF_NO_COLLIDE;
    this.state = ST.FLY_FREE; this.mode = 0; this.goal = SUPE.HUB;
  }
  /** LAB_0053c178: start landing at the station he reached; the takeoff goal (OUT node) of that station */
  private land(rec: GameRecord) {
    this.state = ST.LAND;
    rec.anim?.start(SUPE.CLIP_GRAB, 0);
    rec.rz = 0;
    this.goal = this.goal === SUPE.STAT2_IN ? SUPE.STAT2_OUT : SUPE.STAT1_OUT;
  }

  /** the trigger of FUN_0053adc3: Pepper on the rail long enough */
  private call(w: World, rec: GameRecord, P: GameRecord, train2: number) {
    this.road = this.nearestTrack(P);
    this.pad = this.nearestPad(w, P);
    if (!DISPLAY_16BIT && fabs(P.x - this.eastX) < SUPE.EAST_NEAR) {
      this.east = 1;
      this.road = this.road === SUPE.EAST_A ? SUPE.EAST_B : SUPE.EAST_A;
    } else this.east = 0;
    vehicles(w).current = null;
    if (!inView(w, rec) || train2 <= SUPE.TRAIN_CLOSE2) {
      this.state = ST.SWOOP;
      rec.anim?.start(SUPE.CLIP_FLY, 0);
      this.appear(w, rec, P);
      return;
    }
    const c = w.camera.c;
    const ex = rec.x - c[0], ey = rec.y - c[1], ez = rec.z - c[2];
    if (Math.sqrt(ez * ez + ey * ey + ex * ex) <= SUPE.CAM_FAR) {
      if (this.state === ST.STAND) {
        this.state = ST.TAKEOFF;
        this.stopSkate(w);
        rec.rz = 0; rec.rx = 0;
        rec.anim?.start(SUPE.CLIP_GRAB, 0);
        if (rec.anim) rec.anim.seek(rec.anim.frameCount - 1.0);
      } else { this.state = ST.SWOOP; rec.anim?.start(SUPE.CLIP_FLY, 0); }
    } else {
      this.state = ST.SWOOP;
      rec.anim?.start(SUPE.CLIP_FLY, 0);
      this.appear(w, rec, P);
    }
  }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    if (!this.inited) this.init(w, rec);
    const P = w.focus;
    if (!P) return NODE_STOP;
    const tc = w.records[SUPE.TRAIN_REC]?.ctrl ?? null;
    const train2 = tc ? tc.distSq : 1e38;
    const surf = w.pep.surfaceAtFeet;
    const nearTrain = surf === SUPE.SURF_TRAIN ? train2 < SUPE.TRAIN_NEAR2 : false;
    if (surf === SUPE.SURF_RAIL || nearTrain) {
      this.timer = 1.0 * w.dt + this.timer;
      if (train2 < SUPE.TRAIN_CLOSE2) this.timer = SUPE.WAIT_FORCED;
      if (SUPE.WAIT <= this.timer && this.state < 5 && SUPE.Y_MIN < P.y && P.y < SUPE.Y_MAX) this.call(w, rec, P, train2);
    } else this.timer = 0;

    // Pepper at one end of the island: plan the landing at that station
    if (this.state < 5 && this.mode === 0) {
      const l = this.landing(w);
      if (l >= 0) {
        if (this.route(this.goal, l) < 0) this.mode = 1;
        else { this.dest = l; this.mode = 2; }
      }
    }

    let s = this.state;
    for (;;) {
      switch (s) {
        case ST.STAND: {
          if (rec.anim?.clip !== SUPE.CLIP_GRAB) {
            const l = this.landing(w);
            this.landNow = 0;
            if (l >= 0) return NODE_NONE;     // Pepper still at his end: the Turn2Pep nodes behind him run (face her)
            this.dest = SUPE.HUB; this.state = ST.FLY; this.steerBits = 4; this.mode = 0;
            rec.anim?.start(SUPE.CLIP_FLY, 0);
            s = ST.FLY; continue;
          }
          if (rec.anim && rec.anim.advance(1.0) !== 0) rec.anim.start(SUPE.CLIP_IDLE, 0);
          break;
        }
        case ST.LAND: {
          let g = ground(w, [rec.x, rec.y, rec.z], 8);
          const from = [rec.x, rec.y + 4, rec.z];
          if (g > NO_GROUND) {
            const h = w.col.probe(rec, from, [0, g - from[1], 0], 3);
            if (h) g = h.point[1];
          }
          if (SUPE.VY <= rec.y - g) rec.y = rec.y - SUPE.VY;
          else { this.state = ST.STAND; rec.rz = 0; rec.rx = 0; }
          if (rec.anim && rec.anim.advance(1.0) !== 0) rec.anim.start(SUPE.CLIP_IDLE, 0);
          break;
        }
        case ST.FLY: case ST.FLY_FREE: {
          const l = this.mode !== 0 ? this.landing(w) : -1;
          if (this.mode === 0 || l < 0 || this.landNow === 0) {
            this.steer(w, rec);
            setRot(rec, rec.rx, rec.ry, rec.rx);      // FUN_0043a4a1(m, rx, ry, rx): the roll = the pitch
            rec.x += this.speed * rec.fx; rec.y += this.speed * rec.fy; rec.z += this.speed * rec.fz;
          } else {
            this.landNow = 0; this.goal = l; rec.rz = 0; rec.rx = 0;
            this.land(rec);
          }
          break;
        }
        case ST.ARRIVED: {
          if (this.mode === 0) {
            this.state = ST.FLY; this.goal = randomNode(); this.next = this.route(this.goal, this.dest);
          } else if (this.mode === 1) {
            const l = this.landing(w);
            if (l < 0) { this.state = ST.FLY; this.goal = randomNode(); this.next = this.route(this.goal, this.dest); this.mode = 0; }
            else { this.goal = SUPE.VIA; this.state = ST.FLY; this.dest = l; this.next = this.route(this.goal, this.dest); }
          } else this.land(rec);
          break;
        }
        case ST.TAKEOFF_5: case ST.TAKEOFF: {
          rec.y = SUPE.VY * w.dt + rec.y;
          rec.anim?.advance(-1.0);
          if ((rec.anim?.frame ?? 0) <= 0) {
            if (!cutsceneActive(w)) { rec.anim?.start(SUPE.CLIP_FLY, 0); this.state = ST.SWOOP; }
            else this.toHub(rec);
          }
          return NODE_STOP;
        }
        case ST.SWOOP: {
          if (flyTo(w, rec, [P.x, P.y, P.z], SUPE.R_PEP, SUPE.TURN15)) {
            if (!cutsceneActive(w)) {
              this.state = ST.LIFT;
              this.stopSkate(w);
              sfx(w, SND_SUPE.UP);
              sfx(w, SND_SUPE.FLY);
              rec.anim?.start(SUPE.CLIP_GRAB, 0);
              if (rec.anim) rec.anim.seek(rec.anim.frameCount - 1.0);
              P.anim?.start(SUPE.CLIP_GRAB, 0);
              if (P.anim) P.anim.seek(P.anim.frameCount - 1.0);
              this.liftTicks = 0;
              const tg = w.ext.get('train') as { boarded: boolean } | undefined;   // DAT_05d586ec (train.ts): a rider is let go
              if (tg) tg.boarded = false;
              return NODE_STOP;
            }
            this.toHub(rec);
          }
          break;
        }
        case ST.LIFT: {
          this.stopSkate(w);
          const t = this.trackPoint(SUPE.UP12);
          this.rise(w, rec, t[1]);
          const f = (rec.anim?.frame ?? 0) - 1.0 * w.dt;
          this.liftTicks++;
          if (0 < f) {
            rec.anim?.seek(f);
            P.anim?.start(SUPE.CLIP_GRAB, f);
          } else {
            vehicles(w).current = null;
            rec.anim?.start(SUPE.CLIP_FLY, 0);
            P.anim?.start(SUPE.CLIP_FLY, 0);
            // (PEPPER_CONTROL & 4: DAT_05d58009 = 1, the skateboard's motion reset; never true here: the carry set 0x80 the ticks before)
            this.state = this.east === 0 ? ST.PAD_HIGH : ST.EAST_TURN;
          }
          if (this.road === SUPE.EAST_A || this.road === SUPE.EAST_B) {
            const a = aim(rec, this.trackPoint(SUPE.UP16));
            turnTo(w, rec, a.yaw, a.pitch, SUPE.TURN5);
          }
          this.carry(w, rec, P);
          this.camera(w, rec, SUPE.CAM_A, SUPE.EASE[0]);
          return NODE_STOP;
        }
        case ST.EAST_TURN: {
          const a = aim(rec, this.trackPoint(SUPE.UP12));
          if (turnTo(w, rec, a.yaw, a.pitch, SUPE.TURN5)) this.state = ST.EAST_ALIGN;
          if (fabs(rec.x - this.eastX) < SUPE.ALIGN) rec.x = this.eastX;
          else rec.x = this.eastX <= rec.x ? rec.x - SUPE.ALIGN : rec.x + SUPE.ALIGN;
          this.carry(w, rec, P);
          this.camera(w, rec, SUPE.CAM_A, SUPE.EASE[0]);
          break;
        }
        case ST.EAST_ALIGN: {
          const a = aim(rec, this.trackPoint(SUPE.UP12));
          turnTo(w, rec, a.yaw, a.pitch, SUPE.TURN5);
          rec.flags |= RF_NO_COLLIDE;
          if (fabs(rec.x - this.eastX) < SUPE.ALIGN) { this.state = ST.TRACK; s = ST.TRACK; continue; }
          rec.x = this.eastX <= rec.x ? rec.x - SUPE.ALIGN : rec.x + SUPE.ALIGN;
          this.carry(w, rec, P);
          this.camera(w, rec, SUPE.CAM_A, SUPE.EASE[0]);
          break;
        }
        case ST.TRACK: {
          w.vars.set(SUPE.PC, SUPE.PC_CARRIED);
          const t = this.trackPoint(SUPE.UP16);
          if (flyTo(w, rec, t, SUPE.R_TRACK, SUPE.TURN5)) this.state = ST.PAD_HIGH;
          rec.flags |= RF_NO_COLLIDE;
          P.anim?.advance(1.0);
          this.rise(w, rec, t[1]);
          this.carry(w, rec, P);
          this.camera(w, rec, SUPE.CAM_B, SUPE.EASE[1]);
          break;
        }
        case ST.PAD_HIGH: {
          w.vars.set(SUPE.PC, SUPE.PC_CARRIED);
          const t = this.padPoint(SUPE.UP80);
          rec.flags |= RF_NO_COLLIDE;
          if (flyTo(w, rec, t, SUPE.R_PAD_HIGH, SUPE.TURN5)) this.state = ST.PAD_LOW;
          P.anim?.advance(1.0);
          this.rise(w, rec, t[1]);
          this.carry(w, rec, P);
          this.camera(w, rec, SUPE.CAM_A, SUPE.EASE[2]);
          break;
        }
        case ST.PAD_LOW: {
          const t = this.padPoint(SUPE.UP16);
          const arrived = flyTo(w, rec, t, SUPE.R_PAD_LOW, SUPE.TURN5);
          rec.flags |= RF_NO_COLLIDE;
          if (arrived) this.state = ST.PAD;
          this.pepFly(P);
          this.carry(w, rec, P);
          this.camera(w, rec, SUPE.CAM_A, SUPE.EASE[3]);
          break;
        }
        case ST.PAD: {
          const t = this.padPoint(0);
          const g = ground(w, t, 8);
          t[1] = (g > NO_GROUND ? g : t[1]) + SUPE.UP16;   // (the original takes the terrain unchecked)
          const arrived = flyTo(w, rec, t, SUPE.R_PAD, SUPE.TURN20);
          rec.flags |= RF_NO_COLLIDE;
          if (!arrived) this.pepFly(P);
          else { P.anim?.start(SUPE.CLIP_GRAB, 0); rec.anim?.start(SUPE.CLIP_GRAB, 0); this.state = ST.DROP; }
          this.carry(w, rec, P);
          this.camera(w, rec, SUPE.CAM_A, SUPE.EASE[3]);
          break;
        }
        case ST.DROP: {
          rec.y = rec.y - SUPE.VY_PAD * w.dt;
          const r = rec.anim ? rec.anim.advance(1.0) : 2;
          if (r === 0) {
            P.anim?.start(SUPE.CLIP_GRAB, rec.anim?.frame ?? 0);
            this.carry(w, rec, P);
          } else {
            vehicles(w).current = null;
            w.vars.set(SUPE.PC, SUPE.PC_WALK);
            P.anim?.start(SUPE.CLIP_PEP_IDLE, 0);
            w.pep.mailbox = SUPE.CLIP_PEP_IDLE;          // DAT_008ae088
            const g = ground(w, [P.x, P.y, P.z], 4);
            if (g > NO_GROUND) P.y = g;
            P.ry = rec.ry;
            setRot(P, 0, rec.ry, 0);
            this.state = ST.RISE;
            sfx(w, SND_SUPE.DOWN);
            tryCtx(w)?.stopSfx(SND_SUPE.FLY);
            this.mode = 0;
            const b = w.records[SUPE.BOARD_REC];
            if (b) b.flags &= ~RF_ENABLED;              // the skateboard (record 9) is hidden
            rec.flags |= RF_NO_COLLIDE;
            rec.anim?.start(SUPE.CLIP_GRAB, 0);
            if (rec.anim) rec.anim.seek(rec.anim.frameCount - 1.0);
          }
          const g = ground(w, [P.x, P.y, P.z], 40);
          if (P.y < g) P.y = g;
          if (rec.y < g) rec.y = g;
          this.camera(w, rec, SUPE.CAM_A, SUPE.EASE[4]);
          return NODE_STOP;
        }
        case ST.RISE: {
          rec.y = SUPE.VY_PAD * w.dt + rec.y;
          rec.anim?.advance(-1.0);
          if ((rec.anim?.frame ?? 0) <= 0) {
            rec.anim?.start(SUPE.CLIP_FLY, 0);
            rec.flags &= ~RF_NO_COLLIDE;
            this.state = ST.FLY_FREE; this.mode = 0; this.goal = SUPE.HUB;
          }
          return NODE_STOP;
        }
        default: break;
      }
      break;
    }
    // the fly clip runs on while the node ran the frame before (stamp = frame counter), else it starts again
    if (this.stamp === w.frame) rec.anim?.advance(1.0);
    else rec.anim?.start(SUPE.CLIP_FLY, 0);
    return NODE_STOP;
  }

  /** FUN_0053c25a: no talking to him while he swoops / carries */
  prerender(w: World) { if (this.state > 4) w.vars.or(this.var, SUPE.NO_TALK); }

  /** FUN_0053c526 */
  destroy(w: World) { tryCtx(w)?.stopSfx(SND_SUPE.FLY); }
}

registerCtor(CTOR_SUPE, (a) => new SupeNode(a));
