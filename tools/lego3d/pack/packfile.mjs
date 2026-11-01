// Writer of the LEGO 3D data pack (src/mods/lego3d/pack.ts): files = Map<name, Uint8Array|string>. Deterministic (sorted names, level 9).
import zlib from 'node:zlib';
import { PACK_VERSION } from '../../../src/mods/lego3d/pack.ts';

export function writePack(files, built = 'dev') {
  const names = [...files.keys()].sort();
  const blobs = [], index = { v: PACK_VERSION, built, files: {} };
  let off = 0;
  for (const n of names) {
    let raw = files.get(n);
    if (typeof raw === 'string') raw = new TextEncoder().encode(raw);
    const def = zlib.deflateRawSync(raw, { level: 9 });
    const stored = def.length < raw.length;
    const b = stored ? def : raw;
    index.files[n] = [off, b.length, raw.length, stored ? 8 : 0];
    blobs.push(Buffer.from(b.buffer, b.byteOffset, b.length));
    off += b.length;
  }
  const ij = Buffer.from(JSON.stringify(index));
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x5033474c, 0); head.writeUInt32LE(PACK_VERSION, 4); head.writeUInt32LE(ij.length, 8);
  return new Uint8Array(Buffer.concat([head, ij, ...blobs]));
}
