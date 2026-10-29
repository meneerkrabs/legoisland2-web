// Reading single files out of a raw CD image (.BIN, 2352-byte sectors) through a byte-range reader, without downloading the disc: the sectors of the ISO 9660
// directories on the way and the sectors of the wanted file. Used by the catalogue's "IXS-look" mod (the Island Xtreme Stunts disc on archive.org).
//   sector = 12 sync bytes + 4 header bytes (byte 15 = mode) + [MODE 2: 8 sub-header bytes] + 2048 user data + error correction;
//   MODE 1: user data at offset 16, MODE 2 / XA form 1: at offset 24.
// ISO 9660: the primary volume descriptor in sector 16 holds the root directory record (at +156); a directory is a run of records (length byte, extent LBA at +2,
// size at +10, flags at +25, name length at +32, name at +33 with `;1` version suffix), records never straddle a sector (a zero length byte skips to the next one).

export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

const RAW = 2352;
const SYNC = [0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0];

export class RawDisc {
  private read: RangeReader;
  /** sectors read so far (the directories are asked for repeatedly) */
  private cache = new Map<number, Uint8Array>();
  /** requests made and bytes asked for (for the progress text and the tests) */
  requests = 0;
  bytes = 0;
  constructor(read: RangeReader) { this.read = read; }

  /** user data of `count` sectors starting at `lba`, in one request */
  async sectors(lba: number, count: number): Promise<Uint8Array> {
    const out = new Uint8Array(count * 2048);
    const need: number[] = [];
    for (let i = 0; i < count; i++) if (!this.cache.has(lba + i)) need.push(lba + i);
    if (need.length) {
      const first = need[0], last = need[need.length - 1];
      this.requests++;
      this.bytes += (last - first + 1) * RAW;
      const raw = await this.read(first * RAW, (last + 1) * RAW);
      if (raw.length < (last - first + 1) * RAW) throw new Error('Het schijfbeeld van IXS is korter dan verwacht (of de bron gaf te weinig bytes).');
      for (let s = first; s <= last; s++) {
        const o = (s - first) * RAW;
        if (!SYNC.every((b, k) => raw[o + k] === b)) throw new Error('Het schijfbeeld van IXS heeft geen sectoren van 2352 bytes (verkeerd bestand?).');
        const mode = raw[o + 15];
        const off = mode === 2 ? 24 : mode === 1 ? 16 : -1;
        if (off < 0) throw new Error(`Onbekende sectormodus ${mode} op het schijfbeeld van IXS.`);
        this.cache.set(s, raw.slice(o + off, o + off + 2048));
      }
    }
    for (let i = 0; i < count; i++) out.set(this.cache.get(lba + i)!, i * 2048);
    return out;
  }

  private async dir(lba: number, size: number): Promise<{ name: string; lba: number; size: number; dir: boolean }[]> {
    const d = await this.sectors(lba, Math.ceil(size / 2048));
    const out: { name: string; lba: number; size: number; dir: boolean }[] = [];
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    for (let i = 0; i < size;) {
      const len = d[i];
      if (len === 0) { i = (Math.floor(i / 2048) + 1) * 2048; continue; }
      const nl = d[i + 32];
      const name = new TextDecoder('latin1').decode(d.subarray(i + 33, i + 33 + nl)).split(';')[0];
      if (!(nl === 1 && (d[i + 33] === 0 || d[i + 33] === 1))) out.push({ name, lba: dv.getUint32(i + 2, true), size: dv.getUint32(i + 10, true), dir: (d[i + 25] & 2) !== 0 });
      i += len;
    }
    return out;
  }

  /** where a file is (path with '/' separators, case-insensitive), or null */
  async find(path: string): Promise<{ lba: number; size: number } | null> {
    const pvd = await this.sectors(16, 1);
    if (String.fromCharCode(...pvd.subarray(1, 6)) !== 'CD001') throw new Error('Het schijfbeeld van IXS is geen ISO 9660-schijf.');
    const dv = new DataView(pvd.buffer, pvd.byteOffset, pvd.byteLength);
    let cur = { lba: dv.getUint32(156 + 2, true), size: dv.getUint32(156 + 10, true) };
    const parts = path.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const hit = (await this.dir(cur.lba, cur.size)).find((e) => e.name.toUpperCase() === parts[i].toUpperCase() && e.dir === (i < parts.length - 1));
      if (!hit) return null;
      cur = hit;
    }
    return cur;
  }

  /** the file's bytes; with `expectSize` a different size is an error (the disc is not the one the recipe was made for) */
  async file(path: string, expectSize?: number): Promise<Uint8Array> {
    const f = await this.find(path);
    if (!f) throw new Error(`${path} staat niet op het IXS-schijfbeeld.`);
    if (expectSize !== undefined && f.size !== expectSize) throw new Error(`${path} heeft ${f.size} bytes in plaats van ${expectSize}: dit is niet de IXS-schijf waarvoor de mod is gemaakt.`);
    return (await this.sectors(f.lba, Math.ceil(f.size / 2048))).slice(0, f.size);
  }
}
