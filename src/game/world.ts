// The world: records, game variables, collision, input, camera, and the fixed-step simulation (30 Hz, dt = 1.0 in the game's unit, docs/re/architecture.md 8.5).
import type { GameRecord } from './record.ts';
import { GameVars, V } from './vars.ts';
import { CollisionWorld } from './collision.ts';
import { InputMapper } from './input.ts';
import { ChaseCamera } from './camera.ts';
import { PepperGlobals } from './walk.ts';
import { destroyNodes, prerenderPass, updatePass } from './controller.ts';
import { B } from './input.ts';

/** simulation rate of the game's time unit (one tick = 1/30 s) */
export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;

export interface SfxSink { play(id: number): void }

export class World {
  records: GameRecord[] = [];
  vars = new GameVars();
  col = new CollisionWorld();
  input = new InputMapper();
  camera = new ChaseCamera();
  pep = new PepperGlobals();
  /** DAT_009da5d0: the focus record (the player), distances of all controllers are measured to it */
  focus: GameRecord | null = null;
  /** DAT_008b1718: time step in the game's unit; the port runs the simulation at a fixed 30 Hz, so it is always 1 */
  dt = 1;
  /** DAT_009da5cc: frame counter, advanced by the pre-render pass */
  frame = 0;
  /** DAT_009da5c8: freezes the update pass (pause) */
  frozen = false;
  /** DAT_009da858: sea level (the island: 2.4, 0 elsewhere) */
  seaLevel = 0;
  /** DAT_009da9bc: gravity (the island and most zones: -10) */
  gravity = -10;
  /** number of simulation ticks run */
  tickCount = 0;
  sfx: SfxSink | null = null;
  /** hub zones (z02LGI ...): the draw pass pulls the camera in front of walls (FUN_004229a0) */
  hub = false;
  zone = '';

  constructor() { this.vars.set(V.PEPPER_CONTROL, 1); }

  playSound(id: number) { this.sfx?.play(id); }

  /** the simulation tick: input, update pass (behaviours; the walk node also moves the camera), view basis, pre-render pass */
  tick() {
    for (const r of this.records) r.savePrev();
    for (const r of this.records) r.anim?.beginTick();
    this.camera.savePrev();
    this.input.update();
    // Esc (FUN_00423170 -> pause mode 3): the real pause menu is part of the shell (M2); until then it just freezes the update pass
    if (this.input.pressed & B.ESC) this.frozen = !this.frozen;
    updatePass(this);
    this.camera.updateView();
    prerenderPass(this);
    this.tickCount++;
  }

  destroy() { destroyNodes(this); this.records = []; this.col.records = []; this.focus = null; }
}

/** The frame loop: a fixed 30 Hz simulation with rendering at the display rate. `render(alpha)` gets the interpolation factor between the last two ticks. */
export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  running = false;
  /** upper bound of ticks run per animation frame (a stall is dropped, like the original's "elapsed > 15 ticks" rule) */
  maxTicksPerFrame = 5;
  fps = 0;
  private fpsT = 0; private fpsN = 0;
  private world: World;
  private render: (alpha: number, dtSeconds: number) => void;
  private onTick?: () => void;
  constructor(world: World, render: (alpha: number, dtSeconds: number) => void, onTick?: () => void) { this.world = world; this.render = render; this.onTick = onTick; }
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dtMs = Math.min(1000, now - this.last);
      this.last = now;
      this.acc += dtMs;
      let n = 0;
      while (this.acc >= TICK_MS && n < this.maxTicksPerFrame) { this.world.tick(); this.onTick?.(); this.acc -= TICK_MS; n++; }
      if (n === this.maxTicksPerFrame) this.acc = 0;
      this.fpsT += dtMs; this.fpsN++;
      if (this.fpsT > 500) { this.fps = (this.fpsN * 1000) / this.fpsT; this.fpsT = 0; this.fpsN = 0; }
      this.render(Math.min(1, this.acc / TICK_MS), dtMs / 1000);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
}
