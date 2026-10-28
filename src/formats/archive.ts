// .bod (directory) + .bob (blob) archive pair.
// .bod layout: [names: NUL-terminated strings][records: 16 bytes each][trailer: 16 bytes]
//   trailer = u32 namesLen, u32 recordCount, u32 0, u32 namesLen
//   record  = 4-char tag + 3 x u32:  "DIRY" count, firstChildRecord, nameOffset
//                                    "FILE" size, offsetInBob, nameOffset
// .bob: every member is preceded by the 4 bytes "FILE"; the record offset points past it.
// Pure: takes the raw bytes, no DOM / fs.

export interface ArchiveEntry {
  /** path inside the archive without the leading "_data/<archive>" folder, '/' separated, e.g. "meshes/Sea.Msh" */
  path: string;
  /** full path including the archive's folder name, e.g. "_data/z02LGI/meshes/Sea.Msh" */
  fullPath: string;
  size: number;
  offset: number;
}

export class Archive {
  readonly root: string;
  readonly entries: ArchiveEntry[] = [];
  private byLower = new Map<string, ArchiveEntry>();
  private names: Uint8Array;
  private records: { tag: string; a: number; b: number; c: number }[] = [];

  readonly name: string;
  readonly bob: Uint8Array;

  constructor(name: string, bod: Uint8Array, bob: Uint8Array) {
    this.name = name;
    this.bob = bob;
    const dv = new DataView(bod.buffer, bod.byteOffset, bod.byteLength);
    const tail = bod.length - 16;
    const namesLen = dv.getUint32(tail, true);
    const count = dv.getUint32(tail + 4, true);
    if (dv.getUint32(tail + 8, true) !== 0 || dv.getUint32(tail + 12, true) !== namesLen) throw new Error(`${name}: bad .bod trailer`);
    if (namesLen + count * 16 + 16 !== bod.length) throw new Error(`${name}: .bod size mismatch`);
    this.names = bod.subarray(0, namesLen);
    for (let i = 0; i < count; i++) {
      const p = namesLen + i * 16;
      const tag = String.fromCharCode(bod[p], bod[p + 1], bod[p + 2], bod[p + 3]);
      if (tag !== 'DIRY' && tag !== 'FILE') throw new Error(`${name}: unknown record tag ${tag}`);
      this.records.push({ tag, a: dv.getUint32(p + 4, true), b: dv.getUint32(p + 8, true), c: dv.getUint32(p + 12, true) });
    }
    this.root = this.nameAt(this.records[0].c);
    this.walk(0, '', this.root);
    for (const e of this.entries) this.byLower.set(e.path.toLowerCase(), e);
  }

  private nameAt(off: number): string {
    let end = off;
    while (this.names[end] !== 0) end++;
    let s = '';
    for (let i = off; i < end; i++) s += String.fromCharCode(this.names[i]);
    return s;
  }

  private walk(idx: number, rel: string, full: string) {
    const r = this.records[idx];
    if (r.tag !== 'DIRY') throw new Error(`${this.name}: record ${idx} is not a directory`);
    for (let i = r.b; i < r.b + r.a; i++) {
      const c = this.records[i];
      if (c.tag === 'DIRY') {
        const n = this.nameAt(c.c);
        this.walk(i, rel ? `${rel}/${n}` : n, `${full}/${n}`);
      } else {
        const n = this.nameAt(c.c);
        this.entries.push({ path: rel ? `${rel}/${n}` : n, fullPath: `${full}/${n}`, size: c.a, offset: c.b });
      }
    }
  }

  has(path: string) { return this.byLower.has(path.toLowerCase()); }
  find(path: string) { return this.byLower.get(path.toLowerCase()); }

  /** Case-insensitive; returns a view into the blob (no copy). */
  read(entry: ArchiveEntry | string): Uint8Array {
    const e = typeof entry === 'string' ? this.find(entry) : entry;
    if (!e) throw new Error(`${this.name}: no such member ${entry}`);
    return this.bob.subarray(e.offset, e.offset + e.size);
  }

  /** Check the "FILE" marker before each member (integrity). */
  markerOk(e: ArchiveEntry): boolean {
    const o = e.offset - 4;
    return o >= 0 && this.bob[o] === 0x46 && this.bob[o + 1] === 0x49 && this.bob[o + 2] === 0x4c && this.bob[o + 3] === 0x45;
  }
}
