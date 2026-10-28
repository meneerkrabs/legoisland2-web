// Sound & music file formats of LEGO Island 2: WAV (PCM and MPEG-Layer-3-in-WAV speech), FINDER.DAT, .pk peak files,
// Standard MIDI headers, DirectMusic (.sty/.sgt/.dls) RIFF summaries, PE identification of the Miles Sound System redist.
// Pure, no DOM / fs. Playback is a later task. See docs/re/fragments/sound.md.
import { Reader } from './reader.ts';
import { parseRiff, findChunk, findChunks, chunkData, countChunks } from './riff.ts';
import type { RiffChunk } from './riff.ts';

// ---------------------------------------------------------------- WAV

export const WAVE_FORMAT_PCM = 1;
export const WAVE_FORMAT_MPEGLAYER3 = 0x55;

export interface WavLoop { cuePointId: number; type: number; start: number; end: number; fraction: number; playCount: number }

export interface Wav {
  /** wFormatTag: 1 = PCM, 0x55 = MPEG Layer 3 */
  formatTag: number;
  channels: number;
  sampleRate: number;
  avgBytesPerSec: number;
  blockAlign: number;
  bitsPerSample: number;
  /** size of the fmt chunk (16 PCM, 30 for MPEGLAYER3WAVEFORMAT) */
  fmtSize: number;
  /** MPEGLAYER3WAVEFORMAT extra fields (formatTag 0x55 only) */
  mp3?: { id: number; flags: number; blockSize: number; framesPerBlock: number; codecDelay: number };
  /** absolute offset/size of the data chunk payload (size is clipped to the file if the chunk is truncated) */
  dataOffset: number;
  dataSize: number;
  /** PCM: dataSize / blockAlign; MP3: the "fact" sample count */
  frames: number;
  duration: number;
  /** sampler loops from the "smpl" chunk (sample frames) */
  loops: WavLoop[];
  midiUnityNote: number | null;
  /** number of cue points ("cue " chunk) */
  cueCount: number;
  /** text from LIST/INFO sub-chunks, e.g. { ISFT: "Sound Forge 4.5" } */
  info: Record<string, string>;
  /** chunk ids in file order */
  chunkOrder: string[];
  problems: string[];
}

function infoStrings(data: Uint8Array, list: RiffChunk): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of list.children) {
    const b = chunkData(data, c);
    let s = '';
    for (let i = 0; i < b.length && b[i] !== 0; i++) s += String.fromCharCode(b[i]);
    out[c.id] = s;
  }
  return out;
}

/** Parse a RIFF/WAVE file (also the .mp3 speech files, which are WAVE containers with formatTag 0x55). */
export function parseWav(data: Uint8Array): Wav {
  const riff = parseRiff(data);
  const root = riff.chunks[0];
  if (!root || root.type !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  const fmt = findChunk(root, 'fmt ');
  const dat = findChunk(root, 'data');
  if (!fmt) throw new Error('no fmt chunk');
  if (!dat) throw new Error('no data chunk');
  const r = new Reader(chunkData(data, fmt));
  if (r.length < 16) throw new Error('fmt too short');
  const formatTag = r.u16(), channels = r.u16(), sampleRate = r.u32(), avgBytesPerSec = r.u32(), blockAlign = r.u16(), bitsPerSample = r.u16();
  const w: Wav = {
    formatTag, channels, sampleRate, avgBytesPerSec, blockAlign, bitsPerSample, fmtSize: fmt.size,
    dataOffset: dat.dataOffset, dataSize: dat.available, frames: 0, duration: 0, loops: [], midiUnityNote: null, cueCount: 0, info: {},
    chunkOrder: root.children.map((c) => (c.id === 'LIST' ? `LIST:${c.type}` : c.id)), problems: [...riff.problems],
  };
  if (formatTag === WAVE_FORMAT_MPEGLAYER3) {
    if (r.length < 30) throw new Error('MPEGLAYER3 fmt too short');
    const cb = r.u16();
    if (cb !== 12) w.problems.push(`MPEGLAYER3 cbSize ${cb} != 12`);
    w.mp3 = { id: r.u16(), flags: r.u32(), blockSize: r.u16(), framesPerBlock: r.u16(), codecDelay: r.u16() };
    const fact = findChunk(root, 'fact');
    if (!fact || fact.available < 4) throw new Error('MP3 WAV without fact chunk');
    w.frames = new DataView(data.buffer, data.byteOffset + fact.dataOffset, 4).getUint32(0, true);
  } else if (formatTag === WAVE_FORMAT_PCM) {
    if (blockAlign !== channels * (bitsPerSample >> 3)) w.problems.push('blockAlign != channels*bytes');
    w.frames = blockAlign ? Math.floor(w.dataSize / blockAlign) : 0;
  } else throw new Error(`unsupported wFormatTag ${formatTag}`);
  w.duration = sampleRate ? w.frames / sampleRate : 0;
  const smpl = findChunk(root, 'smpl');
  if (smpl && smpl.available >= 36) {
    const s = new Reader(chunkData(data, smpl));
    s.skip(12); w.midiUnityNote = s.u32(); s.skip(12);
    const n = s.u32(); s.skip(4);
    for (let i = 0; i < n && s.remaining >= 24; i++) w.loops.push({ cuePointId: s.u32(), type: s.u32(), start: s.u32(), end: s.u32(), fraction: s.u32(), playCount: s.u32() });
  }
  const cue = findChunk(root, 'cue ');
  if (cue && cue.available >= 4) w.cueCount = new DataView(data.buffer, data.byteOffset + cue.dataOffset, 4).getUint32(0, true);
  for (const l of findChunks(root, 'LIST', 'INFO')) Object.assign(w.info, infoStrings(data, l));
  return w;
}

/** MPEG audio frame header (layer 3 only needed here). Returns null if no valid sync. */
export function parseMpegHeader(d: Uint8Array, o: number): { version: number; layer: number; bitrate: number; sampleRate: number; channels: number; frameBytes: number; samplesPerFrame: number } | null {
  if (o + 4 > d.length || d[o] !== 0xff || (d[o + 1] & 0xe0) !== 0xe0) return null;
  const h = ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
  const ver = (h >>> 19) & 3, layer = 4 - ((h >>> 17) & 3), bi = (h >>> 12) & 15, si = (h >>> 10) & 3, pad = (h >>> 9) & 1;
  if (ver === 1 || layer === 4 || bi === 0 || bi === 15 || si === 3) return null;
  const rate = [[11025, 12000, 8000], null, [22050, 24000, 16000], [44100, 48000, 32000]][ver]![si];
  const v1l3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const v2l3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  if (layer !== 3) return null;
  const bitrate = (ver === 3 ? v1l3 : v2l3)[bi] * 1000;
  const spf = ver === 3 ? 1152 : 576;
  const frameBytes = Math.floor(((ver === 3 ? 144 : 72) * bitrate) / rate) + pad;
  return { version: ver, layer, bitrate, sampleRate: rate, channels: ((h >>> 6) & 3) === 3 ? 1 : 2, frameBytes, samplesPerFrame: spf };
}

/** Walk the MPEG frames of an MP3-in-WAV data chunk. Returns frame count and any leftover bytes. */
export function countMp3Frames(data: Uint8Array, w: Wav): { frames: number; leftover: number } {
  let o = w.dataOffset;
  const end = w.dataOffset + w.dataSize;
  let frames = 0;
  for (;;) {
    const h = parseMpegHeader(data, o);
    if (!h || o + h.frameBytes > end) break;
    o += h.frameBytes; frames++;
  }
  return { frames, leftover: end - o };
}

// ---------------------------------------------------------------- FINDER.DAT

export interface FinderEntry {
  /** Mac-style long file name (Pascal string, e.g. "Grass_1.WAV") */
  name: string;
  /** upper-case 8.3 style name with the space-padded extension, e.g. "GRASS_1 WAV" */
  shortName: string;
  /** 4-char Mac file type ".WAV" and creator "Sd2a" (Sound Designer II) */
  fileType: string;
  creator: string;
  /** the remaining raw 32-bit words of the record (dates and ids), not interpreted */
  raw: Uint8Array;
}

export const FINDER_RECORD = 92;

/**
 * FINDER.DAT in z02LGI/Footsteps/*: a Mac "Services for Macintosh / PC Exchange" desktop info file produced when the
 * sounds were authored on a Mac volume. 92-byte records. The game never reads it (no reference in the EXE).
 */
export function parseFinderDat(data: Uint8Array): FinderEntry[] {
  if (data.length % FINDER_RECORD !== 0) throw new Error(`FINDER.DAT size ${data.length} not a multiple of ${FINDER_RECORD}`);
  const out: FinderEntry[] = [];
  for (let o = 0; o < data.length; o += FINDER_RECORD) {
    const rec = data.subarray(o, o + FINDER_RECORD);
    const n = rec[0];
    if (n > 31) throw new Error('bad name length');
    const s = (a: number, b: number) => String.fromCharCode(...rec.subarray(a, b));
    out.push({ name: s(1, 1 + n), shortName: s(0x50, 0x5b), fileType: s(0x20, 0x24), creator: s(0x24, 0x28), raw: rec });
  }
  return out;
}

// ---------------------------------------------------------------- .pk peak files

export interface PeakFile {
  /** header words 0..17 (72 bytes) */
  header: Uint32Array;
  /** number of 8-byte peak records following the header (header word 2) */
  records: number;
  sampleRate: number;
}

/**
 * z90ADV/*.pk: waveform peak cache written by the wave editor (Cool Edit / Sound Forge style), one per edited wav.
 * 18 u32 header words (word0 = 1777, word1 = 256, word2 = record count, word3 = 8000), then 8-byte records. The game ignores them.
 */
export function parsePeakFile(data: Uint8Array): PeakFile {
  const r = new Reader(data);
  if (data.length < 72) throw new Error('too short');
  const header = r.u32s(18);
  if (header[0] !== 1777 || header[1] !== 256) throw new Error(`unexpected .pk header ${header[0]} ${header[1]}`);
  const records = header[2];
  if (72 + records * 8 !== data.length) throw new Error(`.pk size ${data.length} != 72 + ${records}*8`);
  return { header, records, sampleRate: header[3] };
}

// ---------------------------------------------------------------- Standard MIDI header

export interface MidiInfo { format: number; tracks: number; division: number; trackChunks: number }

export function parseMidiInfo(data: Uint8Array): MidiInfo {
  const r = new Reader(data);
  r.expectTag('MThd');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = dv.getUint32(4, false);
  if (len !== 6) throw new Error('MThd length != 6');
  const format = dv.getUint16(8, false), tracks = dv.getUint16(10, false), division = dv.getUint16(12, false);
  let o = 14, trackChunks = 0;
  while (o + 8 <= data.length) {
    const id = String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]);
    const sz = dv.getUint32(o + 4, false);
    if (id !== 'MTrk') throw new Error(`unexpected chunk ${id} at ${o}`);
    o += 8 + sz; trackChunks++;
  }
  if (o !== data.length) throw new Error(`MIDI size mismatch (${o} vs ${data.length})`);
  return { format, tracks, division, trackChunks };
}

// ---------------------------------------------------------------- DirectMusic RIFF summaries

export interface DmSummary {
  /** RIFF form: "DMST" style, "DMSG" segment, "DLS " collection */
  form: string;
  /** names found in UNFO/UNAM and INFO/INAM chunks */
  names: string[];
  /** chunk counts by id / "LIST:type" / "RIFF:type" */
  counts: Record<string, number>;
  /** file references (DMRF/file chunks: UTF-16 names) */
  references: string[];
  problems: string[];
}

function utf16z(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) { const c = b[i] | (b[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); }
  return s;
}
function latin1z(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length && b[i] !== 0; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** Chunk trees of .sty (DMST), .sgt (DMSG) and .dls (DLS ): names, per-chunk counts and referenced files. */
export function summarizeDirectMusic(data: Uint8Array): DmSummary {
  const riff = parseRiff(data);
  if (riff.chunks.length !== 1) throw new Error(`${riff.chunks.length} top-level chunks`);
  const root = riff.chunks[0];
  const form = root.type ?? '';
  if (form !== 'DMST' && form !== 'DMSG' && form !== 'DLS ') throw new Error(`unexpected RIFF form "${form}"`);
  const names: string[] = [];
  const references: string[] = [];
  const walk = (c: RiffChunk) => {
    if (c.id === 'UNAM') names.push(utf16z(chunkData(data, c)));
    else if (c.id === 'INAM') names.push(latin1z(chunkData(data, c)));
    else if (c.id === 'file' ) references.push(utf16z(chunkData(data, c)));
    for (const k of c.children) walk(k);
  };
  walk(root);
  return { form, names, counts: countChunks([root]), references, problems: riff.problems };
}

// ---------------------------------------------------------------- PE identification (MSS redist)

export interface PeInfo { machine: number; timestamp: number; sections: string[]; imports: string[]; isDll: boolean }

/** Minimal PE reader: enough to identify the Miles Sound System plug-ins (.flt, .m3d, .asi) and mss32.dll. */
export function parsePeInfo(data: Uint8Array): PeInfo {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[0] !== 0x4d || data[1] !== 0x5a) throw new Error('not MZ');
  const pe = dv.getUint32(0x3c, true);
  if (dv.getUint32(pe, true) !== 0x4550) throw new Error('no PE signature');
  const machine = dv.getUint16(pe + 4, true), n = dv.getUint16(pe + 6, true), timestamp = dv.getUint32(pe + 8, true);
  const optSize = dv.getUint16(pe + 20, true), characteristics = dv.getUint16(pe + 22, true);
  const sections: string[] = [];
  const secs: { va: number; size: number; raw: number }[] = [];
  for (let i = 0; i < n; i++) {
    const o = pe + 24 + optSize + i * 40;
    let name = '';
    for (let k = 0; k < 8 && data[o + k]; k++) name += String.fromCharCode(data[o + k]);
    sections.push(name);
    secs.push({ va: dv.getUint32(o + 12, true), size: Math.max(dv.getUint32(o + 8, true), dv.getUint32(o + 16, true)), raw: dv.getUint32(o + 20, true) });
  }
  const r2o = (rva: number) => { for (const s of secs) if (rva >= s.va && rva < s.va + s.size) return rva - s.va + s.raw; return -1; };
  const imports: string[] = [];
  const impRva = dv.getUint32(pe + 24 + 96 + 8, true);
  let o = impRva ? r2o(impRva) : -1;
  while (o >= 0 && o + 20 <= data.length) {
    const nameRva = dv.getUint32(o + 12, true);
    if (!nameRva) break;
    const p = r2o(nameRva);
    if (p < 0) break;
    let s = '';
    for (let k = p; data[k]; k++) s += String.fromCharCode(data[k]);
    imports.push(s);
    o += 20;
  }
  return { machine, timestamp, sections, imports, isDll: (characteristics & 0x2000) !== 0 };
}

// ---------------------------------------------------------------- EXE sound table (SoundClass.cpp)

export interface SoundTableEntry {
  /** enum value (index into the table), registered under `name` for scripts */
  id: number;
  /** symbolic name, e.g. "SND_WALK_GRASS1" or "CSSND_BBOT_VOX" (cutscene sounds) */
  name: string;
  /** file path as stored: "_Data\\sounds\\\\z02LGI\\Silence.wav" (double backslash after sounds is common) or "UNDEFINED" */
  path: string;
  /** AIL_set_sample_volume base volume 0..127 (the game multiplies by master volume / 100) */
  volume: number;
  /** AIL_set_sample_loop_count: 1 = once, 0 = loop forever, n = n times */
  loopCount: number;
  /** AIL_set_3D_sample_distances min / max */
  minDist: number;
  maxDist: number;
  /** AIL_set_sample_pan, 64 = centre */
  pan: number;
  /** AIL_set_sample_playback_rate in Hz (applied on top of the file; differs from the wav header rate in ~15% of entries) */
  rate: number;
  /** second copy of loopCount (always equal) */
  loopCount2: number;
}

/** Virtual addresses in "LEGO eiland 2.exe" (image base 0x400000, no ASLR, single known build). */
export const SOUND_TABLE_VA = 0x969f80;
export const SOUND_TABLE_ENTRIES = 902;
export const SOUND_TABLE_STRIDE = 32;
/** FUN_0045bff4(registry, name, id): registers a script symbol; called 902x by FUN_00877550 to publish the SND_ names. */
export const SOUND_REGISTER_FN_VA = 0x45bff4;

function peSections(d: Uint8Array): { va: number; size: number; raw: number }[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const pe = dv.getUint32(0x3c, true);
  const base = dv.getUint32(pe + 24 + 28, true);
  const n = dv.getUint16(pe + 6, true), opt = dv.getUint16(pe + 20, true);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = pe + 24 + opt + i * 40;
    out.push({ va: base + dv.getUint32(o + 12, true), size: Math.max(dv.getUint32(o + 8, true), dv.getUint32(o + 16, true)), raw: dv.getUint32(o + 20, true) });
  }
  return out;
}

/**
 * Read the 902-entry sound table (32-byte records at VA 0x969f80) and the SND_ names from the registration code at
 * FUN_00877550. Needs the original EXE bytes (the result is small and can be exported to JSON for the web build).
 */
export function readExeSoundTable(exe: Uint8Array): SoundTableEntry[] {
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const secs = peSections(exe);
  const off = (va: number) => { for (const s of secs) if (va >= s.va && va < s.va + s.size) return va - s.va + s.raw; throw new Error(`VA ${va.toString(16)} not mapped`); };
  const cstr = (va: number) => { let o = off(va), s = ''; while (exe[o]) s += String.fromCharCode(exe[o++]); return s; };
  // names: scan .text for `push id; push name; mov reg,[abs]; push reg; call REGISTER`
  const names = new Map<number, string>();
  const text = secs[0];
  const end = text.raw + text.size;
  for (let p = text.raw + 16; p < end - 5; p++) {
    if (exe[p] !== 0xe8) continue;
    const target = text.va + (p - text.raw) + 5 + dv.getInt32(p + 1, true);
    if (target !== SOUND_REGISTER_FN_VA) continue;
    let q = p - 1; // push reg
    if (exe[q] < 0x50 || exe[q] > 0x57) continue;
    q -= exe[q - 5] === 0xa1 ? 5 : 6; // mov eax,[abs] / mov ecx|edx,[abs]
    q -= 5; // push imm32 name
    if (exe[q] !== 0x68) continue;
    const nameVa = dv.getUint32(q + 1, true);
    let id: number;
    if (exe[q - 2] === 0x6a) id = exe[q - 1]; else if (exe[q - 5] === 0x68) id = dv.getUint32(q - 4, true); else continue;
    names.set(id, cstr(nameVa));
  }
  const out: SoundTableEntry[] = [];
  for (let i = 0; i < SOUND_TABLE_ENTRIES; i++) {
    const o = off(SOUND_TABLE_VA + i * SOUND_TABLE_STRIDE);
    const pathVa = dv.getUint32(o, true);
    out.push({
      id: i, name: names.get(i) ?? '', path: cstr(pathVa), volume: dv.getUint32(o + 4, true), loopCount: dv.getUint32(o + 8, true),
      minDist: dv.getFloat32(o + 12, true), maxDist: dv.getFloat32(o + 16, true), pan: dv.getUint32(o + 20, true), rate: dv.getUint32(o + 24, true), loopCount2: dv.getUint32(o + 28, true),
    });
  }
  return out;
}

// ---------------------------------------------------------------- EXE music / speech / ambience tables

function exeReader(exe: Uint8Array) {
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const secs = peSections(exe);
  const off = (va: number) => { for (const s of secs) if (va >= s.va && va < s.va + s.size) return va - s.va + s.raw; return -1; };
  const isStr = (va: number) => va > 0x890000 && va < 0x9a0000 && off(va) >= 0;
  const cstr = (va: number) => { let o = off(va), s = ''; while (exe[o]) s += String.fromCharCode(exe[o++]); return s; };
  return { dv, off, isStr, cstr };
}

export interface MusicTableEntry {
  /** zone/level key compared case-insensitively with the requested name (FUN_00876841), e.g. "Z02LGIM" */
  key: string;
  /** directory, e.g. "_Data\\sounds\\DirectMusic\\z02LGI" */
  dir: string;
  /** DirectMusic segment file (.sgt) and the DLS collection (.dls) loaded with it */
  segment: string;
  dls: string;
}
export const MUSIC_TABLE_VA = 0x97fcb8;
export const MUSIC_TABLE_ENTRIES = 41;

/** 41 records of 4 string pointers (16 bytes) at VA 0x97fcb8: level key -> DirectMusic segment + DLS. Loader FUN_00876841. */
export function readExeMusicTable(exe: Uint8Array): MusicTableEntry[] {
  const { dv, off, cstr } = exeReader(exe);
  const out: MusicTableEntry[] = [];
  for (let i = 0; i < MUSIC_TABLE_ENTRIES; i++) {
    const o = off(MUSIC_TABLE_VA + i * 16);
    out.push({ key: cstr(dv.getUint32(o, true)), dir: cstr(dv.getUint32(o + 4, true)), segment: cstr(dv.getUint32(o + 8, true)), dls: cstr(dv.getUint32(o + 12, true)) });
  }
  return out;
}

export const SPEECH_TABLE_VA = 0x979098;

/**
 * Speech id table: array of char* starting at VA 0x979098 ("LECSIN01", ...), index = speech enum value; the file is
 * "_Data/sounds/speech/Data/<id>.mp3" (FUN_00875825). Runs until the first non-string pointer.
 */
export function readExeSpeechTable(exe: Uint8Array): string[] {
  const { dv, off, isStr, cstr } = exeReader(exe);
  const out: string[] = [];
  for (let va = SPEECH_TABLE_VA; ; va += 4) {
    const p = dv.getUint32(off(va), true);
    if (!isStr(p)) break;
    out.push(cstr(p));
  }
  return out;
}

export interface AmbienceTableEntry { key: string; midi: string; dls: string; volume: number }
export const AMBIENCE_TABLE_VA = 0x97ff48;
export const AMBIENCE_TABLE_ENTRIES = 6;

/** 6 MIDI ambience records (key, .mid path, .dls path, volume) at VA 0x97ff48, used by FUN_00875918 (AIL_MIDI_to_XMI + AIL_DLS_load_file). */
export function readExeAmbienceTable(exe: Uint8Array): AmbienceTableEntry[] {
  const { dv, off, cstr } = exeReader(exe);
  const out: AmbienceTableEntry[] = [];
  for (let i = 0; i < AMBIENCE_TABLE_ENTRIES; i++) {
    const o = off(AMBIENCE_TABLE_VA + i * 16);
    out.push({ key: cstr(dv.getUint32(o, true)), midi: cstr(dv.getUint32(o + 4, true)), dls: cstr(dv.getUint32(o + 8, true)), volume: dv.getUint32(o + 12, true) });
  }
  return out;
}
