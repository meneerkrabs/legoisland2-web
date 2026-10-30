// WP-SAVE (hubs z14OSD / z16PYA / z23DIP / z40OGL): oracle helpers on top of tools/lib/m8-save.mjs.
//  * the original's node memory comes from the DEBUG heap (FUN_00433d38 -> __nh_malloc_dbg): fresh blocks are filled with 0xCD, so bytes a constructor never writes (padding, never-initialised
//    words) are 0xCD in the original's save file. The emulation's bump allocator hands out zeroed memory, so `withCdAlloc` makes every small allocation of the run 0xCD-filled (a harness
//    fix: the node bytes are then what the real process has);
//  * `hubOracle(ctx, zone)`: `buildHubOracle` with z14OSD's code range as an extra host for the zones that attach its constructors (Gems / scorpion / Tumblewd, z16PYA and z23DIP).
import { buildHubOracle } from './m8-save.mjs';
import { IslEmu } from './m7-isl-veh-emu.mjs';
import { ZoneEmu } from './m7-zone-emu.mjs';
import { loadExe } from './engine-load.mjs';
import { zoneCodeIndex } from '../../src/formats/zonesetup.ts';

/** run `fn` with the emulations' allocator filling fresh blocks (<= 4 KiB; only the sizes in `sizes` when given: the node sizes of a family test that does not model the framework's own uninitialised words) with 0xCD */
export function withCdAlloc(fn, sizes = null) {
  const saved = [[IslEmu.prototype, IslEmu.prototype.alloc], [ZoneEmu.prototype, ZoneEmu.prototype.alloc]];
  for (const [proto, orig] of saved) {
    proto.alloc = function (n) { const p = orig.call(this, n); if (n <= 0x1000 && (!sizes || sizes.includes(n))) { const m = this.cpu.mem; for (let i = 0; i < n; i++) m.w8(p + i, 0xcd); } return p; };
  }
  try { return fn(); } finally { for (const [proto, orig] of saved) proto.alloc = orig; }
}

export function hubOracle(ctx, z, o = {}) {
  const pe = loadExe(ctx.dataRoot);
  const osd = zoneCodeIndex(pe).get('z14osd');
  return withCdAlloc(() => buildHubOracle(ctx, z, { ...o, extraExec: [...(z === 'z14OSD' ? [] : [[osd.lo, osd.hi]]), ...(o.extraExec ?? [])] }));
}

import { decorSetsOf } from '../../src/island/vehicles/looks.ts';
/** the decor sets' era table (FUN_00420674: rows of 0x18 bytes at 0x8acb98, +0 = the variant count, ends at the first -1) as the machine holds it and as the port's `decorSetsOf(world)` holds it */
export function eraRows(emu) {
  const m = emu.cpu.mem, out = [];
  for (let a = 0x8acb98; ; a += 0x18) { const v = m.r32(a) | 0; out.push(v); if (v === -1 || out.length > 64) break; }
  return out;
}
/** '' = the same, else a description */
export function eraDiff(emu, world) {
  const o = eraRows(emu), p = decorSetsOf(world)?.groups ?? null;
  if (!p) return 'port has no decor sets';
  return o.join() === p.slice(0, o.length).join() ? '' : `original ${o.join()} port ${p.slice(0, o.length).join()}`;
}
/** game-variable changes that move the era table (story node, trophy variables) */
export const ERA_VARS = [[0x58, 0x30], [0x49, 3], [0x90, 3], [0xb9, 3], [0x8f, 3]];

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// PeppSwDuel: the Pyramid's / Dino island's mode switch PeppSw (z16PYA 0x677350, z23DIP 0x727e84), the ORIGINAL's node built by its own constructor in the CD-filled debug heap and driven natively
// (pre-render FUN_00676d95 / FUN_007277f1 called directly with a SCRIPTED state: buttons, PEPPER_CONTROL, mailbox, clip, Pepper's place / forward row, a scripted ground) next to the port's node
// (`prerender` with the same state), tolerance 0. Not the subject (hosted by the shared machine, tools/lib/m7-isl-veh-emu.mjs): collision answers (the scripted ground, the SAME function on both
// sides), animation instances, sounds, variables. The Enter key is never pressed (the look cycler of the island's roster is not mirrored in the port world here).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
import { RECORDS_BASE, REC, VAR_ARRAY, VAR_COUNT } from './m7-isl-veh-emu.mjs';
import { nativeNodes, portNodes } from './m8-save.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';

const NO_GROUND = Math.fround(-1e38);
export const SWITCH = {
  z16PYA: { ctor: 0x677350, pre: 0x676d95, sea: -400, pep: 3, board: 17 },
  z23DIP: { ctor: 0x727e84, pre: 0x7277f1, sea: -80, pep: 16, board: 28 },
};

export class PeppSwDuel {
  constructor(ctx, zone, o = {}) {
    const S = SWITCH[zone];
    this.S = S; this.zone = zone;
    const B = hubOracle(ctx, zone, o);
    this.B = B; this.P = B.P; this.O = B.O; this.emu = B.emu; this.W = B.P.world;
    const mem = this.emu.cpu.mem;
    // the port: the hub framework's `ctorInit` of every node (src/hub/game.ts), the node under test
    for (const rec of this.W.records) for (const n of rec.ctrl?.nodes ?? []) n.ctorInit?.(this.W, rec);
    this.pep = this.W.records[S.pep];
    this.sw = portNodes(this.pep)[0];
    this.on = nativeNodes(this.emu, S.pep)[0];
    if (!this.sw || !this.on || this.on.ctor !== S.ctor || this.sw.ctor !== S.ctor) throw new Error(`${zone}: PeppSw not found (${this.on?.ctor}, ${this.sw?.ctor})`);
    this.W.dt = 1; this.W.externalInput = true;
    vehicles(this.W).board = S.board;           // DAT_009daa7c (the zones' afterSetup: applyPyaSetup / setBoardRecord)
    this.W.seaLevel = Math.fround(S.sea); mem.wf32(0x9da858, S.sea);
    this.log = [];
    this.t = 0;
  }
  rec(i) { return this.W.records[i]; }
  orec(i) { return this.O.world.records[i]; }
  /** a scripted ground for both worlds (the same function): `g(x, z)` = the height or null */
  script(g) {
    for (const world of [this.W, this.O.world]) world.col.terrainHeight = (x, y, z) => { const h = g(Math.fround(x), Math.fround(z)); return h === null ? NO_GROUND : Math.fround(h); };
  }
  setVar(i, v) { this.emu.cpu.mem.w32(VAR_ARRAY + 4 * i, v); this.W.vars.set(i, v); }
  getVar(i) { return this.W.vars.get(i) | 0; }
  /** Pepper at a place with a heading (the forward row m[8..10] gets a pitch term too) in the port, the oracle world and the machine */
  place(x, y, z, ry, fy = 0) {
    for (const r of [this.pep, this.orec(this.S.pep)]) {
      r.setEuler(0, Math.fround(ry), 0, x, y, z); r.rx = 0; r.ry = Math.fround(ry); r.rz = 0;
      r.m[9] = Math.fround(fy);
    }
    this.emu.putRecord(this.S.pep, this.orec(this.S.pep));
    this.emu.sync();
  }
  setClip(c) { this.pep.anim?.start(c, 0); this.orec(this.S.pep).anim?.start(c, 0); }
  setMailbox(v) { this.emu.cpu.mem.w8(0x8ae088, v); this.W.pep.mailbox = v; }
  setPressed(bits) { this.emu.cpu.mem.w32(0x983840, bits); this.W.input.pressed = bits; }
  /** one pre-render of both machines (the original's FUN_xxxxxx called directly, the port's `prerender`) */
  pre() {
    const cpu = this.emu.cpu;
    this.emu.log = []; this.emu.varWrites = [];
    cpu.steps = 0;
    cpu.call(this.S.pre, [this.emu.recPtr(this.S.pep), this.on.ptr], { maxSteps: 5_000_000 });
    this.sw.prerender(this.W, this.pep, this.pep.ctrl);
    this.t++;
  }
  /** after a pre-render: Pepper, PEPPER_CONTROL, the mailbox, the board, the clip the same in both machines (`fail(msg)` gets a message otherwise) */
  compareWorld(fail, label) {
    const mem = this.emu.cpu.mem, a = RECORDS_BASE + this.S.pep * REC;
    const eqv = (n, o, p) => { if (o !== p) fail(`${label} ${n}: original ${o} port ${p}`); };
    eqv('PEPPER_CONTROL', mem.r32(VAR_ARRAY + 4 * 0x5e) | 0, this.getVar(0x5e));
    eqv('mailbox', mem.r8(0x8ae088), this.W.pep.mailbox & 0xff);
    for (const k of [12, 13, 14]) eqv(`Pepper m[${k}]`, mem.f32(a + 0xc + 4 * k), this.pep.m[k]);
    eqv('Pepper clip', this.orec(this.S.pep).anim?.clip, this.pep.anim?.clip);
    eqv('board shown', mem.r16(RECORDS_BASE + this.S.board * REC + 0x60) & 2, this.rec(this.S.board).flags & 2);
  }
}
