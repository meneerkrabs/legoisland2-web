// MIDI ambience beds (Miles XMIDI sequence + DLS in the game, docs/re/audio.md section 4.1): looped by restarting when finished,
// volume = tableVolume * opt[1] / 100 on the 0..127 scale (the SFX slider, not the music slider).
import { parseSmf, MidiRenderer } from './midi.ts';
import { parseDls } from './dm/dls.ts';
import { SynthStream } from './stream.ts';
import { readTolerant } from './files.ts';
import type { AudioFiles } from './files.ts';
import type { AmbienceTableEntry } from './tables.ts';

export class AmbienceEngine {
  readonly ctx: BaseAudioContext;
  private dest: AudioNode;
  private files: AudioFiles;
  private table: AmbienceTableEntry[];
  private renderer: MidiRenderer | null = null;
  private stream: SynthStream | null = null;
  private entry: AmbienceTableEntry | null = null;
  sfxVolume = 80;
  current: string | null = null;

  constructor(ctx: BaseAudioContext, dest: AudioNode, files: AudioFiles, table: AmbienceTableEntry[]) {
    this.ctx = ctx; this.dest = dest; this.files = files; this.table = table;
  }

  get keys(): string[] { return this.table.map((t) => t.key); }

  /** FUN_004431e0(key): start the bed (stops a running one). Returns false when the key or its files are missing. */
  async start(key: string): Promise<boolean> {
    const e = this.table.find((t) => t.key.toLowerCase() === key.toLowerCase());
    if (!e) return false;
    const [mid, dls] = await Promise.all([readTolerant(this.files, e.midi), readTolerant(this.files, e.dls)]);
    if (!mid || !dls) return false;
    this.stop();
    const r = new MidiRenderer(this.ctx.sampleRate, 32);
    r.start(parseSmf(mid), parseDls(dls));
    this.renderer = r; this.entry = e; this.current = e.key;
    this.applyVolume();
    this.stream = new SynthStream(this.ctx, this.dest, (L, R, n) => r.render(L, R, n));
    this.stream.start();
    return true;
  }

  /** FUN_00443280: end the sequence. */
  stop() {
    this.stream?.stop();
    this.renderer?.stop();
    this.stream = null; this.renderer = null; this.entry = null; this.current = null;
  }

  setSfxVolume(opt1: number) { this.sfxVolume = opt1; this.applyVolume(); }

  private applyVolume() {
    if (this.renderer && this.entry) this.renderer.gain = Math.floor((this.entry.volume * this.sfxVolume) / 100) / 127;
  }
}
