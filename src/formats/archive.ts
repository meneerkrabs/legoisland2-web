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
  /** set by `Archive.override`: the member's bytes come from a loose file (a mod) instead of the blob (`offset` is then -1 for added members, stale for replaced ones) */
  data?: Uint8Array;
  /** the size in the blob, kept while `data` replaces it (`Archive.clearOverrides` puts it back) */
  baseSize?: number;
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

  /** progress callback of the loaders (the shell's loading card, src/shell/loading.ts: the original's FUN_00443c70 = present of the card at every loaded object), called with the member path; null = none */
  static onRead: ((path: string) => void) | null = null;

  /** Case-insensitive; returns a view into the blob (no copy). */
  read(entry: ArchiveEntry | string): Uint8Array {
    const e = typeof entry === 'string' ? this.find(entry) : entry;
    Archive.onRead?.(e ? e.path : String(entry));
    if (!e) throw new Error(`${this.name}: no such member ${entry}`);
    return e.data ?? this.bob.subarray(e.offset, e.offset + e.size);
  }

  /**
   * A loose file takes the place of a member (docs/re/mods.md: the original opens a real file first and only falls back to the archive, FUN_004348ff). `path` is
   * relative to the archive's root, case-insensitive ('/' or '\'); a path that is not a member adds one. Returns true when it replaced an existing member.
   */
  override(path: string, data: Uint8Array): boolean {
    const rel = path.replace(/\\/g, '/').replace(/^\/+/, '');
    const key = rel.toLowerCase();
    const e = this.byLower.get(key);
    if (e) { e.baseSize ??= e.size; e.data = data; e.size = data.length; return true; }
    const added: ArchiveEntry = { path: rel, fullPath: `${this.root}/${rel}`, size: data.length, offset: -1, data };
    this.entries.push(added);
    this.byLower.set(key, added);
    return false;
  }

  /**
   * True when the member `e` was replaced by a loose file (a mod) AND that picture is larger than the one in the blob (an HD texture pack): the renderers then add mip
   * maps for it, because minifying a 4x texture without them shimmers. `w` x `h` = the new picture's size; the old one's is read from the TGA / WIB header in the blob.
   * Textures the game ships itself are never treated this way (the original look path stays as it is).
   */
  isUpscaled(e: ArchiveEntry, w: number, h: number): boolean {
    if (!e.data || e.offset < 0) return false;
    const o = this.bob.subarray(e.offset, e.offset + 64);
    let ow = 0, oh = 0;
    if (o[0] === 0x57 && o[1] === 0x49 && o[2] === 0x42 && o[3] === 0x46) { // 'WIBF' n seq[n] 'WIBT' w h
      const n = o[4] | (o[5] << 8) | (o[6] << 16);
      const at = 12 + 4 * n;
      const b = this.bob.subarray(e.offset + at, e.offset + at + 8);
      ow = b[0] | (b[1] << 8) | (b[2] << 16); oh = b[4] | (b[5] << 8) | (b[6] << 16);
    } else { ow = o[12] | (o[13] << 8); oh = o[14] | (o[15] << 8); }
    return ow > 0 && oh > 0 && w * h > ow * oh;
  }

  /** undo every `override`: replaced members read from the blob again, added members are gone (a zone's mod files are let go of when the zone ends) */
  clearOverrides() {
    for (const e of this.entries) if (e.data && e.offset >= 0) { e.data = undefined; e.size = e.baseSize ?? e.size; e.baseSize = undefined; }
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.data && e.offset < 0) { this.entries.splice(i, 1); this.byLower.delete(e.path.toLowerCase()); }
    }
  }

  /** Check the "FILE" marker before each member (integrity). */
  markerOk(e: ArchiveEntry): boolean {
    const o = e.offset - 4;
    return o >= 0 && this.bob[o] === 0x46 && this.bob[o + 1] === 0x49 && this.bob[o + 2] === 0x4c && this.bob[o + 3] === 0x45;
  }
}
