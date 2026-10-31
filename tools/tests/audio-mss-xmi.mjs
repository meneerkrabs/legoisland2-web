// Miles' MIDI -> XMIDI conversion (src/audio/xmi.ts) against the REAL converter: the game's own mss32.dll (public/data/le2/mss32.dll) run on the x86 emulator with the x87 in 24-bit mode, as the
// game runs it. Compared event for event (XMIDI tick, status, data, note duration, order): the six ambience beds the game plays, plus random multi-track files (tempo changes, odd divisions,
// overlapping notes, meta events). Also: `AIL_file_size("midiList[i].midiName")` (the size argument of FUN_00875918 / FUN_00875a26) is -1 and the converter output does not depend on the
// size argument; a note-on without a note-off makes the converter refuse the file.
//   AUDIO_MSS_FULL=1: 400 random files instead of 60
import fs from 'node:fs';
import path from 'node:path';
import { newConverter, convert, parseXmi, buildSmf } from '../lib/xmi-oracle.mjs';
import { parseSmf } from '../../src/audio/midi.ts';
import { smfToXmi, xmiTimeline, XMI_SERVICE_RATE } from '../../src/audio/xmi.ts';

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const BEDS = ['z02LGI/MidiAmbient/Birds.mid', 'z02LGI/MidiAmbient/Seagulls.mid', "z02LGI/MidiAmbient/Birds'n'Bees.MID", 'z07CSI/ambience/Castle Ambience.mid', 'z21FSH/Ambience_MIDI/Fishing_Amb.mid', 'z27TRX/Ambience/Trex Ambience.mid', 'z39ASB/Ambience_MIDI/Asteroid_Amb.mid'];

/** compare the port's XMIDI sequence with the real converter's output; returns an error text or '' */
function compareFile(mid, real) {
  const mine = smfToXmi(parseSmf(mid));
  const X = parseXmi(real);
  const want = X.events.filter((e) => e.st !== 0xff);
  if (want.length !== mine.events.length) return `${mine.events.length} events, the converter has ${want.length}`;
  for (let i = 0; i < want.length; i++) {
    const w = want[i], m = mine.events[i];
    const kind = (w.st & 0xf0) === 0x90 ? 'on' : (w.st & 0xf0) === 0xb0 ? 'cc' : (w.st & 0xf0) === 0xc0 ? 'prog' : (w.st & 0xf0) === 0xe0 ? 'bend' : '?';
    if (w.tick !== m.tick || kind !== m.kind || (w.st & 15) !== m.ch || w.a !== m.a || w.b !== m.b || (kind === 'on' && w.dur !== m.dur)) return `event ${i}: converter tick ${w.tick} ${w.st.toString(16)} ${w.a} ${w.b} dur ${w.dur}, port tick ${m.tick} ${m.kind} ch ${m.ch} ${m.a} ${m.b} dur ${m.dur}`;
  }
  const eot = X.events.filter((e) => e.st === 0xff && e.a === 0x2f);
  if (eot.length !== 1 || eot[0].tick !== mine.eot) return `end of track: converter ${eot.map((e) => e.tick)}, port ${mine.eot}`;
  return '';
}

function randomSmf(rand) {
  const div = [96, 120, 192, 240, 384, 480, 768, 960][Math.floor(rand() * 8)];
  const nTracks = 1 + Math.floor(rand() * 4);
  const tracks = [];
  for (let t = 0; t < nTracks; t++) {
    const events = [];
    const n = 4 + Math.floor(rand() * 40);
    let tick = 0;
    const pending = [];
    for (let i = 0; i < n; i++) {
      const dt = rand() < 0.2 ? 0 : Math.floor(rand() * (rand() < 0.2 ? 5000 : 400));
      tick += dt;
      const ch = Math.floor(rand() * 16), r = rand();
      let bytes;
      if (t === 0 && r < 0.18) { const us = 200000 + Math.floor(rand() * 1500000); bytes = [0xff, 0x51, 3, us >> 16, (us >> 8) & 255, us & 255]; }
      else if (r < 0.28) bytes = [0xff, 0x58, 4, 4, 2, 24, 8];
      else if (r < 0.34) bytes = [0xff, 0x03, 3, 0x61, 0x62, 0x63];
      else if (r < 0.46) bytes = [0xb0 | ch, 1 + Math.floor(rand() * 100), Math.floor(rand() * 128)];
      else if (r < 0.52) bytes = [0xc0 | ch, Math.floor(rand() * 128)];
      else if (r < 0.57) bytes = [0xe0 | ch, Math.floor(rand() * 128), Math.floor(rand() * 128)];
      else { const key = 36 + Math.floor(rand() * 4); bytes = [0x90 | ch, key, 30 + Math.floor(rand() * 90)]; pending.push({ ch, key }); }
      events.push({ dt, bytes });
      // sometimes turn a note off soon (vel 0 form or 80)
      if (pending.length && rand() < 0.45) { const p = pending.shift(); events.push({ dt: Math.floor(rand() * 300), bytes: rand() < 0.5 ? [0x80 | p.ch, p.key, 0] : [0x90 | p.ch, p.key, 0] }); }
    }
    for (const p of pending) events.push({ dt: Math.floor(rand() * 600), bytes: [0x80 | p.ch, p.key, 0] });   // every note ends (the converter refuses files with open notes)
    if (rand() < 0.3) events.push({ dt: Math.floor(rand() * 50), bytes: [0x80, 40, 0] });   // a stray note-off
    tracks.push({ events, eotDelta: Math.floor(rand() * 700) });
  }
  return buildSmf(div, tracks);
}

export default {
  name: 'audio-mss-xmi',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const dll = path.join(ctx.dataRoot, 'mss32.dll');
    if (!fs.existsSync(dll)) return { checked, failures: [`no ${dll}`] };
    const sounds = path.join(ctx.dataRoot, '_data/sounds');
    const m = newConverter(ctx.dataRoot);
    // --- the size argument: AIL_file_size of the literal path string
    {
      const lit = m.alloc(64); const str = 'midiList[i].midiName';
      for (let i = 0; i < str.length; i++) m.mem.w8(lit + i, str.charCodeAt(i));
      const size = m.call('_AIL_file_size@4', [lit]);
      checked++;
      if (size !== 0xffffffff) failures.push(`AIL_file_size(literal) = ${size} (expected -1: no such file)`);
      notes.push(`AIL_file_size("midiList[i].midiName") = ${size | 0}`);
      // the converter does not read the size
      for (const f of BEDS) {
        const mid = new Uint8Array(fs.readFileSync(path.join(sounds, f)));
        const a = convert(m, mid), b = convert(m, mid, 0xffffffff), c = convert(m, mid, mid.length + 1000);
        checked++;
        if (!a || !b || !c || a.length !== b.length || a.length !== c.length || a.some((v, i) => v !== b[i] || v !== c[i])) failures.push(`${f}: the XMIDI output depends on the size argument`);
      }
    }
    // --- the ambience beds, event for event
    let nEv = 0;
    for (const f of BEDS) {
      const mid = new Uint8Array(fs.readFileSync(path.join(sounds, f)));
      const real = convert(m, mid);
      checked++;
      if (!real) { failures.push(`${f}: the converter refused the file`); continue; }
      const err = compareFile(mid, real);
      if (err) failures.push(`${f}: ${err}`);
      nEv += parseXmi(real).events.length;
      const tl = xmiTimeline(parseSmf(mid));
      // the play list: every note-on has its note-off `max(duration, 1)` ticks later (before the other events of that tick), nothing after the end of track, sorted
      const ons = tl.events.filter((e) => e.kind === 'on'), offsN = tl.events.filter((e) => e.kind === 'off');
      checked++;
      if (offsN.length !== ons.length) failures.push(`${f}: ${ons.length} notes but ${offsN.length} note-offs in the play list`);
      for (let i = 1; i < tl.events.length; i++) if (tl.events[i].time < tl.events[i - 1].time) { failures.push(`${f}: play list not sorted at ${i}`); break; }
      if (tl.events.some((e) => e.time > tl.length)) failures.push(`${f}: an event after the end of track`);
      notes.push(`${f}: end of track at ${(tl.length).toFixed(4)} s (${Math.round(tl.length * XMI_SERVICE_RATE)} ticks)`);
    }
    // --- random files
    const rand = rng(20261031);
    const N = process.env.AUDIO_MSS_FULL ? 400 : 60;
    let nRand = 0, refused = 0;
    for (let i = 0; i < N; i++) {
      const mid = randomSmf(rand);
      const real = convert(m, mid);
      checked++;
      if (!real) { refused++; continue; }
      const err = compareFile(mid, real);
      if (err) failures.push(`random file ${i}: ${err}`);
      else nRand++;
      nEv += parseXmi(real).events.length;
    }
    // --- a note-on without a note-off: the converter refuses
    {
      const mid = buildSmf(480, [{ events: [{ dt: 0, bytes: [0x90, 60, 100] }] }]);
      checked++;
      if (convert(m, mid) !== null) failures.push('a file with an open note was converted');
    }
    notes.push(`${nEv} XMIDI events compared (${BEDS.length} ambience beds, ${nRand} random files, ${refused} refused)`);
    return { checked, failures, notes };
  },
};
