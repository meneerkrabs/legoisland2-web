// DirectMusic "performance": plays segments by generating timed note / controller events.
//  - segments with a style track: patterns chosen by command (groove level) + style, parts expanded per measure,
//    music values converted through the chord / scale of the chord track (the DirectMusic composer rules)
//  - segments with a sequence track: the canned MIDI-like events
//  - tempo, band (patch) and mute tracks, loops/repeats, primary + secondary segments, transitions on a boundary
// Pure and deterministic given the seed (no DOM, no audio). The synth lives in synth.ts.
import { DMUS_PPQ } from './format.ts';
import type { DlsCollection } from './dls.ts';
import type { DmSegment, DmStyle, DmPattern, DmStylePart, DmPartRef, DmChord, DmSubChord, DmBandInstrument, DmTimeSig } from './format.ts';

export type DmEvent =
  | { tick: number; kind: 'note'; pch: number; key: number; vel: number; dur: number; /** source music value and play mode (style notes only; diagnostics) */ mv?: number; mode?: number }
  | { tick: number; kind: 'cc'; pch: number; cc: number; value: number }
  | { tick: number; kind: 'bend'; pch: number; value: number }
  | { tick: number; kind: 'patch'; pch: number; inst: DmBandInstrument; dls?: Map<string, DlsCollection> }
  | { tick: number; kind: 'tempo'; bpm: number }
  | { tick: number; kind: 'mute'; pch: number; mute: boolean }
  | { tick: number; kind: 'alloff'; pch: number }
  /** a new primary segment takes over: forget every channel's instrument and controllers */
  | { tick: number; kind: 'reset' }
  /** GUID_NOTIFICATION_SEGMENT: the segment started / looped / reached its end minus the prepare time / ended / was stopped or replaced (dmusici.h DMUS_NOTIFICATION_SEG*) */
  | { tick: number; kind: 'notify'; option: DmNotification };

export type DmNotification = 'start' | 'end' | 'almostend' | 'loop' | 'abort';

/** What a segment needs at playback time: its styles by (lower-case) file name. */
export interface DmSegmentAssets { seg: DmSegment; styles: Map<string, DmStyle>; /** DLS collections by lower-case file name ("" = primary), used to resolve band instruments */ dls?: Map<string, DlsCollection> }

// DMUS_PLAYMODE flags
export const PM_KEY_ROOT = 1, PM_CHORD_ROOT = 2, PM_SCALE_INTERVALS = 4, PM_CHORD_INTERVALS = 8, PM_NONE = 0x10;

// DMUS_COMMANDT
export const CMD_GROOVE = 0, CMD_FILL = 1, CMD_INTRO = 2, CMD_BREAK = 3, CMD_END = 4, CMD_ENDANDINTRO = 5;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function beatTicks(sig: DmTimeSig): number { return Math.round((DMUS_PPQ * 4) / sig.beat); }
export function measureTicks(sig: DmTimeSig): number { return beatTicks(sig) * sig.beatsPerMeasure; }

// ------------------------------------------------------------------ music value -> MIDI key

function bitsOf(pattern: number, bits = 24): number[] {
  const out: number[] = [];
  for (let i = 0; i < bits; i++) if (pattern & (1 << i)) out.push(i);
  return out;
}

/**
 * wMusicValue layout (derived from the game's data: percussion parts must land on the keys their DLS regions cover, and they do for
 * 96% of 4500 notes with this layout; see docs/re/audio.md):
 *   bits 12-15 octave (5 = middle C = MIDI 60)
 *   bits  8-11 chord tone index (0 root, 1 third, 2 fifth, 3 seventh, ...; tones the chord does not have come from the scale: degrees 1,3,5,7,9...)
 *   bits  4-7  scale offset: scale steps above that chord tone
 *   bits  0-3  accidental: signed semitone offset
 * Chord roots are 0..23 with 12 = C: the chord is transposed by (root - 12). The scale pattern is relative to C (scale root 0).
 * Play mode NORMAL (CHORD_ROOT | CHORD_INTERVALS | SCALE_INTERVALS) uses all of it; FIXED (0) takes the value as a MIDI key.
 */
export function musicValueToKey(value: number, mode: number, sub: DmSubChord): number {
  if (mode === 0) return value & 0x7f;
  const oct = value >> 12, ci = (value >> 8) & 15;
  const sg = (x: number) => (x > 7 ? x - 16 : x);
  const off = sg((value >> 4) & 15), acc = sg(value & 15);
  const sroot = sub.scaleRoot % 12;
  const sc = bitsOf(sub.scalePattern & 0xfff, 12).map((b) => (b + sroot) % 12).sort((a, b) => a - b);
  const chord = bitsOf(sub.chordPattern & 0xffffff, 24);
  const nsc = sc.length;
  // position of scale degree d (0-based, may exceed one octave) in semitones above C
  const scaleAt = (d: number) => { const o = Math.floor(d / nsc); return o * 12 + sc[((d % nsc) + nsc) % nsc]; };
  const rootIdx = (() => { const r = chord.length ? chord[0] : 0; let i = 0; while (i < nsc - 1 && sc[i + 1] <= r) i++; return i; })();
  let tone: number;
  if (mode & PM_CHORD_INTERVALS && chord.length) {
    tone = ci < chord.length ? chord[ci] : (nsc ? scaleAt(rootIdx + 2 * ci) - scaleAt(rootIdx) + (chord[0] ?? 0) : chord[ci % chord.length] + 12 * Math.floor(ci / chord.length));
  } else tone = 0;
  let step = tone;
  if (mode & PM_SCALE_INTERVALS && off !== 0 && nsc) {
    let i = 0;
    const base = ((tone % 12) + 12) % 12, octs = Math.floor(tone / 12);
    while (i < nsc - 1 && sc[i + 1] <= base) i++;
    step = scaleAt(i + off) + octs * 12;
  }
  const root = mode & PM_CHORD_ROOT ? sub.chordRoot - 12 : 0;
  return oct * 12 + root + step + acc;
}

/** What DirectMusic uses when a segment has no chord track: C major triad in C major, root 12 = C. */
const DEFAULT_CHORD: DmChord = { name: 'M', time: 0, measure: 0, beat: 0, flags: 0, subChords: [{ chordPattern: 0x91, scalePattern: 0xab5ab5, inversionPoints: 0xffffffff, levels: 0xffffffff, chordRoot: 12, scaleRoot: 0 }] };

function pickSubChord(chord: DmChord, level: number): DmSubChord {
  const bit = level < 32 ? (1 << level) >>> 0 : 0;
  for (const s of chord.subChords) if ((s.levels >>> 0) & bit) return s;
  return chord.subChords[0];
}

// ------------------------------------------------------------------ segment player

interface Plan {
  style: DmStyle;
  pattern: DmPattern;
  /** measure index within the pattern of the next window */
  measure: number;
  /** per partref: current variation and its lock id */
  variation: number[];
}

export interface SegmentPlayerOptions {
  rng: () => number;
  /** first local tick (segh playStart for a fresh start) */
  startLocal?: number;
  /** emit tempo events (primary segments only) */
  tempo?: boolean;
  /** GUID_PerfMasterGrooveLevel: added to the groove level of every command (read at every measure start) */
  groove?: () => number;
}

/** One playing instance of a segment. `generate(until)` yields events in performance ticks. */
export class SegmentPlayer {
  readonly assets: DmSegmentAssets;
  readonly startTick: number;
  rng: () => number;
  groove: () => number;
  emitTempo: boolean;
  /** local tick of the next window and its performance tick */
  local: number;
  perf: number;
  repeatsLeft: number;
  ended = false;
  /** every PChannel this instance has produced events for */
  readonly channels = new Set<number>();
  private plan: Plan | null = null;
  private lastStyleFile = '';
  private bandsDone = new Set<number>();

  constructor(assets: DmSegmentAssets, startTick: number, opts: SegmentPlayerOptions) {
    this.assets = assets;
    this.startTick = startTick;
    this.rng = opts.rng;
    this.emitTempo = opts.tempo ?? true;
    this.groove = opts.groove ?? (() => 0);
    const s = assets.seg;
    this.local = opts.startLocal ?? s.playStart;
    this.perf = startTick;
    this.repeatsLeft = s.repeats;
  }

  /** Time signature in force at a local tick (tims track, else the style's, else 4/4). */
  sigAt(local: number): DmTimeSig {
    const s = this.assets.seg;
    let sig: DmTimeSig | null = null;
    for (const t of s.timeSigs) if (t.time <= local) sig = t.sig;
    if (sig) return sig;
    const st = this.styleAt(local);
    return st ? st.timeSig : { beatsPerMeasure: 4, beat: 4, gridsPerBeat: 2 };
  }

  styleAt(local: number): DmStyle | null {
    let ref: string | null = null;
    for (const e of this.assets.seg.styles) if (e.time <= local) ref = e.ref.file;
    if (ref === null) return null;
    return this.assets.styles.get(ref.toLowerCase()) ?? null;
  }

  private commandAt(local: number) {
    let c = null;
    for (const e of this.assets.seg.commands) if (e.time <= local) c = e;
    return c;
  }

  private chordAt(local: number): DmChord | null {
    let c: DmChord | null = null;
    for (const e of this.assets.seg.chords) if (e.time <= local) c = e;
    return c ?? this.assets.seg.chords[0] ?? DEFAULT_CHORD;
  }

  /** Generate the next window (at most one beat, cut at loop / segment end). Returns false when the segment has ended. */
  generateWindow(out: DmEvent[]): boolean {
    if (this.ended) return false;
    const s = this.assets.seg;
    const loopable = s.loopEnd > s.loopStart && this.repeatsLeft > 0;
    const end = loopable ? s.loopEnd : s.length;
    if (this.local >= end) {
      if (loopable) {
        this.repeatsLeft--;
        this.local = s.loopStart;
        this.plan = null;
        this.bandsDone.clear();
        out.push({ tick: this.perf, kind: 'notify', option: 'loop' });   // DMUS_NOTIFICATION_SEGLOOP at every wrap
        return this.generateWindow(out);
      }
      this.ended = true;
      return false;
    }
    const sig = this.plan ? this.plan.pattern.timeSig : this.sigAt(this.local);
    const mlen = measureTicks(sig), blen = beatTicks(sig);
    const intoMeasure = this.local % mlen;
    let wlen = blen - (this.local % blen);
    if (this.local + wlen > end) wlen = end - this.local;
    const ws = this.local, we = ws + wlen;
    const shift = this.perf - ws;

    const n0 = out.length;
    this.emitTracks(ws, we, shift, out);
    this.emitPatterns(ws, we, intoMeasure === 0, ws - intoMeasure, shift, out);
    for (let k = n0; k < out.length; k++) { const e = out[k]; if ('pch' in e) this.channels.add(e.pch); }

    this.local = we;
    this.perf = we + shift;
    return true;
  }

  private emitTracks(ws: number, we: number, shift: number, out: DmEvent[]) {
    const s = this.assets.seg;
    // tempo
    if (this.emitTempo) for (const t of s.tempos) if (t.time >= ws && t.time < we) out.push({ tick: t.time + shift, kind: 'tempo', bpm: t.tempo });
    // bands: the band in force at the window start is (re)sent when entering the segment, later ones at their time
    for (let i = 0; i < s.bands.length; i++) {
      const b = s.bands[i];
      const due = b.time < we && (b.time >= ws || (!this.bandsDone.has(i) && b.time < ws));
      if (!due || this.bandsDone.has(i)) continue;
      // when starting mid-way only the latest band before ws matters; sending all in order is equivalent
      this.bandsDone.add(i);
      for (const inst of b.band.instruments) out.push({ tick: Math.max(b.time, ws) + shift, kind: 'patch', pch: inst.pchannel, inst, dls: this.assets.dls });
    }
    // mute
    for (const m of s.mutes) if (m.time >= ws && m.time < we) out.push({ tick: m.time + shift, kind: 'mute', pch: m.pchannel, mute: m.mute });
    // sequence items
    for (const e of s.sequence) {
      const t = e.time + e.offset;
      if (!(e.time >= ws && e.time < we)) continue;
      const st = e.status & 0xf0;
      if (st === 0x90) out.push({ tick: t + shift, kind: 'note', pch: e.pchannel, key: e.data1, vel: e.data2, dur: Math.max(1, e.duration) });
      else if (st === 0xb0) out.push({ tick: t + shift, kind: 'cc', pch: e.pchannel, cc: e.data1, value: e.data2 });
      else if (st === 0xe0) out.push({ tick: t + shift, kind: 'bend', pch: e.pchannel, value: (e.data1 | (e.data2 << 7)) - 8192 });
    }
    for (const c of s.curves) if (c.time >= ws && c.time < we) this.emitCurve(out, c.time + c.offset + shift, c.pchannel, c.eventType, c.shape, c.ccData, c.startValue, c.endValue, c.duration, c.resetValue, c.resetDuration, c.flags);
  }

  private emitCurve(out: DmEvent[], tick: number, pch: number, type: number, shape: number, cc: number, v0: number, v1: number, dur: number, reset: number, resetDur: number, flags: number) {
    const mk = (t: number, v: number) => {
      if (type === 3) out.push({ tick: t, kind: 'bend', pch, value: v - 8192 });
      else if (type === 4) out.push({ tick: t, kind: 'cc', pch, cc, value: Math.max(0, Math.min(127, v)) });
    };
    if (type !== 3 && type !== 4) return;
    if (shape === 1 || dur <= 1) mk(tick, v1 === undefined ? v0 : (dur <= 1 ? v1 : v0));
    else {
      const n = Math.max(2, Math.min(16, Math.round(dur / 48)));
      for (let i = 0; i <= n; i++) {
        let f = i / n;
        if (shape === 2) f = f * f; else if (shape === 3) f = Math.sqrt(f); else if (shape === 4) f = (1 - Math.cos(Math.PI * f)) / 2;
        mk(tick + Math.round((dur * i) / n), Math.round(v0 + (v1 - v0) * f));
      }
    }
    if (flags & 1 && resetDur > 0) mk(tick + Math.max(dur, 0) + resetDur, reset);
  }

  private choosePattern(style: DmStyle, groove: number, rhythmWant: number): DmPattern | null {
    const normal = style.patterns.filter((p) => p.embellishment === 0 || p.embellishment === undefined);
    const pool = normal.length ? normal : style.patterns;
    let cand = pool.filter((p) => groove >= p.grooveBottom && groove <= p.grooveTop);
    if (!cand.length) {
      // nearest groove range
      let best = Infinity;
      for (const p of pool) { const d = groove < p.grooveBottom ? p.grooveBottom - groove : groove - p.grooveTop; if (d < best) best = d; }
      cand = pool.filter((p) => (groove < p.grooveBottom ? p.grooveBottom - groove : groove - p.grooveTop) === best);
    }
    if (!cand.length) return null;
    void rhythmWant;
    return cand[Math.floor(this.rng() * cand.length) % cand.length];
  }

  private emitPatterns(ws: number, we: number, measureStart: boolean, mstart: number, shift: number, out: DmEvent[]) {
    const style = this.styleAt(ws);
    if (!style) { this.plan = null; return; }
    if (measureStart || !this.plan) {
      const cmd = this.commandAt(ws);
      let groove = (cmd ? cmd.grooveLevel : 1) + this.groove();
      groove = Math.max(1, Math.min(100, groove));
      if (cmd && cmd.grooveRange > 0) groove += Math.floor(this.rng() * (cmd.grooveRange + 1)) - (cmd.grooveRange >> 1);
      const styleKey = style.guid + style.name;
      const p = this.plan;
      const keep = p && styleKey === this.lastStyleFile && p.measure + 1 < p.pattern.measures && groove >= p.pattern.grooveBottom && groove <= p.pattern.grooveTop;
      if (keep && p) { p.measure++; }
      else {
        const pat = this.choosePattern(style, groove, 0);
        if (!pat) { this.plan = null; return; }
        this.plan = { style, pattern: pat, measure: 0, variation: pat.partRefs.map(() => -1) };
        this.lastStyleFile = styleKey;
      }
      // variations are chosen once per part cycle (locked parts share the choice)
      const plan = this.plan!;
      const locks = new Map<number, number>();
      plan.pattern.partRefs.forEach((ref, idx) => {
        const part = style.parts.get(ref.guid);
        if (!part) return;
        if (plan.measure % Math.max(1, part.measures) === 0 || plan.variation[idx] < 0) plan.variation[idx] = this.chooseVariation(part, ref, locks);
      });
    }
    const plan = this.plan;
    if (!plan || !this.chordAt(ws)) return;
    plan.pattern.partRefs.forEach((ref, idx) => {
      const part = style.parts.get(ref.guid);
      if (!part || (!part.notes.length && !part.curves.length)) return;
      this.emitPart(out, part, ref, plan.measure % Math.max(1, part.measures), plan.variation[idx], mstart, ws, we, shift);
    });
  }

  private chooseVariation(part: DmStylePart, ref: DmPartRef, locks: Map<number, number>): number {
    let mask = 0;
    for (const n of part.notes) mask |= n.variation;
    for (const c of part.curves) mask |= c.variation;
    const eligible: number[] = [];
    for (let i = 0; i < 32; i++) if (mask & (1 << i) && part.variationChoices[i] !== 0) eligible.push(i);
    if (!eligible.length) return 0;
    const lock = ref.variationLockId & 0x7f;
    if (lock) {
      const l = locks.get(lock);
      if (l !== undefined && eligible.includes(l)) return l;
    }
    const v = eligible[Math.floor(this.rng() * eligible.length) % eligible.length];
    if (lock) locks.set(lock, v);
    return v;
  }

  private emitPart(out: DmEvent[], part: DmStylePart, ref: DmPartRef, pm: number, variation: number, mstart: number, ws: number, we: number, shift: number) {
    const sig = part.timeSig;
    const gridTicks = beatTicks(sig) / sig.gridsPerBeat;
    const gpm = sig.beatsPerMeasure * sig.gridsPerBeat;
    const g0 = pm * gpm;
    // grid range of this window inside the measure (rounded: grids start at ws exactly when the window is grid aligned)
    const gA = g0 + Math.ceil((ws - mstart) / gridTicks - 1e-6), gB = g0 + Math.ceil((we - mstart) / gridTicks - 1e-6);
    const vbit = 1 << variation;
    const rng = this.rng;
    for (const n of part.notes) {
      if (n.grid < gA || n.grid >= gB || !(n.variation & vbit)) continue;
      const local = mstart + Math.round((n.grid - g0) * gridTicks) + n.timeOffset + (n.timeRange ? Math.round(rng() * n.timeRange - n.timeRange / 2) : 0);
      const mode = n.playMode === PM_NONE ? part.playMode : n.playMode;
      const chord = this.chordAt(Math.max(mstart, local));
      if (!chord || !chord.subChords.length) continue;
      const sub = pickSubChord(chord, ref.subChordLevel);
      const key = musicValueToKey(n.musicValue, mode, sub);
      let vel = n.velocity + (n.velRange ? Math.round(rng() * n.velRange - n.velRange / 2) : 0);
      vel = Math.max(1, Math.min(127, vel));
      const dur = Math.max(1, n.duration + (n.durRange ? Math.round(rng() * n.durRange - n.durRange / 2) : 0));
      out.push({ tick: local + shift, kind: 'note', pch: ref.pchannel, key, vel, dur, mv: n.musicValue, mode });
    }
    for (const c of part.curves) {
      if (c.grid < gA || c.grid >= gB || !(c.variation & vbit)) continue;
      const local = mstart + Math.round((c.grid - g0) * gridTicks) + c.timeOffset;
      this.emitCurve(out, local + shift, ref.pchannel, c.eventType, c.shape, c.ccData, c.startValue, c.endValue, c.duration, c.resetValue, c.resetDuration, c.flags);
    }
  }
}

// ------------------------------------------------------------------ performance

export type Boundary = 'immediate' | 'beat' | 'measure' | 'segmentEnd';

export interface PlayOptions {
  /** secondary segments play on top of the primary one (stingers, mute/control segments) */
  secondary?: boolean;
  boundary?: Boundary;
  /** first local tick (default: segment playStart) */
  startLocal?: number;
  /** repeat count override */
  repeats?: number;
  /**
   * Start time in performance seconds (the renderer's clock). A primary segment started this way replaces the running one exactly then:
   * what the old segment would still play from that instant on is dropped, its notes are released (DirectMusic: `PlaySegment` with a start time and no
   * boundary flag; `DMUS_SEGF_AFTERPREPARETIME` resolves "now" to now + prepare time, audio.md 7.3). Overrides `boundary`.
   */
  atSec?: number;
}

export interface SegmentHandle { id: number; assets: DmSegmentAssets; secondary: boolean; started: boolean; ended: boolean }

interface Inst { handle: SegmentHandle; player: SegmentPlayer; stopAt: number }
interface Pending { handle: SegmentHandle; assets: DmSegmentAssets; atTick: number; opts: PlayOptions }
const ownerOf = new WeakMap<DmEvent, Inst>();

/**
 * Clock in ticks (768 per quarter note) with a piecewise-constant tempo map. Events come out of `run(untilSeconds)`
 * with absolute `time` in seconds (relative to performance time 0).
 * Generation is lazy: one beat per step, so a transition request is honoured at most one beat (or the requested boundary) after the
 * point generated so far.
 */
export class DmPerformance {
  seed: number;
  rng: () => number;
  bpm = 120;
  /** GUID_PerfMasterGrooveLevel (signed byte): offset added to every command's groove level; the game sets level - 3 (-2..0) */
  grooveLevel = 0;
  private bp: { tick: number; sec: number; bpm: number }[] = [{ tick: 0, sec: 0, bpm: 120 }];
  private primary: Inst | null = null;
  private secondaries: Inst[] = [];
  private pending: Pending[] = [];
  private nextId = 1;
  private buffer: DmEvent[] = [];
  private clockSec = 0;
  private mutes = new Set<number>();
  /** statistics for tests */
  stats = { windows: 0, notes: 0, droppedMuted: 0 };

  constructor(seed = 1) { this.seed = seed; this.rng = mulberry32(seed); }

  // ---- clock
  tickToSec(tick: number): number {
    let i = this.bp.length - 1;
    while (i > 0 && this.bp[i].tick > tick) i--;
    const b = this.bp[i];
    return b.sec + ((tick - b.tick) * 60) / (b.bpm * DMUS_PPQ);
  }
  secToTick(sec: number): number {
    let i = this.bp.length - 1;
    while (i > 0 && this.bp[i].sec > sec) i--;
    const b = this.bp[i];
    return b.tick + (sec - b.sec) * (b.bpm * DMUS_PPQ) / 60;
  }
  private setTempo(tick: number, bpm: number) {
    const last = this.bp[this.bp.length - 1];
    if (tick <= last.tick) { last.bpm = bpm; this.bpm = bpm; return; }
    this.bp.push({ tick, sec: this.tickToSec(tick), bpm });
    this.bpm = bpm;
  }

  // ---- control
  get playing(): boolean { return !!this.primary || this.secondaries.length > 0 || this.pending.length > 0; }
  get primaryHandle(): SegmentHandle | null { return this.primary ? this.primary.handle : null; }
  /** the performance tick up to which the primary segment has been generated (start of its next window) */
  get generatedTick(): number { return this.primary ? this.primary.player.perf : Math.max(0, Math.ceil(this.secToTick(this.clockSec))); }

  private boundaryTick(boundary: Boundary): number {
    const p = this.primary;
    const at = this.generatedTick;
    if (!p || boundary === 'immediate') return at;
    const pl = p.player, s = pl.assets.seg;
    const loopable = s.loopEnd > s.loopStart && pl.repeatsLeft > 0;
    const end = loopable ? s.loopEnd : s.length;
    const rest = Math.max(0, end - pl.local);
    if (boundary === 'segmentEnd') return at + rest;
    const sig = pl.sigAt(pl.local);
    const unit = boundary === 'beat' ? beatTicks(sig) : measureTicks(sig);
    const off = (unit - (pl.local % unit)) % unit;
    return at + Math.min(off, rest);
  }

  /** Queue a segment: it starts at the first boundary at or after what has been generated so far. */
  play(assets: DmSegmentAssets, opts: PlayOptions = {}): SegmentHandle {
    const handle: SegmentHandle = { id: this.nextId++, assets, secondary: !!opts.secondary, started: false, ended: false };
    const atTick = opts.atSec !== undefined ? this.atSecTick(opts.atSec) : opts.secondary && !this.primary ? this.generatedTick : this.boundaryTick(opts.boundary ?? 'immediate');
    this.pending.push({ handle, assets, atTick, opts });
    this.pending.sort((a, b) => a.atTick - b.atTick);
    return handle;
  }

  private atSecTick(sec: number): number { return Math.max(0, Math.round(this.secToTick(sec))); }

  /** Stop a segment (or everything when omitted) at the boundary: notes are released and generation stops. */
  stop(handle?: SegmentHandle | null, boundary: Boundary = 'immediate') {
    const at = this.boundaryTick(boundary);
    const targets: Inst[] = [];
    if (!handle) { if (this.primary) targets.push(this.primary); targets.push(...this.secondaries); this.pending = []; }
    else {
      for (const i of [this.primary, ...this.secondaries]) if (i && i.handle === handle) targets.push(i);
      this.pending = this.pending.filter((p) => p.handle !== handle);
    }
    for (const t of targets) t.stopAt = Math.min(t.stopAt, at);
  }

  private startPending(p: Pending) {
    const player = new SegmentPlayer(p.assets, p.atTick, { rng: this.rng, startLocal: p.opts.startLocal, tempo: !p.opts.secondary, groove: () => this.grooveLevel });
    if (p.opts.repeats !== undefined) player.repeatsLeft = p.opts.repeats;
    const inst: Inst = { handle: p.handle, player, stopAt: Infinity };
    p.handle.started = true;
    if (p.opts.secondary) this.secondaries.push(inst);
    else {
      if (this.primary) {
        // a start time inside already generated windows: what the old primary produced from that tick on never sounds
        const old = this.primary;
        if (p.opts.atSec !== undefined) this.buffer = this.buffer.filter((e) => !(e.tick >= p.atTick && ownerOf.get(e) === old));
        this.endInstance(this.primary, p.atTick, true);
      }
      this.buffer.push({ tick: p.atTick, kind: 'reset' });
      this.buffer.push({ tick: p.atTick, kind: 'notify', option: 'start' });
      this.primary = inst;
    }
  }

  private endInstance(i: Inst, tick: number, release: boolean) {
    i.handle.ended = true;
    // a segment that is cut (stopped, replaced) reports SEGABORT; one that played to its end SEGEND (release = false)
    if (!i.handle.secondary) this.buffer.push({ tick, kind: 'notify', option: release ? 'abort' : 'end' });
    if (release) for (const c of i.player.channels) this.buffer.push({ tick, kind: 'alloff', pch: c });
    if (this.primary === i) this.primary = null;
    this.secondaries = this.secondaries.filter((s) => s !== i);
  }

  /**
   * Generate events until the given time (seconds): windows (one beat each) are produced while their start lies before it.
   * Returned events have absolute `time` in seconds, sorted.
   */
  run(untilSec: number): (DmEvent & { time: number })[] {
    const result: (DmEvent & { time: number })[] = [];
    this.clockSec = Math.max(this.clockSec, untilSec);
    for (let guard = 0; ; guard++) {
      if (guard > 1000000) throw new Error('DmPerformance.run: runaway');
      // pending starts given in seconds follow the tempo map as it grows
      let resort = false;
      for (const p of this.pending) if (p.opts.atSec !== undefined) { const t = this.atSecTick(p.opts.atSec); if (t !== p.atTick) { p.atTick = t; resort = true; } }
      if (resort) this.pending.sort((a, b) => a.atTick - b.atTick);
      const live: Inst[] = [];
      if (this.primary) live.push(this.primary);
      live.push(...this.secondaries);
      // candidate with the smallest tick: an instance (next window) or a pending start
      let bestTick = Infinity, bestInst: Inst | null = null, bestPending = false;
      for (const i of live) if (i.player.perf < bestTick) { bestTick = i.player.perf; bestInst = i; }
      if (this.pending.length && this.pending[0].atTick <= bestTick) { bestTick = this.pending[0].atTick; bestInst = null; bestPending = true; }
      if (bestTick === Infinity || this.tickToSec(bestTick) > untilSec) break;
      if (bestPending) {
        this.startPending(this.pending.shift()!);
      } else if (bestInst) {
        const i = bestInst;
        if (i.player.perf >= i.stopAt) { this.endInstance(i, i.stopAt, true); }
        else {
          const win: DmEvent[] = [];
          const ok = i.player.generateWindow(win);
          this.stats.windows++;
          for (const e of win) { ownerOf.set(e, i); this.buffer.push(e); }
          if (!ok) this.endInstance(i, i.player.perf, false);
        }
      }
      this.flush(result, this.nextTick());
    }
    this.flush(result, Infinity);
    result.sort((a, b) => a.time - b.time);
    return result;
  }

  private nextTick(): number {
    let m = Infinity;
    if (this.primary) m = Math.min(m, this.primary.player.perf);
    for (const s of this.secondaries) m = Math.min(m, s.player.perf);
    if (this.pending.length) m = Math.min(m, this.pending[0].atTick);
    return m;
  }

  /** Process buffered events in tick order up to `limit` (exclusive): tempo changes, mutes, then convert to seconds. */
  private flush(result: (DmEvent & { time: number })[], limit: number) {
    const ready: DmEvent[] = [], keep: DmEvent[] = [];
    for (const e of this.buffer) (e.tick < limit ? ready : keep).push(e);
    this.buffer = keep;
    const prio = (e: DmEvent) => (e.kind === 'reset' ? 0 : e.kind === 'notify' ? 4 : e.kind === 'tempo' ? 0 : e.kind === 'patch' || e.kind === 'mute' ? 1 : e.kind === 'alloff' ? 2 : 3);
    ready.sort((a, b) => a.tick - b.tick || prio(a) - prio(b));
    for (const e of ready) {
      if (e.kind === 'tempo') this.setTempo(e.tick, e.bpm);
      else if (e.kind === 'mute') { if (e.mute) this.mutes.add(e.pch); else this.mutes.delete(e.pch); }
      else if (e.kind === 'note' && this.mutes.has(e.pch)) { this.stats.droppedMuted++; continue; }
      if (e.kind === 'note') this.stats.notes++;
      result.push({ ...e, time: this.tickToSec(e.tick) });
    }
  }
}
