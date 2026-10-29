// A minimal zip writer for tests and test-pack generators (node only): stored or deflate members, optional zip64 records, large members from async generators.
import fs from 'node:fs';
import zlib from 'node:zlib';

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

/** write a zip to `file`; `add(name, data|{size, chunks: AsyncIterable<Buffer>}, 'store'|'deflate')`, then `finish()` */
export class ZipFileWriter {
  constructor(file, { zip64 = false } = {}) {
    this.fd = fs.openSync(file, 'w');
    this.pos = 0;
    this.entries = [];
    this.zip64 = zip64;
  }
  write(buf) { fs.writeSync(this.fd, buf); this.pos += buf.length; }
  async add(name, data, method = 'store') {
    const nameBuf = Buffer.from(name, 'utf8');
    const offset = this.pos;
    let crc = 0, size = 0, csize = 0;
    const big = !Buffer.isBuffer(data) && !(data instanceof Uint8Array);
    if (!big) {
      const buf = Buffer.from(data);
      crc = zlib.crc32(buf); size = buf.length;
      const body = method === 'deflate' ? zlib.deflateRawSync(buf) : buf;
      csize = body.length;
      this.header(nameBuf, method, crc, csize, size, true);
      this.write(body);
    } else {
      // stored, size known up front, CRC patched into the header afterwards
      size = csize = data.size;
      const headerAt = this.pos;
      this.header(nameBuf, 'store', 0, csize, size, true);
      for await (const c of data.chunks) { crc = zlib.crc32(c, crc); this.write(c); }
      const keep = this.pos;
      const crcAt = headerAt + 14;
      fs.writeSync(this.fd, u32(crc), 0, 4, crcAt);
      this.pos = keep;
    }
    this.entries.push({ nameBuf, method, crc, csize, size, offset });
  }
  header(nameBuf, method, crc, csize, size, local) {
    const z64 = this.zip64 || csize > 0xfffffffe || size > 0xfffffffe;
    const extra = z64 ? Buffer.concat([u16(1), u16(16), u64(size), u64(csize)]) : Buffer.alloc(0);
    this.write(Buffer.concat([u32(0x04034b50), u16(z64 ? 45 : 20), u16(0x800), u16(method === 'deflate' ? 8 : 0), u16(0), u16(0x21), u32(crc),
      u32(z64 ? 0xffffffff : csize), u32(z64 ? 0xffffffff : size), u16(nameBuf.length), u16(extra.length), nameBuf, extra]));
  }
  finish() {
    const cdAt = this.pos;
    let force64 = this.zip64;
    for (const e of this.entries) {
      const z64 = this.zip64 || e.csize > 0xfffffffe || e.size > 0xfffffffe || e.offset > 0xfffffffe;
      force64 ||= z64;
      const fields = [];
      if (z64) fields.push(u64(e.size), u64(e.csize), u64(e.offset));
      const extra = z64 ? Buffer.concat([u16(1), u16(fields.length * 8), ...fields]) : Buffer.alloc(0);
      this.write(Buffer.concat([u32(0x02014b50), u16(45), u16(z64 ? 45 : 20), u16(0x800), u16(e.method === 'deflate' ? 8 : 0), u16(0), u16(0x21), u32(e.crc),
        u32(z64 ? 0xffffffff : e.csize), u32(z64 ? 0xffffffff : e.size), u16(e.nameBuf.length), u16(extra.length), u16(0), u16(0), u16(0), u32(0),
        u32(z64 ? 0xffffffff : e.offset), e.nameBuf, extra]));
    }
    const cdSize = this.pos - cdAt, n = this.entries.length;
    if (force64) {
      const at = this.pos;
      this.write(Buffer.concat([u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(n), u64(n), u64(cdSize), u64(cdAt)]));
      this.write(Buffer.concat([u32(0x07064b50), u32(0), u64(at), u32(1)]));
    }
    this.write(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(force64 ? 0xffff : n), u16(force64 ? 0xffff : n), u32(force64 ? 0xffffffff : cdSize), u32(force64 ? 0xffffffff : cdAt), u16(0)]));
    fs.closeSync(this.fd);
  }
}

/** a zip in memory (small tests) */
export async function buildZip(entries, opts = {}) {
  const tmp = `${process.env.TMPDIR ?? '/tmp'}/le2-zip-${process.pid}-${Math.random().toString(36).slice(2)}.zip`;
  const w = new ZipFileWriter(tmp, opts);
  for (const e of entries) await w.add(e.name, e.data, e.method);
  w.finish();
  const out = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return new Uint8Array(out.buffer, out.byteOffset, out.length);
}
