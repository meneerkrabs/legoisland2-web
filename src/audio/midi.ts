// Standard MIDI File parsing and a sample-accurate player on top of the DLS synth: the game's six looping ambience beds
// (Miles XMIDI sequences + a DLS bank, see docs/re/audio.md section 4.1) are plain .mid files.
import { DlsSynth } from './dm/synth.ts';
import type { DlsCollection, DlsInstrument } from './dm/dls.ts';

export interface SmfEvent { tick: number; ch: number; kind: 'on' | 'off' | 'cc' | 'prog' | 'bend' | 'tempo'; a: number; b: number }
export interface Smf { format: number; division: number; events: SmfEvent[]; lengthTicks: number; /** the latest end-of-track meta event (FF 2F) of any track: the length of the sequence */ endTick: number }

export function parseSmf(d: Uint8Array): Smf {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (String.fromCharCode(d[0], d[1], d[2], d[3]) !== 'MThd') throw new Error('not a MIDI file');
  const format = dv.getUint16(8), ntracks = dv.getUint16(10), division = dv.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE time division not supported');
  const events: SmfEvent[] = [];
  let pos = 14, lengthTicks = 0, endTick = 0;
  for (let t = 0; t < ntracks && pos + 8 <= d.length; t++) {
    const id = String.fromCharCode(d[pos], d[pos + 1], d[pos + 2], d[pos + 3]);
    const size = dv.getUint32(pos + 4);
    let p = pos + 8;
    const end = Math.min(d.length, p + size);
    pos = p + size;
    if (id !== 'MTrk') continue;
    let tick = 0, running = 0;
    const vlq = () => { let v = 0, b; do { b = d[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return v; };
    while (p < end) {
      tick += vlq();
      let st = d[p];
      if (st === 0xff) {
        const type = d[p + 1]; p += 2;
        const len = vlq();
        if (type === 0x51 && len === 3) events.push({ tick, ch: 0, kind: 'tempo', a: (d[p] << 16) | (d[p + 1] << 8) | d[p + 2], b: 0 });
        if (type === 0x2f && tick > endTick) endTick = tick;
        p += len;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) { p++; p += vlq(); continue; }
      if (st & 0x80) { running = st; p++; } else st = running;
      const kind = st & 0xf0, ch = st & 15;
      const a = d[p++];
      const b = kind === 0xc0 || kind === 0xd0 ? 0 : d[p++];
      if (kind === 0x90) events.push({ tick, ch, kind: b === 0 ? 'off' : 'on', a, b });
      else if (kind === 0x80) events.push({ tick, ch, kind: 'off', a, b });
      else if (kind === 0xb0) events.push({ tick, ch, kind: 'cc', a, b });
      else if (kind === 0xc0) events.push({ tick, ch, kind: 'prog', a, b: 0 });
      else if (kind === 0xe0) events.push({ tick, ch, kind: 'bend', a, b });
      if (tick > lengthTicks) lengthTicks = tick;
    }
  }
  events.sort((x, y) => x.tick - y.tick);
  return { format, division, events, lengthTicks, endTick: Math.max(endTick, lengthTicks) };
}

export interface TimedMidiEvent extends SmfEvent { time: number }

/** Absolute times in seconds (tempo map applied; default 120 BPM) and the total length. */
export function smfTimeline(smf: Smf): { events: TimedMidiEvent[]; length: number } {
  let tempo = 500000, lastTick = 0, sec = 0;
  const out: TimedMidiEvent[] = [];
  for (const e of smf.events) {
    sec += ((e.tick - lastTick) * tempo) / (smf.division * 1e6);
    lastTick = e.tick;
    if (e.kind === 'tempo') tempo = e.a;
    out.push({ ...e, time: sec });
  }
  // the sequence ends at its end-of-track event (the last notes are inside it), not at the last event
  if (smf.endTick > lastTick) sec += ((smf.endTick - lastTick) * tempo) / (smf.division * 1e6);
  return { events: out, length: sec };
}

function findInstrument(col: DlsCollection, msb: number, lsb: number, prog: number, drum: boolean): DlsInstrument | null {
  let loose: DlsInstrument | null = null;
  for (const i of col.instruments) {
    if (i.program !== prog) continue;
    if (i.drum === drum && i.msb === msb && i.lsb === lsb) return i;
    if (!loose || (i.drum === drum && !loose)) loose = i;
  }
  return loose;
}

/**
 * Plays one MIDI file through a DLS collection and restarts it when it ends: the game polls the Miles sequence status once per frame (FUN_00443230 ->
 * FUN_00875b16) and calls AIL_start_sequence when it reports DONE, i.e. within a frame of the end of the sequence (`gap` = half a frame on average). The end is the
 * SMF's end-of-track time; notes still sounding are released at the restart, not cut. Sample-accurate; `render` adds to L/R.
 */
export class MidiRenderer {
  readonly synth: DlsSynth;
  readonly sampleRate: number;
  private events: TimedMidiEvent[] = [];
  private idx = 0;
  private length = 0;
  private base = 0; // frame at which the current pass started
  private frame = 0;
  private collection: DlsCollection | null = null;
  private bank = new Map<number, { msb: number; lsb: number }>();
  loop = true;
  /** pause between two passes (seconds): the restart happens on the first frame tick after the sequence reported DONE (0..1/30 s, 1/60 on average) */
  gap = 1 / 60;
  playing = false;
  gain = 1;
  passes = 0;

  constructor(sampleRate: number, maxVoices = 32) {
    this.sampleRate = sampleRate;
    this.synth = new DlsSynth(sampleRate, maxVoices);
  }

  /** `delaySec`: FUN_00443230 counts 6 frames before it first starts the sequence */
  start(smf: Smf, collection: DlsCollection, delaySec = 0) {
    const tl = smfTimeline(smf);
    this.events = tl.events;
    this.length = tl.length;
    this.collection = collection;
    this.idx = 0;
    this.base = this.frame + Math.round(delaySec * this.sampleRate);
    this.playing = true;
    this.synth.allSoundOff();
    this.bank.clear();
  }

  stop() { this.playing = false; this.synth.allSoundOff(); }

  private apply(e: TimedMidiEvent) {
    const s = this.synth, col = this.collection!;
    switch (e.kind) {
      case 'on': s.noteOn(e.ch, e.a, e.b); break;
      case 'off': s.noteOff(e.ch, e.a); break;
      case 'cc': {
        if (e.a === 0 || e.a === 32) { const b = this.bank.get(e.ch) ?? { msb: 0, lsb: 0 }; if (e.a === 0) b.msb = e.b; else b.lsb = e.b; this.bank.set(e.ch, b); }
        s.cc(e.ch, e.a, e.b);
        break;
      }
      case 'prog': {
        const b = this.bank.get(e.ch) ?? { msb: 0, lsb: 0 };
        const ins = findInstrument(col, b.msb, b.lsb, e.a, e.ch === 9);
        s.setInstrument(e.ch, ins ? col : null, ins, {});
        break;
      }
      case 'bend': s.pitchBend(e.ch, (e.a | (e.b << 7)) - 8192); break;
      default: break;
    }
  }

  render(L: Float32Array, R: Float32Array, n: number) {
    let done = 0;
    while (done < n) {
      const here = this.frame + done;
      if (!this.playing) { done = n; break; }
      // apply events due
      while (this.idx < this.events.length && this.base + Math.round(this.events[this.idx].time * this.sampleRate) <= here) this.apply(this.events[this.idx++]);
      let stop = this.frame + n;
      if (this.idx < this.events.length) stop = Math.min(stop, this.base + Math.round(this.events[this.idx].time * this.sampleRate));
      else {
        const endFrame = this.base + Math.round(this.length * this.sampleRate);
        if (here >= endFrame + Math.round(this.gap * this.sampleRate)) {
          if (this.loop) { this.idx = 0; this.base = here; this.passes++; this.synth.releaseAll(); continue; }
          this.playing = false; continue;
        }
      }
      const chunk = Math.max(1, Math.min(stop - here, 256));
      this.synth.render(L, R, chunk, done);
      done += chunk;
    }
    if (this.gain !== 1) for (let i = 0; i < n; i++) { L[i] *= this.gain; R[i] *= this.gain; }
    this.frame += n;
  }
}
