// Pack builder "bricks": the brick library of the Bricks archive from LDraw parts (docs/re/lego3d.md section 3.2), measured against the game's own LOD 0 (tools/lego3d/brickfit.mjs).
//   Input : tools/lego3d/brickmap.json (brick -> LDraw part(s) + tier; rejected / none / slab with the reason), the LDraw library, the player's Bricks archive (MEASURING only)
//   Output: pack members bricks/index.json + bricks/lods.bin (LDraw-derived geometry in the game's frame, quantised; per member the content hash of the GAME's original mesh), report in <WORK>/bricks-report.json
// Nothing of the game's geometry is written: only numbers measured from it (rotation / shift) and the hashes of its members.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, WORK } from '../lib.mjs';
import { buildBrickAll, STUD0, STUD1 } from '../brickbuild.mjs';
import { encodeMesh, hashMember } from '../../../src/mods/lego3d/meshpack.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MAP_FILE = path.join(here, '../brickmap.json');

export async function build(ctx) {
  const map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  const a = archive('Bricks');
  const only = process.env.BRICKS_ONLY ? process.env.BRICKS_ONLY.split(',') : null;
  const index = { v: 1, studSides: [STUD0, STUD1], bricks: {} };
  const blobs = [];
  let off = 0;
  const report = [];
  for (const [name, spec] of Object.entries(map.bricks)) {
    if (only && !only.includes(name)) continue;
    const r = buildBrickAll(ctx.lib, a, name, spec.parts.map((p) => p.p ?? p), { used: (infos) => ctx.use(infos), fitScale: !!spec.fitScale, second: spec.second ?? null, b0: spec.b0, b1: spec.b1, mc0: spec.mc0, mc1: spec.mc1, bc1: spec.bc1, nostud: !!spec.nostud });
    r.row.tier = spec.tier;
    report.push(r.row);
    if (!r.lods) { ctx.log(`${name}: ${r.row.status} ${r.row.why ?? ''}`); continue; }
    const entry = { tier: spec.tier, ...(spec.cls ? { cls: spec.cls } : {}), ...(spec.nostud ? { nostud: true } : {}), lods: {} };
    for (const l of Object.keys(r.lods)) {
      const m = r.lods[l], ref = r.refs[l];
      const blob = encodeMesh([{ kind: 0, flags: 0, pos: m.pos, nrm: m.nrm, idx: m.idx }]);
      blobs.push(blob);
      entry.lods[l] = { off, len: blob.length, split: m.split, tris: m.tris, raw: m.raw, verts: m.pos.length / 3, hash: hashMember(ref.bytes) };
      off += blob.length;
    }
    index.bricks[name] = entry;
  }
  const bin = new Uint8Array(off);
  let o = 0;
  for (const b of blobs) { bin.set(b, o); o += b.length; }
  ctx.put('bricks/index.json', JSON.stringify(index));
  ctx.put('bricks/lods.bin', bin);
  fs.writeFileSync(path.join(WORK, 'bricks-report.json'), JSON.stringify({ rows: report, rejected: map.rejected, none: map.none, slab: map.slab }, null, 1));
  const ok = report.filter((r) => r.status === 'ok');
  ctx.log(`${ok.length} bricks built (${ok.filter((r) => r.lod0.verified).length} verified by the numbers), ${bin.length} bytes of mesh data`);
}
