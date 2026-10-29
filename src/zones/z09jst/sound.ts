// The sounds of the jousting zone (FUN_005d24b0 loads them: 17 2D sounds with FUN_00443580, 26 3D sounds with FUN_004433b0; the ids and names come from the executable's
// sound table, `SND_*_JST`, `SND_HOOF_*`, `SND_CROWD_*`). Works on the engine's `SoundEngine` (src/audio/sfx.ts); without audio (tests, muted) everything is a no-op
// except the call log tests read.
import type { GameAudio } from '../../audio/index.ts';
import type { DuelSound } from './duel.ts';
import { ALL_2D, ALL_3D } from './consts.ts';

type Sfx = GameAudio['sfx'];
type Slot = Awaited<ReturnType<Sfx['load2D']>>;

export class JoustSound implements DuelSound {
  private sfx: Sfx | null;
  private s2 = new Map<number, Slot>();
  private s3 = new Map<number, Slot>();
  ready = false;
  /** set by tests: every call made ("p2 93", "s2 248", "p3 78", "r 248 24500") */
  log: string[] | null = null;

  constructor(ga: GameAudio | null) { this.sfx = ga?.sfx ?? null; }

  async load() {
    const sfx = this.sfx;
    if (!sfx) { this.ready = true; return; }
    try {
      for (const id of ALL_2D) this.s2.set(id, await sfx.load2D(id));
      for (const id of ALL_3D) this.s3.set(id, await sfx.load3D(id));
    } catch (e) { console.warn('z09JST sounds', e); }
    this.ready = true;
  }

  play2D(id: number) { this.log?.push(`p2 ${id}`); const s = this.s2.get(id); if (s && this.ready) this.sfx?.play2D(s); }
  stop2D(id: number) { this.log?.push(`s2 ${id}`); const s = this.s2.get(id); if (s) this.sfx?.stop(s); }
  play3D(id: number, pos: ArrayLike<number>) { this.log?.push(`p3 ${id}`); const s = this.s3.get(id); if (s && this.ready) this.sfx?.play3D(s, { x: pos[0], y: pos[1], z: pos[2] }); }
  rate(id: number, hz: number) { this.log?.push(`r ${id} ${hz}`); const s = this.s2.get(id); if (s) this.sfx?.setRate(s, hz); }

  /** the listener = the camera (FUN_005cd2ee feeds the camera to the sound layer) */
  listener(eye: ArrayLike<number>, target: ArrayLike<number>) {
    let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
    const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    this.sfx?.setListener({ x: eye[0], y: eye[1], z: eye[2] }, { x: fx, y: fy, z: fz }, { x: 0, y: 1, z: 0 });
  }

  stopAll() {
    for (const s of this.s2.values()) this.sfx?.stop(s);
    for (const s of this.s3.values()) this.sfx?.stop(s);
  }
}
