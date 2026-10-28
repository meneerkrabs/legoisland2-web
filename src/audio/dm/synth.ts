// DLS wavetable synthesizer (software, sample-accurate, runs in node and in the browser).
// Implements what the game's 31 .dls collections use: PCM samples with key/velocity regions, forward loops, "no truncation",
// EG1 (attack / sustain / release), static pan and the usual MIDI controllers (volume, pan, expression, pitch bend, sustain pedal).
// The collections contain no LFO, no EG2 and no active filter (the cutoff connection is "disabled": 0x7fffffff); see docs/re/audio.md.
import type { DlsCollection, DlsConnection, DlsInstrument, DlsRegion, DlsWave, DlsWsmp } from './dls.ts';

const CONN_DST_PAN = 4, CONN_DST_EG1_ATTACK = 0x206, CONN_DST_EG1_DECAY = 0x207, CONN_DST_EG1_RELEASE = 0x209, CONN_DST_EG1_SUSTAIN = 0x20a, CONN_DST_EG1_DELAY = 0x20b, CONN_DST_EG1_HOLD = 0x20c;
const NO_TIME = -0x80000000;

/** DLS absolute time (cents of seconds, 16.16) -> seconds */
function timeSec(scale: number): number { return scale <= NO_TIME + 1 ? 0 : Math.pow(2, scale / 65536 / 1200); }

export interface SynthChannel {
  program: number;
  instrument: DlsInstrument | null;
  collection: DlsCollection | null;
  drum: boolean;
  volume: number; // CC7 0..127
  expression: number; // CC11
  pan: number; // CC10 0..127
  bend: number; // -8192..8191
  bendRange: number; // semitones
  transpose: number;
  sustain: boolean;
  mod: number;
  keyTable: DlsRegion[][] | null;
  held: Set<Voice>;
}

class Voice {
  active = false;
  ch!: SynthChannel;
  key = 0;
  rawKey = 0;
  region!: DlsRegion;
  wave!: DlsWave;
  data!: Float32Array;
  pos = 0;
  baseRatio = 0;
  loopStart = 0;
  loopEnd = 0;
  looped = false;
  noTrunc = false;
  // envelope
  stage = 0; // 0 delay/attack, 1 sustain, 2 release
  amp = 0;
  attackInc = 1;
  sustainLevel = 1;
  relMul = 0.999;
  releasePending = false;
  heldBySustain = false;
  velGain = 0;
  regionGain = 1;
  regionPan = 0; // -1..1
  keyGroup = 0;
  age = 0;
  gL = 0;
  gR = 0;
}

const LN10_96_20 = Math.log(10) * (-96 / 20); // ln of the -96 dB amplitude ratio

export class DlsSynth {
  readonly sampleRate: number;
  maxVoices: number;
  masterGain = 0.6;
  private voices: Voice[] = [];
  private channels = new Map<number, SynthChannel>();
  /** stats */
  stats = { noteOns: 0, noInstrument: 0, noRegion: 0, stolen: 0, peakVoices: 0, outOfRegion: new Map<string, number>() };

  constructor(sampleRate: number, maxVoices = 80) {
    this.sampleRate = sampleRate;
    this.maxVoices = maxVoices;
    for (let i = 0; i < maxVoices + 8; i++) this.voices.push(new Voice());
  }

  channel(pch: number): SynthChannel {
    let c = this.channels.get(pch);
    if (!c) {
      c = { program: 0, instrument: null, collection: null, drum: false, volume: 100, expression: 127, pan: 64, bend: 0, bendRange: 2, transpose: 0, sustain: false, mod: 0, keyTable: null, held: new Set() };
      this.channels.set(pch, c);
    }
    return c;
  }

  /** Select the instrument of a channel (band entry applied by the caller: volume, pan, transpose, bend range). */
  setInstrument(pch: number, collection: DlsCollection | null, instrument: DlsInstrument | null, opts: { volume?: number; pan?: number; transpose?: number; bendRange?: number } = {}) {
    const c = this.channel(pch);
    c.collection = collection;
    c.instrument = instrument;
    c.drum = !!instrument?.drum;
    c.keyTable = null;
    if (opts.volume !== undefined) c.volume = opts.volume;
    if (opts.pan !== undefined) c.pan = opts.pan;
    if (opts.transpose !== undefined) c.transpose = opts.transpose;
    if (opts.bendRange !== undefined) c.bendRange = opts.bendRange;
  }

  private regionsFor(c: SynthChannel, key: number, vel: number): DlsRegion[] {
    if (!c.instrument) return [];
    if (!c.keyTable) c.keyTable = new Array(128).fill(null);
    let list = c.keyTable[key];
    if (!list) { list = c.instrument.regions.filter((r) => key >= r.keyLow && key <= r.keyHigh); c.keyTable[key] = list; }
    return list.filter((r) => vel >= r.velLow && vel <= r.velHigh);
  }

  private connValue(r: DlsRegion, ins: DlsInstrument, dst: number): number | null {
    let v: number | null = null;
    for (const k of ins.conns) if (k.dst === dst && k.src === 0 && k.ctl === 0) v = k.scale;
    for (const k of r.conns) if (k.dst === dst && k.src === 0 && k.ctl === 0) v = k.scale;
    return v;
  }

  private allocVoice(): Voice {
    let n = 0;
    let free: Voice | null = null;
    for (const v of this.voices) { if (v.active) n++; else if (!free) free = v; }
    if (n >= this.maxVoices || !free) {
      // steal: prefer releasing voices, then the oldest
      let best: Voice | null = null, bestScore = -1;
      for (const v of this.voices) {
        if (!v.active) continue;
        const score = (v.stage === 2 ? 1e9 : 0) + v.age - v.amp * 1000;
        if (score > bestScore) { bestScore = score; best = v; }
      }
      if (best) { this.kill(best); free = best; this.stats.stolen++; }
    }
    return free!;
  }

  private kill(v: Voice) { v.active = false; v.ch.held.delete(v); }

  noteOn(pch: number, key: number, vel: number) {
    const c = this.channel(pch);
    this.stats.noteOns++;
    const k = Math.max(0, Math.min(127, key + c.transpose));
    if (vel === 0) { this.noteOff(pch, key); return; }
    if (!c.instrument) { this.stats.noInstrument++; return; }
    const regions = this.regionsFor(c, k, vel);
    if (!regions.length) {
      this.stats.noRegion++;
      const name = `${c.instrument.name}@${k}`;
      this.stats.outOfRegion.set(name, (this.stats.outOfRegion.get(name) ?? 0) + 1);
      return;
    }
    const col = c.collection!;
    for (const r of regions) {
      const wave = col.waves[r.waveIndex];
      if (!wave) continue;
      // exclusive key group (hi-hat style): cut the previous voice of the same group on this channel
      if (r.keyGroup) for (const o of c.held) if (o.keyGroup === r.keyGroup && o.stage !== 2) this.release(o, true);
      const v = this.allocVoice();
      const ws: DlsWsmp | null = r.wsmp ?? wave.wsmp;
      v.active = true; v.ch = c; v.key = k; v.rawKey = key; v.region = r; v.wave = wave; v.data = wave.data;
      v.pos = 0; v.age = 0;
      v.keyGroup = r.keyGroup;
      const unity = ws ? ws.unityNote : 60, fine = ws ? ws.fineTune : 0;
      v.baseRatio = (wave.sampleRate / this.sampleRate) * Math.pow(2, ((k - unity) * 100 + fine) / 1200);
      const lp = ws && ws.loops.length ? ws.loops[0] : null;
      v.looped = !!lp && lp.length > 1 && lp.start + lp.length <= wave.data.length;
      v.loopStart = lp ? lp.start : 0;
      v.loopEnd = lp ? lp.start + lp.length : 0;
      v.noTrunc = !!ws && (ws.options & 1) !== 0;
      const ins = c.instrument!;
      const atk = this.connValue(r, ins, CONN_DST_EG1_ATTACK), sus = this.connValue(r, ins, CONN_DST_EG1_SUSTAIN), rel = this.connValue(r, ins, CONN_DST_EG1_RELEASE);
      void CONN_DST_EG1_DECAY; void CONN_DST_EG1_DELAY; void CONN_DST_EG1_HOLD;
      const atkS = Math.max(0.002, atk === null ? 0 : timeSec(atk));
      v.attackInc = 1 / (atkS * this.sampleRate);
      v.sustainLevel = sus === null ? 1 : Math.max(0, Math.min(1, sus / 65536 / 1000));
      const relS = Math.max(0.015, rel === null ? 0 : timeSec(rel));
      v.relMul = Math.exp(LN10_96_20 / (relS * this.sampleRate));
      v.stage = 0; v.amp = 0; v.releasePending = false; v.heldBySustain = false;
      const pan = this.connValue(r, ins, CONN_DST_PAN);
      v.regionPan = pan === null ? 0 : Math.max(-1, Math.min(1, pan / 65536 / 500));
      v.velGain = (vel / 127) * (vel / 127);
      v.regionGain = ws ? Math.pow(10, ws.attenuation / 65536 / 20 / 10) : 1; // lAttenuation 1/655360 dB; all game files: 0
      c.held.add(v);
    }
    let n = 0;
    for (const v of this.voices) if (v.active) n++;
    if (n > this.stats.peakVoices) this.stats.peakVoices = n;
  }

  private release(v: Voice, fast = false) {
    if (v.stage === 2) return;
    if (!v.looped && v.noTrunc && !fast) { v.releasePending = true; return; }
    v.stage = 2;
    if (fast) v.relMul = Math.exp(LN10_96_20 / (0.008 * this.sampleRate));
  }

  noteOff(pch: number, key: number) {
    const c = this.channel(pch);
    const k = Math.max(0, Math.min(127, key + c.transpose));
    for (const v of c.held) {
      if (v.key !== k || v.stage === 2 || v.releasePending) continue;
      if (c.drum && !v.looped) continue; // percussion plays to the end of its sample (GM convention: note-off ignored)
      if (c.sustain) v.heldBySustain = true;
      else this.release(v);
    }
  }

  allNotesOff(pch: number) {
    const c = this.channel(pch);
    for (const v of c.held) this.release(v);
  }

  /** Forget every channel's instrument and controllers (a new primary segment starts; its bands send the patches again). */
  resetChannels() {
    for (const c of this.channels.values()) {
      for (const v of [...c.held]) this.release(v);
      c.instrument = null; c.collection = null; c.keyTable = null; c.drum = false;
      c.volume = 100; c.expression = 127; c.pan = 64; c.bend = 0; c.bendRange = 2; c.transpose = 0; c.sustain = false; c.mod = 0;
    }
  }

  allSoundOff() { for (const v of this.voices) if (v.active) this.kill(v); }

  cc(pch: number, cc: number, value: number) {
    const c = this.channel(pch);
    switch (cc) {
      case 1: c.mod = value; break;
      case 7: c.volume = value; break;
      case 10: c.pan = value; break;
      case 11: c.expression = value; break;
      case 64:
        c.sustain = value >= 64;
        if (!c.sustain) for (const v of c.held) if (v.heldBySustain) { v.heldBySustain = false; this.release(v); }
        break;
      case 120: for (const v of [...c.held]) this.kill(v); break;
      case 123: this.allNotesOff(pch); break;
      default: break;
    }
  }

  pitchBend(pch: number, value: number) { this.channel(pch).bend = value; }

  /** Number of voices currently sounding. */
  get activeVoices(): number { let n = 0; for (const v of this.voices) if (v.active) n++; return n; }

  /** Add `n` frames of output to L/R (not cleared). */
  render(L: Float32Array, R: Float32Array, n: number, offset = 0) {
    const master = this.masterGain;
    for (const v of this.voices) {
      if (!v.active) continue;
      const c = v.ch;
      const cv = c.volume / 127, ce = c.expression / 127;
      const chGain = cv * cv * ce * ce * v.velGain * v.regionGain * master;
      // pan: channel pan plus region pan, equal power
      const p = Math.max(0, Math.min(1, c.pan / 127 + v.regionPan * 0.5));
      const ang = p * Math.PI * 0.5;
      const gL = chGain * Math.cos(ang) * 1.4142, gR = chGain * Math.sin(ang) * 1.4142;
      const inc = v.baseRatio * (c.bend ? Math.pow(2, (c.bend / 8192) * c.bendRange / 12) : 1);
      const data = v.data;
      const len = data.length;
      let pos = v.pos, amp = v.amp, stage = v.stage;
      const looped = v.looped, ls = v.loopStart, le = v.loopEnd, ll = le - ls;
      const atkInc = v.attackInc, sus = v.sustainLevel, relMul = v.relMul;
      let alive = true;
      for (let i = 0; i < n; i++) {
        if (stage === 0) { amp += atkInc; if (amp >= 1) { amp = 1; stage = 1; } }
        else if (stage === 1) { if (amp > sus) { amp *= 0.99995; if (amp < sus) amp = sus; } }
        else { amp *= relMul; if (amp < 1e-5) { alive = false; break; } }
        let ip = pos | 0;
        if (ip >= len - 1 && !looped) {
          if (v.releasePending || stage === 2) { alive = false; break; }
          // sample finished (non-looping): the voice ends
          alive = false; break;
        }
        const fr = pos - ip;
        let i1 = ip + 1;
        if (looped && i1 >= le) i1 -= ll;
        const s = data[ip] + (data[i1] - data[ip]) * fr;
        const o = offset + i;
        const a = s * amp;
        L[o] += a * gL; R[o] += a * gR;
        pos += inc;
        if (looped && pos >= le) pos -= ll;
      }
      v.pos = pos; v.amp = amp; v.stage = stage; v.age += n;
      if (!alive) this.kill(v);
      else if (v.releasePending && !v.looped) {
        // no-truncation sample: the release starts once the sample has played out (handled by ending at the sample's end)
      }
    }
  }
}

export type { DlsConnection };
