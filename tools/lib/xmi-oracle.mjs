// Miles' MIDI -> XMIDI converter (the game's mss32.dll, run on the x86 emulator, 24-bit x87 like the game) as an oracle for src/audio/xmi.ts, and an XMIDI event reader.
import { Mss, mssPath } from './mss-emu.mjs';

/** a Mss with the preference defaults, reused for many conversions */
export function newConverter(dataRoot) { const m = new Mss(mssPath(dataRoot)); m.initPreferences(); return m; }

/** AIL_MIDI_to_XMI(mid, size, ...) -> the XMIDI bytes, or null when the converter refuses the file (returns 0) */
export function convert(m, mid, size = mid.length) {
  const buf = m.alloc(mid.length + 16);
  for (let i = 0; i < mid.length; i++) m.mem.w8(buf + i, mid[i]);
  const out = m.alloc(8);
  const ret = m.call('_AIL_MIDI_to_XMI@20', [buf, size >>> 0, out, out + 4, 0]);
  if (ret !== 1) return null;
  const p = m.mem.r32(out), n = m.mem.r32(out + 4);
  const x = new Uint8Array(n);
  for (let i = 0; i < n; i++) x[i] = m.mem.r8(p + i);
  return x;
}

/** the events of the EVNT chunk: { tick (XMIDI ticks), st, a, b, dur (note-on), data (meta) } in stream order */
export function parseXmi(x) {
  const tag = (o) => String.fromCharCode(x[o], x[o + 1], x[o + 2], x[o + 3]);
  const be = (o) => (x[o] << 24 | x[o + 1] << 16 | x[o + 2] << 8 | x[o + 3]) >>> 0;
  const chunks = [];
  const walk = (o, end) => { while (o + 8 <= end) { const t = tag(o), s = be(o + 4); if (t === 'FORM' || t === 'CAT ') { chunks.push({ t: t + ':' + tag(o + 8), o, s }); walk(o + 12, o + 8 + s); } else chunks.push({ t, o, s }); o += 8 + s + (s & 1); } };
  walk(0, x.length);
  const ev = chunks.find((c) => c.t === 'EVNT');
  const events = [];
  let t = 0, p = ev.o + 8;
  const end = p + ev.s;
  while (p < end) {
    const b = x[p];
    if (b < 0x80) { t += b; p++; continue; }
    if (b === 0xff) { const ty = x[p + 1]; p += 2; let len = 0, c; do { c = x[p++]; len = (len << 7) | (c & 0x7f); } while (c & 0x80); events.push({ tick: t, st: 0xff, a: ty, b: 0, data: x.subarray(p, p + len) }); p += len; continue; }
    const k = b & 0xf0, a = x[p + 1];
    if (k === 0x90) { let dur = 0, c, q = p + 3; do { c = x[q++]; dur = (dur << 7) | (c & 0x7f); } while (c & 0x80); events.push({ tick: t, st: b, a, b: x[p + 2], dur }); p = q; continue; }
    if (k === 0xc0 || k === 0xd0) { events.push({ tick: t, st: b, a, b: 0 }); p += 2; continue; }
    events.push({ tick: t, st: b, a, b: x[p + 2] }); p += 3;
  }
  return { chunks, events };
}

// ------------------------------------------------------------------------------------ building SMFs (random test files)
const vlq = (v) => { const o = [v & 0x7f]; v >>= 7; while (v) { o.unshift((v & 0x7f) | 0x80); v >>= 7; } return o; };
/** a type 1 SMF; `tracks` = arrays of { dt, bytes } (an end-of-track event with delta 0 is appended unless a track ends with `eot`) */
export function buildSmf(div, tracks) {
  const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, div >> 8, div & 255];
  for (const t of tracks) {
    const b = [];
    for (const e of t.events) b.push(...vlq(e.dt), ...e.bytes);
    b.push(...vlq(t.eotDelta ?? 0), 0xff, 0x2f, 0);
    out.push(0x4d, 0x54, 0x72, 0x6b, (b.length >>> 24) & 255, (b.length >> 16) & 255, (b.length >> 8) & 255, b.length & 255, ...b);
  }
  return Uint8Array.from(out);
}
