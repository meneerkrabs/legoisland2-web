import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { IfcEmu, G } from '../lib/ifc-emu.mjs';
import { placeFigure } from '../../src/zones/z04IFC.ts';
import { IfcRoom, ST, CHAR_PAGE0 } from '../../src/zones/z04IFC/ifc.ts';
import { RF_ENABLED } from '../../src/game/record.ts';
import { readIfcPages } from '../../src/zones/z04IFC/pages.ts';
import { guarded } from '../lib/inject-guard.mjs';

// z04IFC character figures (FUN_0041cbac's end, 0x41d650 .. 0x41d73b, docs/re/m3/z04IFC.md section 4): the original's placement of the figure record of the open character page runs in the x86
// interpreter (24-bit x87) next to the port's `placeFigure`, for the camera of EVERY state / counter of the room's camera machine (FUN_0054c00d: 9 states x 0 .. 24 counters; the view matrix
// is FUN_0043cc5c natively) and for each of the 28 figure records. Compared bit for bit (tolerance 0): the 16 matrix floats, the record flags, and the port camera's view basis against the one
// the original's look-at leaves in the camera (DAT_009da5e8 + 0x24 .. 0x44). The page -> record link (item 0 of the character pages, FUN_0054c4a7) is read from the emulated memory after the
// controller's constructor ran.
const BITS = new Float32Array(1), U = new Uint32Array(BITS.buffer);
const bits = (v) => { BITS[0] = v; return U[0]; };
export default guarded({
  name: 'm8-z04IFC-figures',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 12) failures.push(m); };
    const pe = loadExe(ctx.dataRoot);
    const L = loadZone(ctx, 'z04IFC');
    const world = L.world, recs = world.records;
    const pages = readIfcPages(pe);
    const init = recs.map((r) => ({ name: r.name, m: Array.from(r.m) }));
    const emu = new IfcEmu(pe, init, () => 0);
    const mem = emu.cpu.mem;
    emu.loadSounds(); emu.makeController(); emu.makeDoor();
    const room = new IfcRoom(pages, { play() {}, restart() {}, pepperClip() {}, pick: () => 0, text: (id) => id, setVar() {} });
    const cam = world.camera;
    const figs = []; for (let k = 1; k <= 29; k++) if (k !== 7) figs.push(k);
    let cams = 0, worstUp = 0;
    for (let state = 0; state <= 8; state++) {
      for (let cnt = 0; cnt <= 24; cnt++) {
        // original: the controller's pre-render with this state / counter (camera + view matrix)
        mem.w32(emu.ctl + 0x18, state); mem.w32(emu.ctl + 0x1c, cnt);
        emu.cpu.call(0x54c00d, [emu.recPtr(7), emu.ctl]);
        // port: the same machine, then the camera's view
        room.state = state; room.cnt = cnt; room.exitAsk = 0;
        room.camera();
        for (let i = 0; i < 3; i++) { cam.c[i] = room.eye[i]; cam.c[3 + i] = room.target[i]; }
        cam.updateView();
        cams++;
        for (let i = 0; i < 18; i++) {
          if (i >= 9 && i < 12 && false) continue;
          checked++;
          const o = emu.f(G.CAM + 4 * i), p = cam.c[i];
          if (bits(o) !== bits(p) && !(o === 0 && p === 0)) bad(`state ${state} cnt ${cnt}: camera float ${i}: original ${o} port ${p}`);
        }
        for (const k of figs) {
          // original: the record starts from the scene's matrix, flags 0
          init[k].m.forEach((v, j) => mem.wf32(emu.recPtr(k) + 0xc + 4 * j, v));
          mem.w16(emu.recPtr(k) + 0x60, 0);
          emu.placeFigure(k);
          const m = new Float32Array(init[k].m);
          placeFigure(m, cam.c);
          for (let j = 0; j < 16; j++) {
            checked++;
            const o = emu.f(emu.recPtr(k) + 0xc + 4 * j);
            if (bits(o) !== bits(m[j])) bad(`state ${state} cnt ${cnt} record ${k}: matrix ${j}: original ${o} port ${m[j]}`);
          }
          checked++;
          if (mem.r16(emu.recPtr(k) + 0x60) !== RF_ENABLED) bad(`record ${k}: flags ${mem.r16(emu.recPtr(k) + 0x60)} (port sets ${RF_ENABLED})`);
        }
      }
    }
    // ---- which record shows which page: item 0 of the character pages after FUN_0054c4a7 (the controller's constructor) ran
    const ctxp = emu.alloc(0x100);
    emu.cpu.hooks.set(0x433d38, (c) => { c.eax = emu.alloc(0x40); });
    emu.cpu.hooks.set(0x439126, (c) => { c.eax = emu.alloc(0x10); });
    emu.cpu.hooks.set(0x41c1a7, (c) => { c.eax = ctxp; });
    emu.cpu.native.add(0x54c4a7);
    emu.cpu.call(0x54c4a7, [emu.recPtr(7), 0, 0, 0, 2, 1]);
    const table = mem.r32(ctxp + 100) >>> 0;
    for (let p = CHAR_PAGE0; p < CHAR_PAGE0 + 29; p++) {
      const items = mem.u32(table + p * 20 + 8);
      const rp = mem.u32(items + 0x44);
      const rec = (rp - emu.recPtr(0)) / 0x68;
      checked++;
      if (rec !== p - CHAR_PAGE0 + 1) bad(`page ${p}: the original links record ${rec}, the port shows record ${p - CHAR_PAGE0 + 1}`);
      checked++;
      if (pages[p].items[0].value !== rec) bad(`page ${p}: pages.ts item 0 value ${pages[p].items[0].value}, original record ${rec}`);
    }
    notes.push(`${cams} cameras (9 states x 25 counters) x 28 figures, ${checked} values compared bit for bit; page -> record links of the 29 character pages read from the original's constructor`);
    return { checked, failures, notes };
  },
});
