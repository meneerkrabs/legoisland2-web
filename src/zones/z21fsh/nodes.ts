// z21FSH "Fishing": the behaviour nodes of the zone, ported from the zone code of the original (0x6f3511-0x706bee). DOM-free: everything runs on the world's records, so
// node tests can drive it with scripted input (tools/tests/m6-z21FSH.mjs). Constructors (the extraction's attaches, docs/re/zone-setup.md):
//   FSwitch   0x6f51e6 (update 0x6f4bfa)  Pepper: Shift walks to the nearest of eight spots and starts fishing, Shift again leaves; the message slots tick here
//   Fishing   0x6f8e5a (update 0x6f6e2b)  Pepper: the 15-state fishing machine (walk to the spot, cast, wait, strike, reel, fight, land, score, end)
//   Bertha    0x6f56d0 (update 0x6f54c0)  the big fish on its own way-point path
//   Shoal     0x6f6034 (update 0x6f5dac)  the 15 small fish of the lake (draw hook 0x6f5e8d runs the bite picker)
//   Splash    0x6f5aa1 (draw   0x6f59e4)  the ripple ring where the bobber lies
//   rod       0x6f9cdc (draw   0x6f94d4)  the rod: bends with the pull, points at the bobber / fish, draws the line
//   Fisherman 0x6f937d (update 0x6f9090)  the old man walks to the spot Pepper chose
// The "draw hooks" of the original (matrix work before the draw call) are done in `prerender` here (the renderer reads the record matrices).
import { euler24 } from '../common/x87.ts';
import { mulGame, transformPointGame } from '../../render/math.ts';
const f32 = Math.fround;
import { NODE_CONTINUE, NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { registerCtor } from '../../game/setup.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { NO_GROUND } from '../../game/collision.ts';
import { waypoints } from '../../game/walker.ts';
import type { StepOut } from '../../game/walker.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import type { Pe } from '../../formats/exe.ts';
import { restoreHooks } from '../../restore/flag.ts';
import {
  CTOR, REC, TABLE, SND, BTN, CLIP, ST, CAST, K, MSG, CATCH_LINES, PI, TWO_PI, Fish, Follower, Popups, fishStep, pickBite, newPick, crtRng, randF, randI, randT, normalize,
} from './rules.ts';
import type { Rng, BitePick, FishingView, FishEnv } from './rules.ts';

// ------------------------------------------------------------------------------------------------ shared state: the zone's globals

/** the world services the nodes need (the zone game fills them: sounds, speech, cutscenes, music) */
export interface FshEnv {
  /** FUN_004435a0 / FUN_004435b0: start / stop a 2D sound by sound-table id */
  play2D(id: number): void; stop2D(id: number): void;
  /** FUN_004433f0 / FUN_004434b0: play (update) / stop a 3D sound */
  play3D(id: number, x: number, y: number, z: number): void; stop3D(id: number): void;
  /** FUN_00439bf8 + FUN_00435a11: speak the zone-table lines */
  say(a: string, b?: string): void;
  /** FUN_0045c40c / FUN_0045c432 */
  cutsceneStart(slot: number): void; cutsceneActive(): boolean;
  /** FUN_004432c0(DAT_05d5c3dc / 3d8): the music switches to the fight track (true) and back */
  fightMusic(on: boolean): void;
  /** the splash emitter splash01.par (FUN_00442a00 + 00442a20(h, 2, 1, 1) at the landing of the bobber: `on`, the matrix DAT_05d5caf0 = (identity, x, y, z); 00442a20(h, 1, 1, 1) when the reeling starts: `!on`, the position is ignored) */
  splash(x: number, y: number, z: number, on?: boolean): void;
}
export const silentEnv: FshEnv = { play2D() {}, stop2D() {}, play3D() {}, stop3D() {}, say() {}, cutsceneStart() {}, cutsceneActive: () => false, fightMusic() {}, splash() {} };

/** a fishing spot (the table at DAT_05d5c3e8, 0x1c bytes): the record, the place Pepper stands at and the direction to the lake centre */
export interface Spot { record: number; x: number; y: number; z: number; dx: number; dy: number; dz: number }

/** tables read from the executable (`readTables`) */
export interface Tables { spots: number[]; lods: number[]; path: number[][]; routes: number[] }

export function readTables(pe: Pe): Tables {
  const f = (va: number) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(va), true); return d.getFloat32(0, true); };
  const spots: number[] = [], lods: number[] = [], routes: number[] = [];
  for (let i = 0; i < TABLE.SPOT_COUNT; i++) { spots.push(pe.u32(TABLE.SPOTS + i * 4)); routes.push(pe.u32(TABLE.ROUTES + i * 4)); }
  for (let i = 0; i < TABLE.LOD_COUNT; i++) lods.push(pe.u32(TABLE.LODS + i * 4));
  const path: number[][] = [];
  for (let i = 0; i < TABLE.PATH_COUNT; i++) path.push([f(TABLE.PATH + i * 12), f(TABLE.PATH + i * 12 + 4), f(TABLE.PATH + i * 12 + 8)]);
  return { spots, lods, path, routes };
}

/** the zone's globals (DAT_05d5c3d0, DAT_05d5ca60, DAT_05d5cae0.., DAT_05d5cb34 ...) */
export class FshShared {
  env: FshEnv = silentEnv;
  rng: Rng = crtRng;
  tables: Tables | null = null;
  /** _DAT_05d4e144: the HUD icon column's slot 0 texture the hook writes (not drawn here), null until the hook ran */
  column0: number | null = null;
  fishing: FishingNode | null = null;
  bertha: BerthaNode | null = null;
  shoal: ShoalNode | null = null;
  rod: RodNode | null = null;
  popups = new Popups();
  pick: BitePick = newPick();
  spots: Spot[] = [];
  /** DAT_05d5c3d0: the loop's result: 0 playing, 1 won (Bertha caught, the end sequence is over), 2 failed (out of casts) */
  result = 0;
  /** DAT_05d5cb34 + _DAT_0092f578..580: the ripple ring is drawn at this place this frame */
  splash = { on: false, x: 0, y: 0, z: 0 };
  /** _DAT_05d5cbb8: the rod tip of the last draw */
  rodTip: [number, number, number] = [0, 0, 0];
  /** the camera's offset in Pepper's frame and the look-at height (DAT_05d5cae0.. / DAT_05d5cb30) */
  cam: { x: number; y: number; z: number; h: number } = { x: 0, y: K.CAM_B.y, z: K.CAM_B.z, h: K.CAM_B.h };
  /** the helper records of the zone game: the shoal's fish models (15 clones), by fish index */
  clones: GameRecord[] = [];
  /** the message texts shown by the zone game: `fsh.str` ids -> text */
  log: string[] = [];
  /** the fish update's environment (rules.ts) */
  fishEnv: FishEnv | null = null;
  /** the line segments to draw this frame (rod tip -> bobber / fish) */
  line: { a: [number, number, number]; b: [number, number, number] } | null = null;
}

const SHARED = new WeakMap<World, FshShared>();
export const sharedOf = (w: World): FshShared => { let s = SHARED.get(w); if (!s) { s = new FshShared(); SHARED.set(w, s); } return s; };
export const dropShared = (w: World) => { SHARED.delete(w); };

const identity = (): Float32Array => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
/** FUN_0043a5e4 with the executable's 24-bit x87 arithmetic (zones/common/x87.ts); the arguments are float32 stack words. The original leaves the record's Euler word (+0x50) alone. */
const euler = (m: Float32Array, rx: number, ry: number, rz: number, x: number, y: number, z: number) => m.set(euler24(rx, ry, rz, f32(x), f32(y), f32(z)));
/** the rows of the 3x3 part scaled (the pre-transform FUN_004440d0 / FUN_0043a9e5 with 0.5 on the diagonal: translation untouched) */
function scaleRows(m: Float32Array, s: number) { for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m[i] *= s; }
/** the terrain's height below (x, y + 10, z) (FUN_0043cd62(pos, 10)), NO_GROUND (-1e38) over the water */
const NO_GROUND32 = f32(NO_GROUND);
/** FUN_0043ab72(out, M, v): v * M + translation, the products summed z, y, x and stored as float32 */
function xform(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
  const o = transformPointGame(m, [x, y, z]);      // 24-bit x87: ((x m0 + y m4) + z m8) + m12, every operation rounded (render/math.ts)
  return [o[0], o[1], o[2]];
}
/** FUN_0043a9e5(out, A, B) = B * A (B applies first): rows 0..2 of B times A's 3x3, B's translation through A plus A's translation; every element a float32 store */
function mulF32(b: ArrayLike<number>, a: ArrayLike<number>): Float32Array { return mulGame(b, a); }      // 24-bit x87 (render/math.ts)
/** a x b with the two products of every component rounded before the subtraction (24-bit x87: `fld a1; fmul b2; fld a2; fmul b1; fsubp`) */
const cross24 = (a: ArrayLike<number>, b: ArrayLike<number>) => [f32(f32(a[1] * b[2]) - f32(a[2] * b[1])), f32(f32(a[2] * b[0]) - f32(a[0] * b[2])), f32(f32(a[0] * b[1]) - f32(a[1] * b[0]))];
const groundAt = (w: World, x: number, y: number, z: number) => f32(w.col.groundRay(x, f32(y + K.PROBE), z));

abstract class FshNode implements BehaviourNode {
  abstract readonly kind: string;
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  abstract update(w: World, rec: GameRecord, ctrl: Controller): number;
  constructor(attach?: Pick<Attach, 'var' | 'mask' | 'value'>) {
    if (attach) { this.var = attach.var; this.mask = attach.mask; this.value = attach.value; }
  }
}

// ------------------------------------------------------------------------------------------------ the Fishing node (FUN_006f8e5a / FUN_006f6e2b)

/**
 * The fishing machine on Pepper's record. Offsets of the original's node struct in the comments. States: 0 done, 1 walking about (the walk node runs), 2 turning to the
 * spot, 3 walking to it, 4 turning to the lake, 5 arrived, 6 ready (aim with left / right, Ctrl casts), 7 casting (sub-states 0 wind-up, 1 charge the power, 2 throw,
 * 3 the bobber flies, 4 it lies), 8 waiting for a bite, 9 reeling the line in, 10 line coming in after a lost fish, 11 the fight, 12 landed, 13 score panel, 14 end countdown.
 */
export class FishingNode extends FshNode implements FishingView {
  readonly kind = 'Fishing';
  S!: FshShared;
  /** +0xc4 Pepper's record, +0xbc the rod's record, the float's (FLOT, 0x2018) */
  rec!: GameRecord;
  rodRec!: GameRecord;
  floatRec!: GameRecord;
  /** +0x84 state, +0x94 cast sub-state, +0x98 bite (0 none, 1 biting, 2 gone), +0x88 walk flag, +0x8c casting flag */
  state: number = ST.WALK_IDLE; sub = 0; bite = 0; walkFlag = 0; castFlag = 0;
  /** +0x18 distance to the spot, +0x1c yaw, +0x20 target yaw, +0x24 yaw step per tick, +0x28 / +0x2c cast anim rate */
  dist = 0; yaw = 0; yawTarget = 0; yawStep = 0; castRate = 1;
  /** +0x30 line tension, +0x34 taut factor of the bobber, +0x38 flight ticks left */
  tension = 0; taut = 0; flight = 0;
  /** +0x3c Pepper's place at the start of the walk (moved along), +0x48 the spot, +0x54 the step per tick */
  px = 0; py = 0; pz = 0; sx = 0; sy = 0; sz = 0; stx = 0; sty = 0; stz = 0;
  /** +0x60 the bobber, +0x6c its landing place, +0x78 its velocity */
  bx = 0; by = 0; bz = 0; tx = 0; ty = 0; tz = 0; vx = 0; vy = 0; vz = 0;
  /** +0xa8 ticks of walking left, +0xac ticks of turning left, +0xb0 cast power (0..60) */
  walkLeft = 0; turnLeft = 0; power = 0;
  /** +0xb4 the lure's strength, +0xb8 the bobber's bob phase */
  lure = 0; bobPhase = 0;
  /** +0x9c score shown (counts up), +0xa0 score, +0xa4 fish caught, +0xe4 casts left, +0xd8 end ticks, +0xdc / +0xe0 the spot the fisherman walks to */
  shown = 0; total = 0; count = 0; casts: number = K.CASTS; endTicks: number = K.END_TICKS; spotFlag = false; spotIdx = 0;
  /** +0xe8 the hooked / biting fish, +0xf0 the fight music is on, +0xf4 tick counter of the bobbing sound */
  hooked: Fish | null = null; fightMusic = false; counter = 0;
  /** +0x24 the aim offset in state 6 shares the yaw step field */
  aimOffset = 0;
  /** the end banner: score shown + tier (state 13) */
  log: string[] = [];

  constructor(attach?: Pick<Attach, 'var' | 'mask' | 'value'>) {
    super(attach);
    if (!attach) { this.var = 0xfb; this.mask = 2; this.value = 2; }
  }
  /** FUN_006f8e5a's body (the constructor needs the records, which the factory does not have): the float is hidden, the camera preset is B */
  bind(S: FshShared, w: World, rec: GameRecord) {
    this.S = S; this.rec = rec; this.rodRec = w.records[REC.RODD]; this.floatRec = w.records[REC.FLOT];
    this.floatRec.flags = 0;   // *(ushort*)(FLOT + 0x60) = 0
    S.fishing = this;
    this.setCamera(K.CAM_B);
  }

  /** FUN_006f6cd9 (A: after the strike) / FUN_006f6d25 (B) */
  setCamera(c: { y: number; z: number; h: number }) { const cam = this.S.cam; cam.x = 0; cam.y = c.y; cam.z = c.z; cam.h = c.h; }

  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c;
    const S = this.S, env = S.env, dt = w.dt, input = w.input;
    const held = input.held;
    const anim = rec.anim;
    const k1 = f32(1 * dt);        // `_DAT_00892020 * DAT_008b1718`
    this.counter = Math.trunc(this.counter + k1);
    this.floatRec.hide();
    if (this.state !== ST.CAST && anim) anim.advance(1.0, dt);
    switch (this.state) {
      case ST.DONE:
        if (!env.cutsceneActive()) S.result = 1;
        break;
      case ST.TURN_TO_SPOT:
        euler(rec.m, 0, this.yaw, 0, this.px, this.py, this.pz);
        this.yaw = f32(f32(this.yawStep * dt) + this.yaw);
        this.turnLeft = f32(this.turnLeft - k1);
        if (this.turnLeft <= 0) this.state = this.walkFlag === 0 ? ST.TURN_TO_LAKE : ST.WALK_TO_SPOT;
        break;
      case ST.WALK_TO_SPOT: {
        const d0 = f32(k1 * this.stx), d1 = f32(k1 * this.sty), d2 = f32(k1 * this.stz);
        this.px = f32(d0 + this.px); this.py = f32(d1 + this.py); this.pz = f32(d2 + this.pz);
        const h = groundAt(w, this.px, this.py, this.pz);
        if (h !== NO_GROUND32) this.py = h;
        euler(rec.m, 0, this.yaw, 0, this.px, this.py, this.pz);
        this.walkLeft = f32(this.walkLeft - k1);
        if (this.walkLeft <= 0) { this.state = ST.TURN_TO_LAKE; this.turnToLake(rec); }
        break;
      }
      case ST.TURN_TO_LAKE:
        euler(rec.m, 0, this.yaw, 0, this.px, this.py, this.pz);
        this.yaw = f32(f32(this.yawStep * dt) + this.yaw);
        this.turnLeft = f32(this.turnLeft - k1);
        if (this.turnLeft <= 0) { this.yawStep = 0; anim?.start(CLIP.STAND, 0); this.state = ST.ARRIVED; }
        break;
      case ST.ARRIVED:
        env.stop2D(SND.REEL_LOOP); env.stop3D(SND.WRIGGLE);
        if (this.casts < 1) S.result = 2;
        this.state = ST.READY;
        break;
      case ST.READY:
        if ((held & BTN.RIGHT) === 0) {
          if ((held & BTN.LEFT) === 0) {
            if ((held & BTN.CAST) !== 0) {
              anim?.start(CLIP.CAST, 0);
              this.state = ST.CAST; this.castRate = 1; this.castFlag = 1; this.sub = CAST.WINDUP;
            }
          } else if (-K.AIM_LIMIT < this.yawStep) this.yawStep = f32(this.yawStep - K.AIM_STEP);
        } else if (this.yawStep < K.AIM_LIMIT) this.yawStep = f32(this.yawStep + K.AIM_STEP);
        euler(rec.m, 0, f32(this.yaw + this.yawStep), 0, this.px, this.py, this.pz);
        break;
      case ST.CAST: this.updateCast(w, rec); break;
      case ST.WAIT: this.updateWait(w, rec); break;
      case ST.REEL: this.updateReel(w, rec); break;
      case ST.RETRIEVE: this.updateRetrieve(w, rec); break;
      case ST.FIGHT: this.updateFight(w, rec); break;
      case ST.LANDED: this.updateLanded(w, rec); break;
      case ST.SCORE: this.updateScore(w, rec); break;
      case ST.END:
        this.endTicks = Math.trunc(this.endTicks - k1);
        if (this.endTicks < 1) {
          this.state = ST.DONE;
          anim?.start(CLIP.IDLE, 0);
          env.cutsceneStart(1);   // FUN_0045c40c(1): ADV11 "FallOfBigBertha" (skipped when the game was started from the menu)
          w.vars.set(0x53, 1);    // COMPLETE_SUB_GAME
        }
        break;
      default: break;
    }
    // the fight music (FUN_004432c0 on the Jaws / the zone's track)
    if (this.state === ST.FIGHT) { if (!this.fightMusic) { env.fightMusic(true); this.fightMusic = true; } }
    else if (this.fightMusic) { env.fightMusic(false); this.fightMusic = false; }
    this.cameraStep(w, rec);
    return NODE_STOP;
  }

  /** the yaw turn to face the lake centre (FUN_006f6e2b case 3's end: float32 stores) */
  private turnToLake(rec: GameRecord) {
    const fx = rec.m[8], fz = rec.m[10];
    const dx = f32(K.LAKE_CENTRE[0] - rec.m[12]), dz = f32(K.LAKE_CENTRE[2] - rec.m[14]);
    this.yawTarget = f32(Math.atan2(dx, dz));
    this.yaw = f32(Math.atan2(fx, fz));
    if (this.yawTarget < this.yaw) this.yawTarget = f32(this.yawTarget + TWO_PI);
    this.yawStep = f32(this.yawTarget - this.yaw);
    if (PI < this.yawStep) this.yawStep = f32(-(TWO_PI - this.yawStep));
    this.turnLeft = f32(Math.abs(this.yawStep / K.TURN_STEP));
    this.yawStep = f32(this.yawStep / this.turnLeft);
  }

  /** FUN_006f6d71: the camera looks at Pepper (+ height), the eye eases towards the preset's offset in her frame */
  private cameraStep(w: World, rec: GameRecord) {
    const cam = this.S.cam, cc = w.camera.c;
    cc[3] = rec.m[12]; cc[4] = f32(cam.h + rec.m[13]); cc[5] = rec.m[14];
    const m = rec.m;
    // FUN_0043ab72 (24-bit x87: ((x m0 + y m4) + z m8) + m12, every operation rounded), then the ease: ((e - c) * k) + c
    const [ex, ey, ez] = xform(m, cam.x, cam.y, cam.z);
    cc[0] = f32(f32(f32(ex - cc[0]) * K.CAM_EASE) + cc[0]);
    cc[2] = f32(f32(f32(ez - cc[2]) * K.CAM_EASE) + cc[2]);
    cc[1] = f32(f32(f32(ey - cc[1]) * K.CAM_EASE) + cc[1]);
  }

  // ---------------------------------------------------------------- 7: casting

  private updateCast(w: World, rec: GameRecord) {
    const S = this.S, env = S.env, dt = w.dt, anim = rec.anim, k1 = f32(1 * dt);
    switch (this.sub) {
      case CAST.WINDUP: {
        anim?.advance(this.castRate, dt);
        if (anim && K.CAST_FRAME <= anim.frame) {
          this.sub = CAST.CHARGE;
          env.play2D(SND.CAST_STRENGTH);
          this.power = 0;
        }
        break;
      }
      case CAST.CHARGE:
        this.power = f32(k1 + this.power);
        if (K.POWER_MAX < this.power || (w.input.pressed & BTN.CAST) !== 0) {
          env.stop2D(SND.CAST_STRENGTH);
          this.sub = CAST.THROW;
          env.play2D(randT(S.rng, 5) < 3 ? SND.CAST1 : SND.CAST2);
          this.casts -= 1;
        }
        break;
      case CAST.THROW: {
        if (!anim) break;
        const r = anim.advance(this.castRate, dt);
        if (r === 2) {
          anim.seek(f32(anim.frameCount - 1.0));
          if (this.power <= K.POWER_MAX) {
            if (K.POWER_MIN <= this.power) {
              S.popups.add(MSG.GOOD_CAST, 5, 5, 2, 300, 0x1b8);
              this.sub = CAST.FLIGHT;
              const fx = rec.m[8], fy = rec.m[9], fz = rec.m[10];
              const x = rec.m[12], y = rec.m[13], z = rec.m[14];
              this.bx = x; this.by = y; this.bz = z;
              this.by = f32(this.by + K.LAUNCH_LIFT);
              this.tx = f32(x + f32(this.power * fx)); this.ty = f32(y + f32(this.power * fy)); this.tz = f32(z + f32(this.power * fz));      // asm 0x6f7813: the product is stored first
              this.ty = 0;
              const dx = f32(this.tx - this.bx), dy = f32(this.ty - this.by), dz = f32(this.tz - this.bz);
              this.vx = f32(dx * K.INV_FLIGHT); this.vy = f32(dy * K.INV_FLIGHT); this.vz = f32(dz * K.INV_FLIGHT);
              this.vy = f32(this.vy + 1.0);
              this.flight = K.FLIGHT_TICKS;
            } else {
              S.popups.add(MSG.TANGLED, 6, 5, 2, 300, 0x1b8);
              this.state = ST.ARRIVED;
              anim.start(CLIP.STAND, 0);
            }
          } else {
            S.popups.add(MSG.TOO_HARD, 6, 5, 2, 300, 0x1b8);
            this.state = ST.ARRIVED;
            anim.start(CLIP.STAND, 0);
          }
        }
        break;
      }
      case CAST.FLIGHT: {
        env.play2D(SND.PEPP_CAST);
        this.drawBobber(w, rec);
        this.bx = f32(f32(this.vx * dt) + this.bx); this.by = f32(f32(this.vy * dt) + this.by); this.bz = f32(f32(this.vz * dt) + this.bz);
        this.vy = f32(this.vy - f32(K.GRAVITY * dt));
        this.flight = f32(this.flight - k1);
        if (this.flight < 0) {
          const h = groundAt(w, this.bx, this.by, this.bz);
          if (h === NO_GROUND32) {
            this.castFlag = 0; this.sub = CAST.LANDED;
            anim?.start(CLIP.CAST_THROW, 0);
            this.bite = 0;
            this.lure = K.LURE; this.bobPhase = 0;
            this.by = this.ty;
            // (the ring's place / flag are set by the bobber's draw FUN_006f665b from the next tick on, not here)
            env.splash(this.bx, this.by, this.bz);
            if (randI(S.rng, 10) < 5) env.play3D(SND.SPLASH2, this.bx, this.by, this.bz); else env.play3D(SND.SPLASH1, this.bx, this.by, this.bz);
          } else {
            anim?.start(CLIP.CAST_THROW, 0);
            this.state = ST.RETRIEVE;
          }
        }
        break;
      }
      case CAST.LANDED: {
        this.drawBobber(w, rec);
        const r = anim ? anim.advance(1.0, dt) : 0;
        if (r === 2) {
          env.stop2D(SND.REEL_LOOP); env.stop3D(SND.WRIGGLE);
          anim?.start(CLIP.WAIT, 0);
          this.state = ST.WAIT; this.sub = 0;
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- 8 / 9 / 10: the line is out

  private bobSound(rec: GameRecord, two: boolean) {
    const S = this.S, env = S.env;
    if (K.BOB_SOUND_TICKS < this.counter) {
      const r = two ? randI(S.rng, 2) : randI(S.rng, 10);
      const second = two ? r === 0 : r < 5;
      env.play3D(second ? SND.BOB2 : SND.BOB1, rec.m[12], rec.m[13], rec.m[14]);
      this.counter = 0;
    }
  }

  private updateWait(w: World, rec: GameRecord) {
    const S = this.S, env = S.env, dt = w.dt, anim = rec.anim, held = w.input.held;
    this.bobSound(rec, true);
    this.drawBobber(w, rec);
    if (this.bite === 2) { anim?.start(CLIP.CAST_THROW, 0); this.state = ST.RETRIEVE; }
    if ((w.input.pressed & BTN.UP) !== 0 && this.bite === 1) {
      anim?.start(CLIP.STRIKE, 0);
      this.state = ST.FIGHT;
      env.play3D(SND.STRIKE, rec.m[12], rec.m[13], rec.m[14]);
      this.tension = K.TENSION_START;
      this.setCamera(K.CAM_A);
    }
    if ((held & BTN.DOWN) === 0) {
      env.stop2D(SND.REEL_LOOP);
      if (0 < this.taut) this.taut = f32(this.taut - f32(K.TAUT_DECAY * dt));
    } else {
      env.play2D(SND.REEL_LOOP);
      this.state = ST.REEL;
      env.splash(this.bx, this.by, this.bz, false);   // FUN_00442a20(emitter, 1, 1, 1): the burst stops
      anim?.start(CLIP.CAST_THROW, 0);
    }
  }

  /** the bobber is pulled towards Pepper by 0.4 per tick along her forward direction; arrival within 8 */
  private reelIn(w: World, rec: GameRecord, clip: number, stopWriggle = true): boolean {
    const dt = w.dt;
    const k = f32(K.REEL_SPEED * dt);
    const m = rec.m;
    const d0 = f32(m[8] * k), d1 = f32(m[9] * k), d2 = f32(m[10] * k);
    this.bx = f32(this.bx - d0); this.by = f32(this.by - d1); this.bz = f32(this.bz - d2);
    const dx = f32(this.bx - m[12]), dy = f32(this.by - m[13]), dz = f32(this.bz - m[14]);
    const d = Math.sqrt(dz * dz + dy * dy + dx * dx);
    if (d < K.ARRIVE_DIST) {
      const env = this.S.env;
      env.stop2D(SND.REEL_LOOP); if (stopWriggle) env.stop3D(SND.WRIGGLE);     // state 9 stops both sounds, state 10 only the reel loop
      rec.anim?.start(clip, 0);
      this.state = ST.ARRIVED;
      if (this.bite === 0) this.casts += 1;   // no bite: the cast is given back
      return true;
    }
    return false;
  }

  private updateReel(w: World, rec: GameRecord) {
    const held = w.input.held, anim = rec.anim;
    this.bobSound(rec, false);
    this.drawBobber(w, rec);
    this.taut = K.TAUT; this.lure = K.LURE; this.bobPhase = PI;
    if (this.reelIn(w, rec, CLIP.STAND)) return;
    if ((held & BTN.DOWN) === 0) { anim?.start(CLIP.WAIT, 0); this.state = ST.WAIT; }
  }

  private updateRetrieve(w: World, rec: GameRecord) {
    this.S.env.play2D(SND.REEL_LOOP);
    this.drawBobber(w, rec);
    rec.anim?.advance(1.0, w.dt);        // FUN_006f6e2b case 10 advances Pepper's clip a second time this tick (the top of the function did it once)
    this.taut = K.TAUT;
    this.reelIn(w, rec, CLIP.STAND, false);
  }

  // ---------------------------------------------------------------- 11: the fight

  private updateFight(w: World, rec: GameRecord) {
    const S = this.S, env = S.env, dt = w.dt, anim = rec.anim, held = w.input.held;
    const fish = this.hooked!;
    this.taut = K.TAUT_FIGHT;
    const h = groundAt(w, fish.x, fish.y, fish.z);
    if (h !== NO_GROUND32 || fish.dist < K.LAND_DIST) {
      anim?.start(CLIP.PULL, 0);
      this.state = ST.LANDED;
      fish.hooked = false; fish.y = -2; fish.weight = fish.weight0;
      this.setCamera(K.CAM_B);
      env.stop3D(SND.WRIGGLE);
      env.play2D(SND.FISH_CAUGHT);
    }
    if (this.tension < K.TENSION_MIN || K.TENSION_MAX < this.tension) {
      this.bite = 2;
      if (K.TENSION_MIN <= this.tension) {
        fish.approaching = false;
        S.popups.add(MSG.SNAPPED, 5, 10, 2, 300, 0x1b8);
        env.stop3D(SND.WRIGGLE); env.play2D(SND.LINE_SNAP);
      } else {
        fish.approaching = false;
        S.popups.add(MSG.SLACK, 5, 10, 2, 300, 0x1b8);
        env.stop3D(SND.WRIGGLE); env.play2D(SND.LOSE_TENSION);
      }
      anim?.start(CLIP.STAND, 0);
      this.state = ST.ARRIVED;
      fish.y = -2;
      this.setCamera(K.CAM_B);
    } else if ((held & BTN.DOWN) !== 0) {
      env.play2D(randI(S.rng, 10) < 4 ? SND.FISH_REELIN2 : SND.FISH_REELIN);
      this.tension = f32(f32(K.TENSION_REEL * dt) + this.tension);
      const r = randI(S.rng, 400);
      if (r < 390) {
        if (r < 380) {
          if (r < 370) { if (359 < r) env.play2D(SND.PEPP_REEL1); } else env.play2D(SND.PEPP_REEL2);
        } else env.play2D(SND.PEPP_REEL3);
      } else env.play2D(SND.PEPP_REEL4);
    }
    // asm 0x6f8582: `fst` stores a float copy of (20 - weight) * 0.04 but the register keeps the double: tension = (float)(tension - ((20 - weight) * 0.04) * dt)
    this.tension = f32(this.tension - f32(f32(f32(K.TENSION_WEIGHT - fish.weight) * K.TENSION_RELIEF) * dt));
    env.play3D(SND.WRIGGLE, rec.m[12], rec.m[13], rec.m[14]);
    const r = randI(S.rng, 100);
    if (r < 99) {
      if (r < 98) { if (96 < r) env.play2D(SND.ROD_WIND1); } else env.play2D(SND.ROD_WIND2);
    } else env.play2D(SND.ROD_WIND3);
  }

  // ---------------------------------------------------------------- 12: landed

  private updateLanded(w: World, rec: GameRecord) {
    const S = this.S, env = S.env, anim = rec.anim;
    const fish = this.hooked!;
    env.stop3D(SND.WRIGGLE);
    this.count += 1;
    this.total = Math.trunc(this.total + fish.weight0 * K.POINTS_PER_KG);
    const w0 = fish.weight0;
    const txt = `${String(Math.round(w0)).padStart(2)}kg = ${String(Math.round(f32(w0 * K.POINTS_PER_KG))).padStart(2)}pts`;
    S.popups.add(txt, 5, 10, 2, 300, 0x1b8, true);
    restoreHooks.cue?.('fsh-catch', { addPopup: (id: string, count: number, on: number, off: number, x: number, y: number) => S.popups.add(id, count, on, off, x, y) });   // restored content (option off: unset): FSH5 "Mooie vis!"
    this.log.push(`caught ${w0}kg total ${this.total}${fish.bertha ? ' (Bertha)' : ''}`);
    if (!fish.bertha) {
      env.play2D(SND.CATCH_FISH);
      this.state = ST.READY;
      anim?.start(CLIP.STAND, 0);
      env.say(CATCH_LINES[randT(S.rng, 7)]);
    } else {
      this.state = ST.SCORE;
      anim?.start(CLIP.HOLD_UP, 0);
      env.play2D(SND.CATCH_BERTHA);
      if (this.total > K.BANNER_GOLD - 1) env.say('ADSGFI01');
      else if (this.total > K.BANNER_SILVER - 1) env.say('ADSGFI02', 'ADSGFI03');
      else env.say('ADSGFI04');
    }
  }

  // ---------------------------------------------------------------- 13: score panel

  /** the score panel waits for a button, then raises the hi-score and trophy (HISCORE_FSH 0x38, TROPHY_FSH 0x88) */
  private updateScore(w: World, _rec: GameRecord) {
    void _rec;
    const S = this.S;
    S.popups.clear();
    if (w.input.pressed !== 0) {
      if (w.vars.get(0x38) < this.total) {
        w.vars.set(0x38, this.total);
        if (this.total < K.TROPHY_GOLD) w.vars.set(0x88, this.total < K.TROPHY_SILVER ? 1 : 2);
        else w.vars.set(0x88, 3);
      }
      this.state = ST.END;
    }
  }

  // ---------------------------------------------------------------- the bobber (FUN_006f665b)

  /**
   * Places the bobber model (FLOT) like FUN_006f665b: when the line is slack it bobs on the water, when taut it leans away from the record `rec` it is given (Pepper from the
   * machine, the ROD record from the rod's hook). While it lies in the water (state > 7 or the landed sub-state) the ripple ring is drawn at its place. The original never calls it
   * in the fight (its first branch for state 0xb is dead code).
   */
  drawBobber(w: World, rec: GameRecord) {
    const S = this.S, dt = w.dt, f = this.floatRec;
    const m = new Float32Array(16);
    const sin = f32(Math.sin(this.bobPhase));
    let px = this.bx, py = this.by, pz = this.bz;
    const rows = (r0: number[], r1: number[], r2: number[]) => {
      m[0] = r0[0]; m[1] = r0[1]; m[2] = r0[2]; m[4] = r1[0]; m[5] = r1[1]; m[6] = r1[2]; m[8] = r2[0]; m[9] = r2[1]; m[10] = r2[2];
    };
    if (this.taut <= 0) {
      rows([1, 0, 0], [0, 1, 0], [0, 0, 1]);
      if (this.state === ST.CAST) { /* flight / rod: the bobber itself */ }
      else {
        this.bobPhase = f32(f32(K.BOB_STEP * dt) + this.bobPhase);
        if (this.lure <= 0) this.lure = 0; else this.lure = f32(this.lure - f32(K.LURE_DECAY * dt));
        py = f32(this.lure * sin);
      }
    } else {
      const back = [f32(rec.m[8] * -1), f32(rec.m[9] * -1), f32(rec.m[10] * -1)];
      const up = [f32(f32(this.taut * 1.0 * back[0]) + 0), f32(f32(this.taut * 1.0 * back[1]) + 1.0), f32(f32(this.taut * 1.0 * back[2]) + 0)];
      normalize(up);
      const b = cross24(up, back);
      normalize(b);
      const c = cross24(b, up);
      normalize(c);
      rows(b, up, c);
    }
    m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
    scaleRows(m, K.MODEL_SCALE); f.m.set(m); f.show();
    if (7 < this.state || (this.state === ST.CAST && this.sub === CAST.LANDED)) {
      S.splash.on = true; S.splash.x = this.bx; S.splash.y = f32(K.SPLASH_LIFT + this.by); S.splash.z = this.bz;
    }
  }
}

// ------------------------------------------------------------------------------------------------ the HUD hook (FUN_006f514c -> FUN_00705c64)

/** HUD texture indices of Overlays/Z21FSH (FUN_00705b60): left icon 4 (casts left), right icon 5 (fish caught), the gauge's segments 1 / 2 / 3, markers 6 (cast power) / 7 (tension), the icon column's slot 0: 8 */
export const HUD_TEX = { CASTS: 4, FISH: 5, MARKER_POWER: 6, MARKER_TENSION: 7, COLUMN0: 8 } as const;
export const GAUGE_SEGMENTS = [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3];
/** what the hook writes (the shell's Hud has these members) */
export interface HudLike {
  leftText?: string; rightText?: string; centreText?: string;
  gauge: { value: number; min: number; max: number; segments: number[]; marker: number; icon: number } | null;
}
/**
 * FUN_006f514c: the draw hook of the FSwitch node runs FUN_00705c64 only while 0 < state < 13 (otherwise the HUD keeps what it shows): "x%d" casts left, "x%d" fish caught, "%d" the counting score
 * (texts first, then the score moves up by FUN_004388ae(20)), the icon column's slot 0 (texture DAT_05d5cbd0 + 8 = 8, DAT_05d5cbd0 is never written: kept in `S.column0`; the column is not drawn in this zone), the gauge
 * (state 7: the cast power with marker 6, state 11: the tension with marker 7; off in the other states).
 */
export function hudHook(S: FshShared, hud: HudLike) {
  const F = S.fishing;
  if (!F || !(F.state < 13 && F.state !== 0)) return;
  hud.leftText = `x${F.casts}`;
  hud.rightText = `x${F.count}`;
  hud.centreText = String(F.shown);
  if (F.shown < F.total) {
    F.shown = Math.trunc(f32(F.shown + randF(S.rng, K.SCORE_STEP)));      // FUN_004388ae(20), fild + fadd (24-bit: rounded), __ftol
    if (F.total < F.shown) F.shown = F.total;
  }
  S.column0 = HUD_TEX.COLUMN0;      // written, never drawn: the column's enable flag DAT_05d4e13c is only set by the island / hub HUD set-ups, not by this zone
  if (F.state === ST.FIGHT || F.state === ST.CAST) {
    hud.gauge = { value: F.state === ST.CAST ? F.power : F.tension, min: 0, max: K.GAUGE_MAX, segments: GAUGE_SEGMENTS, marker: F.state === ST.CAST ? HUD_TEX.MARKER_POWER : HUD_TEX.MARKER_TENSION, icon: -1 };
  } else hud.gauge = null;
}

// ------------------------------------------------------------------------------------------------ the switch (FUN_006f51e6 / FUN_006f4bfa)

export class FshSwitchNode extends FshNode {
  readonly kind = 'FSwitch';
  S!: FshShared;
  bind(S: FshShared) { this.S = S; }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const S = this.S, dt = w.dt;
    const F = S.fishing ?? (ctrl.nodes.find((n) => n instanceof FishingNode) as FishingNode | undefined) ?? null;
    if (!F) return NODE_CONTINUE;
    S.popups.tick(dt);
    const fb = w.vars.get(0xfb);
    // FUN_006f4b65 (the decompile lists only the variable read; the asm): 1 when the mode variable is 2 and the machine is below state 7 (casting), or when it is 1
    const allowed = (fb === 2 && F.state < ST.CAST) || fb === 1;
    if (!S.env.cutsceneActive() && (w.input.pressed & BTN.ACTION) !== 0 && allowed && (F.state > ST.TURN_TO_LAKE || F.state === ST.WALK_IDLE)) {
      rec.anim?.start(CLIP.WALK, 0);
      if (fb === 1) {
        let best = 0;
        const m = rec.m;
        F.px = m[12]; F.py = m[13]; F.pz = m[14];
        const sp = S.spots;
        // the squared distances are float32 stores (local_c / local_8)
        const d2 = (i: number) => { const s = sp[i]; const dx = f32(s.x - F.px), dy = f32(s.y - F.py), dz = f32(s.z - F.pz); return f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz)); };      // the asm sums x, y, z; 24-bit x87: every operation rounds
        let bd = d2(0);
        for (let i = 1; i < sp.length; i++) { const d = d2(i); if (d < bd) { best = i; bd = d; } }
        const s = sp[best];
        F.sx = s.x; F.sy = s.y; F.sz = s.z;
        F.spotIdx = best; F.spotFlag = true;
        F.stx = f32(s.x - F.px); F.sty = f32(s.y - F.py); F.stz = f32(s.z - F.pz);
        F.dist = f32(Math.sqrt(f32(f32(f32(F.stx * F.stx) + f32(F.sty * F.sty)) + f32(F.stz * F.stz))));      // the sum is stored as a double after rounding to 24 bits at every operation (24-bit x87), then the CRT's sqrt
        F.state = ST.TURN_TO_SPOT;
        F.walkLeft = f32(F.dist / K.WALK_STEP);
        if (0 < F.walkLeft) {
          F.walkFlag = 1;
          const k = f32(1.0 / F.walkLeft);
          F.stx = f32(k * F.stx); F.sty = f32(k * F.sty); F.stz = f32(k * F.stz);
        } else F.walkFlag = 0;
        F.yawTarget = f32(Math.atan2(F.stx, F.stz));
        F.yaw = f32(Math.atan2(m[8], m[10]));
        if (F.yawTarget < F.yaw) F.yawTarget = f32(F.yawTarget + TWO_PI);
        F.yawStep = f32(F.yawTarget - F.yaw);
        if (PI < F.yawStep) F.yawStep = f32(-(TWO_PI - F.yawStep));
        F.turnLeft = f32(Math.abs(F.yawStep / K.TURN_STEP));
        F.yawStep = f32(F.yawStep / F.turnLeft);
        w.vars.set(0xfb, 2);
        if (Number.isNaN(F.stx) || Number.isNaN(F.yaw)) throw new Error('FSwitch: NaN (int3 in the original)');
      } else if (fb === 2) {
        F.castFlag = 0;
        w.vars.set(0xfb, 1);
      }
    }
    return NODE_CONTINUE;
  }
}

// ------------------------------------------------------------------------------------------------ Bertha (FUN_006f56d0 / FUN_006f54c0)

export class BerthaNode extends FshNode {
  readonly kind = 'Bertha';
  S!: FshShared;
  fish!: Fish;
  follower!: Follower;
  /** FUN_006f56d0 */
  bind(S: FshShared, _w: World, rec: GameRecord) {
    this.S = S;
    const tables = S.tables;
    const pts = tables?.path ?? [[0, 0, 0]];
    this.follower = new Follower(pts, K.BERTHA_START % pts.length, K.BERTHA_LEG);
    rec.anim?.start(1, 0);
    const f = new Fish(rec.m);
    f.bertha = true;
    const r = S.rng;
    // the original's order of the random draws (FUN_006f56d0): x, z, phase, the swim phase rate, the speed, then the unused [0x17] (WP-VERIFY: the port drew the rates first and skipped the last)
    f.weight = f.weight0 = K.BERTHA_WEIGHT;
    f.x = f32(randF(r, K.SPREAD) + this.follower.pos[0]); f.y = this.follower.pos[1]; f.z = f32(randF(r, K.SPREAD) + this.follower.pos[2]);
    f.phase = f32(randF(r, PI));
    f.phaseRate = f32(randF(r, 8) / 50);
    f.speed = f32(randF(r, 8) / 50 + f32(0.1));
    f.turn = f32(0.1);
    if (0 < f.y) f.y = 0;
    f.unused17 = f32(randF(r, 20));
    f.radiusBase = 8; f.radiusA = 8; f.angle = 0; f.hooked = false; f.biting = false;
    this.fish = f;
    S.bertha = this;
  }
  update(w: World, rec: GameRecord): number {
    const S = this.S;
    if (!this.follower) return NODE_STOP;      // not prepared (generic stub test)
    rec.anim?.advance(1.0, w.dt);
    this.follower.tick(w.dt);
    fishStep(this.fish, this.follower, fishEnv(w, S));
    // the draw hook FUN_006f5553 pre-transforms the model by diag(0.5) with a translation of -1 along z (before the record matrix): rows * 0.5, the place moves back by the forward row
    const m = rec.m, fx = m[8], fy = m[9], fz = m[10];
    scaleRows(m, K.MODEL_SCALE);
    m[12] = f32(m[12] - fx); m[13] = f32(m[13] - fy); m[14] = f32(m[14] - fz);
    return NODE_STOP;
  }
}

// ------------------------------------------------------------------------------------------------ the shoal (FUN_006f6034 / FUN_006f5dac)

export class ShoalNode extends FshNode {
  readonly kind = 'Shoal';
  S!: FshShared;
  fish: Fish[] = [];
  follower!: Follower;
  /** the model class of each fish (0..2: FSH0 / FSH1 / FSH2 by the starting weight) */
  lod: number[] = [];
  /** FUN_006f6034 (the three model records are hidden: `flags &= ~2`) */
  bind(S: FshShared, w: World, _rec: GameRecord) {
    this.S = S;
    for (const i of (S.tables?.lods ?? [REC.FSH0, REC.FSH1, REC.FSH2])) w.records[i]?.hide();
    const pts = S.tables?.path ?? [[0, 0, 0]];
    this.follower = new Follower(pts, 0, K.SHOAL_LEG);
    const r = S.rng;
    for (let i = 0; i < K.FISH; i++) {
      const f = new Fish(identity());
      f.index = i;
      f.x = f32(randF(r, K.SPREAD) + this.follower.pos[0]); f.y = this.follower.pos[1]; f.z = f32(randF(r, K.SPREAD) + this.follower.pos[2]);
      f.phase = f32(randF(r, PI));
      f.weight = i;
      if (f.weight < K.FISH_WEIGHT_MIN) f.weight = 2;
      if (K.FISH_WEIGHT_MAX < f.weight) f.weight = 17;
      f.weight0 = f.weight;
      this.lod.push(K.LOD1 <= f.weight ? (K.LOD2 <= f.weight ? 2 : 1) : 0);
      f.randomise(r);
      if (0 < f.y) f.y = 0;
      f.unused17 = f32(randF(r, 20));
      f.radiusBase = 8; f.radiusA = 8;
      this.fish.push(f);
    }
    S.shoal = this;
  }
  update(w: World): number {
    this.follower.tick(w.dt);
    const env = fishEnv(w, this.S);
    for (const f of this.fish) { fishStep(f, this.follower, env); }
    return NODE_CONTINUE;
  }
  /** the draw hook FUN_006f5e8d: the bite picker, then the clones carry the fish matrices (half size) */
  prerender(w: World) {
    const S = this.S;
    pickBite(S.fishing, S.pick, { struck: () => bobberStruck(w, S) }, w.dt);
    this.fish.forEach((f, i) => {
      const c = S.clones[i];
      if (!c) return;
      c.m.set(f.m); scaleRows(c.m, K.MODEL_SCALE);
      c.show();
    });
  }
}

/** the strike message and sound of the picker (FUN_006f48c9(FSH4, 1, 30, 0, 320, 180) + FUN_004433f0(DAT_05d5ca8c, bobber)) */
function bobberStruck(_w: World, S: FshShared) {
  const F = S.fishing;
  S.popups.add(MSG.STRIKE, 1, 30, 0, 320, 180);
  if (F) S.env.play3D(SND.BITES, F.bx, F.by, F.bz);
}

/** the fish update's environment for this tick */
function fishEnv(w: World, S: FshShared): FishEnv {
  const e = S.fishEnv ?? (S.fishEnv = { fishing: S.fishing, held: 0, dt: 1, pick: S.pick, buildEuler: euler });
  e.held = w.input.held; e.dt = w.dt; e.fishing = S.fishing;
  return e;
}

// ------------------------------------------------------------------------------------------------ the splash ring (FUN_006f5aa1 / FUN_006f59e4)

export class SplashNode extends FshNode {
  readonly kind = 'Splash';
  S!: FshShared;
  bind(S: FshShared) { this.S = S; }
  update(): number { return NODE_STOP; }
  /** the ring (SPLH, the model of record 11) lies at the bobber while it floats */
  prerender(w: World) {
    const S = this.S;
    const r = w.records[REC.SPLH];
    if (!r) return;
    if (S.splash.on) {
      const m = identity(); m[12] = S.splash.x; m[13] = S.splash.y; m[14] = S.splash.z;
      r.m.set(m); r.show();
      S.splash.on = false;
    } else r.hide();
  }
}

// ------------------------------------------------------------------------------------------------ the rod (FUN_006f9cdc / FUN_006f94d4)

export class RodNode extends FshNode {
  readonly kind = 'rod';
  S!: FshShared;
  /** +0x18 the bend frame, +0x1c its velocity, +0x20 its acceleration, +0x24 its target */
  bend = 0; vel = 0; acc: number = K.ROD_SPRING; target: number = K.ROD_BEND;
  /** FUN_006f9cdc: the rod's clip 1 */
  bind(S: FshShared, _w: World, rec: GameRecord) {
    this.S = S; S.rod = this;
    rec.anim?.start(1, 0);
  }
  update(): number { return NODE_CONTINUE; }

  /** FUN_006f94d4 (float32 stores like the original; the bone matrices are the animation engine's) */
  prerender(w: World, rec: GameRecord) {
    const S = this.S, F = S.fishing;
    S.line = null;
    if (!F) return;
    if (S.env.cutsceneActive()) return;
    const st = F.state;
    this.target = st === ST.REEL ? K.ROD_BEND_REEL : st === ST.FIGHT ? K.ROD_BEND_FIGHT : K.ROD_BEND;
    this.acc = f32(f32(this.target - this.bend) * K.ROD_SPRING);
    this.bend = f32(this.bend + this.vel);
    this.vel = f32(this.vel + this.acc);
    this.vel = f32(this.vel * K.ROD_DAMP);
    rec.anim?.seek(this.bend);
    const pep = F.rec;
    const pose = pep.anim?.pose(1);
    const hb = K.HAND_BONE;
    const hand = pose && pose.length >= (hb + 1) * 16 ? pose.subarray(hb * 16, hb * 16 + 16) : null;
    const hx = hand ? hand[12] : 0, hy = hand ? hand[13] : 0, hz = hand ? hand[14] : 0;
    const base = xform(pep.m, f32(hx + K.ROD_BASE[0]), f32(hy + K.ROD_BASE[1]), f32(hz + K.ROD_BASE[2]));
    if (st < ST.WAIT) {
      if (st === ST.CAST) {
        rec.show();
        const local = euler24(0, K.ROD_CAST_ROT[1], 0, K.ROD_CAST_POS[0], K.ROD_CAST_POS[1], K.ROD_CAST_POS[2]);
        // FUN_0043a9e5(out, A, B) = B * A: rod = (local * hand) * Pepper
        if (hand) rec.m.set(mulF32(mulF32(local, hand), pep.m)); else rec.m.set(pep.m);
        const tip = this.tip(rec);
        if (F.sub < CAST.FLIGHT) {
          F.bx = tip[0]; F.by = tip[1]; F.bz = tip[2];
          F.drawBobber(w, rec);        // FUN_006f665b(Fishing node, the ROD record): its forward row is the taut bobber's lean (not Pepper's)
        } else S.line = { a: tip, b: [F.bx, F.by, F.bz] };
        S.rodTip = tip;
      } else rec.hide();
      return;
    }
    rec.show();
    let target: [number, number, number];
    if (st < ST.FIGHT) target = [F.bx, F.by, F.bz];
    else if (F.hooked && !F.hooked.hooked) target = [F.hooked.x, F.hooked.y, F.hooked.z];
    else if (F.hooked) target = [F.hooked.mx, F.hooked.my, F.hooked.mz];
    else target = [F.bx, F.by, F.bz];
    const b = [f32(base[0] - target[0]), f32(base[1] - target[1]), f32(base[2] - target[2])];
    normalize(b);
    const s = [f32(b[1] * 0 - b[2] * 1), f32(b[2] * 0 - b[0] * 0), f32(b[0] * 1 - b[1] * 0)];
    normalize(s);
    const t = cross24(b, s);
    normalize(t);
    const m = rec.m;
    m[8] = s[0]; m[9] = s[1]; m[10] = s[2]; m[4] = b[0]; m[5] = b[1]; m[6] = b[2]; m[0] = t[0]; m[1] = t[1]; m[2] = t[2];
    m[12] = base[0]; m[13] = base[1]; m[14] = base[2];
    const tip = this.tip(rec);
    S.rodTip = tip;
    S.line = { a: tip, b: target };
  }

  /** the tip of the rod: bone 9 of its animation through its matrix */
  private tip(rec: GameRecord): [number, number, number] {
    const pose = rec.anim?.pose(1);
    const b = pose && pose.length >= 10 * 16 ? pose.subarray(9 * 16, 9 * 16 + 16) : null;
    return xform(rec.m, b ? b[12] : 0, b ? b[13] : 0, b ? b[14] : 0);
  }
}

// ------------------------------------------------------------------------------------------------ the fisherman (FUN_006f937d / FUN_006f9090)

/**
 * The old man on the bank (record FSHM, behind the generic talking minifig node): first he walks to way-point 2 of the PATH map and turns to face Pepper; when Pepper
 * walks to a fishing spot (the Fishing node's `spotFlag`) he walks to the way-point the table at 0x92f720 gives for that spot and faces her again.
 */
export class FishermanNode extends FshNode {
  readonly kind = 'Fisherman';
  S!: FshShared;
  /** +0x28 state (0 start, 1 walking to way-point 2, 2 waiting, 4 walking to a spot's way-point), +0x2c the way-point he walks to */
  state = 0; route = 0;
  /** +0x18 place, +0x24 yaw */
  x = 0; y = 0; z = 0; yaw = 0;
  private out: StepOut = { yaw: 0, dist: 0 };
  /** FUN_006f937d: the place is the constant (0x4252cccd, 0x406a3d71, 0xc215ae14), the idle clip */
  bind(S: FshShared, _w: World, rec: GameRecord) {
    this.S = S;
    this.x = K.FISHERMAN_HOME[0]; this.y = K.FISHERMAN_HOME[1]; this.z = K.FISHERMAN_HOME[2];
    rec.anim?.start(CLIP.IDLE, 0);
  }
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const S = this.S, F = S.fishing, dt = w.dt;
    const h = ctrl.walker;
    let code = -1;
    if (h && waypoints.get(h)) {
      const pos = [this.x, this.y, this.z];
      code = waypoints.step(h, pos, this.yaw, this.out, dt);
      this.yaw = this.out.yaw; this.x = pos[0]; this.z = pos[2];
    }
    const gh = w.col.terrainHeight(this.x, this.y, this.z, 16);
    if (gh !== NO_GROUND) this.y = gh;
    rec.anim?.advance(1.0, dt);
    const pep = F?.rec ?? w.focus;
    const walk = () => { rec.anim?.start(CLIP.WALK, 0); };
    const wait = () => { if (h && pep) waypoints.followRecord(h, pep); rec.anim?.start(CLIP.IDLE, 0); };
    switch (this.state) {
      case 0:
        if (h) { waypoints.goTo(h, 2, 0); waypoints.resume(h); }
        this.state = 1; walk();
        break;
      case 1:
        if (code === 2) { this.state = 2; wait(); }
        break;
      case 2:
        if (F && F.spotFlag) {
          F.spotFlag = false;
          this.route = S.tables?.routes[F.spotIdx] ?? 2;
          if (h) { waypoints.goTo(h, this.route, 0); waypoints.resume(h); }
          this.state = 4; walk();
        }
        break;
      case 4:
        if (code === this.route) { this.state = 2; wait(); }
        break;
      default: break;
    }
    euler(rec.m, 0, this.yaw, 0, this.x, this.y, this.z);
    return NODE_STOP;
  }
}

// ------------------------------------------------------------------------------------------------ registration

registerCtor(CTOR.SWITCH, (a) => new FshSwitchNode(a));
registerCtor(CTOR.FISHING, (a) => new FishingNode(a));
registerCtor(CTOR.BERTHA, (a) => new BerthaNode(a));
registerCtor(CTOR.SHOAL, (a) => new ShoalNode(a));
registerCtor(CTOR.SPLASH, (a) => new SplashNode(a));
registerCtor(CTOR.ROD, (a) => new RodNode(a));
registerCtor(CTOR.FISHERMAN, (a) => new FishermanNode(a));

/**
 * The constructors of the original run inside the set-up with the record at hand; the factories of the port do not get it, so this binds the nodes after
 * `setupZone`: reads the executable's tables, the shared state, the nodes' records (their constructors' work). Call before the first tick; set `S.rng` before for a
 * deterministic shoal.
 */
export function prepareFsh(w: World, pe: Pe | null, tables?: Tables): FshShared {
  const S = sharedOf(w);
  S.tables = tables ?? (pe ? readTables(pe) : S.tables);
  w.vars.set(0xfb, 1);          // FUN_006f51e6
  w.vars.set(V_PEPPER_CONTROL, 1);
  // spots (FUN_006f3eec): the pole, 4 towards the lake centre, 4 to the side
  S.spots = [];
  const spotRecs = S.tables?.spots ?? [];
  for (const ri of spotRecs) {
    // FUN_006f3eec's loop with its float32 stores (asm 0x6f42a8..0x6f4503): the direction to the lake centre is normalised (FUN_0043cec0), the spot is the pole + 4 along it + 4 sideways
    const r = w.records[ri];
    const d = [f32(K.LAKE_CENTRE[0] - r.m[12]), f32(K.LAKE_CENTRE[1] - r.m[13]), f32(K.LAKE_CENTRE[2] - r.m[14])];
    normalize(d);
    let x = r.m[12], y = r.m[13], z = r.m[14];
    x = f32(f32(d[0] * K.SPOT_STEP) + x); y = f32(f32(d[1] * K.SPOT_STEP) + y); z = f32(f32(d[2] * K.SPOT_STEP) + z);
    const sx = f32(f32(0 * d[1] - 1 * d[2]) * K.SPOT_STEP), sy = f32(f32(0 * d[2] - 0 * d[0]) * K.SPOT_STEP), sz = f32(f32(1 * d[0] - 0 * d[1]) * K.SPOT_STEP);
    x = f32(sx + x); y = f32(sy + y); z = f32(sz + z);
    S.spots.push({ record: ri, x, y, z, dx: d[0], dy: d[1], dz: d[2] });
  }
  const bindAll = (kind: string) => {
    for (const rec of w.records) {
      const n = rec.ctrl?.nodes.find((x) => x.kind === kind);
      if (!n) continue;
      (n as unknown as { bind(S: FshShared, w: World, rec: GameRecord): void }).bind(S, w, rec);
    }
  };
  for (const k of ['FSwitch', 'Fishing', 'Bertha', 'Shoal', 'Splash', 'rod', 'Fisherman']) bindAll(k);
  return S;
}
const V_PEPPER_CONTROL = 0x5e;
export { fishEnv };
