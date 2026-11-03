// Pack builder "glass" (docs/re/lego3d.md section 16.10): per zone archive the TABLE of the static meshes that carry translucent glass (group flags & 3 and a flat translucent texture: the rule of the
// brick-built buildings, `isGlassTexture` of bldg.mjs) and have unpaired glass triangles, so that src/mods/lego3d/gen/glass.ts can append the reversed copy of each of them at run time. The table holds the
// member name, the content hash of the game's mesh, the group count and the glass group indices: no vertex of the game. Members the sets generator replaces are left out (they got their back faces there).
//   node tools/lego3d/pack/build-pack.mjs --only glass          the inventory (counts per zone and mesh): node tools/lego3d/glass-inventory.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, archiveNames, scene, memberOf, textureOf } from '../lib.mjs';
import { isGlassTexture } from './bldg.mjs';
import { parseMsh } from '../../../src/formats/msh.ts';
import { unpairedTriangles } from '../../../src/mods/lego3d/gen/glass.ts';
import { hashMember } from '../../../src/mods/lego3d/meshpack.ts';
import { Pack } from '../../../src/mods/lego3d/pack.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PACK_FILE = path.join(here, '../../../src/mods/lego3d/data/lego3d.pack');

/** members (lower case) of an archive that the sets generator replaces (both tables of the existing pack) -> the per-group kinds of the table (`keep` = the player's own group stays, one-sided glass included) */
export async function replacedMembers(an, packFile = PACK_FILE) {
  const out = new Map();
  if (!fs.existsSync(packFile)) return out;
  const pack = Pack.open(new Uint8Array(fs.readFileSync(packFile)));
  for (const t of ['', '.b']) { const n = `sets/arch/${an.toLowerCase()}${t}.json`; if (pack.has(n)) for (const e of (await pack.json(n)).meshes) out.set(e.member.toLowerCase(), e.kinds); }
  return out;
}

/**
 * What counts as a glass texture here: the rule of the brick-built buildings (`isGlassTexture`: a flat colour, alpha 100 .. 254), plus the same flat colour with a darker alpha (>= 64: the police helicopter's
 * tinted canopy, 91 .. 107) and the WINDOW PICTURES (an opaque frame and a translucent pane in one texture, no cut-out pixel: the hospital's and the police station's windows). Not glass: cut-outs (alpha 0 pixels:
 * foliage, fences, signs), water (one translucent colour with a pattern), gradients that are translucent all over (the ambulance's windscreen: reported as `other`).
 */
const paneCache = new Map();
export function paneTexture(a, id) {
  if (id < 0) return false;
  const k = `${a.name}:${id}`;
  if (paneCache.has(k)) return paneCache.get(k);
  let r = isGlassTexture(a, id);
  if (!r) {
    const t = textureOf(a, id);
    if (t) {
      const px = t.rgba, mn = [255, 255, 255, 255], mx = [0, 0, 0, 0];
      let opaque = 0, clear = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) { n++; for (let c = 0; c < 4; c++) { if (px[i + c] < mn[c]) mn[c] = px[i + c]; if (px[i + c] > mx[c]) mx[c] = px[i + c]; } if (px[i + 3] === 255) opaque++; else clear++; }
      const flat = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) <= 12;
      r = mn[3] >= 64 && ((flat && mx[3] < 255) || (opaque >= n * 0.05 && clear >= n * 0.05));
    }
  }
  paneCache.set(k, r);
  return r;
}

/** does a texture carry any translucency at all (some pixel alpha < 255)? for the report of what the rule leaves out */
const alphaCache = new Map();
function hasAlpha(a, id) {
  if (id < 0) return false;
  const k = `${a.name}:${id}`;
  if (alphaCache.has(k)) return alphaCache.get(k);
  const t = textureOf(a, id);
  let r = false;
  if (t) for (let i = 3; i < t.rgba.length; i += 4) if (t.rgba[i] < 255) { r = true; break; }
  alphaCache.set(k, r);
  return r;
}

/**
 * Every static mesh of one zone archive that is drawn by a model of the zone: [{ member, entry, groups: [{ gi, flags, tex: [ids], glass, unpaired, tris }], skinned, tris, covered, other }]
 * glass = flags & 3 and the flat translucent texture in EVERY use of the group; `other` = translucent groups (flags & 3, texture with alpha) that the rule does not call glass.
 */
export async function scanArchive(an) {
  let sc; try { sc = scene(an); } catch { return null; }
  const a = archive(an), covered = await replacedMembers(an);
  const uses = new Map();
  const visit = (part) => {
    const mp = sc.meshPaths[part.mesh]; if (!mp) return;
    const member = memberOf(mp), key = member.toLowerCase();
    let u = uses.get(key); if (!u) { u = { member, lists: [] }; uses.set(key, u); }
    u.lists.push(sc.texLists[part.texList] ?? []);
  };
  for (const model of sc.models) { for (const p of model.parts) if (p) visit(p); for (const at of model.attach) if (at) for (const p of at.child.parts) if (p) visit(p); }
  const out = [];
  for (const u of uses.values()) {
    const e = a.find(u.member); if (!e) continue;
    const bytes = a.read(e);
    let m; try { m = parseMsh(bytes); } catch { continue; }
    const groups = [];
    m.groups.forEach((g, gi) => {
      if (!(g.flags & 3)) return;
      const tex = [...new Set(u.lists.map((l) => l[gi] ?? -1))];
      const glass = tex.every((t) => paneTexture(a, t));
      const translucent = tex.some((t) => hasAlpha(a, t));
      if (!glass && !translucent) return;
      groups.push({ gi, flags: g.flags, tex, glass, tris: g.indexCount / 3, unpaired: glass ? unpairedTriangles(m, gi).length : 0 });
    });
    if (!groups.length) continue;
    out.push({ member: e.path, entry: e, hash: hashMember(bytes), groupCount: m.groups.length, groups, skinned: !!m.svwl, tris: m.indices.length / 3, covered: covered.has(e.path.toLowerCase()), kinds: covered.get(e.path.toLowerCase()) ?? null });
  }
  return out.sort((x, y) => (x.member < y.member ? -1 : 1));
}

export async function build(ctx) {
  let nMesh = 0, nTris = 0;
  for (const an of archiveNames()) {
    if (!/^z\d\d/i.test(an)) continue;
    const scan = await scanArchive(an); if (!scan) continue;
    const meshes = [];
    for (const s of scan) {
      if (s.skinned) continue;
      // a member the sets generator replaces: only the glass groups it keeps as the game's (the others are bricks, or got their back there)
      const g = s.groups.filter((x) => x.glass && x.unpaired > 0 && (!s.covered || s.kinds[x.gi] === 'keep'));
      if (!g.length) continue;
      meshes.push({ m: s.member, h: s.hash, c: s.groupCount, g: g.map((x) => x.gi), t: g.reduce((q, x) => q + x.unpaired, 0) });
    }
    if (!meshes.length) continue;
    ctx.put(`glass/arch/${an.toLowerCase()}.json`, JSON.stringify({ v: 1, archive: an, meshes }));
    nMesh += meshes.length; nTris += meshes.reduce((q, x) => q + x.t, 0);
  }
  ctx.log(`${nMesh} meshes, ${nTris} back triangles`);
}
