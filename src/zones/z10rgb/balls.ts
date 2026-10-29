// z10RGB: the cannonball pool shared by the player's cannons and the nine enemy cannons (docs/re/m6/z10RGB.md section 5): ten balls (records CB00..CB09, stride
// 0xa8 at DAT_05d5b428), each with a small state machine 0 free / 1 reserved / 2 flying / 3 splash / 4 done. Ported from
//   FUN_005f8197 (take a free ball)  FUN_005f825a (give it back)  FUN_005f895d (launch)  FUN_005f8a7b (one flight step)
//   FUN_005f8291 (collision, the near miss / hit test against Pepper)  FUN_005f8f91 (the pool update, once per tick before the controllers)
// The ground samples of FUN_005f8a7b (five rays down for the ball shadow FUN_005f90f7 draws on the model CSHD) are not ported.
import type { Hit } from '../../game/collision.ts';
import { RF_ENABLED } from '../../game/record.ts';
import { K } from './consts.ts';
import type { Ball, RgbState } from './shared.ts';

/** `FUN_005f825a`: where a free ball waits (0xc5fa0000) */
export const PARKED_Y = -8000;
/** the ball's collision mask (FUN_00441a90 / FUN_00441b10 call with 2) and the sweep radius 0.01 (0x3c23d70a), skin 0 */
const MASK = 2, RADIUS = 0.01;
const FAR = [-107374176, -107374176, -107374176];

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
  b.cos = Math.cos(pitch);
  b.sin = Math.sin(pitch);
  b.state = 2;
}

/** where a launched ball is placed: the muzzle, with the launch vector (FUN_005f6120 / FUN_0061a06a) */
export function placeBall(b: Ball, pos: ArrayLike<number>, dir: ArrayLike<number>): void {
  b.rec.m[12] = pos[0]; b.rec.m[13] = pos[1]; b.rec.m[14] = pos[2];
  b.rec.savePrev();           // the renderer must not slide the ball from its parking place
  b.dir = [dir[0], dir[1], dir[2]];
}

/** FUN_005f8a7b: one step of the flight: horizontal speed cos * dir, vertical speed dir.y * sin - t * g (t counts ticks since the launch) */
export function stepBall(st: RgbState, b: Ball, dt = 1): void {
  b.t += dt;
  b.vel[0] = Math.fround(b.cos * dt * b.dir[0]);          // the original stores single floats
  b.vel[1] = Math.fround((b.dir[1] * b.sin - b.t * st.g) * dt);
  b.vel[2] = Math.fround(b.cos * dt * b.dir[2]);
  b.rec.m[12] += b.vel[0]; b.rec.m[13] += b.vel[1]; b.rec.m[14] += b.vel[2];
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
  if (point) {
    rec.m[12] = point[0]; rec.m[13] = point[1]; rec.m[14] = point[2];
    b.hit = st.land;
    st.sound.at(`land${b.idx}`, point);
    st.fx('impact', point);
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
    st.sound.at(`land${b.idx}`, point ?? FAR);   // the original passes its uninitialised point (0xcccccccc floats): inaudibly far away
  }
}

/** FUN_005f8f91: the pool, once per tick in the play and the banner modes before the controllers run */
export function updateBalls(st: RgbState): void {
  for (const b of st.balls) {
    if (b.state === 2) {
      if (b.idx === 0) st.sound.at('fly', [b.rec.x, b.rec.y, b.rec.z]);
      stepBall(st, b);
      collideBall(st, b);
      if (b.hit) {
        b.count = 0;
        b.state = 3;
        if (b.idx === 0) st.sound.stop('fly');
      }
    } else if (b.state === 3) {
      b.count++;
      if (b.count === 2) st.fx('splash', [b.rec.x, b.rec.y, b.rec.z]);
      if (b.count > K.SPLASH - 1) b.state = 4;
    } else if (b.state === 4) releaseBall(b);
  }
}

