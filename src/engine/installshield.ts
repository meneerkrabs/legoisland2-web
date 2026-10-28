// Reader for InstallShield cabinets (data1.hdr + data1.cab, data2.cab, ...), the format the LEGO Eiland 2 CD uses.
// A port of the parts of unshield (https://github.com/twogood/unshield, MIT, David Eriksson) that this CD needs:
// header/descriptor parsing (versions 5 and 6..16), directories, file groups, file descriptors, files split over
// volumes, linked files, obfuscation, and the chunked raw-deflate compression. Everything is random access over
// Blobs (File, OPFS file, Blob.slice of an ISO), so a 342 MB cabinet is never loaded as a whole.
//
// Layout facts (cabinet descriptor, offsets relative to `cab_descriptor_offset` unless noted):
//   0x0c file table offset, 0x14 file table size, 0x1c directory count, 0x28 file count, 0x2c file table offset 2,
//   0x3e 71 file group list heads, 0x15a 71 component list heads.
//   file table = [directory_count + file_count] u32 offsets (of directory names / v5 file descriptors);
//   v6+ file descriptors are 0x57 bytes each at file_table_offset + file_table_offset2.
// A compressed file is a sequence of chunks: u16 size, then `size` bytes of raw deflate.

import { inflateRaw } from './inflate.ts';

const FILE_SPLIT = 1;
const FILE_OBFUSCATED = 2;
const FILE_COMPRESSED = 4;
const FILE_INVALID = 8;
const LINK_PREV = 1;
const COMMON_HEADER_SIZE = 20;
const MAX_GROUPS = 71;
const READ_AHEAD = 4 << 20;

export interface CabEntry {
  /** Index in the cabinet's file table. */
  index: number;
  /** File group, e.g. "Game". */
  group: string;
  /** Install directory inside the group with forward slashes, e.g. "_data/sounds" ("" = group root). */
  dir: string;
  name: string;
  /** `dir/name` (the installed path below the group). */
  path: string;
  /** Uncompressed size. */
  size: number;
  compressedSize: number;
  /** Hex MD5 of the uncompressed data (v6+), "" otherwise. */
  md5: string;
  flags: number;
  volume: number;
}

interface FileDesc {
  flags: number;
  expanded: number;
  compressed: number;
  dataOffset: number;
  md5: Uint8Array;
  nameOffset: number;
  dirIndex: number;
  linkPrevious: number;
  linkFlags: number;
  volume: number;
}

interface VolumeHeader {
  dataOffset: number;
  firstIndex: number;
  lastIndex: number;
  firstOffset: number;
  firstExpanded: number;
  firstCompressed: number;
  lastOffset: number;
  lastExpanded: number;
  lastCompressed: number;
}

const u32 = (d: DataView, o: number) => d.getUint32(o, true);
const u64 = (d: DataView, o: number) => d.getUint32(o, true) + d.getUint32(o + 4, true) * 0x100000000;

function cstr(b: Uint8Array, off: number): string {
  let e = off;
  while (e < b.length && b[e] !== 0) e++;
  // the strings are in the install machine's ANSI code page; latin-1 keeps every byte
  let s = '';
  for (let i = off; i < e; i++) s += String.fromCharCode(b[i]);
  return s;
}

function hex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Undo InstallShield's byte obfuscation (the seed counts bytes since the start of the file). */
function deobfuscate(buf: Uint8Array, from: number, to: number, seed: number): number {
  for (let i = from; i < to; i++, seed++) {
    const x = buf[i] ^ 0xd5;
    buf[i] = (((x >> 2) | (x << 6)) & 0xff) - (seed % 0x47);
  }
  return seed;
}

export class InstallShieldCab {
  /** Every valid file of every file group (a file in several groups appears once per group). */
  readonly entries: CabEntry[] = [];
  readonly groups: string[] = [];
  readonly majorVersion: number;
  private header: Uint8Array;
  private hv: DataView;
  private descOff: number;
  private tableOff: number;
  private fileTable: Uint32Array;
  private fileCount: number;
  private dirCount: number;
  private fileTable2: number;
  private descs = new Map<number, FileDesc>();
  private byPath = new Map<string, CabEntry>();
  private volumes: Blob[];

  private constructor(header: Uint8Array, volumes: Blob[]) {
    this.header = header;
    this.volumes = volumes;
    const hv = (this.hv = new DataView(header.buffer, header.byteOffset, header.byteLength));
    if (header.length < COMMON_HEADER_SIZE || u32(hv, 0) !== 0x28635349) throw new Error('Geen InstallShield-cabinet (ongeldige handtekening).');
    const version = u32(hv, 4);
    const hi = version >>> 24;
    let major = -1;
    if (hi === 1) major = (version >>> 12) & 0xf;
    else if (hi === 2 || hi === 4) {
      major = version & 0xffff;
      if (major !== 0) major = Math.floor(major / 100);
    }
    if (major < 0 || major >= 17) throw new Error(`InstallShield-versie 0x${version.toString(16)} wordt niet ondersteund.`);
    this.majorVersion = major;
    this.descOff = u32(hv, 12);
    const d = this.descOff;
    if (u32(hv, 16) === 0 || d + 0x15a + MAX_GROUPS * 4 > header.length) throw new Error('InstallShield-cabinet zonder bestandslijst (header ontbreekt?).');
    this.tableOff = u32(hv, d + 0xc);
    this.dirCount = u32(hv, d + 0x1c);
    this.fileCount = u32(hv, d + 0x28);
    this.fileTable2 = u32(hv, d + 0x2c);
    const count = this.dirCount + this.fileCount;
    const start = d + this.tableOff;
    if (count === 0 || start + count * 4 > header.length) throw new Error('InstallShield-bestandstabel buiten de header.');
    this.fileTable = new Uint32Array(count);
    for (let i = 0; i < count; i++) this.fileTable[i] = u32(hv, start + i * 4);
    this.readGroups();
  }

  /**
   * Open a cabinet. `header` is data1.hdr (or data1.cab when there is no .hdr), `volumes[0]` is data1.cab,
   * `volumes[1]` data2.cab, ...
   */
  static async open(header: Blob, volumes: Blob[]): Promise<InstallShieldCab> {
    return new InstallShieldCab(new Uint8Array(await header.arrayBuffer()), volumes);
  }

  private str(offset: number): string {
    return cstr(this.header, this.descOff + offset);
  }

  private readGroups() {
    const d = this.descOff;
    const hv = this.hv;
    const v5 = this.majorVersion <= 5;
    for (let g = 0; g < MAX_GROUPS; g++) {
      let next = u32(hv, d + 0x3e + g * 4);
      while (next) {
        const node = this.descOff + next;
        const descriptor = u32(hv, node + 4);
        next = u32(hv, node + 8);
        const p = this.descOff + descriptor;
        const name = this.str(u32(hv, p));
        const q = p + 4 + (v5 ? 0x48 : 0x12);
        const first = hv.getInt32(q, true);
        const last = hv.getInt32(q + 4, true);
        this.groups.push(name);
        if (first < 0) continue;
        for (let i = first; i <= last && i < this.fileCount; i++) {
          const fd = this.desc(i);
          if (fd.flags & FILE_INVALID || !fd.nameOffset || !fd.dataOffset) continue;
          const dir = this.dirName(fd.dirIndex).replace(/\\/g, '/');
          const name2 = this.str(this.tableOff + fd.nameOffset);
          const e: CabEntry = {
            index: i, group: name, dir, name: name2, path: dir ? `${dir}/${name2}` : name2,
            size: fd.expanded, compressedSize: fd.compressed, md5: this.majorVersion >= 6 ? hex(fd.md5) : '',
            flags: fd.flags, volume: fd.volume,
          };
          this.entries.push(e);
          const key = `${name}/${e.path}`.toLowerCase();
          if (!this.byPath.has(key)) this.byPath.set(key, e);
        }
      }
    }
  }

  private dirName(i: number): string {
    return this.str(this.tableOff + this.fileTable[i]);
  }

  private desc(index: number): FileDesc {
    let fd = this.descs.get(index);
    if (fd) return fd;
    const hv = this.hv;
    const base = this.descOff + this.tableOff;
    if (this.majorVersion <= 5) {
      let p = base + this.fileTable[this.dirCount + index];
      const nameOffset = u32(hv, p); p += 4;
      const dirIndex = hv.getUint16(p, true); p += 4;
      const flags = hv.getUint16(p, true); p += 2;
      const expanded = u32(hv, p); p += 4;
      const compressed = u32(hv, p); p += 4;
      p += 0x14;
      const dataOffset = u32(hv, p); p += 4;
      const md5 = this.majorVersion === 5 ? this.header.subarray(p, p + 16) : new Uint8Array(16);
      fd = { flags, expanded, compressed, dataOffset, md5, nameOffset, dirIndex, linkPrevious: 0, linkFlags: 0, volume: 1 };
    } else {
      let p = base + this.fileTable2 + index * 0x57;
      const flags = hv.getUint16(p, true); p += 2;
      const expanded = u64(hv, p); p += 8;
      const compressed = u64(hv, p); p += 8;
      const dataOffset = u64(hv, p); p += 8;
      const md5 = this.header.subarray(p, p + 16); p += 32;
      const nameOffset = u32(hv, p); p += 4;
      const dirIndex = hv.getUint16(p, true); p += 2;
      p += 0xc;
      const linkPrevious = u32(hv, p); p += 4;
      p += 4; // link_next
      const linkFlags = this.header[p]; p += 1;
      const volume = hv.getUint16(p, true);
      fd = { flags, expanded, compressed, dataOffset, md5, nameOffset, dirIndex, linkPrevious, linkFlags, volume };
    }
    this.descs.set(index, fd);
    return fd;
  }

  /** Entries of one file group ("Game" = the installed game folder), in cabinet order. */
  files(group?: string): CabEntry[] {
    return group ? this.entries.filter((e) => e.group === group) : this.entries;
  }

  /** Case-insensitive lookup by `group/path` (backslashes allowed). */
  find(group: string, path: string): CabEntry | undefined {
    return this.byPath.get(`${group}/${path.replace(/\\/g, '/')}`.toLowerCase());
  }

  /** Read a whole file. */
  async read(entry: CabEntry): Promise<Uint8Array> {
    const out = new Uint8Array(entry.size);
    let o = 0;
    for await (const piece of this.chunks(entry)) {
      out.set(piece, o);
      o += piece.length;
    }
    if (o !== entry.size) throw new Error(`${entry.path}: ${o} bytes gelezen, ${entry.size} verwacht`);
    return out;
  }

  /** The file as decompressed pieces (each chunk of the cabinet at a time), for streaming big files. */
  async *chunks(entry: CabEntry): AsyncGenerator<Uint8Array> {
    let fd = this.desc(entry.index);
    // a file whose data lives in another file's descriptor
    for (let guard = 0; fd.linkFlags & LINK_PREV; guard++) {
      if (guard > 16) throw new Error('InstallShield: lus in gekoppelde bestanden');
      fd = this.desc(fd.linkPrevious);
    }
    if (fd.flags & FILE_INVALID || !fd.dataOffset) throw new Error(`${entry.path}: ongeldig bestand in de cabinet`);
    const reader = new FileReader(this, fd, entry.index);
    await reader.open(fd.volume);
    if (fd.flags & FILE_COMPRESSED) {
      let left = fd.compressed;
      let total = 0;
      while (left > 0) {
        const sz = await reader.read(2);
        const n = sz[0] | (sz[1] << 8);
        if (n === 0) throw new Error(`${entry.path}: lege chunk`);
        const data = await reader.read(n);
        left -= 2 + n;
        // chunks expand to at most 64 KB (unshield's buffer size); the final bytes of the file may be fewer
        const out = new Uint8Array(Math.min(0x10000, Math.max(0, fd.expanded - total) || 0x10000));
        const len = inflateRaw(data, 0, data.length, out, 0);
        total += len;
        yield len === out.length ? out : out.subarray(0, len);
      }
      if (total !== fd.expanded) throw new Error(`${entry.path}: uitgepakt ${total} bytes, verwacht ${fd.expanded}`);
    } else {
      let left = fd.expanded;
      while (left > 0) {
        const n = Math.min(left, 1 << 20);
        yield await reader.read(n);
        left -= n;
      }
    }
  }

  /** @internal volume blob (1-based). */
  volumeBlob(n: number): Blob {
    const b = this.volumes[n - 1];
    if (!b) throw new Error(`InstallShield: volume ${n} ontbreekt (data${n}.cab)`);
    return b;
  }

  /** @internal */
  async volumeHeader(vol: number): Promise<VolumeHeader> {
    const six = this.majorVersion >= 6;
    const buf = new Uint8Array(await this.volumeBlob(vol).slice(COMMON_HEADER_SIZE, COMMON_HEADER_SIZE + (six ? 64 : 40)).arrayBuffer());
    const d = new DataView(buf.buffer);
    if (six) {
      return {
        dataOffset: u32(d, 0), firstIndex: u32(d, 8), lastIndex: u32(d, 12),
        firstOffset: u32(d, 16), firstExpanded: u32(d, 24), firstCompressed: u32(d, 32),
        lastOffset: u32(d, 40), lastExpanded: u32(d, 48), lastCompressed: u32(d, 56),
      };
    }
    return {
      dataOffset: u32(d, 0), firstIndex: u32(d, 8), lastIndex: u32(d, 12),
      firstOffset: u32(d, 16), firstExpanded: u32(d, 20), firstCompressed: u32(d, 24),
      lastOffset: u32(d, 28) || 0x7fffffff, lastExpanded: u32(d, 32), lastCompressed: u32(d, 36),
    };
  }
}

/** Sequential reader over one file's bytes, hopping to the next volume for files split over several .cab files. */
class FileReader {
  private vol = 0;
  private pos = 0; // offset in the current volume of the next byte NOT yet in `buf`
  private left = 0; // bytes of this file left in the current volume beyond `buf`
  private buf = new Uint8Array(0);
  private bufPos = 0;
  private seed = 0;
  private cab: InstallShieldCab;
  private fd: FileDesc;
  private index: number;
  constructor(cab: InstallShieldCab, fd: FileDesc, index: number) {
    this.cab = cab;
    this.fd = fd;
    this.index = index;
  }

  async open(vol: number) {
    const cab = this.cab;
    const fd = this.fd;
    const compressed = !!(fd.flags & FILE_COMPRESSED);
    let offset = fd.dataOffset;
    let size = compressed ? fd.compressed : fd.expanded;
    if (fd.flags & FILE_SPLIT) {
      const vh = await cab.volumeHeader(vol);
      if (this.index === vh.lastIndex && vh.lastOffset !== 0x7fffffff) {
        offset = vh.lastOffset;
        size = compressed ? vh.lastCompressed : vh.lastExpanded;
      } else if (this.index === vh.firstIndex) {
        offset = vh.firstOffset;
        size = compressed ? vh.firstCompressed : vh.firstExpanded;
      } else {
        throw new Error(`InstallShield: bestand ${this.index} staat niet in volume ${vol}`);
      }
    }
    this.vol = vol;
    this.pos = offset;
    this.left = size;
    this.buf = new Uint8Array(0);
    this.bufPos = 0;
  }

  async read(n: number): Promise<Uint8Array> {
    const out = new Uint8Array(n);
    let o = 0;
    while (o < n) {
      if (this.bufPos >= this.buf.length) {
        if (this.left === 0) await this.open(this.vol + 1);
        const want = Math.min(this.left, Math.max(n - o, READ_AHEAD));
        if (want <= 0) throw new Error('InstallShield: onverwacht einde van de cabinet-data');
        const blob = this.cab.volumeBlob(this.vol);
        const b = new Uint8Array(await blob.slice(this.pos, this.pos + want).arrayBuffer());
        if (b.length !== want) throw new Error('InstallShield: cabinet is afgekapt');
        this.buf = b;
        this.bufPos = 0;
        this.pos += want;
        this.left -= want;
      }
      const k = Math.min(n - o, this.buf.length - this.bufPos);
      out.set(this.buf.subarray(this.bufPos, this.bufPos + k), o);
      this.bufPos += k;
      o += k;
    }
    if (this.fd.flags & FILE_OBFUSCATED) this.seed = deobfuscate(out, 0, n, this.seed);
    return out;
  }
}
