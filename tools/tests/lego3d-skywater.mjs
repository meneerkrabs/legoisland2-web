// LEGO 3D and the sky / the water (docs/re/lego3d.md section 19): the generators write NOTHING of the sky, the sea, the sea bed, the shore foam, the flowing water, the water planes or the star backdrops: not their meshes and not their
// textures, in any of the zone archives, with all generators on. (The exactness of the renderer for these records is tested by render-viewplane / wp-time-water-uv / wp-time-foam-hook / m3-z38PAR; this test pins the other
// half: that the option cannot change what they draw.) The records are found from the executable's zone tables (record names SSKY SSEA SEAB SEAE SKY0 SKY1 SKY_ SKIE STAR NITE WATE WATR WASH SBED FALL, the splash / ripple / wake decals RIPB RIPD RIPJ RIPP WAKP WAKR WAKS SPLH ... and any mesh whose file
// name says sky / sea / wash / scum / water / river / starfield / background, the seaplane excluded) plus the texture of each of their groups. Skips when the pack or the executable is absent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const NAMES = /^(SSKY|SSEA|SEAB|SEAE|SKY\d?|SKY_|SKIE|STAR|NITE|WATE|WATR|WASH|SBED|FALL|RIVR|WTCL|LAVA|LFLO|BURN|RIPB|RIPD|RIPJ|RIPP|WAKP|WAKR|WAKS|SPLH)$/;
const FILES = /^(sky|sky_back|sea\b|sea\.|sea_|seabed|under_?sea|underwater|wash|scum|sea__scum|water|wate_|waterfall|waterfount|river|pool_water|starfield|sky_backround|background|nite_|flashystar|multicolorstar|lava)/i;

export default {
  name: 'lego3d-skywater',
  async run(ctx) {
    const failures = [], notes = [];
    if (!fs.existsSync(PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent: skipped'] };
    const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
    if (!fs.existsSync(exePath)) return { checked: 0, failures, notes: ['executable absent: skipped'] };
    const { Pe, extractZone } = await import('../../src/formats/exe.ts');
    const pe = new Pe(new Uint8Array(fs.readFileSync(exePath))), starts = pe.functionStarts();
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    let checked = 0, records = 0, textures = 0, archives = 0, controlMeshes = 0, controlTex = 0;
    const kinds = new Map();
    for (const arch of ctx.archives) {
      if (!/^z\d/i.test(arch.name)) continue;
      let sc; try { sc = extractZone(pe, arch.name, undefined, starts); } catch { continue; }
      const res = await generateArchive(pack, arch.name, arch, async () => null, []);
      const written = new Set([...res.files.keys()].map((k) => k.toLowerCase()));
      archives++;
      // the check is only as good as the path / id spelling: over ALL records of the zone the same spelling must hit the generators' output somewhere (the control: the option does write meshes and textures)
      for (const r of sc.records) for (const p of (r.model?.parts ?? []).filter(Boolean)) {
        const mp = (sc.meshPaths[p.mesh] ?? '').replace(/\\/g, '/').split('/').slice(2).join('/').toLowerCase();
        if (written.has(mp)) controlMeshes++;
        for (const id of sc.texLists[p.texList] ?? []) if (id != null && id >= 0 && written.has(`textures/text${String(id).padStart(3, '0')}.tga`)) controlTex++;
      }
      const seen = new Set();
      for (const r of sc.records) {
        if (!r.model) continue;
        const parts = r.model.parts.filter(Boolean);
        const files = parts.map((p) => (sc.meshPaths[p.mesh] ?? '').replace(/^.*[\\/]/, ''));
        const env = NAMES.test(r.name.trim()) || files.some((f) => FILES.test(f));
        if (!env) continue;
        const key = r.name.trim() + files.join(',');
        if (seen.has(key)) continue; seen.add(key); records++;
        kinds.set(r.name.trim(), (kinds.get(r.name.trim()) ?? 0) + 1);
        for (const p of parts) {
          const mp = (sc.meshPaths[p.mesh] ?? '').replace(/\\/g, '/').split('/').slice(2).join('/').toLowerCase();
          checked++;
          if (written.has(mp)) failures.push(`${arch.name} ${r.name.trim()}: the mesh ${mp} is written by ${res.by.get([...res.files.keys()].find((k) => k.toLowerCase() === mp))}`);
          for (const id of sc.texLists[p.texList] ?? []) {
            if (id == null || id < 0) continue;
            textures++; checked++;
            for (const t of [`textures/text${String(id).padStart(3, '0')}.tga`, `textures/text${id}.tga`]) if (written.has(t)) failures.push(`${arch.name} ${r.name.trim()}: the texture ${t} is written`);
          }
        }
      }
    }
    if (!controlMeshes || !controlTex) failures.push(`control failed: the generators' output was not found through the same spelling (${controlMeshes} meshes, ${controlTex} textures)`);
    if (!records) failures.push('no sky / sea records found: the scene tables did not load');
    notes.push(`${archives} zone archives, ${records} sky / sea / foam / water / backdrop records (${[...kinds].map(([k, v]) => `${k} ${v}`).join(', ')}), ${textures} group textures: none written by any generator (control: the same lookup finds ${controlMeshes} replaced meshes and ${controlTex} replaced textures over all records)`);
    return { checked, failures, notes };
  },
};
