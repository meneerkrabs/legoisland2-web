// Zone tables compiled into the executable: extract every zone and cross-check against the archives.
import fs from 'node:fs';
import path from 'node:path';
import { Pe, extractZone } from '../../src/formats/exe.ts';
import { parseMsh } from '../../src/formats/msh.ts';

const ZONES = ['z01BPK', 'z02LGI', 'z03PPH', 'z04IFC', 'z05WAB', 'z07CSI', 'z08BKD', 'z09JST', 'z10RGB', 'z13CAI', 'z14OSD', 'z15SSH', 'z16PYA', 'z17WAS', 'z18MMP', 'z20DSP', 'z21FSH', 'z22BIP', 'z23DIP', 'z27TRX', 'z28HAT', 'z36CNT', 'z38PAR', 'z39ASB', 'z40aPO', 'z40OGL', 'z41MAP', 'z42BRP', 'z50LTC', 'z60FRE'];

export default {
  name: 'exe-zones',
  run(ctx) {
    const failures = [], notes = [], noModel = [], colUnset = [];
    const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
    if (!fs.existsSync(exePath)) return { checked: 0, failures: [`missing ${exePath}`] };
    const pe = new Pe(fs.readFileSync(exePath));
    const starts = pe.functionStarts();
    let attachments = 0, checked = 0, totalRecords = 0, totalParts = 0, listMismatch = 0, listShort = 0, meshOk = 0, texOk = 0, colOk = 0, unreferenced = 0;
    for (const zone of ZONES) {
      const arch = ctx.archives.find((a) => a.name === zone);
      if (!arch) { failures.push(`${zone}: archive missing`); continue; }
      let s;
      try { s = extractZone(pe, zone, undefined, starts); } catch (e) { failures.push(`${zone}: ${e.message}`); continue; }
      checked++;
      if (s.warnings.length) failures.push(`${zone}: ${s.warnings.length} warnings, first: ${s.warnings[0]}`);
      if (!s.records.length) failures.push(`${zone}: no records`);
      totalRecords += s.records.length;
      const usedMesh = new Set();
      const rel = (p) => p.split('\\').slice(2).join('/');
      for (const r of s.records) {
        if (!r.name) failures.push(`${zone}: record ${r.index} without name`);
        if (!r.model) { noModel.push(`${zone}#${r.index}`); continue; }
        if (!r.model.parts.some(Boolean)) failures.push(`${zone}: record ${r.index} model without parts`);
        for (const v of [...r.pos, ...r.rot, ...r.scale]) if (!Number.isFinite(v)) { failures.push(`${zone}: record ${r.index} non-finite transform`); break; }
        if (r.col >= 0) {
          const cp = s.colPaths[r.col];
          if (!cp) colUnset.push(`${zone}#${r.index}`); else if (!arch.has(rel(cp))) failures.push(`${zone}: record ${r.index} collision ${cp} missing in archive`); else colOk++;
        }
        for (const at of r.model.attach) {
          if (!at) continue;
          attachments++;
          if (!(at.bone >= 0 && at.bone < 64) || !at.child.parts.some(Boolean)) failures.push(`${zone}: record ${r.index} attachment slot ${at.slot} bone ${at.bone} child without parts`);
          for (const cp of at.child.parts) { if (!cp) continue; const mp = s.meshPaths[cp.mesh]; if (!mp || !arch.has(rel(mp))) failures.push(`${zone}: attachment mesh ${mp} not in archive`); else usedMesh.add(mp); }
        }
        for (const p of r.model.parts) {
          if (!p) continue;
          totalParts++;
          const mp = s.meshPaths[p.mesh];
          if (!mp) { failures.push(`${zone}: record ${r.index} part mesh slot ${p.mesh} has no path`); continue; }
          const e = arch.find(rel(mp));
          if (!e) { failures.push(`${zone}: mesh ${mp} not in archive`); continue; }
          meshOk++; usedMesh.add(mp);
          const list = s.texLists[p.texList];
          if (!list) { failures.push(`${zone}: record ${r.index} texture list ${p.texList} missing`); continue; }
          const m = parseMsh(arch.read(e));
          if (list.length !== m.groups.length) { if (list.length < m.groups.length) listShort++; else listMismatch++; }
          for (const id of list) {
            if (id === -1) continue;
            if (id < 0) { failures.push(`${zone}: texture list ${p.texList} has an unresolved entry`); break; }
            const n = String(id).padStart(3, '0');
            if (!arch.has(`textures/Text${n}.tga`) && !arch.has(`textures/Text${n}.wib`)) { failures.push(`${zone}: texture ${id} (list ${p.texList}) not in archive`); break; }
            texOk++;
          }
        }
      }
      const total = arch.entries.filter((e) => /\.msh$/i.test(e.path)).length;
      unreferenced += total - usedMesh.size;
    }
    notes.push(`${checked} zones, ${totalRecords} placed records, ${totalParts} model parts, ${attachments} bone attachments; mesh paths resolved ${meshOk}, texture ids resolved ${texOk}, collision files resolved ${colOk}`);
    notes.push(`parts whose texture list is longer than the mesh's group count: ${listMismatch}, shorter: ${listShort} (list index = group index; purpose of the extra entries unconfirmed); archive meshes not used by any record part: ${unreferenced} (LOD siblings, attach parts, runtime-chosen)`);
    notes.push(`records without model (dummy/stub records): ${noModel.join(' ') || 'none'}; records pointing at an unset collision slot (placeholder 0xbabababa in the game): ${colUnset.join(' ') || 'none'}`);
    return { checked, failures, notes };
  },
};
