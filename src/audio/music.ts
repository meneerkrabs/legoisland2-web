// Music: the game's DirectMusic usage (docs/re/audio.md section 7) on top of our style/DLS engine.
//   load(key)      FUN_00443290  table key -> segment + DLS (null when the file is missing: a failed load is harmless)
//   play(handle)   FUN_004432c0  primary segment, DMUS_SEGF_AFTERPREPARETIME: hard cut to the new segment, no boundary, no crossfade
//   stopAll()      FUN_00443300  stop immediately and unload everything
//   setGroove(n)   FUN_00443310  GUID_PerfMasterGrooveLevel (the game uses activity - 3 = -2..0; reset to 0 by every load)
//   volume         FUN_00876aa4  master volume dB = 0.22 * opt[0] * fade - 22 (opt[0] = music slider 0..100, default 80; silent at 0 / mute)
import { loadSegment } from './dm/assets.ts';
import type { DmLoadedSegment } from './dm/assets.ts';
import { MusicRenderer } from './dm/player.ts';
import type { SegmentHandle } from './dm/sequencer.ts';
import { SynthStream } from './stream.ts';
import type { AudioFiles } from './files.ts';
import type { MusicTableEntry } from './tables.ts';

export interface MusicHandle { key: string; entry: MusicTableEntry; assets: DmLoadedSegment }

/** The DirectMusic master volume in dB for the music slider (opt[0]), the fade scale and the mute flag. */
export function musicVolumeDb(opt0: number, fade = 1, mute = false): number {
  const v = opt0 * fade;
  if (mute || v === 0) return -200;
  return Math.trunc(v * 22 - 2200) / 100;
}

export class MusicEngine {
  readonly ctx: BaseAudioContext;
  private dest: AudioNode;
  private files: AudioFiles;
  private table: MusicTableEntry[];
  private renderer: MusicRenderer | null = null;
  private stream: SynthStream | null = null;
  private loaded = new Map<string, MusicHandle>();
  /** the primary segment handle of the performance (null when stopped) */
  segment: SegmentHandle | null = null;
  private idleFrames = 0;
  /** the three inputs of the master volume */
  opt0 = 80;
  fadeScale = 1;
  muted = false;
  groove = 0;
  seed = 1;
  /** DirectMusic port: 99 voices */
  maxVoices = 99;
  current: MusicHandle | null = null;

  constructor(ctx: BaseAudioContext, dest: AudioNode, files: AudioFiles, table: MusicTableEntry[]) {
    this.ctx = ctx; this.dest = dest; this.files = files; this.table = table;
  }

  /** Keys of the music table. */
  get keys(): string[] { return this.table.map((t) => t.key); }

  private read = (p: string) => this.files.read(`_data/sounds/DirectMusic/${p}`);

  async load(key: string): Promise<MusicHandle | null> {
    const entry = this.table.find((t) => t.key.toLowerCase() === key.toLowerCase());
    if (!entry) return null;
    this.groove = 0;
    if (this.renderer) this.renderer.perf.grooveLevel = 0;
    const cached = this.loaded.get(entry.key.toLowerCase());
    if (cached) return cached;
    try {
      const dir = entry.dir.split('\\').pop()!;
      const assets = await loadSegment(this.read, dir, entry.segment, entry.dls);
      const h: MusicHandle = { key: entry.key, entry, assets };
      this.loaded.set(entry.key.toLowerCase(), h);
      return h;
    } catch {
      return null;
    }
  }

  private ensureRenderer(): MusicRenderer {
    if (!this.renderer) {
      this.renderer = new MusicRenderer(this.ctx.sampleRate, this.seed, this.maxVoices);
      this.renderer.perf.grooveLevel = this.groove;
      this.applyVolume();
      this.stream = new SynthStream(this.ctx, this.dest, (L, R, n) => {
        const r = this.renderer!;
        r.render(L, R, n);
        if (!r.playing) { this.idleFrames += n; if (this.idleFrames > this.ctx.sampleRate * 2) this.stream!.stop(); } else this.idleFrames = 0;
      });
    }
    return this.renderer;
  }

  /** Hard cut to this segment (null: nothing happens). */
  play(h: MusicHandle | null) {
    if (!h) return;
    const r = this.ensureRenderer();
    this.segment = r.play(h.assets, { boundary: 'immediate' });
    this.current = h;
    this.idleFrames = 0;
    this.stream!.start();
  }

  /** Stop at once (notes are released, not cut) and forget every loaded segment. */
  stopAll() {
    if (this.renderer) this.renderer.stop(null);
    this.segment = null;
    this.current = null;
    this.loaded.clear();
  }

  get playing(): boolean { return !!this.renderer && this.renderer.perf.playing; }

  setGroove(level: number) {
    this.groove = level << 24 >> 24; // signed byte
    if (this.renderer) this.renderer.perf.grooveLevel = this.groove;
  }

  setVolume(opt0: number) { this.opt0 = opt0; this.applyVolume(); }
  setFade(scale: number) { this.fadeScale = scale; this.applyVolume(); }
  setMute(m: boolean) { this.muted = m; this.applyVolume(); }

  private applyVolume() {
    if (this.renderer) this.renderer.outputGain = Math.pow(10, musicVolumeDb(this.opt0, this.fadeScale, this.muted) / 20);
  }

  get stats() { return this.renderer ? { ...this.renderer.stats, voices: this.renderer.synth.activeVoices, peakVoices: this.renderer.synth.stats.peakVoices, bpm: this.renderer.perf.bpm, seconds: this.renderer.time, underruns: this.stream?.underruns ?? 0, renderMs: this.stream?.renderMs ?? 0 } : null; }
}
