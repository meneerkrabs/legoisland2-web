// The override layer: files of enabled mods take precedence over the game's own files exactly as loose files do in the original (docs/re/mods.md):
// `FUN_004348ff` (PCDBG_File.c, the game's fopen) tries the REAL file first and only when that fails looks into the mounted `.bob/.bod` archives, so a loose
// `_data\<archive>\<member>` wins over the archive member of the same path, compared case-insensitively. Patches of the executable are applied to the bytes of
// `LEGO eiland 2.exe` the first time the engine reads them. The files themselves stay in the store until something asks for them (`GameData` loads the files of an
// archive when it opens it and lets go of a zone's files when the zone ends), so a pack of gigabytes does not have to fit in memory at once.
import type { GameFiles, MediaFile } from '../files.ts';
import type { Archive } from '../formats/archive.ts';
import { normalizePath } from '../files.ts';
import type { LoadState } from '../engine/bytesource.ts';
import type { PatchLine } from './package.ts';
import type { HdLazy } from './hdremote.ts';
import { applyPatches } from './patch.ts';
import type { PatchResult } from './patch.ts';

export const EXE_PATH = 'LEGO eiland 2.exe';

export interface ModFileSource {
  /** installed layout, '/' separators, the case the mod gave: `_data/z02LGI/textures/text008.tga` */
  path: string;
  size: number;
  read(): Promise<Uint8Array>;
}
export interface ActiveMod { id: string; title: string; files: ModFileSource[]; patches: PatchLine[] }

export interface LayerFile extends ModFileSource { modId: string; modTitle: string }
export interface ShadowedFile { path: string; modTitle: string; byTitle: string }
export interface AppliedOverride { path: string; archive: string; member: string; modTitle: string; /** true = replaced a member of the archive, false = added one */ replaced: boolean }
export interface ArchiveOverride { path: string; size: number; load(): Promise<Uint8Array>; done?(replaced: boolean): void }

export class ModLayer {
  /** the winning file per normalized path (a later mod in `mods` wins) */
  readonly files = new Map<string, LayerFile>();
  /** files that a later mod replaced again */
  readonly shadowed: ShadowedFile[] = [];
  /** the patch lines of all mods in order, with their mod */
  readonly patches: { modId: string; modTitle: string; patch: PatchLine }[] = [];
  /** filled while the engine opens archives: what each file did */
  readonly applied: AppliedOverride[] = [];
  /** filled when the executable is read: result per patch line, same order as `patches` */
  patchResults: PatchResult[] = [];

  constructor(mods: readonly ActiveMod[]) { this.add(mods); }

  /** put more mods on top of the ones already in (they win where they replace the same file) */
  add(mods: readonly ActiveMod[]) {
    for (const m of mods) {
      for (const f of m.files) {
        const key = normalizePath(f.path);
        const prev = this.files.get(key);
        if (prev && prev.modId !== m.id) this.shadowed.push({ path: prev.path, modTitle: prev.modTitle, byTitle: m.title });
        this.files.set(key, { ...f, modId: m.id, modTitle: m.title });
      }
      for (const p of m.patches) this.patches.push({ modId: m.id, modTitle: m.title, patch: p });
    }
  }

  get active() { return this.files.size > 0 || this.patches.length > 0; }
  get(path: string) { return this.files.get(normalizePath(path)); }

  /** the files that go into the archive `name` (`_data/<name>/...`), paths relative to the archive root */
  archiveOverrides(name: string): ArchiveOverride[] {
    const prefix = `_data/${name.toLowerCase()}/`;
    const out: ArchiveOverride[] = [];
    for (const [key, f] of this.files) {
      if (!key.startsWith(prefix)) continue;
      const member = f.path.replace(/\\/g, '/').split('/').slice(2).join('/');
      if (!member) continue;
      out.push({ path: member, size: f.size, load: () => f.read(), done: (replaced) => { const i = this.applied.findIndex((a) => a.path === f.path); const r = { path: f.path, archive: name, member, modTitle: f.modTitle, replaced }; if (i >= 0) this.applied[i] = r; else this.applied.push(r); } });
    }
    return out;
  }
}

export class ModdedFiles implements GameFiles {
  readonly layer: ModLayer;
  private base: GameFiles;
  private exe: Promise<Uint8Array> | null = null;
  /** the unpatched executable (for the effect report), once read */
  originalExe: Uint8Array | null = null;

  /** mods that became available while the game runs (the HD pack that finished downloading in the background): they join the layer at the next zone change, see `zoneBoundary` */
  private pending: ActiveMod[] = [];

  constructor(base: GameFiles, layer: ModLayer) { this.base = base; this.layer = layer; }

  /** LEGO 3D (src/mods/lego3d/hook.ts): puts generated members into an archive after the mods' own files; unset (the original game) unless the option is on */
  generateOverrides?: (name: string, archive: Archive, other: (name: string) => Promise<Archive | null>) => Promise<void>;

  /** the HD pack read on demand (src/mods/hdremote.ts): complete archives of it replace members like a mod's files (below the mods' own: those win) */
  lazy: HdLazy | null = null;

  queue(mods: readonly ActiveMod[]) { this.pending.push(...mods); }
  /** called when a zone ended and its mod files were let go of (`GameData.releaseZoneOverrides`): from now on the zones that load see the queued mods */
  zoneBoundary() {
    this.lazy?.newZone();
    if (!this.pending.length) return;
    this.layer.add(this.pending);
    this.pending = [];
    (globalThis as { dispatchEvent?: (e: Event) => boolean }).dispatchEvent?.(new Event('le2-mods-changed'));
  }
  prepareOverrides(name: string): Promise<void> { return this.lazy?.prepare(name) ?? Promise.resolve(); }

  get source() { return this.base.source; }
  get route() { return this.base.route; }
  get loading(): LoadState | null { return this.base.loading; }

  private isExe(path: string) { return normalizePath(path) === normalizePath(EXE_PATH); }

  list() {
    const have = new Set(this.base.list().map(normalizePath));
    const extra: string[] = [];
    for (const [k, f] of this.layer.files) if (!have.has(k)) extra.push(f.path);
    return extra.length ? [...this.base.list(), ...extra] : this.base.list();
  }
  has(path: string) { return !!this.layer.get(path) || this.base.has(path); }
  size(path: string) { return this.layer.get(path)?.size ?? this.base.size(path); }
  totalSize() {
    let t = this.base.totalSize();
    for (const f of this.layer.files.values()) { const was = this.base.size(f.path); t += f.size - (was < 0 ? 0 : was); }
    return t;
  }
  loaded(path: string) { return this.layer.get(path) ? true : this.base.loaded(path); }
  ready(paths: Iterable<string>) { return this.base.ready([...paths].filter((p) => !this.layer.get(p))); }
  movie(name: string): Promise<MediaFile | null> { return this.base.movie(name); }

  read(path: string): Promise<Uint8Array> {
    const f = this.layer.get(path);
    if (f) return f.read();
    if (this.isExe(path) && this.layer.patches.length) {
      return (this.exe ??= this.base.read(path).then((orig) => {
        this.originalExe = orig;
        const r = applyPatches(orig, this.layer.patches.map((p) => p.patch));
        this.layer.patchResults = r.results;
        return r.data;
      }));
    }
    return this.base.read(path);
  }

  archiveOverrides(name: string) {
    const own = this.layer.archiveOverrides(name), lz = this.lazy?.overrides(name) ?? [];
    return lz.length ? [...lz, ...own] : own;
  }
}

/** wrap `files` when there is anything to apply; otherwise they are returned as they are (nothing changes without mods) */
export function withMods(files: GameFiles, mods: readonly ActiveMod[]): GameFiles {
  const layer = new ModLayer(mods);
  return layer.active ? new ModdedFiles(files, layer) : files;
}
