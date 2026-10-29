// z27TRX: the nodes of the props on the track (FUN_0076649a attaches them by the record name): the camp gate (GATE), the volcano rumble (VOLC), swinging logs (SLOG), boulders that
// drop in (BLDR), eggs that drop and break (EGGS / YOLK), the spectator dinosaurs (TRIC / STEG / BREX), the brontosaurus (BRON). Pure TypeScript.
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE, NODE_NONE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Model } from '../../formats/exe.ts';
import { V } from '../../game/vars.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { PHASE, SND, VAR } from './consts.ts';
import { groundAt } from './run.ts';
import type { TrxRun } from './run.ts';

abstract class PropNode implements BehaviourNode {
  abstract readonly kind: string;
  var: number = V.NS_ON; mask = 0; value = 0;
  stamp = 0xfffffffe;
  run!: TrxRun;
  abstract update(w: World, rec: GameRecord, ctrl: Controller): number;
}
const pos = (r: GameRecord): [number, number, number] => [r.x, r.y, r.z];

// ----------------------------------------------------------------------------------------------------------------------------------- GATE (FUN_00767023 / FUN_00766ef0)

/** the live matrices of the gate's two doors (sub-objects 1 and 2 of the mesh: FUN_0043ea60(model, 1 / 2)); the renderer draws the groups of those sub-objects with them */
export class GateNode extends PropNode {
  readonly kind = 'trx-gate';
  /** +0x14 / +0x18: the door matrices (null when the mesh has no such sub-objects) */
  door1: Float32Array | null = null; door2: Float32Array | null = null;
  /** +0x1c: the opening angle (radians, to a quarter turn) */
  angle = 0;
  /** FUN_00766ef0: while the run is in its arrival phase the doors swing open by one degree per tick up to 90 degrees */
  update(w: World): number {
    if (!this.run) return NODE_NONE;     // registered by constructor address but not bound by prepareTrx (the generic stub run)
    if (w.vars.get(VAR.PHASE) === PHASE.ARRIVE && this.angle < 1.5707964) {
      this.angle += 0.017453199 * w.dt;
      if (this.door1) rotateY(this.door1, this.angle);
      if (this.door2) rotateY(this.door2, -this.angle);
    }
    return NODE_CONTINUE;
  }
}
/** FUN_0043a4a1(m, 0, angle, 0): the rotation part of a sub-object matrix from the Euler angles, its translation kept */
function rotateY(m: Float32Array, angle: number) { m.set(buildMatrix(0, angle, 0, m[12], m[13], m[14])); }

// ----------------------------------------------------------------------------------------------------------------------------------- VOLC (FUN_007679e2 / FUN_0076776f)

export class VolcNode extends PropNode {
  readonly kind = 'trx-volc';
  /** +0x14: how close the rex has to come (64, 0x42800000); +0x18: the rumble was started once */
  reach = 64; done = false;
  update(w: World, rec: GameRecord): number {
    if (!this.run) return NODE_NONE;     // registered by constructor address but not bound by prepareTrx (the generic stub run)
    const run = this.run, p = run.pepp;
    if (run.volcano === null && !this.done) {
      const dz = rec.z - p.z, dx = rec.x - p.x;
      if (-this.reach < dz && dz < this.reach && -this.reach < dx && dx < this.reach) {
        w.vars.set(VAR.VOLCANO, 1);
        run.volcano = rec;
        this.done = true;
        run.sound.at(SND.VOLCANO, pos(rec));
      }
    } else if (run.volcano === rec) {
      const dx = rec.x - p.x;
      if (dx < -this.reach || this.reach < dx) { run.volcano = null; w.vars.set(VAR.VOLCANO, 0); }
      else {
        const dz = rec.z - p.z;
        if (dz < -this.reach || this.reach < dz) { run.volcano = null; w.vars.set(VAR.VOLCANO, 0); run.sound.stop(SND.VOLCANO); }
      }
    }
    return NODE_CONTINUE;
  }
}

// ----------------------------------------------------------------------------------------------------------------------------------- SLOG (FUN_00767666 / FUN_007674c0)

export class SlogNode extends PropNode {
  readonly kind = 'trx-slog';
  /** +0x40: the swing phase (-pi .. pi) */
  phase = 0;
  update(w: World, rec: GameRecord): number {
    if (!this.run) return NODE_NONE;     // registered by constructor address but not bound by prepareTrx (the generic stub run)
    const run = this.run;
    const dz = run.pepp.z - rec.z;
    if (-160 < dz && dz < 160) {
      run.sound.at(SND.PENDULUM, pos(rec));
      const c = Math.cos(this.phase);
      this.phase += 0.10471919 * w.dt;               // 0x892688 (pi / 30)
      if (3.1415927 < this.phase) this.phase -= 6.2831855;
      rec.setEuler(0, rec.ry, c * 0.349064, rec.x, rec.y, rec.z);     // rz = cos(phase) * 0.349 (20 degrees)
    }
    return NODE_CONTINUE;
  }
}

// ----------------------------------------------------------------------------------------------------------------------------------- BLDR (FUN_00767d2e / FUN_00767a80)

/** a boulder: hidden 54 above the ground and 24 off in x and z until the rex comes within 56 (xz), then it drops in diagonally and lands on its spot */
export class BldrNode extends PropNode {
  readonly kind = 'trx-bldr';
  /** +0x14 ground height at the record; +0x28 state (0 waiting, 1 falling, 2 landed); +0x2c: this boulder holds var 0xfe */
  ground = 0; state = 0; owner = false;
  /** +0x30 / +0x34 / +0x38 position; +0x3c / +0x40 / +0x44 velocity */
  px = 0; py = 0; pz = 0; vx = 0.8; vy = 0; vz = 0.8;
  /** FUN_00767d2e: the start position (landing spot - (24, -54, 24)); the record is hidden */
  bind(w: World, rec: GameRecord) {
    const x0 = rec.x, y0 = rec.y, z0 = rec.z;
    this.ground = groundAt(w, x0, y0, z0);
    this.px = x0 - 24; this.py = this.ground + 54; this.pz = z0 - 24;
    this.vx = 0.8; this.vy = 0; this.vz = 0.8; this.state = 0; this.owner = false;
    rec.flags &= ~RF_ENABLED;
  }
  update(w: World, rec: GameRecord): number {
    if (!this.run) return NODE_NONE;     // registered by constructor address but not bound by prepareTrx (the generic stub run)
    const run = this.run, dt = w.dt;
    if (this.state === 0) {
      const dx = rec.x - run.pepp.x, dz = rec.z - run.pepp.z;
      if (dx * dx + dz * dz < 3136) {
        this.state = 1;
        rec.flags |= RF_ENABLED;
        if (w.vars.get(VAR.BOULDER) === 0) { this.owner = true; w.vars.set(VAR.BOULDER, 1); }
        this.vy = 0;
      }
    } else if (this.state === 1) {
      this.px += this.vx * dt; this.py += this.vy * dt; this.pz += this.vz * dt;
      this.vy -= 0.12 * dt;
      if (this.ground < this.py) run.sound.at(SND.ROCKFALL, pos(rec));
      else {
        this.py = this.ground; this.state = 2;
        if (this.owner) w.vars.set(VAR.BOULDER, 0);
        run.sound.at(SND.ROCKIMPACT, pos(rec));
      }
    }
    rec.x = this.px; rec.y = this.py; rec.z = this.pz;
    return NODE_CONTINUE;
  }
}

// ----------------------------------------------------------------------------------------------------------------------------------- EGGS / YOLK (FUN_00767386 / FUN_007670e0)

/** the three models an egg wears: falling (model 0x2e: eggs.msh), landed (0x121: yolk_whole.msh), broken (0x2d: yolk_split.msh) */
export interface EggModels { falling: Model | null; landed: Model | null; broken: Model | null }
export class EggNode extends PropNode {
  readonly kind = 'trx-egg';
  models: EggModels = { falling: null, landed: null, broken: null };
  /** the zone game redraws the record when its model changed (GameRenderer.refreshViews) */
  onModel: (rec: GameRecord) => void = () => { /* no renderer */ };
  /** +0x14 ground height; +0x34 state (0 waiting, 1 falling, 2 landed, 3 broken); +0x38 height; +0x3c fall speed */
  ground = 0; state = 0; y = 0; vy = 0;
  bind(w: World, rec: GameRecord) {
    this.ground = groundAt(w, rec.x, rec.y, rec.z);
    this.state = 0; this.vy = 0;
    this.y = this.ground + 48;
    rec.flags &= ~RF_ENABLED;
    if (this.models.falling) { rec.model = this.models.falling; this.onModel(rec); }
  }
  update(w: World, rec: GameRecord): number {
    if (!this.run) return NODE_NONE;     // registered by constructor address but not bound by prepareTrx (the generic stub run)
    const run = this.run, dt = w.dt;
    if (this.state === 0) {
      const dx = rec.x - run.pepp.x, dz = rec.z - run.pepp.z;
      if (dx * dx + dz * dz < 5184) { this.state = 1; rec.flags |= RF_ENABLED; }
      this.vy = 0;
    } else if (this.state === 1) {
      this.y += this.vy * dt;
      this.vy -= 0.12 * dt;
      if (this.ground <= this.y) run.sound.at(SND.EGGFALL, pos(rec));
      else {
        if (this.models.landed) { rec.model = this.models.landed; this.onModel(rec); }
        this.y = this.ground; this.state = 2;
        run.sound.stop(SND.EGGFALL);
        run.sound.at(SND.EGGIMPACT, pos(rec));
      }
    }
    rec.y = this.y;
    return NODE_CONTINUE;
  }
  /** FUN_00767295: the rex ran into the landed egg: it breaks (the yolk splits), var 0xfd */
  hitByRex(w: World, rec: GameRecord) {
    if (this.state === 2) {
      this.state = 3;
      if (this.models.broken) { rec.model = this.models.broken; this.onModel(rec); }
      w.vars.set(VAR.EGG, 1);
    }
  }
}

// ----------------------------------------------------------------------------------------------------------------------------------- BRON (FUN_00768015 / FUN_00767e70)

/** the brontosaurus: plays its idle clip, roars (clip 2) when the rex passes it within 48 units, then idles again */
export class BrontyNode extends PropNode {
  readonly kind = 'trx-bronty';
  /** +0x18: 0 idle, 1 roaring, 2 roared (waits for the rex to be past) */
  state = 0;
  bind(rec: GameRecord) { this.state = 0; rec.anim?.start(1, 0); }
  update(w: World, rec: GameRecord): number {
    if (!this.run) return NODE_NONE;     // registered by constructor address but not bound by prepareTrx (the generic stub run)
    const res = rec.anim ? rec.anim.advance(1.0, w.dt) : 0;
    const dz = rec.z - this.run.pepp.z;
    if (this.state === 0) {
      if (res !== 0 && 0 < dz && dz < 48) { rec.anim?.start(2, 0); this.state = 1; }
    } else if (this.state === 1) {
      if (res !== 0) { rec.anim?.start(1, 0); this.state = 2; }
    } else if (this.state === 2) {
      if (dz < 0) this.state = 0;
    }
    return NODE_CONTINUE;
  }
}

// ----------------------------------------------------------------------------------------------------------------------------------- TRIC / STEG / BREX (FUN_0076847b / FUN_00768330)

/** a spectator dinosaur: its clip (TRIC 3, STEG 4, BREX 1) runs while the record is in view; a random number picks the call it makes */
export class SpectatorNode extends PropNode {
  readonly kind = 'trx-anim';
  clip = 1;
  /** how far from the listener the record counts as in view (the original tests the frustum flag) */
  viewRange = 220;
  bind(rec: GameRecord, clip: number) { this.clip = clip; rec.anim?.start(clip, 0); }
  update(w: World, rec: GameRecord): number {
    if (!this.run) return NODE_NONE;     // registered by constructor address but not bound by prepareTrx (the generic stub run)
    const c = w.camera.c;
    const dx = rec.x - c[3], dz = rec.z - c[5];
    if (dx * dx + dz * dz > this.viewRange * this.viewRange) return NODE_CONTINUE;
    const r = this.run.rng.int(3);
    rec.anim?.advance(1.0, w.dt);
    if (r === 1) this.run.sound.at(SND.DINO, pos(rec)); else if (r === 2) this.run.sound.at(SND.DINO1, pos(rec));
    return NODE_CONTINUE;
  }
}
