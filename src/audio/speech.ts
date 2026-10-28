// Speech with the semantics of the game (docs/re/audio.md section 6): MSS streams of MP3-in-WAV, one speech "slot":
//  - say(a, b): ignored unless idle; line B starts when line A has ended; no queue, no ducking of music / sfx
//  - centre, gain = speech slider (opt[0x16]) * 127 / 100 / 127 fixed when the line starts
//  - idle = nothing started or nothing left to play (gameplay polls it to wait for the end of a line)
import { parseWav } from '../formats/sound.ts';
import { readTolerant } from './files.ts';
import type { AudioFiles } from './files.ts';

/** The MPEG frames inside a speech file (RIFF/WAVE with wFormatTag 0x55): decodeAudioData wants a plain MP3 stream. */
export function unwrapMp3Wav(file: Uint8Array): Uint8Array {
  const w = parseWav(file);
  return file.subarray(w.dataOffset, w.dataOffset + w.dataSize);
}

export class SpeechEngine {
  readonly ctx: BaseAudioContext;
  private dest: AudioNode;
  private files: AudioFiles;
  private table: string[];
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private order: string[] = [];
  /** speech slider opt[0x16], 0..100 */
  volume = 80;
  private busy = false;
  private token = 0;
  private sources = new Set<AudioBufferSourceNode>();
  /** called when a line starts / ends (speech index and id): subtitles hook */
  onLineStart: ((index: number, id: string) => void) | null = null;
  onLineEnd: ((index: number, id: string) => void) | null = null;
  stats = { lines: 0, missing: 0 };

  constructor(ctx: BaseAudioContext, dest: AudioNode, files: AudioFiles, table: string[]) {
    this.ctx = ctx; this.dest = dest; this.files = files; this.table = table;
  }

  /** FUN_00435ad3: true when no speech is playing or pending. */
  get idle(): boolean { return !this.busy; }

  idOf(index: number): string { return this.table[index] ?? ''; }

  private async decode(id: string): Promise<AudioBuffer | null> {
    const k = id.toLowerCase();
    let p = this.cache.get(k);
    if (!p) {
      p = (async () => {
        const bytes = await readTolerant(this.files, `_data/sounds/speech/Data/${id}.mp3`);
        if (!bytes) { this.stats.missing++; return null; }
        try { return await this.ctx.decodeAudioData(unwrapMp3Wav(bytes).slice().buffer); } catch { /* fall back to the whole file */ }
        try { return await this.ctx.decodeAudioData(bytes.slice().buffer); } catch { this.stats.missing++; return null; }
      })();
      this.cache.set(k, p);
      this.order.push(k);
      if (this.order.length > 48) this.cache.delete(this.order.shift()!);
    }
    return p;
  }

  /** Decode a line ahead of time. */
  preload(index: number) { const id = this.table[index]; if (id) void this.decode(id); }

  private playLine(index: number, token: number): Promise<void> {
    return new Promise((resolve) => {
      const id = this.table[index];
      if (index < 0 || !id) { resolve(); return; }
      this.decode(id).then((buf) => {
        if (token !== this.token) { resolve(); return; }
        if (!buf) { resolve(); return; }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const g = this.ctx.createGain();
        g.gain.value = Math.floor((this.volume * 127) / 100) / 127;
        src.connect(g); g.connect(this.dest);
        this.sources.add(src);
        this.stats.lines++;
        this.onLineStart?.(index, id);
        src.onended = () => {
          this.sources.delete(src);
          try { src.disconnect(); g.disconnect(); } catch { /* ignore */ }
          this.onLineEnd?.(index, id);
          resolve();
        };
        src.start();
      });
    });
  }

  /** FUN_00435a11 ("SayText"): speech table indices; b = -1 for a single line. Returns false (and does nothing) while speech is active. */
  say(a: number, b = -1): boolean {
    if (this.busy) return false;
    this.busy = true;
    const token = ++this.token;
    void (async () => {
      await this.playLine(a, token);
      if (b !== -1 && token === this.token) await this.playLine(b, token);
      if (token === this.token) this.busy = false;
    })();
    return true;
  }

  /** Same by speech id string ("LECSPP02"). */
  sayId(id: string, idB?: string): boolean {
    const find = (s: string) => this.table.findIndex((t) => t.toLowerCase() === s.toLowerCase());
    return this.say(find(id), idB ? find(idB) : -1);
  }

  /** FUN_00435b07: stop both lines at once (skip key). */
  stop() {
    this.token++;
    for (const s of [...this.sources]) { s.onended = null; try { s.stop(); } catch { /* ignore */ } this.sources.delete(s); }
    this.busy = false;
  }

  setVolume(opt22: number) { this.volume = opt22; }
}
