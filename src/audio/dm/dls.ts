// DLS (Downloadable Sounds) level 1/2 collection parser, as used by the game's DirectMusic .dls files.
// Pure (no DOM). See docs/re/audio.md section "DLS" for what the game's files actually contain.
import { parseRiff, findChunk, findChunks, chunkData } from '../../formats/riff.ts';
import type { RiffChunk } from '../../formats/riff.ts';

export interface DlsConnection { src: number; ctl: number; dst: number; transform: number; scale: number }
export interface DlsLoop { type: number; start: number; length: number }
export interface DlsWsmp { unityNote: number; fineTune: number; /** 1/65536 dB (gain, normally <= 0 for attenuation is applied as -value) */ attenuation: number; options: number; loops: DlsLoop[] }

export interface DlsWave {
  index: number;
  name: string;
  channels: number;
  sampleRate: number;
  bits: number;
  /** mono float samples (-1..1); multi-channel waves are mixed down at load */
  data: Float32Array;
  wsmp: DlsWsmp | null;
}

export interface DlsRegion {
  keyLow: number; keyHigh: number; velLow: number; velHigh: number;
  keyGroup: number; layer: number; selfNonExclusive: boolean;
  wsmp: DlsWsmp | null;
  waveIndex: number;
  waveChannel: number;
  conns: DlsConnection[];
}

export interface DlsInstrument {
  name: string;
  /** bank MSB (CC0), LSB (CC32), isDrum, program */
  msb: number; lsb: number; drum: boolean; program: number;
  regions: DlsRegion[];
  conns: DlsConnection[];
}

export interface DlsCollection {
  name: string;
  instruments: DlsInstrument[];
  waves: DlsWave[];
}

const u16 = (d: DataView, o: number) => d.getUint16(o, true);
const u32 = (d: DataView, o: number) => d.getUint32(o, true);
const i32 = (d: DataView, o: number) => d.getInt32(o, true);

function str(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length && b[i] !== 0; i++) s += String.fromCharCode(b[i]);
  return s;
}

function dvOf(b: Uint8Array) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }

function parseWsmp(b: Uint8Array): DlsWsmp {
  const d = dvOf(b);
  const cb = u32(d, 0);
  const w: DlsWsmp = { unityNote: u16(d, 4), fineTune: d.getInt16(6, true), attenuation: i32(d, 8), options: u32(d, 12), loops: [] };
  const n = u32(d, 16);
  let o = cb;
  for (let i = 0; i < n && o + 16 <= b.length; i++) {
    const lcb = u32(d, o);
    w.loops.push({ type: u32(d, o + 4), start: u32(d, o + 8), length: u32(d, o + 12) });
    o += lcb || 16;
  }
  return w;
}

function parseArt(list: RiffChunk, data: Uint8Array): DlsConnection[] {
  const out: DlsConnection[] = [];
  for (const c of list.children) {
    if (c.id !== 'art1' && c.id !== 'art2') continue;
    const b = chunkData(data, c);
    const d = dvOf(b);
    const cb = u32(d, 0), n = u32(d, 4);
    for (let i = 0; i < n; i++) {
      const o = cb + i * 12;
      if (o + 12 > b.length) break;
      out.push({ src: u16(d, o), ctl: u16(d, o + 2), dst: u16(d, o + 4), transform: u16(d, o + 6), scale: i32(d, o + 8) });
    }
  }
  return out;
}

function waveFromChunk(data: Uint8Array, wc: RiffChunk, index: number): DlsWave {
  const fmt = findChunk(wc, 'fmt ')!;
  const dat = findChunk(wc, 'data')!;
  const f = chunkData(data, fmt), fd = dvOf(f);
  const tag = u16(fd, 0), channels = u16(fd, 2), sampleRate = u32(fd, 4), bits = u16(fd, 14);
  if (tag !== 1) throw new Error(`DLS wave ${index}: format tag ${tag} not PCM`);
  const raw = chunkData(data, dat);
  const frames = Math.floor(raw.length / (channels * (bits >> 3)));
  const out = new Float32Array(frames);
  const rd = dvOf(raw);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const p = (i * channels + c) * (bits >> 3);
      acc += bits === 16 ? rd.getInt16(p, true) / 32768 : bits === 8 ? (raw[p] - 128) / 128 : bits === 24 ? ((raw[p] | (raw[p + 1] << 8) | (raw[p + 2] << 16)) << 8 >> 8) / 8388608 : 0;
    }
    out[i] = acc / channels;
  }
  let name = '';
  const info = findChunk(wc, 'LIST', 'INFO');
  if (info) { const n = findChunk(info, 'INAM'); if (n) name = str(chunkData(data, n)); }
  const ws = findChunk(wc, 'wsmp');
  return { index, name, channels, sampleRate, bits, data: out, wsmp: ws ? parseWsmp(chunkData(data, ws)) : null };
}

/** Parse a DLS collection. `opts.lazyWaves` is not supported: the whole wave pool is decoded (3-4 MB files). */
export function parseDls(data: Uint8Array): DlsCollection {
  const riff = parseRiff(data);
  const root = riff.chunks[0];
  if (!root || root.type !== 'DLS ') throw new Error('not a DLS collection');
  let name = '';
  const info = findChunk(root, 'LIST', 'INFO');
  if (info) { const n = findChunk(info, 'INAM'); if (n) name = str(chunkData(data, n)); }

  // wave pool: ptbl gives the byte offsets (relative to the first byte after "wvpl") of each wave, in table order
  const wvpl = findChunk(root, 'LIST', 'wvpl');
  const waves: DlsWave[] = [];
  const poolWaves = wvpl ? findChunks(wvpl, 'LIST', 'wave') : [];
  poolWaves.forEach((wc, i) => waves.push(waveFromChunk(data, wc, i)));
  const ptbl = findChunk(root, 'ptbl');
  let cueToWave: number[] = waves.map((_, i) => i);
  if (ptbl && wvpl) {
    const b = chunkData(data, ptbl), d = dvOf(b);
    const cb = u32(d, 0), n = u32(d, 4);
    const base = wvpl.dataOffset + 4;
    const byOff = new Map<number, number>();
    poolWaves.forEach((wc, i) => byOff.set(wc.offset - base, i));
    cueToWave = [];
    for (let i = 0; i < n; i++) {
      const off = u32(d, cb + i * 4);
      const wi = byOff.get(off);
      cueToWave.push(wi === undefined ? i : wi);
    }
  }

  const instruments: DlsInstrument[] = [];
  const lins = findChunk(root, 'LIST', 'lins');
  for (const ins of lins ? findChunks(lins, 'LIST', 'ins ') : []) {
    const insh = findChunk(ins, 'insh');
    if (!insh) continue;
    const ih = dvOf(chunkData(data, insh));
    const bank = u32(ih, 4), program = u32(ih, 8);
    let iname = '';
    const iinfo = findChunk(ins, 'LIST', 'INFO');
    if (iinfo) { const n = findChunk(iinfo, 'INAM'); if (n) iname = str(chunkData(data, n)); }
    const inst: DlsInstrument = { name: iname, msb: (bank >> 8) & 0x7f, lsb: bank & 0x7f, drum: (bank & 0x80000000) !== 0, program: program & 0x7f, regions: [], conns: [] };
    for (const l of ins.children) if (l.id === 'LIST' && (l.type === 'lart' || l.type === 'lar2')) inst.conns.push(...parseArt(l, data));
    const lrgn = findChunk(ins, 'LIST', 'lrgn');
    for (const rg of lrgn ? lrgn.children.filter((c) => c.id === 'LIST' && (c.type === 'rgn ' || c.type === 'rgn2')) : []) {
      const rh = findChunk(rg, 'rgnh');
      const wl = findChunk(rg, 'wlnk');
      if (!rh || !wl) continue;
      const h = dvOf(chunkData(data, rh));
      const opts = u16(h, 8);
      const w = dvOf(chunkData(data, wl));
      const ws = findChunk(rg, 'wsmp');
      const tableIndex = u32(w, 8);
      const region: DlsRegion = {
        keyLow: u16(h, 0), keyHigh: u16(h, 2), velLow: u16(h, 4), velHigh: u16(h, 6), keyGroup: u16(h, 10),
        layer: chunkData(data, rh).length >= 14 ? u16(h, 12) : 0, selfNonExclusive: (opts & 1) !== 0,
        wsmp: ws ? parseWsmp(chunkData(data, ws)) : null,
        waveIndex: cueToWave[tableIndex] ?? tableIndex, waveChannel: u32(w, 4), conns: [],
      };
      if (region.velHigh === 0 && region.velLow === 0) region.velHigh = 127;
      for (const l of rg.children) if (l.id === 'LIST' && (l.type === 'lart' || l.type === 'lar2')) region.conns.push(...parseArt(l, data));
      inst.regions.push(region);
    }
    instruments.push(inst);
  }
  return { name, instruments, waves };
}
