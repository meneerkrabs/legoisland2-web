// The zone-facing particle hooks (`fx`): one ParticleEngine + ParticleDraw per zone (FUN_00442900 creates it with the zone's archive name, "GENERICBITS" for the
// hubs / zones without own `Particle/` folder), driven by the game's tick counter, drawn through `GameRenderer.particles`.
//
//   const fx = await ZoneParticles.create(zg);                       // zone factory: after the zone's set-up
//   const h = fx.start('bolts01', rec.m, [0, 1, 0], [-Math.PI / 2, 0, 0]);   // FUN_00442960: starts OFF (gate var 1, mask 1, value 1: var 1 is always 0)
//   fx.on(h); fx.off(h); fx.stop(h);                                  // FUN_00442a20 (2, 1, 1) / (1, 1, 1), FUN_00442a40
//   fx.collideWith(h, groundRecord);                                  // FUN_00442a50
//   fx.finish();                                                      // FUN_0044e8d0 (once, after the zone created its emitters)
// See docs/re/particles.md for the how-to.
import type { Archive } from '../../formats/archive.ts';
import type { GameRenderer } from '../../game/render.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Shell } from '../../shell/shell.ts';
import { ParticleDraw } from './draw.ts';
import { NO_HANDLE, ParticleEngine, PARAM } from './engine.ts';
import { archiveParticleFiles } from './files.ts';
import type { MatrixSource } from './source.ts';
import { addParticleTicker, tickParticles } from './ticker.ts';

export { NO_HANDLE, PARAM, tickParticles };

/** what `create` needs of the zone game context (ZoneGameCtx) */
export interface ParticleHost { sh: Shell; gr: GameRenderer; world: World; archive: Archive }

/** the nodes of a source's collision list: the record + the 'PCOL' tag (the original compares the record's first dword) */
interface ColNode { name?: string }

/** the three gate constants of the callers: var 1 is always 0, var 2 always 1 (GameVars.get) */
export const GATE_OFF: readonly [number, number, number] = [1, 1, 1];
export const GATE_ON: readonly [number, number, number] = [2, 1, 1];
const SKIP_PAINT_WAIT = 4;

export class ZoneParticles {
  readonly engine: ParticleEngine;
  private draw: ParticleDraw;
  private world: World;
  private lastTick: number;
  private finished = false;
  private unregister: () => void;
  /** number of logic ticks run (the frame counter DAT_009da5cc the scripts are measured on is `world.frame`) */
  ticks = 0;
  /**
   * The host calls `step()` once per pass of the original's main loop itself (the front end: FUN_00442930 runs in every mode of its loop, also in the fade modes where no update pass
   * runs); the draw hook then does not catch up with `world.tickCount`.
   */
  manual = false;
  /** the host calls `afterTick()` once per sim step (`tickParticles(world)` of ./ticker.ts): the render hook does not advance the engine */
  driven = false;

  private constructor(h: ParticleHost, files: ReturnType<typeof archiveParticleFiles>, texArchive: Archive) {
    const world = h.world;
    this.world = world;
    this.engine = new ParticleEngine(files, {
      // (rand: the ParticleEngine default is the shared CRT generator of src/game/crt.ts, FUN_0085daf0)
      getVar: (i) => world.vars.get(i),
      collide: (rec, pos, vel, radius, outN, outP) => {
        const r = (rec as GameRecord);
        // FUN_00441b10(record, {start = pos, delta = vel, mask byte 0, radius = skin = the particle's size}, 1)
        const hit = world.col.rayRecord(r, pos, vel, 0, radius, radius);
        if (!hit) return false;
        outN.set(hit.normal); outP.set(hit.point);
        return true;
      },
      isPcol: (rec) => (rec as ColNode).name?.startsWith('PCOL') ?? false,
    });
    this.engine.zoom = Math.fround(h.gr.fov);
    this.engine.invZoom = Math.fround(1 / this.engine.zoom);
    this.draw = new ParticleDraw(h.sh.gl, this.engine, texArchive);
    this.lastTick = world.tickCount;
    this.unregister = addParticleTicker(world, () => { if (!this.manual) this.afterTick(); });
    h.gr.particles = (r, viewProj) => this.render(r, viewProj, h.gr);
  }

  /** FUN_00442900: the engine of a zone (its own archive when it has a `Particle/` folder, else GENERICBITS); null when no particle data exists */
  static async create(h: ParticleHost): Promise<ZoneParticles | null> {
    let arch: Archive = h.archive;
    let files = archiveParticleFiles(arch);
    if (!files.list('par').length && !files.list('swl').length) {
      try { arch = await h.sh.data.archive('GENERICBITS'); files = archiveParticleFiles(arch); } catch { return null; }
    }
    const z = new ZoneParticles(h, files, arch);
    if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__particles = z;   // debug handle (tests / screenshots)
    return z;
  }

  // ---- the original's API -------------------------------------------------------------------------------------------
  /** FUN_00442960(name, matrix, pos, rot, var, mask, value): start the effect; the default gate is OFF (the callers enable it with `on`) */
  start(name: string, matrix: MatrixSource | null, pos: ArrayLike<number>, rot: ArrayLike<number>, gate: readonly [number, number, number] = GATE_OFF): number {
    return this.engine.start(name, matrix, pos, rot, gate[0], gate[1], gate[2]);
  }
  /** FUN_004429a0: a swirl list (`.swl`); its parent matrix comes from `setMatrix` */
  startSwirl(name: string, pos: ArrayLike<number>, rot: ArrayLike<number>, gate: readonly [number, number, number] = GATE_OFF): number {
    return this.engine.startSwirl(name, null, pos, rot, gate[0], gate[1], gate[2]);
  }
  /** FUN_00442a00: attach / replace the parent matrix (the record's matrix, a live Float32Array, or a function returning it) */
  setMatrix(h: number, m: MatrixSource): void { this.engine.setMatrix(h, m); }
  /** FUN_00442a20(h, var, mask, value) */
  setGate(h: number, gate: readonly [number, number, number]): void { this.engine.setGate(h, gate[0], gate[1], gate[2]); }
  /** emit: gate (2, 1, 1) */
  on(h: number): void { this.engine.setGate(h, 2, 1, 1); }
  /** stop emitting, the live particles fade out: gate (1, 1, 1) */
  off(h: number): void { this.engine.setGate(h, 1, 1, 1); }
  /** FUN_00442a40: end the source (it emits no more; its particles live on) */
  stop(h: number): void { this.engine.stop(h); }
  /** FUN_00442a50: add a collision record to the source (a record named PCOL kills the particles on contact, others reflect them) */
  collideWith(h: number, rec: GameRecord): void { this.engine.setCollision(h, rec); }
  /** FUN_0044ebd0: override an emitter parameter (`PARAM.*`) */
  setParam(h: number, type: number, value: number): void { this.engine.setParam(h, type, value); }
  /** FUN_0044e8d0: the zone created all its emitters */
  finish(): void { if (!this.finished) { this.engine.finishSetup(); this.finished = true; } }
  /** FUN_0076b070 (z27TRX): the distance LOD of the emission, from the camera position */
  setLod(on: boolean): void { this.engine.lod = on; }

  // ---- per frame ---------------------------------------------------------------------------------------------------
  /**
   * The simulation of ONE game step: FUN_0044f2c0(dt) at the frame counter, with the step's own `world.dt` and `world.frame`. In the original it runs in FUN_00442930 -> FUN_0044e8e0,
   * once per pass of the main loop, i.e. once per drawn frame; the port's sim step IS that frame (60 Hz, no interpolation), so the host calls `afterTick()` exactly once per
   * `World.tick()` (right after it, before `advanceDt()`: `tickParticles(world)` of ./ticker.ts), and the draw callback (`render`) only draws. The advance never depends on how often the
   * browser calls the render hook.
   */
  afterTick(): void {
    this.driven = true;
    this.step();
  }

  /** FUN_0044e8e0 once: the engine update at the world's current frame counter and dt (also the manual hosts' call: the front end's loop passes) */
  step(): void {
    const w = this.world;
    this.engine.paused = w.vars.get(10) !== 0;       // FUN_00417575(10): the pause flag the loop sets
    this.engine.update(w.dt, w.frame);
    this.ticks++;
  }

  /**
   * Fallback for hosts that do not call `afterTick()` (tests with their own loop): catch up on the sim steps that ran since the last render, one engine update each. A host that
   * calls `afterTick()` / `step()` itself (`driven` / `manual`) never reaches this.
   */
  private catchUp(): void {
    if (this.manual || this.driven) return;
    const w = this.world;
    const n = Math.min(w.tickCount - this.lastTick, SKIP_PAINT_WAIT * 4);
    this.lastTick = w.tickCount;
    for (let i = 0; i < n; i++) {
      this.engine.paused = w.vars.get(10) !== 0;
      this.engine.update(w.dt, w.frame - (n - 1 - i));
      this.ticks++;
    }
  }

  private render(r: Parameters<NonNullable<GameRenderer['particles']>>[0], viewProj: Float32Array | number[], gr: GameRenderer): void {
    this.catchUp();
    const e = this.engine;
    e.zoom = Math.fround(gr.fov); e.invZoom = Math.fround(1 / e.zoom);
    const v = r.viewRect;
    this.draw.draw(viewProj as Float32Array, { w: v.w, h: v.h }, this.ticks);
  }

  /** number of live particles (tests) */
  liveParticles(h: number): number { return this.engine.liveParticles(h); }
  get stats() { return this.draw.stats; }
  destroy(h?: GameRenderer): void { if (h) h.particles = null; this.unregister(); }
}
