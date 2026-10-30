// Persistence of save slots and the options file. Blobs are keyed by their original file names (`Save00.lgo` .. `Save06.lgo`, `SaveDef.lgo`, `Settings.set`).
import { saveWarnings, decodeSave, encodeSave, readSaveHeader, slotFileName, SLOT_COUNT, SaveError } from './save.ts';
import type { SaveGame, SaveHeader } from './save.ts';
import { Options, SETTINGS_KEY } from './options.ts';

export interface StorageBackend {
  get(name: string): Promise<Uint8Array | null>;
  put(name: string, data: Uint8Array): Promise<void>;
  delete(name: string): Promise<void>;
  list(): Promise<string[]>;
}

export class MemoryBackend implements StorageBackend {
  readonly map = new Map<string, Uint8Array>();
  async get(name: string) { const v = this.map.get(name); return v ? v.slice() : null; }
  async put(name: string, data: Uint8Array) { this.map.set(name, data.slice()); }
  async delete(name: string) { this.map.delete(name); }
  async list() { return [...this.map.keys()].sort(); }
}

const DB_NAME = 'le2-saves';
const STORE = 'blobs';

/** IndexedDB database 'le2-saves' (object store 'blobs'), opened lazily; any failure switches to an in-memory fallback for the rest of the session */
export class IdbBackend implements StorageBackend {
  /** true once IndexedDB failed and the memory fallback is in use */
  degraded = false;
  readonly fallback = new MemoryBackend();
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
        if (!idb) { reject(new Error('no indexedDB')); return; }
        const req = idb.open(DB_NAME, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
        req.onblocked = () => reject(new Error('indexedDB blocked'));
      });
    }
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, fb: () => Promise<T>): Promise<T> {
    if (this.degraded) return fb();
    try {
      const db = await this.open();
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
      });
    } catch {
      this.degraded = true;
      return fb();
    }
  }

  async get(name: string) {
    const v = await this.run<unknown>('readonly', (s) => s.get(name), async () => this.fallback.get(name));
    if (!v) return null;
    return v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer);
  }
  async put(name: string, data: Uint8Array) {
    await this.run('readwrite', (s) => s.put(data.slice(), name), async () => { await this.fallback.put(name, data); return undefined as unknown as IDBValidKey; });
  }
  async delete(name: string) {
    await this.run('readwrite', (s) => s.delete(name), async () => { await this.fallback.delete(name); return undefined; });
  }
  async list() {
    const k = await this.run<IDBValidKey[]>('readonly', (s) => s.getAllKeys(), async () => this.fallback.list());
    return k.map(String).sort();
  }
}

/** what a slot menu entry needs (FUN_0041aa2e reads exactly this from the file header) */
export interface SlotInfo { slot: number; empty: boolean; header: SaveHeader | null }

export class SaveStore {
  readonly backend: StorageBackend;
  constructor(backend: StorageBackend) { this.backend = backend; }

  /** caption data of one slot from the header only (the original does not verify the checksum for the menus either) */
  async slotInfo(slot: number): Promise<SlotInfo> {
    const b = await this.backend.get(slotFileName(slot));
    const header = b ? readSaveHeader(b) : null;
    return { slot, empty: !header, header };
  }
  async slotInfos(): Promise<SlotInfo[]> {
    const out: SlotInfo[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) out.push(await this.slotInfo(i));
    return out;
  }

  async save(slot: number, s: SaveGame): Promise<void> { await this.backend.put(slotFileName(slot), encodeSave(s)); }
  /** null = empty slot; throws SaveError for a damaged file */
  async load(slot: number): Promise<SaveGame | null> {
    const b = await this.backend.get(slotFileName(slot));
    return b ? decodeSave(b) : null;
  }
  async erase(slot: number): Promise<void> { await this.backend.delete(slotFileName(slot)); }

  /** the raw `.lgo` file, byte-compatible with the original game (null = empty) */
  async exportLgo(slot: number): Promise<Uint8Array | null> { return this.backend.get(slotFileName(slot)); }
  async exportBlob(slot: number): Promise<Blob | null> {
    const b = await this.exportLgo(slot);
    return b ? new Blob([b as BlobPart], { type: 'application/octet-stream' }) : null;
  }
  /** import of an original `.lgo` file: loads like the original's reader (no checksum check); returns Dutch warnings for a wrong checksum / marker; throws SaveError for what the reader cannot read */
  async importLgo(slot: number, bytes: Uint8Array): Promise<string[]> {
    decodeSave(bytes);
    const warnings = saveWarnings(bytes);
    await this.backend.put(slotFileName(slot), bytes);
    return warnings;
  }

  async loadOptions(options: Options): Promise<boolean> {
    const b = await this.backend.get(SETTINGS_KEY);
    if (!b) return false;
    options.decode(b);
    return true;
  }
  async saveOptions(options: Options): Promise<void> { await this.backend.put(SETTINGS_KEY, options.encode()); }
  /** persist the options on every change (debounced to the next microtask burst); returns the unsubscribe function */
  autosaveOptions(options: Options): () => void {
    let pending = false;
    return options.onChange(() => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => { pending = false; void this.saveOptions(options); });
    });
  }
}

export { SaveError };
