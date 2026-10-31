// Miles' MIDI -> XMIDI conversion as far as it decides WHEN things happen (the game converts every ambience bed with `AIL_MIDI_to_XMI` before playing it: `FUN_00875918` / `FUN_00875a26`;
// mss32.dll `_AIL_MIDI_to_XMI@20` = 0x2110d330, the converter 0x2112a670, its clock 0x2112a170). The converted sequence is played by the Miles sequencer at its service rate (preference 3 =
// MDI service rate, 120 Hz by default: `AIL_startup` -> 0x21101260) and ends at its end-of-track event (status DONE, which the game polls once per loop pass).
//
// What the converter does (verified against the real converter run on the x86 emulator, tools/tests/audio-mss-xmi.mjs: every ambience file and random files, event for event):
//   * the SMF's tracks are merged by the converter's selection (`smfToXmi`); every event of every track (also meta events and sysex) is a step of the clock;
//   * the clock: a time unit per SMF tick `unit = floor(tempo * 100 / division)` (tempo in us / quarter note, default 500000; a tempo meta event is parsed when it is selected, BEFORE the clock steps, so it counts for the ticks that lead up to it) in units of 10 ns,
//     and one XMIDI tick = `floor(1e8 / rate)` = 833333 of those units (rate 120). Per step: `acc = acc + delta * unit`, then one XMIDI tick is counted per 833333 subtracted from `acc`.
//     The game runs the x87 in 24-bit precision (Direct3D 7), so the converter's own double arithmetic rounds every product / sum / difference to a float mantissa: `acc` is a float32 value
//     (`fr` below). That is visible: with 53-bit arithmetic one event in a thousand lands one tick earlier;
//   * a note-on becomes one XMIDI event with a DURATION: the ticks up to the NEXT note-off (or note-on with velocity 0) of the same channel and key after it in the merged order (a note-off
//     serves every note-on before it; stray note-offs are dropped); a note-on without one makes the conversion fail (the ambience files have none);
//   * every other channel event (controller, program, pitch bend) keeps its place in the merged order; tempo / time signature meta events stay but do not change the playback speed;
//   * one end-of-track event at the latest end-of-track tick.
// The sequencer (0x211172a0, once per service tick): first the note durations count down (a note ends in the tick `on + max(duration, 1)`, BEFORE the events of that tick), then the delay
// counter, then the events of the tick in stream order. The end-of-track event ends the sequence (AIL_end_sequence: note-off for every sounding note) and reports DONE.
import type { Smf, SmfEvent, TimedMidiEvent } from './midi.ts';

/** AIL preference 3 (MDI_SERVICE_RATE), set to 120 by AIL_startup's defaults (0x2114e5e8 = 0x78) */
export const XMI_SERVICE_RATE = 120;
/** 1e8 / rate: one XMIDI tick in the converter's units (the integer division of 0x2112a0c0) */
export const XMI_TICK_UNITS = Math.trunc(1e8 / XMI_SERVICE_RATE);
const fr = Math.fround;

/** the converter's clock (0x2112a170): float24 accumulation, `ticks` counts the XMIDI ticks */
export class XmiClock {
  acc = 0;
  ticks = 0;
  /** one step of `delta` SMF ticks at `unit`: returns the XMIDI tick count so far */
  step(delta: number, unit: number): number {
    const prod = fr(delta * unit);            // fmulp (24-bit)
    this.acc = fr(prod + this.acc);           // fadd [acc]
    if (!(this.acc < XMI_TICK_UNITS)) {
      let a = this.acc;
      do { a = fr(a - XMI_TICK_UNITS); this.ticks++; } while (!(a < XMI_TICK_UNITS));   // fsub; fcom; je loop
      this.acc = a;
    }
    return this.ticks;
  }
}

export interface XmiSequence {
  /** channel events in play order; a note-on has `dur` (XMIDI ticks); `tick` is in XMIDI ticks */
  events: (SmfEvent & { dur?: number })[];
  /** the end-of-track tick */
  eot: number;
  /** unmatched note-ons (the original's converter refuses such a file): their notes last until the end of the sequence here */
  unmatched: number;
}

/**
 * the XMIDI form of a parsed SMF (timing and order exactly as Miles' converter): the tracks are merged by the converter's own selection (0x2112a030): per step the track whose next event comes
 * first, scanning the tracks from the one served last downwards (cyclically, starting with the last track) and letting a LATER scanned track win a tie: events of different tracks at one
 * tick therefore alternate between the tracks instead of following track order
 */
export function smfToXmi(smf: Smf): XmiSequence {
  const unitOf = (tempo: number) => Math.floor(tempo * 100 / smf.division);
  const n = smf.tracks.length;
  const pos = new Array<number>(n).fill(0);
  const active = smf.tracks.map((t) => t.length > 0);
  const clock = new XmiClock();
  let unit = Math.floor(50000000 / smf.division), G = 0, last = n - 1;
  const merged: { x: number; ev: SmfEvent }[] = [];
  for (;;) {
    let best = -1, bd = Infinity, idx = last;
    for (let k = 0; k < n; k++) {
      if (active[idx]) { const d = smf.tracks[idx][pos[idx]].tick - G; if (d <= bd) { bd = d; best = idx; } }
      idx = idx === 0 ? n - 1 : idx - 1;
    }
    if (best < 0) break;
    G += bd;
    last = best;
    const e = smf.tracks[best][pos[best]++];
    // the selected event is parsed BEFORE the clock steps (0x2112a030 -> 0x21129de0, then 0x2112a170): a tempo event already counts for the delta that leads up to it
    if (e.ev && e.ev.kind === 'tempo') unit = unitOf(e.ev.a);
    const x = clock.step(bd, unit);
    if (e.ev) merged.push({ x, ev: e.ev });
    if (e.meta === 0x2f || pos[best] >= smf.tracks[best].length) active[best] = false;   // the end-of-track event ends the track
  }
  const eot = clock.ticks;
  // the note-offs of every channel / key in merged order (indices into `merged`)
  const offs = new Map<number, number[]>();
  merged.forEach((m, i) => { if (m.ev.kind === 'off') { const k = m.ev.ch * 128 + m.ev.a; const l = offs.get(k); if (l) l.push(i); else offs.set(k, [i]); } });
  const out: (SmfEvent & { dur?: number })[] = [];
  let unmatched = 0;
  merged.forEach(({ x, ev: e }, i) => {
    if (e.kind === 'off' || e.kind === 'tempo') return;
    if (e.kind !== 'on') { out.push({ ...e, tick: x }); return; }
    const l = offs.get(e.ch * 128 + e.a);
    let lo = 0, hi = l ? l.length : 0;
    while (lo < hi) { const m = (lo + hi) >> 1; if (l![m] > i) hi = m; else lo = m + 1; }
    let dur: number;
    if (l && lo < l.length) dur = merged[l[lo]].x - x; else { dur = Math.max(0, eot - x); unmatched++; }
    out.push({ ...e, tick: x, dur });
  });
  return { events: out, eot, unmatched };
}

/** the play list of the Miles sequencer for a parsed SMF: times in seconds (tick / service rate), the note-offs placed `max(duration, 1)` ticks after their note and before the other events of that tick */
export function xmiTimeline(smf: Smf): { events: TimedMidiEvent[]; length: number } {
  const x = smfToXmi(smf);
  const list: { tick: number; prio: number; seq: number; e: TimedMidiEvent }[] = [];
  let seq = 0;
  for (const e of x.events) {
    const time = e.tick / XMI_SERVICE_RATE;
    list.push({ tick: e.tick, prio: 1, seq: seq++, e: { tick: e.tick, ch: e.ch, kind: e.kind, a: e.a, b: e.b, time } });
    if (e.kind === 'on') {
      const off = e.tick + Math.max(e.dur ?? 0, 1);
      if (off <= x.eot) list.push({ tick: off, prio: 0, seq: seq++, e: { tick: off, ch: e.ch, kind: 'off', a: e.a, b: 0, time: off / XMI_SERVICE_RATE } });
    }
  }
  list.sort((p, q) => p.tick - q.tick || p.prio - q.prio || p.seq - q.seq);
  return { events: list.map((l) => l.e), length: x.eot / XMI_SERVICE_RATE };
}
