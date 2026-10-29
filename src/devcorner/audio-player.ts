// Ontwikkelaarshoek, sections 8 and 9: the jukebox. One player for the whole corner: loose wavs, speech clips (MP3 inside a WAV container), MIDI files and DirectMusic segments /
// styles. Wavs and speech go through Web Audio buffers; music through the port's own DirectMusic engine (`MusicEngine` of src/audio/music.ts, its own instance: the game's
// music is not touched), MIDI through the port's DLS synth (`MidiRenderer`). It needs nothing from the shell but a `AudioContext`, a destination node and a file reader, so it runs
// against a fake context in tests; `state` is what the UI and the browser checks read (a muted browser has no audible output but the state moves on exactly the same).
import { readTolerant } from '../audio/files.ts';
import type { AudioFiles } from '../audio/files.ts';
import { unwrapMp3Wav } from '../audio/speech.ts';
import { MusicEngine } from '../audio/music.ts';
import type { MusicHandle } from '../audio/music.ts';
import { loadSegment } from '../audio/dm/assets.ts';
import { MidiRenderer, parseSmf } from '../audio/midi.ts';
import { parseDls } from '../audio/dm/dls.ts';
import { SynthStream } from '../audio/stream.ts';
import { loadStyleAssets } from './audio-music.ts';

/** what can be played */
export type JbSource =
  | { kind: 'wav'; path: string; label: string }
  | { kind: 'speech'; id: string; label: string }
  | { kind: 'midi'; path: string; dls: string; label: string }
  | { kind: 'sgt'; dir: string; file: string; dls: string; label: string }
  | { kind: 'sty'; dir: string; file: string; dls: string; label: string };

export const sourceKey = (s: JbSource): string => (s.kind === 'speech' ? `speech:${s.id.toLowerCase()}` : s.kind === 'wav' || s.kind === 'midi' ? `${s.kind}:${s.path.toLowerCase()}` : `${s.kind}:${s.dir.toLowerCase()}/${s.file.toLowerCase()}`);

export interface JbState {
  phase: 'idle' | 'loading' | 'playing' | 'ended' | 'error';
  kind: JbSource['kind'] | '';
  key: string;
  label: string;
  /** length in seconds (0 = unknown, music) */
  duration: number;
  /** AudioContext time at which it started */
  startedAt: number;
  error: string;
  /** the music repeats until stopped */
  loops: boolean;
  /** how many things were started so far (tests) */
  plays: number;
}

/** an error as text; a file name with a `+` that "is not a RIFF file" is the vite dev server answering its HTML page for the encoded `%2B` (the built game serves it) */
export function failText(e: unknown, key: string): string {
  const m = e instanceof Error ? e.message : String(e);
  return /RIFF|not a/i.test(m) && key.includes('+') ? `${m} (de vite-ontwikkelserver serveert bestandsnamen met + niet: dit is geen fout van het bestand)` : m;
}

const speechPath = (id: string) => `_data/sounds/speech/Data/${id}.mp3`;

export class Jukebox {
  readonly ctx: BaseAudioContext;
  private dest: AudioNode;
  private files: AudioFiles;
  state: JbState = { phase: 'idle', kind: '', key: '', label: '', duration: 0, startedAt: 0, error: '', loops: false, plays: 0 };
  /** called on every state change */
  onChange: (() => void)[] = [];
  private token = 0;
  private voice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private cache = new Map<string, Promise<AudioBuffer>>();
  private music: MusicEngine | null = null;
  private midi: { r: MidiRenderer; stream: SynthStream } | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  /** output volume 0..1 of the jukebox */
  volume = 1;

  constructor(ctx: BaseAudioContext, dest: AudioNode, files: AudioFiles) { this.ctx = ctx; this.dest = dest; this.files = files; }

  private set(p: Partial<JbState>) { Object.assign(this.state, p); for (const f of this.onChange) { try { f(); } catch { /* a listener must not stop the player */ } } }

  get playing(): boolean { return this.state.phase === 'playing' || this.state.phase === 'loading'; }
  isPlaying(s: JbSource): boolean { return this.playing && this.state.key === sourceKey(s); }
  /** seconds since the current sound started (0 when nothing plays) */
  elapsed(): number { return this.state.phase === 'playing' ? Math.max(0, this.ctx.currentTime - this.state.startedAt) : 0; }

  private decode(path: string, speech: boolean): Promise<AudioBuffer> {
    const k = path.toLowerCase();
    let p = this.cache.get(k);
    if (!p) {
      p = (async () => {
        const bytes = await readTolerant(this.files, path);
        if (!bytes || bytes.length < 45) throw new Error('bestand ontbreekt of is leeg');
        const tries: Uint8Array[] = speech ? [unwrapMp3Wav(bytes), bytes] : [bytes];
        let err: unknown = null;
        for (const t of tries) {
          try { return await this.ctx.decodeAudioData(t.slice().buffer); } catch (e) { err = e; }
        }
        throw new Error(`kan niet worden gedecodeerd (${err instanceof Error && err.message ? err.message : 'onbekend formaat'})`);
      })();
      this.cache.set(k, p);
      p.catch(() => this.cache.delete(k));
      if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  /** stop whatever plays (the state becomes `idle`) */
  stop() {
    this.token++;
    this.halt();
    if (this.state.phase !== 'idle') this.set({ phase: 'idle', loops: false });
  }

  private halt() {
    if (this.poll) { clearInterval(this.poll); this.poll = null; }
    const v = this.voice;
    this.voice = null;
    if (v) { v.src.onended = null; try { v.src.stop(); } catch { /* already stopped */ } try { v.src.disconnect(); v.gain.disconnect(); } catch { /* gone */ } }
    if (this.music) { try { this.music.stopAll(); } catch { /* silent */ } }
    if (this.midi) { this.midi.stream.stop(); this.midi.r.stop(); this.midi = null; }
  }

  async play(src: JbSource): Promise<void> {
    const tok = ++this.token;
    this.halt();
    const key = sourceKey(src);
    this.set({ phase: 'loading', kind: src.kind, key, label: src.label, duration: 0, error: '', loops: false });
    try {
      if (this.ctx.state === 'suspended' && 'resume' in this.ctx) { try { await (this.ctx as AudioContext).resume(); } catch { /* policy: stays suspended */ } }
      if (src.kind === 'wav' || src.kind === 'speech') await this.playBuffer(tok, src);
      else if (src.kind === 'midi') await this.playMidi(tok, src);
      else await this.playMusic(tok, src);
    } catch (e) {
      if (tok === this.token) { this.halt(); this.set({ phase: 'error', error: failText(e, key) }); }
    }
  }

  private async playBuffer(tok: number, src: JbSource & { kind: 'wav' | 'speech' }) {
    const buf = await this.decode(src.kind === 'speech' ? speechPath(src.id) : src.path, src.kind === 'speech');
    if (tok !== this.token) return;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = this.volume;
    s.connect(g); g.connect(this.dest);
    this.voice = { src: s, gain: g };
    s.onended = () => { if (this.voice?.src === s) { this.voice = null; this.set({ phase: 'ended' }); } };
    s.start();
    this.set({ phase: 'playing', duration: buf.duration, startedAt: this.ctx.currentTime, plays: this.state.plays + 1 });
  }

  private async playMidi(tok: number, src: JbSource & { kind: 'midi' }) {
    const [mid, dls] = await Promise.all([readTolerant(this.files, src.path), readTolerant(this.files, src.dls)]);
    if (!mid) throw new Error('MIDI-bestand ontbreekt');
    if (!dls) throw new Error('geen DLS-bank gevonden');
    if (tok !== this.token) return;
    const r = new MidiRenderer(this.ctx.sampleRate, 32);
    r.loop = false;
    r.start(parseSmf(mid), parseDls(dls), 0);
    r.gain = this.volume;
    const stream = new SynthStream(this.ctx, this.dest, (L, R, n) => r.render(L, R, n));
    this.midi = { r, stream };
    stream.start();
    this.poll = setInterval(() => { if (this.midi?.r === r && !r.playing) { this.halt(); this.set({ phase: 'ended' }); } }, 100);
    this.set({ phase: 'playing', startedAt: this.ctx.currentTime, plays: this.state.plays + 1 });
  }

  private async playMusic(tok: number, src: JbSource & { kind: 'sgt' | 'sty' }) {
    const read = (p: string) => this.files.read(`_data/sounds/DirectMusic/${p}`);
    let assets;
    let loops = false;
    if (src.kind === 'sgt') { assets = await loadSegment(read, src.dir, src.file, src.dls); loops = assets.seg.repeats > 0 && assets.seg.loopEnd > assets.seg.loopStart; }
    else assets = await loadStyleAssets(read, src.dir, src.file, src.dls);
    if (tok !== this.token) return;
    const eng = (this.music ??= new MusicEngine(this.ctx, this.dest, this.files, []));
    eng.setVolume(Math.round(80 * this.volume));
    const handle: MusicHandle = { key: src.file, entry: { key: src.file, dir: src.dir, segment: src.file, dls: src.dls }, assets };
    eng.play(handle, { prepareSec: 0.05 });
    this.poll = setInterval(() => { if (this.music && !this.music.playing && this.ctx.currentTime - this.state.startedAt > 1) { this.halt(); this.set({ phase: 'ended' }); } }, 100);
    this.set({ phase: 'playing', startedAt: this.ctx.currentTime, loops, plays: this.state.plays + 1 });
  }

  /** a short text for the state line */
  describe(): string {
    const s = this.state;
    switch (s.phase) {
      case 'idle': return 'stil';
      case 'loading': return `laden: ${s.label}`;
      case 'playing': return `speelt: ${s.label} (${this.elapsed().toFixed(1)}${s.duration ? ` / ${s.duration.toFixed(1)}` : ''} s${s.loops ? ', herhaalt' : ''})`;
      case 'ended': return `klaar: ${s.label}`;
      case 'error': return `fout: ${s.label}: ${s.error}`;
    }
  }
}
