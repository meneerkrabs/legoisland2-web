// Header-only collision objects (gaps S5, docs/re/m4/wp6-vehicles.md): the zone loaders of the original load most of the character parts and records with FUN_0043f700 instead
// of the polygon loader FUN_0043f370. FUN_0043f700 reads only the file's header (centre, half extents, radius: col +0x0c / +0x18 / +0x24) and sets the polygon count to 0; the
// object is a bounding volume for the "simple bound" test of NPC records (record flag 0x40, FUN_004410e0) and for the shadow / frustum code, but the sweeps (FUN_00441270,
// case 0: `if (*col != 0)`) find no polygon in it. The island's loader (FUN_004f645b) does that for 188 collision slots: the minifig / brick-bot / swift / Ptera rigs, their heads,
// hats and tools, SkBoard.col (the skateboard's record SBRD), Contructopedia.col (CNST), PepperVeg.col (RHCP). That is why the skateboard's own sweeps do not lift Pepper onto
// the board at his feet (the oracle test runs the original FUN_00441270 in the x86 emulator: with SkBoard.col's polygons loaded the original hits the board exactly like the
// port did, tools/tests/m4-s5-colshapes.mjs). The port loads every `.col` with its polygons; this module finds the header-only slots in the loader code and strips the polygons.
import type { Pe, ZoneScene } from '../formats/exe.ts';
import type { Col } from '../formats/col.ts';
import type { World } from './world.ts';

/** FUN_0043f700 (header only) / FUN_0043f370 (polygons) */
export const COL_LOADER_HEADER = 0x43f700, COL_LOADER_POLYGONS = 0x43f370;
/** DAT_0098382c: the array of collision objects; the loader stores slot n at +4 n */
export const COL_ARRAY = 0x98382c;

/**
 * The slots the loader at `loaderAt` loads with the header-only loader, with their file paths. The loader code is `push <path>; call FUN_0043f700; mov reg, [DAT_0098382c];
 * mov [reg + 4 * slot], eax`. `span` is how far from the loader's entry to look (the island's loader is about 0x17000 bytes).
 */
export function headerOnlyColSlots(pe: Pe, loaderAt: number, span = 0x40000): Map<number, string> {
  const out = new Map<number, string>();
  const end = loaderEnd(pe, loaderAt, span);
  for (let a = loaderAt; a < end; a++) {
    if (pe.at(a) !== 0x68 || pe.at(a + 5) !== 0xe8) continue;
    const rel = pe.u32(a + 6) | 0;
    if (((a + 10 + rel) >>> 0) !== COL_LOADER_HEADER) continue;
    // `mov ecx|edx, [0x98382c]` (8b 0d / 8b 15), then `mov [ecx|edx + disp32], eax` (89 81 / 89 82)
    // (the store's displacement is a disp32 for slots >= 32, a disp8 (89 41 / 89 42) for slots 1..31 and none (89 01 / 89 02) for slot 0: WP-MINI found PARA_Chute.col of z38PAR, slot 7, missed)
    for (let b = a + 10; b < a + 40; b++) {
      if (pe.at(b) !== 0x89) continue;
      const m = pe.at(b + 1);
      if (m === 0x81 || m === 0x82) { out.set(pe.u32(b + 2) / 4, pe.cstr(pe.u32(a + 1))); break; }
      if (m === 0x41 || m === 0x42) { out.set(pe.at(b + 2) / 4, pe.cstr(pe.u32(a + 1))); break; }
      if (m === 0x01 || m === 0x02) { out.set(0, pe.cstr(pe.u32(a + 1))); break; }
    }
  }
  return out;
}

/** the end of the function at `at`: the next `int3 int3` padding followed by a `push ebp; mov ebp, esp` prologue (or `span`) */
export function loaderEnd(pe: Pe, at: number, span: number): number {
  for (let a = at + 16; a < at + span; a++) if (pe.at(a) === 0xcc && pe.at(a + 1) === 0xcc && pe.at(a + 2) === 0x55 && pe.at(a + 3) === 0x8b && pe.at(a + 4) === 0xec) return a;
  return at + span;
}

/** a copy of the header of `col` without polygons (FUN_0043f700: count 0, no grid) */
export function headerOnlyCol(col: Col): Col {
  return { ...col, hasPolys: false, count: 0, flags: new Uint32Array(0), surface: new Uint32Array(0), face: new Float32Array(0), edges: new Float32Array(0), polyList: new Uint32Array(0), grid: null };
}

/**
 * Strip the polygons of the collision objects whose slot the loader loaded header-only. The objects are shared per slot (like the original's `DAT_0098382c[slot]`), so they are
 * changed in place. Returns the records that got a header-only object. Call before the nodes' constructors work (they set box shapes on the shared objects).
 */
export function applyHeaderOnlyCols(w: World, pe: Pe, scene: ZoneScene): number[] {
  const slots = headerOnlyColSlots(pe, scene.loaderAt);
  const done = new Set<object>();
  const records: number[] = [];
  for (const sr of scene.records) {
    if (sr.col < 0 || !slots.has(sr.col)) continue;
    const rec = w.records[sr.index];
    const obj = rec?.colObj;
    if (!obj) continue;
    records.push(sr.index);
    if (done.has(obj)) continue;
    done.add(obj);
    (obj as { col: Col }).col = headerOnlyCol(obj.col);
  }
  return records;
}
