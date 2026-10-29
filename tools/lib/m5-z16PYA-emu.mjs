// z16PYA oracle helper (M5): the original's code run in the x86 interpreter after the Pyramid's own emulated set-up (src/formats/emusetup.ts `run`, docs/re/m5/foundation.md).
//   const O = emuPya(ctx, 36, { hooks })    // O.s = the IslandSetup (O.s.run(fn, args), O.s.mem, O.s.setVar), O.rec(i) = pointer of record i
// The set-up runs against the live game variables of the node; extra host functions (`hooks`: address -> (cpu) => void) override the built-in table (e.g. FUN_0043b72b = the clip).
// The machine is the one the set-up left (records at RECORDS_BASE, the sound handle globals as tokens, the walk node's constructors are NOT run: `loadWalkSounds` runs the loaders
// FUN_004b0b37 / FUN_004b0f16 the SGwalk constructor would, so DAT_009da978 ... hold tokens whose sound ids `soundIds` recovers from the load order).
import { emulateSetup } from '../../src/formats/emusetup.ts';
import { CollisionWorld } from '../../src/game/collision.ts';
import { buildRecords } from '../../src/game/zone.ts';
import { loadExe, sceneOf } from './engine-load.mjs';

export const RECORDS_BASE = 0x10000000, REC = 0x68;
/** DAT_00983840: the buttons pressed this frame; DAT_0098383c: held; DAT_008ae088: Pepper's state mailbox; DAT_009da858: sea level; DAT_009daa7c: the board record */
export const G = { PRESSED: 0x983840, HELD: 0x98383c, MAILBOX: 0x8ae088, SEA: 0x9da858, BOARD: 0x9daa7c, CLOCK_BASE: 0x9dab64 };
/** FUN_004433b0 / FUN_00443580 / FUN_00443290: the sound loads (token = SND_TOK + the index of the load) */
const LOAD_FNS = new Set([0x4433b0, 0x443580, 0x443290]);
const SND_TOK = 0x5a000000;

export function terrainOf(scene, archive) {
  let cw = null;
  return (ground, x, y, z, dy) => {
    if (!cw) { cw = new CollisionWorld(); cw.records = buildRecords(scene.zone, scene, archive).records; }
    cw.groundRec = cw.records[ground] ?? null;
    const h = cw.terrainHeight(x, y, z, dy);
    return h <= -1e38 ? null : h;
  };
}

export function emuPya(ctx, node, o = {}) {
  const pe = loadExe(ctx.dataRoot);
  const scene = sceneOf(ctx, 'z16PYA');
  const archive = ctx.archives.find((a) => a.name.toLowerCase() === 'z16pya');
  const m = new Map([[0x58, node], [2, 1], ...Object.entries(o.vars ?? {}).map(([k, v]) => [+k, v])]);
  const vars = { get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) };
  const s = emulateSetup(pe, scene, { vars, archive, terrainHeight: terrainOf(scene, archive), hooks: o.hooks }, 'z16PYA');
  const mem = s.mem;
  const O = {
    s, mem, pe, vars: m, scene, archive,
    rec: (i) => RECORDS_BASE + i * REC,
    /** the sound ids behind the tokens of every load so far (set-up and runs, in order) */
    soundIds() { const t = new Map(); let k = 0; for (const c of s.calls) if (LOAD_FNS.has(c.fn)) { t.set(SND_TOK + k, c.info?.id ?? c.info?.name ?? -1); k++; } return t; },
    /** the loaders the SGwalk constructor runs (FUN_0042f470 -> FUN_004b0b37 + FUN_004b0f16) */
    loadWalkSounds() { s.run(0x4b0b37, []); s.run(0x4b0f16, []); },
    /** write a record's matrix (16 floats at +0xc) and its three Euler angles (+0x4c ..) */
    putMatrix(i, mat, rx = 0, ry = 0, rz = 0) { const a = RECORDS_BASE + i * REC; for (let k = 0; k < 16; k++) mem.wf32(a + 0xc + 4 * k, mat[k]); mem.wf32(a + 0x4c, rx); mem.wf32(a + 0x50, ry); mem.wf32(a + 0x54, rz); },
  };
  return O;
}
