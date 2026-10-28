// z38PAR: Pepper in free fall and under the parachute: the behaviour node of FUN_0046a926 (constructor, "test.c") / FUN_004686a3 (update, 649 lines of the decompile).
// Pure game logic on the engine's records; the ZoneGame (src/zones/z38PAR.ts) only adds the HUD, the end banner and the speech around it.
//
// States (node +0x30): 0 start, 1 free fall (Up / Down tilt the body, Shift opens the chute once it is allowed), 2 the body swings upright and the chute opens,
// 3 gliding under the chute (Left / Right steer, Up pulls forward), 4 landing animation, 5 game over, 7 bounced off something (ring, plane, balloon, bird).
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { B } from '../../game/input.ts';
import { parRun, RING_HIT, RING_MISSED } from './par-run.ts';
import type { ParRun } from './par-run.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { TWO_PI, ftol, nameStarts, rand, reflect, segmentHitsRecordBox, steerYaw, transformPoint } from './util.ts';
import type { Vec3 } from './util.ts';

/** node +0x30 */
export const S = { START: 0, FALL: 1, OPENING: 2, GLIDE: 3, LANDING: 4, OVER: 5, BOUNCE: 7 } as const;
/** animation clips of the pilot's rig (MFIG.blk of the zone, 11 clips): the numbers the code starts */
export const CLIP = { POSE: 0, GLIDE: 1, LEAN: 2, FALL: 3, OPEN: 4, LAND: 5, BOUNCE: 7, SAD: 8, CHEER: 9, PULL: 10 } as const;

/** constants of the constructor FUN_0046a926 (float immediates of its code) */
export const PILOT = {
  START_ALT: 1360,            // 0x44aa0000: param_3[5] (also DAT_05d57d0c, the gauge's full scale)
  GLIDE_REF: 400,             // 0x43c80000: node +0x18 (the glide speed is fall * y / (1360 + 400))
  PITCH_STEP: 0.17,           // 0x3e2e147b: node +0x1c
  WIND_FACTOR: 0.36,          // 0x3eb851ec: node +0x20
  RADIUS: [22.8, 11.5, 7.6] as const,   // 0x41b66666 / 0x41380000 / 0x40f33333: landing radius of TAR3 (+0x24), TAR2 (+0x28), TAR1 (+0x2c)
  CHUTE_FALL: 0.3,            // 0x3e99999a: node +0x48 (fall speed under the chute)
  FALL_START: 0.5,            // 0x3f000000: node +0x4c
  CAM_LERP: 0.85,             // 0x3f59999a: node +0x5c
  CAM_LIFT: 0.15,             // 0x3e19999a: node +0x70 (times 8: the look-at point is 1.2 above the pilot)
  PITCH_RATE: 0.07,           // double 0x8924a8: node +0x74 per tick while Up / Down are held
  LEAN_LO: 0.6283185,         // double 0x8924a0 (pi / 5)
  LEAN_HI: 2.3561945,         // double 0x892498 (3 pi / 4)
  FALL_BASE: 0.4,             // 0x892118 and double 0x892490
  RING_BONUS: [750, 500, 250] as const,  // 0x8924b0 / 0x8924b4 / 0x892240: ring 1 / 2 / 3
  DIVE_BONUS: 1000,           // 0x892120 (pitch between 4 and 5.5 radians when the ring is passed)
  LAND_FULL: [5000, 2500, 1000] as const,    // 0x8923d8 / 0x892484 / 0x892120: points at the middle of TAR1 / TAR2 / TAR3
  LAND_BONUS: 800,            // 0x320
  FLARE_COST: 50,             // 0x892254 per frame of the pull-up clip
  CHUTE_ALLOWED_FRAC: 0.25,   // the gauge's 153 / 204 (FUN_00466f50)
} as const;

/** a no-op animation for a record without a rig (tests of odd scenes) */
const noAnim = { clip: 0, frame: 0, start() { return false; }, advance() { return 0; } };

export class ParPilot implements BehaviourNode {
  readonly kind = 'ParPilot';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;

  // ---- node fields (the offsets of the original in comments)
  state: number = S.START;  // +0x30
  steerDir = 0;             // +0x34
  landed = false;           // +0x38
  crashed = false;          // +0x3c
  yawRate = 0;              // +0x40
  fallTarget = 0;           // +0x44
  fall: number = PILOT.FALL_START;  // +0x4c: the current fall speed
  fwd: number = PILOT.FALL_START * PILOT.PITCH_STEP;   // +0x50
  windX = 0; windZ = 0;     // +0x54 / +0x58
  camLerp: number = PILOT.CAM_LERP; // +0x5c
  camOff: Vec3 = [0, 0, 0]; // +0x60 / +0x64 / +0x68
  bounce: Vec3 = [0, 0, 0]; // +0x78 / +0x7c / +0x80
  private inited = false;

  /** FUN_0046a926: what the constructor does to the world (position, hidden records, first animation); idempotent */
  init(w: World, rec: GameRecord) {
    if (this.inited) return;
    this.inited = true;
    const run = parRun(w);
    const R = run.recs;
    rec.x = 0; rec.y = PILOT.START_ALT; rec.z = 0;
    rec.rx = rec.ry = rec.rz = 0;
    rec.setEuler(0, 0, 0, 0, PILOT.START_ALT, 0);
    rec.savePrev();
    if (R.shad) { R.shad.x = 0; R.shad.y = 0; R.shad.z = 0; R.shad.savePrev(); R.shad.hide(); }
    for (const t of R.targets) t.hide();
    if (R.birds[3]) R.birds[3].hide();
    rec.anim?.start(CLIP.FALL, 0);
    run.startAlt = PILOT.START_ALT; run.y = PILOT.START_ALT;
    run.ring = [0, 0, 0]; run.chuteOk = false; run.score = 0; run.height = 0; run.landBonus = 0; run.canopy = 0; run.over = false;
    run.windDir = rand(360) / 57.3;   // DAT_05d57d04 = rand(360) / 57.3 (0x42653333)
  }

  update(w: World, rec: GameRecord): number {
    this.init(w, rec);
    const run = parRun(w);
    const R = run.recs, snd = run.sound;
    const held = w.input.held, dt = w.dt;
    const anim = (rec.anim ?? noAnim) as typeof noAnim & { start(c: number, f?: number): boolean; advance(r: number): number };
    run.tick++;

    let ex = rec.x, ey = rec.y, ez = rec.z;
    const px = ex, py = ey, pz = ez;      // local_150 / local_14c / local_148: where the tick started
    snd.at('ambience', [R.land.x, R.land.y, R.land.z]);
    // the probe straight down (FUN_00441ac0, mask 3): the sea wash is heard from the point below the pilot at sea level
    if (w.col.probe(rec, [ex, ey, ez], [0, -8000, 0], 3)) snd.at('sea', [ex, 0, ez]);

    this.rings(run, rec, ex, ey, ez);

    const dist = (t: GameRecord) => Math.hypot(ex - t.x, ey - t.y, ez - t.z);
    const dTar3 = dist(R.targets[2]), dTar2 = dist(R.targets[1]), dTar1 = dist(R.targets[0]);   // local_cc / local_c4 / local_bc
    // the wind wanders: DAT_05d57d04 += (rand(2) - 1) / 32; the drift is the fall speed times the wind direction times 0.36
    run.windDir += (rand(2) - 1) / 32;
    this.windX = this.fall * Math.sin(run.windDir) * PILOT.WIND_FACTOR;
    this.windZ = this.fall * Math.cos(run.windDir) * PILOT.WIND_FACTOR;

    switch (this.state) {
      case S.START: this.state = S.FALL; break;
      case S.FALL: {
        snd.play('windFall');
        const step = dt * PILOT.PITCH_RATE;
        if (held & B.UP) { rec.rx += step; if (rec.rx > TWO_PI) rec.rx -= TWO_PI; }
        if (held & B.DOWN) { rec.rx -= step; if (rec.rx < 0) rec.rx += TWO_PI; }
        let frame = ftol(anim.frame);
        if (rec.rx <= PILOT.LEAN_LO || rec.rx >= PILOT.LEAN_HI) {
          // flat / head-down: the fall pose
          if (anim.clip === CLIP.FALL) anim.advance(1);
          if (anim.clip === CLIP.LEAN) {
            if (frame < 2) anim.start(CLIP.FALL, 0);
            else { anim.advance(-1); if (anim.frame < 0) anim.start(CLIP.FALL, 0); }
          }
        } else {
          // leaning forward
          if (anim.clip === CLIP.FALL) { if (frame < 5 || 0x37 < frame) anim.start(CLIP.LEAN, 0); else anim.advance(1); }
          if (anim.clip === CLIP.LEAN) { frame = ftol(anim.frame); if (frame < 0xf) anim.advance(1); }
        }
        this.fallTarget = Math.abs(Math.sin(rec.rx) * 0.4) + PILOT.FALL_BASE;
        const glide = Math.sin(2 * rec.rx);
        // the wind sound's pitch follows the fall speed: ftol((fall - 0.4) * 17215 + 9114) Hz
        snd.rate('accel', ftol((this.fallTarget - PILOT.FALL_BASE) * 17215 + 9114));
        snd.play('accel');
        ex += glide * dt * Math.sin(rec.ry);
        ez += glide * dt * Math.cos(rec.ry);
        this.fall = this.fallTarget;
        if (run.height <= 0) {
          // hit the ground without the parachute
          this.state = S.LANDING;
          ey = rec.y; ex = rec.x; ez = rec.z;
          const hit = w.col.sweep(rec, [ex, ey, ez], [px - ex, py - ey, pz - ez], 3, 12, 12);
          if (!hit) snd.play('bigSplash');
          else if (nameStarts(hit.rec, 'TAR')) snd.play('hitTarget');
          else snd.play('smack');
          snd.stop('windFall'); snd.stop('windChute');
        } else {
          ey = ey - this.fall * dt;
        }
        if (run.chuteOk && (held & B.SHIFT)) {
          this.state = S.OPENING;
          anim.start(CLIP.OPEN, 0);
          snd.play('chuteOpen'); snd.stop('windFall'); snd.play('windChute');
          this.fall = PILOT.CHUTE_FALL;
        }
        break;
      }
      case S.OPENING: {
        if (rec.rx <= 0 || TWO_PI <= rec.rx) {
          rec.rx = 0;
          run.canopy = 1;
          const done = anim.advance(1);
          if (done !== 0) {
            this.state = S.GLIDE;
            anim.start(CLIP.GLIDE, 0);
            this.camLerp = 0.35; this.camOff[1] = 0; this.camOff[2] = -2.8;
          }
        } else if (Math.PI <= rec.rx || rec.rx <= 0) rec.rx += 0.1 * dt;
        else rec.rx -= 0.1 * dt;
        ey = ey - this.fall * dt;
        break;
      }
      case S.GLIDE: {
        snd.play('flap');
        if (anim.clip === CLIP.GLIDE) anim.advance(1);
        this.fwd = (this.fall * ey) / (PILOT.START_ALT + PILOT.GLIDE_REF);
        if (!(held & B.UP)) {
          if (anim.clip === CLIP.PULL) {
            anim.advance(-1);
            if (ftol(anim.frame) <= 0) anim.start(CLIP.GLIDE, 0);
          }
        } else {
          ey = (this.fall / 2) * dt + ey;
          this.fwd *= 4;
          if (anim.clip === CLIP.GLIDE) anim.start(CLIP.PULL, 0);
          else if (ftol(anim.frame) < 0xf) anim.advance(1);
        }
        const m = rec.m;
        ex += this.fwd * dt * m[8] * 8;
        ey = ey - this.fall * dt + this.fwd * dt * m[9] * 8;
        ez += this.fwd * dt * m[10] * 8;
        this.landing(run, anim, rec, dTar1, dTar2, dTar3, [px, py, pz]);
        break;
      }
      case S.LANDING: {
        snd.stop('flap');
        this.camLerp = 0.03; this.camOff[2] = 12; this.camOff[0] = -12;
        if (anim.clip === CLIP.LAND) {
          const r = anim.advance(1);
          if (r === 1 || r === 2) {
            this.state = S.OVER;
            anim.start(run.score < 2000 ? CLIP.SAD : CLIP.CHEER, 0);
            run.canopy = 2;
          }
        } else { this.state = S.OVER; run.score = 0; }
        break;
      }
      case S.OVER:
        run.over = true;
        break;
      case S.BOUNCE: {
        const frame = ftol(anim.frame);
        const k = ((60 - frame) >> 3) * dt;
        ex = rec.x + k * this.bounce[0]; ey = rec.y + k * this.bounce[1]; ez = rec.z + k * this.bounce[2];
        rec.x = ex; rec.y = ey; rec.z = ez;
        const r = anim.advance(1);
        if (r === 1 || r === 2) { this.state = S.FALL; anim.start(CLIP.FALL, 0); }
        ey = ey - this.fall * dt;
        rec.x = ex; rec.y = ey; rec.z = ez;
        const hit = w.col.sweep(rec, [ex, ey, ez], [px - ex, py - ey, pz - ez], 3, 1.2, 1.2);
        if (hit) {
          if (nameStarts(hit.rec, 'LAND')) this.state = S.LANDING;
          if (nameStarts(hit.rec, 'TAR')) { snd.play('hitTarget'); this.state = S.LANDING; }
        }
        break;
      }
    }

    this.steer(held);
    if (this.state === S.FALL || this.state === S.GLIDE) {
      rec.ry += this.yawRate * dt;
      if (rec.ry < 0) rec.ry += TWO_PI;
      if (TWO_PI < rec.ry) rec.ry -= TWO_PI;
    }
    rec.setEuler(rec.rx, rec.ry, rec.rz, ex, ey, ez);
    ex = rec.x; ey = rec.y; ez = rec.z;
    if (this.state !== S.LANDING && this.state !== 6 && this.state !== S.OVER) {
      ex += this.windX * dt; ez += this.windZ * dt;
      rec.x = ex; rec.y = ey; rec.z = ez;
    }
    // the ground under the canopy / body (FUN_00442a70 from the canopy record): height above the ground, the blob shadow
    this.ground(w, run, rec, ey);
    run.shadowOn = this.state === S.GLIDE && !(run.groundY < 4.5);

    if (this.state === S.FALL || this.state === S.OPENING) this.collide(w, run, rec, [px, py, pz], [ex, ey, ez]);

    if (this.state === S.LANDING || this.state === S.OVER) {
      // the pilot's own particle emitters are switched off here in the original (not ported)
    }
    this.camera(w, rec, ex, ey, ez);
    run.y = ey;
    return NODE_STOP;
  }

  /** the three ring tests (the first blocks of FUN_004686a3): ring 3 (highest), ring 2, ring 1 */
  private rings(run: ParRun, rec: GameRecord, ex: number, ey: number, ez: number) {
    const R = run.recs, snd = run.sound;
    for (const i of [2, 1, 0] as const) {
      if (run.ring[i] !== 0) continue;
      const ring = R.rings[i];
      const d = Math.hypot(ex - ring.x, ey - ring.y, ez - ring.z);
      const reach = [11, 19, 26][i];
      if (d < reach && ey < ring.y + 4 && ring.y - 5 < ey) {
        if (4 < rec.rx && rec.rx < 5.5) {
          run.score += PILOT.DIVE_BONUS;
          if (i === 2) run.speak('LESGPT14');
        }
        run.ring[i] = RING_HIT;
        R.targets[i].flags = 2;
        run.score += PILOT.RING_BONUS[i];
        snd.play('thruRing');
      }
      if (ey - ring.y < 0 && run.ring[i] === 0) {
        run.ring[i] = RING_MISSED;
        // both upper rings missed: the hint line
        if (i === 1 && run.ring[2] === RING_MISSED) run.speak('LESGPT13');
      }
    }
  }

  /** state 3 (after the move): landing on a revealed target, or touching the ground */
  private landing(run: ParRun, anim: typeof noAnim & { start(c: number, f?: number): boolean }, rec: GameRecord, d1: number, d2: number, d3: number, prev: Vec3) {
    const R = run.recs, snd = run.sound, below = run.height < 0;
    const hit = (i: number, d: number) => { // ring i hit, close to its target, and at ground level
      if (run.ring[i] === RING_HIT && d < PILOT.RADIUS[2 - i] && below) {
        this.landed = true;
        const r = PILOT.RADIUS[2 - i];
        run.landScore = ftol((r - d) * (PILOT.LAND_FULL[i] / r));
        if (i === 0 && run.landScore > 10000) run.landScore = 10000;
      }
    };
    hit(2, d3); hit(1, d2); hit(0, d1);
    if (!this.landed) {
      if (below) {
        const w = run.world;
        const ex = rec.x, ey = rec.y, ez = rec.z;
        const h = w.col.sweep(rec, [ex, ey, ez], [prev[0] - ex, prev[1] - ey, prev[2] - ez], 3, 12, 12);
        if (h) snd.play('landOff'); else snd.play('splash');
        this.crashed = true;
        this.state = S.LANDING;
        anim.start(CLIP.LAND, 0);
        run.score = 0;
      }
    } else {
      run.landBonus = PILOT.LAND_BONUS;
      if ((anim as { clip: number }).clip === CLIP.PULL) run.landBonus -= ftol(ftol((anim as unknown as { frame: number }).frame) * PILOT.FLARE_COST);
      run.score += run.landScore + run.landBonus;
      this.state = S.LANDING;
      anim.start(CLIP.LAND, 0);
      snd.play('landOk');
    }
    void R;
  }

  /** the steering ramp (shared with z40aPO, util.ts `steerYaw`) */
  private steer(held: number) { steerYaw(this, held); }

  /** FUN_00442a70 as far as the pilot reads it: the ray from 150 above the canopy record straight down onto the land record; the height + 3.2 is the "ground" */
  private ground(w: World, run: ParRun, _rec: GameRecord, ey: number) {
    const R = run.recs, from = R.para ?? R.pepp;
    const h = w.col.rayRecord(R.land, [from.x, from.y + 150, from.z], [0, -8000, 0], 3, 0.01, 0);
    if (h) { run.groundY = h.point[1] + 0.4 * 8; run.groundHit = [h.point[0], h.point[1], h.point[2]]; }
    run.height = ey - run.groundY;
  }

  /** the bounce test of states 1 / 2: the sweep (radius 1.2) and the pterodactyl boxes */
  private collide(w: World, run: ParRun, rec: GameRecord, prev: Vec3, cur: Vec3) {
    const R = run.recs, snd = run.sound;
    const delta: Vec3 = [prev[0] - cur[0], prev[1] - cur[1], prev[2] - cur[2]];
    const hit = w.col.sweep(rec, cur, delta, 3, 1.2, 1.2);
    const point: Vec3 = [0, 0, 0], normal: Vec3 = [0, 0, 0];
    let bird = false;
    if (!hit) {
      for (let i = 0; i < 3 && !bird; i++) {
        const b = R.birds[i];
        if (b && segmentHitsRecordBox(b, prev, cur, point, normal)) bird = true;
      }
    }
    if (!hit && !bird) return;
    const n: Vec3 = hit ? [hit.normal[0], hit.normal[1], hit.normal[2]] : normal;
    if (n[0] === 0 && n[2] === 0) { n[0] = rand(2) - 1; n[2] = rand(2) - 1; }
    reflect(delta, n, this.bounce);
    this.bounce[1] = -0.2;
    rec.anim?.start(CLIP.BOUNCE, 0);
    this.state = S.BOUNCE;
    if (!hit) snd.play('hitBird');
    else if (['RNG1', 'RNG2', 'RNG3'].some((s) => nameStarts(hit.rec, s))) snd.play('hitRing');
    else if (nameStarts(hit.rec, 'PLNE')) snd.play('hitPlane');
    else if (nameStarts(hit.rec, 'BALL')) snd.play('hitBalloon');
  }

  /** the chase camera of the end of FUN_004686a3 (writes the camera block like the original: eye [0..2], look-at [3..5]) */
  private camera(w: World, rec: GameRecord, ex: number, ey: number, ez: number) {
    const c = w.camera.c;
    // M = Euler(0, ry, rz) at the pilot
    const eye = eulerLocalToWorld(rec.ry, rec.rz, [ex, ey, ez], [this.camOff[0], this.camOff[1] + 13.6, this.camOff[2] - 4]);
    c[3] = ex; c[4] = ey + PILOT.CAM_LIFT * 8; c[5] = ez;
    c[0] = (eye[0] - c[0]) * this.camLerp + c[0];
    c[2] = (eye[2] - c[2]) * this.camLerp + c[2];
    c[1] = (eye[1] - c[1]) * this.camLerp + c[1];
  }
}

/** v * Euler(0, ry, rz) + t (FUN_0043a5e4 + FUN_0043ab72) */
export function eulerLocalToWorld(ry: number, rz: number, t: Vec3, v: Vec3): Vec3 {
  return transformPoint(buildMatrix(0, ry, rz, t[0], t[1], t[2]), v);
}
