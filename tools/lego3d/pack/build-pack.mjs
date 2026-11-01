#!/usr/bin/env node
// Builds the LEGO 3D data pack (src/mods/lego3d/pack.ts) from the LDraw library (+ the OMR set models, + the game folder for MEASURING fits only: the pack holds numbers and
// LDraw-derived geometry, never the game's meshes or pictures). docs/re/lego3d.md section 8.
//   node tools/lego3d/pack/build-pack.mjs [--only chars,bricks,textures,sets,studs] [--merge-only] [--out FILE]
// Each builder tools/lego3d/pack/<id>.mjs exports  async function build(ctx)  and writes its blobs with ctx.put(name, bytes|string) and the LDraw files it used with ctx.use(infos)
// (a Map file -> { title, author, license } as LDrawLib.flatten returns in `infos`) or ctx.useSet({ set, title, author, license, url, file }). The blobs of a builder go to
// <WORK>/pack-parts/<id>/ (so builders can be run one at a time); the merge step writes the pack (default src/mods/lego3d/data/lego3d.pack) and ATTRIBUTION.txt next to it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LDrawLib } from '../ldraw.mjs';
import { LDRAW, WORK } from '../lib.mjs';
import { writePack } from './packfile.mjs';
import { writeAttribution } from './attribution.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
export const BUILDERS = ['textures', 'bricks', 'chars', 'sets', 'studs'];
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const OUT = opt('--out', path.join(here, '../../../src/mods/lego3d/data/lego3d.pack'));
const PARTS = path.join(WORK, 'pack-parts');

export function makeCtx(id) {
  const dir = path.join(PARTS, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const used = new Map(), sets = [];
  return {
    id, dir,
    ldraw: path.join(LDRAW, 'lib/ldraw'),
    lib: new LDrawLib(path.join(LDRAW, 'lib/ldraw')),
    omr: path.join(LDRAW, 'omr'),
    put(name, bytes) {
      const f = path.join(dir, 'files', name);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, typeof bytes === 'string' ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length));
    },
    use(infos) { for (const [f, i] of infos) used.set(f, { file: path.relative(path.join(LDRAW, 'lib/ldraw'), f), title: i.title, author: i.author, license: i.license }); },
    useSet(s) { sets.push(s); },
    log: (m) => console.log(`[${id}] ${m}`),
    finish() { fs.writeFileSync(path.join(dir, 'used.json'), JSON.stringify({ files: [...used.values()], sets }, null, 1)); },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!args.includes('--merge-only')) {
    for (const id of BUILDERS) {
      if (only.length && !only.includes(id)) continue;
      const f = path.join(here, `${id}.mjs`);
      if (!fs.existsSync(f)) { console.log(`(no builder ${id})`); continue; }
      const ctx = makeCtx(id);
      const t0 = Date.now();
      await (await import(f)).build(ctx);
      ctx.finish();
      console.log(`${id}: done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  }
  // merge
  const files = new Map(), used = new Map(), sets = [];
  for (const id of fs.existsSync(PARTS) ? fs.readdirSync(PARTS).sort() : []) {
    const root = path.join(PARTS, id, 'files');
    const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else files.set(r, new Uint8Array(fs.readFileSync(path.join(d, e.name)))); } };
    if (fs.existsSync(root)) walk(root, '');
    const u = path.join(PARTS, id, 'used.json');
    if (fs.existsSync(u)) { const j = JSON.parse(fs.readFileSync(u, 'utf8')); for (const f of j.files) used.set(f.file, f); sets.push(...j.sets); }
  }
  const built = new Date().toISOString().slice(0, 10);
  const att = writeAttribution([...used.values()], sets);
  files.set('ATTRIBUTION.txt', att);
  const bytes = writePack(files, built);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bytes);
  fs.writeFileSync(path.join(path.dirname(OUT), 'ATTRIBUTION.txt'), att);
  console.log(`pack: ${files.size} blobs, ${(bytes.length / 1e6).toFixed(2)} MB -> ${OUT}`);
}
