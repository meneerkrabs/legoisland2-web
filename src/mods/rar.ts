// RAR archives for mod import (a .rar the user picked, and the catalogue's RAR mods such as webfischi's 512 MB HD Texture pack).
//
// Decoding is done by RARLAB's own unRAR source compiled to WebAssembly (npm package `node-unrar-js`, MIT wrapper; unRAR licence: see README "Dank en licenties").
// The wrapper wants the whole archive in memory. A 512 MB archive that unpacks to 2 GB must not be, so this file does two things:
//
//  1. "blocks" mode (RAR 1.5 - 4.x block format, not solid, not encrypted, one volume; the HD pack, most mods): the archive is walked header by header through a
//     random-access source (a Blob / OPFS file: slices are read from disk), and each file is extracted from a tiny archive of its own that is built on the fly:
//     marker + the main header + that file's header + its packed bytes + end block. Files of a non-solid archive are independent, so unRAR decodes them exactly as it
//     would in place. Memory use = one packed file + one unpacked file, whatever the archive's size.
//  2. "whole" mode (everything else: RAR 5, solid archives): the archive goes into memory once and unRAR lists / extracts it by name. Capped (WHOLE_LIMIT).
//
// Every extracted file's size and CRC-32 are checked against the header's (unRAR checks them too).
import { crc32 } from './zip.ts';
import type { ZipSource as ByteRange } from './zip.ts';

export interface RarEntry {
  /** the stored name with '/' separators */
  name: string;
  /** unpacked size */
  size: number;
  /** packed size */
  csize: number;
  dir: boolean;
  crc: number;
}
export interface RarArchive {
  readonly mode: 'blocks' | 'whole';
  readonly entries: RarEntry[];
  /** the file's bytes (size + CRC checked) */
  extract(e: RarEntry): Promise<Uint8Array>;
}

/** largest archive that is read into memory in "whole" mode */
export const WHOLE_LIMIT = 768 << 20;
const MARKER4 = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];
/** the end-of-archive block of a RAR 1.5 - 4.x archive: crc 0x3DC4, type 0x7B, flags 0x4000, size 7 */
const END4 = [0xc4, 0x3d, 0x7b, 0x00, 0x40, 0x07, 0x00];

export function isRarBytes(d: Uint8Array): boolean {
  return d.length >= 7 && d[0] === 0x52 && d[1] === 0x61 && d[2] === 0x72 && d[3] === 0x21 && d[4] === 0x1a && d[5] === 0x07;
}

// ------------------------------------------------------------------------------------------------------------------------ the WebAssembly library

let wasmUrl: string | null = null;
/** the browser build gives the URL of unrar.wasm (a Vite `?url` import); node finds it next to the library */
export function setUnrarWasmUrl(url: string) { wasmUrl = url; }

interface UnrarModule { HEAPU8: Uint8Array; extractor: unknown }
interface Listing { name: string; size: number; csize: number; dir: boolean; crc: number; solid: boolean; encrypted: boolean }
/** an extractor over one in-memory archive (the subclass below) */
interface OneArchive {
  listing(): Listing[];
  /** the files of the archive for which `want` is true (all when omitted), in archive order */
  run(want?: (name: string) => boolean): Map<string, Uint8Array>;
}
interface Lib { make(data: Uint8Array): Promise<OneArchive> }
let libPromise: Promise<Lib> | null = null;

/** loaded on first use (the library is not part of the start page's code) */
function lib(): Promise<Lib> {
  return (libPromise ??= (async (): Promise<Lib> => {
    const m = await import('node-unrar-js');
    let wasmBinary: ArrayBuffer | undefined;
    if (wasmUrl) {
      const r = await fetch(wasmUrl);
      if (!r.ok) throw new Error('Het RAR-onderdeel (unrar.wasm) kon niet worden geladen.');
      wasmBinary = await r.arrayBuffer();
    }
    type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
    /** collects the output of the file it is asked for; the archive is read from memory */
    class One extends (m.Extractor as Any) {
      _filePath = 'archive.rar';
      pos = 0;
      chunks: Uint8Array[] = [];
      outFd = 0;
      nextFd = 1;
      arcFd = 0;
      data: Uint8Array;
      constructor(unrar: UnrarModule, data: Uint8Array) { super(unrar); this.data = data; }
      open(filename: string): number { if (filename !== this._filePath) return 0; this.pos = 0; return (this.arcFd = this.nextFd++); }
      create(): number { return (this.outFd = this.nextFd++); }
      read(fd: number, buf: number, size: number): number {
        if (fd !== this.arcFd) return -1;
        const n = Math.max(0, Math.min(size, this.data.length - this.pos));
        if (n) this.unrar.HEAPU8.set(this.data.subarray(this.pos, this.pos + n), buf);
        this.pos += n;
        return n;
      }
      write(fd: number, buf: number, size: number): boolean {
        if (fd !== this.outFd) return false;
        this.chunks.push(this.unrar.HEAPU8.slice(buf, buf + size));
        return true;
      }
      tell(fd: number): number { return fd === this.arcFd ? this.pos : 0; }
      seek(fd: number, pos: number, method: 'CUR' | 'SET' | 'END'): boolean {
        if (fd !== this.arcFd) return fd === this.outFd;   // the output is only appended
        const p = method === 'SET' ? pos : method === 'CUR' ? this.pos + pos : this.data.length - pos;
        if (p < 0 || p > this.data.length) return false;
        this.pos = p;
        return true;
      }
      closeFile(): void { /* nothing to close */ }
      take(): Uint8Array {
        const total = this.chunks.reduce((n, c) => n + c.length, 0);
        const out = new Uint8Array(total);
        let at = 0;
        for (const c of this.chunks) { out.set(c, at); at += c.length; }
        this.chunks = [];
        return out;
      }
      listing(): Listing[] {
        const { fileHeaders } = this.getFileList();
        const out: Listing[] = [];
        for (const h of fileHeaders) out.push({ name: h.name.replace(/\\/g, '/'), size: h.unpSize, csize: h.packSize, dir: h.flags.directory, crc: h.crc >>> 0, solid: h.flags.solid, encrypted: h.flags.encrypted });
        return out;
      }
      run(want?: (name: string) => boolean): Map<string, Uint8Array> {
        const out = new Map<string, Uint8Array>();
        const { files } = this.extract(want ? { files: (h: { name: string }) => want(h.name.replace(/\\/g, '/')) } : {});
        for (const f of files) { const d = this.take(); if (!f.fileHeader.flags.directory) out.set(f.fileHeader.name.replace(/\\/g, '/'), d); }
        return out;
      }
    }
    return {
      async make(data) {
        // the library registers the extractor it creates as the one the WebAssembly calls back into; ours replaces it
        const base = (await m.createExtractorFromData({ wasmBinary, data: new ArrayBuffer(0) } as Any)) as Any;
        const mine = new One(base.unrar, data);
        base.unrar.extractor = mine;
        return mine as OneArchive;
      },
    };
  })().catch((e) => { libPromise = null; throw e; }));
}

async function oneArchive(data: Uint8Array): Promise<OneArchive> { return (await lib()).make(data); }

/** the WebAssembly side is one global state: extractions never overlap */
let busy: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const p = busy.then(fn, fn);
  busy = p.catch(() => { /* the next one goes on */ });
  return p;
}

const rarError = (e: unknown, name: string): Error => {
  const reason = (e as { reason?: string } | null)?.reason;
  const text = reason === 'ERAR_BAD_DATA' ? 'beschadigd (de gegevens kloppen niet)' : reason === 'ERAR_MISSING_PASSWORD' || reason === 'ERAR_BAD_PASSWORD' ? 'met een wachtwoord beveiligd (niet ondersteund)' : reason === 'ERAR_UNKNOWN_FORMAT' || reason === 'ERAR_BAD_ARCHIVE' ? 'geen geldig of ondersteund RAR-bestand' : reason ? `RAR-fout ${reason}` : e instanceof Error ? e.message : String(e);
  return new Error(`${name}: ${text}.`);
};

// ------------------------------------------------------------------------------------------------------------------------ RAR 1.5 - 4.x block walk

/** RAR's file name encoding (flag 0x200): the OEM name, a NUL, then the compressed wide name (unRAR `EncodeFileName::Decode`) */
function decodeRarName(raw: Uint8Array, unicode: boolean): string {
  const latin = (b: Uint8Array) => new TextDecoder('windows-1252').decode(b);
  if (!unicode) return latin(raw);
  const z = raw.indexOf(0);
  if (z < 0) return latin(raw);
  const name = raw.subarray(0, z), enc = raw.subarray(z + 1);
  if (!enc.length) return latin(name);
  const out: number[] = [];
  let p = 0;
  const high = enc[p++] << 8;
  let flags = 0, bits = 0;
  while (p < enc.length) {
    if (bits === 0) { flags = enc[p++]; bits = 8; }
    switch (flags >> 6) {
      case 0: out.push(enc[p++]); break;
      case 1: out.push(enc[p++] + high); break;
      case 2: out.push(enc[p] + (enc[p + 1] << 8)); p += 2; break;
      default: {
        let len = enc[p++];
        if (len & 0x80) {
          const corr = enc[p++];
          for (len = (len & 0x7f) + 2; len > 0; len--) out.push(((name[out.length] + corr) & 0xff) + high);
        } else for (len += 2; len > 0; len--) out.push(name[out.length]);
      }
    }
    flags = (flags << 2) & 0xff;
    bits -= 2;
  }
  return String.fromCharCode(...out);
}

interface Block4 extends RarEntry { head: Uint8Array; dataAt: number }
/** the blocks of a RAR 1.5 - 4.x archive, or null when the archive needs "whole" mode (solid / not this format) */
async function walkBlocks(src: ByteRange, name: string): Promise<{ main: Uint8Array; files: Block4[] } | null> {
  const first = await src.read(0, Math.min(src.size, 64));
  if (!MARKER4.every((b, i) => first[i] === b)) return null;
  let pos = 7;
  let main: Uint8Array | null = null;
  const files: Block4[] = [];
  while (pos + 7 <= src.size) {
    let h = await src.read(pos, Math.min(src.size, pos + 512));
    const flags = h[3] | (h[4] << 8), size = h[5] | (h[6] << 8), type = h[2];
    if (size < 7 || pos + size > src.size) throw new Error(`${name}: beschadigd RAR-bestand (kopblok op ${pos}).`);
    if (h.length < size) h = await src.read(pos, pos + size);
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    let add = (flags & 0x8000) && size >= 11 ? dv.getUint32(7, true) : 0;
    if (type === 0x73) {
      if (flags & 0x80) throw new Error(`${name}: de kopblokken zijn versleuteld (met een wachtwoord beveiligd), dat wordt niet ondersteund.`);
      if (flags & 0x0001) throw new Error(`${name}: dit is een deel van een meerdelig RAR-archief; dat wordt niet ondersteund.`);
      if (flags & 0x0008) return null;   // solid
      main = h.slice(0, size);
    } else if (type === 0x74) {
      const fl = flags;
      if (fl & 0x03) throw new Error(`${name}: dit is een deel van een meerdelig RAR-archief; dat wordt niet ondersteund.`);
      if (fl & 0x04) throw new Error(`${name}: met een wachtwoord beveiligd, dat wordt niet ondersteund.`);
      if (fl & 0x10) return null;   // solid chain
      const unp = dv.getUint32(11, true), nameLen = dv.getUint16(26, true), crc = dv.getUint32(16, true);
      let at = 32, hiPack = 0, hiUnp = 0;
      if (fl & 0x100) { hiPack = dv.getUint32(32, true); hiUnp = dv.getUint32(36, true); at = 40; }
      add += hiPack * 2 ** 32;
      const dir = (fl & 0xe0) === 0xe0;
      const fname = decodeRarName(h.subarray(at, at + nameLen), (fl & 0x200) !== 0).replace(/\\/g, '/');
      files.push({ name: fname, size: unp + hiUnp * 2 ** 32, csize: add, dir, crc, head: h.slice(0, size), dataAt: pos + size });
    } else if (type === 0x7b) break;
    pos += size + add;
  }
  if (!main) throw new Error(`${name}: geen geldig RAR-bestand (hoofdkop ontbreekt).`);
  return { main, files };
}

/** header CRC of a RAR 1.5 - 4.x block: the low 16 bits of the CRC-32 of everything after the CRC field */
function fixHeaderCrc(b: Uint8Array) { const c = crc32(b.subarray(2)) & 0xffff; b[0] = c & 0xff; b[1] = c >> 8; }

/**
 * Open a RAR archive from a random-access source. `name` is only for messages.
 * Throws a Dutch Error for things that cannot be read (damaged, password, several volumes, too large for "whole" mode).
 */
export async function openRar(src: ByteRange, name: string): Promise<RarArchive> {
  const blocks = await walkBlocks(src, name);
  if (blocks) {
    const main = blocks.main.slice();
    if (main.length === 13 && (main[3] & 0x02)) { main[3] &= ~0x02; fixHeaderCrc(main); }   // the comment lives in a block of its own: that block is left out
    const entries: RarEntry[] = blocks.files;
    const byEntry = new Map<RarEntry, Block4>(blocks.files.map((f) => [f, f]));
    return {
      mode: 'blocks',
      entries,
      async extract(e) {
        const b = byEntry.get(e);
        if (!b) throw new Error(`${name}: ${e.name}: onbekend bestand.`);
        if (e.dir) return new Uint8Array(0);
        const packed = await src.read(b.dataAt, b.dataAt + e.csize);
        if (packed.length !== e.csize) throw new Error(`${name}: ${e.name}: beschadigd (gegevens buiten het bestand).`);
        const mini = new Uint8Array(7 + main.length + b.head.length + packed.length + 7);
        let at = 0;
        for (const part of [MARKER4, main, b.head, packed, END4]) { mini.set(part, at); at += part.length; }
        const out = await exclusive(async () => {
          const a = await oneArchive(mini);
          try { return [...a.run().values()][0] ?? new Uint8Array(0); } catch (err) { throw rarError(err, `${name}: ${e.name}`); }
        });
        return verify(out, e, name);
      },
    };
  }
  // whole mode
  if (src.size > WHOLE_LIMIT) throw new Error(`${name}: dit RAR-bestand (RAR 5 of "solid") is te groot om in het geheugen te lezen (${Math.round(src.size / 2 ** 20)} MB, maximaal ${WHOLE_LIMIT >> 20} MB). Pak het eerst uit en kies de map.`);
  const data = await src.read(0, src.size);
  const listed = await exclusive(async () => {
    try { return (await oneArchive(data)).listing(); } catch (err) { throw rarError(err, name); }
  });
  if (listed.some((l) => l.encrypted)) throw new Error(`${name}: met een wachtwoord beveiligd, dat wordt niet ondersteund.`);
  const entries: RarEntry[] = listed.map((l) => ({ name: l.name, size: l.size, csize: l.csize, dir: l.dir, crc: l.crc }));
  return {
    mode: 'whole',
    entries,
    async extract(e) {
      if (e.dir) return new Uint8Array(0);
      const out = await exclusive(async () => {
        const a = await oneArchive(data);
        try { return [...a.run((n) => n === e.name).values()][0]; } catch (err) { throw rarError(err, `${name}: ${e.name}`); }
      });
      if (!out) throw new Error(`${name}: ${e.name}: niet gevonden in het archief.`);
      return verify(out, e, name);
    },
  };
}

function verify(out: Uint8Array, e: RarEntry, name: string): Uint8Array {
  if (out.length !== e.size) throw new Error(`${name}: ${e.name}: beschadigd (verkeerde lengte).`);
  if (crc32(out) !== e.crc >>> 0) throw new Error(`${name}: ${e.name}: beschadigd (controlesom klopt niet).`);
  return out;
}
