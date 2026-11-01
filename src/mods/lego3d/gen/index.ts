// Runs the LEGO 3D generators for one archive: pack + the player's archive -> replacement members (docs/re/lego3d.md section 8).
// Order matters: the textures first (they only replace pictures), then the bricks, characters and set models (they replace whole meshes), the studs last (they add studs to the
// meshes that are still the game's: a member that an earlier generator wrote is never touched by the studs).
import type { Archive } from '../../../formats/archive.ts';
import type { Pack } from '../pack.ts';
import type { GenEnv, Generator } from './types.ts';
import { generator as textures } from './textures.ts';
import { generator as bricks } from './bricks.ts';
import { generator as characters } from './characters.ts';
import { generator as sets } from './sets.ts';
import { generator as studs } from './studs.ts';

export type { GenEnv, Generator } from './types.ts';
/** bump when generator CODE changes in a way that changes its output (part of the cache key of the generated members, with the pack's version): a pack rebuilt with the same date or an app update with old caches must not serve old results */
export const GEN_VERSION = 4;
export const GENERATORS: readonly Generator[] = [textures, bricks, characters, sets, studs];

export interface GenResult {
  /** member path (relative to the archive root) -> bytes */
  files: Map<string, Uint8Array>;
  /** which generator wrote which member */
  by: Map<string, string>;
  stats: Record<string, Record<string, number>>;
  log: string[];
  ms: Record<string, number>;
}

/**
 * `options`: ids of generators to run (ids of GENERATORS) or `-id` to leave one out; empty = all. `other`: lets a generator open another archive of the game.
 */
export async function generateArchive(pack: Pack, name: string, archive: Archive, other: (name: string) => Promise<Archive | null> = async () => null, options: Iterable<string> = []): Promise<GenResult> {
  const opts = new Set(options);
  const only = [...opts].filter((o) => !o.startsWith('-'));
  const files = new Map<string, Uint8Array>(), by = new Map<string, string>(), key = (m: string) => m.replace(/\\/g, '/').toLowerCase();
  const res: GenResult = { files, by, stats: {}, log: [], ms: {} };
  const lower = new Map<string, string>();   // lower-case path -> the path as put
  for (const g of GENERATORS) {
    if (only.length && !only.includes(g.id)) continue;
    if (opts.has(`-${g.id}`)) continue;
    if (!g.applies(name, pack)) continue;
    const stats: Record<string, number> = {};
    const env: GenEnv = {
      pack, name, archive, out: files, options: opts, stats,
      read: (m) => { const o = lower.get(key(m)); if (o) return files.get(o) ?? null; const e = archive.find(m); return e ? archive.read(e) : null; },
      other,
      put: (m, bytes) => { const k = key(m), prev = lower.get(k); if (prev && prev !== m) files.delete(prev); lower.set(k, m); files.set(m, bytes); by.set(m, g.id); },
      log: (msg) => res.log.push(`${g.id}: ${msg}`),
    };
    const t0 = Date.now();
    await g.run(env);
    res.ms[g.id] = Date.now() - t0;
    res.stats[g.id] = stats;
  }
  return res;
}
