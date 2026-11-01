#!/usr/bin/env node
// Inventory of the game's character models (every zone): body meshes per LOD, attachments per slot (head, hair / hat, bag, hands ...), their content hashes (src/mods/lego3d/chars/hash.ts),
// groups, texture lists and face set-ups. Writes $LE2_LEGO3D/inventory/chars.json and prints a summary.   node tools/lego3d/chars-inventory.mjs
import fs from 'node:fs';
import path from 'node:path';
import { archive, archiveNames, scene, memberOf, WORK } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { parseSvwl } from '../../src/formats/anim.ts';
import { hashBytes } from '../../src/mods/lego3d/chars/hash.ts';

export function inventory() {
const out = { models: [], meshes: {} };
for (const an of archiveNames()) {
  if (!/^z\d\d/.test(an)) continue;
  let sc; try { sc = scene(an); } catch (e) { console.log(an, 'scene fail', e.message); continue; }
  const a = archive(an);
  const info = (mp) => {
    const p = sc.meshPaths[mp]; if (!p) return null;
    const member = memberOf(p), e = a.find(member);
    if (!e) return { name: p.split('\\').pop(), member, missing: true };
    const b = a.read(e), hash = hashBytes(b);
    if (!out.meshes[hash]) {
      const m = parseMsh(b); let bonesMax = -1;
      if (m.svwl) { const sv = parseSvwl(m.svwl, m.vertexCount); for (let v = 0; v < m.vertexCount; v++) bonesMax = Math.max(bonesMax, sv.bone[v]); for (let i = 0; i < sv.extra.count; i++) bonesMax = Math.max(bonesMax, sv.extra.bone[i]); }
      const lo = [9e9, 9e9, 9e9], hi = [-9e9, -9e9, -9e9];
      for (let i = 0; i < m.positions.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.positions[i + c]); hi[c] = Math.max(hi[c], m.positions[i + c]); }
      out.meshes[hash] = { name: p.split('\\').pop(), verts: m.vertexCount, tris: m.indices.length / 3, groups: m.groups.map((g) => [g.vertexCount, g.indexCount / 3]), skinned: !!m.svwl, bonesMax, lo, hi, zones: [] };
    }
    const mm = out.meshes[hash]; if (!mm.zones.includes(an)) mm.zones.push(an);
    return { name: p.split('\\').pop(), member, hash };
  };
  const seen = new Set();
  for (const m of sc.models) {
    const p0 = m.parts[0]; if (!p0) continue;
    const i0 = info(p0.mesh);
    if (!i0 || i0.missing) continue;
    const mm = out.meshes[i0.hash];
    if (!mm.skinned || mm.bonesMax < 10 || mm.bonesMax > 16) continue;
    const key = m.array + ':' + m.index; if (seen.has(key)) continue; seen.add(key);
    const part = (p) => ({ lod: p.lod, ...info(p.mesh), tex: sc.texLists[p.texList] });
    out.models.push({ zone: an, model: key, face: m.face ?? null, parts: m.parts.map(part), attach: m.attach.map((at) => at && ({ slot: at.slot, bone: at.bone, face: at.child.face ?? null, parts: at.child.parts.map(part) })) });
  }
}
return out;
}
/** the cached inventory (written by the CLI) or a fresh one */
export function loadInventory() { const f = path.join(WORK, 'inventory/chars.json'); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); const o = inventory(); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); return o; }
if (import.meta.url === `file://${process.argv[1]}`) { const o = inventory(); fs.mkdirSync(path.join(WORK, 'inventory'), { recursive: true }); fs.writeFileSync(path.join(WORK, 'inventory/chars.json'), JSON.stringify(o)); console.log('models', o.models.length, 'meshes', Object.keys(o.meshes).length); }
