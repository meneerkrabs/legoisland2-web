// Read-only ISO9660 reader over a Blob (File, OPFS file, ...); reads lazily via slice(), so a 450 MB ISO is never loaded.
// Prefers the Joliet tree (mixed-case long names like "LEGO Eiland 2/data1.cab"), falls back to the plain ISO9660 names
// (upper case, 8.3, ";1" removed) when the disc has no Joliet volume descriptor.

import { sliceSource, toSource, type ByteSource } from './bytesource.ts';

const SECTOR = 2048;

export interface IsoEntry {
  /** Path as stored on the disc ("LEGO Eiland 2/data1.cab"). */
  path: string;
  lba: number;
  size: number;
}

export class IsoVfs {
  private map = new Map<string, IsoEntry>();
  private src: ByteSource;
  private blob: Blob | null;
  readonly volumeId: string;
  readonly joliet: boolean;

  private constructor(blob: Blob | null, src: ByteSource, volumeId: string, joliet: boolean) {
    this.blob = blob;
    this.src = src;
    this.volumeId = volumeId;
    this.joliet = joliet;
  }

  /** `iso`: a Blob (File, OPFS file) or any ByteSource (e.g. HTTP range requests). */
  static async open(input: Blob | ByteSource): Promise<IsoVfs> {
    const src = toSource(input);
    const read = async (lba: number, len: number) => {
      const b = await src.read(lba * SECTOR, lba * SECTOR + len);
      return new DataView(b.buffer, b.byteOffset, b.byteLength);
    };
    // volume descriptors start at sector 16: type 1 = primary, 2 = supplementary (Joliet: escape sequence %/@ %/C %/E)
    let primary: DataView | null = null;
    let joliet: DataView | null = null;
    for (let s = 16; s < 32; s++) {
      const d = await read(s, SECTOR);
      if (d.byteLength < SECTOR) break;
      const type = d.getUint8(0);
      const magic = String.fromCharCode(...new Uint8Array(d.buffer, 1, 5));
      if (magic !== 'CD001') break;
      if (type === 255) break;
      if (type === 1 && !primary) primary = d;
      if (type === 2 && d.getUint8(88) === 0x25 && d.getUint8(89) === 0x2f && [0x40, 0x43, 0x45].includes(d.getUint8(90))) joliet = d;
    }
    if (!primary) throw new Error('Dit is geen geldig ISO-bestand (ISO9660).');
    const use = joliet ?? primary;
    const decode = joliet
      ? (b: Uint8Array) => {
        let s = '';
        for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
        return s;
      }
      : (b: Uint8Array) => String.fromCharCode(...b);
    const volumeId = decode(new Uint8Array(use.buffer, 40, 32)).trim();
    const iso = new IsoVfs(input instanceof Blob ? input : null, src, volumeId, !!joliet);
    const walk = async (lba: number, size: number, prefix: string) => {
      const dir = await read(lba, size);
      let off = 0;
      while (off < size) {
        const len = dir.getUint8(off);
        if (len === 0) {
          off = (Math.floor(off / SECTOR) + 1) * SECTOR;
          continue;
        }
        const extent = dir.getUint32(off + 2, true);
        const dataLen = dir.getUint32(off + 10, true);
        const flags = dir.getUint8(off + 25);
        const nameLen = dir.getUint8(off + 32);
        const rawBytes = new Uint8Array(dir.buffer, off + 33, nameLen);
        off += len;
        if (nameLen === 1 && (rawBytes[0] === 0 || rawBytes[0] === 1)) continue; // "." and ".."
        let name = decode(rawBytes);
        if (!(flags & 2)) name = name.replace(/;\d+$/, '');
        if (!joliet) name = name.replace(/\.$/, '');
        const path = prefix ? `${prefix}/${name}` : name;
        if (flags & 2) await walk(extent, dataLen, path);
        else iso.map.set(path.toLowerCase(), { path, lba: extent, size: dataLen });
      }
    };
    await walk(use.getUint32(156 + 2, true), use.getUint32(156 + 10, true), '');
    if (!iso.map.size) throw new Error('Deze ISO bevat geen bestanden.');
    return iso;
  }

  /** All file paths as stored on the disc. */
  list(): string[] {
    return [...this.map.values()].map((e) => e.path);
  }

  /** Case-insensitive lookup. */
  stat(path: string): IsoEntry | undefined {
    return this.map.get(path.replace(/\\/g, '/').toLowerCase());
  }

  /** A file as random-access bytes (a window of the ISO). */
  source(path: string): ByteSource {
    const e = this.stat(path);
    if (!e) throw new Error(`niet gevonden in de ISO: ${path}`);
    return sliceSource(this.src, e.lba * SECTOR, e.size);
  }

  /** A file as a lazily read Blob (only when the ISO was opened from a Blob). */
  file(path: string): Blob {
    const e = this.stat(path);
    if (!e) throw new Error(`niet gevonden in de ISO: ${path}`);
    if (!this.blob) throw new Error('IsoVfs.file: de ISO is geen Blob; gebruik source()');
    return this.blob.slice(e.lba * SECTOR, e.lba * SECTOR + e.size);
  }
}
