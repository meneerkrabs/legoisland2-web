// z40aPO: Pepper in a space suit, thrown out of the shuttle over Ogel: the behaviour node of FUN_007d53af (constructor, "Parogel") / FUN_007d3187 (update, 629 lines).
// A copy of the z38PAR pilot (par-pilot.ts) with a launch phase, 15 rings in three groups, asteroids / rock monsters / brickbots in the way and a landing on the planet.
//
// States (node +0x38): 0 the shuttle opens its doors, 1 the shuttle pulls away, 2 free fall (Up / Down tilt, Shift opens the solar wing once it is allowed), 3 the wing opens,
// 4 gliding (Left / Right steer, Up pulls forward), 5 landing animation, 6 game over, 8 bounced off something (the state it came from is kept in +0x3c / the clip in +0x40).
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { B } from '../../game/input.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { apoRun } from './apo-run.ts';
import type { ApoRun } from './apo-run.ts';
import { TWO_PI, ftol, nameStarts, rand, reflect, segmentHitsRecordBox, steerYaw, transformPoint } from './util.ts';
import type { Vec3 } from './util.ts';

export const AS = { DOORS: 0, LAUNCH: 1, FALL: 2, OPENING: 3, GLIDE: 4, LANDING: 5, OVER: 6, BOUNCE: 8 } as const;
/** animation clips of the pilot's rig (the same MFIG.blk numbering as z38PAR) */
export const ACLIP = { GLIDE: 1, FALL: 3, OPEN: 4, LAND: 5, BOUNCE: 7, SAD: 8, CHEER: 9, PULL: 10 } as const;

/** constants of the constructor FUN_007d53af and the update (float immediates of the code; addresses of the data in comments) */
export const APO = {
  START_ALT: 2000,            // 0x44fa0000: local_10[5] (also DAT_05d5f0a0)
  GLIDE_REF: 400,             // 0x43c80000: node +0x18
  RADIUS: [22.8, 11.5, 7.6] as const,   // node +0x20 / +0x24 / +0x28: landing radius of target 3 / 2 / 1
  CHUTE_FALL: 0.3,            // 0x3e99999a: node +0x54
  FALL_START: 0.5,            // 0x3f000000: node +0x58
  CAM_LERP: 0.15,             // 0x3e19999a: node +0x60
  CAM_OFF: [16, 0, 4] as const,   // node +0x64 / +0x68 / +0x6c
  CAM_LIFT: 0.25,             // 0x3e800000: node +0x74 (times 8)
  GROUP_ALT: [1400, 800, 310] as const,  // node +0x98 / +0x9c / +0xa0: below these heights a group without a passed ring is missed
  RING_POINTS: [250, 500, 750] as const,  // 0xfa / 500 / 0x2ee in the ring table (+0x4 of the 0x14 byte entries)
  LAND_FULL: [1000, 1500, 2000] as const, // 0x892120 / 0x892990 / 0x8923d0: points at the middle of target 3 / 2 / 1
  LAND_BONUS: 800,
  FLARE_COST: 50,
  PITCH_RATE: 0.07,           // 0x3d8f5c29 at 0x89299c (node +0x7c)
  DOOR_STEP: 0.02, DOOR_MAX: 2.09438, DOOR_CLOSE: 0.09,   // 0x892..: shuttle doors in state 0 / 1
  SHUTTLE_DRIFT: [2.5, 1.0, 0.007] as const,   // state 1: x -= 2.5, y -= 1.0, rx += 0.007 per tick
  BOUNCE_SHIFT: 4,            // (60 - frame) >> 4 in state 8 (PAR: >> 3)
  MONSTER_SCALE: 1.2,         // 0x8920e8: the rock monsters' boxes are 20 % larger
} as const;

const noAnim = { clip: 0, frame: 0, start() { return false; }, advance() { return 0; } };

export class ApoPilot implements BehaviourNode {
  readonly kind = 'ApoPilot';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;

  state: number = AS.DOORS;       // +0x38
  prevState = 0; prevClip = 0;    // +0x3c / +0x40
  landed = false;                 // +0x48
  steerDir = 0;                   // +0x44
  yawRate = 0;                    // +0x4c
  fallTarget = 0;                 // +0x50
  fall: number = APO.FALL_START;  // +0x58
  fwd = 0;                        // +0x5c
  camLerp: number = APO.CAM_LERP; // +0x60
  camOff: Vec3 = [APO.CAM_OFF[0], APO.CAM_OFF[1], APO.CAM_OFF[2]];   // +0x64 / +0x68 / +0x6c
  door: Vec3 = [0, 0, 0];         // +0x80 / +0x84 / +0x88
  bounce: Vec3 = [0, 0, 0];       // +0x8c / +0x90 / +0x94
  /** the target heights of the landing test: target 3 + 3, target 2, target 1 + 2 (node +0x2c / +0x30 / +0x34) */
  landY: Vec3 = [0, 0, 0];
  private inited = false;

  init(w: World, rec: GameRecord) {
    if (this.inited) return;
    this.inited = true;
    const run = apoRun(w);
    const R = run.recs;
    this.landY = [R.targets[2].y + 3, R.targets[1].y + 0, R.targets[0].y + 2];
    rec.x = 0; rec.y = APO.START_ALT; rec.z = 0;
    rec.rx = rec.ry = rec.rz = 0;
    rec.setEuler(0, 0, 0, 0, APO.START_ALT, 0);
    rec.savePrev();
    rec.flags &= ~0x10;                    // the port's walk set-up makes the player non-solid; in this zone the brickbots and rocks can touch it
    if (R.shad) { R.shad.x = 0; R.shad.y = 0; R.shad.z = 0; R.shad.hide(); }
    rec.anim?.start(ACLIP.FALL, 0);
    run.startAlt = APO.START_ALT; run.y = APO.START_ALT;
    run.ring.fill(0); run.group = [false, false, false]; run.chuteOk = false; run.score = 0; run.height = 0; run.landBonus = 0; run.canopy = 0;
    run.over = false; run.aborted = false; run.monstersWoke = false;
  }

  update(w: World, rec: GameRecord): number {
    this.init(w, rec);
    const run = apoRun(w);
    const R = run.recs, snd = run.sound;
    const held = w.input.held, dt = w.dt;
    const anim = (rec.anim ?? noAnim) as typeof noAnim & { start(c: number, f?: number): boolean; advance(r: number): number };
    run.tick++;

    let ex = rec.x, ey = rec.y, ez = rec.z;
    const px = ex, py = ey, pz = ez;
    snd.play('breath');                                  // node +0xb4 stays 0: the breathing loop is refreshed every tick
    if (R.palace) snd.at('palace', [R.palace.x, R.palace.y, R.palace.z]);
    // a group whose ring was passed: the beacon of its target is heard, the distance to the target is kept for the landing test
    const dist = (t: GameRecord) => Math.hypot(ex - t.x, ey - t.y, ez - t.z);
    let d3 = 0, d2 = 0, d1 = 0;
    if (run.group[0]) { snd.at('beacon1', [R.targets[2].x, R.targets[2].y, R.targets[2].z]); d3 = dist(R.targets[2]); }
    if (run.group[1]) { snd.at('beacon2', [R.targets[1].x, R.targets[1].y, R.targets[1].z]); d2 = dist(R.targets[1]); }
    if (run.group[2]) { snd.at('beacon1', [R.targets[0].x, R.targets[0].y, R.targets[0].z]); d1 = dist(R.targets[0]); }

    switch (this.state) {
      case AS.DOORS: {
        anim.advance(1);
        const sh = R.shtl;
        if (sh) { sh.rx = 4.71239; sh.ry = Math.PI; sh.setEuler(sh.rx, sh.ry, sh.rz, sh.x, sh.y, sh.z); }
        this.door[0] -= APO.DOOR_STEP * dt; this.door[1] += APO.DOOR_STEP * dt; this.door[2] += APO.DOOR_STEP * dt;
        if (APO.DOOR_MAX < this.door[2]) {
          this.camOff = [0, 0, 0];
          this.state = AS.LAUNCH;
          snd.play('launch');
        }
        break;
      }
      case AS.LAUNCH: {
        anim.advance(1);
        const sh = R.shtl;
        snd.stop('engine');
        if (this.door[2] <= 0) { sh?.hide(); this.state = AS.FALL; }
        else if (sh) {
          sh.y -= APO.SHUTTLE_DRIFT[1] * dt; sh.x -= APO.SHUTTLE_DRIFT[0] * dt;
          sh.rx += APO.SHUTTLE_DRIFT[2] * dt;
          sh.setEuler(sh.rx, sh.ry, sh.rz, sh.x, sh.y, sh.z);
          this.door[0] += APO.DOOR_CLOSE * dt; this.door[1] -= APO.DOOR_CLOSE * dt; this.door[2] -= APO.DOOR_CLOSE * dt;
        } else this.door[2] -= APO.DOOR_CLOSE * dt;
        break;
      }
      case AS.FALL: {
        if (this.camLerp < 0.85) this.camLerp += 0.1 * dt;
        // a group without a passed ring when the pilot is below its height is missed (the flag of the group's last ring becomes 2)
        const sum = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += run.ring[i]; return s; };
        if (py < APO.GROUP_ALT[0] && run.ring[4] !== 2 && sum(0, 5) === 0) run.ring[4] = 2;
        if (py < APO.GROUP_ALT[1] && run.ring[9] !== 2 && sum(5, 10) === 0) run.ring[9] = 2;
        if (py < APO.GROUP_ALT[2] && run.ring[14] !== 2 && sum(10, 15) === 0) run.ring[14] = 2;
        if (anim.clip === ACLIP.FALL) anim.advance(1);
        const step = dt * APO.PITCH_RATE;
        if (held & B.UP) { rec.rx += step; if (rec.rx > TWO_PI) rec.rx -= TWO_PI; }
        if (held & B.DOWN) { rec.rx -= step; if (rec.rx < 0) rec.rx += TWO_PI; }
        this.fallTarget = Math.abs(Math.sin(rec.rx) * 0.4) + 0.4;
        const glide = Math.sin(2 * rec.rx);
        snd.rate('accel', ftol((this.fallTarget - 0.4) * 17215 + 9114));
        snd.play('accel');
        ex += glide * dt * Math.sin(rec.ry);
        ez += glide * dt * Math.cos(rec.ry);
        this.fall = this.fallTarget;
        if (run.height <= 0) {
          this.state = AS.LANDING;
          ex = rec.x; ey = rec.y; ez = rec.z;
          const hit = w.col.sweep(rec, [ex, ey, ez], [px - ex, py - ey, pz - ez], 3, 12, 12);
          if (hit) { if (nameStarts(hit.rec, 'TAR')) snd.play('hitTarget'); else snd.play('smack'); }
        } else ey = ey - this.fall * dt;
        if (run.chuteOk && (held & B.SHIFT)) {
          run.speak('OGSGPO09');
          this.state = AS.OPENING;
          snd.play('solarOpen'); snd.play('thruster');
          anim.start(ACLIP.OPEN, 0);
          this.fall = APO.CHUTE_FALL;
        }
        break;
      }
      case AS.OPENING: {
        if (rec.rx <= 0 || TWO_PI <= rec.rx) {
          rec.rx = 0;
          run.canopy = 1;
          const done = anim.advance(1);
          if (done !== 0) {
            this.state = AS.GLIDE;
            anim.start(ACLIP.GLIDE, 0);
            this.camLerp = 0.35; this.camOff[1] = 0; this.camOff[2] = -2.8;
          }
        } else if (Math.PI <= rec.rx || rec.rx <= 0) rec.rx += 0.1 * dt;
        else rec.rx -= 0.1 * dt;
        ey = ey - this.fall * dt;
        break;
      }
      case AS.GLIDE: {
        if (anim.clip === ACLIP.GLIDE) anim.advance(1);
        this.fwd = ((ey + 50) * this.fall) / (APO.START_ALT + APO.GLIDE_REF);
        if (!(held & B.UP)) {
          if (anim.clip === ACLIP.PULL) {
            anim.advance(-1);
            if (anim.frame < 0) anim.start(ACLIP.GLIDE, 0);
            if (ftol(anim.frame) <= 0) anim.start(ACLIP.GLIDE, 0);
          }
        } else {
          ey = (this.fall / 2) * dt + ey;
          this.fwd *= 4;
          if (anim.clip === ACLIP.GLIDE) anim.start(ACLIP.PULL, 0);
          else if (ftol(anim.frame) < 0xf) anim.advance(1);
        }
        const m = rec.m;
        ex += this.fwd * dt * m[8] * 8;
        ey = ey - this.fall * dt + this.fwd * dt * m[9] * 8;
        ez += this.fwd * dt * m[10] * 8;
        // landing on a target whose group was passed: close enough and below its height
        const land = (g: number, d: number, r: number, limit: number, full: number) => {
          if (run.group[g] && d < r && ey < limit) { this.landed = true; run.landScore = ftol((r - d) * (full / r)); }
        };
        land(0, d3, APO.RADIUS[0], this.landY[0], APO.LAND_FULL[0]);
        land(1, d2, APO.RADIUS[1], this.landY[1], APO.LAND_FULL[1]);
        land(2, d1, APO.RADIUS[2], this.landY[2], APO.LAND_FULL[2]);
        if (run.group[2] && run.landScore > 10000) run.landScore = 10000;
        if (!this.landed) {
          if (run.height < 0) {
            this.state = AS.LANDING;
            anim.start(ACLIP.LAND, 0);
            snd.play('landOff');
            run.score = 0;
          }
        } else {
          run.landBonus = APO.LAND_BONUS;
          if (anim.clip === ACLIP.PULL) run.landBonus -= ftol(ftol(anim.frame) * APO.FLARE_COST);
          run.score += run.landScore + run.landBonus;
          this.state = AS.LANDING;
          anim.start(ACLIP.LAND, 0);
          snd.play('landOk');
        }
        break;
      }
      case AS.LANDING: {
        snd.stop('thruster');
        this.camLerp = 0.03; this.camOff[2] = 12; this.camOff[0] = 12;
        if (anim.clip === ACLIP.LAND) {
          const r = anim.advance(1);
          if (r === 1 || r === 2) {
            this.state = AS.OVER;
            anim.start(run.score < 2000 ? ACLIP.SAD : ACLIP.CHEER, 0);
            run.canopy = 2;
          }
        } else { this.state = AS.OVER; run.score = 0; }
        break;
      }
      case AS.OVER:
        run.over = true;
        break;
      case AS.BOUNCE: {
        const frame = ftol(anim.frame);
        const k = ((60 - frame) >> APO.BOUNCE_SHIFT) * dt;
        ex = rec.x + k * this.bounce[0]; ey = rec.y + k * this.bounce[1]; ez = rec.z + k * this.bounce[2];
        rec.x = ex; rec.y = ey; rec.z = ez;
        const r = anim.advance(1);
        if (r === 1 || r === 2) { this.state = this.prevState; anim.start(this.prevClip, 0); }
        ey = ey - this.fall * dt;
        rec.x = ex; rec.y = ey; rec.z = ez;
        const hit = w.col.sweep(rec, [ex, ey, ez], [px - ex, py - ey, pz - ez], 3, 1.2, 1.2);
        if (hit && nameStarts(hit.rec, 'OGEL')) this.state = AS.LANDING;
        break;
      }
    }

    if (this.state !== AS.DOORS && this.state !== AS.LAUNCH) {
      steerYaw(this, held);
      if (this.state === AS.FALL || this.state === AS.GLIDE) rec.ry += this.yawRate * dt;
      rec.setEuler(rec.rx, rec.ry, rec.rz, ex, ey, ez);
      ex = rec.x; ey = rec.y; ez = rec.z;
      this.ground(w, run, ey);
      run.shadowOn = this.state === AS.GLIDE;
    }
    this.camera(w, rec, ex, ey, ez);
    run.y = ey;
    if (this.state === AS.FALL || this.state === AS.GLIDE || this.state === AS.OPENING) this.collide(w, run, rec, [px, py, pz], [ex, ey, ez]);
    return NODE_STOP;
  }

  /** FUN_00442a70 from the wing record onto the OGEL record: the ground height + 3.2 under the pilot */
  private ground(w: World, run: ApoRun, ey: number) {
    const R = run.recs, from = R.para ?? R.pepp;
    const h = w.col.rayRecord(R.ogel, [from.x, from.y + 150, from.z], [0, -8000, 0], 3, 0.01, 0);
    if (h) { run.groundY = h.point[1] + 0.4 * 8; run.groundHit = [h.point[0], h.point[1], h.point[2]]; }
    run.height = ey - run.groundY;
  }

  /** the end of the update for states 2 / 3 / 4: the forward sweep (radius 1.2) and the three rock monsters' boxes, then what was hit decides */
  private collide(w: World, run: ApoRun, rec: GameRecord, prev: Vec3, cur: Vec3) {
    const R = run.recs, snd = run.sound;
    const delta: Vec3 = [cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]];     // forward: this tick's motion, from the new position (cur - prev)
    const hit = w.col.sweep(rec, cur, delta, 3, 1.2, 1.2);
    const point: Vec3 = [0, 0, 0], normal: Vec3 = [0, 0, 0];
    let monster = false;
    for (let i = 0; i < 3 && !monster; i++) {
      if (segmentHitsRecordBox(R.rocks[i], prev, cur, point, normal, APO.MONSTER_SCALE)) { monster = true; snd.play('hitMonster'); }
    }
    if (!hit && !monster) return;
    let ringHit = false;
    if (!monster && hit) {
      for (let i = 0; i < 15; i++) {
        if (nameStarts(hit.rec, R.rc[i].name)) {
          ringHit = true;
          if (run.ring[i] === 0) {
            run.ring[i] = 1;
            R.targets[i < 5 ? 2 : i < 10 ? 1 : 0].flags = 2;
            run.score += APO.RING_POINTS[Math.floor(i / 5)];
            snd.play('thruRing');
            run.group[Math.floor(i / 5)] = true;
          }
        }
      }
    }
    if (ringHit) return;
    if (!monster && hit && nameStarts(hit.rec, 'OGEL')) {
      this.state = AS.LANDING; rec.anim?.start(ACLIP.LAND, 0); run.score = 0;
    } else if (!monster && hit && nameStarts(hit.rec, 'SKY1')) {
      this.state = AS.OVER; run.score = 0; run.aborted = true;
    } else {
      if (!monster && hit) {
        if (nameStarts(hit.rec, 'RK')) snd.play('hitAsteroid');
        if (nameStarts(hit.rec, 'RN')) snd.play('hitRing');
        if (nameStarts(hit.rec, 'BBT')) snd.play('hitBot');
      }
      const n: Vec3 = !monster && hit ? [hit.normal[0], hit.normal[1], hit.normal[2]] : normal;
      if (n[0] === 0 && n[2] === 0) { n[0] = rand(2) - 1; n[2] = rand(2) - 1; }
      reflect(delta, n, this.bounce);
      this.bounce[1] = -0.2;
      this.prevState = this.state;
      const clip = rec.anim?.clip ?? 0;
      if (clip !== ACLIP.BOUNCE) this.prevClip = clip;
      this.state = AS.BOUNCE;
      run.speak('OGSGPO11');
      rec.anim?.start(ACLIP.BOUNCE, 0);
    }
  }

  private camera(w: World, rec: GameRecord, ex: number, ey: number, ez: number) {
    const c = w.camera.c;
    const eye = transformPoint(buildMatrix(0, rec.ry, rec.rz, ex, ey, ez), [this.camOff[0], this.camOff[1] + 13.6, this.camOff[2] - 1.6]);
    c[3] = ex; c[4] = ey + APO.CAM_LIFT * 8; c[5] = ez;
    c[0] = (eye[0] - c[0]) * this.camLerp + c[0];
    c[2] = (eye[2] - c[2]) * this.camLerp + c[2];
    c[1] = (eye[1] - c[1]) * this.camLerp + c[1];
  }
}
