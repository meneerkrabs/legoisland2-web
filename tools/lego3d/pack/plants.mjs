// Pack builder "plants": the pine and oak meshes rebuilt as stacks of round plates, LDraw 4032a / 3062b proportions (docs/re/lego3d.md section 19, generator `plants`).
//   Input : tools/lego3d/plants-table.mjs (the models: numbers fitted to the game's meshes; the plain-cylinder outlines of LDraw parts 4032a and 3062b), the LDraw library, the player's archives (MEASURING only: content hash, box, group flags,
//           texture mapping numbers, the silhouette IoU gate)
//   Output: pack members plants/<model>.bin (generated geometry in the game's frame, quantised) and plants/arch/<archive>.json (per member: the hash of the GAME's mesh, its group flags, the texture mapping numbers),
//           report in <WORK>/plants-report.json. Nothing of the game's geometry is written. A member whose IoU is below the gate (GATE.min) is left out of the table (reported).
import fs from 'node:fs';
import path from 'node:path';
import { archive, archiveNames, memberOf, scene, textureOf, WORK } from '../lib.mjs';
import { parseMsh } from '../../../src/formats/msh.ts';
import { encodeMesh, decodeMesh, hashMember } from '../../../src/mods/lego3d/meshpack.ts';
import { silhouetteIoU } from '../iou.mjs';
import { buildPlant, soupsOf } from '../plants.mjs';
import { MODELS, GATE } from '../plants-table.mjs';

/** least-squares affine u (or v) = c . (x, y, z, 1) over a group's vertices; { c, err } */
function affine(P, U) {
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]), B = [0, 0, 0, 0];
  P.forEach((p, i) => { const r = [p[0], p[1], p[2], 1]; for (let x = 0; x < 4; x++) { B[x] += r[x] * U[i]; for (let y = 0; y < 4; y++) A[x][y] += r[x] * r[y]; } });
  for (let i = 0; i < 4; i++) A[i][i] += 1e-9;
  const M = A.map((r, i) => [...r, B[i]]);
  for (let c = 0; c < 4; c++) { let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let x = c; x < 5; x++) M[r][x] -= f * M[c][x]; } }
  const c = [0, 1, 2, 3].map((i) => M[i][4] / M[i][i]);
  let err = 0; P.forEach((p, i) => { err = Math.max(err, Math.abs(c[0] * p[0] + c[1] * p[1] + c[2] * p[2] + c[3] - U[i])); });
  return { c, err };
}
const r4 = (a) => a.map((v) => +v.toFixed(5));
/** the middle of the brightest patch of a picture (3 x 3 box of the luminance, wrapping): the texel the horizontal faces (the top of a plate, which has no pattern) take, as (u, v) of its centre. The pine's / oak's picture is a
 *  grid of lit green pads on dark: the middle of a pad. Rows are bottom-up like the TGA (V = 0 at the first row). */
function brightTexel(tex) {
  const { width: w, height: h } = tex, L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = tex.rgba[i * 4] + tex.rgba[i * 4 + 1] * 2 + tex.rgba[i * 4 + 2];
  let best = 0, bl = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += L[((y + dy + h) % h) * w + ((x + dx + w) % w)];
    if (s > bl) { bl = s; best = y * w + x; }
  }
  return [+(((best % w) + 0.5) / w).toFixed(4), +(((Math.floor(best / w)) + 0.5) / h).toFixed(4)];
}

export async function build(ctx) {
  // 1. the models
  const built = {}, usedParts = new Set(['4032a', '3062b']);
  for (const [key, M] of Object.entries(MODELS)) {
    const b = buildPlant({ parts: M.build() });
    const blob = encodeMesh(b.groups.map((g) => ({ kind: 0, flags: 0, pos: g.pos, nrm: g.nrm, idx: Uint16Array.from(g.idx) })));
    ctx.put(`plants/${key}.bin`, blob);
    built[key] = { groups: decodeMesh(blob), tris: b.tris, bytes: blob.length };
    ctx.log(`${key}: ${b.tris} triangles, ${blob.length} bytes, ${b.perPart.map((p) => `${p.part}:${p.tris}`).join(' ')}`);
  }
  for (const p of usedParts) ctx.use(ctx.lib.flatten(`${p}.dat`, { res: 'std', skip: /^stud/ }).infos);
  // 2. the members of every zone archive that are the game's meshes of a model and are used by a record
  const report = [];
  for (const zone of archiveNames().filter((n) => /^z\d/.test(n))) {
    let sc; try { sc = scene(zone); } catch { continue; }
    const arch = archive(zone), entries = [], seen = new Set();
    const users = new Map();   // member (lower case) -> { texList of the first part that uses it }
    for (const r of sc.records) for (const p of r.model?.parts ?? []) if (p) { const m = memberOf(sc.meshPaths[p.mesh] ?? '').toLowerCase(); if (m && !users.has(m)) users.set(m, p.texList); }
    for (const [mkey, M] of Object.entries(MODELS)) {
      for (const [lower, texList] of users) {
        const e = arch.find(lower); if (!e) continue;
        const member = e.path ?? lower;
        if (!M.match.re.test(member) || seen.has(member.toLowerCase())) continue;
        const bytes = arch.read(e), g = parseMsh(bytes);
        const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
        for (let i = 0; i < g.vertexCount; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], g.positions[i * 3 + c]); hi[c] = Math.max(hi[c], g.positions[i * 3 + c]); }
        const box = hi.map((h, c) => h - lo[c]), tol = M.match.tol ?? 0.15;
        const row = { zone, member, model: mkey, hash: hashMember(bytes), gameTris: g.indices.length / 3, box: box.map((v) => +v.toFixed(2)) };
        if (box.some((v, c) => Math.abs(v - M.match.box[c]) > tol)) { row.status = 'box differs'; report.push(row); continue; }
        const gs = g.groups.map((gr) => { const o = new Float32Array(gr.indexCount * 3); for (let i = 0; i < gr.indexCount; i++) { const v = g.indices[gr.firstIndex + i] + gr.firstVertex; for (let c = 0; c < 3; c++) o[i * 3 + c] = g.positions[v * 3 + c]; } return o; });
        const mine = soupsOf(built[mkey].groups.map((q) => ({ pos: q.pos, idx: q.idx })));
        const io = silhouetteIoU(gs, mine, { views: GATE.views, size: GATE.size });
        row.iou = io.iou.map((v) => +v.toFixed(3)); row.min = +io.min.toFixed(3); row.mean = +io.mean.toFixed(3); row.newTris = built[mkey].tris;
        if (io.min < GATE.min) { row.status = `below the gate (${GATE.min})`; report.push(row); continue; }
        if (g.groups.length !== built[mkey].groups.length) { row.status = 'group count differs'; report.push(row); continue; }
        // texture mapping per group
        const tl = sc.texLists[texList] ?? [], groups = [];
        g.groups.forEach((gr, gi) => {
          const P = [], U = [], V = [];
          for (let v = gr.firstVertex; v < gr.firstVertex + gr.vertexCount; v++) { P.push([g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]]); U.push(g.uvs[v * 2]); V.push(g.uvs[v * 2 + 1]); }
          const fu = affine(P, U), fv = affine(P, V), uv = {};
          if (fu.err < 0.02 && fv.err < 0.02) {
            uv.a = r4(fu.c); uv.b = r4(fv.c);
            const tex = tl[gi] != null ? textureOf(arch, tl[gi]) : null;
            if (tex) uv.flat = brightTexel(tex);
          } else uv.c = [+(U.reduce((s, v) => s + v, 0) / U.length).toFixed(4), +(V.reduce((s, v) => s + v, 0) / V.length).toFixed(4)];
          groups.push({ flags: gr.flags, uv });
        });
        entries.push({ member, hash: row.hash, model: mkey, groups });
        seen.add(member.toLowerCase());
        row.status = 'ok'; report.push(row);
      }
    }
    if (entries.length) ctx.put(`plants/arch/${zone.toLowerCase()}.json`, JSON.stringify({ v: 1, archive: zone, entries }));
  }
  fs.writeFileSync(path.join(WORK, 'plants-report.json'), JSON.stringify(report, null, 1));
  const ok = report.filter((r) => r.status === 'ok');
  ctx.log(`${ok.length} members in ${new Set(ok.map((r) => r.zone)).size} archives; not taken: ${report.filter((r) => r.status !== 'ok').map((r) => `${r.zone}/${r.member} (${r.status})`).join(', ') || 'none'}`);
}
