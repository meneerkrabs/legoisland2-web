// The zone's sound slots (FUN_00467370 for z38PAR, FUN_007d0cb0 for z40aPO): a name -> sound-table id (+ 2D / 3D) table, loaded through the audio engine's
// load2D / load3D (the original loads them at zone start and plays them by slot), played with the semantics of the engine (docs/re/audio.md 2.3 - 2.5).
// DOM-free: the backend is an interface (the browser passes `GameAudio.sfx`, tests pass a recorder or nothing).
import type { Vec3 } from './util.ts';

export interface SoundBackend {
  load2D(id: number): Promise<unknown>;
  load3D(id: number): Promise<unknown>;
  play2D(slot: never): boolean;
  play3D(slot: never, pos: { x: number; y: number; z: number }): boolean;
  stop(slot: never): void;
  setRate(slot: never, hz: number): void;
}

export interface SoundDef { id: number; kind: '2d' | '3d' }

/** one event of the bank (tests assert on these; the log is capped) */
export interface SoundEvent { op: 'play' | 'at' | 'stop' | 'rate'; name: string; pos?: Vec3; hz?: number }

export class SoundBank<N extends string = string> {
  readonly defs: Record<N, SoundDef>;
  private slots = new Map<string, unknown>();
  private backend: SoundBackend | null;
  /** every call made (a ring of the last 2000) */
  log: SoundEvent[] = [];
  /** count per op + name, for cheap assertions */
  counts = new Map<string, number>();
  ready: Promise<void> = Promise.resolve();

  constructor(defs: Record<N, SoundDef>, backend: SoundBackend | null) {
    this.defs = defs; this.backend = backend;
  }

  /** FUN_00467370: load every slot (the original loads them all before the zone starts) */
  load(): Promise<void> {
    const b = this.backend;
    if (!b) return this.ready;
    const jobs: Promise<void>[] = [];
    for (const [name, d] of Object.entries(this.defs) as [N, SoundDef][]) {
      jobs.push((d.kind === '2d' ? b.load2D(d.id) : b.load3D(d.id)).then((s) => { this.slots.set(name, s); }, () => { /* silent */ }));
    }
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

  /** FUN_004435a0 (2D play / refresh) */
  play(name: N) {
    this.note({ op: 'play', name });
    const s = this.slots.get(name);
    if (s !== undefined) try { this.backend?.play2D(s as never); } catch { /* silent */ }
  }
  /** FUN_004433f0 (3D play / refresh at a position) */
  at(name: N, pos: ArrayLike<number>) {
    this.note({ op: 'at', name, pos: [pos[0], pos[1], pos[2]] });
    const s = this.slots.get(name);
    if (s !== undefined) try { this.backend?.play3D(s as never, { x: pos[0], y: pos[1], z: pos[2] }); } catch { /* silent */ }
  }
  /** FUN_004435b0 / FUN_004434b0 */
  stop(name: N) {
    this.note({ op: 'stop', name });
    const s = this.slots.get(name);
    if (s !== undefined) try { this.backend?.stop(s as never); } catch { /* silent */ }
  }
  /** FUN_00443600 */
  rate(name: N, hz: number) {
    this.note({ op: 'rate', name, hz });
    const s = this.slots.get(name);
    if (s !== undefined) try { this.backend?.setRate(s as never, hz); } catch { /* silent */ }
  }
  /** stop every slot (zone exit) */
  stopAll() {
    for (const [name, s] of this.slots) try { this.backend?.stop(s as never); } catch { /* silent */ } finally { void name; }
  }
}
