// Reading a game model in its bind pose (the way src/game/render.ts draws it: skinned body + attachments on bone matrices) for inventory / preview / fitting.
import path from 'node:path';
import fs from 'node:fs';
import { parseMsh } from '../../src/formats/msh.ts';
import { parseBlk, sampleBlk, parseSvwl, skinPositions, skinNormals } from '../../src/formats/anim.ts';
import { transformPoint, mul } from '../../src/render/math.ts';
import { archive, scene, memberOf, textureOf, writePngBottomUp, WORK } from './lib.mjs';

export const rigOf = (meshName) => { const b = meshName.toUpperCase(); return b.startsWith('SWFT') ? 'SWFT' : b.startsWith('RBB') ? 'RBBT' : b.startsWith('PTER') ? 'PTER' : 'MFIG'; };
export const baseName = (p) => p.split('\\').pop();

/** { msh, svwl|null, name } for a scene mesh slot */
export function readMesh(zone, meshPath) {
  const arch = archive(zone);
  const msh = parseMsh(arch.read(memberOf(meshPath)));
  return { msh, sv: msh.svwl ? parseSvwl(msh.svwl, msh.vertexCount) : null, name: baseName(meshPath) };
}

/** bind-pose bone matrices (clip 2 frame 0 of the zone's rig, like the renderer's bindBones) */
export function bindBones(zone, rig = 'MFIG', clip = 2, frame = 0) {
  const blk = parseBlk(archive(zone).read(`anim/${rig}.blk`));
  return { blk, bones: sampleBlk(blk.skeleton, blk.clips[clip], frame) };
}

/**
 * The parts of a model at LOD index `li` in bind pose: [{ name, positions (world, game space), normals, uvs, indices (global), groups: [{first (index), count, tex, firstVertex, vertexCount}] , bone }]
 * (base mesh first, then each attachment). `tex` = the texture id of the group from the model's texture list of that LOD part.
 */
export function modelParts(zone, model, li, sc = scene(zone), pose = null) {
  const out = [];
  const part = model.parts[Math.min(li, model.parts.length - 1)];
  const base = readMesh(zone, sc.meshPaths[part.mesh]);
  const { bones } = bindBones(zone, rigOf(base.name), pose ? pose[0] : 2, pose ? pose[1] : 0);
  const emit = (r, texList, xf, bone, role) => {
    const m = r.msh;
    let pos = m.positions, nrm = m.normals;
    if (r.sv) { pos = skinPositions(m.positions, r.sv, bones); nrm = skinNormals(m.normals, r.sv, bones, undefined, true); }
    const P = new Float32Array(pos.length), N = new Float32Array(nrm.length);
    for (let i = 0; i < m.vertexCount; i++) {
      const p = transformPoint(xf, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
      P.set(p, i * 3);
      const n = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
      N.set([n[0] * xf[0] + n[1] * xf[4] + n[2] * xf[8], n[0] * xf[1] + n[1] * xf[5] + n[2] * xf[9], n[0] * xf[2] + n[1] * xf[6] + n[2] * xf[10]], i * 3);
    }
    const idx = new Uint32Array(m.indices.length);
    const groups = m.groups.map((g, gi) => {
      for (let k = 0; k < g.indexCount; k++) idx[g.firstIndex + k] = m.indices[g.firstIndex + k] + g.firstVertex;
      return { first: g.firstIndex, count: g.indexCount, firstVertex: g.firstVertex, vertexCount: g.vertexCount, tex: texList?.[gi] ?? -1, flags: g.flags };
    });
    out.push({ name: r.name, role, bone, positions: P, normals: N, uvs: m.uvs, indices: idx, groups, vertexCount: m.vertexCount, skinned: !!r.sv });
  };
  const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  emit(base, sc.texLists[part.texList], I, -1, 'body');
  model.attach.forEach((a) => {
    if (!a) return;
    const cp = a.child.parts[Math.min(li, a.child.parts.length - 1)];
    if (!cp) return;
    const r = readMesh(zone, sc.meshPaths[cp.mesh]);
    emit(r, sc.texLists[cp.texList], bones.subarray(a.bone * 16, a.bone * 16 + 16), a.bone, `slot${a.slot}`);
  });
  return out;
}

/** writes a preview scene for tools/lego3d/blender/preview.py: JSON + PNG textures (of `texArch`), returns the json path */
export function writePreviewScene(name, parts, texArch, extra = {}) {
  const dir = path.join(WORK, 'preview', name);
  fs.mkdirSync(path.join(dir, 'tex'), { recursive: true });
  const seen = new Set();
  const js = { parts: parts.map((p) => ({
    name: p.name, positions: Array.from(p.positions), uvs: Array.from(p.uvs), indices: Array.from(p.indices),
    groups: p.groups.map((g) => {
      let file = null;
      if (g.tex >= 0 && texArch) {
        file = `tex/t${g.tex}.png`;
        if (!seen.has(g.tex)) { seen.add(g.tex); const t = textureOf(texArch, g.tex); if (t) writePngBottomUp(path.join(dir, file), t.width, t.height, t.rgba); else file = null; }
      }
      return { first: g.first, count: g.count, tex: file, flags: g.flags };
    }),
  })), ...extra };
  const f = path.join(dir, 'scene.json');
  fs.writeFileSync(f, JSON.stringify(js));
  return f;
}
