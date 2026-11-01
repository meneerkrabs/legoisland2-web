// LEGO 3D generator "characters" (docs/re/lego3d.md section 8): rebuilds the game's minifigs (bodies, heads, hands, hair / headgear) from LDraw-derived pack data and the player's OWN meshes.
// Every member is identified by the CONTENT hash recorded in the pack; one that does not match (a mod replaced it) is left alone. Results are cached per content hash across archives.
import type { Generator, GenEnv } from './types.ts';
import type { Pack } from '../pack.ts';
import { hashBytes } from '../chars/hash.ts';
import { Rig } from '../chars/rig.ts';
import { decodeBody } from '../chars/bodypack.ts';
import { assembleBody } from '../chars/body.ts';
import { assembleStatic, decodeStatic } from '../chars/static.ts';

interface BodyEntry { layout: string; lod: number; roles: string; blob: string; hosts?: (number[] | null)[]; partPlanes: number[][] | null; decal: { tol: number; minEdge: number; maxDepth: number } }
export interface CharTables {
  v: number;
  bind: number[];
  bodies: Record<string, BodyEntry>;
  /** lower-case member path -> { content hash -> recipe key } */
  members: Record<string, Record<string, string>>;
  /** static recipes (heads, hands, hair, headgear): the blob and the group roles */
  statics?: Record<string, { blob: string; roles: string; nrmFrom?: number[][]; kind: string }>;
}

const cache = new Map<string, Uint8Array | null>();
/** forgets the per-content results (benchmarks measure a cold archive) */
export const resetCharsCache = () => cache.clear();
const tablesCache = new WeakMap<Pack, Promise<CharTables>>();
export const charTables = (pack: Pack): Promise<CharTables> => { let p = tablesCache.get(pack); if (!p) { p = pack.json<CharTables>('chars/tables.json'); tablesCache.set(pack, p); } return p; };

export const generator: Generator = {
  id: 'characters',
  applies: (name, pack) => pack.has('chars/tables.json') && /^z\d\d/i.test(name),
  async run(env: GenEnv) {
    const t = await charTables(env.pack);
    const rig = new Rig(t.bind);
    for (const [member, hashes] of Object.entries(t.members)) {
      const entry = env.archive.find(member);
      if (!entry) continue;
      const bytes = env.read(member);
      if (!bytes) continue;
      const hash = hashBytes(bytes), key = hashes[hash];
      if (!key) continue;   // the player's own (modded) mesh: left alone
      const ck = `${env.pack.version}|${key}|${hash}`;
      let out = cache.get(ck);
      if (out === undefined) {
        out = null;
        try {
          const be = t.bodies[key], se = t.statics?.[key];
          if (se) {
            const r = assembleStatic(bytes, decodeStatic(await env.pack.get(se.blob)), se.roles, se.nrmFrom ?? []);
            if (r) { out = r.bytes; env.stats[`${se.kind}-tris`] = (env.stats[`${se.kind}-tris`] ?? 0) + r.stats.tris; }
          } else if (be) {
            const blob = decodeBody(await env.pack.get(be.blob));
            const r = assembleBody(bytes, blob, rig, { roles: be.roles, partPlanes: be.partPlanes ?? undefined, hosts: be.hosts, ...be.decal });
            if (r) { out = r.bytes; env.stats['body-tris'] = (env.stats['body-tris'] ?? 0) + r.stats.solidTris + r.stats.decalTris; }
          }
        } catch (e) { env.log(`${member}: ${(e as Error).message}`); }
        cache.set(ck, out);
      }
      if (out) { env.put(entry.path, out); env.stats.meshes = (env.stats.meshes ?? 0) + 1; }
    }
  },
};
