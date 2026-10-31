// Shared helpers of the LEGO 3D pilot (docs/re/lego3d.md). Node only; reads the user's own game folder (LE2_GAME), writes only under LE2_LEGO3D (default
// ~/Documents/legoeiland2-extract/lego3d) and never into the repo. Run with node >= 22 (the repo's .ts parsers are imported directly).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Archive } from '../../src/formats/archive.ts';
import { Pe, extractZone } from '../../src/formats/exe.ts';
import { parseTga } from '../../src/formats/tga.ts';
import { parseWib } from '../../src/formats/wib.ts';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const EXTRACT = path.join(os.homedir(), 'Documents/legoeiland2-extract');
export const GAME = process.env.LE2_GAME || path.join(EXTRACT, 'game/Game');
export const WORK = process.env.LE2_LEGO3D || path.join(EXTRACT, 'lego3d');
export const LDRAW = process.env.LDRAW_DIR || path.join(EXTRACT, 'ldraw');
fs.mkdirSync(WORK, { recursive: true });

const archCache = new Map();
export function archive(name) {
  if (!archCache.has(name)) {
    const d = path.join(GAME, '_data');
    const a = new Archive(name, fs.readFileSync(path.join(d, name + '.bod')), fs.readFileSync(path.join(d, name + '.bob')));
    // LE2_MODS=dir1,dir2: mod folders (LI2 Mod Manager layout: <dir>/_data/<archive>/<member>) laid over the archive, like the game's file replacement
    for (const mod of (process.env.LE2_MODS ?? '').split(',').filter(Boolean)) {
      const root = path.join(mod, '_data');
      const hit = fs.existsSync(root) ? fs.readdirSync(root).find((x) => x.toLowerCase() === name.toLowerCase()) : null;
      if (!hit) continue;
      const walk = (dir, rel) => { for (const f of fs.readdirSync(path.join(dir))) { const full = path.join(dir, f), r = rel ? `${rel}/${f}` : f; if (fs.statSync(full).isDirectory()) walk(full, r); else a.override(r, new Uint8Array(fs.readFileSync(full))); } };
      walk(path.join(root, hit), '');
    }
    archCache.set(name, a);
  }
  return archCache.get(name);
}
export const archiveNames = () => fs.readdirSync(path.join(GAME, '_data')).filter((f) => f.endsWith('.bod')).map((f) => f.slice(0, -4));

let _pe, _starts;
export function exe() { return (_pe ??= new Pe(new Uint8Array(fs.readFileSync(path.join(GAME, 'LEGO eiland 2.exe'))))); }
const sceneCache = new Map();
export function scene(zone) {
  if (!sceneCache.has(zone)) { const pe = exe(); _starts ??= pe.functionStarts(); sceneCache.set(zone, extractZone(pe, zone, undefined, _starts)); }
  return sceneCache.get(zone);
}
/** mesh path as written in the EXE ("_data\\z02LGI\\Meshes\\X.msh") -> member path inside the archive ("Meshes/X.msh") */
export const memberOf = (p) => p.replace(/\\/g, '/').split('/').slice(2).join('/');

const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); Buffer.from(d).copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
/** rgba rows top-down (PNG order) */
export function writePngTopDown(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', [])]));
}
/** rgba rows bottom-up (TGA/WIB order, V = 0 at the first row): flipped for PNG */
export function writePngBottomUp(file, w, h, rgba) {
  const f = new Uint8Array(rgba.length);
  for (let y = 0; y < h; y++) f.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
  writePngTopDown(file, w, h, f);
}
/** the game's texture `id` of a zone archive (or any archive holding `textures/TextNNN.tga|wib`): { width, height, rgba (bottom-up), frames? } */
export function textureOf(arch, id, dir = 'textures') {
  const n = String(id).padStart(3, '0');
  for (const name of [`${dir}/Text${n}.tga`, `${dir}/text${n}.tga`]) {
    const e = arch.find(name);
    if (e) { const t = parseTga(arch.read(e)); return { width: t.width, height: t.height, rgba: t.rgba }; }
  }
  const w = arch.find(`${dir}/Text${n}.wib`);
  if (w) { const wi = parseWib(arch.read(w)); return { width: wi.width, height: wi.height, rgba: wi.frames[0], frames: wi.frames.length }; }
  return null;
}

/** contact sheet of textures for looking at: items = [{ width, height, rgba (bottom-up) }], each scaled (nearest) to `cell` px, `cols` per row, grey background where the alpha is < 255 (checker) */
export function contactSheet(file, items, cell = 128, cols = 6) {
  const rows = Math.ceil(items.length / cols), W = cols * (cell + 4), H = rows * (cell + 4);
  const out = new Uint8Array(W * H * 4).fill(40);
  items.forEach((t, i) => {
    if (!t) return;
    const ox = (i % cols) * (cell + 4) + 2, oy = Math.floor(i / cols) * (cell + 4) + 2;
    const s = Math.max(t.width, t.height) / cell;
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const sx = Math.floor(x * s), sy = Math.floor(y * s);
      if (sx >= t.width || sy >= t.height) continue;
      const p = ((t.height - 1 - sy) * t.width + sx) * 4, q = ((oy + y) * W + ox + x) * 4;
      const a = t.rgba[p + 3] / 255, chk = ((x >> 3) + (y >> 3)) & 1 ? 90 : 150;
      for (let c = 0; c < 3; c++) out[q + c] = t.rgba[p + c] * a + chk * (1 - a);
      out[q + 3] = 255;
    }
  });
  writePngTopDown(file, W, H, out);
}
