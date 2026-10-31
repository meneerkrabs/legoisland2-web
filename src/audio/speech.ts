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
  /** port only: when the request was made / the audio started (performance.now), and whether the audio was in hand when the request was made (`stats.late` counts the others) */
  reqAt: number;
  readyAtRequest: boolean;
  /** port only: the hold for the data was given up (a stuck read): the line starts when the data comes */
  gaveUp: boolean;
}

/** how long the port holds a line's dependent pieces for its audio data before it lets the line go without (a read that never ends) */
const HOLD_GIVE_UP_MS = 10000;
/** decoded lines the prefetch keeps ahead of use (the rest of a prefetch list is only read into memory) */
const DECODE_AHEAD = 10;
/** lines of a prefetch list whose files are asked for in one go (neighbours in the cabinet become one range request) */
const READ_GROUP = 6;
/** same for lines that are only read (a whole table of an NPC story node: one request per 256 KB block of the disc image whatever the group size) */
const READ_GROUP_BYTES = 24;

export interface SpeechLag { id: string; /** request -> audio start, ms */ lagMs: number; /** time the dependent pieces were held for the data, ms */ heldMs: number; readyAtRequest: boolean }

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
  stats = { lines: 0, missing: 0, /** lines whose audio was not in hand when they were requested */ late: 0, /** ticks the machine was held for the data of a line */ heldTicks: 0, prefetched: 0 };
  /** port only: request -> audio start of every line that started (newest 300), for the measurements (tools/steps/speech-sync.mjs) */
  readonly lags: SpeechLag[] = [];
  /** the decoded lines in hand by lower-case id (null: no such file / not decodable): what makes a line start in the very tick that asks for it (the port's stand-in for the original's instant disk read) */
  private buffers = new Map<string, AudioBuffer | null>();
  /** the files' bytes (MPEG data) of lines read ahead, by lower-case id */
  private raw = new Map<string, Promise<Uint8Array | null>>();
  private rawOrder: string[] = [];
  /** the prefetch work list (lower-case ids -> ids as the table spells them) and whether a worker runs; lines decoded ahead of use */
  private queue: string[] = [];
  /** the lines that are only read (not decoded) */
  private bulk: string[] = [];
  private pumping = false;
  private pumpingBulk = false;
  private ahead: { k: string; at: number }[] = [];
  /** lines of prefetch lists that were only read because `DECODE_AHEAD` lines were already waiting decoded: decoded one by one as the lines before them are used */
  private later: string[] = [];
  /** performance.now() when the machine first waited for the line it wants to start next (null: not waiting) */
  private waitSince: number | null = null;

  constructor(ctx: BaseAudioContext, dest: AudioNode, files: AudioFiles, table: string[]) {
    this.ctx = ctx; this.dest = dest; this.files = files; this.table = table;
  }

  /**
   * FUN_00435ad3: true unless a line is running (state 1 or 2). The port adds the wait for the audio data (`waiting`): the original reads the file from disk inside the
   * request, so a request that has not started its audio yet is idle for one pass only; here the data may still be on its way, and callers (the NPC's conversation, the
   * cutscene's SAYTEXT) must not take that for the end of the speech.
   */
  get idle(): boolean { return !(this.state === 1 || this.state === 2) && !this.waiting; }
  /** a request exists (the original's DAT_009dab54 / 58 are not null) */
  get hasRequest(): boolean { return this.a !== null || this.b !== null; }

  idOf(index: number): string { return this.table[index] ?? ''; }

  /** the line the next machine pass would start (A of a fresh request, B once A has finished), null when none */
  private nextLine(): Line | null {
    const a = this.a;
    if (!a) return null;
    if (!a.started) return a;
    const b = this.b;
    if (b && !b.started && a.status !== 'playing') return b;
    return null;
  }

  /**
   * Port only: the line the machine starts next has no audio data in hand yet (the file is still being read from the disc image / decoded). The original's talk animation, subtitle
   * and speech-end timing begin together with the audio in one frame because its read is instant; here the pieces that depend on the audio (the NPC's talk clip and mouth, the
   * subtitle, the cutscene's mouth and its speech timer) wait while this is true, and the machine itself starts the line in the pass in which the data is there.
   */
  get waiting(): boolean {
    const l = this.nextLine();
    if (!l || l.gaveUp || l.index < 0) return false;
    const id = this.table[l.index];
    return !!id && !this.buffers.has(id.toLowerCase());
  }

  /** the MPEG bytes of a speech file (read once; a missing file is not remembered, a later request tries again) */
  private bytes(id: string): Promise<Uint8Array | null> {
    const k = id.toLowerCase();
    let p = this.raw.get(k);
    if (!p) {
      p = readTolerant(this.files, `_data/sounds/speech/Data/${id}.mp3`).then((b) => { if (!b) this.raw.delete(k); return b; });
      this.raw.set(k, p);
      this.rawOrder.push(k);
      if (this.rawOrder.length > 400) this.raw.delete(this.rawOrder.shift()!);
    }
    return p;
  }

  private async decode(id: string): Promise<AudioBuffer | null> {
    const k = id.toLowerCase();
    let p = this.cache.get(k);
    if (!p) {
      p = (async () => {
        const bytes = await this.bytes(id);
        if (!bytes) { this.stats.missing++; return null; }
        try { return await this.ctx.decodeAudioData(unwrapMp3Wav(bytes).slice().buffer); } catch { /* fall back to the whole file */ }
        try { return await this.ctx.decodeAudioData(bytes.slice().buffer); } catch { this.stats.missing++; return null; }
      })().then((buf) => { this.buffers.set(k, buf); if (!buf) this.cache.delete(k); return buf; });
      this.cache.set(k, p);
      this.order.push(k);
      if (this.order.length > 48) { const o = this.order.shift()!; this.cache.delete(o); this.buffers.delete(o); }
    }
    return p;
  }

  /** Decode a line ahead of time. */
  preload(index: number) { const id = this.table[index]; if (id) void this.decode(id); }

  /**
   * Port only: read lines into memory in the background before they are needed (never blocks play): the lines a cutscene / an NPC / a mini-game is going to say. `indices` are
   * speech table indices in the order they will be said. The files of a list are asked for in groups (`files.ready`: over the range route the neighbours in the disc image become
   * one request and the block cache keeps them), then the bytes are read and the first `DECODE_AHEAD` lines are decoded so they start in the very tick that asks for them;
   * `decode: false` only reads (the first line of every cutscene at zone start). A line asked for by `say` jumps the queue (its own read).
   */
  prefetch(indices: Iterable<number>, opts: { decode?: boolean } = {}) {
    const decode = opts.decode !== false;
    for (const i of indices) {
      const id = i >= 0 ? this.table[i] : '';
      if (!id) continue;
      const k = id.toLowerCase();
      const same = (x: string) => x.toLowerCase() === k;
      if (this.queue.some((x) => same(x))) continue;
      const bi = this.bulk.findIndex(same);
      if (bi >= 0) { if (!decode) continue; this.bulk.splice(bi, 1); }       // (a read-only entry that is asked to be decoded moves up to the decoding queue)
      else if (this.buffers.get(k) || (!decode && this.raw.has(k))) continue;
      (decode ? this.queue : this.bulk).push(id);
      this.stats.prefetched++;
    }
    if (this.queue.length && !this.pumping) void this.pump();
    if (this.bulk.length && !this.pumpingBulk) void this.pumpBulk();
  }

  /** Same by speech id strings. */
  prefetchIds(ids: Iterable<string>, opts: { decode?: boolean } = {}) {
    const find = (s: string) => this.table.findIndex((t) => t.toLowerCase() === s.toLowerCase());
    this.prefetch([...ids].map(find), opts);
  }

  /** decoded lines waiting for their use (the ones nobody used for a minute no longer count: they stay cached until the cache evicts them) */
  private aheadCount(): number {
    const t = performance.now() - 60000;
    this.ahead = this.ahead.filter((x) => x.at > t && this.cache.has(x.k));
    return this.ahead.length;
  }

  /** the lines that will be said soon: asked for in groups, in order, the first ones decoded */
  private async pump() {
    this.pumping = true;
    try {
      while (this.queue.length) {
        const group = this.queue.splice(0, READ_GROUP);
        try { await this.files.ready?.(group.map((id) => `_data/sounds/speech/Data/${id}.mp3`)); } catch { /* the reads below try again and fail quietly */ }
        for (const id of group) {
          const k = id.toLowerCase();
          if (this.buffers.has(k)) continue;
          if (this.aheadCount() < DECODE_AHEAD) { this.ahead.push({ k, at: performance.now() }); await this.decode(id).catch(() => null); }
          else { this.later.push(id); await this.bytes(id).catch(() => null); }
        }
      }
    } finally { this.pumping = false; }
  }

  /** the bulk reads (a whole story table, the first line of every cutscene): no decoding, never in the way of `pump` (its own requests, in parallel) */
  private async pumpBulk() {
    this.pumpingBulk = true;
    try {
      while (this.bulk.length) {
        const group = this.bulk.splice(0, READ_GROUP_BYTES);
        try { await this.files.ready?.(group.map((id) => `_data/sounds/speech/Data/${id}.mp3`)); } catch { /* ignore */ }
        await Promise.all(group.filter((id) => !this.buffers.has(id.toLowerCase())).map((id) => this.bytes(id).catch(() => null)));
      }
    } finally { this.pumpingBulk = false; }
  }

  /** FUN_00443630: open the stream (decoding starts now, playback at `start`) */
  private open(index: number): Line {
    let ready = true;
    const id = index >= 0 ? this.table[index] : '';
    if (id) {
      const k = id.toLowerCase();
      if (this.buffers.get(k) === null) this.buffers.delete(k);       // a file that was missing / unreadable is tried again
      ready = this.buffers.has(k);
      this.queue = this.queue.filter((x) => x.toLowerCase() !== k);
      this.bulk = this.bulk.filter((x) => x.toLowerCase() !== k);
      this.preload(index);
    }
    if (!ready) this.stats.late++;
    return { index, started: false, finished: false, status: 'idle', src: null, reqAt: performance.now(), readyAtRequest: ready, gaveUp: false };
  }

  /** FUN_008773fd: start the stream; the audio begins in this very call when the data is in hand (`waiting` makes the machine hold until then) */
  private start(l: Line) {
    l.started = true;
    l.status = 'playing';
    const id = this.table[l.index];
    const token = this.token;
    if (l.index < 0 || !id) { l.status = 'done'; return; }
    const k = id.toLowerCase();
    this.ahead = this.ahead.filter((x) => x.k !== k);
    while (this.later.length && this.aheadCount() < DECODE_AHEAD) {      // the next line of a prefetch list takes the place of the one that is used now
      const nx = this.later.shift()!, nk = nx.toLowerCase();
      if (this.buffers.has(nk) || this.cache.has(nk)) continue;
      this.ahead.push({ k: nk, at: performance.now() });
      void this.decode(nx);
    }
    if (this.buffers.has(k)) { this.begin(l, id, this.buffers.get(k) ?? null); return; }
    void this.decode(id).then((buf) => { if (token === this.token) this.begin(l, id, buf); });
  }

  private begin(l: Line, id: string, buf: AudioBuffer | null) {
    if (l.status !== 'playing') return;
    if (!buf) { l.status = 'done'; return; }
    const now = performance.now();
    this.lags.push({ id, lagMs: Math.round(now - l.reqAt), heldMs: this.waitSince === null ? 0 : Math.round(now - this.waitSince), readyAtRequest: l.readyAtRequest });
    if (this.lags.length > 300) this.lags.shift();
    this.waitSince = null;
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

  /**
   * FUN_00435a5e: once per loop pass (= once per sim step, 60 Hz). The warm-up counter adds the constant 1.0 (`_DAT_00892020`) per pass, NOT `DAT_008b1718`: it counts passes
   * (`_DAT_009dab5c <= 5.0` then `+ 1.0`: six passes whatever dt is). The argument is the old per-frame dt and is ignored.
   */
  tick(_dt?: number) {
    if (!this.a && !this.b) return;
    // port only: the line to start next has no audio data in hand: the machine holds (see `waiting`) and starts it in the pass in which the data is there
    let hold = this.waiting;
    if (hold) {
      const now = performance.now();
      this.waitSince ??= now;
      this.preload(this.nextLine()!.index);        // (a no-op while its read / decode runs; starts it again if the cache dropped the line meanwhile)
      if (now - this.waitSince > HOLD_GIVE_UP_MS) { this.nextLine()!.gaveUp = true; hold = false; }
    }
    if (this.warm <= 5) { this.warm += 1; return; }
    if (hold) { this.stats.heldTicks++; return; }
    this.state = this.step();
    if (this.state === 0) this.stop();
  }

  /** drive `tick` from a real-time timer at the sim's 60 Hz (pages without a game loop; wall time, there is no original pass to count) */
  startAutoTick() { if (this.timer === null) this.timer = setInterval(() => this.tick(), 1000 / 60); }
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
    this.waitSince = null;
  }

  setVolume(opt22: number) { this.volume = opt22; }
}
