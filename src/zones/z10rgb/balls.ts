// z10RGB: the cannonball pool shared by the player's cannons and the nine enemy cannons (docs/re/m6/z10RGB.md section 5): ten balls (records CB00..CB09, stride
// 0xa8 at DAT_05d5b428), each with a small state machine 0 free / 1 reserved / 2 flying / 3 splash / 4 done. Ported from
//   FUN_005f8197 (take a free ball)  FUN_005f825a (give it back)  FUN_005f895d (launch)  FUN_005f8a7b (one flight step)
//   FUN_005f8291 (collision, the near miss / hit test against Pepper)  FUN_005f8f91 (the pool update, once per tick before the controllers)
// The ground samples of FUN_005f8a7b (five rays down for the ball shadow) are computed (`groundSamples`): the shadow FUN_005f90f7 draws on the model CSHD from them is the
// renderer's part (not drawn yet: `Ball.shadow` / `Ball.samples` are the data it needs).
import type { Hit } from '../../game/collision.ts';
import { RF_ENABLED } from '../../game/record.ts';
import { K, f32 } from './consts.ts';
import type { Ball, RgbState } from './shared.ts';

/** `FUN_005f825a`: where a free ball waits (0xc5fa0000) */
export const PARKED_Y = -8000;
/** the ball's collision mask (FUN_00441a90 / FUN_00441b10 call with 2) and the sweep radius 0.01 (0x3c23d70a), skin 0 */
const MASK = 2, RADIUS = 0.01;
/** the ground samples: the rays start 80 above the ball (_DAT_008921b0) and go 2400 down (DAT_0090bf28 = (0, -2400, 0)); the corners lie 0.1 * 8 beside the middle
 *  (_DAT_0090bf68 * _DAT_00892090) and the points are lifted by 0.1 * 8 (_DAT_0090bf6c * _DAT_00892090) */
const SAMPLE_UP = 80, SAMPLE_DOWN = [0, f32(0xc5160000), 0] as const, SAMPLE_SIDE = f32(0x3dcccccd), SAMPLE_SCALE = 8, SAMPLE_LIFT = f32(0x3dcccccd);
const FAR = [-107374176, -107374176, -107374176];

/**
 * the landing sound slot (FUN_005f8291 at 0x5f83f9 ..): the original compares the ball record's name with "CB00" and only then with "CB01": a nested chain whose deeper tests can never match,
 * so the ball CB00 uses the slot DAT_05d5b3c4 (the first loaded: land0) and every other ball DAT_05d5b3a8 (the last loaded: land9), not one slot per ball
 */
export const landSlot = (b: Ball): number => (b.idx === 0 ? 0 : 9);

/** FUN_005f8197: the first free ball (state 0), marked reserved and shown; null when all ten are in use */
export function allocBall(st: RgbState): Ball | null {
  for (const b of st.balls) {
    if (b.state !== 0) continue;
    b.state = 1;
    b.rec.flags |= RF_ENABLED;
    return b;
  }
  return null;
}

/** FUN_005f825a: back to the pool (parked far below the world) */
export function releaseBall(b: Ball): void {
  b.rec.m[13] = PARKED_Y;
  b.rec.savePrev();
  b.hit = null;
  b.state = 0;
}

/** FUN_005f895d(ball, rec, angle, speed): start the flight at the ball's record position with the launch vector `dir` already stored; `pitch` = launch angle */
export function launchBall(b: Ball, pitch: number): void {
  b.t = 0;
  b.start = [b.rec.x, b.rec.y, b.rec.z];
  const angle = Math.fround(pitch);                      // the angle is a float argument, cos / sin are stored as single floats (+0x38 / +0x3c)
  b.cos = Math.fround(Math.cos(angle));
  b.sin = Math.fround(Math.sin(angle));
  b.state = 2;
}

/** where a launched ball is placed: the muzzle, with the launch vector (FUN_005f6120 / FUN_0061a06a) */
export function placeBall(b: Ball, pos: ArrayLike<number>, dir: ArrayLike<number>): void {
  b.rec.m[12] = pos[0]; b.rec.m[13] = pos[1]; b.rec.m[14] = pos[2];
  b.rec.savePrev();           // the renderer must not slide the ball from its parking place
  b.dir = [Math.fround(dir[0]), Math.fround(dir[1]), Math.fround(dir[2])];     // single floats in the ball's struct (+8 .. +0x10)
}

/** FUN_005f8a7b: one step of the flight: horizontal speed cos * dir, vertical speed dir.y * sin - t * g (t counts ticks since the launch) */
export function stepBall(st: RgbState, b: Ball, dt = 1): void {
  b.t = Math.fround(dt + b.t);                            // the time in the ball's struct is a single float (+0x40)
  // the x87 runs in 24-bit precision: every operation is rounded to a float (the speed is stored, then scaled by the step and stored again)
  const F = Math.fround;
  b.vel[0] = F(F(b.cos * dt) * b.dir[0]);
  b.vel[1] = F(F(F(b.dir[1] * b.sin) - F(b.t * st.g)) * dt);
  b.vel[2] = F(F(b.cos * dt) * b.dir[2]);
  b.rec.m[12] += b.vel[0]; b.rec.m[13] += b.vel[1]; b.rec.m[14] += b.vel[2];
  groundSamples(st, b);
}

/**
 * the end of FUN_005f8a7b: five points on the ground below the ball for its shadow. A ray from 80 above the ball straight down against LAND gives the middle point (slot 1);
 * four more rays from 0.8 beside it (80 above its height) give the corners (slots 0, 2, 3, 4: (-,+) (-,-) (+,-) (+,+)), a corner that finds no ground gets y = 0; all five are
 * then lifted by 0.8. The flag `shadow` is 0 when the middle ray finds nothing (the points are then left as they were).
 */
export function groundSamples(st: RgbState, b: Ball): void {
  const col = st.w.col, rec = b.rec, S = b.samples;
  b.shadow = 0;
  const h = col.rayRecord(st.land, [rec.m[12], Math.fround(rec.m[13] + SAMPLE_UP), rec.m[14]], SAMPLE_DOWN, MASK, RADIUS, 0);
  if (!h) return;
  b.shadow = 1;
  const d = SAMPLE_SIDE * SAMPLE_SCALE;
  const hx = Math.fround(h.point[0]), hy = Math.fround(h.point[1]), hz = Math.fround(h.point[2]);
  S[3] = hx; S[4] = hy; S[5] = hz;
  const corners: [number, number, number][] = [[0, -d, d], [2, -d, -d], [3, d, -d], [4, d, d]];
  for (const [k, ox, oz] of corners) { S[3 * k] = hx + ox; S[3 * k + 1] = hy + SAMPLE_UP; S[3 * k + 2] = hz + oz; }
  for (const [k] of corners) {
    const c = col.rayRecord(st.land, [S[3 * k], S[3 * k + 1], S[3 * k + 2]], SAMPLE_DOWN, MASK, RADIUS, 0);
    if (c) { S[3 * k] = c.point[0]; S[3 * k + 1] = c.point[1]; S[3 * k + 2] = c.point[2]; } else S[3 * k + 1] = 0;
  }
  const lift = SAMPLE_LIFT * SAMPLE_SCALE;
  for (let k = 0; k < 5; k++) S[3 * k + 1] += lift;
}

/**
 * FUN_005f8291: what the ball hit this tick. A backwards sweep of the last step against everything with mask-2 polygons (the cannons, ...) hides the ball and
 * remembers the record; a ray of one step ahead against LAND and BUNS puts the ball on the surface (the hit is LAND). A ball that lands within 4 units of Pepper
 * (squared 16) hits him (the hit record is Pepper: the enemy cannon node turns that into the mode change), within 6 (squared 36) it is a near miss.
 */
export function collideBall(st: RgbState, b: Ball): void {
  const w = st.w, rec = b.rec;
  const pos = [rec.x, rec.y, rec.z];
  const back = [-b.vel[0], -b.vel[1], -b.vel[2]];
  const s: Hit | null = w.col.sweep(rec, pos, back, MASK, RADIUS, 0);
  b.hit = s ? s.rec : null;
  if (b.hit) rec.flags &= ~RF_ENABLED;
  const a = w.col.rayRecord(st.land, pos, b.vel, MASK, RADIUS, 0);
  const c = w.col.rayRecord(st.buns, pos, b.vel, MASK, RADIUS, 0);
  let point: number[] | null = null;
  if (a) point = a.point;
  if (c) point = c.point;      // the second ray writes its point last
  if (c) st.cue?.('rgb-castle-hit', c.point);
  if (point) {
    rec.m[12] = point[0]; rec.m[13] = point[1]; rec.m[14] = point[2];
    b.hit = st.land;
    st.sound.at(`land${landSlot(b)}`, point);
    st.fx.ballOn(b);               // FUN_00442a20(handle, 2, 1, 1) + FUN_00442a00(handle, the ball's matrix) when it has a handle
    const dx = st.pepperPos[0] - point[0], dy = st.pepperPos[1] - point[1], dz = st.pepperPos[2] - point[2];
    if (dx > -K.NEAR_BOX && dx < K.NEAR_BOX && dz > -K.NEAR_BOX && dz < K.NEAR_BOX) {
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= K.HIT_R2) {
        if (d2 < K.MISS_R2) {
          const r = Math.trunc(st.rand(90));
          st.sound.at(r < 60 ? (r < 30 ? 'nearmiss1' : 'nearmiss2') : 'nearmiss3', st.pepperPos);
          st.say('CASGRB07');
        }
      } else b.hit = st.pepper;      // direct hit: the knock-back direction DAT_05d5bb08 .. 10 is stored by the original and never read
    }
  }
  if (rec.y < 0) {
    b.hit = st.land;                   // fell into the sea
    // the original passes its local point: written by the sweep's hit (when it found one), then by the rays; with no hit at all it is uninitialised (0xcccccccc floats: inaudibly far away)
    st.sound.at('land0', point ?? (s ? s.point : FAR));      // the sea always uses the first slot (DAT_05d5b3c4)
  }
}

/** FUN_005f8f91: the pool, once per tick in the play and the banner modes before the controllers run */
export function updateBalls(st: RgbState): void {
  for (const b of st.balls) {
    if (b.state === 2) {
      if (b.idx === 0) st.sound.at('fly', [b.rec.x, b.rec.y, b.rec.z]);
      stepBall(st, b, st.w.dt);
      collideBall(st, b);
      if (b.hit) {
        b.count = 0;
        b.state = 3;
        if (b.idx === 0) st.sound.stop('fly');
      }
    } else if (b.state === 3) {
      b.count++;
      if (b.count === 2) st.fx.ballOff(b);        // FUN_00442a20(handle, 1, 1, 1)
      if (b.count > K.SPLASH - 1) b.state = 4;
    } else if (b.state === 4) releaseBall(b);
  }
}

