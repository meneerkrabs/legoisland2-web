// MusicRenderer: DmPerformance + DlsSynth glued together. Produces stereo float audio at a given sample rate, block by block
// (used offline in node for verification and in the browser by music.ts, which streams the blocks through Web Audio).
import { DmPerformance } from './sequencer.ts';
import type { DmEvent, DmSegmentAssets, PlayOptions, SegmentHandle, Boundary } from './sequencer.ts';
import { DlsSynth } from './synth.ts';
import { resolveInstrument } from './instruments.ts';
import { INST_TRANSPOSE, INST_PITCHBENDRANGE } from './format.ts';

type Queued = { frame: number; ev: DmEvent & { time: number } | { kind: 'off'; pch: number; key: number; time: number } };

/** transparent below 0.9, smoothly saturating to 1 above */
export function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.9) return x;
  const y = 0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1);
  return x < 0 ? -y : y;
}

export interface RendererStats { events: number; unresolvedPatches: number; patches: number }

export class MusicRenderer {
  readonly sampleRate: number;
  readonly perf: DmPerformance;
  readonly synth: DlsSynth;
  /** frames rendered so far */
  frame = 0;
  /** how far ahead (seconds) the sequencer is run */
  lookahead = 0.12;
  /** linear output gain (music master volume) and soft limiter */
  outputGain = 1;
  private queue: Queued[] = [];
  stats: RendererStats = { events: 0, unresolvedPatches: 0, patches: 0 };
  /** called for every channel whose band entry could not be resolved to a DLS instrument */
  onUnresolved: ((pch: number, patch: number) => void) | null = null;

  constructor(sampleRate: number, seed = 1, maxVoices = 80) {
    this.sampleRate = sampleRate;
    this.perf = new DmPerformance(seed);
    this.synth = new DlsSynth(sampleRate, maxVoices);
  }

  get time(): number { return this.frame / this.sampleRate; }

  play(assets: DmSegmentAssets, opts?: PlayOptions): SegmentHandle { return this.perf.play(assets, opts); }
  stop(h?: SegmentHandle | null, boundary?: Boundary) { this.perf.stop(h, boundary); }
  get playing(): boolean { return this.perf.playing || this.synth.activeVoices > 0 || this.queue.length > 0; }

  private enqueue(ev: Queued['ev']) {
    const frame = Math.max(this.frame, Math.round(ev.time * this.sampleRate));
    // keep sorted by frame (stable): insertion from the end
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].frame > frame) i--;
    this.queue.splice(i, 0, { frame, ev });
  }

  private pull(untilSec: number) {
    for (const e of this.perf.run(untilSec)) {
      this.stats.events++;
      if (e.kind === 'note') {
        this.enqueue(e);
        const offTime = this.perf.tickToSec(e.tick + e.dur);
        this.enqueue({ kind: 'off', pch: e.pch, key: e.key, time: Math.max(offTime, e.time + 0.001) });
      } else this.enqueue(e);
    }
  }

  private apply(q: Queued['ev']) {
    const s = this.synth;
    if (q.kind === 'off') { s.noteOff(q.pch, q.key); return; }
    switch (q.kind) {
      case 'note': s.noteOn(q.pch, q.key, q.vel); break;
      case 'cc': s.cc(q.pch, q.cc, q.value); break;
      case 'bend': s.pitchBend(q.pch, q.value); break;
      case 'alloff': s.allNotesOff(q.pch); break;
      case 'reset': s.resetChannels(); break;
      case 'patch': {
        this.stats.patches++;
        const r = q.dls ? resolveInstrument(q.inst, q.dls) : null;
        if (!r) { this.stats.unresolvedPatches++; s.setInstrument(q.pch, null, null); this.onUnresolved?.(q.pch, q.inst.patch); break; }
        s.setInstrument(q.pch, r.collection, r.instrument, {
          volume: q.inst.volume, pan: q.inst.pan,
          transpose: q.inst.flags & INST_TRANSPOSE ? q.inst.transpose : 0,
          bendRange: q.inst.flags & INST_PITCHBENDRANGE ? q.inst.pitchBendRange : 2,
        });
        break;
      }
      default: break;
    }
  }

  /** Render `n` frames into L/R (overwritten). */
  render(L: Float32Array, R: Float32Array, n: number) {
    L.fill(0, 0, n); R.fill(0, 0, n);
    const endFrame = this.frame + n;
    this.pull(endFrame / this.sampleRate + this.lookahead);
    let done = 0;
    while (done < n) {
      const here = this.frame + done;
      let stop = endFrame;
      // apply all events due now, then render up to the next event
      while (this.queue.length && this.queue[0].frame <= here) this.apply(this.queue.shift()!.ev);
      if (this.queue.length) stop = Math.min(stop, this.queue[0].frame);
      // limit sub-block size so pitch bend / controller smoothing stays reasonable
      const chunk = Math.min(stop - here, 256);
      if (chunk <= 0) continue;
      this.synth.render(L, R, chunk, done);
      done += chunk;
    }
    const g = this.outputGain;
    for (let i = 0; i < n; i++) { L[i] = softClip(L[i] * g); R[i] = softClip(R[i] * g); }
    this.frame = endFrame;
  }
}
