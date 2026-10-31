// z22BIP: the small behaviour nodes of the zone: the animated props (crocodiles CRC?, parrots PRT?: FUN_0070d523 / FUN_0070d6cc, update = advance the clip), the fuel cans
// ("JerryCan" FUN_0070daa6 / FUN_0070d960: they turn), the propellers of the two planes (the node "prop" on PROP, FUN_0070d352 / FUN_0070d140 / FUN_0070d271), the river
// (FUN_0070e1ad / FUN_0070e010 / FUN_0070e0d4), the sliding rope targets ("RopeSld" FUN_0070ed68 / FUN_0070ea60), the sea bed (FUN_0070fd0b) and the mode switch PSwitch
// (FUN_007102f9 / FUN_00710220).
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP, NODE_CONTINUE } from '../../game/controller.ts';
import { bipRun, f32, MODE, VAR_MODE } from './run.ts';
import { eulerMatrix, matThen } from '../common/matrix.ts';
import { ad, ml } from '../common/f32.ts';
import type { SrcPoints } from './takeoff.ts';

const F = Math.fround;

export const CTOR_PSWITCH = 0x7102f9, CTOR_SEABED = 0x70fd0b, CTOR_RIVER = 0x70e1ad, CTOR_JERRYCAN = 0x70daa6, CTOR_PROP3 = 0x70d352;
export const CTOR_ANIM_CROC = 0x70d523, CTOR_ANIM_PARROT = 0x70d6cc, CTOR_ROPE = 0x70ed68;

/** FUN_007102f9 (the constructor sets game variable 0xfa to 8 = take-off) / FUN_00710220 (the update only reads it; returns 2: "ran, go on") */
export class PSwitchNode implements BehaviourNode {
  readonly kind = 'PSwitch';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  update(): number { return NODE_CONTINUE; }
}

/** the sea bed record's node (FUN_0070fd0b: update returns 1; the draw adds the underwater plane at y = -106 through FUN_00444500, not drawn by the port) */
export class SeaBedNode implements BehaviourNode {
  readonly kind = 'SeaBed';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  update(): number { return NODE_STOP; }
}

/** an animated prop: FUN_0070d523 starts clip 1 (crocodiles) / FUN_0070d6cc clip 3 (parrots), the update (FUN_0070d437 / FUN_0070d5e0) advances it by one frame */
export class AnimPropNode implements BehaviourNode {
  readonly kind = 'AnimProp';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  clip: number;
  private started = false;
  constructor(clip: number) { this.clip = clip; }
  update(w: World, rec: GameRecord): number {
    if (!this.started) { this.started = true; rec.anim?.start(this.clip, 0); }
    rec.anim?.advance(1, w.dt);
    return NODE_STOP;
  }
}

/** a fuel can (FUN_0070d960): turns 4 degrees per tick about the y axis, its place unchanged */
export const CAN_TURN = f32(0x3d8efa03);
export class JerryCanNode implements BehaviourNode {
  readonly kind = 'JerryCan';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  angle = 0;
  update(_w: World, rec: GameRecord): number {
    const x = rec.m[12], y = rec.m[13], z = rec.m[14];
    const r = eulerMatrix(0, this.angle, 0, 0, 0, 0);
    rec.m.set(r); rec.m[12] = x; rec.m[13] = y; rec.m[14] = z;
    this.angle = F(this.angle + CAN_TURN);
    return NODE_STOP;
  }
}

/** FUN_0070d140: the three propellers (the plane's nose, Johnny's two): matrix = turn about z by the angle (+0.8 per tick) at the offset, times the owner's matrix */
export const PROPS = { SPIN: f32(0x3f4ccccd) /* 0.8: 0x892084 */ } as const;
export class PropsNode implements BehaviourNode {
  readonly kind = 'prop';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  /** owners (record indices), offsets (x, y, z) in their frames (table at 0x931a38), the angle about z per propeller */
  owners: number[] = [];
  offsets: number[][] = [];
  angles: number[] = [];
  /** the matrices drawn (FUN_0070d271 draws the PROP record once for each) */
  matrices: Float32Array[] = [];
  update(w: World): number {
    for (let i = 0; i < this.owners.length; i++) {
      const o = this.offsets[i];
      const loc = eulerMatrix(0, 0, this.angles[i], o[0], o[1], o[2]);      // FUN_0043a5e4
      const owner = w.records[this.owners[i]];
      this.matrices[i] = matThen(loc, owner.m);                              // FUN_0043a9e5
      this.angles[i] = F(this.angles[i] + PROPS.SPIN);
    }
    return NODE_STOP;
  }
}

/** FUN_0070e010: the river's sound: 3D at (plane x, 0, plane z) while the plane is within the river's reach, else stopped; the jungle ambience plays all the time; the river's texture scrolls (FUN_0070e0d4: V -= 0.01 per frame) */
export const RIVER = { SCROLL: -0.01 /* double 0x8928d8 */ } as const;
export class RiverNode implements BehaviourNode {
  readonly kind = 'River';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  /** called with the V step each tick (the zone game scrolls the record's groups) */
  scroll: ((rec: GameRecord, dv: number) => void) | null = null;
  update(w: World, rec: GameRecord): number {
    const run = bipRun(w), pl = w.records[74];
    if (!run.riverNear) run.sound.stop('riverAmb');
    else run.sound.at('riverAmb', [pl.x, 0, pl.z]);
    run.sound.play('jungleAmb');
    this.scroll?.(rec, F(w.dt * RIVER.SCROLL));
    return NODE_STOP;
  }
}

/** FUN_0070ed68 / FUN_0070ea60: a rope target slides from the first point of its `DTHn.SRC` to the second in 100 ticks, waits 50 and starts again; when a banana hit it (`hit`, +0x4c) it and its partner records turn over by 0.4 rad per tick for 50 ticks (then it is restored and can be hit again) */
export const ROPE = { STEPS: 100, WAIT: 0x32, TURN: f32(0x3ecccccd), TURN_TICKS: 50 } as const;
export class RopeSlideNode implements BehaviourNode {
  readonly kind = 'RopeSld';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  /** +0x48: 1 moving, 0 waiting; +0x4c: hit; +0x58: steps made; +0x5c: wait ticks left (int); +0x64: ticks of the turn (float) */
  moving = 1; hit = 0; step = 0; waitLeft = 0; turn = 0;
  p0: number[] = [0, 0, 0]; p1: number[] = [0, 0, 0];
  vel: number[] = [0, 0, 0];
  cur: number[] = [0, 0, 0];
  /** the two partner records (+0x68 / +0x6c: SLD? and DTR?) and their saved matrices */
  b: GameRecord | null = null; c: GameRecord | null = null;
  private saveB = new Float32Array(16); private saveC = new Float32Array(16);

  bind(src: SrcPoints, b: GameRecord, c: GameRecord) {
    this.p0 = [...src.pos0]; this.p1 = [...src.pos1];
    this.vel = [0, 1, 2].map((k) => F(F(1 / ROPE.STEPS) * F(this.p1[k] - this.p0[k])));
    this.cur = [...this.p0];
    this.b = b; this.c = c;
  }

  update(): number {
    const b = this.b, c = this.c;
    if (!b || !c) return NODE_STOP;
    if (this.moving === 0) {
      this.waitLeft -= 1;
      if (this.waitLeft < 1) { this.moving = 1; this.step = 0; this.cur = [...this.p0]; }
    } else if (this.hit === 0) {
      for (let k = 0; k < 3; k++) this.cur[k] = F(this.cur[k] + this.vel[k]);
      this.step++;
      if (ROPE.STEPS <= this.step) { this.moving = 0; this.waitLeft = ROPE.WAIT; }
      for (const r of [b, c]) { r.m[12] = this.cur[0]; r.m[13] = this.cur[1]; r.m[14] = this.cur[2]; }
    } else {
      if (this.turn === 0) { this.saveC.set(c.m); this.saveB.set(b.m); }
      for (const r of [c, b]) turnX(r.m, ROPE.TURN);
      this.turn = F(this.turn + 1);
      if (this.turn === ROPE.TURN_TICKS) {
        this.turn = 0; this.hit = 0;
        c.m.set(this.saveC); b.m.set(this.saveB);
      }
    }
    return NODE_STOP;
  }
}
/** FUN_0043ae1e: turn the matrix's columns 1 and 2 about the x axis by `a` (cos / sin are float32 locals, every product and sum a float32 result) */
function turnX(m: Float32Array, a: number) {
  const c = F(Math.cos(a)), s = F(Math.sin(a));
  const o1 = [m[1], m[5], m[9]];
  m[1] = ad(ml(s, m[2]), ml(c, m[1])); m[5] = ad(ml(s, m[6]), ml(c, m[5])); m[9] = ad(ml(s, m[10]), ml(c, m[9]));
  m[2] = ad(ml(c, m[2]), ml(-s, o1[0])); m[6] = ad(ml(c, m[6]), ml(-s, o1[1])); m[10] = ad(ml(c, m[10]), ml(-s, o1[2]));
}
void MODE; void VAR_MODE;
