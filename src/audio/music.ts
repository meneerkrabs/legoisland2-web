// Music: the game's DirectMusic usage (docs/re/audio.md section 7) on top of our style/DLS engine.
//   load(key)      FUN_00443290  table key -> segment + DLS (null when the file is missing: a failed load is harmless)
//   play(handle)   FUN_004432c0  primary segment, DMUS_SEGF_AFTERPREPARETIME (flags 0x400, start time 0): no boundary, no crossfade. The segment starts one
//                  prepare time after the call (IDirectMusicPerformance default 1000 ms; the game never calls SetPrepareTime: asm 0x876ec2 and the whole
//                  DirectMusic class were checked for vtable slot 0x1c); a running primary segment goes on until then and is cut at that instant
//   stopAll()      FUN_00443300  stop immediately and unload everything
//   setGroove(n)   FUN_00443310  GUID_PerfMasterGrooveLevel (the game uses activity - 3 = -2..0; reset to 0 by every load)
//   volume         FUN_00876aa4  master volume dB = 0.22 * opt[0] * fade - 22 (opt[0] = music slider 0..100, default 80; silent at 0 / mute)
import { loadSegment } from './dm/assets.ts';
import type { DmLoadedSegment } from './dm/assets.ts';
import { MusicRenderer } from './dm/player.ts';
import type { SegmentHandle, DmNotification } from './dm/sequencer.ts';
import { SynthStream } from './stream.ts';
import type { AudioFiles } from './files.ts';
import type { MusicTableEntry } from './tables.ts';

export interface MusicHandle { key: string; entry: MusicTableEntry; assets: DmLoadedSegment }

/** IDirectMusicPerformance::GetPrepareTime default (dmime: `dwPrepareTime = 1000`), the delay `DMUS_SEGF_AFTERPREPARETIME` adds to a start time of 0 */
export const DM_PREPARE_TIME_MS = 1000;

/** what the engine did and when (AudioContext time), for tests and debugging */
export interface MusicLogEntry { t: number; what: 'load' | 'play' | 'stop' | 'groove' | 'volume' | 'mute' | 'fade' | 'notify'; key?: string; /** audible start (context time) of a `play` */ at?: number; value?: number }

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
  /** GUID_NOTIFICATION_SEGMENT messages waiting in the performance's queue (context time when each becomes due) */
  private notifications: { at: number; option: DmNotification }[] = [];
  /** the three inputs of the master volume */
  opt0 = 80;
  fadeScale = 1;
  muted = false;
  groove = 0;
  seed = 1;
  /** DirectMusic port: 99 voices */
  maxVoices = 99;
  current: MusicHandle | null = null;
  /** delay between `play` and the audible start of the segment (seconds); DirectMusic's prepare time */
  prepareSec = DM_PREPARE_TIME_MS / 1000;
  readonly log: MusicLogEntry[] = [];
  private note(e: Omit<MusicLogEntry, 't'>) { this.log.push({ t: this.ctx.currentTime, ...e }); if (this.log.length > 400) this.log.shift(); }

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
    this.note({ what: 'load', key: entry.key });
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

  /** create the synth and its stream ahead of the first `play` (a zone does this while it loads, so the start has nothing left to set up) */
  warm() { this.ensureRenderer(); }

  private ensureRenderer(): MusicRenderer {
    if (!this.renderer) {
      this.renderer = new MusicRenderer(this.ctx.sampleRate, this.seed, this.maxVoices);
      this.renderer.onNotify = (option, frame) => {
        const r = this.renderer, st = this.stream;
        if (!r || !st) return;
        if (this.notifications.length >= 256) this.notifications.shift();
        this.notifications.push({ at: st.blockStart + (frame - r.frame) / this.ctx.sampleRate, option });
      };
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

  /**
   * FUN_004432c0: the segment replaces the primary segment `prepareSec` from now (null: nothing happens; a handle played again starts over).
   * The start is placed on the renderer's clock: the stream's render head is `lead` seconds ahead of what is audible, so "now" is head - lead.
   */
  play(h: MusicHandle | null, opts: { prepareSec?: number } = {}) {
    if (!h) return;
    const r = this.ensureRenderer();
    const st = this.stream!;
    const lead = st.lead;
    const prepare = opts.prepareSec ?? this.prepareSec;
    const atSec = r.time - lead + prepare;
    this.segment = r.playAt(h.assets, atSec);
    this.current = h;
    this.idleFrames = 0;
    this.note({ what: 'play', key: h.key, at: this.ctx.currentTime + prepare });
    st.start();
  }

  /** Stop at once (notes are released, not cut) and forget every loaded segment. */
  stopAll() {
    this.note({ what: 'stop' });
    if (this.renderer) this.renderer.stop(null);
    this.segment = null;
    this.current = null;
    this.loaded.clear();
  }

  /**
   * FUN_00443370 -> FUN_00876e7f: IDirectMusicPerformance::GetNotificationPMsg + FreePMsg. True when a segment notification (start, loop, abort, end of the primary
   * segment) was waiting and has now been taken; one message per call, in order. The island's Music node polls it every frame (src/island/ambient/music.ts).
   */
  pollNotification(): boolean {
    const n = this.notifications[0];
    if (!n || n.at > this.ctx.currentTime) return false;
    this.notifications.shift();
    this.note({ what: 'notify', key: n.option });
    return true;
  }

  get playing(): boolean { return !!this.renderer && this.renderer.perf.playing; }

  setGroove(level: number) {
    this.groove = level << 24 >> 24; // signed byte
    this.note({ what: 'groove', value: this.groove });
    if (this.renderer) this.renderer.perf.grooveLevel = this.groove;
  }

  setVolume(opt0: number) { this.opt0 = opt0; this.applyVolume(); }
  setFade(scale: number) { this.fadeScale = scale; this.applyVolume(); }
  setMute(m: boolean) { this.muted = m; this.note({ what: 'mute', value: m ? 1 : 0 }); this.applyVolume(); }

  private applyVolume() {
    if (this.renderer) this.renderer.outputGain = Math.pow(10, musicVolumeDb(this.opt0, this.fadeScale, this.muted) / 20);
  }

  get stats() { return this.renderer ? { ...this.renderer.stats, voices: this.renderer.synth.activeVoices, peakVoices: this.renderer.synth.stats.peakVoices, bpm: this.renderer.perf.bpm, seconds: this.renderer.time, underruns: this.stream?.underruns ?? 0, renderMs: this.stream?.renderMs ?? 0 } : null; }
}
