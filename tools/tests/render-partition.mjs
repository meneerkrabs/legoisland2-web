// The mesh partition of the Graph library (src/render/partition.ts: `FUN_0088069b`, called by the zones' set-ups as `FUN_00444530(mesh, nx, ny, nz)`) against the ORIGINAL code on the x86
// emulator: for real meshes of the zones that call it and for random triangle soups, every cell's triangles per group (the vertices the original copies into the cell's own vertex buffer,
// in order) are compared with the port's cell lists. Also: the executable's 16 call sites of FUN_00444530 against `PARTITIONS`, and the draw order claim (group-major, cell-minor).
//   the meshes of 1500 - 7000 vertices (z13CAI SEAB, z28HAT LAND / canopies ...) run with PARTITION_FULL=1 (2 minutes); the 10 - 33 k vertex terrains (z02LGI / z13CAI / z15SSH / z27TRX LAND) take the original hours in the emulator and are not run (same code path as the rest); PARTITION_ONLY=<part of a mesh label | soup>
import { createGameCpu } from '../../src/formats/x86emu.ts';
import { decode } from '../../src/formats/x86.ts';
import { parseMsh } from '../../src/formats/msh.ts';
import { partitionMesh, cellIndexOrder, PARTITIONS } from '../../src/render/partition.ts';
import { loadExe, sceneOf } from '../lib/engine-load.mjs';

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const HEAP = 0x20000000, HEAP_END = HEAP + 0x6000000;
const bits = (f) => new Uint32Array(new Float32Array([f]).buffer)[0];

/** run FUN_0088069b on the mesh; returns per cell, per group the list of triangles as 9 position floats + 6 uv floats */
function runOriginal(pe, src, nx, ny, nz) {
  const cpu = createGameCpu(pe);
  const mem = cpu.mem;
  mem.addRegion({ lo: HEAP, hi: HEAP_END, name: 'heap' });
  let brk = HEAP + 0x1000;
  const alloc = (n) => { const p = brk; brk = (brk + n + 15) & ~15; if (brk > HEAP_END) throw new Error('heap'); return p; };
  cpu.hooks.set(0x433d38, (c) => { c.eax = alloc(c.arg(0)); });   // SDMem2 allocator (size, 1, file, line)
  cpu.hooks.set(0x434188, (c) => { c.eax = alloc(c.arg(0)); });   // operator new
  cpu.hooks.set(0x443c70, () => {});                                // the progress tick (GetTickCount + two engine calls)
  cpu.hooks.set(0x85eb80, () => {});                                // printf of the "rejected" diagnostic
  mem.w32(0x98764c, 1);                                             // DAT_0098764c != 0: no Direct3D buffers (the partition itself is the same)
  const n = src.vertexCount;
  const V = alloc(n * 32), N = alloc(n * 12);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) mem.wf32(V + i * 32 + k * 4, src.positions[i * 3 + k]);
    mem.w32(V + i * 32 + 12, 0xffffffff);
    mem.wf32(V + i * 32 + 16, src.uvs[i * 2]); mem.wf32(V + i * 32 + 20, src.uvs[i * 2 + 1]);
  }
  const G = alloc(src.groups.length * 0x14 + 16);
  src.groups.forEach((g, gi) => {
    const ip = alloc(g.indexCount * 2 + 4);
    for (let i = 0; i < g.indexCount; i++) mem.w16(ip + i * 2, src.indices[g.firstIndex + i]);
    mem.w32(G + gi * 0x14, 0); mem.w32(G + gi * 0x14 + 4, g.indexCount); mem.w32(G + gi * 0x14 + 8, g.firstVertex); mem.w32(G + gi * 0x14 + 0xc, g.vertexCount ?? 0); mem.w32(G + gi * 0x14 + 0x10, ip);
  });
  const M = alloc(0x100);
  mem.w32(M + 4, n); mem.w32(M + 0x1c, N); mem.w32(M + 0x24, src.groups.length); mem.w32(M + 0x28, G);
  cpu.regs[1] = M;
  cpu.call(0x88069b, [V, nx, ny, nz], { maxSteps: 4e9 });
  const cells = mem.r32(M + 0x70), arr = mem.r32(M + 0x74);
  const out = [];
  for (let c = 0; c < cells; c++) {
    const cell = mem.r32(arr + c * 4), cv = mem.r32(cell + 8), ng = mem.r32(cell + 0x24), cg = mem.r32(cell + 0x28);
    const groups = [];
    for (let g = 0; g < ng; g++) {
      const cnt = mem.r32(cg + g * 0x14 + 4), base = mem.r32(cg + g * 0x14 + 8), ip = mem.r32(cg + g * 0x14 + 0x10), tris = [];   // (the indices are relative to the group's base vertex `+8`: DrawIndexedPrimitiveVB's start vertex)
      for (let t = 0; t < cnt / 3; t++) {
        const tri = [];
        for (let k = 0; k < 3; k++) { const vi = base + mem.r16(ip + (t * 3 + k) * 2); for (let q = 0; q < 3; q++) tri.push(mem.f32(cv + vi * 32 + q * 4)); for (let q = 0; q < 2; q++) tri.push(mem.f32(cv + vi * 32 + 16 + q * 4)); }
        tris.push(tri);
      }
      groups.push(tris);
    }
    out.push(groups);
  }
  return { cells: out, count: cells };
}

function compare(label, pe, src, nx, ny, nz, failures) {
  const orig = runOriginal(pe, src, nx, ny, nz);
  const mine = partitionMesh(src, nx, ny, nz);
  let checked = 0, tris = 0;
  const fail = (m) => { if (failures.length < 40) failures.push(`${label}: ${m}`); };
  if (orig.count !== mine.cells.length) { fail(`cells ${orig.count} vs ${mine.cells.length}`); return { checked: 1, tris: 0, orig, mine }; }
  for (let c = 0; c < orig.count; c++) {
    for (let g = 0; g < src.groups.length; g++) {
      const a = orig.cells[c][g], b = mine.cells[c][g];
      checked++;
      if (a.length !== b.length) { fail(`cell ${c} group ${g}: ${a.length} triangles vs ${b.length}`); continue; }
      for (let t = 0; t < a.length; t++) {
        tris++;
        const gr = src.groups[g];
        for (let k = 0; k < 3; k++) {
          const vi = gr.firstVertex + src.indices[gr.firstIndex + b[t] * 3 + k];
          const want = [src.positions[vi * 3], src.positions[vi * 3 + 1], src.positions[vi * 3 + 2], src.uvs[vi * 2], src.uvs[vi * 2 + 1]];
          for (let q = 0; q < 5; q++) if (!Object.is(a[t][k * 5 + q], want[q])) { fail(`cell ${c} group ${g} triangle ${t} vertex ${k}[${q}]: ${a[t][k * 5 + q]} vs ${want[q]}`); break; }
        }
      }
    }
  }
  return { checked, tris, orig, mine };
}

export default {
  name: 'render-partition',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    let pe;
    try { pe = loadExe(ctx.dataRoot); } catch (e) { return { checked, failures: [`no executable: ${e.message}`] }; }
    // --- the call sites of FUN_00444530 in the executable: every one is `push p4; push p3; push p2; push 0; mov r, [0x983804]; mov r2, [r + 4 + 0x68 * record]; push r2; call 0x43f160; add esp, 8;
    //     push eax; call 0x444530` (the model of the record, its part 0, then nx = p2, ny = p3, nz = p4); `PARTITIONS` lists them
    {
      const starts = pe.functionStarts();
      const got = [];
      for (let fi = 0; fi < starts.length; fi++) {
        const e = fi + 1 < starts.length ? starts[fi + 1] : starts[fi] + 0x1000;
        const seq = [];
        for (let at = starts[fi]; at < e;) {
          const ins = decode(pe.slice(at, 16) ?? new Uint8Array(16), 0, at);
          if (!ins || ins.len <= 0) break;
          seq.push(ins);
          if (ins.op === 0xe8 && ins.rel === 0x444530) {
            const k = seq.length - 1;
            let c43 = -1;
            for (let i = k - 1; i >= 0 && i >= k - 4; i--) if (seq[i].op === 0xe8 && seq[i].rel === 0x43f160) { c43 = i; break; }
            if (c43 < 0) { failures.push(`call site 0x${at.toString(16)}: no FUN_0043f160 before it`); continue; }
            // before the call: `push r2`, `mov r2, [r + disp]`, `mov r, [0x983804]`, then push 0 and the three immediates
            const mov2 = seq[c43 - 2];
            const disp = mov2.op === 0x8b && mov2.hasMem && mov2.base >= 0 ? mov2.disp : null;
            const imm = [];
            for (let i = c43 - 4; i >= 0 && imm.length < 4; i--) { if (seq[i].op === 0x6a || seq[i].op === 0x68) imm.push(seq[i].imm); else break; }
            if (disp === null || imm.length < 4 || imm[0] !== 0) { failures.push(`call site 0x${at.toString(16)}: pattern not understood (disp ${disp}, imm ${imm})`); continue; }
            got.push({ at, record: (disp - 4) / 0x68, dims: [imm[1], imm[2], imm[3]] });
          }
          at += ins.len;
        }
      }
      checked += got.length;
      if (got.length !== 16) failures.push(`${got.length} call sites of FUN_00444530 (expected 16)`);
      const want = Object.entries(PARTITIONS).flatMap(([z, l]) => l.map(([r, a, b, c]) => `${r}:${a},${b},${c}`)).sort();
      const have = got.map((g) => `${g.record}:${g.dims.join(',')}`).sort();
      if (want.join('|') !== have.join('|')) failures.push(`PARTITIONS ${want.join(' ')} != call sites ${have.join(' ')}`);
      notes.push(`${got.length} call sites of FUN_00444530 = PARTITIONS (${Object.keys(PARTITIONS).length} zones)`);
    }
    // --- the algorithm against the original code
    const meshes = [];
    const pick = (zone, rec, nx, ny, nz, big) => {
      const scene = sceneOf(ctx, zone);
      const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
      const p = scene.records[rec].model.parts[0];
      const member = scene.meshPaths[p.mesh].split('\\').slice(2).join('/');
      meshes.push({ label: `${zone} record ${rec} ${member} (${nx}x${ny}x${nz})`, msh: parseMsh(archive.read(archive.find(member))), nx, ny, nz, big });
    };
    for (const [zone, list] of Object.entries(PARTITIONS)) for (const [rec, nx, ny, nz] of list) pick(zone, rec, nx, ny, nz, ['z15SSH', 'z27TRX', 'z02LGI', 'z13CAI'].includes(zone) && !(zone === 'z27TRX' && rec !== 0 && false));
    const full = !!process.env.PARTITION_FULL;
    let totalTris = 0;
    const only = process.env.PARTITION_ONLY;
    for (const m of meshes) {
      if (only && !m.label.includes(only)) continue;   // PARTITION_ONLY=<substring of the label> ("soup": only the random meshes)
      const verts = m.msh.vertexCount;
      if (verts > (full ? 7000 : 1500)) { notes.push(`skipped (${full ? 'too slow in the emulator: hours' : 'PARTITION_FULL=1'}): ${m.label}, ${verts} vertices`); continue; }
      if (m.msh.matl || m.msh.gtom) notes.push(`${m.label}: has group matrices (MATL / GTOM): the cells have none`);
      const r = compare(m.label, pe, m.msh, m.nx, m.ny, m.nz, failures);
      checked += r.checked; totalTris += r.tris;
      const per = r.mine.cells.map((c) => c.reduce((s, t) => s + t.length, 0));
      const own = m.msh.indices.length / 3;
      notes.push(`${m.label}: ${m.msh.vertexCount} vertices, ${own} triangles -> ${per.reduce((a, b) => a + b, 0)} in ${per.length} cells (${per.reduce((a, b) => a + b, 0) - own} duplicates)`);
    }
    // random triangle soups (three groups, all cell counts, float-boundary stress: vertices on a grid)
    const rand = rng(1234);
    for (let t = 0; t < (!only || only === 'soup' ? 12 : 0); t++) {
      const n = 60 + Math.floor(rand() * 200), groups = [], indices = [];
      const positions = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
      const grid = t % 3 === 0;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) positions[i * 3 + k] = Math.fround(grid ? Math.round((rand() - 0.5) * 20) / 2 : (rand() - 0.5) * 100);
        uvs[i * 2] = Math.fround(rand()); uvs[i * 2 + 1] = Math.fround(rand());
      }
      let ix = 0;
      for (let g = 0; g < 3; g++) {
        const cnt = (5 + Math.floor(rand() * 40)) * 3, first = ix;
        for (let i = 0; i < cnt; i++) indices.push(Math.floor(rand() * n));
        groups.push({ flags: g, indexCount: cnt, firstVertex: 0, vertexCount: n, firstIndex: first });
        ix += cnt;
      }
      const src = { positions, uvs, vertexCount: n, indices: Uint16Array.from(indices), groups };
      const dims = [[1, 1, 1], [8, 1, 8], [3, 2, 4], [1, 1, 20], [20, 1, 1], [2, 2, 2]][t % 6];
      const r = compare(`soup ${t} (${dims.join('x')})`, pe, src, dims[0], dims[1], dims[2], failures);
      checked += r.checked; totalTris += r.tris;
    }
    // --- the draw order: per group (file order) the cells' triangles one after the other
    {
      const src = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5, 6, 5, 5, 5, 6, 5]), uvs: new Float32Array(12), vertexCount: 6, indices: Uint16Array.from([0, 1, 2, 3, 4, 5, 0, 1, 2]), groups: [{ indexCount: 6, firstVertex: 0, firstIndex: 0 }, { indexCount: 3, firstVertex: 0, firstIndex: 6 }] };
      const p = partitionMesh(src, 2, 1, 1);
      const o = cellIndexOrder(src, p);
      checked++;
      if (o.groups.length !== 2 || o.groups[0].first !== 0 || o.groups[1].first !== o.groups[0].count || o.indices.length !== o.groups[0].count + o.groups[1].count) failures.push('cellIndexOrder layout');
    }
    notes.push(`${totalTris} triangles compared against FUN_0088069b run natively`);
    return { checked, failures, notes };
  },
};
