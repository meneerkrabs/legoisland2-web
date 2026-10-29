// Streams a software synth through Web Audio: renders small blocks ahead of time into AudioBuffers and schedules them back to back.
// No AudioWorklet (works everywhere, incl. headless). The blocks are scheduled at exact context times, so a caller that knows `lead` (how far
// the render head is ahead of what is audible) can start something at an exact moment (music.ts: DirectMusic's start after the prepare time).
export type RenderFn = (L: Float32Array, R: Float32Array, n: number) => void;

export class SynthStream {
  readonly ctx: BaseAudioContext;
  private dest: AudioNode;
  private render: RenderFn;
  private chunk: number;
  private ahead: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private L: Float32Array;
  private R: Float32Array;
  /** blocks scheduled so far (diagnostics) */
  blocks = 0;
  underruns = 0;
  /** main-thread time spent rendering (ms) */
  renderMs = 0;

  constructor(ctx: BaseAudioContext, dest: AudioNode, render: RenderFn, opts: { chunk?: number; ahead?: number } = {}) {
    this.ctx = ctx; this.dest = dest; this.render = render;
    this.chunk = opts.chunk ?? 1024;
    this.ahead = opts.ahead ?? 0.3;
    this.L = new Float32Array(this.chunk);
    this.R = new Float32Array(this.chunk);
  }

  get running(): boolean { return this.timer !== null; }

  /** the first block of a stream that starts now is audible this long from now (seconds) */
  static readonly START_DELAY = 0.03;

  /**
   * Seconds the render head (the next frame to be rendered) is ahead of the audible output: the audible position is the head minus this.
   * For a stream that is not running it is what `start()` would give.
   */
  get lead(): number { return this.timer === null ? SynthStream.START_DELAY : Math.max(0, this.nextTime - this.ctx.currentTime); }

  /** while `render` runs: the context time at which the block being rendered becomes audible */
  get blockStart(): number { return this.nextTime; }

  start() {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + SynthStream.START_DELAY;
    this.timer = setInterval(() => this.pump(), 20);
    this.pump();
  }

  stop() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  private pump() {
    const now = this.ctx.currentTime;
    if (this.nextTime < now) { this.underruns++; this.nextTime = now + 0.02; }
    while (this.nextTime < now + this.ahead) {
      this.L.fill(0); this.R.fill(0);
      const t0 = performance.now();
      this.render(this.L, this.R, this.chunk);
      this.renderMs += performance.now() - t0;
      const buf = this.ctx.createBuffer(2, this.chunk, this.ctx.sampleRate);
      buf.copyToChannel(this.L as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(this.R as Float32Array<ArrayBuffer>, 1);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.dest);
      src.start(this.nextTime);
      this.nextTime += this.chunk / this.ctx.sampleRate;
      this.blocks++;
    }
  }
}
