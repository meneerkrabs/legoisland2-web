// A .zip reader that never needs the whole file in memory: it reads the central directory (zip64 included) through a `ZipSource` (a Blob / File: slices are read
// from disk on demand) and hands out each member as a decompressed stream (`DecompressionStream('deflate-raw')`) that checks size and CRC at its end. Stored and
// deflate members, no encryption. Pure apart from the Web Streams API, which browsers and node both have.
import { inflateRaw } from '../engine/inflate.ts';

export interface ZipSource {
  readonly size: number;
  /** bytes [start, end) */
  read(start: number, end: number): Promise<Uint8Array>;
  /** the same range as a stream (default: chunked `read`s) */
  stream?(start: number, end: number): ReadableStream<Uint8Array>;
}

export const zipBlob = (b: Blob): ZipSource => ({
  size: b.size,
  async read(s, e) { return new Uint8Array(await b.slice(s, e).arrayBuffer()); },
  stream(s, e) { return b.slice(s, e).stream() as ReadableStream<Uint8Array>; },
});
export const zipBytes = (d: Uint8Array): ZipSource => ({ size: d.length, async read(s, e) { return d.subarray(s, e); } });

export interface ZipEntry {
  /** the stored name with '/' separators (directories end with '/') */
  name: string;
  /** uncompressed size */
  size: number;
  /** compressed size */
  csize: number;
  dir: boolean;
  method: number;
  crc: number;
  flags: number;
  /** offset of the local header */
  offset: number;
}

export const ZIP_LIMITS = { entries: 200000, entryBytes: 8 * 2 ** 30 };

let crcTable: Uint32Array | null = null;
function table() {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  return crcTable;
}
/** running CRC-32: `crc32Update(crc32Update(0, a), b) === crc32(a + b)` */
export function crc32Update(crc: number, data: Uint8Array): number {
  const t = table();
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
export const crc32 = (data: Uint8Array) => crc32Update(0, data);

function decodeName(raw: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder().decode(raw);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { return new TextDecoder('latin1').decode(raw); } // old tools write the OEM code page
}

export function isZipBytes(data: Uint8Array): boolean {
  return data.length >= 22 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 3 || data[2] === 5);
}

const big = (dv: DataView, o: number) => Number(dv.getBigUint64(o, true));

/** the entries of a zip file, in the order of its central directory */
export async function listZip(src: ZipSource): Promise<ZipEntry[]> {
  if (src.size < 22) throw new Error('Geen geldig zip-bestand (te klein).');
  const tailLen = Math.min(src.size, 22 + 65535 + 20);
  const tail = await src.read(src.size - tailLen, src.size);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Geen geldig zip-bestand (einde van de inhoudsopgave niet gevonden).');
  let count = tv.getUint16(eocd + 10, true), cdSize = tv.getUint32(eocd + 12, true), cdOff = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    // zip64: the locator sits right before the end record and points at the zip64 end record
    if (eocd < 20 || tv.getUint32(eocd - 20, true) !== 0x07064b50) throw new Error('Beschadigd zip64-bestand (locator ontbreekt).');
    const at = big(tv, eocd - 20 + 8);
    const rec = await src.read(at, at + 56);
    const rv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    if (rec.length < 56 || rv.getUint32(0, true) !== 0x06064b50) throw new Error('Beschadigd zip64-bestand (eindrecord).');
    count = big(rv, 32); cdSize = big(rv, 40); cdOff = big(rv, 48);
  }
  if (count > ZIP_LIMITS.entries) throw new Error(`Te veel bestanden in de zip (${count}).`);
  if (cdOff + cdSize > src.size) throw new Error('Beschadigd zip-bestand (inhoudsopgave buiten het bestand).');
  const cd = await src.read(cdOff, cdOff + cdSize);
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const out: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('Beschadigd zip-bestand (inhoudsopgave).');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
    let csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true), offset = dv.getUint32(p + 42, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const name = decodeName(cd.subarray(p + 46, p + 46 + nlen), (flags & 0x800) !== 0).replace(/\\/g, '/');
    // zip64 extra field (id 1): the 64-bit values of the fields that did not fit, in this order
    for (let x = p + 46 + nlen, xe = x + elen; x + 4 <= xe;) {
      const id = dv.getUint16(x, true), len = dv.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (size === 0xffffffff) { size = big(dv, q); q += 8; }
        if (csize === 0xffffffff) { csize = big(dv, q); q += 8; }
        if (offset === 0xffffffff) { offset = big(dv, q); q += 8; }
      }
      x += 4 + len;
    }
    p += 46 + nlen + elen + clen;
    if (size > ZIP_LIMITS.entryBytes) throw new Error(`${name}: te groot (${size} bytes).`);
    out.push({ name, size, csize, dir: name.endsWith('/'), method, crc, flags, offset });
  }
  return out;
}

async function dataStart(src: ZipSource, e: ZipEntry): Promise<number> {
  const h = await src.read(e.offset, e.offset + 30);
  const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
  if (h.length < 30 || hv.getUint32(0, true) !== 0x04034b50) throw new Error(`${e.name}: beschadigd (lokale kop).`);
  const start = e.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  if (start + e.csize > src.size) throw new Error(`${e.name}: beschadigd (gegevens buiten het bestand).`);
  return start;
}

function rangeStream(src: ZipSource, start: number, end: number): ReadableStream<Uint8Array> {
  if (src.stream) return src.stream(start, end);
  let pos = start;
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      if (pos >= end) { ctl.close(); return; }
      const to = Math.min(end, pos + (4 << 20));
      ctl.enqueue(await src.read(pos, to));
      pos = to;
    },
  });
}

/** passes the bytes through, counts them and checks size + CRC when the stream ends (throws then, which fails the pipe) */
function verifier(e: ZipEntry): TransformStream<Uint8Array, Uint8Array> {
  let crc = 0, n = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) { crc = crc32Update(crc, chunk); n += chunk.length; ctl.enqueue(chunk); },
    flush() {
      if (n !== e.size) throw new Error(`${e.name}: beschadigd (verkeerde lengte).`);
      if (crc !== e.crc) throw new Error(`${e.name}: beschadigd (controlesom klopt niet).`);
    },
  });
}

/** the member's decompressed bytes as a stream, verified at its end */
export async function entryStream(src: ZipSource, e: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  if (e.dir) return new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
  if (e.flags & 1) throw new Error(`${e.name}: versleutelde bestanden worden niet ondersteund.`);
  const start = await dataStart(src, e);
  const raw = rangeStream(src, start, start + e.csize);
  if (e.method === 0) return raw.pipeThrough(verifier(e));
  if (e.method === 8) {
    if (typeof DecompressionStream === 'undefined') {
      // no native inflate: fine for small members, which are read whole
      if (e.size > (256 << 20)) throw new Error(`${e.name}: deze browser kan zulke grote gecomprimeerde bestanden niet uitpakken (DecompressionStream ontbreekt).`);
      const bytes = await src.read(start, start + e.csize);
      const out = new Uint8Array(e.size);
      inflateRaw(bytes, 0, bytes.length, out, 0);
      return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(out); c.close(); } }).pipeThrough(verifier(e));
    }
    return raw.pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>).pipeThrough(verifier(e));
  }
  throw new Error(`${e.name}: compressiemethode ${e.method} wordt niet ondersteund.`);
}

/** the member's bytes in memory (for small files: info.txt, patch.txt, test data) */
export async function readEntry(src: ZipSource, e: ZipEntry): Promise<Uint8Array> {
  const out = new Uint8Array(e.size);
  let at = 0;
  const reader = (await entryStream(src, e)).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > out.length) throw new Error(`${e.name}: beschadigd (te veel gegevens).`);
    out.set(value, at); at += value.length;
  }
  return out;
}
