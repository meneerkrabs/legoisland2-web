// The other behaviour nodes of the tomb: camera (FUN_006ac844 in the draw hook), roaming mummies (FUN_006aa600), key (FUN_006aa070), page (FUN_006a9cc0), rolling boulder
// (FUN_006a9930), falling pillars (FUN_006a95d5), falling stones (FUN_006a9280), torches (FUN_006a8cf0), spiders (FUN_006a8a40) and rats (FUN_006a8350).
import { NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { GATE_OFF, GATE_ON, NO_HANDLE } from '../../fx/particles/zone.ts';
import type { ZoneParticles } from '../../fx/particles/zone.ts';
import { armControllerProbe } from '../../game/probehost.ts';
import { REC, VAR, BIT, CLIP, SND, MUSIC, f32 } from './consts.ts';
import { MmpShared, normalise, shown } from './shared.ts';
import { ad, sb, ml, sq } from '../common/f32.ts';
import { eulerRotation } from '../exact.ts';

const fl = (u: number) => new Float32Array(new Uint32Array([u]).buffer)[0];

/** constants of these nodes (the `.rdata` floats / immediates of the functions named in the comments) */
export const PK = {
  // camera FUN_006ac844
  CAM_UP: f32(4.8), CAM_Y: f32(8), CAM_BACK: f32(12), CAM_CHASE_UP: f32(4), CAM_CHASE_Y: f32(6.4), CAM_CHASE_BACK: f32(22.4), CAM_LIFT: f32(6), PIT_Z: f32(-28), PIT_LOOK: fl(0x414f8937), PIT_EYE: f32(2.4), SIDE: f32(4.4) /* 0x892804: `fcomp / fsub / fadd dword` */,
  // mummies
  MUMMY_Y: fl(0x4091eb85), MUMMY_SPEED: f32(0.072), MUMMY_TURN: f32(0.174532), MUMMY_NEAR: 8, MUMMY_ARRIVE: f32(2.88), MUMMY_FACING: f32(0.9), WANDER: 8, MUMMY_AWAY_Y: 800, MUMMY_AWAY_Z: -8000,
  // key
  KEY_DROP: f32(5.76), KEY_FALL: f32(0.24), KEY_SPIN: f32(0.087266), KEY_REACH: f32(1.6), DOOR_RISE: f32(0.08), DOOR_TOP: 14,
  // page
  PAGE_REACH: f32(2.4), TRAP_RISE: f32(0.32), TRAP_TOP: 42,
  // rock
  ROCK_SPEED: f32(0.85), ROCK_END_Z: f32(-22), ROCK_SPIN: f32(0.349064), ROCK_BOUNCE: fl(0x3e75c28f), ROCK_GRAVITY: f32(0.08), ROCK_SKIN: f32(4.8), ROCK_RADIUS: f32(0.8),
  // pillars
  PILLAR_AHEAD: 16, PILLAR_STEP: fl(0x3d567704), PILLAR_ANGLE: fl(0x3f80749f),      // (.rdata 0x892534 / 0x8927e4: the angle is 1.0035589933, one float32 step below f32(1.00356))
  // stones
  STONE_FALL: f32(2.4), STONE_BELOW: 40, STONE_ABOVE: 40, STONE_RANGE_Y: 80, STONE_RANGE_XZ: 64, STONE_HALF: 32, STONE_SPIN: fl(0x40c8809a),
  // spiders
  SPIDER_AHEAD: f32(20),
  // rats
  RAT_NEAR_SQ: f32(10.24), RAT_TURN: f32(0.087266), RAT_WALK: f32(0.12), RAT_RUN: f32(0.2),
  PI: fl(0x40490fdb), PI_NEG: fl(0xc0490fdb), TWO_PI: fl(0x40c90fdb),
} as const;

abstract class Node implements BehaviourNode {
  abstract readonly kind: string;
  var = 2; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly sh: MmpShared;
  constructor(sh: MmpShared) { this.sh = sh; }
  abstract update(w: World, rec: GameRecord, ctrl: Controller): number;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// camera

/** FUN_006aca97 (constructor) / FUN_006ac844 (the draw hook): the camera stands behind and above Pepper looking along the tomb; during the collapse it hangs further back */
export class CameraNode extends Node {
  readonly kind = 'mmpCamera';
  /** the constructor: eye 8 above and 12 behind Pepper, looking at 4.8 above him */
  init(w: World, pep: GameRecord) {
    const c = w.camera.c;
    c[0] = 0; c[1] = pep.y + PK.CAM_Y; c[2] = pep.z - PK.CAM_BACK;
    c[3] = 0; c[4] = pep.y + PK.CAM_UP; c[5] = pep.z;
    c[6] = 0; c[7] = 1; c[8] = 0;
    w.camera.updateView(); w.camera.savePrev();
  }
  update(): number { return NODE_STOP; }
  prerender(w: World) { this.place(w); }
  place(w: World) {
    const pep = w.records[REC.PEPPER], c = w.camera.c, vars = w.vars;
    const px = pep.x, py = pep.y, pz = pep.z;
    // (the camera's eye / target are float32 in the original: every store rounds, the port's camera array holds doubles)
    if ((vars.get(VAR.READY) & BIT.CHASE) === 0) {
      if ((vars.get(VAR.OPEN) & BIT.CHASE) === 0) { c[4] = ad(py, PK.CAM_UP); c[1] = ad(py, PK.CAM_Y); c[2] = sb(pz, PK.CAM_BACK); }
      else {
        c[4] = ad(py, PK.CAM_CHASE_UP); c[1] = ad(py, PK.CAM_CHASE_Y); c[2] = sb(pz, PK.CAM_CHASE_BACK);
        if (c[2] < 50 && 27 < c[2]) c[1] = ad(c[1], PK.CAM_LIFT);
        if (pz < PK.PIT_Z) { c[4] = PK.PIT_LOOK; c[1] = ad(c[4], PK.PIT_EYE); }
      }
      const ax = Math.abs(px);
      c[3] = ax >= PK.SIDE ? (px <= 0 ? ad(px, PK.SIDE) : sb(px, PK.SIDE)) : 0;
      c[5] = pz;
      c[0] = 0;
    } else { c[0] = 0; c[3] = 0; }
    w.camera.updateView();
    const p = w.camera.prev;
    if (Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) > 20) w.camera.savePrev();      // (port) a cut (Pepper was put back at the pedestal): no interpolation across it
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// the three roaming mummies

/** FUN_006aaa86 (constructor: home = the LURK record's position, the mummy stands at y 4.56) / FUN_006aa600: wander around the home, chase Pepper when he comes within 8 */
export class MummyNode extends Node {
  readonly kind = 'mmpMummy';
  /** +0x18 / +0x1c / +0x20: home, +0x24 / +0x28 / +0x2c: the place it walks to */
  home = [0, 0, 0]; target = [0, 0, 0];
  init(rec: GameRecord, home: ArrayLike<number>) {
    for (let i = 0; i < 3; i++) { this.home[i] = home[i]; this.target[i] = home[i]; }
    this.home[1] = PK.MUMMY_Y;                      // (the constructor overwrites the home's y with 4.56 and puts the record there)
    rec.x = this.home[0]; rec.y = PK.MUMMY_Y; rec.z = this.home[2];
    rec.anim?.start(CLIP.M_STAND, 0);
  }
  update(w: World, rec: GameRecord): number {
    const rs = this.sh.records, pep = rs[REC.PEPPER], rng = this.sh.rng, dt = w.dt;
    let mx = rec.x, my = rec.y, mz = rec.z;
    if ((w.vars.get(VAR.OPEN) & BIT.CHASE) === 0) {
      // FUN_006aa600: every operation a float32 result (x87 at 24 bits), the sums of three terms added x, y, z (asm 0x6aa6a8 ..); the y of every direction is 0
      const hx = sb(pep.x, this.home[0]), hz = sb(pep.z, this.home[2]);
      let v: number[];
      if (PK.MUMMY_NEAR <= sq(ad(ml(hx, hx), ml(hz, hz)))) {
        const tx = sb(this.target[0], mx), tz = sb(this.target[2], mz);
        v = normalise([tx, 0, tz]); v[0] = ml(v[0], PK.MUMMY_SPEED); v[2] = ml(v[2], PK.MUMMY_SPEED);
        if (sq(ad(ml(tx, tx), ml(tz, tz))) < PK.MUMMY_ARRIVE) {
          this.target[0] = sb(ad(rng.float(PK.WANDER), this.home[0]), 4);
          this.target[2] = sb(ad(rng.float(PK.WANDER), this.home[2]), 4);
        }
      } else {
        v = normalise([sb(pep.x, mx), 0, sb(pep.z, mz)]); v[0] = ml(v[0], PK.MUMMY_SPEED); v[2] = ml(v[2], PK.MUMMY_SPEED);
      }
      const fwd = normalise([rec.m[8], 0, rec.m[10]]);
      const right = normalise([rec.m[0], 0, rec.m[2]]);
      if (v[0] !== 0 || v[2] !== 0) {
        const d = normalise([v[0], v[1], v[2]]);
        if (ad(ad(ml(fwd[0], d[0]), ml(fwd[1], d[1])), ml(fwd[2], d[2])) <= PK.MUMMY_FACING) {
          if (ad(ad(ml(right[0], d[0]), ml(right[1], d[1])), ml(right[2], d[2])) <= 0) rec.ry = sb(rec.ry, ml(PK.MUMMY_TURN, dt)); else rec.ry = ad(ml(PK.MUMMY_TURN, dt), rec.ry);
        }
      }
      mx = ad(ml(v[0], dt), mx); mz = ad(ml(v[2], dt), mz);
      const len = sq(ad(ad(ml(v[0], v[0]), ml(v[1], v[1])), ml(v[2], v[2])));
      rec.anim?.advance(ml(ml(len, 0.125), 50), dt);
    } else { my = PK.MUMMY_AWAY_Y; mz = PK.MUMMY_AWAY_Z; }
    rec.setEuler(0, rec.ry, 0, mx, my, mz);
    if (my === PK.MUMMY_AWAY_Y) rec.savePrev();     // (port) sent away: no render interpolation across the jump
    return NODE_STOP;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// the key and the door

/** FUN_006aa4b1 / FUN_006aa070: when all 12 symbols are matched the key comes down from 5.76 above its place, Pepper takes it and the portcullis (DOOR) opens */
export class KeyNode extends Node {
  readonly kind = 'mmpKey';
  /** +0x18..+0x20: the key's resting place, +0x28: the door is open */
  home = [0, 0, 0]; doorOpen = false;
  /** +0x24: the handle of symtwin.par (FUN_006aa4b1: matrix = the key's, offset 0, rotation 0, gate off) */
  fxTwin: number = NO_HANDLE;
  startFx(fx: ZoneParticles, rec: GameRecord) { this.fxTwin = fx.start('symtwin.par', rec.m, [0, 0, 0], [0, 0, 0], GATE_OFF); }
  init(rec: GameRecord) {
    this.home = [rec.x, rec.y, rec.z];
    rec.y = ad(this.home[1], PK.KEY_DROP);
    this.doorOpen = false;
  }
  update(w: World, rec: GameRecord): number {
    const sh = this.sh, vars = w.vars, snd = sh.sounds, rs = sh.records, dt = w.dt;
    let y = rec.y;
    const at = () => ({ x: rec.x, y: rec.y, z: rec.z });
    if ((vars.get(VAR.READY) & BIT.KEY) === 0) {
      if ((vars.get(VAR.OPEN) & BIT.KEY) === 0) {
        if ((vars.get(VAR.MATCHED) & BIT.ALL) === BIT.ALL && (vars.get(VAR.OPEN) & BIT.ALL) === 0) { vars.or(VAR.OPEN, BIT.KEY); snd.play2D(SND.KEY_APPEAR); }
      } else {
        snd.play3D('keySpin', SND.KEY_SPIN, at());
        if (y <= this.home[1]) vars.or(VAR.READY, BIT.KEY); else y = sb(y, ml(PK.KEY_FALL, dt));
      }
    } else if ((vars.get(VAR.MATCHED) & BIT.KEY) === 0) {
      snd.play3D('keySpin', SND.KEY_SPIN, at());
      if ((rec.ctrl?.distSq ?? 1e9) <= PK.KEY_REACH) {
        rec.flags &= ~2;
        vars.or(VAR.MATCHED, BIT.KEY); vars.andNot(VAR.OPEN, BIT.KEY);
        snd.play2D(SND.KEY_COLLECT);
        snd.stop3D('keySpin');
        snd.music(MUSIC.HOTEP);
      }
    } else if (!this.doorOpen) {
      const door = rs[REC.DOOR];
      door.y = ad(ml(PK.DOOR_RISE, dt), door.y);
      snd.play3D('gateLoop', SND.GATE_LOOP, { x: door.x, y: door.y, z: door.z });
      if (PK.DOOR_TOP <= door.y) {
        // (the record keeps the value it was written with, a little above 14: the clamp is of the local copy only)
        this.doorOpen = true;
        snd.stop3D('gateLoop');
        snd.play3D('gateOpened', SND.GATE_OPENED, { x: door.x, y: PK.DOOR_TOP, z: door.z });
      }
    }
    rec.ry = ad(ml(PK.KEY_SPIN, dt), rec.ry);
    // the twinkle: on while the key is falling / waiting (OPEN or READY bit 0x1000) and its record is shown (record flag 2), else off; then the matrix follows the record
    if (((vars.get(VAR.READY) & BIT.KEY) === 0 && (vars.get(VAR.OPEN) & BIT.KEY) === 0) || !shown(rs[REC.KEY])) sh.fx?.off(this.fxTwin);
    else { sh.fx?.on(this.fxTwin); sh.fx?.setMatrix(this.fxTwin, rec.m); }
    rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x, y, rec.z);
    return NODE_STOP;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// the page

/** FUN_006a9f87 / FUN_006a9cc0: Pepper touches the page (squared distance <= 2.4): the trap door above the pedestal rises and starts the collapse */
export class PageNode extends Node {
  readonly kind = 'mmpPage';
  /** +0x18: the collapse was started */
  started = false;
  /** +0x1c: the handle of twinkle01.par (FUN_006a9f87: matrix = the page's, offset 0, rotation 0, gate ON) */
  fxTwinkle: number = NO_HANDLE;
  startFx(fx: ZoneParticles, rec: GameRecord) { this.fxTwinkle = fx.start('twinkle01.par', rec.m, [0, 0, 0], [0, 0, 0], GATE_ON); }
  init() { this.started = false; }
  update(w: World, rec: GameRecord): number {
    const sh = this.sh, vars = w.vars, snd = sh.sounds, dt = w.dt, rs = sh.records;
    if ((vars.get(VAR.READY) & BIT.PAGE) === 0) {
      if ((rec.ctrl?.distSq ?? 1e9) <= PK.PAGE_REACH) vars.or(VAR.READY, BIT.PAGE);
    } else {
      sh.fx?.off(this.fxTwinkle);        // FUN_0044ea60(handle, 1, 1, 1) every tick once the page is touched
      const trap = rs[REC.TRAP];
      if (PK.TRAP_TOP <= trap.y) {
        if (!this.started) { this.started = true; vars.or(VAR.OPEN, BIT.CHASE); }
      } else trap.y = ad(ml(PK.TRAP_RISE, dt), trap.y);
    }
    if (!shown(rec)) snd.stop3D('pageSpin');
    else {
      snd.play3D('pageSpin', SND.PAGE_SPIN, { x: rec.x, y: rec.y, z: rec.z });
      rec.ry = ad(ml(PK.KEY_SPIN, dt), rec.ry); rec.rx = sb(rec.rx, ml(PK.KEY_SPIN, dt));
      sh.fx?.setMatrix(this.fxTwinkle, rec.m);
      rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z);
    }
    return NODE_STOP;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// the collapse: boulder, pillars, stones

/** FUN_006a9bd2 / FUN_006a9930, gated by OPEN & 0x4000: the boulder rolls down the corridor at 0.85 per tick and bounces along the floor; MATCHED & 0x4000 puts it back */
export class RockNode extends Node {
  readonly kind = 'mmpRock';
  /** +0x18: vertical velocity, +0x1c..+0x24: the start place, +0x28: the chase music was started */
  vy = 0; home = [0, 0, 0]; musicStarted = false;
  init(rec: GameRecord) { this.vy = 0; this.home = [rec.x, rec.y, rec.z]; this.musicStarted = false; }
  update(w: World, rec: GameRecord): number {
    const sh = this.sh, snd = sh.sounds, dt = w.dt;
    let x = rec.x, y = rec.y, z = rec.z;
    if (PK.ROCK_END_Z < z) {
      z = sb(z, ml(PK.ROCK_SPEED, dt));
      rec.rx = sb(rec.rx, ml(PK.ROCK_SPIN, dt));
      snd.play3D('boulder', SND.BOULDER, { x: rec.x, y: rec.y, z: rec.z });
      if (!this.musicStarted) { snd.music(MUSIC.CHASE); this.musicStarted = true; }
    }
    const from = [x, y, z];
    if (y < -12.5) { y = 187.5; x = 0; }       // (the sweep below starts from the position before the reset)
    let settled = false, reset = false;
    if (this.vy <= 0) {
      const h = w.col.sweep(rec, from, [0, ml(this.vy, dt), 0], 3, PK.ROCK_RADIUS, PK.ROCK_SKIN);
      if (h) { y = f32(h.point[1]); this.vy = sh.rng.float(PK.ROCK_BOUNCE); settled = true; }
    }
    if (!settled) this.vy = sb(this.vy, PK.ROCK_GRAVITY);
    y = ad(y, this.vy);
    if ((w.vars.get(VAR.MATCHED) & BIT.CHASE) !== 0) {
      x = this.home[0]; y = this.home[1]; z = this.home[2];
      this.vy = 0;
      snd.stop3D('boulder');
      reset = true;
    }
    rec.setEuler(rec.rx, 0, 0, x, y, z);
    if (reset) rec.savePrev();
    return NODE_STOP;
  }
}

/** FUN_006a986d / FUN_006a95d5: once the collapse runs a pillar falls over towards the middle when Pepper comes within 16; MATCHED & 0x4000 raises it again */
export class PillarNode extends Node {
  readonly kind = 'mmpPillar';
  /** +0x18: 0 standing, 1 falling to the left / right, 3 down */
  state = 0;
  init(rec: GameRecord) { rec.rz = 0; this.state = 0; }
  update(w: World, rec: GameRecord): number {
    const sh = this.sh, pep = sh.records[REC.PEPPER], dt = w.dt;
    if ((w.vars.get(VAR.MATCHED) & BIT.CHASE) !== 0) { this.state = 0; rec.rz = 0; }
    if ((w.vars.get(VAR.OPEN) & BIT.CHASE) !== 0) {
      if (this.state === 0) {
        if (sb(pep.z, rec.z) < PK.PILLAR_AHEAD) {
          this.state = rec.x <= 0 ? 2 : 1;
          const s = sh.sounds;
          // FUN_006a9540: the column-fall sound on a free one of its four handles
          // (FUN_006a9540 tests DAT_05d5bff0, 05d5bfe8, 05d5bfec in that order; the fourth, 05d5bfe4, is the fallback and is not tested)
          const free = ['colFall3', 'colFall1', 'colFall2'].find((h) => s.idle3D(h)) ?? 'colFall0';
          s.play3D(free, SND.COLUMN_FALL, { x: rec.x, y: rec.y, z: rec.z });
        }
      } else if (this.state === 1) {
        rec.rz = ad(ml(PK.PILLAR_STEP, dt), rec.rz);
        if (PK.PILLAR_ANGLE <= rec.rz) { rec.rz = PK.PILLAR_ANGLE; this.state = 3; }
      } else if (this.state === 2) {
        rec.rz = sb(rec.rz, ml(PK.PILLAR_STEP, dt));
        if (rec.rz <= -PK.PILLAR_ANGLE) { rec.rz = -PK.PILLAR_ANGLE; this.state = 3; }
      }
    }
    rec.setEuler(0, 0, rec.rz, rec.x, rec.y, rec.z);
    return NODE_STOP;
  }
}

/** FUN_006a948b / FUN_006a9280: during the collapse the stones (hidden before) fall at 2.4 per tick and start again above Pepper's surroundings */
export class DebrisNode extends Node {
  readonly kind = 'mmpDebris';
  update(w: World, rec: GameRecord): number {
    const sh = this.sh, pep = sh.records[REC.PEPPER], rng = sh.rng, dt = w.dt;
    let x = rec.x, y = rec.y, z = rec.z, respawned = false;
    if ((w.vars.get(VAR.OPEN) & BIT.CHASE) !== 0) {
      rec.flags |= 2;
      y = sb(y, PK.STONE_FALL);
      if (y < sb(pep.y, PK.STONE_BELOW)) {
        // (the three bases are float32 locals: pep.y + 40, pep.x - 32, pep.z - 32; the random draws come in the order y, x, z)
        y = ad(rng.float(PK.STONE_RANGE_Y), ad(pep.y, PK.STONE_ABOVE));
        x = ad(rng.float(PK.STONE_RANGE_XZ), sb(pep.x, PK.STONE_HALF));
        z = ad(rng.float(PK.STONE_RANGE_XZ), sb(pep.z, PK.STONE_HALF));
        rec.rz = f32(rng.float(PK.STONE_SPIN));
        respawned = true;
      }
    }
    void dt;
    rec.setEuler(0, 0, rec.rz, x, y, z);
    if (respawned) rec.savePrev();
    return NODE_STOP;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// torches, spiders, rats

/** FUN_006a8fd8 / FUN_006a8cf0: the torches make their fire sound and burn `mmpfire.par` (started by the constructor: matrix = the torch's, offset 0, rotation 0, gate ON). The record names are all `TORC`, so the
 * first of the 12 name tests of the update matches for every torch and they all play the same handle: every torch calls it once per tick, the sound sits at the torch whose update ran last */
export class TorchNode extends Node {
  readonly kind = 'mmpTorch';
  fxFire: number = NO_HANDLE;
  startFx(fx: ZoneParticles, rec: GameRecord) { this.fxFire = fx.start('mmpfire.par', rec.m, [0, 0, 0], [0, 0, 0], GATE_ON); }
  update(_w: World, rec: GameRecord): number {
    this.sh.sounds.play3D('torch', SND.TORCH, { x: rec.x, y: rec.y, z: rec.z });
    return NODE_STOP;
  }
}

/** FUN_006a8c1f / FUN_006a8a40: a spider drops from its thread when Pepper comes within 20 (z): the drop clip, then it dangles */
export class SpiderNode extends Node {
  readonly kind = 'mmpSpider';
  /** +0x18: 0 waiting, 1 dropping, 2 dangling */
  state = 0;
  init(rec: GameRecord) { this.state = 0; rec.anim?.start(2, 0); }
  update(w: World, rec: GameRecord): number {
    if (!this.sh.records?.[REC.PEPPER]) return NODE_STOP;      // not prepared (generic stub test)
    const pep = this.sh.records[REC.PEPPER], dt = w.dt;
    if (this.state === 0) {
      if (sb(rec.z, PK.SPIDER_AHEAD) < pep.z) { this.state = 1; this.sh.sounds.play3D('spiderDrop', SND.SPIDER_DROP, { x: rec.x, y: rec.y, z: rec.z }); }
    } else if (this.state === 1) {
      if (rec.anim?.advance(1.0, dt) !== 0) { this.state = 2; rec.anim?.start(1, 0); }
    } else rec.anim?.advance(1.0, dt);
    return NODE_STOP;
  }
}

/** FUN_006a88db / FUN_006a8350: a rat scurries around its home: it walks (0.12), squeaks standing still, or runs (0.2); the mode changes whenever its clip ends */
export class RatNode extends Node {
  readonly kind = 'mmpRat';
  /** +0x14..+0x1c: home, +0x20: turn duration, +0x24: mode (0 walk, 1 squeak, 2 run), +0x28: turn timer, +0x2c: cycles, +0x30: turn per tick */
  home = [0, 0, 0]; turnFor = 0; mode = 0; timer = 0; cycles = 0; turn = 0;
  init(rec: GameRecord) {
    this.home = [rec.x, rec.y, rec.z];
    this.turnFor = 0; this.mode = 0; this.timer = 0; this.turn = 0;
    const a = rec.anim;
    if (a) { a.start(4, 0); a.seek(this.sh.rng.float(a.frameCount - 2)); }
    this.cycles = Math.trunc(this.sh.rng.float(10));
  }
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const sh = this.sh, rng = sh.rng, dt = w.dt, a = rec.anim!;
    if (a.advance(1.0, dt) !== 0) {
      this.cycles++;
      do { this.mode = Math.trunc(rng.float(3)); } while (this.mode > 2);
      if (this.mode === 0) { this.cycles = Math.trunc(rng.float(10)); a.start(3, 0); }
      else if (this.mode === 1) { this.cycles = 0; a.start(1, 0); sh.sounds.play3D('squeak', SND.RAT_SQUEAK, { x: rec.x, y: rec.y, z: rec.z }); }
      else { this.cycles = Math.trunc(rng.float(20)); a.start(4, 0); }
    }
    if (this.mode === 0 || this.mode === 2) {
      let x = rec.x, y = rec.y, z = rec.z;
      // FUN_006a8350 (every operation a float32 result; the squared length is added x, y, z, asm 0x6a8530; the angles are float32 locals)
      const dx = sb(this.home[0], x), dy = sb(this.home[1], y), dz = sb(this.home[2], z);
      if (ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz)) <= PK.RAT_NEAR_SQ) {
        if (this.timer <= this.turnFor) { if (this.timer < 20) rec.ry = ad(rec.ry, this.turn); }
        else {
          this.turn = sb(rng.float(PK.RAT_TURN), ml(PK.RAT_TURN, 0.5));
          this.turnFor = ad(rng.float(50), 20);
          this.timer = rng.float(20);
        }
        this.timer = ad(ml(1, dt), this.timer);
      } else {
        this.turnFor = -1; this.timer = 0;
        const ang = f32(Math.atan2(dx, dz));
        let diff = sb(rec.ry, ang);
        if (PK.PI_NEG <= diff) { if (PK.PI < diff) diff = sb(diff, PK.TWO_PI); } else diff = ad(diff, PK.TWO_PI);      // (the float32 constants of .rdata: -pi 0x892098, pi 0x89207c, 2 pi 0x892094)
        if (diff <= PK.RAT_TURN) { if (PK.RAT_TURN <= diff) rec.ry = ang; else rec.ry = ad(ml(PK.RAT_TURN, dt), rec.ry); } else rec.ry = sb(rec.ry, ml(PK.RAT_TURN, dt));
      }
      eulerRotation(rec.m, f32(rec.rx), f32(rec.ry), f32(rec.rz));          // FUN_0043a4a1: the rotation only, the matrix keeps its translation
      const sp = ml(this.mode === 0 ? PK.RAT_WALK : PK.RAT_RUN, dt);
      x = ad(x, ml(sp, rec.m[8])); y = ad(y, ml(sp, rec.m[9])); z = ad(z, ml(sp, rec.m[10]));
      rec.m[12] = x; rec.m[13] = y; rec.m[14] = z;
    }
    // the controller probe (FUN_00427014(ctrl, (0, 8, 0), (0, -16, 0), mask 3, flags 0x50), armed at the end of the update in modes 0 / 2): the probe pass of this frame (probehost.ts, between
    // the update and the pre-render pass) samples the ground record below the rat's new position + (0, 8, 0) and puts its y on the floor (flags 0x1053: follow, write y, ground sample, no sweep)
    if (this.mode === 0 || this.mode === 2) armControllerProbe(ctrl, [0, 8, 0], [0, -16, 0], 3, 0x50);
    return NODE_STOP;
  }
}
