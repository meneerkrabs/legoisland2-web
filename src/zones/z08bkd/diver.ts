// The diver (record 5, node SwimBeh = FUN_005c23f9 / FUN_005c0888 and its helpers) and the camera node (CamBeh = FUN_005c06d7 / FUN_005c05ee / FUN_005c03f0).
// Pepper swims in the plane z = 10 of a 3D scene: a heading, an angular velocity (keys left / right) and a velocity (keys up / down thrust, drag -2); the quad he occupies
// is cast against the scenery and tested against the creatures' hurt spheres; he brings bricks to the surface (y 86.5), loses them when hurt, is held by the clam.
import type { Controller } from '../../game/controller.ts';
import { NODE_CONTINUE, NODE_STOP } from '../../game/controller.ts';
import { B as BTN } from '../../game/input.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { C, CAMERA_FAR_Z, CAMERA_PARALLAX, CAMERA_TABLE, CLIP, DIVER, REC, SND, VAR } from './consts.ts';
import { BkdNode } from './env.ts';
import type { Env } from './env.ts';
import { angleDelta, rotateShape, wrapAngle } from './math.ts';
import { castQuad, hitSpin } from './physics.ts';
import { rotateVector, setEuler } from './matrix.ts';
import { AnchorNode, BallNode, BrickNode, CannonNode, ClamNode, OctopusNode, PageNode, PirateNode } from './bodies.ts';
import { SPEECH } from './state.ts';

import { fr, ad, sb, ml, dv } from '../common/f32.ts';

/** FUN_005c1944: what a record the diver ran into is (the class the response switch of FUN_005c0888 uses) */
export const HIT_CLASS = { SOLID: 0, BRICK: 1, PAGE: 2, ANCHOR: 3, CLAM_TOP: 4, CLAM_BOT: 5, BALL: 6, TENTACLE: 7 } as const;

export class DiverNode extends BkdNode {
  readonly kind = 'SwimBeh';
  /** node +0x1c / +0x20: the collision shape in use (0 small, 1 tall with a brick) and the one wanted */
  shape = 0; wantShape = 0;
  /** node +0x104: the brick he carries */
  held: GameRecord | null = null;
  /** node +0x108: seconds without control (the electric shock), +0x10c: seconds of the skeleton view, +0x110 (counted down, never read) */
  stun = 0; flicker = 0; spare = 0;
  /** node +0x114: the skeleton's flicker phase; +0x118: 0 diver / 1 skeleton shown; +0x11c: a brick is within 10 units (the reach clip) */
  flickerPhase = 0; view = 0; nearBrick = 0;
  /** node +0x100: consecutive blocked moves; +0xf0 .. +0xfc: the last free place and heading */
  blocked = 0;
  safe: { x: number; y: number; z: number; heading: number } = { x: 0, y: 0, z: 10, heading: 0 };
  /** node +0x121 / +0x122 / +0xb8 / +0x124: sound state */
  surfaceFlag = true; flipperFlag = true; clamCatching = false; breathCount = 0;
  /** the movement block (node +0xbc): [2] angular velocity [5] heading [6] [7] [8] velocity [9] turn gain [10] turn drag [11] thrust [12] drag */
  w = { angVel: 0, heading: 0, vx: 0, vy: 0, vz: 0, turn: DIVER.TURN, turnDrag: DIVER.TURN_DRAG, thrust: DIVER.THRUST, drag: DIVER.DRAG };
  /** node +0x88: the last accepted quad */
  quad: number[][] = [];
  /** DAT_05d5ac10: the records the quad is cast against */
  private obstacles: GameRecord[] = [];
  private classOf = new Map<GameRecord, number>();

  bind(env: Env, rec: GameRecord) {
    super.bind(env, rec);
    const R = env.records;
    rec.x = DIVER.START[0]; rec.y = DIVER.START[1]; rec.z = DIVER.START[2];
    this.safe = { x: rec.x, y: rec.y, z: rec.z, heading: 0 };
    this.obstacles = [R[REC.LAND], R[REC.ANCHOR], R[REC.OCTH], R[REC.OCTC], R[REC.CLAM_TOP], R[REC.CLAM_BOT], ...REC.BRICKS.map((i) => R[i]), ...REC.BALLS.map((i) => R[i]), R[REC.PAGE], R[REC.CANNON]];
    const cls = (ids: readonly number[], c: number) => ids.forEach((i) => this.classOf.set(R[i], c));
    cls([REC.LAND, REC.CANNON, REC.OCTH], HIT_CLASS.SOLID); cls([REC.OCTC], HIT_CLASS.TENTACLE); cls(REC.BRICKS, HIT_CLASS.BRICK); cls([REC.PAGE], HIT_CLASS.PAGE);
    cls([REC.ANCHOR], HIT_CLASS.ANCHOR); cls([REC.CLAM_TOP], HIT_CLASS.CLAM_TOP); cls([REC.CLAM_BOT], HIT_CLASS.CLAM_BOT); cls(REC.BALLS, HIT_CLASS.BALL);
    R[REC.PCOL].flags |= 0x20;           // FUN_005c23f9 (0x5c24ac): *(ushort*)(record 93 + 0x60) |= 0x20, next to the bubble emitter's collision registrations (FUN_00442a50)
    this.setView(0);
    this.setModel(0);
    R[REC.SKEL].anim?.start(CLIP.PEPD_ELECTRIFIED, 0);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------- helpers

  /** FUN_005c1f93: 1 shows the skeleton (record 6) and hides the diver (record 5), 0 the reverse */
  private setView(v: number) {
    const R = this.env.records;
    this.view = v;
    if (v === 1) { R[REC.SKEL].show(); R[REC.PEPP].hide(); } else { R[REC.SKEL].hide(); R[REC.PEPP].show(); }
  }

  /** FUN_005c1df9(mode): 0 / 1 the empty hand, 2 the brick in the hand, (clip 1 / 2 / 2); 3 / 4 attach / detach the skeleton's spark part */
  setModel(mode: number) {
    const env = this.env, R = env.records, rec = R[REC.PEPP], bank = env.bank;
    switch (mode) {
      case 0: env.setAttach(rec, 8, 20, bank[8]); rec.anim?.start(CLIP.PEPD_SWIM, 0); break;
      case 1: env.setAttach(rec, 8, 20, bank[8]); rec.anim?.start(CLIP.PEPD_BRICKSWIM, 0); break;
      case 2: env.setAttach(rec, 8, 20, bank[3]); rec.anim?.start(CLIP.PEPD_BRICKSWIM, 0); break;
      case 3: env.setAttach(R[REC.SKEL], 0, 0, bank[4]); this.flipperFlag = false; break;
      case 4: env.setAttach(R[REC.SKEL], 0, 0, null); break;
    }
  }

  /** FUN_005c1d74(p): the reach clip (2) while a brick is within 10 units, the swim clip (1) otherwise, at the same frame */
  private reachClip(p: number) {
    const a = this.env.records[REC.PEPP].anim;
    if (!a) return;
    const f = a.frame;
    a.start(p === 0 ? CLIP.PEPD_SWIM : CLIP.PEPD_BRICKSWIM, f);
  }

  /** FUN_005c1b21: drop the brick he carries a little ahead of him (-1, 4, 0 in his frame) */
  drop(rec: GameRecord) {
    if (!this.held) return;
    const env = this.env;
    env.sound.play('BRICK_DROP');
    const r = rotateVector(rec.m, [-1, 4, 0]);       // FUN_0043abe6, then the place added (float32 stores)
    const p = [ad(r[0], rec.x), ad(r[1], rec.y), ad(r[2], rec.z)];
    env.nodeOf<BrickNode>(this.held).drop(this.held, p);
    this.held = null;
    this.setModel(0);
    this.wantShape = 0;
  }

  /** FUN_005c1bf7: a brick touched: take it when his hands are free and it was not dropped within 4 s; the last brick wakes the pirates */
  private pickBrick(brick: GameRecord) {
    if (this.held) return;
    const env = this.env;
    if (env.nodeOf<BrickNode>(brick).tryPickup(brick)) {
      this.held = brick;
      this.setModel(2);
      env.sound.play('BRICK_GET');
      this.wantShape = 1;
      if (brick.index === REC.BRICKS[4]) for (const i of REC.PIRATES) env.nodeOf<PirateNode>(env.records[i]).alert();
    }
  }

  /** FUN_005c1cb6: at the surface a carried brick is delivered (it becomes a piece of the bridge) */
  private deliver() {
    if (!this.held) return;
    const env = this.env;
    env.sound.play('BRICK_FINISH');
    env.state.deliver(this.held);
    this.held = null;
    this.setModel(0);
    this.wantShape = 0;
  }

  /** FUN_005c1d39: the page */
  private takePage(page: GameRecord) {
    const env = this.env;
    env.nodeOf<PageNode>(page).take(page);
    env.sound.play('GETPAGE');
    env.world.vars.set(VAR.GOT_PAGE, 1);
    env.state.gotPage();
  }

  /** FUN_005bc3a0: the knock-back (2 * (node + 0x30, node + 0x34): the diver's own shape table, a constant) */
  private knock() { this.w.vx = DIVER.KNOCK[0]; this.w.vy = DIVER.KNOCK[1]; this.w.vz = 0; }

  // ---------------------------------------------------------------------------------------------------------------------------------------- update

  update(wd: World, rec: GameRecord, _c: Controller): number {
    void _c;
    const env = this.env, dt = env.clock.dt, W = this.w, sound = env.sound, R = env.records;
    const held = wd.input.held;
    let turn = 0, thrust = 0;
    if (held !== 0 && this.stun === C.ZERO) {
      if (held & BTN.LEFT) turn = 0 - W.turn;
      if (held & BTN.RIGHT) turn = fr(turn + W.turn);
      if (held & BTN.UP) thrust = fr(W.thrust + 0);
      if (held & BTN.DOWN) thrust = fr(thrust - W.thrust);
    }
    const old: [number, number, number] = [rec.x, rec.y, rec.z];
    const angDrag = ml(W.angVel, W.turnDrag);
    W.angVel = ad(ml(ad(turn, angDrag), dt), W.angVel);
    const heading = wrapAngle(ad(ml(W.angVel, dt), W.heading));
    const hp = ad(heading, C.HALF_PI);                                  // 24-bit precision: the sum is one float32 result before cos / sin
    const c = fr(Math.cos(hp)), s = fr(Math.sin(hp));
    const dragX = ml(W.vx, W.drag), dragY = ml(W.vy, W.drag);
    W.vx = ad(ml(ad(ml(c, thrust), dragX), dt), W.vx);
    W.vy = ad(ml(ad(ml(s, thrust), dragY), dt), W.vy);
    const nx = ad(ml(W.vx, dt), old[0]);
    let ny = ad(ml(W.vy, dt), old[1]);
    const nz = DIVER.PLANE_Z;

    // the water layers (the sounds of the depth) and the surface
    if (ny <= C.SURFACE_Y) {
      if (this.breathCount === 0) sound.play('BREATHE');
      else { this.breathCount++; if (fr(C.ONE_EIGHTY * wd.dt) < this.breathCount) this.breathCount = 0; }
      sound.stop('WATER_SURFACE');
      if (this.surfaceFlag) { sound.play('SUBMERGE'); this.surfaceFlag = false; }
      if (C.SURFACE_Y <= ny || ny <= C.ZERO) {
        if (C.ZERO <= ny || ny <= C.MINUS_HUNDRED) {
          // (WP-VERIFY: the handles of the three bands are DAT_05d5acb8 = 0x42 deep (below -100), DAT_05d5acfc = 0x41 mid, DAT_05d5acb0 = 0x40 shallow (0 .. 86.5): asm 0x5c0d2d .. 0x5c0dcc)
          if (ny < C.MINUS_HUNDRED) { sound.play('WATER_DEEP'); sound.stop('WATER_MID'); }
        } else { sound.play('WATER_MID'); sound.stop('WATER_SHALLOW'); sound.stop('WATER_DEEP'); }
      } else { sound.play('WATER_SHALLOW'); sound.stop('WATER_MID'); }
    } else {
      this.deliver();
      ny = C.SURFACE_Y;
      sound.play('WATER_SURFACE'); sound.stop('WATER_SHALLOW');
      const k = env.rng.int(fr(C.WAVE_RANGE * wd.dt));   // FUN_004388ae(_DAT_00892388 * DAT_008b1718), truncated: 0 .. 60 (30 at the 60 Hz step)
      if (k > fr(C.FIFTY * wd.dt)) sound.play('WAVE1'); else if (k < fr(C.TEN * wd.dt)) sound.play('WAVE2');
      this.surfaceFlag = true;
    }

    // the quad he occupies at the new place
    const pts = rotateShape(DIVER.SHAPES[this.shape], 4, hp);
    for (const p of pts) { p[0] = ad(p[0], nx); p[1] = ad(p[1], ny); }
    const hurt = env.hurt.test(pts, 4);
    if (hurt) {
      switch (hurt.category) {
        case 1: this.drop(rec); this.knock(); break;
        case 2:
          this.drop(rec); this.knock();
          this.flicker = DIVER.STUN; this.stun = DIVER.STUN;
          sound.play(env.rng.int(2) >= 1 ? 'SHOCK1' : 'SHOCK4');
          env.state.speak(SPEECH.HIT);
          break;
        case 3: this.drop(rec); this.knock(); break;
        case 4: {
          const p = env.nodeOf<PirateNode>(hurt.rec);
          if (p.slashing()) { p.rest(); this.drop(rec); }
          break;
        }
      }
    }
    let clamTop = false, clamBottom = false, blockedNow = false;
    const q = castQuad(wd, pts, 4, rec, this.obstacles);
    const oldPos = old;
    for (const h of q.hits) {
      switch (this.classOf.get(h) ?? -1) {
        case HIT_CLASS.SOLID: blockedNow = true; break;
        case HIT_CLASS.BRICK: this.pickBrick(h); break;
        case HIT_CLASS.PAGE: this.takePage(h); break;
        case HIT_CLASS.ANCHOR: {
          const a = env.records[REC.ANCHOR];
          const v = env.nodeOf<AnchorNode>(a).push(a, oldPos);
          W.vx = v[0]; W.vy = v[1]; W.vz = v[2];
          W.angVel = hitSpin(oldPos, q.point);
          sound.play('HIT_ANCHOR');
          this.drop(rec);
          break;
        }
        case HIT_CLASS.CLAM_TOP: sound.play('INSIDE_CLAM2'); clamTop = true; break;
        case HIT_CLASS.CLAM_BOT: sound.play('INSIDE_CLAM1'); clamBottom = true; break;
        case HIT_CLASS.BALL: {
          sound.play('CLANG');
          const ball = env.nodeOf<BallNode>(h);
          const v = ball.velocity();
          W.vx = v[0]; W.vy = v[1]; W.vz = v[2];
          W.angVel = hitSpin(oldPos, q.point);
          ball.deactivate(h);
          (env.nodeOf(R[REC.CANNON]) as unknown as CannonNode).giveBack(h);
          this.drop(rec);
          break;
        }
        case HIT_CLASS.TENTACLE: {
          const arm = R[REC.OCTC];
          const v = env.nodeOf<OctopusNode>(R[REC.OCTO]).push(arm, oldPos);
          W.vx = v[0]; W.vy = v[1]; W.vz = v[2];
          sound.play('TENTACLE_HIT');
          this.drop(rec);
          break;
        }
      }
    }
    const clam = env.nodeOf<ClamNode>(R[REC.CLAM_TOP]);
    if (!clam.holding) {
      sound.stop('CLAM_CATCH');
      this.clamCatching = false;
    } else {
      clamTop = true; clamBottom = false;
      if (!this.clamCatching) { sound.play('CLAM_CATCH'); this.clamCatching = true; }
    }
    if (clamTop) {
      const t = clam.touch(R[REC.CLAM_TOP], oldPos, heading);
      if (t.vel) { W.vx = t.vel[0]; W.vy = t.vel[1]; W.vz = t.vel[2]; }
      if (t.angVel !== undefined) W.angVel = t.angVel;
    }
    if (clamBottom) blockedNow = true;
    if (blockedNow) this.blocked++;

    if (this.blocked === 2) {
      this.blocked = 0;
      rec.x = this.safe.x; rec.y = this.safe.y; rec.z = DIVER.PLANE_Z;
      W.heading = this.safe.heading;
      W.vx = 0; W.vy = 0; W.angVel = 0;
    } else if (!blockedNow) {
      if (this.shape !== this.wantShape) {
        if (this.wantShape === 0) this.shape = 0;
        else {
          const big = rotateShape(DIVER.SHAPES[1], DIVER.SHAPES[1].length, hp);
          for (const p of big) { p[0] = ad(p[0], nx); p[1] = ad(p[1], ny); }
          if (castQuad(wd, big, 4, rec, this.obstacles).hits.length === 0) this.shape = 1;
        }
      }
      this.blocked = 0;
      this.safe = { x: nx, y: ny, z: nz, heading };
      rec.x = nx; rec.y = ny; rec.z = DIVER.PLANE_Z;
      W.heading = heading;
      rec.rz = heading; rec.ry = -heading;
      this.quad = pts;
      if (this.view === 0) setEuler(rec, rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z);
      else setEuler(R[REC.SKEL], rec.rx, 0, rec.rz, rec.x, rec.y, rec.z);
    } else {
      // blocked: turn and shove away along the surface's normal
      const ang = fr(Math.atan2(q.normal[0], q.normal[2]));
      sound.play('HIT_SAND');
      const a = angleDelta(ang, heading);
      const k = ad(sb(C.ONE, a.frac), sb(C.ONE, a.frac));
      if (a.dir === 1) W.angVel = sb(W.angVel, k);
      if (a.dir === -1) W.angVel = ad(k, W.angVel);
      W.vx = ml(ml(sb(C.ONE, a.frac), C.TWO_EIGHT), q.normal[0]);
      W.vy = ml(ml(sb(C.ONE, a.frac), C.TWO_EIGHT), q.normal[1]);
    }
    this.flickerStep(rec);
    this.timers();
    this.reachBrick(rec);
    if (this.stun === C.ZERO) rec.anim?.advance(1.0, wd.dt);
    R[REC.SKEL].anim?.advance(1.0, wd.dt);
    if (this.flipperFlag) {
      const f = rec.anim?.frame ?? 0;
      // (asm 0x5c17fd: `fcomp [16]; test ah, 1; jne 0x5c182a`: below frame 16 DAT_05d5ac9c (0x31 right) stops and DAT_05d5acd8 (0x30 left) starts, from 16 on the reverse)
      if (f < C.SIXTEEN) { sound.stop('FLIPPER_RIGHT'); sound.play('FLIPPER_LEFT'); } else { sound.stop('FLIPPER_LEFT'); sound.play('FLIPPER_RIGHT'); }
    }
    return NODE_CONTINUE;
  }

  /** FUN_005c202e: while the shock lasts the skeleton is shown and its spark part flickers; afterwards the diver is back */
  private flickerStep(rec: GameRecord) {
    void rec;
    if (this.flicker === C.ZERO) return;
    if (this.view !== 1) { this.setView(1); this.flickerPhase = 0; this.setModel(4); }
    if (this.flickerPhase === 0) this.setModel(4); else this.setModel(3);
    this.flickerPhase ^= 1;
    this.flicker = sb(this.flicker, this.env.clock.dt);
    if (this.flicker < C.ZERO) { this.flicker = 0; this.setView(0); this.flipperFlag = true; }
  }

  /** FUN_005c2126 */
  private timers() {
    const dt = this.env.clock.dt;
    if (this.spare !== C.ZERO) { this.spare = sb(this.spare, dt); if (this.spare < C.ZERO) this.spare = 0; }
    if (this.stun !== C.ZERO) { this.stun = sb(this.stun, dt); if (this.stun < C.ZERO) this.stun = 0; }
  }

  /** FUN_005c21ea: within 10 units of a brick (and not carrying one) the reach clip plays */
  private reachBrick(rec: GameRecord) {
    if (this.held) return;
    const R = this.env.records;
    let i = 0;
    for (; i < 5; i++) {
      const b = R[REC.BRICKS[i]];
      const dx = sb(b.x, rec.x), dy = sb(b.y, rec.y), dz = sb(b.z, rec.z);
      if (ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz)) < C.HUNDRED) {
        if (this.nearBrick !== 1 || this.view === 1) { this.reachClip(1); this.nearBrick = 1; }
        break;
      }
    }
    if (i === 5 && (this.nearBrick !== 0 || this.view === 1)) { this.reachClip(0); this.nearBrick = 0; }
  }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ camera

/**
 * FUN_005c03f0: a side view that follows the diver: the eye height, the target height and the eye distance are interpolated from the rows of the table at 0x9038f0 by the
 * diver's depth; the eye slides a little against the diver's x (parallax 15 * x / 40), the target a little along it.
 */
export function cameraFor(pos: ArrayLike<number>, c: ArrayLike<number> & { [i: number]: number }, table: readonly (readonly number[])[] = CAMERA_TABLE) {
  const y = pos[1];
  let i = 0;
  while (i < table.length && y <= table[i][0]) i++;
  let eyeY: number, eyeZ: number, tgtY: number, f = 0;
  if (i === 0 || i === table.length) { eyeY = y; eyeZ = CAMERA_FAR_Z; tgtY = y; }
  else {
    // asm 0x5c03f0: the blends are summed in a register ((a - b) * f + b + y) and stored once as float32
    f = dv(sb(y, table[i][0]), sb(table[i - 1][0], table[i][0]));
    eyeY = ad(ad(ml(sb(table[i - 1][1], table[i][1]), f), table[i][1]), y);
    tgtY = ad(ad(ml(sb(table[i - 1][2], table[i][2]), f), table[i][2]), y);
    eyeZ = ad(ad(ml(sb(table[i - 1][3], table[i][3]), f), table[i][3]), 0);
  }
  // asm 0x5c056c: q = float32(x / 40) is stored; the target's shift is float32(15 q * 0.3) (the product 15 q goes on in the register), the eye's float32(15 q)
  const q = dv(pos[0], CAMERA_PARALLAX.DIVISOR);
  let side = ml(ml(CAMERA_PARALLAX.SCALE, q), C.POINT_THREE);     // _DAT_0089245c is the float32 0.3
  if (i === 1) side = ml(sb(C.ONE, f), side);
  const tx = ad(side, pos[0]);
  let eyeSide = ml(CAMERA_PARALLAX.SCALE, q);
  if (i === 1) eyeSide = ml(sb(C.ONE, f), eyeSide);
  const out = c as unknown as number[];
  out[0] = sb(pos[0], eyeSide); out[1] = eyeY; out[2] = eyeZ;
  out[3] = tx; out[4] = tgtY; out[5] = pos[2];
}

export class CamNode extends BkdNode {
  readonly kind = 'CamBeh';
  bind(env: Env, rec: GameRecord) {
    super.bind(env, rec);
    // FUN_005c06d7: DAT_009da5e8.. = eye (0, 60, 40), target (0, 60, 0)
    const c = env.world.camera.c;
    c[0] = 0; c[1] = 60; c[2] = 40; c[3] = 0; c[4] = 60; c[5] = 0;
    env.world.camera.updateView(); env.world.camera.savePrev();
  }
  update(w: World, rec: GameRecord, _c: Controller): number {
    void _c;
    cameraFor([rec.x, rec.y, rec.z], w.camera.c as unknown as number[]);
    return NODE_STOP;
  }
}

export { SND };
