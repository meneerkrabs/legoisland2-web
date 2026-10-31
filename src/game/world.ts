// The world: records, game variables, collision, input, camera, and the fixed-step simulation (60 Hz, dt = 0.5 in the game's unit of 1/30 s after the first frames, docs/re/gaps.md T1).
import type { GameRecord } from './record.ts';
import { GameVars, V } from './vars.ts';
import { CollisionWorld } from './collision.ts';
import { InputMapper } from './input.ts';
import { ChaseCamera } from './camera.ts';
import { PepperGlobals } from './walk.ts';
import { destroyNodes, prerenderPass, updatePass } from './controller.ts';
import { runProbePass } from './probehost.ts';
import { B } from './input.ts';
import { tickParticles } from '../fx/particles/ticker.ts';

/** the game's time unit (the original's `DAT_008b1718 = 1`) is 1/30 s */
export const GAME_TICK_HZ = 30;
/**
 * The simulation runs one step per drawn frame like the original (FUN_00442930 draws once per pass of the loop) and the port stands in for the original on a 60 Hz
 * v-synced display: a fixed 60 Hz step whose measured frame time is always half a game tick. `DAT_008b1718` follows from it by the original's rules (`nextDt`).
 */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
/** the frame time of one fixed step in the game's unit (QueryPerformanceCounter elapsed / (QueryPerformanceFrequency / 30)) */
export const STEP_ELAPSED = GAME_TICK_HZ / TICK_HZ;

/**
 * FUN_00443e40 (called after the draw pass of every loop pass) with the frame counter `DAT_009da5cc`, the previous `DAT_008b1718` and the measured frame time `elapsed`
 * (in the game's unit; the fixed step always measures 0.5): the first five frames run at 1.0; a frame time over 15 (_DAT_00892074, a stall) counts as 1.0; the step may
 * grow by at most 3x (_DAT_008b57e8) of the previous one; the result is a float32. FUN_00443d10, the adaptive detail tuning behind it, is inert (DAT_009e56b8 stays 0).
 */
export function nextDt(frame: number, prevDt: number, elapsed = STEP_ELAPSED): number {
  let v = frame < 5 ? 1.0 : elapsed;
  if (frame >= 5 && v > 15) v = 1.0;
  if (3 <= Math.fround(v / prevDt)) v = Math.fround(3 * prevDt);
  return Math.fround(v);
}

/** size of the draw pass log ring (a power of two) */
export const PASS_LOG = 64;

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
  /** DAT_008b1718: time step in the game's unit (1/30 s): 1 for the first five frames, then 0.5 at the fixed 60 Hz step (`advanceDt`); the node tests set it by hand */
  dt = 1;
  /** _DAT_008b171c = 1 / dt */
  invDt = 1;
  /** DAT_009da5cc: frame counter, advanced by the pre-render pass */
  frame = 0;
  /** DAT_009da5c8: freezes the update pass (pause) */
  frozen = false;
  /** zone hook run between the camera / view update and the pre-render pass (the original's FUN_00427233, the probe pass of the node framework); null = none */
  beforePrerender: ((w: World) => void) | null = null;
  /** zone hook run at the end of the tick, where the original's draw pass (FUN_0042271b) zeroes every controller's +0x14 word (the island: the NPC code's `near` bits live for one frame); null = none */
  afterTick: ((w: World) => void) | null = null;
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
  /** the shell samples the input and handles Esc / pause itself (see tick) */
  externalInput = false;
  /** zone services the shell / zone game hangs on the world for behaviour nodes (the island: `src/island/ctx.ts` `ctxOf`) */
  readonly ext = new Map<string, unknown>();

  constructor() { this.vars.set(V.PEPPER_CONTROL, 1); }

  /**
   * The draw pass log (WP-TIME): one entry per loop pass of the original, written by `advanceDt` (= FUN_00443e40, the end of every pass after its draw): the pass's own `DAT_008b1718` and the
   * camera position its draw saw. State the original updates in its DRAW pass (the `.wib` texture steps FUN_004111a3, the sky / sea hooks, the flowing-water scroll, the view plane phases, the
   * shadow marker blink) belongs to the pass, not to the browser's rAF calls: the renderer replays the passes it has not drawn yet (`passes` counts them, the ring keeps the last `PASS_LOG`).
   */
  passes = 0;
  readonly passDt = new Float32Array(PASS_LOG);
  readonly passEye = new Float32Array(PASS_LOG * 3);

  /**
   * FUN_00443e40: the end of a loop pass (after its draw) computes the time step of the next one. Before it the pass is logged (`passes`) and the particle engines of the world take their step
   * (FUN_00442930 -> FUN_0044e8e0 runs in the draw pass, once per pass, with the pass's own dt and frame counter).
   */
  advanceDt(elapsed = STEP_ELAPSED) {
    tickParticles(this);
    const i = this.passes & (PASS_LOG - 1);
    this.passDt[i] = this.dt;
    const c = this.camera.c;
    this.passEye[i * 3] = c[0]; this.passEye[i * 3 + 1] = c[1]; this.passEye[i * 3 + 2] = c[2];
    this.passes++;
    this.dt = nextDt(this.frame, this.dt, elapsed); this.invDt = Math.fround(1 / this.dt);
  }

  playSound(id: number) { this.sfx?.play(id); }

  /** the simulation tick: input, update pass (behaviours; the walk node also moves the camera), view basis, pre-render pass */
  tick() {
    for (const r of this.records) r.savePrev();
    for (const r of this.records) r.anim?.beginTick();
    this.camera.savePrev();
    // the shell (src/shell) samples the input itself once per tick (FUN_00423170) and handles Esc (pause menu); the M1 dev entry lets the world do both
    if (!this.externalInput) {
      this.input.update();
      // Esc (FUN_00423170 -> pause mode 3): in the dev entry it just freezes the update pass
      if (this.input.pressed & B.ESC) this.frozen = !this.frozen;
    }
    updatePass(this);
    this.camera.updateView();
    this.beforePrerender?.(this);
    runProbePass(this);   // FUN_00427233 for the controllers whose nodes armed a probe (probehost.ts)
    prerenderPass(this);
    this.afterTick?.(this);
    this.tickCount++;
  }

  destroy() { destroyNodes(this); this.records = []; this.col.records = []; this.focus = null; }
}

/** The frame loop: a fixed 60 Hz simulation (one step per drawn frame, no interpolation: the original has none); on a faster display the last frame is drawn again. */
export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  running = false;
  /** upper bound of steps run per animation frame (a stall is dropped, like the original's "elapsed > 15 ticks" rule) */
  maxTicksPerFrame = 10;
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
      while (this.acc >= TICK_MS && n < this.maxTicksPerFrame) { this.world.tick(); this.world.advanceDt(); this.onTick?.(); this.acc -= TICK_MS; n++; }
      if (n === this.maxTicksPerFrame) this.acc = 0;
      this.fpsT += dtMs; this.fpsN++;
      if (this.fpsT > 500) { this.fps = (this.fpsN * 1000) / this.fpsT; this.fpsT = 0; this.fpsN = 0; }
      this.render(1, dtMs / 1000);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
}
