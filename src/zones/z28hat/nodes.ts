// z28HAT: the behaviour nodes of the zone, ported function by function from the decompile (docs/re/m6/z28HAT.md). The original attaches ten node types in FUN_00791990
// (`FUN_00423532(record, ctor, args, 0, 2, 1, 1)`); the port registers the constructors in z28HAT.ts and `prepareHat` (game.ts) runs their constructor effects.
// Offsets in the comments are node offsets (`+0x..`) of the original's structs; `rec +0x3c / +0x40 / +0x44` is the record's position (the matrix translation row).
// The balloon flies at a constant height: only its x / z momentum is integrated.
import { sampleBlk } from '../../formats/anim.ts';
import type { AnimInstance } from '../../game/anim.ts';
import { CLIP_LOOP, POSE_SNAP } from '../../game/anim.ts';
import type { Man } from '../../formats/anim.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { eulerMatrix, eulerRotation, eulerScaledMatrix, fr, mulMatrices, normalise3, reflect3, rotateY, toWorld } from '../exact.ts';
import { GATE_OFF, NO_HANDLE } from '../../fx/particles/zone.ts';
import type { ZoneParticles } from '../../fx/particles/zone.ts';
import { crtRand, randFrom } from '../common/crtrand.ts';
import type { RandSource } from '../common/crtrand.ts';
import type { Vec3 } from '../parachute/util.ts';
import { K, MEDAL, REC, VAR, WINCH, BRONTY, sharedOf, finishGame } from './rules.ts';
import type { HatShared, HatSound } from './rules.ts';
import { restoreHooks } from '../../restore/flag.ts';

const PI = fr(3.1415927), TWO_PI = fr(6.2831855);      // _DAT_0089207c, _DAT_00892094 (-PI: _DAT_00892098)
/** the C runtime's rand() behind FUN_004388ae: the shared generator (src/game/crt.ts); the node tests inject a scripted source (0 .. 32767) */
let randSource: RandSource = crtRand;
export function setHatRandSource(f: RandSource | null) { randSource = f ?? crtRand; }
/** FUN_004388ae(max): `(float) rand() / 32767.0f * max` with every operation rounded to float32, 0 without a draw for max <= 0 (src/zones/common/crtrand.ts) */
const rand = (max: number): number => randFrom(randSource, max);

// ------------------------------------------------------------------------------------------------ matrix helpers of the engine (float32, tools/lib/m7-z28HAT-emu.mjs compares them bit for bit)

const rotY = rotateY;
/** FUN_0043a4a1: the 3x3 part from Euler angles, the translation stays */
function setRotation(rec: GameRecord, rx: number, ry: number, rz: number) {
  eulerRotation(rec.m, fr(rx), fr(ry), fr(rz));
}
const normalise = (v: Vec3) => { const a = [v[0], v[1], v[2]]; normalise3(a); v[0] = a[0]; v[1] = a[1]; v[2] = a[2]; };
const reflect = (d: Vec3, n: Vec3): Vec3 => reflect3(d, n);
/**
 * The bone matrices of the LAST DRAW (FUN_0043bc58 reads the buffer the renderer filled when it drew the record after the previous update): the pose of the animation state at the start of
 * this tick. `AnimInstance.advance` remembers it (prevClip / prevFrame) and every reader (the fireball, the sandbags) runs after Bronty's advance of this tick.
 */
function poseOfLastDraw(anim: AnimInstance): Float32Array | null {
  const sk = anim.rig.skeleton, c = anim.rig.clips[anim.prevClip];
  if (!sk || !c || c.boneCount !== sk.boneCount) return null;
  return sampleBlk(sk, c, anim.prevFrame, (c.flags & CLIP_LOOP) !== 0, undefined, POSE_SNAP);
}
/** the world matrix of bone `bone` of the record's pose: FUN_0043bc58 (the bone matrices of the last draw) * the record's matrix (FUN_0043a9e5); null without a pose */
function boneWorld(rec: GameRecord, bone: number): Float32Array | null {
  const pose = rec.anim ? poseOfLastDraw(rec.anim) : null;
  if (!pose || pose.length < (bone + 1) * 16) return null;
  return mulMatrices(pose.subarray(bone * 16, bone * 16 + 16), rec.m);
}
/** Bronty's head (bone 14) in the world: where a sandbag has to land (diagnostics / the bots) */
export function mouthOf(bron: GameRecord): Float32Array | null { return boneWorld(bron, 14); }
/** FUN_00433450 + FUN_00795ec0: the record's heading minus the heading to `to`, wrapped into -pi .. pi */
function relativeAngle(rec: GameRecord, to: ArrayLike<number>): number {
  const dx = fr(to[0] - rec.x), dz = fr(to[2] - rec.z);
  let a = fr(rec.ry - fr(Math.atan2(dx, dz)));
  if (-PI <= a) { if (PI < a) a = fr(a - TWO_PI); } else a = fr(a + TWO_PI);
  if (-PI <= a) { if (PI < a) a = fr(a - TWO_PI); } else a = fr(a + TWO_PI);   // FUN_00795ec0 wraps once more
  return a;
}
/** truncation (`__ftol`, FUN_0085c920) */
const ftol = (x: number) => Math.trunc(x);
const abs = Math.abs;
/** |a - b| as FUN_0085d260(float difference) */
const adiff = (a: number, b: number) => abs(fr(a - b));
/** x * x + y * y + z * z of the balloon's place (float32, x then y then z) */
const len2 = (v: ArrayLike<number>) => fr(fr(fr(v[0] * v[0]) + fr(v[1] * v[1])) + fr(v[2] * v[2]));
/** FUN_0043cd62 / FUN_004425f0: the ground height under (x, y + up, z): a ray 500 down (float32 in and out), minus 0.1 */
function terrain(w: World, x: number, y: number, z: number, up = 4): number {
  const g = w.col.groundRec;
  if (!g) return fr(-1e38);
  const h = w.col.rayRecord(g, [x, fr(y + up), z], [0, -500, 0], 3, 1.0, fr(0.1));
  return h ? fr(fr(h.point[1]) - fr(0.1)) : fr(-1e38);
}
const at = (r: GameRecord): Vec3 => [r.x, r.y, r.z];

abstract class HatNode implements BehaviourNode {
  abstract readonly kind: string;
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  abstract update(w: World, rec: GameRecord): number;
}

/** the hooks nodes call for what the engine does with the controller (rumble FUN_00438518, particles FUN_00442a00 / 00442a20 / 00442960): recorded for tests, drawn / ignored by the host */
export interface HatFx {
  rumble: number;
  /** the fireball's emitter: 'start' when it fires, 'stop' when it ends */
  fireball: string[];
  /** the zone's particle engine (null in node tests / when the archive has none) and the handle of the fireball's `burp.par` (FUN_00793867) */
  particles: ZoneParticles | null;
  burp: number;
}
export const fx: HatFx = { rumble: 0, fireball: [], particles: null, burp: NO_HANDLE };

// ------------------------------------------------------------------------------------------------ Pepper in the basket (ctor 0x797d67, update 0x797ba0, pre-render 0x797c02)

/** FUN_00796b60: the camera is put behind the balloon at once: eye = the balloon's frame * (0, 15.2, -16), target = 16 under it */
export function snapCamera(w: World, hotb: GameRecord) {
  const c = w.camera.c;
  const e = toWorld(hotb.m, [0, fr(K.CAM_OFFSET[1]), -16]);
  c[3] = hotb.x; c[5] = hotb.z; c[4] = fr(hotb.y - K.CAM_TARGET_DROP);
  c[0] = e[0]; c[1] = e[1]; c[2] = e[2];
  w.camera.updateView();
}
/** FUN_00796c0e (the end of every balloon update): the target follows at once, the eye eases towards the same offset (0.06 per tick, 0.125 of that in y) */
function followCamera(w: World, hotb: GameRecord) {
  const c = w.camera.c;
  const e = toWorld(hotb.m, [0, fr(K.CAM_OFFSET[1]), -16]);
  const ease = fr(K.CAM_EASE);
  c[3] = hotb.x; c[5] = hotb.z; c[4] = fr(hotb.y - K.CAM_TARGET_DROP);
  c[0] = fr(fr(fr(e[0] - c[0]) * ease) + c[0]);
  c[2] = fr(fr(fr(e[2] - c[2]) * ease) + c[2]);
  c[1] = fr(fr(fr(fr(e[1] - c[1]) * ease) * fr(K.CAM_EASE_Y)) + c[1]);
}

export class HatPepp extends HatNode {
  readonly kind = 'hatpepp';
  /** +0x14 / +0x18 / +0x1c: the rider's offset from the balloon (0, -12.8, 0) */
  off: Vec3 = [0, fr(K.PEPPER_DROP), 0];
  /** +0x20 / +0x24 / +0x28: where the electric fence of the T-rex buzzes (the TREX record's place) */
  fence: Vec3 = [0, 0, 0];
  /** +0x2c: the camera was put in place (first update) */
  camDone = false;
  /** FUN_00797d67: the animation starts on clip 0x74 (the sitting pose), the fence is the T-rex's place */
  init(w: World, rec: GameRecord) {
    const S = sharedOf(w);
    rec.anim?.start(0x74, 0);
    this.fence = at(S.recs.trex);
  }
  update(w: World): number {
    const S = sharedOf(w);
    S.sound.at('fenceBuzz', this.fence);
    if (!this.camDone) { snapCamera(w, S.recs.hotb); this.camDone = true; }
    return NODE_STOP;
  }
  /** FUN_00797c02: Pepper takes the balloon's matrix and sits 12.8 under it (in world axes); the animation advances */
  prerender(w: World, rec: GameRecord) {
    const h = sharedOf(w).recs.hotb;
    rec.m.set(h.m);
    rec.x = h.x + this.off[0]; rec.y = h.y + this.off[1]; rec.z = h.z + this.off[2];
    rec.anim?.advance(1.0, w.dt);        // FUN_0043b76a(anim, 1.0) scales by DAT_008b1718 itself
  }
  destroy(w: World) { const S = sharedOf(w); S.sound.stop('wind1'); S.sound.stop('wind2'); }
}

// ------------------------------------------------------------------------------------------------ the balloon (ctor 0x79798f, update 0x796e14)

export class HatBalloon extends HatNode {
  readonly kind = 'hatballoon';
  /** +0x1c / +0x20 / +0x24: the thrust vector (the balloon's forward row, scaled) */
  vel: Vec3 = [0, 0, 0];
  /** +0x34: the thrust ramp -0.004 .. 0.004 */
  speed = 0;
  /** +0x38: ticks left of a knock-back (15) */
  timer: number = fr(K.KNOCK_TICKS);
  /** +0x7c: knock-backs so far (the speech lines) */
  hits = 0;
  /** +0x80: the music fade scale */
  fade = 1;
  /** FUN_0079798f: the balloon stands 40 over the drop zone, turned half a circle; the momentum is cleared, the thrust vector is its forward row, var 0xfc = 1 */
  init(w: World, rec: GameRecord) {
    const S = sharedOf(w), d = S.recs.drop;
    rec.x = d.x; rec.z = d.z; rec.y = fr(d.y + fr(K.BALLOON_HEIGHT));
    rec.ry = fr(rec.ry + PI);
    eulerMatrix(rec.m, 0, rec.ry, 0, rec.x, rec.y, rec.z);
    S.mom = [0, 0, 0];
    this.speed = 0; this.timer = fr(K.KNOCK_TICKS);
    this.vel = [rec.fx, rec.fy, rec.fz];
    this.hits = 0; this.fade = 1;
    w.vars.set(VAR.CONTROL, 1);
    snapCamera(w, rec);
  }
  update(w: World, rec: GameRecord): number {
    const S = sharedOf(w), dt = fr(w.dt), held = w.input.held;
    S.sound.play('wind1'); S.sound.play('wind2');
    let keyed = false, turn = false, thrust = false;
    let dir = 0, angle = 0;
    const B0 = at(rec);
    // the music fades out once something is scored and comes back when everything is down (FUN_00873e13 sets the master volume scale)
    if (!S.allDone) { if (S.score > 0 && 0 <= this.fade) this.fade = fr(this.fade - fr(dt * fr(K.FADE_STEP))); }
    else if (this.fade <= 1) this.fade = fr(fr(dt * fr(K.FADE_STEP)) + this.fade);
    S.fade = this.fade;
    S.onFade(this.fade);

    if (w.vars.get(VAR.CONTROL) === 0) {
      // knocked by a fireball: the winch is pulled up, Pepper complains, the fireball's push moves the balloon for 15 ticks
      w.vars.set(VAR.WINCH, WINCH.RAISE);
      if (this.hits === 0) S.say('ADSGMC06');
      else if (this.hits === 2) S.say('ADSGMC09');
      else if ((this.hits & 1) === 1) S.say('ADSGMC18');
      if (this.timer <= 0) {
        this.timer = fr(K.KNOCK_TICKS);
        w.vars.set(VAR.CONTROL, 1);
        this.hits = (this.hits + 1) & 0xff;
        fx.rumble = 0;
      } else {
        this.timer = fr(this.timer - dt);
        S.mom[0] = fr(S.mom[0] + S.push[0]); S.mom[1] = fr(S.mom[1] + S.push[1]); S.mom[2] = fr(S.mom[2] + S.push[2]);
      }
    } else {
      // keys: Left / Right turn 3 degrees per tick (Left wins), Up / Down thrust (Up wins). The pad's analogue stick is read through the direction bits.
      if ((held & B.LEFT) !== 0) { S.sound.play('balloonFly'); keyed = true; turn = true; dir = -1; angle = fr(K.TURN); }
      else if ((held & B.RIGHT) !== 0) { S.sound.play('balloonFly'); keyed = true; turn = true; dir = 1; angle = fr(K.TURN); }
      if ((held & B.UP) !== 0) {
        this.vel = [rec.fx, rec.fy, rec.fz];
        S.sound.play('balloonFly'); keyed = true;
        this.speed = fr(fr(fr(K.ACCEL) * dt) + this.speed); if (fr(K.MAX_SPEED) < this.speed) this.speed = fr(K.MAX_SPEED);
        thrust = true;
      } else if ((held & B.DOWN) !== 0) {
        S.sound.play('balloonFly'); keyed = true;
        this.vel = [rec.fx, rec.fy, rec.fz];
        this.speed = fr(this.speed - fr(fr(K.ACCEL) * dt)); if (this.speed < -fr(K.MAX_SPEED)) this.speed = -fr(K.MAX_SPEED);
        thrust = true;
      }
      if (!keyed) S.sound.stop('balloonFly');
      if (!thrust) this.speed = fr(fr(1 - fr(fr(K.SPEED_DAMP) * dt)) * this.speed);
      if (turn) {
        // the rotation is done about the balloon's own origin (the translation is taken out and put back)
        const x = rec.x, y = rec.y, z = rec.z;
        rec.x = 0; rec.y = 0; rec.z = 0;
        rotY(rec.m, fr(fr(dir * angle) * dt));
        rec.x = x; rec.y = y; rec.z = z;
      }
      const k = fr(1 - fr(fr(K.MOM_DAMP) * dt));
      S.mom[0] = fr(k * S.mom[0]); S.mom[1] = fr(k * S.mom[1]); S.mom[2] = fr(k * S.mom[2]);
      for (let i = 0; i < 3; i++) this.vel[i] = fr(this.vel[i] * K.THRUST_SCALE);
      for (let i = 0; i < 3; i++) this.vel[i] = fr(fr(this.speed * dt) * this.vel[i]);
      fx.rumble = 0;
    }
    const m2 = fr(fr(fr(S.mom[0] * S.mom[0]) + fr(S.mom[1] * S.mom[1])) + fr(S.mom[2] * S.mom[2]));
    if (fr(K.MOM_CAP2) < m2) { normalise(S.mom); const cap = fr(K.MOM_CAP); S.mom = [fr(S.mom[0] * cap), fr(S.mom[1] * cap), fr(S.mom[2] * cap)]; }
    // collision: first a sweep from under the basket, then one from the centre
    let hit = w.col.sweep(rec, [B0[0], fr(B0[1] - fr(K.SWEEP_DROP)), B0[2]], S.mom, 1, fr(K.SWEEP1_R), fr(K.SWEEP1_SKIN));
    if (!hit) hit = w.col.sweep(rec, B0, S.mom, 1, fr(K.SWEEP2_R), fr(K.SWEEP2_R));
    if (hit && !hit.rec.name.startsWith('WNCH')) {
      S.sound.play('balloonHit');
      const n: Vec3 = [fr(hit.normal[0]), fr(hit.normal[1]), fr(hit.normal[2])];
      if (n[0] === 0 && n[2] === 0) { n[0] = fr(S.mom[0] * -0.5); n[2] = fr(S.mom[2] * -0.5); }
      n[1] = 0;
      normalise(n);
      S.mom = reflect(S.mom, n);
      w.vars.set(VAR.CONTROL, 1);
      this.timer = fr(K.KNOCK_TICKS);
    }
    S.mom[0] = fr(S.mom[0] + this.vel[0]); S.mom[1] = fr(S.mom[1] + this.vel[1]); S.mom[2] = fr(S.mom[2] + this.vel[2]);
    rec.x = fr(fr(S.mom[0] * dt) + B0[0]);
    rec.z = fr(fr(S.mom[2] * dt) + B0[2]);
    rec.y = B0[1];
    followCamera(w, rec);
    S.ticks++;
    return NODE_STOP;
  }
  destroy(w: World) { const S = sharedOf(w); S.sound.stop('balloonFly'); S.onFade(1); }
}

// ------------------------------------------------------------------------------------------------ the winch (ctor 0x795da0, update 0x795770, pre-render 0x795bd6)

export class HatWinch extends HatNode {
  readonly kind = 'hatwinch';
  /** +0x18: the rope's length (18.4 .. ) */
  len: number = fr(K.ROPE_MIN);
  /** +0x28: the heading to the drop zone while a dinosaur hangs on the hook (the hook sways by it) */
  heading = 0;
  /** FUN_00795da0: the hook hangs 18.4 under the balloon */
  init(w: World, rec: GameRecord) {
    const h = sharedOf(w).recs.hotb;
    this.len = fr(K.ROPE_MIN);
    rec.x = h.x; rec.z = h.z; rec.y = fr(h.y - this.len);
  }
  update(w: World, rec: GameRecord): number {
    const S = sharedOf(w), dt = fr(w.dt), R = S.recs, bal = R.hotb;
    const sway = fr(dt * fr(K.HOOK_SWAY));
    const STEP = fr(K.ROPE_STEP), MINLEN = fr(K.ROPE_MIN), stepDt = fr(STEP * dt);
    const B0 = at(bal);
    const mom: Vec3 = [S.mom[0], S.mom[1], S.mom[2]];
    let hx = B0[0], hy = 0, hz = B0[2];
    switch (S.winchLast) {
      case WINCH.TOP:
        S.sound.stop('winchMove');
        hy = fr(B0[1] - this.len);
        break;
      case WINCH.LOWER: {
        S.sound.play('winchMove');
        this.len = fr(stepDt + this.len);
        hy = fr(B0[1] - this.len);
        mom[1] = stepDt;
        const hit = w.col.sweep(rec, [hx, hy, hz], mom, 1, 0.01, 0);   // FUN_00441a90: radius 0.01, skin 0
        if (!hit) {
          if (hy <= 0) { hy = 0; w.vars.set(VAR.WINCH, WINCH.RAISE); }
        } else w.vars.set(VAR.WINCH, WINCH.RAISE);
        break;
      }
      case WINCH.RAISE:
        if (this.len <= MINLEN) {
          hy = fr(B0[1] - this.len);
          w.vars.set(VAR.WINCH, WINCH.TOP);
        } else {
          this.len = fr(this.len - stepDt);
          hy = fr(B0[1] - this.len);
          S.sound.play('winchMove');
        }
        mom[1] = stepDt;
        break;
      case WINCH.CARRY: {
        S.sound.stop('winchMove');
        hy = fr(B0[1] - this.len);
        const hit = w.col.sweep(rec, B0, mom, 1, 0.01, 0);
        if (hit) w.vars.set(VAR.WINCH, WINCH.RAISE);
        break;
      }
    }
    S.winchLast = w.vars.get(VAR.WINCH);
    // the button (Shift) toggles lowering / raising unless a dinosaur hangs on the hook
    if ((w.input.pressed & B.SHIFT) !== 0 && !S.carrying) {
      switch (S.winchLast) {
        case WINCH.TOP: w.vars.set(VAR.WINCH, WINCH.LOWER); break;
        case WINCH.LOWER: w.vars.set(VAR.WINCH, WINCH.RAISE); break;
        case WINCH.RAISE: w.vars.set(VAR.WINCH, WINCH.LOWER); break;
        case WINCH.CARRY: w.vars.set(VAR.WINCH, WINCH.RAISE); break;
      }
    }
    if (S.carrying) {
      const d = R.drop;
      this.heading = fr(Math.atan2(fr(d.x - B0[0]), fr(d.z - B0[2])));
      rec.ry = fr(this.heading * sway);
      setRotation(rec, rec.rx, rec.ry, rec.rz);
    }
    if (this.len < MINLEN) { hy = fr(B0[1] - MINLEN); this.len = MINLEN; }
    rec.y = hy; rec.x = hx; rec.z = hz;
    return NODE_STOP;
  }
  destroy(w: World) { sharedOf(w).sound.stop('winchMove'); }
}

// ------------------------------------------------------------------------------------------------ the dinosaurs

/** the speech a hooked stegosaurus / triceratops / T-rex triggers (FUN_00794a5c; the id is the record name's first letters) */
function dinoSpeech(S: HatShared, name: string) {
  if (name.startsWith('STE')) {
    S.stegSpeech++;
    if (S.stegSpeech === 1) S.say('ADSGMC10'); else if (S.stegSpeech === 2) S.say('ADSGMC11'); else if (S.stegSpeech === 3) S.say('ADSGMC14');
  } else if (name.startsWith('TRI')) {
    S.tricSpeech++;
    if (S.tricSpeech === 1) S.say('ADSGMC12'); else if (S.tricSpeech === 2) S.say('ADSGMC13');
  } else if (name.startsWith('TREX')) S.say('ADSGMC17');
}

/** the arguments FUN_00791990 gives each dinosaur constructor (a block of floats and bytes on its stack): hook reach, vertical window, hang offset, 6 clip bytes, roar slot */
export interface DinoArgs { reachH: number; reachV: number; hang: number; clips: [number, number, number, number, number, number]; roar: HatSound }
/** the big dinosaurs' blocks, by record (FUN_00791990: 0x41800000 = 16.0 horizontal reach; the clip bytes 0x02030504 / 0x601 ...) */
export const DINO_ARGS: Record<number, DinoArgs> = {
  [REC.DINOS[0]]: { reachH: 16, reachV: fr(5.6), hang: fr(0.8), clips: [4, 5, 3, 2, 1, 6], roar: 'stegRoar' },
  [REC.DINOS[1]]: { reachH: 16, reachV: fr(5.6), hang: fr(0.8), clips: [4, 5, 3, 2, 1, 6], roar: 'stegRoar' },
  [REC.DINOS[2]]: { reachH: 16, reachV: fr(5.6), hang: fr(0.8), clips: [4, 5, 3, 2, 1, 6], roar: 'stegRoar' },
  [REC.DINOS[3]]: { reachH: 16, reachV: fr(5.6), hang: fr(0.8), clips: [2, 3, 7, 6, 4, 5], roar: 'tricRoar' },
  [REC.DINOS[4]]: { reachH: 16, reachV: fr(5.6), hang: fr(0.8), clips: [2, 3, 7, 6, 4, 5], roar: 'tricRoar' },
  // the T-rex's block leaves the roar slot unset: it keeps the triceratops' one the previous blocks stored
  [REC.DINOS[5]]: { reachH: 16, reachV: 8, hang: fr(1.2), clips: [4, 4, 2, 2, 5, 1], roar: 'tricRoar' },
};
/** the start clips FUN_00791990 gives the big dinosaurs after attaching (FUN_0043b6a3(anim, n, 0)) */
export const DINO_START_CLIP: Record<number, number> = { [REC.DINOS[0]]: 4, [REC.DINOS[1]]: 5, [REC.DINOS[2]]: 4, [REC.DINOS[3]]: 2, [REC.DINOS[4]]: 3, [REC.DINOS[5]]: 1 };

/** dinosaur states (+0x46 / +0x3e): 0 idle, 1 on the hook, 2 falling, 3 landed, 4 gone */
export const DINO = { IDLE: 0, HOOKED: 1, FALLING: 2, LANDED: 3, GONE: 4 } as const;

/** FUN_00794860 / FUN_00793a48: a landed dinosaur blinks out over 75 ticks (visible while `ftol(timer) & 2`), then its flags are cleared and it is gone */
function vanish(rec: GameRecord, node: { vanishTimer: number; state: number }, dt: number) {
  node.vanishTimer = fr(node.vanishTimer - fr(1 * fr(dt)));
  if (node.vanishTimer < 0) { rec.flags = 0; node.state = DINO.GONE; }
  else if (node.vanishTimer < fr(0.2)) rec.flags |= RF_ENABLED;
  else if ((ftol(node.vanishTimer) & 2) !== 0) rec.flags |= RF_ENABLED;
  else rec.flags &= ~RF_ENABLED;
}

export class HatDino extends HatNode {
  readonly kind = 'hatdino';
  args: DinoArgs;
  /** +0x46 */
  state: number = DINO.IDLE;
  /** +0x47: the animation's last result (the original's allocation leaves it non-zero: the first update picks a clip) */
  animDone = 1;
  /** +0x48 */
  counted = false;
  /** +0x58: the current clip is a walk (its footsteps are heard) */
  walking = false;
  /** +0x50: the winch's collision object, put back while the dinosaur is not hooked */
  savedCol: GameRecord['colObj'] = null;
  /** +0x5c */
  frame = 0;
  /** +0x6c */
  vanishTimer: number = fr(K.VANISH_TICKS);
  /** +0x4c: squared distance of the balloon from the origin */
  balD2 = 0;
  constructor(args: DinoArgs) { super(); this.args = args; }
  /** FUN_007953d4: a random heading (0 .. 2 pi) */
  init(w: World, rec: GameRecord) {
    const S = sharedOf(w);
    this.savedCol = S.recs.winch.colObj;
    rec.ry = fr(fr(rand(TWO_PI)) + rec.ry);
    eulerMatrix(rec.m, 0, rec.ry, 0, rec.x, rec.y, rec.z);
    const c = DINO_START_CLIP[rec.index];
    if (c !== undefined) rec.anim?.start(c, 0);
    this.state = DINO.IDLE; this.animDone = 1; this.counted = false; this.walking = false; this.vanishTimer = fr(K.VANISH_TICKS);
  }
  update(w: World, rec: GameRecord): number {
    const S = sharedOf(w), dt = fr(w.dt), R = S.recs, a = this.args;
    const bal = R.hotb, win = R.winch, anim = rec.anim;
    let x = rec.x, y = rec.y, z = rec.z;
    this.balD2 = len2(at(bal));
    const dxw = adiff(x, win.x), dzw = adiff(z, win.z);
    switch (this.state) {
      case DINO.IDLE: {
        win.colObj = this.savedCol;
        if (this.walking && anim) {
          this.frame = anim.frame;
          if (ftol(this.frame) >= 25) S.sound.at(a.roar, [x, y, z]);
          if (ftol(this.frame) >= 44) S.sound.at('dinoStamp', [x, y, z]);
        }
        if (a.reachH < dxw || a.reachH < dzw) {
          if (this.animDone !== 0) {
            const r = rand(3.0);
            if (r < 2.0) { anim?.start(a.clips[0], 0); this.walking = false; }
            else { anim?.start(a.clips[1], 0); if (!rec.name.startsWith('TREX')) this.walking = true; }
          }
        } else {
          const dyw = adiff(y, win.y);
          if (dyw <= a.reachV) {
            // (the original tests `state != 1`: it is 0 in this state)
            anim?.start(a.clips[2], 0);
            this.state = DINO.HOOKED;
            dinoSpeech(S, rec.name);
            if (w.vars.get(VAR.WINCH) === WINCH.LOWER) w.vars.set(VAR.WINCH, WINCH.CARRY);
          }
        }
        break;
      }
      case DINO.HOOKED: {
        x = win.x; z = win.z;
        y = adiff(win.y, a.hang);
        rec.x = x; rec.y = y; rec.z = z;
        S.carrying = true;
        const br = R.bron;
        if (adiff(x, br.x) <= K.ROAR_RADIUS && adiff(z, br.z) <= K.ROAR_RADIUS) w.vars.set(VAR.BRONTY, BRONTY.ROAR);
        if ((w.input.pressed & B.SHIFT) !== 0 && K.FAR2 < this.balD2) {
          this.state = DINO.FALLING;
          anim?.start(a.clips[3], 0);
        }
        this.savedCol = win.colObj;
        win.colObj = null;            // 0xbabababa: the hook's own collision is off while it carries
        const g = terrain(w, x, y, z, 4.0);
        if (rec.y <= g) rec.y = g;
        if (S.fireballHit) { this.state = DINO.FALLING; S.fireballHit = false; fx.rumble = 0; }
        break;
      }
      case DINO.FALLING: {
        S.carrying = false;
        fx.rumble = 0;
        win.colObj = this.savedCol;
        y = fr(y - fr(fr(K.FALL) * dt));
        rec.x = x; rec.y = y; rec.z = z;
        const hit = w.col.groundRec ? w.col.rayRecord(w.col.groundRec, [x, fr(y + 4.0), z], [0, -1000, 0], 3, fr(0.8), fr(0.08)) : null;
        const ground = hit ? fr(hit.point[1]) : fr(1e38);
        if (rec.y <= ground) {
          rec.y = ground;
          anim?.start(a.clips[4], 0);
          S.sound.play('dinoLand');
          this.state = DINO.LANDED;
        }
        break;
      }
      case DINO.LANDED: {
        if (this.animDone !== 0) anim?.start(a.clips[5], 0);
        this.land(w, rec, S);
        S.carrying = false;
        fx.rumble = 0;
        break;
      }
    }
    if (S.carrying) w.vars.set(VAR.WINCH, WINCH.RAISE);
    this.animDone = anim ? anim.advance(1.0, dt) : 0;
    return NODE_STOP;
  }
  /** FUN_0079492a: the landing is counted once; within 40 of the drop zone (x and z) a big dinosaur is worth 1000; then it blinks out */
  private land(w: World, rec: GameRecord, S: HatShared) {
    const d = S.recs.drop;
    const inside = adiff(rec.x, d.x) <= K.DROP_RADIUS && adiff(rec.z, d.z) <= K.DROP_RADIUS;
    if (!this.counted) {
      S.delivered = (S.delivered + 1) & 0xff;
      if (inside) S.score += K.DINO_POINTS;
      this.counted = true;
    }
    vanish(rec, this, w.dt);
  }
}

export class HatBaby extends HatNode {
  readonly kind = 'hatbaby';
  args: { reachH: number; reachV: number; hang: number };
  state: number = DINO.IDLE;
  /** +0x3f: the animation's last result */
  animDone = 1;
  counted = false;
  /** +0x42: the clip runs (it is held on its first frame while the baby is on the hook) */
  animate = true;
  savedCol: GameRecord['colObj'] = null;
  vanishTimer: number = fr(K.VANISH_TICKS);
  balD2 = 0;
  constructor(args: { reachH: number; reachV: number; hang: number }) { super(); this.args = args; }
  /** FUN_00794679: clip 1, a random heading (0 .. pi) */
  init(w: World, rec: GameRecord) {
    const S = sharedOf(w);
    this.savedCol = S.recs.winch.colObj;
    rec.ry = fr(fr(rand(PI)) + rec.ry);
    eulerMatrix(rec.m, 0, rec.ry, 0, rec.x, rec.y, rec.z);
    rec.anim?.start(1, 0);
    this.state = DINO.IDLE; this.animate = true; this.counted = false; this.vanishTimer = fr(K.VANISH_TICKS);
  }
  update(w: World, rec: GameRecord): number {
    const S = sharedOf(w), dt = fr(w.dt), R = S.recs, a = this.args;
    const bal = R.hotb, win = R.winch, anim = rec.anim;
    const speed = fr(dt * fr(K.BABY_SPEED));
    const NR = fr(K.NEST_RADIUS);
    let x = rec.x, y = rec.y, z = rec.z;
    this.balD2 = len2(at(bal));
    // all five hang on the hook together: the test is the winch's place against the nest, not the baby
    const nest = S.nest;
    const dxw = adiff(nest[0], win.x), dzw = adiff(nest[2], win.z), dyw = adiff(nest[1], win.y);
    // the hang offsets: REX1 `hang`, REX2 `hang + reachV`, REX3 / 4 / 5 stacked by ftol(reachV) * 2 / 3 / ftol(reachV * 4)
    let hangOff = 0;
    switch (rec.name) {
      case 'REX1': hangOff = a.hang; S.sound.at('brexCall', [x, y, z]); break;
      case 'REX2': hangOff = fr(a.hang + a.reachV); break;
      case 'REX3': hangOff = fr(((ftol(a.reachV) * 2) & 0xff) + a.hang); break;
      case 'REX4': hangOff = fr(((ftol(a.reachV) * 3) & 0xff) + a.hang); break;
      case 'REX5': hangOff = fr((ftol(fr(a.reachV * 4)) & 0xff) + a.hang); break;
    }
    switch (this.state) {
      case DINO.IDLE: {
        win.colObj = this.savedCol;
        if (NR < dxw || NR < dzw || a.reachV < dyw) {
          // wander: forward at 0.4 per tick inside 6.4 of the nest, turning by a random angle at the edge
          const v: Vec3 = [rec.fx, rec.fy, rec.fz];
          normalise(v);
          x = fr(x + fr(speed * v[0])); y = fr(y + fr(speed * v[1])); z = fr(z + fr(speed * v[2]));
          let clamped = false;
          if (x < fr(nest[0] - NR)) { x = fr(nest[0] - NR); clamped = true; }
          if (fr(nest[0] + NR) < x) { x = fr(nest[0] + NR); clamped = true; }
          if (z < fr(nest[2] - NR)) { z = fr(nest[2] - NR); clamped = true; }
          if (fr(nest[2] + NR) < z) { z = fr(nest[2] + NR); clamped = true; }
          if (clamped) {
            rec.ry = fr(fr(rand(PI)) + rec.ry);
            eulerMatrix(rec.m, 0, rec.ry, 0, rec.x, rec.y, rec.z);
          }
        } else {
          this.animate = false;
          this.state = DINO.HOOKED;
          if (rec.name === 'REX1') S.say('ADSGMC15', 'ADSGMC16');
          if (w.vars.get(VAR.WINCH) === WINCH.LOWER) w.vars.set(VAR.WINCH, WINCH.CARRY);
        }
        rec.x = x; rec.y = y; rec.z = z;
        break;
      }
      case DINO.HOOKED: {
        S.sound.at('brexCall', [x, y, z]);
        this.animate = false;
        x = win.x; z = win.z;
        y = adiff(win.y, hangOff);
        rec.x = x; rec.y = y; rec.z = z;
        S.carrying = true;
        const br = R.bron;
        if (adiff(x, br.x) <= K.ROAR_RADIUS && adiff(z, br.z) <= K.ROAR_RADIUS) w.vars.set(VAR.BRONTY, BRONTY.ROAR);
        if ((w.input.pressed & B.SHIFT) !== 0 && K.FAR2 < this.balD2) this.state = DINO.FALLING;
        this.savedCol = win.colObj;
        win.colObj = null;
        if (S.fireballHit) { this.state = DINO.FALLING; S.fireballHit = false; fx.rumble = 0; }
        break;
      }
      case DINO.FALLING: {
        S.carrying = false;
        fx.rumble = 0;
        win.colObj = this.savedCol;
        y = fr(y - fr(fr(K.FALL) * dt));
        rec.x = x; rec.y = y; rec.z = z;
        const hit = w.col.groundRec ? w.col.rayRecord(w.col.groundRec, [x, fr(y + 4.0), z], [0, -1000, 0], 3, fr(0.8), fr(0.08)) : null;
        const ground = hit ? fr(hit.point[1]) : fr(1e38);
        if (rec.y <= ground) {
          rec.y = ground;
          S.sound.play('dinoLand');
          this.state = DINO.LANDED;
        }
        break;
      }
      case DINO.LANDED: {
        S.sound.stop('brexCall');
        this.animate = true;
        const v: Vec3 = [rec.fx, rec.fy, rec.fz];
        normalise(v);
        rec.x = fr(x + fr(speed * v[0])); rec.y = fr(y + fr(speed * v[1])); rec.z = fr(z + fr(speed * v[2]));
        this.land(w, rec, S);
        S.carrying = false;
        fx.rumble = 0;
        break;
      }
    }
    if (!this.animate) anim?.start(1, 0);
    else this.animDone = anim ? anim.advance(1.0, dt) : 0;
    return NODE_STOP;
  }
  /** FUN_00793b12: counted once on landing (+300 within the drop zone), then it blinks out */
  private land(w: World, rec: GameRecord, S: HatShared) {
    const d = S.recs.drop;
    const inside = adiff(rec.x, d.x) <= K.DROP_RADIUS && adiff(rec.z, d.z) <= K.DROP_RADIUS;
    if (!this.counted) {
      S.delivered = (S.delivered + 1) & 0xff;
      if (inside) S.score += K.BABY_POINTS;
      this.counted = true;
    }
    vanish(rec, this, w.dt);
  }
}

/** the babies' blocks (FUN_00791990: reach 16, vertical window 0x40051eb8 = 2.08, hang 2.0 / 3.6 (REX2)) */
export const BABY_ARGS: Record<number, { reachH: number; reachV: number; hang: number }> = {
  [REC.BABIES[0]]: { reachH: 16, reachV: 2.0799999237060547, hang: 2.0 },
  [REC.BABIES[1]]: { reachH: 16, reachV: 2.0799999237060547, hang: 3.5999999046325684 },
  [REC.BABIES[2]]: { reachH: 16, reachV: 2.0799999237060547, hang: 2.0 },
  [REC.BABIES[3]]: { reachH: 16, reachV: 2.0799999237060547, hang: 2.0 },
  [REC.BABIES[4]]: { reachH: 16, reachV: 2.0799999237060547, hang: 2.0 },
};
/** FUN_00791990: the babies' animations start at different frames (FUN_0043b64d(anim, f): REX2 7, REX3 2, REX4 5, REX5 10) so they do not move in step */
export const BABY_START_FRAME: Record<number, number> = { [REC.BABIES[1]]: 7, [REC.BABIES[2]]: 2, [REC.BABIES[3]]: 5, [REC.BABIES[4]]: 10 };

// ------------------------------------------------------------------------------------------------ Bronty (ctor 0x796a05, update 0x795f80) and Mr Hates (ctor 0x7956be, update 0x7955f0)

export class HatMrHates extends HatNode {
  readonly kind = 'hatmrhates';
  /** FUN_007955f0 only returns 1: Mr Hates' record is moved by Bronty's node */
  update(): number { return NODE_STOP; }
}

export class HatBronty extends HatNode {
  readonly kind = 'hatbronty';
  /** +0x18: the state whose clip is playing */
  cur: number = BRONTY.EAT + 1;
  /** +0x19: stance cycles done / +0x1a: the pizza was eaten */
  count = 0; ate = 0;
  /** +0x1b / +0x1c: the clips of Bronty / Mr Hates ended this tick */
  done = false; hatesDone = false;
  /** +0x20: heading of Bronty relative to the balloon, +0x24: squared distance of the balloon from the origin, +0x28: Bronty's frame */
  rel = 0; balD2 = 0; frame = 0;
  /** the pizza's path (Food.man, +0x14), loaded by the host */
  food: Man | null = null;
  /** FUN_00796a05: state 4, a random heading */
  init(w: World, rec: GameRecord) {
    w.vars.set(VAR.BRONTY, BRONTY.IDLE);
    this.cur = 3; this.count = 0; this.ate = 0;
    rec.ry = fr(fr(rand(TWO_PI)) + rec.ry);
    eulerMatrix(rec.m, 0, rec.ry, 0, rec.x, rec.y, rec.z);
  }
  /** the pizza's matrix at frame `f` (FUN_0043ecd0 builds one per frame and track: -tx, ty, tz); null without the path */
  private foodMatrix(f: number): Float32Array | null {
    const man = this.food;
    if (!man) return null;
    const fi = Math.min(Math.max(f, 0), man.frameCount - 1);
    const d = man.tracks[0], o = fi * 9;
    return eulerScaledMatrix(d[o], d[o + 1], d[o + 2], -d[o + 3], d[o + 4], d[o + 5], d[o + 6], d[o + 7], d[o + 8]);
  }
  update(w: World, rec: GameRecord): number {
    const S = sharedOf(w), dt = fr(w.dt), R = S.recs, bal = R.hotb, hate = R.hate;
    this.done = (rec.anim?.advance(1.0, dt) ?? 0) !== 0;
    this.hatesDone = (hate.anim?.advance(1.0, dt) ?? 0) !== 0;
    this.frame = rec.anim?.frame ?? 0;
    this.rel = relativeAngle(rec, at(bal));
    this.balD2 = len2(at(bal));
    const v = w.vars.get(VAR.BRONTY);
    S.brontyVar = v;
    const pos = at(rec);
    R.piz4.flags &= ~RF_ENABLED;     // the pizza is only shown while he eats
    const setv = (n: number) => w.vars.set(VAR.BRONTY, n);
    const start = (bron: number, hates: number) => { rec.anim?.start(bron, 0); hate.anim?.start(hates, 0); };
    switch (v) {
      case BRONTY.STANCE:
        if (K.FAR2 < this.balD2) {
          if (this.cur === BRONTY.STANCE) { if (ftol(rec.anim?.frame ?? 0) === 0x14) S.sound.at('brontyBurp', pos); }
          else { start(1, 0x78); this.cur = BRONTY.STANCE; }
        } else setv(BRONTY.IDLE);
        if (this.done) {
          if (this.rel <= K.FACING) {
            if (-K.FACING <= this.rel) { if (this.count < 3) setv(BRONTY.STANCE); else setv(BRONTY.IDLE); }
            else setv(BRONTY.TURN_R);
          } else setv(BRONTY.TURN_L);
          this.count = (this.count + 1) & 0xff;
          this.ate = 0;
        }
        break;
      case BRONTY.FREED:
        if (this.cur !== BRONTY.FREED) { start(9, 0x7a); this.cur = BRONTY.FREED; restoreHooks.cue?.('hat-freed', { sound: S.sound }); }   // restored content (option off: unset)
        if (this.done) {
          hate.flags &= ~RF_ENABLED;      // Mr Hates is gone (flags +0x60 of his record)
          setv(BRONTY.IDLE);
          finishGame(S, w.vars);
        }
        break;
      case BRONTY.EAT: {
        if (this.cur === BRONTY.EAT) {
          const f = ftol(rec.anim?.frame ?? 0);
          R.piz4.flags |= RF_ENABLED;
          const fm = this.foodMatrix(f);
          if (fm) R.piz4.m.set(mulMatrices(fm, rec.m));
          if (f === 0x1e) S.sound.at('brontyEat', pos);
        } else {
          start(4, 0x7e);
          this.cur = BRONTY.EAT; this.ate = 1; this.count = 0;
          R.piz4.flags |= RF_ENABLED;
          const fm = this.foodMatrix(0);
          if (fm) R.piz4.m.set(mulMatrices(fm, rec.m));
        }
        if (this.done) setv(BRONTY.STANCE);
        break;
      }
      case BRONTY.HIT:
        if (S.eatCount > 2) {
          if (S.delivered < S.total) { setv(BRONTY.RUNUP); S.eatCount = 0; } else setv(BRONTY.FREED);
        }
        if (this.cur !== BRONTY.HIT) {
          start(6, 0x80);
          S.sound.play('sandbagHit');
          this.cur = BRONTY.HIT;
          S.eatCount = (S.eatCount + 1) & 0xff;
          S.say('ADSGMC07', 'ADSGMC08');
        }
        if (this.done) setv(BRONTY.IDLE);
        break;
      case BRONTY.IDLE:
        if (this.cur !== BRONTY.IDLE) { start(7, 0x81); this.cur = BRONTY.IDLE; }
        if (this.done) {
          if (this.rel <= K.FACING) {
            if (-K.FACING <= this.rel) {
              if (this.ate === 0) setv(BRONTY.EAT);
              else if (this.count < 4 && K.FAR2 < this.balD2) setv(BRONTY.STANCE);
            } else setv(BRONTY.TURN_R);
          } else setv(BRONTY.TURN_L);
        }
        break;
      case BRONTY.RUNUP:
        if (this.cur !== BRONTY.RUNUP) { start(8, 0x82); S.sound.play('hatesHit'); this.cur = BRONTY.RUNUP; }
        if (this.done) { S.eatCount = 0; setv(BRONTY.IDLE); }
        break;
      case BRONTY.ROAR:
        if (this.done) S.sound.at('brontyCall', pos);
        if (this.cur !== BRONTY.ROAR) { start(2, 0x7f); this.cur = BRONTY.ROAR; S.sound.at('brontyCall', pos); }
        if (this.done) setv(BRONTY.IDLE);
        break;
      case BRONTY.TURN_L:
        if (this.cur !== BRONTY.TURN_L) { start(5, 0x7d); this.cur = BRONTY.TURN_L; }
        rec.ry = fr(rec.ry - fr(fr(fr(1 * dt) * fr(K.BRONTY_TURN)) * fr(0.01745319925248623)));
        setRotation(rec, rec.rx, rec.ry, rec.rz);
        if (this.done) setv(BRONTY.IDLE);
        break;
      case BRONTY.TURN_R:
        if (this.cur !== BRONTY.TURN_R) { start(3, 0x77); this.cur = BRONTY.TURN_R; }
        rec.ry = fr(fr(fr(fr(1 * dt) * fr(K.BRONTY_TURN)) * fr(0.01745319925248623)) + rec.ry);
        setRotation(rec, rec.rx, rec.ry, rec.rz);
        if (this.done) setv(BRONTY.IDLE);
        break;
    }
    hate.m.set(rec.m);        // Mr Hates rides on Bronty: the matrix is copied
    return NODE_STOP;
  }
}

// ------------------------------------------------------------------------------------------------ the fireball (ctor 0x793867, update 0x793370) and the sandbags (ctor 0x7932b6, update 0x792e60)

export class HatFireball extends HatNode {
  readonly kind = 'hatfireball';
  /** +0x18: flying */
  active = false;
  /** +0x1c: ticks flown * 2.4 */
  t = 0;
  /** +0x20: velocity, +0x2c: where it started */
  v: Vec3 = [0, 0, 0]; start: Vec3 = [0, 0, 0];
  /**
   * FUN_00793867: not flying; starts `burp.par` (FUN_00442960: parent matrix = the record's live matrix, offset 0, rotation (pi, 0, 0), gate off). The three model records FRB1 / FRB2 /
   * FRB3 stay hidden like in the original (the flames are the emitter).
   */
  init(w: World) {
    const S = sharedOf(w); this.active = false; S.fireballHit = false; fx.rumble = 0;
    for (const r of [S.recs.frb1, ...S.recs.flames]) r.flags &= ~RF_ENABLED;
    fx.burp = fx.particles ? fx.particles.start('burp.par', S.recs.frb1.m, [0, 0, 0], [PI, 0, 0], GATE_OFF) : NO_HANDLE;
  }
  update(w: World, rec: GameRecord): number {
    const S = sharedOf(w), dt = fr(w.dt), R = S.recs, bron = R.bron;
    const SPD = fr(fr(K.FIREBALL_SPEED) * dt);
    let frame = -1;
    if (w.vars.get(VAR.BRONTY) === BRONTY.STANCE) frame = ftol(bron.anim?.frame ?? 0);   // otherwise the original compares an uninitialised local with 20
    let x = rec.x, y = rec.y, z = rec.z;
    if (!this.active) {
      if (frame === 0x14) {
        // Bronty's burp (frame 20 of his stance clip): the fireball leaves his mouth (bone 17) aimed at the balloon
        const bal = R.hotb;
        const dx = fr(bal.x - x), dy = fr(bal.y - y), dz = fr(bal.z - z);
        rec.ry = fr(Math.atan2(dx, dz));
        rec.rx = fr(Math.atan2(0, dy));
        setRotation(rec, rec.rx, rec.ry, rec.rz);
        this.start = [rec.x, rec.y, rec.z];
        this.t = 0;
        this.v = [fr(bal.x - this.start[0]), fr(bal.y - this.start[1]), fr(bal.z - this.start[2])];
        normalise(this.v);
        this.v = [fr(SPD * this.v[0]), fr(SPD * this.v[1]), fr(SPD * this.v[2])];
        this.active = true;
        fx.particles?.setMatrix(fx.burp, rec.m);     // FUN_00442a00(handle, record + 0xc)
        fx.fireball.push('start');
      } else {
        // it rides in Bronty's mouth until then
        const m = boneWorld(bron, 17);
        if (m) { rec.m.set(m); x = rec.x; y = rec.y; z = rec.z; }
      }
    } else {
      S.sound.at('fireballFly', [x, y, z]);
      fx.particles?.on(fx.burp);     // FUN_00442a20(handle, 2, 1, 1) every flying tick
      this.t = fr(SPD + this.t);
      x = fr(x + this.v[0]); y = fr(y + this.v[1]); z = fr(z + this.v[2]);
      const hit = w.col.sweep(rec, [x, y, z], this.v, 3, fr(0.08), 0);
      if (!hit) {
        if (K.FIREBALL_RANGE2 < len2([x, y, z])) { this.active = false; rec.flags &= ~RF_ENABLED; fx.particles?.off(fx.burp); fx.fireball.push('stop'); }
      } else {
        if (hit.rec.name === 'HOTB' || hit.rec.name === 'WNCH') {
          fx.rumble = 100;
          S.sound.stop('fireballFly');
          S.sound.play('fireballHit');
          if (S.carrying) S.fireballHit = true;
          w.vars.set(VAR.CONTROL, 0);
          S.push = [this.v[0], 0, this.v[2]];
        }
        this.active = false; rec.flags &= ~RF_ENABLED; fx.particles?.off(fx.burp); fx.fireball.push('stop');
      }
      rec.x = x; rec.y = y; rec.z = z;
    }
    if (!this.active) { rec.x = x; rec.y = y; rec.z = z; }
    return NODE_STOP;
  }
}

export class HatSandbag extends HatNode {
  readonly kind = 'hatsandbag';
  /** +0x18: falling */
  active = false;
  init() { this.active = false; }
  update(w: World, rec: GameRecord): number {
    const S = sharedOf(w), dt = fr(w.dt), R = S.recs;
    let x = rec.x, y = rec.y, z = rec.z;
    const mouth = boneWorld(R.bron, 14);        // Bronty's head: the sandbag has to land within 8 of it
    const mx = mouth ? mouth[12] : R.bron.x, mz = mouth ? mouth[14] : R.bron.z;
    const fall = fr(fr(K.SANDBAG_FALL) * dt);
    if (S.allDone && (w.input.pressed & B.SHIFT) !== 0 && w.vars.get(VAR.BRONTY) !== BRONTY.FREED) {
      this.active = true;
      R.pepp.anim?.start(0x75, 0);
      w.vars.set(VAR.WINCH, WINCH.RAISE);
    }
    if (!this.active) {
      rec.flags &= ~RF_ENABLED;
      x = R.pepp.x; y = R.pepp.y; z = R.pepp.z;
      S.sound.stop('sandbagFall');
      R.pepp.anim?.start(0x74, 0);
    } else {
      rec.flags |= RF_ENABLED;
      S.sound.play('sandbagFall');
      // the sweep is 16 wide: anything but the balloon, the hook and the other sandbags near the bag ends its fall
      const hit = w.col.sweep(rec, [x, y, z], [0, fall, 0], 1, 16, 0);
      if (!hit || hit.rec.name.startsWith('HOTB') || hit.rec.name.startsWith('WNCH') || hit.rec.name.startsWith('SDB')) y = fr(y - fall);
      else {
        const dx = fr(mx - x), dz = fr(mz - z);
        if (fr(K.MOUTH_RADIUS * K.MOUTH_RADIUS) < ftol(fr(fr(dx * dx) + fr(dz * dz)))) {
          S.sound.stop('sandbagFall');
          S.sound.play('sandbagMiss');
          if (S.total <= S.delivered) S.score += K.SANDBAG_MISS;
        } else {
          S.sound.stop('sandbagFall');
          w.vars.set(VAR.BRONTY, BRONTY.HIT);
          if (S.total <= S.delivered) { S.score += K.SANDBAG_HIT; if (S.score > 10000) S.score = 10000; }
        }
        this.active = false;
      }
    }
    rec.x = x; rec.y = y; rec.z = z;
    return NODE_STOP;
  }
}

// ------------------------------------------------------------------------------------------------ the pterodactyl (ctor 0x792d38, update 0x792ae0)

export class HatPtera extends HatNode {
  readonly kind = 'hatptera';
  /** +0x1c: the flight's phase, +0x18: the heading */
  t = 0; heading = 0;
  /** FUN_00792d38: clip 1; the record is put under the balloon's start (x, y - 16, -z): its height is the one it keeps (the first update takes x / z from the flight path) */
  init(w: World, rec: GameRecord) {
    const h = sharedOf(w).recs.hotb;
    rec.x = h.x; rec.y = fr(h.y - 16); rec.z = -h.z;
    this.t = 0;
    rec.anim?.start(1, 0);
  }
  update(w: World, rec: GameRecord): number {
    const S = sharedOf(w), dt = fr(w.dt);
    const ox = rec.x, oz = rec.z, y = rec.y;
    const x = fr(fr(Math.sin(fr(this.t + this.t)) * K.PTER_R) + K.PTER_X);
    const z = fr(fr(Math.cos(this.t) * K.PTER_R) + 29.474000930786133);        // the double at 0x892918 (not 29.474)
    this.t = fr(fr(fr(K.PTER_STEP) * dt) + this.t);
    this.heading = fr(Math.atan2(fr(x - ox), fr(z - oz)) - 0.15707963705062866);
    eulerMatrix(rec.m, 0, fr(TWO_PI - this.heading), 0, x, y, z);
    rec.ry = fr(TWO_PI - this.heading);
    S.sound.at('pterFlap', [x, y, z]);
    rec.anim?.advance(1.0, dt);
    return NODE_STOP;
  }
}

export { MEDAL };
