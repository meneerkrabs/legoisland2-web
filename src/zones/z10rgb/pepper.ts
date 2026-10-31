// z10RGB: Pepper's two nodes and everything about the four cannons the player may use (docs/re/m6/z10RGB.md sections 3, 4).
//   "PepSwitc" (the zone's own copy, constructor FUN_005f4f14, update FUN_005f49c5, always on): the mode switch of the zone. Walking: the bridge (Pepper below y = 4 is put
//     back at the bridge point, crossing the bridge starts phase 2), Ctrl next to a cannon in phase 3 enters it (FUN_005f6017 picks the nearest within sqrt(72));
//     inside (mode 4) the arrow keys aim (FUN_005f56d9: 0.0025 rad per tick, pitch -0.5 .. 0.3), Space fires (FUN_005f6120, reload 100 ticks), Ctrl leaves (FUN_005f554b);
//     a hit while inside (mode 2 after mode 4) leaves it, destroys the cannon and costs a life (FUN_005f542f). Also the camera of sub-game 9 (FUN_0042d4b1): the walk
//     node's step moves eye and target.
//   "PeppHit" (constructor FUN_0061884d, update FUN_006186f2, gated by the mode word & 2): Pepper is thrown up by a ball, falls (bounces), lies for a moment and
//     gets up (FUN_00618360 / 00618612 / 00618631 / 006186af).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE } from '../../game/controller.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { WalkNode } from '../../game/walk.ts';
import { NO_GROUND } from '../../game/collision.ts';
import { B } from '../../game/input.ts';
import { ST } from '../../game/walk.ts';
import { CLIP, K, MODE, PHASE, REC, VAR, f32 } from './consts.ts';
import { allocBall, launchBall, placeBall, releaseBall } from './balls.ts';
import { toWorld24 } from './shared.ts';
import { ad, ml, sb } from '../common/f32.ts';
import type { RgbState, PepperCannon } from './shared.ts';

const F = Math.fround;

/** the euler angles FUN_005f4f14 writes into the four cannons (rx, ry, rz at +0x4c / 0x50 / 0x54; the matrix is built from their negatives) */
export const CANNON_EULER: readonly (readonly [number, number, number])[] = [
  [f32(0x3ced9168), f32(0x3ff147ae), f32(0xbe19999a)],
  [f32(0x3ced9168), f32(0x3fcae148), f32(0xbe19999a)],
  [f32(0x3df7ced9), f32(0x3fa53f7d), f32(0x3b83126f)],
  [f32(0x3e54fdf4), f32(0x3fc1eb85), f32(0xbdf5c28f)],
];

/** the constructor effects of FUN_005f4f14 on the four cannons: the euler angles, the stored copies, the matrices from the negated angles */
export function initPepperCannons(st: RgbState): void {
  const w = st.w;
  st.cannons = REC.CP.map((ri, i): PepperCannon => {
    const rec = w.records[ri];
    const [rx, ry, rz] = CANNON_EULER[i];
    rec.rx = rx; rec.ry = ry; rec.rz = rz;
    const c: PepperCannon = { rec, pos: [rec.x, rec.y, rec.z], euler: [rx, ry, rz], timer: 0, fresh: 1 };
    rec.setEuler(-rx, -ry, -rz, rec.x, rec.y, rec.z);
    rec.savePrev();
    return c;
  });
  st.savedFov = st.fov;
}

/** FUN_0043b92a: true when the current clip ends within `n` more frames (the original returns 2): `(float) frameCount < (1.0 + frame) + n * DAT_008b1718`, float32 steps in the asm's order (`dt` = `world.dt`) */
export function clipEnding(anim: { frame: number; frameCount: number }, n: number, dt: number): boolean {
  return anim.frameCount < ad(ad(1, anim.frame), ml(n, dt));
}

export class PepSwitcNode implements BehaviourNode {
  readonly kind = 'PepSwitc';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  private st: RgbState;
  constructor(st: RgbState) { this.st = st; }

  /** FUN_005f6017: the nearest of the cannons that are still shown within sqrt(72) of Pepper (squared distance below 72), -1 when none */
  nearestCannon(): number {
    const st = this.st, p = st.pepper;
    let best = -1, bestD: number = K.ENTER_R2;
    st.cannons.forEach((c, i) => {
      if ((c.rec.flags & RF_ENABLED) !== RF_ENABLED) return;
      const dx = sb(c.rec.x, p.x), dy = sb(c.rec.y, p.y), dz = sb(c.rec.z, p.z);
      const d = ad(ad(ml(dz, dz), ml(dy, dy)), ml(dx, dx));          // fVar3 * fVar3 + fVar2 * fVar2 + fVar1 * fVar1 (float32 steps)
      if (d < bestD) { best = i; bestD = d; }
    });
    return best;
  }

  /** FUN_005f554b: leave the cannon: it is shown and put back where it stood, the camera and the zoom as before, mode 1 */
  leaveCannon(): void {
    const st = this.st, w = st.w;
    const c = st.cannons[st.selected];
    c.rec.flags |= RF_ENABLED;
    st.pepper.flags |= RF_ENABLED;
    c.rec.setEuler(-c.euler[0], -c.euler[1], -c.euler[2], c.pos[0], c.pos[1], c.pos[2]);
    w.camera.c.set(st.camBackup);
    w.camera.savePrev();
    st.fov = st.savedFov;
    st.hud.min = 0; st.hud.max = K.GAUGE_CANNONS; st.hud.value = st.cannonsLeft; st.hud.rightText = ''; st.hud.icon = 6;
    st.setMode(MODE.WALK);
    st.pepperCannon = -1;
    st.sound.stop('tilt'); st.sound.stop('swivel'); st.sound.stop('reload');
  }

  /** FUN_005f542f: the player was hit inside the cannon: it is gone, one life less, 1000 points less; no life left: phase 5 */
  cannonLost(): void {
    const st = this.st;
    const c = st.cannons[st.selected];
    c.rec.flags &= ~RF_ENABLED;
    st.lives--;
    st.score -= 1000;
    st.setMode(MODE.HIT);
    st.w.vars.set(VAR.PEPP_CANNON_BIT, 1 << st.selected);
    if (st.lives === 0) { st.setMode(MODE.DEAD); st.phase = PHASE.LOST; }
  }

  /** FUN_005f6120: fire the cannon the player sits in when it has reloaded; the ball leaves the muzzle at 2.5 * pitch + 0.8 */
  fire(): void {
    const st = this.st;
    const c = st.cannons[st.pepperCannon], rec = c.rec;
    if (c.timer <= 0) {
      const b = allocBall(st);
      st.curBall = b ? b.idx : -1;
      if (b) {
        st.sound.play('fire');
        const muzzle = toWorld24(rec.m, K.MUZZLE);
        const scale = shotScale.value;
        placeBall(b, muzzle, [rec.m[8] * scale, 1 * scale, rec.m[10] * scale]);
        const pitch = F(F(F(K.PITCH_K * 1) * rec.rx) + K.PITCH_0);        // 24-bit x87: every operation rounds to a float
        shotScale.value = K.SHOT_SCALE;
        launchBall(b, pitch);
        c.timer = K.RELOAD;
      }
    } else st.sound.play('dry');
  }

  /** FUN_005f56d9: one tick inside a cannon */
  aim(w: World): void {
    const st = this.st, c = st.cannons[st.pepperCannon], rec = c.rec;
    const held = w.input.held, pressed = w.input.pressed;
    st.fov = K.AIM_FOV;
    rec.m[13] = K.CANNON_Y;
    if (c.fresh) { rec.rx = K.PITCH_FIRST; c.fresh = 0; }
    if (pressed & B.CTRL) { this.leaveCannon(); return; }
    if (pressed & B.SPACE) { this.fire(); return; }
    let used = false;
    const step = ml(K.AIM_STEP, w.dt);
    if (held & B.DOWN) {
      rec.rx = F(rec.rx - step);       // the euler angles are single floats in the record
      if (rec.rx < K.PITCH_MIN) rec.rx = K.PITCH_MIN;
      st.sound.play('tilt'); used = true;
    } else if (held & B.UP) {
      rec.rx = F(rec.rx + step);
      if (!(rec.rx <= K.PITCH_MAX)) rec.rx = K.PITCH_MAX;
      st.sound.play('tilt'); used = true;
    }
    if (!(held & B.RIGHT)) {
      if (held & B.LEFT) { st.sound.play('swivel'); used = true; rec.ry = F(rec.ry + step); }
    } else { st.sound.play('swivel'); used = true; rec.ry = F(rec.ry - step); }
    if (!used) { st.sound.stop('swivel'); st.sound.stop('tilt'); }
    // the gauge shows the reload
    st.hud.min = 0; st.hud.max = K.GAUGE_RELOAD; st.hud.value = c.timer;
    if (c.timer <= 0) {
      if (!st.bell) { st.sound.play('ready'); st.bell = true; }
      st.hud.icon = (st.ticks & 0x10) === 0 ? 7 : 5;
    } else { st.bell = false; st.hud.icon = 4; st.sound.play('reload'); }
    rec.setEuler(-rec.rx, -rec.ry, 0, rec.x, rec.y, rec.z);
    const eye = toWorld24(rec.m, K.AIM_EYE), target = toWorld24(rec.m, K.AIM_TARGET);
    const cam = w.camera.c;
    cam[0] = eye[0]; cam[1] = eye[1]; cam[2] = eye[2]; cam[3] = target[0]; cam[4] = target[1]; cam[5] = target[2];
    if (st.aimTicks++ === 0) w.camera.savePrev();      // the jump into the barrel is not interpolated
    // the last ball fired: did it destroy an enemy cannon (that is still shown)?
    const ball = st.curBall >= 0 ? st.balls[st.curBall] : null;
    if (ball && ball.hit) {
      const k = st.enemy.findIndex((e) => e === ball.hit);
      if (k >= 0 && (st.enemy[k].flags & RF_ENABLED)) {
        const e = st.enemy[k];
        st.sound.at('cedHit', [e.x, e.y, e.z]);
        st.sound.at(Math.trunc(st.rand(100)) < 50 ? 'lose2' : 'lose1', [st.cedric.x, st.cedric.y, st.cedric.z]);
        w.vars.set(VAR.ENEMY_CANNON_BIT, 1 << k);
        e.flags &= ~RF_ENABLED;
        st.cannonsLeft--;
        st.score += 500;
        releaseBall(ball);
      }
    }
    if (st.resultMode === 1) this.leaveCannon();
  }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    const st = this.st;
    st.bind(w);
    st.modePrev = st.modeNow;
    st.modeNow = w.vars.get(VAR.MODE);
    for (const c of st.cannons) { const t = sb(c.timer, ml(1, w.dt)); c.timer = t <= 0 ? 0 : t; }     // `timer - 1.0 * DAT_008b1718 <= 0 ? 0 : timer - 1.0 * DAT_008b1718`
    switch (st.modeNow) {
      case MODE.HIT:
        if (st.modePrev === MODE.CANNON) { this.leaveCannon(); this.cannonLost(); }
        break;
      case MODE.CANNON:
        this.aim(w);
        break;
      case MODE.DEAD: case MODE.UNUSED:
        break;
      default: {
        if (st.phase >= 0) {
          if (st.phase < 2) {
            if (rec.x < st.bridge[0]) st.phase = PHASE.CROSSED;
          } else if (st.phase === PHASE.CANNONS && (w.input.pressed & B.CTRL)) {
            const k = this.nearestCannon();
            st.selected = k;
            if (k >= 0) {
              st.camBackup.set(w.camera.c);
              st.pepperCannon = k;
              st.aimTicks = 0;
              st.setMode(MODE.CANNON);
            }
          }
        }
        if (rec.y < 0) rec.m[13] = 0;
        if (st.modeNow === MODE.WALK && rec.y < K.FALL_Y) {
          // in the water: back on the bridge, the camera moves along (eye = old offset + the bridge point)
          const c = w.camera.c;
          const ex = ad(sb(c[0], c[3]), st.bridge[0]), ey = ad(sb(c[1], c[4]), st.bridge[1]), ez = ad(sb(c[2], c[5]), st.bridge[2]);
          rec.setEuler(0, 0, 0, st.bridge[0], st.bridge[1], st.bridge[2]);
          c[3] = st.bridge[0]; c[4] = st.bridge[1]; c[5] = st.bridge[2];
          c[0] = ex; c[1] = ey; c[2] = ez;
          rec.savePrev();
          w.camera.savePrev();
        }
      }
    }
    return NODE_CONTINUE;
  }

  /** FUN_0042d4b1 (the camera of sub-game 9, called at the end of the walk update): eye and target move with Pepper's step */
  prerender(w: World, _rec: GameRecord, ctrl: Controller): void {
    const walk = ctrl.find<WalkNode>('SGwalk');
    if (!walk || !ctrl.ran[ctrl.nodes.indexOf(walk)]) return;
    const c = w.camera.c, dx = ml(walk.vx, w.dt), dz = ml(walk.vz, w.dt);          // `vx * DAT_008b1718 + c[k]`, float32 steps
    c[3] = ad(dx, c[3]); c[5] = ad(dz, c[5]); c[0] = ad(dx, c[0]); c[2] = ad(dz, c[2]);
  }

  destroy(): void { /* FUN_005f53ff frees the node */ }
}

/** DAT_0090bb84: the scale of the launch vector of the player's shot, 8 for the first of a run of the program and 6 afterwards (it is never reset) */
export const shotScale = { value: K.SHOT_SCALE_FIRST as number };

/** "PeppHit": the player was hit by a ball (the mode word is 2) */
export class PeppHitNode implements BehaviourNode {
  readonly kind = 'PeppHit';
  var: number = VAR.MODE; mask = 2; value = 2;
  stamp = 0xfffffffe;
  private st: RgbState;
  /** +0x18: 0 flying / bouncing, 1 lying, 2 waiting for the clip to end, 3 getting up */
  state = 0;
  /** +0x1c: the tick the state was entered (0 = not started) */
  ts = 0;
  /** +0x20 / +0x24 / +0x28: the velocity (x and z stay 0: the vector the ball stores for it is never read) */
  vx = 0; vy = 0; vz = 0;
  /** the position of the last safe tick (port only: a hit over the water has no ground below, the original would fall for ever) */
  constructor(st: RgbState) { this.st = st; }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    const st = this.st;
    st.bind(w);
    switch (this.state) {
      case 0: this.fly(w, rec); break;
      case 1:
        if (this.ts + K.HIT_WAIT < st.ticks) this.state = 2;
        break;
      case 2: {
        const a = rec.anim;
        if (a && clipEnding({ frame: a.frame, frameCount: a.frameCount }, K.HIT_CLIP_END, w.dt)) {
          a.start(CLIP.IDLE, 0);
          this.state = 3;
          this.ts = st.ticks;
        }
        break;
      }
      case 3:
        st.setMode(MODE.WALK);
        w.pep.mailbox = ST.IDLE;
        this.state = 0;
        this.ts = 0;
        break;
    }
    rec.anim?.advance(1.0, w.dt);
    return NODE_CONTINUE;
  }

  /** FUN_00618360: the jump has no dt factor in the original (gravity, bounce and the camera step are per update, i.e. per drawn frame) */
  private fly(w: World, rec: GameRecord): void {
    const st = this.st, c = w.camera.c;
    if (st.vulnerable) rec.anim?.start(CLIP.HIT_FLY, 0);
    if (this.ts === 0) {
      st.vulnerable = false;
      this.vy = K.HIT_VY;
      this.ts = st.ticks;
    }
    c[0] += this.vx; c[2] += this.vz;
    const raw = w.col.terrainHeight(rec.x, rec.y, rec.z, 4), ground = Math.fround(raw);   // the original compares single floats
    if (ground < rec.y) this.vy = F(this.vy - K.HIT_G);
    else {
      rec.m[13] = ground;
      this.vy = F(this.vy * K.HIT_BOUNCE);
      this.vz = F(this.vz * 0.5);
      if (Math.abs(this.vy) < K.HIT_REST) {
        this.vy = 0; this.vz = 0;
        rec.anim?.start(CLIP.HIT_LAND, 0);
        st.sound.play('explode2d');
        if (!st.saidFirstHit) { st.say('CASGRB06'); st.saidFirstHit = true; }
        this.ts = st.ticks;
        this.state = 1;
      }
    }
    if (raw === NO_GROUND && rec.y < -40) {
      // port only: nothing below Pepper (a hit over the water): the original keeps falling; put him on the bridge and get up
      const ex = c[0] - c[3], ey = c[1] - c[4], ez = c[2] - c[5];
      rec.setEuler(0, 0, 0, st.bridge[0], st.bridge[1], st.bridge[2]);
      c[3] = st.bridge[0]; c[4] = st.bridge[1]; c[5] = st.bridge[2];
      c[0] = c[3] + ex; c[1] = c[4] + ey; c[2] = c[5] + ez;
      rec.savePrev(); w.camera.savePrev();
      this.vy = 0; this.vz = 0; this.state = 3; this.ts = st.ticks;
    } else { rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x + this.vx, rec.y + this.vy, rec.z + this.vz); c[3] = rec.x; c[5] = rec.z; }
  }
}

