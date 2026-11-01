// LEGO 3D characters, pack audit (docs/re/lego3d.md two-layer rule): the chars part of the data pack must hold LDraw-derived geometry and measured numbers only, NEVER the game's meshes.
// 1. every blob of chars/ is decoded and its byte size must be exactly what the format says (positions, indices, groups, skin weights: no UVs, no normals, nothing hidden after the data);
// 2. every triangle of every blob (positions in the coordinate system the assembler uses: the original mesh's own for statics, the reference pose for bodies) is looked up among the triangles of ALL
//    game meshes of all zone archives (a triangle = its three vertices snapped to a 0.01 grid, order-free); a blob in which many triangles are the game's triangles fails (a copied mesh matches
//    nearly 100 %, the LDraw-derived shapes fitted to a bounding box match only where a flat quad shares the box corners);
// 3. tables.json holds no float array longer than the 17 bone matrices (the reference pose: measured numbers) - nothing mesh-like;
// 4. every pack blob of chars/ is covered by the licence record: ATTRIBUTION.txt names the LDraw files the character builders used (3626b head, 3820 hand, body parts, hair / headgear parts) and CC BY.
// Skips with a note without the pack / game folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { decodeBody } from '../../src/mods/lego3d/chars/bodypack.ts';
import { decodeStatic } from '../../src/mods/lego3d/chars/static.ts';
import { parseMsh } from '../../src/formats/msh.ts';
import { parseSvwl, skinPositions } from '../../src/formats/anim.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const GRID = 0.01;
const cell = (v) => Math.round(v / GRID);
const vkey = (x, y, z) => ((cell(x) + 4096) * 8192 + (cell(y) + 4096)) * 8192 + (cell(z) + 4096);   // < 2^39: exact in a double
const tkey = (a, b, c) => { const s = [a, b, c].sort((p, q) => p - q); return `${s[0]},${s[1]},${s[2]}`; };

export default {
  name: 'lego3d-chars-audit',
  async run(ctx) {
    const failures = [], notes = [];
    if (!fs.existsSync(PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent: skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    if (!pack.has('chars/tables.json')) return { checked: 0, failures, notes: ['pack has no chars part: skipped'] };
    const names = pack.names().filter((n) => n.startsWith('chars/') && n !== 'chars/tables.json');
    if (!names.length) return { checked: 0, failures, notes: ['no chars blobs'] };
    // --- the game's triangles (local positions of every mesh; the reference-pose world positions of every skinned one)
    const BONES = (await pack.json('chars/tables.json')).bind;
    const game = new Set();
    let meshes = 0, tris = 0;
    const seen = new Set();
    for (const a of ctx.archives) {
      if (!/^z\d\d/i.test(a.name)) continue;
      for (const e of a.entries) {
        if (!/\.msh$/i.test(e.path)) continue;
        let bytes; try { bytes = a.read(e); } catch { continue; }
        // identical contents in many archives: once
        const h = bytes.length + ':' + bytes[bytes.length >> 1] + ':' + bytes[bytes.length >> 2] + ':' + bytes[(bytes.length * 3) >> 2] + ':' + bytes[8];
        if (seen.has(h + e.path.split('/').pop().toLowerCase())) continue;
        seen.add(h + e.path.split('/').pop().toLowerCase());
        let m; try { m = parseMsh(bytes); } catch { continue; }
        meshes++;
        const pos = [m.positions];
        if (m.svwl) { try { pos.push(skinPositions(m.positions, parseSvwl(m.svwl, m.vertexCount), Float32Array.from(BONES))); } catch { /* not a MFIG-rig mesh */ } }
        for (const P of pos) for (const g of m.groups) for (let t = 0; t < g.indexCount; t += 3) {
          const k = [0, 1, 2].map((q) => { const v = m.indices[g.firstIndex + t + q] + g.firstVertex; return vkey(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); });
          game.add(tkey(k[0], k[1], k[2])); tris++;
        }
      }
    }
    notes.push(`game triangles indexed: ${game.size} unique (${tris} read from ${meshes} distinct meshes)`);
    // --- the pack's blobs
    let checked = 0, totalBlobTris = 0, matched = 0, worst = { name: '', frac: 0 };
    for (const n of names) {
      const bytes = await pack.get(n);
      let nV, nT, pos, idx, expect;
      try {
        if (n.startsWith('chars/body/')) { const b = decodeBody(bytes); nV = b.pos.length / 3; nT = b.idx.length / 3; pos = b.pos; idx = b.idx; expect = 36 + nV * 6 + nV * 4 + nV * 4 + nT * 6 + nT * 2; }
        else if (n.startsWith('chars/static/')) { const b = decodeStatic(bytes); nV = b.pos.length / 3; nT = b.idx.length / 3; pos = b.pos; idx = b.idx; expect = 36 + nV * 6 + nT * 6 + nT; }
        else { failures.push(`${n}: unknown kind of blob in the chars part`); continue; }
      } catch (e) { failures.push(`${n}: does not decode: ${e.message}`); continue; }
      checked++;
      if (bytes.length !== expect) failures.push(`${n}: ${bytes.length} bytes, the format accounts for ${expect}: extra data in the blob`);
      // body parts are closed shells (the cuts along the prints leave no crack: every edge of a part has exactly two triangles of opposite direction)
      if (n.startsWith('chars/body/') && !/\/skel/.test(n)) {   // (the skeleton's rib cage is a decimated open lattice of the LDraw part: not a closed shell)
        const b = decodeBody(bytes), perPart = new Map();
        for (let t = 0; t < nT; t++) { const m = perPart.get(b.part[t]) ?? perPart.set(b.part[t], new Map()).get(b.part[t]); for (const [x, y] of [[0, 1], [1, 2], [2, 0]]) { const a = b.idx[t * 3 + x], c = b.idx[t * 3 + y]; if (a === c) continue; const k = a < c ? a * 65536 + c : c * 65536 + a, e = m.get(k) ?? { n: 0, d: 0 }; e.n++; e.d += a < c ? 1 : -1; m.set(k, e); } }
        let open = 0; for (const m of perPart.values()) for (const e of m.values()) if (e.n !== 2 || e.d !== 0) open++;
        if (open) failures.push(`${n}: ${open} open / non-manifold edges inside its parts (a crack)`);
      }
      let hit = 0;
      for (let t = 0; t < nT; t++) {
        const k = [0, 1, 2].map((q) => { const v = idx[t * 3 + q]; return vkey(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); });
        if (game.has(tkey(k[0], k[1], k[2]))) hit++;
      }
      totalBlobTris += nT; matched += hit;
      if (nT && hit / nT > worst.frac) worst = { name: n, frac: hit / nT };
      if (hit >= 12 && hit / nT > 0.2) failures.push(`${n}: ${hit} of ${nT} triangles are triangles of the game's meshes (grid ${GRID})`);
    }
    notes.push(`${checked} blobs, ${totalBlobTris} triangles, ${matched} coincide with a game triangle on the ${GRID} grid (worst blob ${worst.name}: ${(worst.frac * 100).toFixed(1)} %)`);
    // --- tables.json: nothing mesh-like
    const t = await pack.json('chars/tables.json');
    let longest = 0, where = '';
    const walk = (v, p) => { if (Array.isArray(v)) { if (v.length && v.every((x) => typeof x === 'number')) { if (v.length > longest) { longest = v.length; where = p; } } else v.forEach((x, i) => walk(x, `${p}[${i}]`)); } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`); };
    walk(t, 'tables');
    if (longest > 17 * 16) failures.push(`tables.json: a number array of ${longest} entries at ${where}`);
    notes.push(`tables.json: longest numeric array ${longest} (${where})`);
    // --- licence record
    const attr = path.join(path.dirname(PACK), 'ATTRIBUTION.txt');
    if (!fs.existsSync(attr)) failures.push('ATTRIBUTION.txt next to the pack is missing');
    else {
      const text = fs.readFileSync(attr, 'utf8');
      for (const f of ['3626b.dat', '3820.dat', '3815b.dat', '973.dat', '3816.dat', '3818.dat']) if (!text.includes(f)) failures.push(`ATTRIBUTION.txt does not name the LDraw part ${f}`);
      if (!/CC BY/i.test(text)) failures.push('ATTRIBUTION.txt does not state the licence');
      const gearParts = [...new Set(Object.keys(t.statics ?? {}).filter((k) => k.startsWith('gear:')).map((k) => t.statics[k].part).filter(Boolean))];
      for (const p of gearParts) if (!text.includes(p + '.dat')) failures.push(`ATTRIBUTION.txt does not name the gear part ${p}`);
      notes.push(`ATTRIBUTION.txt names the body / head / hand parts and ${gearParts.length} gear parts`);
    }
    return { checked, failures, notes };
  },
};
