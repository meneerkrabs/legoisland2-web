// Where imported mods are kept: OPFS directory `le2-mods/<id>/` with the mod's files (`f000001` ...) and `mod.json` (written LAST, so an import that was cut off
// leaves a directory without it, which is cleaned up and never shows up as a mod). Files are streamed in, so a multi-gigabyte pack never sits in memory.
// A mod applies at the next start of the game when it is enabled; where two mods replace the same file the later one in the list wins.
// `MemoryModStore` is the same interface in memory (node tests; the fallback for browsers without OPFS: the mods then last for this session only).
import type { PatchLine } from './package.ts';

export interface StoredPatch { offset: number; bytes: string; original?: string; line: number }
/** where a mod came from, when it was not picked by the user: the catalogue (credits are shown in the list) */
export interface ModOrigin {
  catalog: string;
  /** the original thread (or page) of the mod */
  url: string;
  /** shown as "Uit de catalogus: <label>" */
  label: string;
}
export interface ModFileRef { path: string; size: number; key: string }
export interface InstalledMod {
  id: string;
  /** list order: a later mod wins where two replace the same file */
  seq: number;
  enabled: boolean;
  title: string;
  author: string;
  description: string;
  /** the file the user picked, and the mod folder inside it */
  source: string;
  folder: string;
  addedAt: number;
  files: ModFileRef[];
  patches: StoredPatch[];
  warnings: string[];
  origin?: ModOrigin;
}
export type ModMeta = Omit<InstalledMod, 'id' | 'seq' | 'enabled' | 'addedAt' | 'files'>;

export interface ModWriter {
  readonly id: string;
  /** store one file of the mod from a stream that delivers exactly `size` bytes */
  addFile(path: string, size: number, data: ReadableStream<Uint8Array>): Promise<void>;
  /** make the mod visible (last step) */
  commit(meta: ModMeta): Promise<InstalledMod>;
  /** throw away what was written */
  abort(): Promise<void>;
}
export interface ModStore {
  /** false: the store is in memory only (no OPFS) */
  readonly persistent: boolean;
  list(): Promise<InstalledMod[]>;
  begin(): Promise<ModWriter>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** swap places with the neighbour in the list (-1 = earlier = loses against the one after it) */
  move(id: string, delta: -1 | 1): Promise<void>;
  remove(id: string): Promise<void>;
  readFile(id: string, key: string): Promise<Uint8Array>;
}

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
export const storePatches = (p: readonly PatchLine[]): StoredPatch[] => p.map((x) => ({ offset: x.offset, bytes: toHex(x.bytes), original: x.original ? toHex(x.original) : undefined, line: x.line }));
export const loadPatches = (p: readonly StoredPatch[]): PatchLine[] => p.map((x) => ({ offset: x.offset, bytes: fromHex(x.bytes), original: x.original ? fromHex(x.original) : undefined, line: x.line }));

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.randomUUID ? c.randomUUID() : `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
const keyOf = (n: number) => `f${String(n).padStart(6, '0')}`;

/** count the bytes of a stream; the result promise rejects when the count is not `size` */
async function drain(data: ReadableStream<Uint8Array>, size: number, sink: (chunk: Uint8Array) => Promise<void> | void): Promise<void> {
  const r = data.getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    await sink(value);
  }
  if (n !== size) throw new Error(`Verkeerde lengte: ${n} in plaats van ${size} bytes.`);
}

function finish(id: string, seq: number, meta: ModMeta, files: ModFileRef[]): InstalledMod {
  return { ...meta, id, seq, enabled: true, addedAt: Date.now(), files };
}

// ------------------------------------------------------------------------------------------------------------------------ memory

export class MemoryModStore implements ModStore {
  readonly persistent = false;
  private mods = new Map<string, InstalledMod>();
  private blobs = new Map<string, Uint8Array>();
  private seq = 0;
  async list() { return [...this.mods.values()].sort((a, b) => a.seq - b.seq); }
  async begin(): Promise<ModWriter> {
    const id = newId();
    const files: ModFileRef[] = [];
    const mine: string[] = [];
    return {
      id,
      addFile: async (path, size, data) => {
        const buf = new Uint8Array(size);
        let at = 0;
        await drain(data, size, (c) => { if (at + c.length > size) throw new Error('Te veel gegevens.'); buf.set(c, at); at += c.length; });
        const key = keyOf(files.length + 1);
        files.push({ path, size, key });
        this.blobs.set(`${id}/${key}`, buf);
        mine.push(`${id}/${key}`);
      },
      commit: async (meta) => { const m = finish(id, ++this.seq, meta, files); this.mods.set(id, m); return m; },
      abort: async () => { for (const k of mine) this.blobs.delete(k); },
    };
  }
  async setEnabled(id: string, enabled: boolean) { const m = this.mods.get(id); if (m) m.enabled = enabled; }
  async move(id: string, delta: -1 | 1) {
    const l = await this.list(), i = l.findIndex((m) => m.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= l.length) return;
    [l[i].seq, l[j].seq] = [l[j].seq, l[i].seq];
  }
  async remove(id: string) {
    const m = this.mods.get(id);
    if (m) for (const f of m.files) this.blobs.delete(`${id}/${f.key}`);
    this.mods.delete(id);
  }
  async readFile(id: string, key: string) {
    const b = this.blobs.get(`${id}/${key}`);
    if (!b) throw new Error('Modbestand niet gevonden.');
    return b;
  }
}

// ------------------------------------------------------------------------------------------------------------------------ OPFS

const ROOT = 'le2-mods';

export class OpfsModStore implements ModStore {
  readonly persistent = true;
  private root: FileSystemDirectoryHandle;
  /** import folders being written in this page (shared by every instance of the store in the page, so a second `list()` does not take them for leftovers) */
  private static writingAll = new Set<string>();
  private get writing() { return OpfsModStore.writingAll; }
  private constructor(root: FileSystemDirectoryHandle) { this.root = root; }

  static async open(): Promise<OpfsModStore> {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (!nav?.storage?.getDirectory) throw new Error('OPFS is niet beschikbaar');
    const top = await nav.storage.getDirectory();
    return new OpfsModStore(await top.getDirectoryHandle(ROOT, { create: true }));
  }

  private async readJson(dir: FileSystemDirectoryHandle): Promise<InstalledMod | null> {
    try { return JSON.parse(await (await (await dir.getFileHandle('mod.json')).getFile()).text()) as InstalledMod; } catch { return null; }
  }
  private async writeJson(dir: FileSystemDirectoryHandle, m: InstalledMod) {
    const w = await (await dir.getFileHandle('mod.json', { create: true })).createWritable();
    await w.write(JSON.stringify(m));
    await w.close();
  }

  async list(): Promise<InstalledMod[]> {
    const out: InstalledMod[] = [], orphans: string[] = [];
    for await (const [name, h] of (this.root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (h.kind !== 'directory') continue;
      const m = await this.readJson(h as FileSystemDirectoryHandle);
      if (m) out.push(m); else if (!this.writing.has(name)) orphans.push(name);
    }
    // leftovers of a cut-off import are removed - but not while another tab is importing (the background install of the HD pack holds this lock)
    if (orphans.length && !(await installLockHeld())) for (const o of orphans) await this.root.removeEntry(o, { recursive: true }).catch(() => { /* gone already */ });
    return out.sort((a, b) => a.seq - b.seq);
  }

  async begin(): Promise<ModWriter> {
    const id = newId();
    this.writing.add(id);
    const dir = await this.root.getDirectoryHandle(id, { create: true });
    const files: ModFileRef[] = [];
    const seq = (await this.list()).reduce((n, m) => Math.max(n, m.seq), 0) + 1;
    return {
      id,
      addFile: async (path, size, data) => {
        const key = keyOf(files.length + 1);
        const w = await (await dir.getFileHandle(key, { create: true })).createWritable();
        try { await drain(data, size, (c) => w.write(c as unknown as BufferSource)); await w.close(); } catch (e) { await w.abort().catch(() => { /* ignore */ }); throw e; }
        files.push({ path, size, key });
      },
      commit: async (meta) => { const m = finish(id, seq, meta, files); await this.writeJson(dir, m); this.writing.delete(id); return m; },
      abort: async () => { this.writing.delete(id); await this.root.removeEntry(id, { recursive: true }).catch(() => { /* ignore */ }); },
    };
  }

  private async modDir(id: string) { return this.root.getDirectoryHandle(id); }
  async setEnabled(id: string, enabled: boolean) {
    const dir = await this.modDir(id), m = await this.readJson(dir);
    if (m) await this.writeJson(dir, { ...m, enabled });
  }
  async move(id: string, delta: -1 | 1) {
    const l = await this.list(), i = l.findIndex((m) => m.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= l.length) return;
    const a = l[i], b = l[j];
    await this.writeJson(await this.modDir(a.id), { ...a, seq: b.seq });
    await this.writeJson(await this.modDir(b.id), { ...b, seq: a.seq });
  }
  async remove(id: string) { await this.root.removeEntry(id, { recursive: true }).catch(() => { /* gone already */ }); }
  async readFile(id: string, key: string) {
    const f = await (await (await this.modDir(id)).getFileHandle(key)).getFile();
    return new Uint8Array(await f.arrayBuffer());
  }
}

/** the Web Lock the background install of the HD pack (src/mods/hd.ts) holds while it downloads / imports, so that no other tab cleans up its half-written files */
export const INSTALL_LOCK = 'le2-hd-install';
/** true when some page (this one or another tab) holds the install lock right now */
export async function installLockHeld(): Promise<boolean> {
  try {
    const locks = (globalThis as { navigator?: Navigator }).navigator?.locks;
    if (!locks?.query) return false;
    return ((await locks.query()).held ?? []).some((l) => l.name === INSTALL_LOCK);
  } catch { return false; }
}

let shared: Promise<ModStore> | null = null;
/** the persistent store, or a memory store for this session when OPFS does not work. One store per page: the start screen, the game and the background install share it. */
export function openModStore(): Promise<ModStore> {
  return (shared ??= (async () => {
    try { const s = await OpfsModStore.open(); await s.list(); return s; } catch (e) { console.warn('mods: OPFS niet beschikbaar, de mods blijven alleen in dit venster', e); return new MemoryModStore(); }
  })());
}
