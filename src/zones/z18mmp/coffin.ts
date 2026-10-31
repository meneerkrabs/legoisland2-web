// The memory game: the 12 symbols in the coffins (constructor FUN_006abf47, update FUN_006aadf6). Pepper knocks on a lid (VAR OPEN), the lid swings open and the symbol
// rises; the second coffin of a pair decides: the same symbol = the pair stays (the two symbols float to the key's place), another one = both close again after 20 ticks.
// Every coffin's node also runs the animation loop of all twelve mummies (FUN_006aadf6 does it at its end), so each mummy is stepped 12 times a tick.
import { NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { GATE_OFF, NO_HANDLE } from '../../fx/particles/zone.ts';
import type { ZoneParticles } from '../../fx/particles/zone.ts';
import { REC, VAR, BIT, CLIP, SND, MUSIC, K, f32 } from './consts.ts';
import { MmpShared } from './shared.ts';
import { coffinOfMask } from './pepper.ts';
import { ad, sb, ml } from '../common/f32.ts';

/** the states of a coffin (node +0x22) */
export const CS = { IDLE: 0, OPENING: 1, OPEN: 3, WRONG: 5, CLOSING: 6, MATCHED: 7 } as const;

export class CoffinNode implements BehaviourNode {
  readonly kind = 'mmpCoffin';
  var = 2; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly sh: MmpShared;
  /** +0x18: the coffin's bit (1 << n), +0x1c: the bit of its partner (0 = this is the first of a pair), +0x20: n, +0x21: tick counter, +0x22: state, +0x24: squared distance to Pepper */
  bit: number; partner = 0; n: number; counter = 0; state: number = CS.IDLE; dist = 0;
  ticks = 0;
  /** +0x34: symtwin.par on the symbol, +0x38 / +0x3c: the two mummy02 smoke emitters (FUN_006abf47) */
  fxTwin: number = NO_HANDLE; fxSmoke: [number, number] = [NO_HANDLE, NO_HANDLE];

  constructor(sh: MmpShared, n: number) { this.sh = sh; this.n = n; this.bit = 1 << n; }

  /** the constructor FUN_006abf47: the coffin's lid faces the way its case does */
  init(world: { records: readonly GameRecord[] }) {
    const cs = world.records[REC.CASE[this.n]], coff = world.records[REC.COFFIN[this.n]];
    coff.rx = 0; coff.rz = 0;
    coff.ry = f32(Math.atan2(cs.m[8], cs.m[10]));
    this.partner = 0; this.state = CS.IDLE; this.counter = 0;
  }

  /**
   * The constructor's emitters (FUN_006abf47, symbol record = `rec`): symtwin.par (rotation 0) and two mummy02 (rotation -pi/2 about x) on the symbol's matrix, all gate off; the smoke bounces off the
   * BONE record (FUN_00442a50(handle, record 117)); then FUN_0044ea60(handle, 1, 1, 1) once more for each.
   */
  startFx(fx: ZoneParticles, rec: GameRecord, world: { records: readonly GameRecord[] }) {
    this.fxTwin = fx.start('symtwin.par', rec.m, [0, 0, 0], [0, 0, 0], GATE_OFF);
    this.fxSmoke = [fx.start('mummy02', rec.m, [0, 0, 0], [-Math.PI / 2, 0, 0], GATE_OFF), fx.start('mummy02', rec.m, [0, 0, 0], [-Math.PI / 2, 0, 0], GATE_OFF)];
    fx.collideWith(this.fxSmoke[0], world.records[REC.BONE]);
    fx.collideWith(this.fxSmoke[1], world.records[REC.BONE]);
    fx.off(this.fxTwin); fx.off(this.fxSmoke[0]); fx.off(this.fxSmoke[1]);
  }

  /** FUN_006aadb0: the lid's knock-open sound: the second handle when the first one still plays */
  private openSound(p: { x: number; y: number; z: number }) {
    const s = this.sh.sounds;
    if (!s.idle3D('coffinOpenA')) s.play3D('coffinOpenB', SND.COFFIN_OPEN, p); else s.play3D('coffinOpenA', SND.COFFIN_OPEN, p);
  }
  /** FUN_006aad6a: the rotating symbol's loop: while the first handle is busy it is refreshed, otherwise the second one plays */
  private spinSound(p: { x: number; y: number; z: number }) {
    const s = this.sh.sounds;
    if (!s.idle3D('symSpinA')) s.play3D('symSpinA', SND.SYMBOL_SPIN, p); else s.play3D('symSpinB', SND.SYMBOL_SPIN, p);
  }
  private stopSpin() { this.sh.sounds.stop3D('symSpinA'); this.sh.sounds.stop3D('symSpinB'); }

  update(w: World, rec: GameRecord): number {
    const sh = this.sh, vars = w.vars, rs = sh.records, snd = sh.sounds, dt = w.dt;
    const n = this.n, bit = this.bit;
    const coff = rs[REC.COFFIN[n]], mummy = rs[REC.MUMMY_OF[n]];
    this.ticks++;
    let x = rec.x, y = rec.y, z = rec.z;
    this.dist = rec.ctrl?.distSq ?? 0;
    if (K.OPEN_REACH <= this.dist) vars.andNot(VAR.NEAR, bit); else vars.or(VAR.NEAR, bit);
    const coffAt = () => ({ x: coff.x, y: coff.y, z: coff.z });

    switch (this.state) {
      case CS.IDLE: {
        if ((vars.get(VAR.OPEN) & bit) !== 0) {
          const t = vars.get(VAR.PENDING) & BIT.ALL;
          if (t === 0) { this.partner = 0; vars.set(VAR.PENDING, bit); } else { this.partner = t; vars.set(VAR.PENDING, 0); }
          this.state = CS.OPENING; this.counter = K.OPEN_TICKS;
          rec.flags |= 2;
          this.openSound(coffAt());
          mummy.flags |= 2; sh.track[n] = 1;
        }
        break;
      }
      case CS.OPENING: {
        if (sh.puzzleMusicArmed) { snd.music(MUSIC.PUZZLE); sh.puzzleMusicArmed = false; }
        coff.ry = sb(coff.ry, K.LID_TURN);
        coff.setEuler(0, coff.ry, 0, coff.x, coff.y, coff.z);
        this.spinSound(coffAt());
        y = ad(ml(K.SYMBOL_RISE, dt), y);
        if (--this.counter === 0) { vars.or(VAR.READY, bit); this.state = CS.OPEN; sh.track[n] = 1; }
        break;
      }
      case CS.OPEN: {
        if (this.partner === 0) {
          if ((vars.get(VAR.MATCHED) & bit) === 0) {
            if ((vars.get(VAR.READY) & bit) === 0) { this.counter = K.WRONG_TICKS; this.state = CS.WRONG; }
          } else { snd.play2D(SND.MATCH_OK); this.state = CS.MATCHED; }
        } else if ((vars.get(VAR.READY) & this.partner) !== 0) {
          const other = rs[REC.SYMBOL[coffinOfMask(this.partner)]];
          if (rec.name === other.name) {
            const laugh = SND.LAUGH[rec.name];
            if (laugh !== undefined) snd.play3D(`laugh${rec.name}`, laugh, { x: rec.x, y: rec.y, z: rec.z });
            snd.play2D(SND.MATCH_OK);
            this.state = CS.MATCHED;
            vars.or(VAR.MATCHED, bit); vars.or(VAR.MATCHED, this.partner);
          } else {
            this.counter = K.WRONG_TICKS; this.state = CS.WRONG;
            snd.play2D(SND.MATCH_FAIL);
          }
          vars.andNot(VAR.READY, bit); vars.andNot(VAR.READY, this.partner);
        }
        break;
      }
      case CS.WRONG: {
        if (--this.counter === 0) {
          this.counter = K.OPEN_TICKS; this.state = CS.CLOSING;
          snd.play3D('coffinClose', SND.COFFIN_CLOSE, coffAt());
          mummy.anim?.start(CLIP.M_OUT, 0);
          sh.track[n] = 3;
        }
        break;
      }
      case CS.CLOSING: {
        coff.ry = ad(coff.ry, K.LID_TURN);
        coff.setEuler(0, coff.ry, 0, coff.x, coff.y, coff.z);
        y = sb(y, ml(K.SYMBOL_RISE, dt));
        if (--this.counter === 0) {
          vars.andNot(VAR.OPEN, bit);
          this.state = CS.IDLE;
          y = K.SYMBOL_REST_Y;
          mummy.flags &= ~2;
          this.stopSpin();
        }
        break;
      }
      case CS.MATCHED: {
        // the symbol floats to the key's place (0.4 per tick per axis), the pair is done when both arrived
        const key = rs[REC.KEY];
        let arrived = 0;
        // (FUN_006aadf6 state 7: float32 differences, the step 0x892118 = 0.4 times dt, the lower limit 0x892720)
        const dzk = sb(z, key.z), dxk = sb(x, key.x);
        if (dzk <= K.MATCH_STEP) { if (K.MATCH_LOW <= dzk) arrived = 1; else z = ad(ml(K.MATCH_STEP, dt), z); } else z = sb(z, ml(K.MATCH_STEP, dt));
        if (dxk <= K.MATCH_STEP) { if (K.MATCH_LOW <= dxk) arrived += 1; else x = ad(ml(K.MATCH_STEP, dt), x); } else x = sb(x, ml(K.MATCH_STEP, dt));
        if (this.partner === 0) {
          if ((vars.get(VAR.OPEN) & bit) === 0) {
            mummy.anim?.start(CLIP.M_GONE, 0); sh.track[n] = 4; this.state = CS.IDLE;
          } else if (arrived === 2) vars.or(VAR.READY, bit); else vars.andNot(VAR.READY, bit);
        } else if (arrived === 2 && (vars.get(VAR.READY) & this.partner) !== 0) {
          this.state = CS.IDLE;
          mummy.anim?.start(CLIP.M_GONE, 0); sh.track[n] = 4;
          vars.andNot(VAR.OPEN, bit); vars.andNot(VAR.OPEN, this.partner);
          vars.or(VAR.PENDING, BIT.KEY);
          this.stopSpin();
          snd.play2D(SND.MELD);
        }
        break;
      }
    }
    rec.ry = ad(ml(K.SPIN, dt), rec.ry);
    const fx = sh.fx;
    if (fx) { if (this.state === CS.IDLE) fx.off(this.fxTwin); else fx.on(this.fxTwin); fx.setMatrix(this.fxTwin, rec.m); }
    this.trackMummies(w);
    rec.setEuler(rec.rx, rec.ry, rec.rz, x, y, z);
    return NODE_STOP;
  }

  /** the end of FUN_006aadf6: the animation phases of the twelve mummies */
  private trackMummies(w: World) {
    const sh = this.sh, rs = sh.records, dt = w.dt, track = sh.track;
    for (let i = 0; i < 12; i++) {
      const m = rs[REC.MUMMY_OF[i]], ma = m.anim;
      if (!ma) continue;
      switch (track[i]) {
        case 1: if (ma.advance(0.1, dt) !== 0) { ma.start(CLIP.M_RISE, 0); track[i] = 2; } break;
        case 2: ma.advance(0.1, dt); break;
        case 3: if (ma.advance(0.1, dt) !== 0) { ma.start(CLIP.M_SLEEP, 0); track[i] = 0; m.flags &= ~2; } break;
        case 4: {
          const r = ma.advance(0.1, dt);
          const f = Math.trunc(ma.frame);
          const s = ml(K.MUMMY_LEAVE, dt);
          m.m[12] = ad(m.m[12], ml(s, m.m[8])); m.m[13] = ad(m.m[13], ml(s, m.m[9])); m.m[14] = ad(m.m[14], ml(s, m.m[10]));
          if (r !== 0 || f > 0x1e) {
            ma.start(CLIP.M_STAND, 0);
            if (sh.fx) { sh.fx.on(this.fxTwin); sh.fx.on(this.fxSmoke[0]); sh.fx.on(this.fxSmoke[1]); }     // the puff of smoke (this node's emitters)
            sh.poof = 90;
            track[i] = 5;
            sh.sounds.play3D('bones', SND.BONES, { x: m.x, y: m.y, z: m.z });
          }
          break;
        }
        case 5: {
          // the mummies in the puff of smoke: gone at once, the timer counts the smoke down (two puffs at most)
          let k = 0;
          for (let j = 0; j < 12; j++) {
            if (track[j] !== 5) continue;
            const mj = rs[REC.MUMMY_OF[j]];
            mj.flags &= ~2;
            sh.fx?.setMatrix(this.fxSmoke[k], mj.m);
            sh.fx?.setMatrix(this.fxSmoke[k], mj.m);
            k++;
            sh.poof = sb(sh.poof, ml(1.0, dt));
            if (sh.poof < 45) mj.flags &= ~2;
            if (sh.poof < 0) { track[j] = 6; sh.fx?.off(this.fxSmoke[0]); sh.fx?.off(this.fxSmoke[1]); }
            if (k === 2) j = 12;
          }
          break;
        }
      }
    }
  }
}
