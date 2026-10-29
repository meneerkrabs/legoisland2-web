// The slugs of Ogel's island (PeppSwit.c ctor 0x7e5ea7, 8 attaches SLG0..SLG7; vtable 0x94c760 = { update FUN_007e5448, pre-render FUN_007e5df3 (returns 1), destroy FUN_007e5f75,
// draw FUN_007e5e0d (the default draw, returns 1), load FUN_007e5e6e, save FUN_007e5e49 }). A slug crawls along the surface under it at 0.08 per tick, glued to the ground by three
// sweeps it takes in turn (down, ahead, behind), turns its up vector to the surface normal, heads for its home spot (state 0), lunges at Pepper when he comes within 16 (state 1) and
// bites when he is within 4 (state 2: the walk code's jump / stagger, mailbox 1).
import type { BehaviourNode, Controller } from '../../../game/controller.ts';
import { NODE_NONE, NODE_STOP } from '../../../game/controller.ts';
import type { GameRecord } from '../../../game/record.ts';
import type { World } from '../../../game/world.ts';
import { cutsceneActive } from '../../../island/vehicles/common.ts';
import { oglGlobals, SND, play2d, play3d } from './globals.ts';
import { fr, normLen, norm, sweepF, setEulerExact } from './util.ts';
import type { V3 } from './util.ts';

/** the uninitialised words of the node block (debug heap fill 0xCD): float 0xcdcdcdcd */
const CD_FLOAT = -431602080;

/** the constants of FUN_007e5448 (the .rdata floats of 0x892xxx) */
export const SLUG = {
  /** _DAT_0089212c: the crawl speed per tick (not scaled by dt) */ SPEED: fr(0.08),
  /** _DAT_00892684: the segment's length below the surface */ DOWN: -8.0,
  /** _DAT_00892080: the lift of the first probe along the up vector */ LIFT: 4.0,
  /** _DAT_00892084 / _DAT_00892468: the forward probes: start 0.8 ahead, segment 4 back */ AHEAD: fr(0.8), BACK: -4.0,
  /** the sweep radius (0x3f4ccccd) and the polygon mask */ RADIUS: fr(0.8), MASK: 2,
  /** _DAT_00892528 / _DAT_008921f4: leave the chase beyond 40 from home / start it within 16 of home */ FAR: 40.0, NEAR: 16.0,
  /** _DAT_00892080: bite distance */ BITE: 4.0,
  /** _DAT_0089272c: the chase toggles every 120 ticks */ PERIOD: 120.0,
  /** _DAT_008920cc: the orientation is redone when the target direction and the surface normal differ by more than this (squared) */ TURN2: fr(0.1),
} as const;

export class SlugNode implements BehaviourNode {
  readonly kind = 'PeppSlug';
  var = 2; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** +0x14 / +0x18 / +0x1c: the home spot (the record's place at construction) */
  home: V3 = [0, 0, 0];
  /** +0x20: 0 = crawl home, 1 = chase Pepper, 2 = biting (waits for the clip to end) */
  state = 1;
  /** +0x24: which of the three probes runs this tick; +0x28 (short): consecutive ticks without a surface */
  probe = 0; missed = 0;
  /** +0x2c: the chase / crawl timer (never initialised by the constructor: the debug heap's 0xCD fill) */
  timer = CD_FLOAT;
  private inited = false;

  /** the constructor (FUN_007e5ea7): home = the place, state 1, probe 0, clip 2 */
  private init(rec: GameRecord) {
    this.inited = true;
    this.home = [rec.m[12], rec.m[13], rec.m[14]];
    this.state = 1; this.probe = 0; this.missed = 0;
    rec.anim?.start(2, 0);
  }

  /** FUN_007e5448 */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    if (!this.inited) this.init(rec);
    if (cutsceneActive(w)) return NODE_NONE;       // FUN_0045c432: `xor eax, eax`
    const slug = /^SLG[0-7]/.exec(rec.name);
    if (slug) play3d(w, SND.SLUG[+rec.name[3]], [rec.m[12], rec.m[13], rec.m[14]]);
    if (this.state === 2) {
      // biting: wait until the clip has played out
      const r = rec.anim ? rec.anim.advance(1.0, w.dt) : 0;
      if (r === 0) return NODE_STOP;                 // `mov eax, 1` before the jump to the epilogue (the decompile shows it as a plain return)
      this.state = 0;
      rec.anim?.start(2, 0);
    }
    rec.anim?.advance(1.0, w.dt);
    const m = rec.m;
    const fwd: V3 = [m[8], m[9], m[10]], up: V3 = [m[4], m[5], m[6]];
    // the crawl: 0.08 along the forward vector (24-bit x87: every product and sum rounds to a float)
    const dy = fr(fwd[1] * SLUG.SPEED), dz = fr(fwd[2] * SLUG.SPEED);
    m[12] = fr(fr(fwd[0] * SLUG.SPEED) + m[12]); m[13] = fr(dy + m[13]); m[14] = fr(dz + m[14]);
    const p: V3 = [m[12], m[13], m[14]];
    const down: V3 = [fr(up[0] * SLUG.DOWN), fr(up[1] * SLUG.DOWN), fr(up[2] * SLUG.DOWN)];
    let dir: V3 = [fwd[0], fwd[1], fwd[2]];
    this.timer = fr(fr(1.0 * w.dt) + this.timer);
    let hit = null as ReturnType<typeof sweepF>;
    const ahead: V3 = [fr(dir[0] * SLUG.AHEAD), fr(dir[1] * SLUG.AHEAD), fr(dir[2] * SLUG.AHEAD)];
    const back: V3 = [fr(dir[0] * SLUG.BACK), fr(dir[1] * SLUG.BACK), fr(dir[2] * SLUG.BACK)];
    if (this.probe === 0) {
      // straight down: from 4 above along the up vector, 8 against it
      const s: V3 = [fr(p[0] + fr(up[0] * SLUG.LIFT)), fr(p[1] + fr(up[1] * SLUG.LIFT)), fr(p[2] + fr(up[2] * SLUG.LIFT))];
      w.col.debug?.line('zone', p, [fr(p[0] + down[0]), fr(p[1] + down[1]), fr(p[2] + down[2])], 0xffff0000, 0xffffffff);   // FUN_00445ba0 (LE2.c:246400; Ontwikkelaarshoek)
      hit = sweepF(w, rec, s, down, SLUG.MASK, SLUG.RADIUS, 0);
    } else if (this.probe === 1) {
      // ahead: from 0.8 in front, 4 backwards
      const s: V3 = [fr(p[0] + ahead[0]), fr(p[1] + ahead[1]), fr(p[2] + ahead[2])];
      w.col.debug?.line('zone', s, [fr(s[0] + back[0]), fr(s[1] + back[1]), fr(s[2] + back[2])], 0xff00ff00, 0xffffffff);   // FUN_00445ba0 (LE2.c:246422)
      hit = sweepF(w, rec, s, back, SLUG.MASK, SLUG.RADIUS, 0);
    } else if (this.probe === 2) {
      // behind: the same from 2 below the surface
      const q: V3 = [fr(fr(p[0] - up[0]) - up[0]), fr(fr(p[1] - up[1]) - up[1]), fr(fr(p[2] - up[2]) - up[2])];
      const s: V3 = [fr(q[0] + ahead[0]), fr(q[1] + ahead[1]), fr(q[2] + ahead[2])];
      w.col.debug?.line('zone', s, [fr(s[0] + back[0]), fr(s[1] + back[1]), fr(s[2] + back[2])], 0xff0000ff, 0xffffffff);   // FUN_00445ba0 (LE2.c:246441)
      hit = sweepF(w, rec, s, back, SLUG.MASK, SLUG.RADIUS, 0);
    }
    if (!hit) {
      this.probe++;
      if (2 < this.probe) {
        this.probe = 0;
        this.missed = (this.missed + 1) << 16 >> 16;
        if (2 < this.missed) {
          // no surface for three rounds: back to the home spot
          setEulerExact(rec, rec.rx, rec.ry, rec.rz, this.home[0], this.home[1], this.home[2]);
          this.missed = 0;
        }
      }
      return NODE_STOP;
    }
    this.missed = 0;
    const n: V3 = [hit.normal[0], hit.normal[1], hit.normal[2]];
    const pt: V3 = [hit.point[0], hit.point[1], hit.point[2]];
    // the direction home, then (chasing) the direction to Pepper
    dir = [fr(this.home[0] - m[12]), fr(this.home[1] - m[13]), fr(this.home[2] - m[14])];
    let d = normLen(dir);
    const pep = w.focus;
    if (SLUG.FAR <= d) {
      if (this.state !== 0) { this.state = 0; this.timer = 0; }
    } else {
      if (d < SLUG.NEAR && this.state !== 1) { this.state = 1; this.timer = 0; }
      if (this.state === 1 && pep) {
        dir = [fr(pep.m[12] - m[12]), fr(pep.m[13] - m[13]), fr(pep.m[14] - m[14])];
        d = normLen(dir);
      }
      if (d < SLUG.BITE) {
        // caught him: the walk code's staggering clip (mailbox 1), the two bite sounds, the slug starts its own bite clip
        w.pep.mailbox = 1;
        play2d(w, SND.SLUG_HIT_A);
        play2d(w, SND.SLUG_HIT_B);
        oglGlobals(w).hitBy = rec.index;          // DAT_009da9a8
        rec.anim?.start(1, 0);
        this.state = 2;
      }
    }
    if (SLUG.PERIOD < this.timer) { this.timer = 0; this.state = this.state === 0 ? 1 : 0; }
    // the orientation: up = the surface normal made perpendicular to the heading, right = up x heading; the slug sits on the sweep's contact point
    const e0 = fr(dir[0] - n[0]), e1 = fr(dir[1] - n[1]), e2 = fr(dir[2] - n[2]);
    if (SLUG.TURN2 <= fr(fr(fr(e0 * e0) + fr(e1 * e1)) + fr(e2 * e2))) {
      const dot = fr(fr(fr(n[0] * dir[0]) + fr(n[1] * dir[1])) + fr(n[2] * dir[2]));
      const u: V3 = [fr(n[0] - fr(dot * dir[0])), fr(n[1] - fr(dot * dir[1])), fr(n[2] - fr(dot * dir[2]))];
      norm(u);
      m[0] = fr(fr(u[1] * dir[2]) - fr(u[2] * dir[1])); m[1] = fr(fr(u[2] * dir[0]) - fr(u[0] * dir[2])); m[2] = fr(fr(u[0] * dir[1]) - fr(u[1] * dir[0]));
      m[4] = u[0]; m[5] = u[1]; m[6] = u[2];
      m[8] = dir[0]; m[9] = dir[1]; m[10] = dir[2];
      m[13] = pt[1]; m[12] = pt[0]; m[14] = pt[2];
    }
    return NODE_STOP;
  }

  /** FUN_007e5e49 / FUN_007e5e6e: the 16 bytes the save game keeps (+0x20: state, probe, missed (short), timer) */
  saveBlob(): Uint8Array {
    const b = new Uint8Array(16), dv = new DataView(b.buffer);
    dv.setInt32(0, this.state, true); dv.setInt32(4, this.probe, true); dv.setInt16(8, this.missed, true); dv.setFloat32(12, this.timer, true);
    return b;
  }
  loadBlob(b: Uint8Array): void {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.state = dv.getInt32(0, true); this.probe = dv.getInt32(4, true); this.missed = dv.getInt16(8, true); this.timer = dv.getFloat32(12, true);
    this.inited = true;
  }
}
