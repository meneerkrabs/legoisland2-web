import { parseMsh, validateMsh } from '../../src/formats/msh.ts';
export default {
  name: 'msh',
  run(ctx) {
    const failures = []; const notes = []; let checked = 0, matlTrunc = 0, svwl = 0;
    let minB = [1e9, 1e9, 1e9], maxB = [-1e9, -1e9, -1e9], uvBad = 0, nBad = 0, vtx = 0;
    for (const { entry, data } of ctx.entries(/\.msh$/i)) {
      checked++;
      try {
        const m = parseMsh(data);
        for (const p of validateMsh(m)) { if (p.startsWith('GTOM index out of MATL')) matlTrunc++; else failures.push(`${entry.fullPath}: ${p}`); }
        if (m.svwl) svwl++;
        for (let i = 0; i < m.vertexCount; i++) {
          vtx++;
          for (let k = 0; k < 3; k++) { const v = m.positions[i * 3 + k]; if (v < minB[k]) minB[k] = v; if (v > maxB[k]) maxB[k] = v; }
          const l = Math.hypot(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]);
          if (Math.abs(l - 1) > 0.1 && l > 1e-3) nBad++;
          if (Math.abs(m.uvs[i * 2]) > 1000 || Math.abs(m.uvs[i * 2 + 1]) > 1000) uvBad++;
        }
      } catch (e) { failures.push(`${entry.fullPath}: ${e.message}`); }
    }
    notes.push(`vertices ${vtx}; position bounds ${minB.map((x) => x.toFixed(0))} .. ${maxB.map((x) => x.toFixed(0))}; |uv|>1000: ${uvBad}; non-unit normals: ${nBad}; meshes with SVWL: ${svwl}; GTOM>MATL (data quirk, tolerated): ${matlTrunc}`);
    if (uvBad) failures.push(`${uvBad} vertices with absurd UVs`);
    return { checked, failures, notes };
  },
};
