// The horse of the castle island (record HORS = 48, ctor FUN_00579178, source "Horse.c" = Common\Z07CSI\Horse.c at 0x8f8618, node 0x5c bytes, handler table 0x8f85c0 = { update FUN_005769a8
// (839 lines), pre-render FUN_00578f2d, destroy FUN_00579328, draw FUN_00578fcf (the default mesh draw FUN_00444480), save FUN_0057900b / load FUN_005790c9 }). Gate: var 0x112 (SWITCH_CSI_HORSE)
// & 0 = always open, the node reads the variable's VALUE (param_4): bit 0 = "ridden", bit 0x10 = "busy" (jumping: Ctrl may not get off).
// Every operation of the update rounds to float32 (24-bit x87, like the other castle nodes); checked against the original run natively in tools/tests/m5-z07CSI-horse-emu.mjs.
//
// Node fields (dword index in the decompile / byte offset): +0x00 var (0x112), +0x08 stamp, +0x18 state flags (1 gallop, 0x10 jumping, 0x20 hop pending, 0x100 reversing, 0x1000 turning
// on the spot), +0x1c jump omega (pi / frames of the jump clip), +0x20 height at the start of the jump, +0x24 hop height (0 .. 6.4), +0x2c turn rate (ramps up while turning), +0x30 its
// acceleration (0.0523596), +0x34 the ground pitch the horse leans to, +0x38 ticks of walking backwards, +0x3c / +0x40 / +0x44 / +0x48 the last position / yaw seen without a ground clamp,
// +0x4c the hoof sound state, +0x50 idle timer (300 ticks out of view), +0x54 "was ridden" flag, +0x58 stand animation timer.
//   update, idle (var 0x112 & 1 == 0, the horse stands about): the horse is "taken" by Pepper (G.current := HORS) when Ctrl is pressed within the vehicle range while she walks (PEPPER_CONTROL
//     & 0x7fff == 1) and the walk state is not 0x62; else the grazing clip 5, the matrix levelled (pitch), a neigh at random (rand(120) >= 119); a horse that was ridden walks home to the PATH
//     node 0x5a after 300 ticks out of sight;
//   update, ridden: Up / Down (and the pad's stick: the globals DAT_0098384c / DAT_00983850) walk / reverse (trot clip 2 at 1/3 speed, gallop clip 3 at full speed, Space toggles), Left / Right
//     turn (the turn rate grows 3 degrees a tick up to 90), Alt jumps (clip 6, a sine hop; the height follows the ground), the ground under the horse is probed 1.6 in front of and behind it
//     (FUN_00576840: the terrain below + a probe straight down), the pitch follows the ground, walls turn it away (a sweep 8 ahead) and push it back (two sweeps 1.92 ahead / behind), the camera
//     target is the horse (+ 4.8) and the camera eye follows 0.0675 of the distance to its place behind the horse; the hooves play 3D sounds at fixed frames of the clips.
//   pre-render: while the horse is Pepper's vehicle it sets var 0x112 |= 1 and PEPPER_CONTROL = 0x10 (the vehicle kind -4), without a vehicle it clears var 0x112 & 1.
import type { BehaviourNode, Controller } from '../../../game/controller.ts';
import type { GameRecord } from '../../../game/record.ts';
import type { World } from '../../../game/world.ts';
import type { Attach } from '../../../formats/zonesetup.ts';
import { waypoints, MAP_PATH, NPC_TURN_RATE, NPC_RADIUS_MIN, NPC_RADIUS_MAX, NPC_RADIUS_LIMIT } from '../../../game/walker.ts';
import { vehicles, cutsceneActive } from '../../../island/vehicles/common.ts';
import { inView } from '../../../island/ambient/common.ts';
import { B } from '../../../game/input.ts';
import { distSq32, rand32, play, playAt } from '../common.ts';
import { f, fb, rotateFromEuler, setEulerExact, normalize, transformPoint, sweepF, probeF } from './math.ts';
import type { V3 } from './math.ts';
import { applyEmulatedSetupState } from './setup.ts';
import { BlockIn, BlockOut } from '../blockio.ts';

export const CTOR_HORSE = 0x579178;
/** the debug heap fills a new node block with 0xCD (FUN_00433d38 -> __nh_malloc_dbg): fields the constructor never writes read as this float */
const CD_F = fb(0xcdcdcdcd);
/** the record the node sits on: HORS (`DAT_00983804 + 0x1380`); the castle's own records the code names by address: the ground (3, `+ 0x138`) and the broken bridge BRGE (4, `+ 0x1a0`) */
export const REC_HORSE = 48, REC_GROUND = 3, REC_BRIDGE = 4;
/** SWITCH_CSI_HORSE */
export const VAR_HORSE = 0x112;
/** PATH node the horse is sent to when it was left out of sight (FUN_00462be9(1, 0x5a, rec + 0x3c)) */
export const HOME_NODE = 0x5a;

// ---- the executable's float constants (address in the comment; hex = the bit pattern the decompile shows)
const ONE = 1.0, ZERO = 0.0;                    // _DAT_00892020 / _DAT_0089202c
const FOUR = 4.0, EIGHT = 8.0, SIX = 6.0;       // _DAT_00892080 / _DAT_00892090 / _DAT_0089228c
const K08 = fb(0x3f4ccccd);                     // _DAT_00892084 0.8: hop growth
const HOP_MAX = fb(0x40cccccd);                 // _DAT_00892690 6.4
const PI = fb(0x40490fdb), NEG_PI = fb(0xc0490fdb), TWO_PI = fb(0x40c90fdb);   // _DAT_0089207c / _DAT_00892098 / _DAT_00892094
const STICK_SCALE = 170.0;                      // _DAT_00892694
const TURN_STEP = fb(0x3d567704);               // _DAT_00892534 0.0523596 (3 degrees): turn per tick, pitch step
const HOP_FRAME_LO = 15.0, HOP_FRAME_HI = 45.0; // _DAT_00892074 / _DAT_0089268c
const HOP_TURN = fb(0x3dd67704);                // _DAT_00892688 0.104719 (6 degrees)
const TEN = 10.0;                               // _DAT_00892060
const K16 = fb(0x3fcccccd);                     // _DAT_00892580 1.6: the probes sit 1.6 in front of / behind the new place
const SEA_MARGIN = fb(0x3dcccccd);              // _DAT_008920cc 0.1
const HALF = fb(0x3f000000);                    // _DAT_0089204c
const MIN_DROP = fb(0xc1000000);                // _DAT_00892684 -8
const MINUS_FOUR = fb(0xc0800000);              // _DAT_00892468
const WALL_DEFLECT = fb(0x40278cfc);            // _DAT_00892680 2.61798 (150 degrees)
const TURN_MAX = fb(0x3fc90f94);                // _DAT_00892554 1.57079
const TURN_START = fb(0x3e32b884);              // 0.1745 (10 degrees): the turn rate at rest and after the constructor
const K192 = fb(0x3ff5c28f), MINUS_K192 = fb(0xbff5c28f);   // _DAT_0089267c / _DAT_00892678 1.92
const K11 = fb(0x3f8ccccd);                     // _DAT_00892148 1.1: wall push-out
const CAM_UP = fb(0x4099999a);                  // _DAT_00892674 4.8: the camera looks at the horse + 4.8
const CAM_NEAR2 = fb(0x3f23d70a);               // _DAT_00892198 0.64: the eye moves when it is further than 0.8 from its place
const CAM_EASE = fb(0x3d8a3d71);                // _DAT_00892670 0.0675
const SEA_FLOOR = fb(0xc3200000);               // _DAT_0089266c -160: below this the terrain probe found nothing
const THIRD = fb(0x3eaaaaab);                   // trot speed 1/3
const SWEEP_RADIUS = fb(0x3f851eb8), SKIN_WALL = fb(0x3f4ccccd);   // the sweeps' radius / skin: 1.04 (the wall look-ahead), 0.8
const NEIGH_AT = 119.0;                         // _DAT_00892698
const CANTER_CUE = 24.0;                        // _DAT_008921a4
const IDLE_TICKS = fb(0x43960000);              // 300
const CAM_EYE_MIN = fb(0x40cccccd);             // _DAT_008adbfc: camera preset 0 height above the target (FUN_00422ddc(eye, y + 1, 0))
const CAM_EYE_SLACK = 32.0, CAM_EYE_DROP = K08; // _DAT_00892088 / _DAT_00892084
/** FUN_0043ab72's point (local to the horse) the camera eye wants to reach: the three floats at 0x8f85d8 = (0, 12.8, -24): 24 behind the horse, 12.8 up */
export const CAM_SPOT: readonly [number, number, number] = [0, fb(0x414ccccd), fb(0xc1c00000)];

/** the sound handle globals of the castle's loader FUN_00572ef0 the horse plays */
export const HS = { NEIGH: 0x5d58940, HOP_UP: 0x5d588a8, HOP_A: 0x5d588dc, HOP_B: 0x5d588e0, HOP_C: 0x5d588e8, HOP_D: 0x5d588e4,
  STEP: 0x5d58898, TROT_A: 0x5d588c0, TROT_B: 0x5d588b0, TROT_C: 0x5d588c4, TROT_D: 0x5d588c8, TROT_E: 0x5d588cc } as const;

/** DAT_0098384c / DAT_00983850: the pad's stick axes (-127 .. 127). The original zeroes them every tick (FUN_004376f9) and only the boat / helicopter code of the same tick writes them, so they are 0 while the horse runs; kept as an input of the node for the oracle test. */
export const horseAxes = { x: 0, y: 0 };
/** DAT_009da9b4: "the ground under the horse is a bridge / surface 7" (the nodes share it; the horse writes it before reading it) */
export const horseGlobals = { bridge: 0 };

/** test instrumentation (tools/tests/m5-z07CSI-horse-emu.mjs): when `hits` is set every named branch of the node counts, so the oracle test can show which paths of the original it compared */
export const coverage: { hits: Record<string, number> | null } = { hits: null };
const hit = (name: string) => { const h = coverage.hits; if (h) h[name] = (h[name] ?? 0) + 1; };

/** FUN_00422ddc(&camera eye, y, 0): the eye's height follows `y + 6.4` (jumps up, eases down by 0.8 while more than 32 above it) */
function easeEyeHeight(w: World, y: number) {
  const c = w.camera.c;
  const goal = f(CAM_EYE_MIN + y);
  if (goal <= c[1]) { if (CAM_EYE_SLACK < f(c[1] - goal)) { hit('camDrop'); c[1] = f(c[1] - CAM_EYE_DROP); } else hit('camHold'); } else { hit('camRaise'); c[1] = goal; }
}

/** FUN_0043b72b / FUN_0043b73f / FUN_0043b753 of the record's animation instance (0 without one) */
const clipOf = (r: GameRecord): number => r.anim?.clip ?? 0;
const frameOf = (r: GameRecord): number => r.anim?.frame ?? 0;
const framesOf = (r: GameRecord): number => r.anim?.frameCount ?? 0;
const wrapPi = (a: number): number => (a < NEG_PI ? f(a + TWO_PI) : a > PI ? f(a - TWO_PI) : a);


/** the result of FUN_00576840: what lies below a probe point */
interface Ground { code: number; y: number; surface: number }

export class HorseNode implements BehaviourNode {
  readonly kind = 'Horse';
  var = VAR_HORSE; mask = 0; value = 0;
  stamp = 0xfffffffe;
  // ---- the node block (see the header); fields the constructor does not set start as 0 (a fresh heap block)
  st = 0;                 // +0x18
  omega = CD_F;           // +0x1c (never written by the constructor: the debug heap's 0xCD)
  jumpY0 = CD_F;          // +0x20 (0xCD)
  hop = 0;                // +0x24
  /** +0x28: never written by the constructor or by the update (a fresh heap block's word); kept only so that a loaded block is saved again unchanged */
  word28 = -842150451;   // 0xcdcdcdcd
  turnRate = TURN_START;  // +0x2c
  turnAccel = TURN_STEP;  // +0x30
  pitch = 0;              // +0x34
  backTicks = 0;          // +0x38
  sx = 0; sy = 0; sz = 0; syaw = CD_F;   // +0x3c .. +0x48
  sound = 0;              // +0x4c
  idle = 0;               // +0x50
  active = 0;             // +0x54
  standT = CD_F;          // +0x58 (0xCD)
  /** DAT_05d58964: set once the horse has been Pepper's vehicle (never cleared again) */
  pending = 0;
  /** the set-up's final visibility / place is applied once, at the first update (after the castle's own set-up code, which hides the horse again: setup.ts); tests that place the record themselves set it */
  setupApplied = false;

  constructor(_a?: Pick<Attach, 'var' | 'mask' | 'value'>) { void _a; }

  /** FUN_00579178 after the node exists (the framework calls it after the set-up, in record order): the controller's walker with the NPC tuning, the node's start values */
  ctorInit(_w: World, rec: GameRecord) {
    void _w;
    this.pending = 0;                                  // DAT_05d58964 = 0
    this.st = 0; this.hop = 0; this.active = 0; this.idle = 0; this.sound = 0;   // +0x18, +0x24 (the heap block of a fresh process), +0x54, +0x50, +0x4c
    this.backTicks = 0;
    this.turnRate = TURN_START; this.turnAccel = TURN_STEP;   // +0x2c = 0x3e32b884, +0x30 = 0x3d567704
    const ctrl = rec.ctrl;
    if (ctrl) {
      // FUN_00462d4f(1, rec, -2): the controller's walker (the SGMFIG node of the record, constructed first, may have made it)
      let h = ctrl.walker && waypoints.get(ctrl.walker) ? ctrl.walker : 0;
      if (!h) h = waypoints.create(MAP_PATH, rec, -2);
      ctrl.walker = h;
      if (h) {
        waypoints.setSpeed(h, fb(0x3d086595));         // FUN_00462206
        waypoints.setLane(h, 0);                       // FUN_00461ad6
        waypoints.setTurnRate(h, NPC_TURN_RATE);       // FUN_00462324 (0x3f060a63)
        waypoints.setRadiusMin(h, NPC_RADIUS_MIN);     // FUN_004623aa (0x3e4ccccd)
        waypoints.setRadiusMax(h, NPC_RADIUS_MAX);     // FUN_004623cd (0x3f400000)
        waypoints.setRadiusLimit(h, NPC_RADIUS_LIMIT); // FUN_00462436 (0x3e800000)
        waypoints.apply(h, rec);                       // FUN_00461fe4
      }
    }
    this.sx = rec.m[12]; this.sy = rec.m[13]; this.sz = rec.m[14];   // +0x3c / +0x40 / +0x44 = the record's translation (x, y, z)
  }

  /**
   * save FUN_0057900b (vtable +0x14; the size is FUN_0057900b's 0x44 + 4, the buffer protocol: the serializer is called again with the destination): the node's bytes +0x18 .. +0x5b (0x44 bytes: the
   * fields of the header above), then the VALUE of the game variable the node's +0x00 names (FUN_00417575(*node): var 0x112, the horse switch).
   */
  saveBlock(w: World): Uint8Array {
    const o = new BlockOut(0x48);
    o.i32(0x00, this.st).f32(0x04, this.omega).f32(0x08, this.jumpY0).f32(0x0c, this.hop).i32(0x10, this.word28);
    o.f32(0x14, this.turnRate).f32(0x18, this.turnAccel).f32(0x1c, this.pitch).f32(0x20, this.backTicks);
    o.f32(0x24, this.sx).f32(0x28, this.sy).f32(0x2c, this.sz).f32(0x30, this.syaw);
    o.i32(0x34, this.sound).f32(0x38, this.idle).i32(0x3c, this.active).f32(0x40, this.standT);
    o.i32(0x44, w.vars.get(this.var));
    return o.bytes;
  }
  /** load FUN_005790c9 (vtable +0x10): the 0x44 bytes back to node + 0x18, the variable word to the game variable (FUN_00417597(node +0, value)) */
  loadBlock(w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.st = b.i32(0x00); this.omega = b.f32(0x04); this.jumpY0 = b.f32(0x08); this.hop = b.f32(0x0c); this.word28 = b.i32(0x10);
    this.turnRate = b.f32(0x14); this.turnAccel = b.f32(0x18); this.pitch = b.f32(0x1c); this.backTicks = b.f32(0x20);
    this.sx = b.f32(0x24); this.sy = b.f32(0x28); this.sz = b.f32(0x2c); this.syaw = b.f32(0x30);
    this.sound = b.i32(0x34); this.idle = b.f32(0x38); this.active = b.i32(0x3c); this.standT = b.f32(0x40);
    w.vars.set(this.var, b.i32(0x44));
  }

  /** FUN_005769a8(rec, node, controller, var value) */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    const G = vehicles(w);
    if (!this.setupApplied) { this.setupApplied = true; applyEmulatedSetupState(w, rec, { placement: true }); }
    const sw = w.vars.get(this.var) | 0;
    if ((rec.flags & 2) === 0) return 0;
    if (cutsceneActive(w)) return 1;                   // FUN_0045c432
    const P = w.input.pressed | 0;                     // local_38 = DAT_00983840
    const dist = distSq32(w, rec);                     // the controller's +0x18 (FUN_0042216f)
    if ((sw & 1) === 0) return this.updateIdle(w, rec, G, P, dist);
    return this.updateRide(w, rec, G, sw, P);
  }

  /** the horse stands about (var 0x112 & 1 == 0) */
  private updateIdle(w: World, rec: GameRecord, G: ReturnType<typeof vehicles>, P: number, dist: number): number {
    if (G.current === rec) { hit('idleVehicle'); G.range = dist; this.pending = 1; return 1; }
    if ((P & 0x10) !== 0 && (w.pep.mailbox & 0xff) !== 0x62 && dist < G.range && (rec.flags & 2) !== 0 && (w.vars.get(0x5e) & 0x7fff) === 1) {
      hit('mount');
      G.current = rec;                                  // Pepper gets on: Ctrl next to the horse while she walks
      G.range = dist;
      return 1;
    }
    if (dist < G.range) { hit('icon'); w.vars.or(0xc, 2); }   // FUN_0041761b(0xc, 2): the "press Ctrl" icon
    if (clipOf(rec) === 5) { hit('graze'); rec.anim?.advance(ONE, w.dt); } else { hit('grazeStart'); rec.anim?.start(5, 0); }   // grazing
    if (rec.rx !== this.pitch) { hit('idleLevel'); rec.rx = this.pitch; rotateFromEuler(rec, rec.rx, rec.ry, 0); }
    if (rand32(120.0) >= NEIGH_AT) { hit('neigh'); playAt(w, HS.NEIGH, [rec.m[12], rec.m[13], rec.m[14]]); }
    if (this.active !== 0) {
      if (!inView(w, rec)) {                            // `flags & 1`: not in the frustum: after 300 ticks the horse is sent home
        hit('outOfView');
        this.idle = f(this.idle - f(ONE * w.dt));
        if (this.idle <= ZERO) {
          hit('home');
          this.active = 0;
          const p = waypoints.nodePos(1, HOME_NODE);    // FUN_00462be9(1, 0x5a, rec + 0x3c)
          rec.m[12] = f(p[0]); rec.m[13] = f(p[1]); rec.m[14] = f(p[2]);
        }
      } else { hit('inView'); this.idle = IDLE_TICKS; }
    }
    return 0;
  }

  /** FUN_00576840(rec, from, delta, normal, point, 3): the terrain below `from` (FUN_0043cd62, 4 up) and a probe down to it; code 0 = no terrain, 1 = terrain only, 2 = something solid in between */
  private groundProbe(w: World, rec: GameRecord, from: V3, delta: V3): Ground {
    let found = 0;
    let h = f(w.col.terrainHeight(from[0], from[1], from[2], FOUR));
    if (h < SEA_FLOOR) h = from[1]; else { delta[1] = f(h - from[1]); found = 1; }
    const p = probeF(w, rec, from, delta, 3);
    const surface = w.col.lastSurface();               // FUN_004425c0: the caller reads it right after the call
    if (!p) return { code: found, y: h, surface };
    if (p.rec === w.records[REC_BRIDGE]) { hit('bridgeHit'); horseGlobals.bridge = 1; }
    return { code: 2, y: p.point[1], surface };
  }

  /** the ridden branch: var 0x112 & 1 */
  private updateRide(w: World, rec: GameRecord, G: ReturnType<typeof vehicles>, sw: number, P: number): number {
    const dt = w.dt;
    let H = w.input.held | 0;                          // local_58 = DAT_0098383c
    this.idle = IDLE_TICKS; this.active = 1;
    if (this.stamp !== w.frame) {                      // the node did not run last tick: the ride starts
      hit('rideStart');
      rec.anim?.start(2, 0);
      H |= 4;
      G.current = rec;
    }
    const AY = horseAxes.y, AX = horseAxes.x;
    if (AY < -0x32) {
      hit('axisUp');
      if (AY < -0x5a) { hit('axisUpHard'); if (this.st === 0) this.st |= 1; } else this.st &= ~1;
      H |= 4;
    } else if (AY > 0x32) {
      hit('axisDown'); H |= 8;
      if (AY < 0x5b) this.st &= ~1; else { hit('axisDownHard'); this.st |= 1; }
    }
    if (AX > 0x32) { hit('axisRight'); this.turnRate = f(f(((AX - 0x28) | 0) * PI) / STICK_SCALE); H |= 2; }
    else if (AX < -0x32) { hit('axisLeft'); this.turnRate = f(f(((-0x32 - AX) | 0) * PI) / STICK_SCALE); H |= 1; }
    // Space toggles trot / gallop (not while jumping or turning on the spot)
    if ((P & B.SPACE) !== 0 && (this.st & 0x1100) === 0) hit('spaceToggle');
    if ((P & B.SPACE) !== 0 && (this.st & 0x1100) === 0) this.st = (this.st & 1) === 0 ? this.st | 1 : this.st & ~1;
    let gait: number, gs: number;                      // local_54 / local_50: the walk clip and its speed factor
    if ((this.st & 1) === 0) { gait = 2; gs = THIRD; } else { gait = 3; gs = ONE; }
    if ((this.st & 0x1010) === 0) {
      if ((sw & 0x10) !== 0) { hit('busyOff'); w.vars.andNot(this.var, 0x10); }
      if (clipOf(rec) !== gait) { hit(gait === 2 ? 'gaitTrot' : 'gaitGallop'); rec.anim?.start(gait, 0); }
    } else if ((sw & 0x10) === 0) { hit('busyOn'); w.vars.or(this.var, 0x10); }   // busy: Ctrl cannot get off
    // Alt: the hop is armed while Alt is held; on release the jump starts
    if ((H & B.ALT) === 0) {
      if ((this.st & 0x20) !== 0) {
        hit('jumpStart');
        this.st &= ~0x20;
        play(w, HS.HOP_UP);
        play(w, rand32(2.0) < ONE ? HS.HOP_B : HS.HOP_A);
        play(w, rand32(2.0) < ONE ? HS.HOP_D : HS.HOP_C);
        rec.anim?.start(6, 0);
        this.omega = f(PI / framesOf(rec));
        this.st |= 0x10;
        this.jumpY0 = rec.m[13];
      }
    } else if ((this.st & 0x1010) === 0) {
      hit('hopArm');
      this.st |= 0x20;
      this.hop = f(this.hop + K08);
      if (HOP_MAX < this.hop) { hit('hopMax'); this.hop = HOP_MAX; }
    }

    // ---- what moves the horse this tick: mv (local_60): 1 forward, 2 backward, 4 jumping, 0x10 turning, 0x20 turning on the spot / landing
    let mv = 0;
    const b: V3 = [0, 0, 0];                           // local_b8 .. local_b0
    const fx = rec.m[8], fy = rec.m[9], fz = rec.m[10];
    if ((this.st & 0x10) !== 0) { hit('mvJump'); b[0] = f(f(gs * dt) * fx); b[1] = f(f(gs * dt) * fy); b[2] = f(f(gs * dt) * fz); mv = 4; }
    else if ((H & 4) !== 0) { hit('mvFwd'); b[0] = f(f(gs * dt) * fx); b[1] = f(f(gs * dt) * fy); b[2] = f(f(gs * dt) * fz); mv = 1; }
    if ((H & 8) !== 0 && mv !== 4) {
      hit('mvBack');
      const ng = -gs;
      b[0] = f(f(ng * dt) * fx); b[1] = f(f(ng * dt) * fy); b[2] = f(f(ng * dt) * fz);
      mv |= 2;
    }
    if ((mv & 3) === 3) { hit('mvBoth'); mv = 0; }
    if ((mv & 2) === 0) {
      if (ZERO < this.backTicks && this.backTicks <= FOUR) { hit('backStop'); mv = 0x20; this.st |= 0x1000; rec.anim?.start(4, 0); }
      this.backTicks = 0;
    } else this.backTicks = f(f(ONE * dt) + this.backTicks);
    let dyaw = 0;                                      // local_c8
    if ((H & 1) !== 0) { hit('turnLeft'); dyaw = -f(f(Math.sin(this.turnRate) * TURN_STEP) * dt); mv |= 0x10; }
    if ((H & 2) !== 0 && (mv & 0x10) === 0) { hit('turnRight'); dyaw = f(f(Math.sin(this.turnRate) * TURN_STEP) * dt); mv |= 0x10; }
    if ((this.st & 0x1000) !== 0) {
      hit('landing');
      const fr = frameOf(rec);
      mv = 0x20;
      if (HOP_FRAME_LO < fr && fr < HOP_FRAME_HI) { hit('landingTurn'); rec.ry = f(f(HOP_TURN * dt) + rec.ry); }
    }
    let yaw = rec.ry;                                  // local_c4
    const ox = rec.m[12], oy = rec.m[13], oz = rec.m[14];   // local_8c / local_88 / local_84: where the horse is
    let nx: number, ny: number, nz: number;            // local_80 / local_7c / local_78: where it wants to go
    let hopSin = 0;                                    // local_9c
    if ((mv & 7) === 0) {
      if (ZERO <= this.standT) {
        this.standT = f(f(ONE * dt) + this.standT);
        if (TEN < this.standT) { hit('standReset'); this.standT = -1.0; rec.anim?.seek(0); }
      }
      nx = rec.m[12]; ny = rec.m[13]; nz = rec.m[14];
    } else {
      nx = f(ox + b[0]); ny = f(oy + b[1]); nz = f(oz + b[2]);
      if ((mv & 7) === 2) { hit('reversing'); this.st |= 0x100; dyaw = -dyaw; } else this.st &= ~0x100;
      yaw = f(yaw + dyaw);
      if ((this.st & 0x10) !== 0) hopSin = f(Math.sin(f(this.omega * frameOf(rec))));
      this.standT = 0;
    }

    // ---- the ground under the horse: two probes (1.6 in front of / behind the new place) and the pitch it leans to
    let pitch = 0;                                     // local_a0
    let clamp = 0xcc;                                  // local_6c & 0xff: 1 front / 2 back probe found no ground above the sea; the debug build's stack fill 0xcc until the probes ran (mv == 0)
    let hd = 0;                                        // local_8: ground height in front minus behind
    if (mv !== 0) {
      clamp = 0;
      const d: V3 = [f(rec.m[8] * K16), f(rec.m[9] * K16), f(rec.m[10] * K16)];
      const ax = f(nx + d[0]), az = f(nz + d[2]), bx = f(nx - d[0]), bz = f(nz - d[2]);
      let ay = f(ny + d[1]), by = f(ny - d[1]);
      if (ay <= by) { by = f(by + SIX); ay = by; } else { ay = f(ay + SIX); by = ay; }
      horseGlobals.bridge = 0;
      const down: V3 = [0, -120.0, 0];                     // local_98 .. local_90: shared by both calls (the first may change its y)
      const cf = this.groundProbe(w, rec, [ax, ay, az], down);
      const cb = this.groundProbe(w, rec, [bx, by, bz], down);
      let frontG = cf.y, backG = cb.y;
      const floor = f(w.seaLevel + SEA_MARGIN);
      if (frontG <= floor || cf.code === 0) { frontG = floor; clamp |= 1; }
      if (backG <= floor || cb.code === 0) { backG = floor; clamp |= 2; }
      if (cf.surface === 7 || cb.surface === 7) { hit('surface7'); horseGlobals.bridge = 1; }
      hit(`probe${cf.code}${cb.code}`);
      if ((clamp & 1) !== 0) hit('clampFront');
      if ((clamp & 2) !== 0) hit('clampBack');
      hd = f(frontG - backG);
      if (cf.code === 2 || cb.code === 2) {
        hit('pitchSolid'); pitch = 0; ny = frontG; if (frontG < backG) ny = backG; hd = 0;
      } else if (horseGlobals.bridge !== 0) {
        hit('pitchBridge'); pitch = 0; ny = frontG; hd = 0;
      } else if (cf.code !== 0 && cb.code !== 0) {
        hit('pitchBoth'); pitch = -f(Math.atan2(hd, 1.6));
        if (pitch < NEG_PI) { hit('pitchWrapLo'); pitch = f(pitch + TWO_PI); } else if (PI < pitch) { hit('pitchWrapHi'); pitch = f(pitch - TWO_PI); }
        ny = f(f(frontG + backG) * HALF);
      } else if (cf.code !== 0) { hit('pitchFrontOnly'); pitch = -f(Math.atan2(hd, 1.6)); ny = frontG; }
      else if (cb.code !== 0) { hit('pitchBackOnly'); pitch = -f(Math.atan2(hd, 1.6)); ny = backG; }
      else { hit('pitchNone'); pitch = -f(Math.atan2(hd, 1.6)); }
      this.pitch = pitch;
    }

    let adv = 0;                                       // local_70: FUN_0043b76a's result this tick
    if ((mv & 7) === 0) {
      if (clamp === 0) { this.sx = rec.m[12]; this.sy = rec.m[13]; this.sz = rec.m[14]; this.syaw = rec.ry; }
    } else {
      // the pitch follows the ground in steps of 3 degrees, and only when it is further off than one step
      const cur = rec.rx;
      if (pitch < cur) { if (TURN_STEP < f(cur - pitch)) { hit('stepDown'); pitch = f(cur - TURN_STEP); } else { hit('holdDown'); pitch = cur; } }
      else if (TURN_STEP < f(pitch - cur)) { hit('stepUp'); pitch = f(cur + TURN_STEP); } else { hit('holdUp'); pitch = cur; }
      if (clamp === 0) { this.sx = rec.m[12]; this.sy = rec.m[13]; this.sz = rec.m[14]; this.syaw = rec.ry; }
      if ((this.st & 0x10) !== 0) {
        // jumping: the height is the sine hop above the start height / the ground
        const lift = ny < this.jumpY0 ? f(f(this.hop * hopSin) + ny) : f(f(this.hop * hopSin) + this.jumpY0);
        hit(ny < this.jumpY0 ? 'liftGround' : 'liftStart');
        if (ny < lift) { hit('liftRaise'); ny = lift; }
      } else {
        hit('walkStep');
        const d: V3 = [f(nx - ox), f(ny - oy), f(nz - oz)];
        normalize(d);
        d[0] = f(f(gs * dt) * d[0]); d[1] = f(f(gs * dt) * d[1]); d[2] = f(f(gs * dt) * d[2]);
        nx = f(ox + d[0]); ny = f(oy + d[1]); nz = f(oz + d[2]);
      }
      if ((mv & 5) !== 0) {
        // ---- forward / jumping
        if ((clamp & 1) !== 0 || hd <= MIN_DROP) {
          hit((clamp & 1) !== 0 ? 'fwdBlockedClamp' : 'fwdBlockedDrop');
          rotateFromEuler(rec, rec.rx, rec.ry, rec.rz);       // no ground ahead / it drops away: stay, only the height follows
          rec.m[13] = ny;
        } else {
          if ((mv & 0x10) === 0) {
            // a wall ahead (a sweep 8 long from 4 up): turn away from it
            const delta: V3 = [f(rec.m[8] * EIGHT), f(rec.m[9] * EIGHT), f(rec.m[10] * EIGHT)];
            const h = sweepF(w, rec, [ox, f(oy + FOUR), oz], delta, 3, SWEEP_RADIUS, SWEEP_RADIUS);
            hit(h ? (h.rec === w.records[REC_GROUND] ? 'wallAheadGround' : 'wallAheadHit') : 'wallAheadFree');
            if (h && h.rec !== w.records[REC_GROUND]) {
              const a = wrapPi(f(Math.atan2(h.normal[0], h.normal[2])));
              const e = wrapPi(f(a - rec.ry));
              if (Math.abs(e) < WALL_DEFLECT) {
                hit(ZERO <= e ? 'deflectPos' : 'deflectNeg');
                if (ZERO <= e) dyaw = f(f(Math.sin(this.turnRate) * TURN_STEP) * dt);
                else dyaw = -f(f(Math.sin(this.turnRate) * TURN_STEP) * dt);
                mv |= 0x10;
              } else hit('deflectBehind');
            }
          }
          yaw = f(yaw + dyaw);                                 // (the turn is applied a second time: the original does)
          rec.ry = yaw;
          rotateFromEuler(rec, rec.rx, rec.ry, rec.rz);
          // the body: a sweep 4 ahead from 4 up, and from 6 up when the first found nothing
          const delta: V3 = [f(rec.m[8] * FOUR), f(rec.m[9] * FOUR), f(rec.m[10] * FOUR)];
          let from: V3 = [f(ox + f(rec.m[4] * FOUR)), f(oy + f(rec.m[5] * FOUR)), f(oz + f(rec.m[6] * FOUR))];
          let h = sweepF(w, rec, from, delta, 3, SKIN_WALL, SKIN_WALL);
          if (!h) {
            from = [f(ox + f(rec.m[4] * SIX)), f(oy + f(rec.m[5] * SIX)), f(oz + f(rec.m[6] * SIX))];
            h = sweepF(w, rec, from, delta, 3, SKIN_WALL, SKIN_WALL);
          }
          if (!h) { hit('fwdMove'); rec.rx = pitch; setEulerExact(rec, rec.rx, rec.ry, rec.rz, nx, ny, nz); }
          else { hit('fwdBody'); rotateFromEuler(rec, rec.rx, rec.ry, rec.rz); rec.m[13] = ny; }
        }
      } else if ((mv & 7) === 2) {
        // ---- backward: the probes sit behind the horse
        const delta: V3 = [f(rec.m[8] * MINUS_FOUR), f(rec.m[9] * MINUS_FOUR), f(rec.m[10] * MINUS_FOUR)];
        if ((clamp & 2) !== 0 || hd <= MIN_DROP) {
          hit((clamp & 2) !== 0 ? 'backBlockedClamp' : 'backBlockedDrop');
          rec.ry = yaw;
          rotateFromEuler(rec, rec.rx, rec.ry, rec.rz);
          rec.m[13] = ny;
        } else {
          let from: V3 = [f(ox + f(rec.m[4] * SIX)), f(oy + f(rec.m[5] * SIX)), f(oz + f(rec.m[6] * SIX))];
          let h = sweepF(w, rec, from, delta, 3, SKIN_WALL, SKIN_WALL);
          if (!h) { hit('backSweep2'); from = [from[0], f(from[1] + 2.0), from[2]]; h = sweepF(w, rec, from, delta, 3, SKIN_WALL, SKIN_WALL); }
          if (!h) { hit('backMove'); rec.rx = pitch; rec.ry = yaw; setEulerExact(rec, rec.rx, rec.ry, rec.rz, nx, ny, nz); }
          else { hit('backBody'); rec.ry = yaw; rotateFromEuler(rec, rec.rx, rec.ry, rec.rz); rec.m[13] = ny; }
        }
      } else {
        hit('deadElse');                                  // (unreachable: (mv & 5) == 0 and mv & 7 != 0 means mv & 7 == 2)
        rec.rx = pitch; rec.ry = yaw;
        setEulerExact(rec, rec.rx, rec.ry, rec.rz, nx, ny, nz);
      }
      // ---- the animation (the branch for a record that is reversing: the frame runs backwards)
      if ((this.st & 0x100) !== 0) {
        hit('animReverse');
        let fr = f(frameOf(rec) - f(ONE * dt));
        if (fr < ZERO) { hit('animReverseWrap'); fr = f(framesOf(rec) - ONE); }
        rec.anim?.seek(fr);
      } else adv = rec.anim?.advance(ONE, dt) ?? 0;
      if (adv !== 0 && (this.st & 0x10) !== 0) {        // the jump clip ended
        hit('jumpEnd');
        this.st &= ~0x10;
        rec.anim?.start(gait, 0);
        this.hop = 0;
      }
    }

    if ((mv & 7) === 0) {
      if ((this.st & 0x1000) !== 0) {
        adv = rec.anim?.advance(ONE, dt) ?? 0;
        if (adv !== 0) { hit('landingEnd'); this.st &= ~0x1000; rec.anim?.start(gait, 0); }
      }
      if ((mv & 0x10) !== 0) {
        hit('standTurn');
        this.st &= ~0x20;
        if ((this.st & 0x1000) === 0) {
          hit('standTurnMove');
          adv = rec.anim?.advance(ONE, dt) ?? 0;
          yaw = f(yaw + dyaw);
          rec.ry = wrapPi(yaw);
          rec.rx = pitch;
          rotateFromEuler(rec, rec.rx, rec.ry, rec.rz);
        }
      } else if ((mv & 0x20) !== 0) {
        hit('standFace');
        rec.ry = wrapPi(yaw);
        rec.rx = pitch;
        rotateFromEuler(rec, rec.rx, rec.ry, rec.rz);
      }
    }

    // ---- the walls: two sweeps 1.92 ahead / behind the horse's new place push it out of whatever it touches
    {
      const A: V3 = [f(nx + f(rec.m[4] * FOUR)), f(ny + f(rec.m[5] * FOUR)), f(nz + f(rec.m[6] * FOUR))];
      for (const k of [K192, MINUS_K192]) {
        const delta: V3 = [f(rec.m[8] * k), f(rec.m[9] * k), f(rec.m[10] * k)];
        const h = sweepF(w, rec, A, delta, 3, SKIN_WALL, SKIN_WALL);
        if (h) {
          hit(k === K192 ? 'pushFront' : 'pushBack');
          const d: V3 = [f(f(h.point[0] - A[0]) * K11), f(f(h.point[1] - A[1]) * K11), f(f(h.point[2] - A[2]) * K11)];
          rec.m[12] = f(rec.m[12] - d[0]); rec.m[13] = f(rec.m[13] - d[1]); rec.m[14] = f(rec.m[14] - d[2]);
        }
      }
    }
    if (mv === 0) { hit('stillRotate'); rotateFromEuler(rec, rec.rx, rec.ry, rec.rz); }
    if ((mv & 0x10) !== 0) {
      hit('turnRamp');
      this.turnRate = f(f(this.turnAccel * dt) + this.turnRate);
      if (TURN_MAX < this.turnRate) { hit('turnMax'); this.turnRate = TURN_MAX; }
    } else this.turnRate = TURN_START;
    if (clamp === 3) {
      hit('restore'); rec.m[13] = this.sy; rec.m[12] = this.sx; rec.m[14] = this.sz; }   // no ground at either probe: back to the last good place

    // ---- the camera: it looks at the horse (+ 4.8) and its eye eases to the spot 24 behind / 12.8 above
    const cam = w.camera.c;
    cam[3] = rec.m[12]; cam[4] = f(rec.m[13] + CAM_UP); cam[5] = rec.m[14];   // DAT_009da5f4 / 5f8 / 5fc
    const goal = transformPoint(rec.m, CAM_SPOT);
    const cd: V3 = [f(goal[0] - f(cam[0])), f(goal[1] - f(cam[1])), f(goal[2] - f(cam[2]))];
    const d2 = f(f(f(cd[0] * cd[0]) + f(cd[1] * cd[1])) + f(cd[2] * cd[2]));
    if (CAM_NEAR2 < d2) {
      hit('camEase');
      const k = f(CAM_EASE * dt);
      cam[0] = f(f(cam[0]) + f(k * cd[0])); cam[1] = f(f(cam[1]) + f(k * cd[1])); cam[2] = f(f(cam[2]) + f(k * cd[2]));
      easeEyeHeight(w, f(rec.m[13] + ONE));
    }

    // ---- the hooves
    const clip = clipOf(rec), fi = Math.trunc(frameOf(rec));
    const pos = [rec.m[12], rec.m[13], rec.m[14]] as const;
    switch (clip - 1) {
      case 0: hit('sndClip1'); playAt(w, HS.STEP, pos); break;
      case 1: {
        const r = rand32(25.0);
        if (this.sound === 0) {
          if (12 < fi) { hit('snd2a'); playAt(w, HS.TROT_A, pos); if (CANTER_CUE <= r) { hit('snd2b'); playAt(w, HS.TROT_B, pos); } this.sound = 1; }
        } else if (this.sound === 1) {
          if (22 < fi) { hit('snd2c'); playAt(w, HS.TROT_C, pos); this.sound = 2; }
          if (adv !== 0) { hit('snd2reset'); this.sound = 0; }
        } else if (this.sound === 2 && adv !== 0) { hit('snd2d'); playAt(w, HS.TROT_D, pos); playAt(w, HS.TROT_E, pos); this.sound = 0; }
        break;
      }
      case 2:
        if (this.sound === 0) {
          if (4 < fi) { hit('snd3a'); playAt(w, HS.TROT_A, pos); this.sound = 1; }
        } else if (this.sound === 1) {
          if (9 < fi) { hit('snd3c'); playAt(w, HS.TROT_C, pos); this.sound = 2; }
          if (adv !== 0) { hit('snd3d'); playAt(w, HS.TROT_D, pos); this.sound = 0; }
        } else if (this.sound === 2 && adv !== 0) { hit('snd3e'); playAt(w, HS.TROT_D, pos); playAt(w, HS.TROT_E, pos); this.sound = 0; }
        break;
      case 3: hit('sndClip4'); playAt(w, HS.STEP, pos); break;
      default: break;
    }
    return 1;
  }

  /** FUN_00578f2d(rec, node): the mode switch the ride needs (Pepper's mode, the vehicle kind) */
  prerender(w: World, _rec: GameRecord): void {
    void _rec;
    const G = vehicles(w);
    const P = w.input.pressed | 0;
    if (this.pending === 0 && ((P & B.CTRL) === 0 || (w.pep.mailbox & 0xff) === 0x62)) this.pending = 0;
    else if (G.current === _rec) {
      w.vars.or(this.var, 1);                            // FUN_0041761b(*node, 1): the ride flag
      w.vars.set(0x5e, 0x10);                            // PEPPER_CONTROL = the horse
      G.kind = -4;                                       // DAT_009da9f8._2_2_ = 0xfffc
    } else if (G.current === null) w.vars.andNot(this.var, 1);
  }

  /** FUN_00579328: the controller's walker is freed (FUN_00461a3b) and the node block released */
  destroy(_w: World, rec: GameRecord): void {
    const ctrl = rec.ctrl;
    if (ctrl?.walker) { waypoints.free(ctrl.walker); ctrl.walker = 0; }
  }
}

export const horseFactory = (a: Attach) => new HorseNode(a);
