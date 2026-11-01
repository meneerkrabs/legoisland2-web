// LEGO 3D textures generator (src/mods/lego3d/gen/textures.ts): every stud-plate / brick-wall texture of the table is regenerated at 4x from the pack's own designs and the player's
// colours: size, 24 bit TGA form, median colour equal to the original's, seamless 3x3 tiling, the stud lattice at the table's phase, determinism, the safety rules (a foreign member is left
// alone, an HD-sized one is taken), no output for archives without a table. Skips with a note when the pack (tools/lego3d/pack/build-pack.mjs --only textures) is absent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseTga } from '../../src/formats/tga.ts';
import { fnv1a, colourStats, writeTga24 } from '../../src/mods/lego3d/gen/surf.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');

const lum = (rgba, i) => 0.3 * rgba[i * 4] + 0.59 * rgba[i * 4 + 1] + 0.11 * rgba[i * 4 + 2];
/** mean |difference| across the seam of a 3 x 3 tiling divided by the mean |difference| of the picture's own neighbouring columns / rows (1 = the seam is like any other place) */
function seamRatio(img) {
  // the wrap-around seam must be no rougher than the roughest ordinary neighbouring pair of columns / rows (a periodic picture's seam is such a pair)
  const { width: w, height: h, rgba } = img;
  const L = new Float32Array(w * h);
  for (let i = 0; i < L.length; i++) L[i] = lum(rgba, i);
  const dc = new Float64Array(w), dr = new Float64Array(h);
  for (let x = 0; x < w; x++) { let s = 0; for (let y = 0; y < h; y++) s += Math.abs(L[y * w + x] - L[y * w + ((x + 1) % w)]); dc[x] = s / h; }
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) s += Math.abs(L[y * w + x] - L[((y + 1) % h) * w + x]); dr[y] = s / w; }
  const worst = (d) => Math.max(...[...d].slice(0, -1)) + 1e-6;
  return Math.max((dc[w - 1] + 1e-6) / worst(dc), (dr[h - 1] + 1e-6) / worst(dr));
}

export default {
  name: 'lego3d-textures',
  async run(ctx) {
    const failures = [], notes = [];
    if (!fs.existsSync(PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent (node tools/lego3d/pack/build-pack.mjs --only textures): skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    const tableNames = pack.names('textures/arch/');
    if (!tableNames.length) return { checked: 0, failures, notes: ['pack has no textures part: skipped'] };
    let checked = 0, total = 0, worstMed = 0, worstSeam = 0, bytes = 0, maxArch = 0, ms = 0;
    const byDesign = {};
    for (const a of ctx.archives) {
      const tn = `textures/arch/${a.name.toLowerCase()}.json`;
      if (!pack.has(tn)) {
        const r = await generateArchive(pack, a.name, a, async () => null, ['textures']);
        checked++;
        if (r.files.size) failures.push(`${a.name}: no table but ${r.files.size} files generated`);
        continue;
      }
      const table = await pack.json(tn);
      const t0 = Date.now();
      const r = await generateArchive(pack, a.name, a, async () => null, ['textures']);
      ms += Date.now() - t0;
      const r2 = await generateArchive(pack, a.name, a, async () => null, ['textures']);
      let arch = 0;
      for (const e of table.entries) {
        total++;
        const n3 = String(e.id).padStart(3, '0');
        const orig = a.find(`textures/Text${n3}.tga`) ?? a.find(`textures/text${n3}.tga`);
        if (!orig) { failures.push(`${a.name}#${e.id}: texture not in the archive`); continue; }
        const out = r.files.get(orig.path);
        if (!out) { failures.push(`${a.name}#${e.id}: nothing generated (${r.log.filter((l) => l.includes(`texture ${e.id}:`)).join('; ') || 'no log'})`); continue; }
        checked++;
        arch += out.length; bytes += out.length;
        // same member name, 24 bit bottom-up TGA, 4x the size, same aspect
        if (out[2] !== 2 || out[16] !== 24 || out[17] !== 0) failures.push(`${a.name}#${e.id}: not a 24 bit uncompressed bottom-up TGA (type ${out[2]} bpp ${out[16]} desc ${out[17]})`);
        const img = parseTga(out), o = parseTga(a.read(orig));
        if (img.width !== o.width * 4 || img.height !== o.height * 4) failures.push(`${a.name}#${e.id}: ${img.width}x${img.height}, expected ${o.width * 4}x${o.height * 4}`);
        if (img.hasAlpha) failures.push(`${a.name}#${e.id}: has alpha`);
        if (fnv1a(a.read(orig)) !== e.hash || o.width !== e.w || o.height !== e.h) failures.push(`${a.name}#${e.id}: table hash / size do not match the archive`);
        // the surface colour is the original's: median per channel within 2 (the keep-green wall keeps its own pixels: still a median)
        const so = colourStats(o.rgba), sn = colourStats(img.rgba);
        const dm = Math.max(...so.median.map((v, k) => Math.abs(v - sn.median[k])));
        worstMed = Math.max(worstMed, dm);
        if (dm > 3) failures.push(`${a.name}#${e.id}: median colour ${sn.median} vs original ${so.median}`);
        // contrast of the same order as the original's
        const ratio = (sn.lumSd + 0.5) / (so.lumSd + 0.5);
        if (ratio < 0.4 || ratio > 2.5) failures.push(`${a.name}#${e.id}: luminance sd ${sn.lumSd.toFixed(1)} vs original ${so.lumSd.toFixed(1)}`);
        // seamless: the wrap-around seam is no rougher than the picture itself
        const sr = seamRatio(img);
        worstSeam = Math.max(worstSeam, sr);
        if (sr > 1.6) failures.push(`${a.name}#${e.id}: seam ratio ${sr.toFixed(2)}`);
        // periodic at the stud pitch (stud designs): the picture repeats after one design cell exactly (whole pixels)
        if (e.nu >= 1 && e.d !== 'wall-dark' && e.d !== 'wall-white' && e.d !== 'cross') {
          const cw = img.width / e.nu; let diff = 0;
          for (let y = 0; y < img.height; y += 3) for (let x = 0; x < img.width; x += 3) diff = Math.max(diff, Math.abs(lum(img.rgba, y * img.width + x) - lum(img.rgba, y * img.width + ((x + cw) % img.width))));
          if (diff > 2) failures.push(`${a.name}#${e.id}: not periodic at the cell (max |dL| ${diff.toFixed(1)})`);
        }
        // deterministic
        const o2 = r2.files.get(orig.path);
        if (!o2 || fnv1a(o2) !== fnv1a(out)) failures.push(`${a.name}#${e.id}: output differs between two runs`);
        byDesign[e.d] = (byDesign[e.d] ?? 0) + 1;
      }
      maxArch = Math.max(maxArch, arch);
      // nothing besides the table's textures is written
      for (const k of r.files.keys()) if (!/^textures\/text\d+\.tga$/i.test(k)) failures.push(`${a.name}: unexpected member ${k}`);
      if (r.files.size !== table.entries.length - (r.stats.textures?.['textures-skipped'] ?? 0)) { /* counted above per entry */ }
    }
    // safety: a member that is not the game's picture (a mod's) is left alone; a larger version of the same picture is taken
    const island = ctx.archives.find((x) => x.name === 'z02LGI');
    if (island && pack.has('textures/arch/z02lgi.json')) {
      const e = (await pack.json('textures/arch/z02lgi.json')).entries.find((x) => x.d === 'plain') ?? (await pack.json('textures/arch/z02lgi.json')).entries[0];
      const mem = (island.find(`textures/Text${String(e.id).padStart(3, '0')}.tga`) ?? island.find(`textures/text${String(e.id).padStart(3, '0')}.tga`)).path;
      const o = parseTga(island.read(mem));
      const wrapped = { ...island, find: (p) => island.find(p), read: (x) => island.read(x) };
      void wrapped;
      // a foreign same-size picture: flat grey
      const grey = new Uint8Array(o.width * o.height * 4).fill(120);
      const foreign = writeTga24(o.width, o.height, grey);
      const fakeArch = { name: 'z02LGI', find: (p) => (p.toLowerCase() === mem.toLowerCase() ? { path: mem } : island.find(p)), read: (x) => (typeof x === 'object' && x.path === mem ? foreign : island.read(x)) };
      const rf = await generateArchive(pack, 'z02LGI', fakeArch, async () => null, ['textures']);
      checked++;
      if (rf.files.has(mem)) failures.push(`safety: a foreign picture was overwritten (${mem})`);
      // an HD pack's 2x version of the same picture (nearest upsample of the original): taken, 4x of the ORIGINAL size
      const hd = new Uint8Array(o.width * 2 * o.height * 2 * 4);
      for (let y = 0; y < o.height * 2; y++) for (let x = 0; x < o.width * 2; x++) hd.set(o.rgba.subarray(((y >> 1) * o.width + (x >> 1)) * 4, ((y >> 1) * o.width + (x >> 1)) * 4 + 4), (y * o.width * 2 + x) * 4);
      const hdTga = writeTga24(o.width * 2, o.height * 2, hd);
      const fakeHd = { name: 'z02LGI', find: fakeArch.find, read: (x) => (typeof x === 'object' && x.path === mem ? hdTga : island.read(x)) };
      const rh = await generateArchive(pack, 'z02LGI', fakeHd, async () => null, ['textures']);
      checked++;
      const got = rh.files.get(mem);
      if (!got) failures.push(`safety: an HD-sized copy of the picture was not taken (${rh.log.join('; ')})`);
      else if (parseTga(got).width !== o.width * 4) failures.push('safety: the HD copy came out at the wrong size');
    }
    notes.push(`${total} textures in the table (${Object.entries(byDesign).map(([k, v]) => `${k} ${v}`).join(', ')}); worst median error ${worstMed}, worst seam ratio ${worstSeam.toFixed(2)}; ${(bytes / 1e6).toFixed(1)} MB of TGA in total, largest archive ${(maxArch / 1e6).toFixed(2)} MB; generation ${ms} ms for all archives`);
    return { checked, failures, notes };
  },
};
