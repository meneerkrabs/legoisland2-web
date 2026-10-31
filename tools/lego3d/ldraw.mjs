// Own small LDraw reader (no third-party code). Flattens a .dat part (with all sub-files) into coloured triangles.
//   const lib = new LDrawLib(dir);                       // dir = the folder that holds parts/ p/ models/ (ldraw.org complete.zip, CC BY 2.0 / 4.0 per file)
//   const r = lib.flatten('3626b.dat', { res: 'std', skip: /^stud/ });   // { tris: Float32Array (9 per triangle, LDU, LDraw axes), colors: Uint16Array (1 per triangle), info: {name, author, license} , files: Set }
// Conventions: LDraw is right-handed with -Y up. BFC is honoured (CCW output): a file certified CW or an INVERTNEXT / mirrored sub-file call flips the winding;
// an uncertified file is emitted as given (once). Quads are split 0-1-2 / 0-2-3. Lines (types 2 and 5) are ignored.
import fs from 'node:fs';
import path from 'node:path';

const RES_DIR = { low: 'p/8', std: 'p', high: 'p/48' };

export class LDrawLib {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    this.index = new Map(); // lower-case relative name -> absolute path
    for (const d of ['parts', 'parts/s', 'p', 'p/8', 'p/48', 'models']) {
      const full = path.join(dir, d);
      if (!fs.existsSync(full)) continue;
      for (const f of fs.readdirSync(full)) if (f.toLowerCase().endsWith('.dat')) this.index.set(`${d}/${f.toLowerCase()}`, path.join(full, f));
    }
  }
  /** adds a folder of extra .dat / .ldr files (the sub-models of an OMR .mpd split by splitMpd) to the lookup */
  addDir(dir) { for (const f of fs.readdirSync(dir)) if (/\.(dat|ldr)$/i.test(f)) this.index.set(`extra/${f.toLowerCase()}`, path.join(dir, f)); }
  /** resolve a sub-file reference like LDraw does: parts/, parts/s/, p/ (p/8 or p/48 first at low / high resolution); `s\x.dat` and `8\x.dat` / `48\x.dat` are explicit */
  resolve(name, res) {
    let n = name.replace(/\\/g, '/').toLowerCase().trim();
    const tries = [];
    if (n.startsWith('s/')) tries.push(`parts/${n}`);
    else if (n.startsWith('8/')) tries.push(`p/${n}`);
    else if (n.startsWith('48/')) tries.push(`p/${n}`);
    else {
      if (res === 'low') tries.push(`p/8/${n}`);
      if (res === 'high') tries.push(`p/48/${n}`);
      tries.push(`parts/${n}`, `p/${n}`, `models/${n}`, `parts/s/${n}`);
    }
    tries.push(`extra/${n}`);
    for (const t of tries) if (this.index.has(t)) return this.index.get(t);
    return null;
  }
  parse(file) {
    if (this.cache.has(file)) return this.cache.get(file);
    const text = fs.readFileSync(file, 'utf8');
    const lines = [];
    let bfc = null, ccw = true, invertNext = false;
    const info = { name: path.basename(file), title: '', author: '', license: '' };
    let first = true;
    for (const raw of text.split(/\r?\n/)) {
      const s = raw.trim();
      if (!s) continue;
      const t = s.split(/\s+/);
      const type = t[0];
      if (type === '0') {
        if (first) { info.title = s.slice(1).trim(); first = false; }
        if (t[1] === '!LICENSE') info.license = s.slice(s.indexOf('!LICENSE') + 9).trim();
        else if (t[1] === 'Author:') info.author = s.slice(s.indexOf('Author:') + 7).trim();
        else if (t[1] === 'BFC') {
          for (const w of t.slice(2)) {
            if (w === 'CERTIFY') bfc = true; else if (w === 'NOCERTIFY') bfc = false;
            else if (w === 'CCW') ccw = true; else if (w === 'CW') ccw = false;
            else if (w === 'INVERTNEXT') invertNext = true;
          }
        }
        continue;
      }
      first = false;
      if (type === '1') {
        const m = t.slice(2, 14).map(Number);
        lines.push({ k: 1, col: +t[1], m, file: t.slice(14).join(' '), inv: invertNext });
        invertNext = false;
      } else if (type === '3') lines.push({ k: 3, col: +t[1], v: t.slice(2, 11).map(Number), ccw });
      else if (type === '4') lines.push({ k: 4, col: +t[1], v: t.slice(2, 14).map(Number), ccw });
      else invertNext = false;
    }
    const r = { lines, bfc: bfc === true, info };
    this.cache.set(file, r);
    return r;
  }
  /** opts: res ('low' | 'std' | 'high'), skip (RegExp on the sub-file name: not emitted), only (RegExp: when set, only sub-files directly or deeply below one that matches... not used), matrix (12 numbers, applied at the root) */
  flatten(name, opts = {}) {
    const res = opts.res ?? 'std';
    const root = this.resolve(name, res);
    if (!root) throw new Error(`LDraw part not found: ${name}`);
    const tris = [], cols = [], files = new Set(), infos = new Map(), uncertified = new Set();
    const skip = opts.skip ?? null;
    const walk = (file, M, col, invert, depth, certifiedParent) => {
      const p = this.parse(file);
      files.add(file);
      infos.set(file, p.info);
      if (!p.bfc && p.lines.some((l) => l.k === 3 || l.k === 4)) uncertified.add(file);   // geometry without BFC certification: its winding is not guaranteed
      const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
      const flip = (det < 0) !== invert; // winding flips with a mirrored matrix and with INVERTNEXT
      const tr = (x, y, z) => [M[0] * x + M[1] * y + M[2] * z + M[9], M[3] * x + M[4] * y + M[5] * z + M[10], M[6] * x + M[7] * y + M[8] * z + M[11]];
      const emit = (a, b, c, cc, wccw) => {
        // wccw = the winding as written in this file (true = CCW); the output wants CCW
        let flipped = flip;
        if (!wccw) flipped = !flipped;
        const A = tr(...a), B = tr(...b), C = tr(...c);
        tris.push(...(flipped ? [...A, ...C, ...B] : [...A, ...B, ...C]));
        cols.push(cc === 16 ? col : cc === 24 ? col : cc);
      };
      for (const l of p.lines) {
        if (l.k === 1) {
          if (skip && skip.test(l.file.replace(/\\/g, '/').toLowerCase())) continue;
          const sub = this.resolve(l.file, res);
          if (!sub) { (opts.missing ??= new Set()).add(l.file); continue; }
          const m = l.m; // x y z a b c d e f g h i
          const S = [m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[0], m[1], m[2]]; // rotation rows then translation
          // compose: child matrix S inside parent M: p' = M * (S * p)
          const C = [
            M[0] * S[0] + M[1] * S[3] + M[2] * S[6], M[0] * S[1] + M[1] * S[4] + M[2] * S[7], M[0] * S[2] + M[1] * S[5] + M[2] * S[8],
            M[3] * S[0] + M[4] * S[3] + M[5] * S[6], M[3] * S[1] + M[4] * S[4] + M[5] * S[7], M[3] * S[2] + M[4] * S[5] + M[5] * S[8],
            M[6] * S[0] + M[7] * S[3] + M[8] * S[6], M[6] * S[1] + M[7] * S[4] + M[8] * S[7], M[6] * S[2] + M[7] * S[5] + M[8] * S[8],
            M[0] * S[9] + M[1] * S[10] + M[2] * S[11] + M[9], M[3] * S[9] + M[4] * S[10] + M[5] * S[11] + M[10], M[6] * S[9] + M[7] * S[10] + M[8] * S[11] + M[11],
          ];
          walk(sub, C, l.col === 16 || l.col === 24 ? col : l.col, l.inv ? !invert : invert, depth + 1);
        } else if (l.k === 3) emit([l.v[0], l.v[1], l.v[2]], [l.v[3], l.v[4], l.v[5]], [l.v[6], l.v[7], l.v[8]], l.col, l.ccw);
        else { const v = l.v; emit([v[0], v[1], v[2]], [v[3], v[4], v[5]], [v[6], v[7], v[8]], l.col, l.ccw); emit([v[0], v[1], v[2]], [v[6], v[7], v[8]], [v[9], v[10], v[11]], l.col, l.ccw); }
      }
    };
    const M0 = opts.matrix ?? [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    // a LDraw "matrix" in a type 1 line is a b c / d e f / g h i with x y z first; here M is stored as 9 rotation (row-major) + 3 translation
    walk(root, M0, opts.color ?? 16, false, 0);
    return { tris: new Float32Array(tris), colors: Uint16Array.from(cols), info: this.parse(root).info, infos, files, uncertified, missing: opts.missing };
  }
}

export function bbox(tris) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < tris.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], tris[i + c]); hi[c] = Math.max(hi[c], tris[i + c]); }
  return { lo, hi, size: hi.map((h, i) => h - lo[i]) };
}

/** splits a multi-part .mpd ("0 FILE name" sections) into files in `outDir`; returns the name of the first section (the main model) */
export function splitMpd(mpdPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  let cur = null, first = null, buf = [];
  const flush = () => { if (cur) fs.writeFileSync(path.join(outDir, cur.toLowerCase().replace(/[\\/]/g, '_')), buf.join('\n')); };
  for (const line of fs.readFileSync(mpdPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^0\s+FILE\s+(.+)$/i);
    if (m) { flush(); cur = m[1].trim(); first ??= cur; buf = []; } else buf.push(line);
  }
  flush();
  return first.toLowerCase().replace(/[\\/]/g, '_');
}
