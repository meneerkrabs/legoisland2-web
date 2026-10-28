// DirectMusic file formats used by the game: segment (.sgt, RIFF DMSG), style (.sty, RIFF DMST), band (RIFF DMBD).
// Pure parsing (no DOM). Layout per the DirectMusic file format (dmusicf.h) as verified on the game's files; see docs/re/audio.md.
import { parseRiff, findChunk, findChunks, chunkData } from '../../formats/riff.ts';
import type { RiffChunk } from '../../formats/riff.ts';

export const DMUS_PPQ = 768; // ticks (MUSIC_TIME) per quarter note

// ------------------------------------------------------------------ shared helpers

function dv(b: Uint8Array) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }
function utf16z(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) { const c = b[i] | (b[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); }
  return s;
}
export function guidStr(b: Uint8Array, o = 0): string {
  const d = dv(b);
  const h = (n: number, w: number) => n.toString(16).padStart(w, '0');
  return `${h(d.getUint32(o, true), 8)}-${h(d.getUint16(o + 4, true), 4)}-${h(d.getUint16(o + 6, true), 4)}-${Array.from(b.subarray(o + 8, o + 10), (x) => h(x, 2)).join('')}-${Array.from(b.subarray(o + 10, o + 16), (x) => h(x, 2)).join('')}`;
}

export interface DmReference { /** GUID of the referenced object */ guid: string; name: string; file: string; /** DMUS_IO_REFERENCE dwValidData bits */ validData: number }

function parseRef(data: Uint8Array, list: RiffChunk): DmReference {
  const r: DmReference = { guid: '', name: '', file: '', validData: 0 };
  const refh = findChunk(list, 'refh');
  if (refh) r.validData = dv(chunkData(data, refh)).getUint32(16, true);
  const g = findChunk(list, 'guid');
  if (g) r.guid = guidStr(chunkData(data, g));
  const n = findChunk(list, 'name');
  if (n) r.name = utf16z(chunkData(data, n));
  const f = findChunk(list, 'file');
  if (f) r.file = utf16z(chunkData(data, f));
  return r;
}

function unfoName(data: Uint8Array, c: RiffChunk): string {
  const u = findChunk(c, 'LIST', 'UNFO');
  const n = u && findChunk(u, 'UNAM');
  return n ? utf16z(chunkData(data, n)) : '';
}

// ------------------------------------------------------------------ band

export const INST_PATCH = 0x1, INST_ASSIGN_PATCH = 0x2, INST_NOTERANGES = 0x4, INST_PAN = 0x8, INST_VOLUME = 0x10, INST_TRANSPOSE = 0x20,
  INST_GM = 0x40, INST_GS = 0x80, INST_XG = 0x100, INST_CHANNEL_PRIORITY = 0x200, INST_USE_DEFAULT_GM_SET = 0x800, INST_PITCHBENDRANGE = 0x1000;

export interface DmBandInstrument {
  /** (MSB << 16) | (LSB << 8) | program; bit 31 = drum kit */
  patch: number;
  assignPatch: number;
  noteRanges: number[];
  pchannel: number;
  flags: number;
  pan: number;
  volume: number;
  transpose: number;
  channelPriority: number;
  pitchBendRange: number;
  /** DLS file named by the instrument's reference, or null = default GM set (not shipped) */
  ref: DmReference | null;
}
export interface DmBand { name: string; guid: string; instruments: DmBandInstrument[] }

export function parseBand(data: Uint8Array, riff: RiffChunk): DmBand {
  const g = findChunk(riff, 'guid');
  const band: DmBand = { name: unfoName(data, riff), guid: g ? guidStr(chunkData(data, g)) : '', instruments: [] };
  const lbil = findChunk(riff, 'LIST', 'lbil');
  for (const lbin of lbil ? findChunks(lbil, 'LIST', 'lbin') : []) {
    const bins = findChunk(lbin, 'bins');
    if (!bins) continue;
    const b = chunkData(data, bins), d = dv(b);
    const hasPb = b.length >= 42;
    const inst: DmBandInstrument = {
      patch: d.getUint32(0, true), assignPatch: d.getUint32(4, true),
      noteRanges: [d.getUint32(8, true), d.getUint32(12, true), d.getUint32(16, true), d.getUint32(20, true)],
      pchannel: d.getUint32(24, true), flags: d.getUint32(28, true), pan: b[32], volume: b[33], transpose: d.getInt16(34, true),
      channelPriority: d.getUint32(36, true), pitchBendRange: hasPb ? d.getInt16(40, true) : 2, ref: null,
    };
    const ref = findChunk(lbin, 'LIST', 'DMRF');
    if (ref) inst.ref = parseRef(data, ref);
    band.instruments.push(inst);
  }
  return band;
}

// ------------------------------------------------------------------ style

export interface DmTimeSig { beatsPerMeasure: number; beat: number; gridsPerBeat: number }

export interface DmStyleNote {
  /** start in grid units (gridsPerBeat per beat of the part's time signature) */
  grid: number;
  /** bit n = used by variation n */
  variation: number;
  duration: number; timeOffset: number;
  musicValue: number; velocity: number;
  timeRange: number; durRange: number; velRange: number;
  inversionId: number;
  /** DMUS_PLAYMODE_* flags; 0x10 (NONE) = use the part's play mode */
  playMode: number;
}
export interface DmStyleCurve {
  grid: number; variation: number; duration: number; resetDuration: number; timeOffset: number;
  startValue: number; endValue: number; resetValue: number; eventType: number; shape: number; ccData: number; flags: number; paramType: number;
}
export interface DmStylePart {
  guid: string;
  name: string;
  timeSig: DmTimeSig;
  /** per variation (32): MOAW choice bits (chord-type mask in bits 0-28) */
  variationChoices: number[];
  measures: number;
  playMode: number;
  invertUpper: number; invertLower: number;
  flags: number;
  notes: DmStyleNote[];
  curves: DmStyleCurve[];
}
export interface DmPartRef {
  guid: string; name: string;
  /** logical part id / pchannel (legacy files: id == pchannel) */
  pchannel: number;
  variationLockId: number; subChordLevel: number; priority: number; randomVariation: boolean;
}
export const EMBELLISHMENT_NORMAL = 0, EMBELLISH_FILL = 1, EMBELLISH_BREAK = 2, EMBELLISH_INTRO = 4, EMBELLISH_END = 8, EMBELLISH_MOTIF = 16;
export interface DmPattern {
  name: string;
  timeSig: DmTimeSig;
  grooveBottom: number; grooveTop: number;
  embellishment: number;
  measures: number;
  destGrooveBottom: number; destGrooveTop: number;
  /** per measure: chord rhythm bits (rhtm) */
  rhythm: number[];
  partRefs: DmPartRef[];
  /** motif settings (mtfs) when embellishment has the MOTIF bit */
  motif: { repeats: number; loopStart: number; loopEnd: number } | null;
}
export interface DmStyle {
  name: string;
  guid: string;
  timeSig: DmTimeSig;
  tempo: number;
  bands: DmBand[];
  parts: Map<string, DmStylePart>;
  patterns: DmPattern[];
}

function timeSigAt(d: DataView, o: number): DmTimeSig { return { beatsPerMeasure: d.getUint8(o), beat: d.getUint8(o + 1), gridsPerBeat: d.getUint16(o + 2, true) }; }

export function parseStyle(data: Uint8Array): DmStyle {
  const riff = parseRiff(data).chunks[0];
  if (!riff || riff.type !== 'DMST') throw new Error('not a DirectMusic style');
  const styh = findChunk(riff, 'styh');
  if (!styh) throw new Error('style without styh');
  const sd = dv(chunkData(data, styh));
  const g = findChunk(riff, 'guid');
  const style: DmStyle = {
    name: unfoName(data, riff), guid: g ? guidStr(chunkData(data, g)) : '', timeSig: timeSigAt(sd, 0), tempo: sd.getFloat64(4, true),
    bands: [], parts: new Map(), patterns: [],
  };
  for (const c of riff.children) {
    if (c.id === 'RIFF' && c.type === 'DMBD') style.bands.push(parseBand(data, c));
    else if (c.id === 'LIST' && c.type === 'part') {
      const prth = findChunk(c, 'prth');
      if (!prth) continue;
      const pb = chunkData(data, prth), pd = dv(pb);
      const part: DmStylePart = {
        guid: guidStr(pb, 4 + 128), name: unfoName(data, c), timeSig: timeSigAt(pd, 0), variationChoices: [],
        measures: pd.getUint16(4 + 128 + 16, true), playMode: pb[4 + 128 + 18], invertUpper: pb[4 + 128 + 19], invertLower: pb[4 + 128 + 20],
        flags: pb.length >= 160 ? pd.getUint32(156, true) : 0, notes: [], curves: [],
      };
      for (let i = 0; i < 32; i++) part.variationChoices.push(pd.getUint32(4 + i * 4, true));
      const note = findChunk(c, 'note');
      if (note) {
        const nb = chunkData(data, note), nd = dv(nb);
        const sz = nd.getUint32(0, true);
        for (let o = 4; o + sz <= nb.length; o += sz) {
          part.notes.push({
            grid: nd.getUint32(o, true), variation: nd.getUint32(o + 4, true), duration: nd.getInt32(o + 8, true), timeOffset: nd.getInt16(o + 12, true),
            musicValue: nd.getUint16(o + 14, true), velocity: nb[o + 16], timeRange: nb[o + 17], durRange: nb[o + 18], velRange: nb[o + 19],
            inversionId: nb[o + 20], playMode: nb[o + 21],
          });
        }
      }
      const crve = findChunk(c, 'crve');
      if (crve) {
        const cb = chunkData(data, crve), cd = dv(cb);
        const sz = cd.getUint32(0, true);
        for (let o = 4; o + sz <= cb.length; o += sz) {
          part.curves.push({
            grid: cd.getUint32(o, true), variation: cd.getUint32(o + 4, true), duration: cd.getInt32(o + 8, true), resetDuration: cd.getInt32(o + 12, true),
            timeOffset: cd.getInt16(o + 16, true), startValue: cd.getInt16(o + 18, true), endValue: cd.getInt16(o + 20, true), resetValue: cd.getInt16(o + 22, true),
            eventType: cb[o + 24], shape: cb[o + 25], ccData: cb[o + 26], flags: cb[o + 27], paramType: sz >= 30 ? cd.getUint16(o + 28, true) : 0,
          });
        }
      }
      style.parts.set(part.guid, part);
    } else if (c.id === 'LIST' && c.type === 'pttn') {
      const ptnh = findChunk(c, 'ptnh');
      if (!ptnh) continue;
      const pb = chunkData(data, ptnh), pd = dv(pb);
      const pat: DmPattern = {
        name: unfoName(data, c), timeSig: timeSigAt(pd, 0), grooveBottom: pb[4], grooveTop: pb[5], embellishment: pd.getUint16(6, true), measures: pd.getUint16(8, true),
        destGrooveBottom: pb.length >= 12 ? pb[10] : 0, destGrooveTop: pb.length >= 12 ? pb[11] : 0, rhythm: [], partRefs: [], motif: null,
      };
      const rhtm = findChunk(c, 'rhtm');
      if (rhtm) { const rb = chunkData(data, rhtm), rd = dv(rb); for (let o = 0; o + 4 <= rb.length; o += 4) pat.rhythm.push(rd.getUint32(o, true)); }
      const mtfs = findChunk(c, 'mtfs');
      if (mtfs) { const md = dv(chunkData(data, mtfs)); pat.motif = { repeats: md.getUint32(0, true), loopStart: md.getInt32(8, true), loopEnd: md.getInt32(12, true) }; }
      for (const pref of findChunks(c, 'LIST', 'pref')) {
        const prfc = findChunk(pref, 'prfc');
        if (!prfc) continue;
        const rb = chunkData(data, prfc), rd = dv(rb);
        const logical = rd.getUint16(16, true);
        pat.partRefs.push({
          guid: guidStr(rb, 0), name: unfoName(data, pref), pchannel: rb.length >= 28 ? rd.getUint32(24, true) : logical,
          variationLockId: rb[18], subChordLevel: rb[19], priority: rb[20], randomVariation: rb[21] !== 0,
        });
      }
      style.patterns.push(pat);
    }
  }
  return style;
}

// ------------------------------------------------------------------ segment

export interface DmSubChord { chordPattern: number; scalePattern: number; inversionPoints: number; levels: number; chordRoot: number; scaleRoot: number }
export interface DmChord { name: string; time: number; measure: number; beat: number; flags: number; subChords: DmSubChord[] }
export interface DmTempoItem { time: number; tempo: number }
export interface DmCommand { time: number; measure: number; beat: number; command: number; grooveLevel: number; grooveRange: number; repeatMode: number }
export interface DmSeqItem { time: number; duration: number; pchannel: number; offset: number; status: number; data1: number; data2: number }
export interface DmCurveItem { time: number; duration: number; resetDuration: number; pchannel: number; offset: number; startValue: number; endValue: number; resetValue: number; eventType: number; shape: number; ccData: number; flags: number; paramType: number }
export interface DmStyleEntry { time: number; ref: DmReference }
export interface DmBandEntry { time: number; band: DmBand }
export interface DmMuteItem { time: number; pchannel: number; pchannelMap: number; mute: boolean }
export interface DmTimeSigItem { time: number; sig: DmTimeSig }

export interface DmTrackBase { group: number; position: number; priority: number; flags: number }

export interface DmSegment {
  name: string;
  guid: string;
  repeats: number;
  length: number;
  playStart: number; loopStart: number; loopEnd: number;
  resolution: number;
  tempos: DmTempoItem[];
  chordScale: number;
  chords: DmChord[];
  commands: DmCommand[];
  sequence: DmSeqItem[];
  curves: DmCurveItem[];
  styles: DmStyleEntry[];
  bands: DmBandEntry[];
  mutes: DmMuteItem[];
  timeSigs: DmTimeSigItem[];
  /** track classes seen but not decoded */
  unknownTracks: string[];
}

export function parseSegment(data: Uint8Array): DmSegment {
  const riff = parseRiff(data).chunks[0];
  if (!riff || riff.type !== 'DMSG') throw new Error('not a DirectMusic segment');
  const segh = findChunk(riff, 'segh');
  const sd = segh ? dv(chunkData(data, segh)) : null;
  const g = findChunk(riff, 'guid');
  const seg: DmSegment = {
    name: unfoName(data, riff), guid: g ? guidStr(chunkData(data, g)) : '',
    repeats: sd ? sd.getUint32(0, true) : 0, length: sd ? sd.getInt32(4, true) : 0, playStart: sd ? sd.getInt32(8, true) : 0,
    loopStart: sd ? sd.getInt32(12, true) : 0, loopEnd: sd ? sd.getInt32(16, true) : 0, resolution: sd ? sd.getUint32(20, true) : 0,
    tempos: [], chordScale: 0, chords: [], commands: [], sequence: [], curves: [], styles: [], bands: [], mutes: [], timeSigs: [], unknownTracks: [],
  };
  const trkl = findChunk(riff, 'LIST', 'trkl');
  for (const trk of trkl ? findChunks(trkl, 'RIFF', 'DMTK') : []) {
    const trkh = findChunk(trk, 'trkh');
    if (!trkh) continue;
    const hb = chunkData(data, trkh);
    const kind = String.fromCharCode(...hb.subarray(24, 28)) + '|' + String.fromCharCode(...hb.subarray(28, 32));
    const ckid = String.fromCharCode(...hb.subarray(24, 28)), fcc = String.fromCharCode(...hb.subarray(28, 32));
    const body = trk.children.find((c) => c.id !== 'trkh' && c.id !== 'trkx');
    const pick = (id: string) => trk.children.find((c) => c.id === id && c.type === null);
    if (ckid === 'tetr') {
      const c = pick('tetr');
      if (c) { const b = chunkData(data, c), d = dv(b), sz = d.getUint32(0, true); for (let o = 4; o + sz <= b.length; o += sz) seg.tempos.push({ time: d.getInt32(o, true), tempo: d.getFloat64(o + 8, true) }); }
    } else if (fcc === 'cord') {
      const l = trk.children.find((c) => c.id === 'LIST' && c.type === 'cord');
      if (l) {
        const h = findChunk(l, 'crdh');
        if (h) seg.chordScale = dv(chunkData(data, h)).getUint32(0, true);
        for (const crdb of findChunks(l, 'crdb')) {
          const b = chunkData(data, crdb), d = dv(b);
          const csz = d.getUint32(0, true);
          let o = 4;
          const chord: DmChord = { name: utf16z(b.subarray(o, o + 32)), time: d.getInt32(o + 32, true), measure: d.getUint16(o + 36, true), beat: b[o + 38], flags: b[o + 39], subChords: [] };
          o += csz;
          const n = d.getUint32(o, true), ssz = d.getUint32(o + 4, true);
          o += 8;
          for (let i = 0; i < n; i++, o += ssz) chord.subChords.push({ chordPattern: d.getUint32(o, true), scalePattern: d.getUint32(o + 4, true), inversionPoints: d.getUint32(o + 8, true), levels: d.getUint32(o + 12, true), chordRoot: b[o + 16], scaleRoot: b[o + 17] });
          seg.chords.push(chord);
        }
      }
    } else if (ckid === 'cmnd') {
      const c = pick('cmnd');
      if (c) { const b = chunkData(data, c), d = dv(b), sz = d.getUint32(0, true); for (let o = 4; o + sz <= b.length; o += sz) seg.commands.push({ time: d.getInt32(o, true), measure: d.getUint16(o + 4, true), beat: b[o + 6], command: b[o + 7], grooveLevel: b[o + 8], grooveRange: b[o + 9], repeatMode: b[o + 10] }); }
    } else if (fcc === 'sttr') {
      const l = trk.children.find((c) => c.id === 'LIST' && c.type === 'sttr');
      for (const strf of l ? findChunks(l, 'LIST', 'strf') : []) {
        const stmp = findChunk(strf, 'stmp'), ref = findChunk(strf, 'LIST', 'DMRF');
        if (stmp && ref) seg.styles.push({ time: dv(chunkData(data, stmp)).getUint32(0, true), ref: parseRef(data, ref) });
      }
    } else if (trk.children.some((c) => c.id === 'RIFF' && c.type === 'DMBT')) {
      const bt = trk.children.find((c) => c.id === 'RIFF' && c.type === 'DMBT')!;
      const lbdl = findChunk(bt, 'LIST', 'lbdl');
      for (const lbnd of lbdl ? findChunks(lbdl, 'LIST', 'lbnd') : []) {
        const bdih = findChunk(lbnd, 'bdih'), bd2h = findChunk(lbnd, 'bd2h'), dmbd = findChunk(lbnd, 'RIFF', 'DMBD');
        if (!dmbd) continue;
        let time = 0;
        if (bd2h) time = dv(chunkData(data, bd2h)).getInt32(4, true); // lBandTimePhysical
        else if (bdih) time = dv(chunkData(data, bdih)).getInt32(0, true);
        seg.bands.push({ time, band: parseBand(data, dmbd) });
      }
    } else if (ckid === 'mute') {
      const c = pick('mute');
      if (c) { const b = chunkData(data, c), d = dv(b), sz = d.getUint32(0, true); for (let o = 4; o + sz <= b.length; o += sz) seg.mutes.push({ time: d.getInt32(o, true), pchannel: d.getUint32(o + 4, true), pchannelMap: d.getUint32(o + 8, true), mute: d.getUint32(o + 8, true) === 0xffffffff }); }
    } else if (ckid === 'seqt' || fcc === 'seqt') {
      // the track body is a plain chunk "seqt" whose payload is again a chunk stream: "evtl" (events) and "curl" (curves)
      const c = pick('seqt');
      if (c) {
        const b = chunkData(data, c), d = dv(b);
        for (let p = 0; p + 8 <= b.length;) {
          const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
          const size = d.getUint32(p + 4, true);
          const body = b.subarray(p + 8, p + 8 + size), bd = dv(body);
          const sz = body.length >= 4 ? bd.getUint32(0, true) : 0;
          if (id === 'evtl') {
            for (let o = 4; o + sz <= body.length; o += sz) seg.sequence.push({ time: bd.getInt32(o, true), duration: bd.getInt32(o + 4, true), pchannel: bd.getUint32(o + 8, true), offset: bd.getInt16(o + 12, true), status: body[o + 14], data1: body[o + 15], data2: body[o + 16] });
          } else if (id === 'curl') {
            for (let o = 4; o + sz <= body.length; o += sz) seg.curves.push({
              time: bd.getInt32(o, true), duration: bd.getInt32(o + 4, true), resetDuration: bd.getInt32(o + 8, true), pchannel: bd.getUint32(o + 12, true), offset: bd.getInt16(o + 16, true),
              startValue: bd.getInt16(o + 18, true), endValue: bd.getInt16(o + 20, true), resetValue: bd.getInt16(o + 22, true), eventType: body[o + 24], shape: body[o + 25], ccData: body[o + 26], flags: body[o + 27], paramType: sz >= 30 ? bd.getUint16(o + 28, true) : 0,
            });
          }
          p += 8 + size + (size & 1);
        }
      }
    } else if (ckid === 'tims') {
      const c = pick('tims');
      if (c) { const b = chunkData(data, c), d = dv(b), sz = d.getUint32(0, true); for (let o = 4; o + sz <= b.length; o += sz) seg.timeSigs.push({ time: d.getInt32(o, true), sig: timeSigAt(d, o + 4) }); }
    } else {
      seg.unknownTracks.push(kind + (body ? ':' + (body.type ?? body.id) : ''));
    }
  }
  return seg;
}
