// Pepper in the tomb (`Walk.c`, constructor FUN_006a81f6, update FUN_006a4fd0, footsteps FUN_006a7f37): digital walking relative to the camera, being caught by the
// mummies (danger meter), knocking on a coffin lid, taking the page, the run from the rolling boulder and the way out through the gate. Ported function by function
// (docs/re/m6/z18MMP.md); the node's fields keep the offsets of the original (`+0x18` ...).
import { NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Hit } from '../../game/collision.ts';
import { B } from '../../game/input.ts';
import { REC, VAR, BIT, CLIP, CAT_CLIP, PS, SND, MUSIC, K } from './consts.ts';
import { MmpShared, normalise, shown } from './shared.ts';

/** FUN_006ac310(n) -> the coffin index n of a one-bit mask (0..11), -1 for anything else (FUN_006ac699 / FUN_006ac3bb / FUN_006ac52a return 0 for those) */
export function coffinOfMask(mask: number): number {
  for (let n = 0; n < 12; n++) if (mask === (1 << n)) return n;
  return -1;
}

/** the value of an uninitialised float of the debug heap (0xcccccccc): the speed of the animation categories in states that skip the speed computation */
const HEAP_FILL = -107374176;
/** the original keeps positions, velocities and the sweep arguments in float32 locals: every store rounds */
const F = Math.fround;

/** the anim "ended soon" test FUN_0043b92a(anim, rate) */
export function endedSoon(anim: { frameCount: number; frame: number }, rate: number, dt = 1): boolean { return anim.frameCount < rate * dt + 1.0 + anim.frame; }

export class PepperNode implements BehaviourNode {
  readonly kind = 'mmpWalk';
  var = 2; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly sh: MmpShared;
  /** +0x18: the animation category (0 idle, 1 sneak, 2 walk, 3 run, 5 leap), +0x19: the one playing (0x3a right after a state change), +0x1a: hold counter */
  cur = 0; playing = 0; hold = 0;
  /** +0x1c / +0x20 / +0x24: velocity */
  vx = 0; vy = 0; vz = 0;
  /** +0x28: the state (PS) */
  state: number = PS.FREE;
  /** +0x2c: the coffin bit being approached, +0x30: the mummy that hit Pepper, +0x34: the symbol of the coffin */
  coffinBit = 0; hitRec: GameRecord | null = null; symRec: GameRecord | null = null;
  /** +0x3c: the pre-puzzle music was started */
  preMusic = false;
  ticks = 0;

  constructor(sh: MmpShared) { this.sh = sh; }

  /** the constructor FUN_006a81f6: the idle clip, all state cleared, the danger meter 0, the clock running */
  init(rec: GameRecord) {
    rec.anim?.start(CLIP.IDLE, 0);
    this.cur = 0; this.playing = 0; this.hold = 0;
    this.vx = this.vy = this.vz = 0;
    this.state = PS.FREE; this.coffinBit = 0; this.hitRec = null; this.symRec = null; this.preMusic = false;
    this.sh.stepWrap = false; this.sh.stopClock = false; this.sh.danger = 0;
    this.sh.pepper = this;
  }

  /** the start of a clip by its category (the switch at the end of the update) */
  private startCategory(anim: NonNullable<GameRecord['anim']>) {
    const clip = CAT_CLIP[this.cur];
    if (clip !== undefined) { anim.start(clip, 0); this.playing = this.cur; }
  }

  update(w: World, rec: GameRecord): number {
    const sh = this.sh, vars = w.vars, rs = sh.records, dt = w.dt, snd = sh.sounds;
    const anim = rec.anim!;
    this.ticks++;
    snd.play3D('waterA', SND.WATER, { x: 0, y: 0, z: 25 });
    snd.play3D('waterB', SND.WATER, { x: 0, y: 0, z: 180 });
    let x = rec.x, y = rec.y, z = rec.z;
    const fwd = normalise([rec.m[8], 0, rec.m[10]]);
    const right = normalise([rec.m[0], 0, rec.m[2]]);
    if (z >= 50 && !this.preMusic) { snd.music(MUSIC.PRE); this.preMusic = true; }
    // the keys: left / right / up / down (DAT_00983848 = the held buttons), rotated by the camera's axes
    const held = w.input.held;
    let lr = 0, ud = 0;
    if (held & B.LEFT) lr = -1; else if (held & B.RIGHT) lr = 1;
    if (held & B.UP) ud = -1; else if (held & B.DOWN) ud = 1;
    const cam = w.camera.c;
    const cr = normalise([cam[9], 0, cam[11]]);
    let mx = lr * cr[0], mz = lr * cr[2];
    const cf = normalise([cam[15], 0, cam[17]]);
    mx += -ud * cf[0]; mz += -ud * cf[2];
    if (K.STICK_Z_FROM < z) { if (x < -K.STICK_X_LIMIT) x = -K.STICK_X_LIMIT; if (K.STICK_X_LIMIT < x) x = K.STICK_X_LIMIT; }
    if (this.state === PS.FREE && (vars.get(VAR.OPEN) & BIT.CHASE) !== 0) this.state = PS.CHASE;
    if (this.state !== PS.TO_PEDESTAL && this.state !== PS.TAKE_PAGE && (vars.get(VAR.READY) & BIT.PAGE) !== 0 && (vars.get(VAR.MATCHED) & BIT.PAGE) === 0) {
      // the page was touched: walk to the pedestal (the camera stands still: READY 0x4000), Pepper speaks and the Queen of the mummies curses
      this.state = PS.TO_PEDESTAL;
      vars.or(VAR.READY, BIT.CHASE);
      snd.say('ADSGMM02', 'ADSGMM13');
    }
    // dir = (local_14, local_c): the direction Pepper turns to; speedHeap: the animation speed's input in states that do not compute it
    let dirx = HEAP_FILL, diry = HEAP_FILL, dirz = HEAP_FILL;      // (the original's locals start as the debug heap's 0xcccccccc fill: the states that rotate without setting a direction use it)
    let speed = HEAP_FILL;
    let teleported = false;

    // ---- contact with a mummy: the three roaming ones always, the ones of the coffins while one stands (clip 0x5a, shown)
    const S0 = this.state;
    if (S0 !== PS.HIT && S0 !== PS.SQUASHED && S0 !== PS.BUMP && S0 !== PS.RESTART) {
      let best: GameRecord | null = null, bestKind = 0, bestD = K.HIT_RADIUS;
      const test = (r: GameRecord, kind: number, needStanding: boolean) => {
        if (needStanding && !(shown(r) && r.anim?.clip === CLIP.M_STAND)) return;
        const ex = F(r.x - x), ey = F(r.y - y), ez = F(r.z - z);
        const d = F(Math.sqrt(ez * ez + ey * ey + ex * ex));
        if (d < bestD) { best = r; bestKind = kind; bestD = d; }
      };
      test(rs[REC.GUARD[0]], 1, false); test(rs[REC.GUARD[1]], 2, false); test(rs[REC.GUARD[2]], 3, false);
      test(rs[REC.MUMMY_OF[11]], 0, true);                    // 0x3190 (kind 0)
      for (let n = 3; n <= 10; n++) test(rs[REC.MUMMY_OF[n]], n + 1, true);   // 0x3330 .. 0x3608 (kinds 4..11)
      for (let n = 0; n <= 2; n++) test(rs[REC.MUMMY_OF[n]], n + 12, true);   // 0x3670 .. 0x3740 (kinds 12..14)
      if (best) {
        const r3 = sh.rng.int(3);      // RNG: the original draws ftol(FUN_004388ae(GetTickCount())) % 3 (wall clock)
        snd.play2D(SND.SQUEAL[r3]);
        const b = best as GameRecord;
        if (bestKind >= 1 && bestKind <= 3) snd.play3D(`groan${bestKind}`, SND.GROAN[bestKind - 1], { x: b.x, y: b.y, z: b.z });
        anim.start(CLIP.HIT, 0);
        this.state = PS.HIT; this.hitRec = b;
        sh.hit();
      }
    }

    // ---- Shift next to a coffin: knock on its lid
    if ((held & B.SHIFT) !== 0 && this.state === PS.FREE) {
      const c4 = vars.get(VAR.NEAR);
      const n = coffinOfMask(c4);
      if (n >= 0 && (vars.get(VAR.MATCHED) & c4) === 0 && (vars.get(VAR.OPEN) & c4) === 0) {
        this.coffinBit = c4;
        this.symRec = rs[REC.SYMBOL[n]];
        this.state = PS.TO_COFFIN;
      }
    }

    // ---- the state machine
    const approach = (sym: GameRecord, cs: GameRecord, ahead: number, stopDist: number): boolean => {
      // FUN_006a4fd0 states 1 / 3 / 5: walk to a point `ahead` along the case's forward axis, facing the symbol; true when there
      const dx = F(sym.x - x), dz = F(sym.z - z);
      const d = normalise([dx, 0, dz]); dirx = d[0]; diry = 0; dirz = d[2];
      const tx = F(cs.m[8] * ahead + sym.x), tz = F(cs.m[10] * ahead + sym.z);          // float32 locals (the sums of large coordinates: the rounding is visible in the direction)
      const mvx = F(tx - x), mvz = F(tz - z);
      const dist = F(Math.sqrt(mvz * mvz + mvx * mvx));
      const dot = F(fwd[2] * d[2] + fwd[0] * d[0]);       // (the dot product is with the NORMALISED direction to the symbol)
      if (stopDist <= dist || dot <= K.FACING) {
        const u = normalise([mvx, 0, mvz]);
        this.vx = F(u[0] * K.WALK_SPEED); this.vz = F(u[2] * K.WALK_SPEED);
        return false;
      }
      return true;
    };
    switch (this.state) {
      case PS.HIT: {
        if (anim.advance(2.5, dt) !== 0) { this.state = PS.FREE; anim.start(CLIP.IDLE, 0); this.cur = 0; this.playing = CLIP.IDLE; }
        const m = this.hitRec;
        if (!m) { this.state = PS.FREE; break; }
        const d = normalise([x - m.x, 0, z - m.z]);
        this.vx = F(d[0] * K.HIT_PUSH); this.vz = F(d[2] * K.HIT_PUSH);
        const dot = rec.m[10] * d[2] + rec.m[9] * 0 + rec.m[8] * d[0];
        const k = 0 <= dot ? K.HIT_PUSH : -K.HIT_PUSH;
        dirx = d[0] * k; dirz = d[2] * k;
        // (the original never sets the y of this direction: the debug heap's fill value, so the normalised direction points down and Pepper keeps turning, +-0.349 per tick)
        diry = HEAP_FILL;
        break;
      }
      case PS.TO_PEDESTAL: {
        const st = rs[REC.STAND];
        vars.or(VAR.MATCHED, BIT.CHASE);
        const dx = F(st.x - x), dz = F(st.z - z);
        const d = normalise([dx, 0, dz]); dirx = d[0]; diry = 0; dirz = d[2];
        const mvx = F(st.x - x), mvz = F(F(st.z - 8) - z);
        const dist = F(Math.sqrt(mvz * mvz + mvx * mvx));
        const dot = F(fwd[2] * d[2] + fwd[0] * d[0]);
        if (K.ARRIVE <= dist || dot <= K.FACING) {
          const u = normalise([mvx, 0, mvz]);
          this.vx = F(u[0] * K.WALK_SPEED); this.vz = F(u[2] * K.WALK_SPEED);
        } else {
          this.state = PS.TAKE_PAGE;
          anim.start(CLIP.PAGE_TAKE, 0);
          rs[REC.COLL[0]].flags &= ~2; rs[REC.COLL[1]].flags &= ~2;      // the two barriers open
        }
        break;
      }
      case PS.TAKE_PAGE: {
        const res = anim.advance(1.0, dt);
        if (Math.trunc(anim.frame) > 0x18) { rs[REC.PAGE].flags &= ~2; vars.or(VAR.MATCHED, BIT.PAGE); }   // the page is in the bag: hidden, taken
        if (res !== 0) { this.state = PS.TURN_BACK; anim.start(CLIP.PAGE_RETURN, 0); vars.andNot(VAR.READY, BIT.CHASE); snd.play2D(SND.GET_PAGE); }
        this.vx = 0; this.vy = 0; this.vz = 0;
        dirx = 0; diry = 0; dirz = 8;
        break;
      }
      case PS.TURN_BACK: {
        if (anim.advance(1.0, dt) !== 0) { vars.andNot(VAR.MATCHED, BIT.CHASE); this.state = PS.FREE; anim.start(CLIP.IDLE, 0); this.cur = 0; this.playing = CLIP.IDLE; }
        this.vx = 0; this.vy = 0; this.vz = K.TURN_BACK_VZ;
        dirx = 0; diry = 0; dirz = -8;
        break;
      }
      case PS.TO_COFFIN: {
        const n = coffinOfMask(this.coffinBit);
        const arrived = approach(this.symRec!, rs[REC.CASE[n]], 4, 0.8);
        if (arrived) {
          this.state = PS.KNOCK; this.playing = 4;
          anim.start(CLIP.KNOCK, 0);
          snd.play3D('knock', SND.KNOCK, { x: rec.x, y: rec.y, z: rec.z });
        }
        break;
      }
      case PS.KNOCK: {
        this.vx = 0; this.vz = 0;
        if (anim.advance(1.5, dt) !== 0) { vars.or(VAR.OPEN, this.coffinBit); this.state = PS.BACK_OFF; }
        break;
      }
      case PS.BACK_OFF: {
        const n = coffinOfMask(this.coffinBit);
        const arrived = approach(this.symRec!, rs[REC.CASE[n]], 8, 1.6);
        if (arrived) { this.state = PS.FREE; anim.start(CLIP.IDLE, 0); this.cur = 0; this.playing = CLIP.IDLE; }
        break;
      }
      case PS.SQUASHED: {
        if (anim.advance(1.0, dt) !== 0) this.state = PS.RESTART;
        break;
      }
      case PS.BUMP: {
        if (anim.advance(1.0, dt) !== 0) this.state = PS.RESTART;
        break;
      }
      case PS.RESTART: {
        // the boulder caught Pepper (or he hit a wall): back to the pedestal, the page already in the bag; the boulder and the pillars start over (MATCHED 0x4000)
        const st = rs[REC.STAND];
        x = st.x; y = st.y; z = st.z - 8;
        const h = w.col.sweep(rec, [x, y, z], [0, -40, 0], 3, 0.8, 4.8);
        if (h) y = F(h.point[1]);
        this.state = PS.TURN_BACK;
        anim.start(CLIP.PAGE_RETURN, 0);
        vars.or(VAR.MATCHED, BIT.CHASE);
        teleported = true;
        break;
      }
      case PS.CHASE: {
        this.vx = F(mx * K.WALK_SPEED);
        if (x < -K.STICK_X_LIMIT) x = -K.STICK_X_LIMIT;
        if (K.STICK_X_LIMIT < x) x = K.STICK_X_LIMIT;
        this.vz = K.CHASE_VZ;
        break;
      }
      default: {
        // PS.FREE: Pepper walks with the keys
        this.coffinBit = 0; this.symRec = null;
        this.vx = F(mx * K.WALK_SPEED); this.vz = F(mz * K.WALK_SPEED);
      }
    }

    // ---- the collapse: the boulder reaches Pepper, the walls of the corridor, the gate at the end
    if ((vars.get(VAR.OPEN) & BIT.CHASE) !== 0 && this.state !== PS.SQUASHED && this.state !== PS.RESTART) {
      const rock = rs[REC.ROCK];
      if (Math.abs(rock.z - z) < K.ROCK_NEAR && !sh.stopClock) {
        this.state = PS.SQUASHED;
        this.vx = 0; this.vy = 0; this.vz = 0;
        anim.start(CLIP.SQUASH, 0);
        snd.say('ADSGMM14');
      }
      if (K.WALL_X <= Math.abs(x + this.vx)) {
        this.state = PS.BUMP;
        this.vx = 0;
        anim.start(CLIP.HIT, 0);
      }
      const gate = rs[REC.GATE];
      if (z < gate.z) {
        sh.stopClock = true;
        if (gate.y <= K.GATE_Y) {
          gate.y = K.GATE_Y;
          vars.or(VAR.MATCHED, BIT.CHASE);
          if (!shown(rec)) vars.or(VAR.NEAR, BIT.CHASE);       // the way out is shut behind Pepper: the tomb is escaped
        } else gate.y = F(gate.y - K.GATE_STEP * dt);
        if (z < gate.z + 8) {
          this.cur = 5;
          this.vx = 0; this.vy = 0; this.vz = 0;
          if (anim.clip === CLIP.LEAP && endedSoon(anim, 1.5, dt)) rec.flags &= ~2;
        }
      }
    }

    // ---- walls: a sweep along the velocity at 2.8 above the feet, slide along what it hits
    {
      const from = [x, F(y + K.SWEEP_Y), z];
      const delta = [F(this.vx * dt), 0, F(this.vz * dt)];
      const h = w.col.sweep(rec, from, delta, 3, 1.2, 1.2);
      if (h) {
        const n = h.normal;
        const dot = n[2] * this.vz + n[1] * 0 + n[0] * this.vx;
        this.vx = F(this.vx - n[0] * dot); this.vz = F(this.vz - n[2] * dot);
        const delta2 = [F(this.vx * dt), 0, F(this.vz * dt)];
        const h2 = w.col.sweep(rec, [x, F(y + K.SWEEP_Y), z], delta2, 3, 1.2, 1.2);
        if (h2) {
          this.vx = 0; this.vz = 0;
          if (dirz === -8) { this.state = PS.BUMP; anim.start(CLIP.HIT, 0); }       // only the walk back from the pedestal sets this direction
        }
      }
    }
    // ---- the floor: a sweep down from 2.8 above, gravity 0.08 per tick, the pit sends Pepper back up
    {
      const from = [x, F(y + K.SWEEP_Y), z];
      const delta = [0, F(this.vy * dt - K.SWEEP_Y), 0];
      if (y < K.RESPAWN_Y) { y = K.RESPAWN_TOP; x = 0; }
      let hit: Hit | null = null;
      if (!(0 < this.vy)) hit = w.col.sweep(rec, from, delta, 3, 0.8, 0);
      if (!hit) this.vy = F(this.vy - K.GRAVITY);
      else { y = F(hit.point[1]); this.vy = 0; }
    }

    // ---- what Pepper does with the state: which of move (1), turn (2), animate (4), pick the animation by speed (8)
    const S = this.state;
    let flags: number;
    switch (S) {
      case PS.TO_COFFIN: case PS.BACK_OFF: case PS.TO_PEDESTAL: flags = 0xf; break;
      case PS.KNOCK: case PS.SQUASHED: case PS.BUMP: case PS.RESTART: flags = 0; break;
      case PS.HIT: case PS.TAKE_PAGE: case PS.TURN_BACK: flags = 3; break;
      case PS.CHASE: flags = 0xd; break;
      default: flags = 0xf; dirx = this.vx; diry = 0; dirz = this.vz;
    }
    if ((flags & 8) !== 0) {
      if (this.hold > 0) this.hold--;
      speed = Math.hypot(this.vx, this.vz);
      if (this.cur !== 5) {
        if (speed <= K.SPEED_RUN) {
          if (speed <= K.SPEED_WALK) {
            if (speed <= K.SPEED_SNEAK) { if (this.cur !== 0) { this.cur = 0; this.hold = 2; } }
            else if (this.cur !== 1) { this.cur = 1; this.hold = 2; }
          } else if (this.cur !== 2) { this.cur = 2; this.hold = 0; }
        } else if (this.cur !== 3) { this.cur = 3; this.hold = 2; }
      }
      if (this.hold === 0 && this.playing !== this.cur) this.startCategory(anim);
    }
    let rate: number;
    switch (this.playing) {
      case 0: rate = 0; break;
      case 1: rate = speed * K.RATE * 40; break;
      case 2: rate = speed * K.RATE * 35; break;
      case 3: rate = speed * K.RATE * 17; break;
      case 4: rate = 1.5; break;
      case 5: rate = shown(rec) ? 1.5 : 0; break;
      default: rate = 1.0;
    }
    if ((flags & 1) !== 0 && this.cur !== 0) { x = F(x + this.vx * dt); y = F(y + this.vy * dt); z = F(z + this.vz * dt); }
    if ((flags & 2) !== 0 && this.cur !== 0 && (dirx !== 0 || dirz !== 0)) {
      const d = normalise([dirx, diry, dirz]);
      if (fwd[2] * d[2] + fwd[0] * d[0] <= K.TURN_SNAP) {
        if (right[2] * d[2] + right[0] * d[0] <= 0) rec.ry = F(rec.ry - K.TURN_STEP * dt); else rec.ry = F(rec.ry + K.TURN_STEP * dt);
      } else rec.ry = F(Math.atan2(d[0], d[2]));
    }
    if ((flags & 4) !== 0 && rate > 0) {
      sh.stepWrap = anim.advance(rate, dt) !== 0;
      this.footsteps(rec, rec.z);       // (FUN_006a7f37 reads the RECORD's z (DAT_00983804 + 0x316c), which the update only writes at its end: the position of the tick before)
    }
    rec.setEuler(0, rec.ry, 0, x, y, z);
    if (teleported) rec.savePrev();       // (port) a jump, not a move: no render interpolation across it
    return NODE_STOP;
  }

  /** FUN_006a7f37: the step sound when the walk / run clip passes its step frames; floor steps, wooden ones on the two bridges (z 18..32, 173..188) */
  private footsteps(rec: GameRecord, z: number) {
    const sh = this.sh, anim = rec.anim!;
    const frame = Math.trunc(anim.frame), clip = anim.clip;
    let fire = false;
    if (clip === CLIP.SNEAK || clip === CLIP.WALK) {
      if (sh.stepPhase === 0) { sh.stepWrap = false; fire = frame > 6; if (fire) sh.stepPhase = 1; }
      else if (sh.stepPhase === 1) { fire = frame > 0x13; if (fire) sh.stepPhase = 2; }
      else if (sh.stepPhase === 2 && sh.stepWrap) sh.stepPhase = 0;
    } else if (clip === CLIP.RUN) {
      if (sh.stepPhase === 0) { sh.stepWrap = false; fire = frame > 4; if (fire) sh.stepPhase = 1; }
      else if (sh.stepPhase === 1) { fire = frame > 0xe; if (fire) sh.stepPhase = 2; }
      else if (sh.stepPhase === 2 && sh.stepWrap) sh.stepPhase = 0;
    }
    if (fire) {
      const bridge = (18 < z && z < 32) || (173 < z && z < 188);
      sh.sounds.play2D((bridge ? SND.STEP_BRIDGE : SND.STEP_FLOOR)[sh.stepRr]);
      sh.stepRr = (sh.stepRr + 1) & 3;
    }
  }
}
