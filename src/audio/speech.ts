// Speech with the semantics of the game (docs/re/audio.md section 6): MSS streams of MP3-in-WAV, one speech "slot" (two lines A / B), driven by FUN_00435a5e once per frame:
//  - say(a, b) = FUN_00435a11: ignored while a request exists (A or B object not yet closed); nothing starts until the next `tick`
//  - tick(dt) = FUN_00435a5e: the very first request of the session waits for a counter (+1 per frame while <= 5.0: 6 frames; the counter is never reset, so later
//    requests start at the next tick), then the state machine FUN_004436d0: A not started -> start A (state 1); A finished and B not started -> start B (state 2);
//    both finished -> state 0 and both lines are closed (FUN_00435b07)
//  - idle = FUN_00435ad3: state is not 1 or 2 (so it is "idle" between a request and the first tick that starts it, and during the first request's delay)
//  - centre, gain = speech slider (opt[0x16]) * 127 / 100 / 127 fixed when the line starts; no queue, no ducking of music / sfx
// A stream that was never started reports "done" (Miles opens streams stopped, the poll FUN_00877505 treats status 2 as finished); `started` is its own flag.
import { parseWav } from '../formats/sound.ts';
import { readTolerant } from './files.ts';
import type { AudioFiles } from './files.ts';

/** The MPEG frames inside a speech file (RIFF/WAVE with wFormatTag 0x55): decodeAudioData wants a plain MP3 stream. */
export function unwrapMp3Wav(file: Uint8Array): Uint8Array {
  const w = parseWav(file);
  return file.subarray(w.dataOffset, w.dataOffset + w.dataSize);
}

/** one speech object (FUN_00443630: 16 bytes {started, finished, ?, hStream}) */
interface Line {
  index: number;
  started: boolean;
  finished: boolean;
  /** the stream's Miles status: 'done' until started (see the header), 'playing' until the audio ended */
  status: 'idle' | 'playing' | 'done';
  src: AudioBufferSourceNode | null;
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
  /** DAT_009dab54 / DAT_009dab58: the two request objects */
  private a: Line | null = null;
  private b: Line | null = null;
  /** DAT_009dab60: 0 nothing / finished, 1 line A running, 2 line B running */
  state = 0;
  /** DAT_008b1bb8: the last state the machine returned (initially -1) */
  private last = -1;
  /** _DAT_009dab5c: the warm-up counter, advanced by `dt` per tick while a request exists and it is <= 5.0; never reset */
  warm = 0;
  private token = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** called when a line starts / ends (speech index and id): subtitles hook */
  onLineStart: ((index: number, id: string) => void) | null = null;
  onLineEnd: ((index: number, id: string) => void) | null = null;
  stats = { lines: 0, missing: 0 };

  constructor(ctx: BaseAudioContext, dest: AudioNode, files: AudioFiles, table: string[]) {
    this.ctx = ctx; this.dest = dest; this.files = files; this.table = table;
  }

  /** FUN_00435ad3: true unless a line is running (state 1 or 2). */
  get idle(): boolean { return !(this.state === 1 || this.state === 2); }
  /** a request exists (the original's DAT_009dab54 / 58 are not null) */
  get hasRequest(): boolean { return this.a !== null || this.b !== null; }

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

  /** FUN_00443630: open the stream (decoding starts now, playback at `start`) */
  private open(index: number): Line {
    if (index >= 0 && this.table[index]) this.preload(index);
    return { index, started: false, finished: false, status: 'idle', src: null };
  }

  /** FUN_008773fd: start the stream; the audio begins when the decode is done (a cached line starts at once) */
  private start(l: Line) {
    l.started = true;
    l.status = 'playing';
    const id = this.table[l.index];
    const token = this.token;
    if (l.index < 0 || !id) { l.status = 'done'; return; }
    void this.decode(id).then((buf) => {
      if (token !== this.token || l.status !== 'playing') return;
      if (!buf) { l.status = 'done'; return; }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = Math.floor((this.volume * 127) / 100) / 127;
      src.connect(g); g.connect(this.dest);
      l.src = src;
      this.stats.lines++;
      this.onLineStart?.(l.index, id);
      src.onended = () => {
        l.src = null;
        try { src.disconnect(); g.disconnect(); } catch { /* ignore */ }
        if (l.status === 'playing') l.status = 'done';
        this.onLineEnd?.(l.index, id);
      };
      src.start();
    });
  }

  /** FUN_00877505: finished = the stream's status is "done" (never started counts) */
  private poll(l: Line) {
    if (l.status === 'playing') { l.finished = false; l.started = true; } else l.finished = true;
  }

  /** FUN_004436d0 */
  private step(): number {
    const a = this.a!, b = this.b;
    if (!b) {
      this.poll(a);
      if (a.started) {
        if (!a.finished) return this.last;
        this.last = 0;
        return 0;
      }
    } else {
      this.poll(a); this.poll(b);
      if (a.started) {
        if (a.finished) {
          if (!b.started) { this.start(b); this.last = 2; return 2; }
          if (b.finished) { this.last = 0; return 0; }
        }
        return this.last;
      }
    }
    this.start(a);
    this.last = 1;
    return 1;
  }

  /** FUN_00435a5e: once per loop frame (`dt` = the frame length in the original's frames, 1 at 30 Hz) */
  tick(dt = 1) {
    if (!this.a && !this.b) return;
    if (this.warm < 6) { this.warm += dt; return; }   // the original tests `<= 5.0` on whole frames: the same for dt = 1, and a start 6 frames in for dt = 0.5 too
    this.state = this.step();
    if (this.state === 0) this.stop();
  }

  /** drive `tick` from a real-time timer at the original's 30 Hz (pages without a game loop) */
  startAutoTick() { if (this.timer === null) this.timer = setInterval(() => this.tick(1), 1000 / 30); }
  stopAutoTick() { if (this.timer !== null) { clearInterval(this.timer); this.timer = null; } }

  /** FUN_00435a11 ("SayText"): speech table indices; b = -1 for a single line. Returns false (and does nothing) while a request exists. */
  say(a: number, b = -1): boolean {
    if (this.a || this.b) return false;
    this.a = this.open(a);
    this.b = b === -1 ? null : this.open(b);
    return true;
  }

  /** Same by speech id string ("LECSPP02"). */
  sayId(id: string, idB?: string): boolean {
    const find = (s: string) => this.table.findIndex((t) => t.toLowerCase() === s.toLowerCase());
    return this.say(find(id), idB ? find(idB) : -1);
  }

  /** FUN_00435b07: close both lines at once (skip key, or the machine's own end), state 0 */
  stop() {
    this.token++;
    for (const l of [this.a, this.b]) {
      if (!l) continue;
      l.status = 'done';
      const s = l.src;
      if (s) { s.onended = null; try { s.stop(); s.disconnect(); } catch { /* ignore */ } l.src = null; }
    }
    this.a = null; this.b = null;
    this.state = 0;
  }

  setVolume(opt22: number) { this.volume = opt22; }
}
