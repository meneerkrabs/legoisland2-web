// Bounds-only collision objects (WP-VERIFY, docs/re/m6/z01BPK.md "Differential test", gaps.md S5).
// The executable has TWO .col loaders: FUN_0043f370 reads the whole file (polygons, grid: `Collision.cpp`) and FUN_0043f700 reads only the 28 byte header (centre, half extents,
// radius: the polygon count is set to 0 and [0x14] / [0x15] = 2.0 / 4.0, the box fields = the half extents). The zone loaders call FUN_0043f700 for the character / part files
// (`PEPP_HR.col`, `MFG_HR*.col`, `OBJT_*.col`, `SkBoard.col` ...): such a record has a bounding sphere / box but NO polygons, so FUN_00441270 / FUN_00441b10 can never hit its polygons.
// That is why the skateboard record SBRD / SKBD (SkBoard.col, 384 polygons in the file) never lifts Pepper in the original: its object has none of them.
import type { Pe } from '../formats/exe.ts';
import type { Col } from '../formats/col.ts';
import { ColObject } from './collision.ts';

/** FUN_0043f370: the full loader, FUN_0043f700: the bounds-only loader */
export const COL_LOAD_FULL = 0x43f370, COL_LOAD_BOUNDS = 0x43f700;

/**
 * The lower-case .col paths (as in the executable: `_data\\z01BPK\\col\\SkBoard.col`) of the zone that its loader reads with FUN_0043f700 (the push of the path string is followed by
 * the call to the loader). Found from the code only.
 */
export function boundsOnlyColPaths(pe: Pe, zone: string): Set<string> {
  const out = new Set<string>();
  for (const s of pe.findStrings(`_data\\${zone}\\col\\`)) {
    const path = pe.cstr(s);
    if (!/\.col$/i.test(path)) continue;
    for (const x of pe.pushXrefs(s)) {
      for (let k = 5; k < 14; k++) {
        if (pe.at(x + k) !== 0xe8) continue;
        const target = ((x + k + 5 + (pe.u32(x + k + 1) | 0)) >>> 0);
        if (target === COL_LOAD_BOUNDS) out.add(path.toLowerCase());
        break;
      }
    }
  }
  return out;
}

/** the object FUN_0043f700 builds from a file: the same centre / half extents / radius, no polygons (the loader's box fields [0x16..0x18] = half extents) */
export function boundsOnly(obj: ColObject): ColObject {
  const c = obj.col;
  const col: Col = {
    center: [...c.center], halfExtents: [...c.halfExtents], radius: c.radius, hasPolys: false, count: 0,
    flags: new Uint32Array(0), surface: new Uint32Array(0), face: new Float32Array(0), edges: new Float32Array(0), polyList: new Uint32Array(0), grid: null, ignoredTail: 0,
  };
  return new ColObject(col, obj.path);
}

/** replace the collision object of every record of `records` whose file the zone loads with FUN_0043f700 (one replacement per shared object); returns the number of records changed */
export function applyBoundsOnly(records: { colObj: ColObject | null }[], pe: Pe, zone: string): number {
  const paths = boundsOnlyColPaths(pe, zone);
  const done = new Map<ColObject, ColObject>();
  let n = 0;
  for (const r of records) {
    const o = r.colObj;
    if (!o || !paths.has(o.path.toLowerCase())) continue;
    let b = done.get(o);
    if (!b) { b = boundsOnly(o); done.set(o, b); }
    r.colObj = b; n++;
  }
  return n;
}
