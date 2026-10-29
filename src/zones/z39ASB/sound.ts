// Sounds of the asteroid belt (FUN_007b6c20 loads them: 3D near-miss whooshes, 2D engine loops / impacts / yells). The sound table ids and names come from the
// executable's table (SND_ASB_*); the zone reuses the sound bank of z38PAR for nothing audible (the bank loaded by FUN_00443290("Z38PAR") is only its music).
// The sample files with table path "UNDEFINED" (ambience, alarms, thrust start) have no file in the data: loading them gives a silent slot, like the original.
// Works on the engine's `SoundEngine` (src/audio/sfx.ts); with no audio (tests, muted) everything is a no-op.
import type { GameAudio } from '../../audio/index.ts';
import type { BeltEvent } from './belt.ts';
import { EngineModel, ST } from './belt.ts';

/** sound table ids loaded by FUN_007b6c20 (DAT_05d5d4f0 ... DAT_05d5ed5c) */
export const SND = {
  MISS1: 0x1ca, MISS2: 0x1cb,
  IMPACT3: 0x1cc, IMPACT2: 0x1cd, IMPACT1: 0x1ce,
  ENGINE: 0x1fe, ENGINE_IDLE: 0x24f, THRUST: 0x24d, AMBIENCE: 0x200,
  YELL1: 0x202, YELL2: 0x201, ALARM: 0x203, FINAL_ALARM: 0x204, THRUST_START: 0x1ff,
  ENGINE_STOP: 0x36d, GYRO: 0x250,
} as const;
/** the impact sounds by `BeltEvent.impact` (DAT_05d5ed44 + 4 i), the yells by `BeltEvent.yell` (DAT_05d5ed38 + 4 i) */
export const IMPACTS = [SND.IMPACT1, SND.IMPACT2, SND.IMPACT3] as const;
export const YELLS = [SND.YELL1, SND.YELL2] as const;
export const MISSES = [SND.MISS1, SND.MISS2] as const;

type Sfx = GameAudio['sfx'];
type Slot2 = Awaited<ReturnType<Sfx['load2D']>>;

export class BeltSound {
  private sfx: Sfx | null;
  private s2 = new Map<number, Slot2>();
  private s3 = new Map<number, Slot2>();
  private ready = false;
  /** set by tests: every call made is appended ("play 462", "stop 592", "warn 458") */
  log: string[] | null = null;

  constructor(ga: GameAudio | null) { this.sfx = ga?.sfx ?? null; }

  async load() {
    const sfx = this.sfx;
    if (!sfx) { this.ready = true; return; }
    try {
      for (const id of [SND.ENGINE, SND.ENGINE_IDLE, SND.THRUST, SND.GYRO, SND.ENGINE_STOP, SND.YELL1, SND.YELL2, SND.IMPACT1, SND.IMPACT2, SND.IMPACT3, SND.AMBIENCE, SND.ALARM, SND.FINAL_ALARM]) this.s2.set(id, await sfx.load2D(id));
      for (const id of MISSES) this.s3.set(id, await sfx.load3D(id));
    } catch (e) { console.warn('z39ASB sounds', e); }
    this.ready = true;
  }

  private play(id: number) { this.log?.push(`play ${id}`); const s = this.s2.get(id); if (s) this.sfx?.play2D(s); }
  private stop(id: number) { this.log?.push(`stop ${id}`); const s = this.s2.get(id) ?? this.s3.get(id); if (s) this.sfx?.stop(s); }
  private rate(id: number, hz: number) { const s = this.s2.get(id); if (s) this.sfx?.setRate(s, hz); }

  /** FUN_007b63f6 plays these every frame of the zone (a playing loop is only refreshed), FUN_007b6d60 stops everything at the start */
  frame(eye: ArrayLike<number>) {
    if (!this.ready) return;
    this.play(SND.AMBIENCE); this.play(SND.ENGINE); this.play(SND.ENGINE_IDLE);
    this.sfx?.setListener({ x: eye[0], y: eye[1], z: eye[2] }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 });
  }

  /** one tick of the shuttle: the thrust / gyro loops of the state (FUN_007b82dd) and their pitch (FUN_007b6f1f / FUN_007b6de3) */
  tick(state: number, engine: EngineModel) {
    if (!this.ready) return;
    if (state === ST.INTRO) this.play(SND.THRUST);
    if (state === ST.FLY) { this.play(SND.THRUST); this.play(SND.GYRO); }
    this.rate(SND.THRUST, engine.thrustHz);      // FUN_007b6f1f sets the thrust pitch in every state while the spool moves (the end states spool it down)
    if (state <= ST.HIT) this.rate(SND.GYRO, engine.gyroHz);
    if (engine.gyroStopped) { this.stop(SND.GYRO); engine.gyroStopped = false; }
    if (state === ST.END) { this.stop(SND.ENGINE); this.play(SND.ENGINE_IDLE); }
  }

  event(e: BeltEvent) {
    if (!this.ready) return;
    switch (e.type) {
      case 'warn':
        this.log?.push(`warn ${MISSES[e.miss]}`);
        { const s = this.s3.get(MISSES[e.miss]); if (s) this.sfx?.play3D(s, { x: e.pos[0], y: e.pos[1], z: e.pos[2] }); }
        this.play(e.final ? SND.FINAL_ALARM : SND.ALARM);
        break;
      case 'warnEnd':
        for (const id of [SND.ALARM, SND.FINAL_ALARM]) { const s = this.s2.get(id); if (s) this.sfx?.stop(s); }
        for (const id of MISSES) { const s = this.s3.get(id); if (s) this.sfx?.stop(s); }
        break;
      case 'hit':
        this.play(YELLS[e.yell]); this.play(IMPACTS[e.impact]);
        break;
      case 'state':
        // 3 crashed, 4 empty, 5 done: thrust and gyro off, the engine cut-off sound
        if (e.to === ST.CRASHED || e.to === ST.EMPTY || e.to === ST.DONE) { this.stop(SND.THRUST); this.stop(SND.GYRO); this.play(SND.ENGINE_STOP); }
        break;
      default: break;
    }
  }

  /** the end of the zone (FUN_007b63f6 after the loop: stop the engine, play the idle, stop the ambience / gyro; the zone teardown stops everything) */
  stopAll() {
    for (const [id] of this.s2) this.stop(id);
    for (const [id] of this.s3) this.stop(id);
  }
}
