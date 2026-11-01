// Pack builder "textures" (docs/re/lego3d.md): the colour-neutral designs (our own Blender renders of LDraw geometry, tools/lego3d/designs.mjs) and, per archive, the table that says which
// of the game's pictures they replace: archive, texture id, design, designs per tile, phase, polarity, size and content hash of the original (a hash is a name, not content).
// The game's pictures are only MEASURED here (best design / phase by correlation on the luminance); the pack gets none of their pixels and no colours (the colour is measured again from
// the player's own picture at run time).
//   node tools/lego3d/pack/build-pack.mjs --only textures
// Report (every texture: design, phase, correlation, why not) -> $LE2_LEGO3D/pack-parts/textures-report.json ; proof sheets are made by tools/lego3d/textures-proof.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { archive, archiveNames, scene, textureOf, WORK } from '../lib.mjs';
import { DESIGNS, renderDesign, STUD_CELL } from '../designs.mjs';
import { fnv1a } from '../../../src/mods/lego3d/gen/surf.ts';

/** walls (design, studs per tile = 1 design repeat, keep the painted vegetation of the original) */
export const WALLS = [
  { arch: 'z02LGI', id: 35, design: 'wall-dark' },
  { arch: 'z02LGI', id: 24, design: 'wall-dark', keepGreen: 1 },
  { arch: 'z04IFC', id: 55, design: 'wall-dark' },
  { arch: 'z05WAB', id: 16, design: 'wall-white' },
];
/** the minimum correlation of a stud texture with its design to take it (the shaded 3D-look ones of z04IFC / z05WAB reach about 0.4: they are accepted below, see ACCEPT_LOW) */
const MIN_NCC = 0.45;
/** lower correlations that were looked at by eye and are stud plates (baked-sun crescents, thin outlines) */
const ACCEPT_LOW = new Set(['z04IFC#12', 'z05WAB#2', 'z05WAB#3', 'z36CNT#12', 'z02LGI#138']);
/** periodic pictures that look like stud plates to the correlation but are not (looked at by eye): a hazard-stripe X pattern */
const EXCLUDE = new Set(['z14OSD#46', 'z23DIP#52', 'z15SSH#62']);   // z15SSH #62: 4 x 4 small studs with long baked cast shadows: no sun-free design reproduces it, it stays the game's own (docs)
/** 4 x 4 studs per tile (16 studs, baked shading): the quarter-tile periodicity filter would drop it */
const FORCE_N4 = new Set(['z15SSH#62']);
/** the baked-shadow ("3D look") plates: the crescent design, polarity (bump / pit) and phase by correlation, studs per tile as given */
const SHADED = { 'z04IFC#12': 2, 'z05WAB#2': 2, 'z05WAB#3': 2, 'z36CNT#12': 2 };   // (z15SSH #62, 4 x 4 small studs with long cast shadows, stays on the plain design: see docs)

const lumOf = (t) => { const o = new Float32Array(t.width * t.height); for (let i = 0; i < o.length; i++) o[i] = 0.3 * t.rgba[i * 4] + 0.59 * t.rgba[i * 4 + 1] + 0.11 * t.rgba[i * 4 + 2]; return o; };
function periodic(L, W, H, lx, ly) {
  let m = 0; for (const v of L) m += v; m /= L.length;
  let v = 0, cx = 0, cy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = L[y * W + x] - m; v += a * a; cx += a * (L[y * W + ((x + lx) % W)] - m); cy += a * (L[((y + ly) % H) * W + x] - m); }
  return v < 1e-3 ? 0 : Math.min(cx, cy) / v;
}
function box(d, dw, dh, cw, ch) {
  const out = new Float32Array(cw * ch), fx = dw / cw, fy = dh / ch;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    let s = 0;
    for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) s += d[(y * fy + j) * dw + x * fx + i];
    out[y * cw + x] = s / (fx * fy);
  }
  return out;
}
/** Pearson correlation of the picture L (W x H, row-major) with the cell (cw x ch, tiled, circularly shifted by sx, sy) */
function nccAt(L, W, H, mL, vL, cell, cw, ch, mc, sx, sy) {
  let sab = 0, sbb = 0;
  for (let y = 0; y < H; y++) {
    const cy = ((y - sy) % ch + ch) % ch;
    for (let x = 0; x < W; x++) {
      const b = cell[cy * cw + (((x - sx) % cw) + cw) % cw] - mc, a = L[y * W + x] - mL;
      sab += a * b; sbb += b * b;
    }
  }
  return sab / Math.sqrt(vL * sbb + 1e-9);
}
const stats = (A) => { let m = 0; for (const v of A) m += v; m /= A.length; let v = 0; for (let i = 0; i < A.length; i++) v += (A[i] - m) ** 2; return [m, v]; };
const up = (L, W, H, f) => { const o = new Float32Array(W * f * H * f); for (let y = 0; y < H * f; y++) for (let x = 0; x < W * f; x++) o[y * W * f + x] = L[((y / f) | 0) * W + ((x / f) | 0)]; return o; };
/**
 * Best circular shift of the tiled cell design against the picture, found in two steps: whole pixels of the original on a 3 x 3 blurred copy of both (robust against a half-pixel
 * phase error that kills thin lines), then +-4 pixels of the 4x picture around it on the unblurred ones. Positive correlation only (the design's polarity is never inverted).
 * `design` = the design's field at the cell size of the ORIGINAL (cell, cw x ch) and a function that gives it at 4x (cell4).
 */
function bestShift(L, W, H, cell, cw, ch, nu, nv, cell4) {
  const blur = (A, w, h) => { const o = new Float32Array(A.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += A[((y + j + h) % h) * w + ((x + i + w) % w)]; o[y * w + x] = s / 9; } return o; };
  const Lb = blur(L, W, H), cb = blur(cell, cw, ch);
  const [mL, vL] = stats(Lb), [mc] = stats(cb);
  let best = { ncc: -2, sx: 0, sy: 0 };
  for (let sy = 0; sy < ch; sy++) for (let sx = 0; sx < cw; sx++) {
    const n = nccAt(Lb, W, H, mL, vL, cb, cw, ch, mc, sx, sy);
    if (n > best.ncc) best = { ncc: n, sx, sy };
  }
  // refine at 4x
  const L4 = up(L, W, H, 4), [m4, v4] = stats(L4), [mc4] = stats(cell4.f), cw4 = cell4.w, ch4 = cell4.h;
  let b4 = { ncc: -2, sx: best.sx * 4, sy: best.sy * 4 };
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const sx = best.sx * 4 + dx, sy = best.sy * 4 + dy;
    const n = nccAt(L4, W * 4, H * 4, m4, v4, cell4.f, cw4, ch4, mc4, sx, sy);
    if (n > b4.ncc) b4 = { ncc: n, sx, sy };
  }
  return { ncc: b4.ncc, sx4: ((b4.sx % cw4) + cw4) % cw4, sy4: ((b4.sy % ch4) + ch4) % ch4, cw4, ch4, coarse: best.ncc };
}

export async function build(ctx) {
  const dir = path.join(WORK, 'designs');
  const designs = {};
  for (const name of Object.keys(DESIGNS)) {
    if (!fs.existsSync(path.join(dir, `${name}.bin`))) { ctx.log(`rendering design ${name}`); renderDesign(name, dir); }
    const raw = new Uint8Array(fs.readFileSync(path.join(dir, `${name}.bin`)));
    const j = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    designs[name] = { w: j.w, h: j.h, raw, f: Float32Array.from(raw, (b) => (b - 128) / 127) };
    const blob = new Uint8Array(4 + raw.length);
    blob[0] = j.w & 255; blob[1] = j.w >> 8; blob[2] = j.h & 255; blob[3] = j.h >> 8; blob.set(raw, 4);
    ctx.put(`textures/design/${name}.bin`, blob);
  }
  // which textures does any mesh of the zone archives use (the same set the inventory looked at)? periodic pictures are scored against the designs
  const per = {}, report = [];
  const used = JSON.parse(fs.readFileSync(path.join(WORK, 'inventory/textures.json'), 'utf8'));
  const wallKey = new Set(WALLS.map((w) => `${w.arch}#${w.id}`));
  let scored = 0;
  for (const r of used) {
    if (r.flat || wallKey.has(`${r.zone}#${r.id}`) || EXCLUDE.has(`${r.zone}#${r.id}`)) continue;
    const t = textureOf(archive(r.zone), r.id);
    if (!t || t.frames > 1 || t.width !== t.height || t.width > 64) continue;   // stud tiles are 16 - 64 px
    const L = lumOf(t), W = t.width, H = t.height;
    // quick filter: a stud plate repeats every stud (half the tile) or, for a tile with one cross in the middle, only the tile
    const p2 = periodic(L, W, H, W / 2, H / 2), p4 = W >= 8 ? periodic(L, W, H, W / 4, H / 4) : 1;
    const force = FORCE_N4.has(`${r.zone}#${r.id}`) || `${r.zone}#${r.id}` in SHADED;
    if (!force && (p2 < 0.35 || p4 > 0.6)) continue;
    scored++;
    const cands = [];
    for (const [name, D] of Object.entries(DESIGNS)) {
      if (D.kind !== 'studs') continue;
      if ((name === 'shaded') !== (`${r.zone}#${r.id}` in SHADED)) continue;
      const ns = name === 'shaded' ? [SHADED[`${r.zone}#${r.id}`]] : force ? (D.span === 2 ? [] : [4]) : D.span === 2 ? [1] : [2, 4];
      for (const n of ns) {
        const cw = Math.round(W / n);
        if (cw < 4) continue;
        if ((STUD_CELL * D.span) % cw !== 0) continue;
        const cell = box(designs[name].f, designs[name].w, designs[name].h, cw, cw);
        const cell4 = { f: box(designs[name].f, designs[name].w, designs[name].h, cw * 4, cw * 4), w: cw * 4, h: cw * 4 };
        let b = bestShift(L, W, H, cell, cw, cw, n, n, cell4), inv = 0;
        if (name === 'shaded') { const Ln = L.map((v) => 255 - v), bn = bestShift(Ln, W, H, cell, cw, cw, n, n, cell4); if (bn.ncc > b.ncc) { b = bn; inv = 1; } }
        cands.push({ design: name, n, ...b, cw, inv });
      }
    }
    cands.sort((a, b) => b.ncc - a.ncc);
    // the cross tile contains the plain studs: it only wins when the cross itself is there (clearly better than the best of the others)
    let c = cands[0];
    if (c.design === 'cross') { const o = cands.find((x) => x.design !== 'cross'); if (o && c.ncc < o.ncc + 0.08) c = o; }
    const key = `${r.zone}#${r.id}`;
    const ok = c.ncc >= MIN_NCC || (ACCEPT_LOW.has(key) && c.ncc > 0.15);
    report.push({ tex: key, w: W, design: c.design, n: c.n, ncc: +c.ncc.toFixed(3), shift: [c.sx4, c.sy4], cw: c.cw, ok, second: cands[1] ? `${cands[1].design}/${cands[1].n}:${cands[1].ncc.toFixed(2)}` : '' });
    if (!ok) continue;
    const wrap = (s, cw) => { let v = s / cw; if (v >= 0.5) v -= 1; return +v.toFixed(4); };
    const arch = archive(r.zone), n3 = String(r.id).padStart(3, '0');
    const e = arch.find(`textures/Text${n3}.tga`) ?? arch.find(`textures/text${n3}.tga`);
    (per[r.zone] ??= []).push({ id: r.id, d: c.design, nu: c.n, nv: c.n, pu: wrap(c.sx4, c.cw4), pv: wrap(c.sy4, c.ch4), inv: c.inv ?? 0, w: W, h: H, hash: fnv1a(arch.read(e)) });
  }
  // walls: design = the whole tile; the phase is searched like the stud cells (one design repeat per tile)
  for (const w of WALLS) {
    const t = textureOf(archive(w.arch), w.id);
    const D = designs[w.design];
    if (!t || D.w !== t.width * 4 || D.h !== t.height * 4) { ctx.log(`wall ${w.arch}#${w.id}: design ${w.design} ${D.w}x${D.h} does not fit ${t?.width}x${t?.height}`); continue; }
    const L = lumOf(t);
    const cell = box(D.f, D.w, D.h, t.width, t.height);
    const b = bestShift(L, t.width, t.height, cell, t.width, t.height, 1, 1, { f: D.f, w: D.w, h: D.h });
    const arch = archive(w.arch), n3 = String(w.id).padStart(3, '0');
    const e = arch.find(`textures/Text${n3}.tga`) ?? arch.find(`textures/text${n3}.tga`);
    const wrap = (s, c) => { let v = s / c; if (v >= 0.5) v -= 1; return +v.toFixed(4); };
    (per[w.arch] ??= []).push({ id: w.id, d: w.design, nu: 1, nv: 1, pu: wrap(b.sx4, b.cw4), pv: wrap(b.sy4, b.ch4), inv: 0, w: t.width, h: t.height, hash: fnv1a(arch.read(e)), ...(w.keepGreen ? { keepGreen: 1 } : {}) });
    report.push({ tex: `${w.arch}#${w.id}`, w: t.width, design: w.design, n: 1, ncc: +b.ncc.toFixed(3), shift: [b.sx4, b.sy4], ok: true, wall: true });
  }
  let entries = 0;
  for (const [z, list] of Object.entries(per)) {
    list.sort((a, b) => a.id - b.id);
    ctx.put(`textures/arch/${z.toLowerCase()}.json`, JSON.stringify({ v: 1, archive: z, entries: list }));
    entries += list.length;
  }
  fs.writeFileSync(path.join(WORK, 'textures-report.json'), JSON.stringify(report, null, 1));
  const bad = report.filter((r) => !r.ok);
  ctx.log(`${scored} periodic candidates scored, ${entries} textures in the table (${Object.keys(per).length} archives), ${bad.length} below the threshold: ${bad.map((b) => `${b.tex}(${b.ncc})`).join(' ')}`);
}
