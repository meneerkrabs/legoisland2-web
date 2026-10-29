// The robots of Ogel's island (PeppSwit.c ctor 0x7e61e9, 5 attaches RBT0..RBT4; vtable 0x94c778 = { update FUN_007e5fb4, pre-render FUN_007e6135 (returns 1), destroy FUN_007e6276,
// draw FUN_007e614f (the default draw, returns 1), load FUN_007e61b0, save FUN_007e618b }). A robot idles (clip 1) while Pepper is far (squared distance >= 256) and turns to face him
// (clip 3) when he comes closer; the constructor reads no argument.
import type { BehaviourNode, Controller } from '../../../game/controller.ts';
import { NODE_STOP } from '../../../game/controller.ts';
import type { GameRecord } from '../../../game/record.ts';
import type { World } from '../../../game/world.ts';
import { fr, rotateFromEuler } from './util.ts';

export const ROBOT = {
  /** _DAT_008921e8: the squared distance (to Pepper, in the XZ plane: the controller's) from which the robot stops watching */ FAR2: 256.0,
  /** _DAT_00892060: the frame up to which the watching clip plays; it holds there while Pepper is near */ HOLD_FRAME: 10.0,
  IDLE_CLIP: 1, WATCH_CLIP: 3,
} as const;

export class RobotNode implements BehaviourNode {
  readonly kind = 'PeppRobot';
  var = 2; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** +0x15 (byte): the state the save game keeps (never written by the code) */
  state = 0;
  private inited = false;

  /** FUN_007e61e9: clip 1 */
  private init(rec: GameRecord) { this.inited = true; rec.anim?.start(ROBOT.IDLE_CLIP, 0); }

  /** FUN_007e5fb4: returns 1 */
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.inited) this.init(rec);
    const a = rec.anim;
    if (!a) return NODE_STOP;
    let clip = a.clip;
    const far = ROBOT.FAR2 <= ctrl.distSq;
    if (far || clip !== ROBOT.WATCH_CLIP) {
      const r = a.advance(1.0, w.dt);
      if (r !== 0) {
        const want = far ? ROBOT.IDLE_CLIP : ROBOT.WATCH_CLIP;
        if (clip !== want) { a.start(want, 0); clip = want; }
      }
    } else if (a.frame < ROBOT.HOLD_FRAME) a.advance(1.0, w.dt);
    if (clip === ROBOT.WATCH_CLIP) {
      const p = w.focus;
      if (p) {
        const dx = fr(p.m[12] - rec.m[12]), dz = fr(p.m[14] - rec.m[14]);
        rec.ry = fr(Math.atan2(dx, dz));
        rotateFromEuler(rec, rec.rx, rec.ry, rec.rz);
      }
    }
    return NODE_STOP;
  }

  /** FUN_007e618b / FUN_007e61b0: one byte */
  saveBlob(): Uint8Array { return new Uint8Array([this.state & 0xff]); }
  loadBlob(b: Uint8Array): void { this.state = b[0]; this.inited = true; }
}
