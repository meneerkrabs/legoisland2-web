// z10RGB: the zone's sound slots (FUN_005f6470): a name -> sound-table id (+ 2D / 3D) table loaded through the audio engine (the original loads every slot when
// the loop starts and plays them by slot). DOM-free: the backend is an interface (the browser passes `GameAudio.sfx`, tests pass a recorder or nothing).
import { SND } from './consts.ts';
import type { SoundSink } from './shared.ts';

export interface SoundBackend {
  load2D(id: number): Promise<unknown>;
  load3D(id: number): Promise<unknown>;
  play2D(slot: never): boolean;
  play3D(slot: never, pos: { x: number; y: number; z: number }): boolean;
  stop(slot: never): void;
}
export interface SoundDef { id: number; kind: '2d' | '3d' }

/** the slots of FUN_005f6470 by the names the nodes use (the ten ball-landing slots all load the same sound: a ball has its own so that landings can overlap) */
export const SOUND_DEFS: Record<string, SoundDef> = {
  wind: { id: SND.WIND, kind: '2d' }, crow1: { id: SND.CROW1, kind: '2d' }, crow2: { id: SND.CROW2, kind: '2d' },
  fire: { id: SND.CANNON_FIRE, kind: '2d' }, dry: { id: SND.CANNON_DRY, kind: '2d' }, reload: { id: SND.CANNON_RELOAD, kind: '2d' }, ready: { id: SND.CANNON_READY, kind: '2d' },
  swivel: { id: SND.CANNON_SWIVEL, kind: '2d' }, tilt: { id: SND.CANNON_TILT, kind: '2d' }, explode2d: { id: SND.EXPLODE_2D, kind: '2d' },
  cedCannon: { id: SND.CED_CANNON, kind: '3d' }, cedHit: { id: SND.CED_CANNON_HIT, kind: '3d' }, fly: { id: SND.BALL_FLY, kind: '3d' },
  jump1: { id: SND.CED_JUMP1, kind: '3d' }, jump2: { id: SND.CED_JUMP2, kind: '3d' }, wave1: { id: SND.CED_WAVE1, kind: '3d' }, wave2: { id: SND.CED_WAVE2, kind: '3d' },
  lose1: { id: SND.CED_LOSE1, kind: '3d' }, lose2: { id: SND.CED_LOSE2, kind: '3d' },
  nearmiss1: { id: SND.NEARMISS1, kind: '3d' }, nearmiss2: { id: SND.NEARMISS2, kind: '3d' }, nearmiss3: { id: SND.NEARMISS3, kind: '3d' },
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`land${i}`, { id: SND.BALL_LAND, kind: '3d' } as SoundDef])),
};

/** one event of the bank (tests assert on these) */
export interface SoundEvent { op: 'play' | 'at' | 'stop'; name: string; pos?: number[] }

export class SoundBank implements SoundSink {
  private slots = new Map<string, unknown>();
  private backend: SoundBackend | null;
  /** every call made (a ring of the last 2000) */
  log: SoundEvent[] = [];
  counts = new Map<string, number>();
  ready: Promise<void> = Promise.resolve();
  constructor(backend: SoundBackend | null) { this.backend = backend; }

  load(): Promise<void> {
    const b = this.backend;
    if (!b) return this.ready;
    const jobs: Promise<void>[] = [];
    for (const [name, d] of Object.entries(SOUND_DEFS)) jobs.push((d.kind === '2d' ? b.load2D(d.id) : b.load3D(d.id)).then((s) => { this.slots.set(name, s); }, () => { /* silent */ }));
    this.ready = Promise.all(jobs).then(() => undefined);
    return this.ready;
  }
  private note(e: SoundEvent) {
    this.log.push(e);
    if (this.log.length > 2000) this.log.splice(0, 1000);
    const k = `${e.op}:${e.name}`;
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
  }
  count(op: SoundEvent['op'], name: string) { return this.counts.get(`${op}:${name}`) ?? 0; }
  play(name: string) {
    this.note({ op: 'play', name });
    const s = this.slots.get(name);
    if (s !== undefined) try { this.backend?.play2D(s as never); } catch { /* silent */ }
  }
  at(name: string, pos: ArrayLike<number>) {
    this.note({ op: 'at', name, pos: [pos[0], pos[1], pos[2]] });
    const s = this.slots.get(name);
    if (s !== undefined) try { this.backend?.play3D(s as never, { x: pos[0], y: pos[1], z: pos[2] }); } catch { /* silent */ }
  }
  stop(name: string) {
    this.note({ op: 'stop', name });
    const s = this.slots.get(name);
    if (s !== undefined) try { this.backend?.stop(s as never); } catch { /* silent */ }
  }
  /** FUN_005f675a: the loops stop when the zone ends */
  stopAll() { for (const s of this.slots.values()) try { this.backend?.stop(s as never); } catch { /* silent */ } }
}
