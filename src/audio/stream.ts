// Streams a software synth through Web Audio: renders small blocks ahead of time into AudioBuffers and schedules them back to back.
// No AudioWorklet (works everywhere, incl. headless); latency is `ahead` seconds, irrelevant for music and ambience beds.
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

  start() {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.03;
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
