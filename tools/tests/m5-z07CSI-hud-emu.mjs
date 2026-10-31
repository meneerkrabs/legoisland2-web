// M5 z07CSI, the HUD ORACLE: the original's per-frame function FUN_00575ca0 (the centre score text `%04d` of var 0xce, the goblet count `x%d` of var 0xbc, the interaction icon of var 0xc with its 15 / 30 frame
// blink, var 0xc := 0) is CALLED in the emulated machine the set-up of the Castle island left (`IslandSetup.run`) and its results (the icon texture word DAT_05d4e144, the blink
// counter DAT_05d5bc40, the text buffer DAT_05d4dd60, var 0xc) are compared with the port's `CsiHud` (src/zones/z07CSI/hud.ts) over scripted sequences of the variables.
import { loadHub } from '../lib/hub-load.mjs';
import { CsiHud } from '../../src/zones/z07CSI/hud.ts';
import { Hud } from '../../src/shell/hud.ts';
import { GameVars } from '../../src/game/vars.ts';
import '../../src/zones/index.ts';

const SLOT_TEX = 0x5d4e144, BLINK = 0x5d58960, TEXT = 0x5d4dd60, DT = 0x8b1718;
export default {
  name: 'm5-z07CSI-hud-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const H = loadHub(ctx, { zone: 'z07CSI', node: 15 });
    const emu = H.emu, mem = emu.mem;
    const f32 = (a) => mem.f32(a);
    notes.push(`DAT_008b1718 (frame time) in the image: ${f32(DT)}`);
    const vars = new GameVars();
    const hud = new Hud(null), csi = new CsiHud();
    csi.init(hud);
    const SCORES = [0, 5, 1234, 99999, 12345678, -7];
    const ICONS = [0, 1, 2, 4, 8, 0x10, 0x1e, 0x20, 0x21, 0x40, 0x80, 0xc0, 0x41, 0x60, 0xff, 0x100];
    const CONTROLS = [1, 8, 0x40, 0x101];
    const check = (label, orig, port) => { checked++; if (orig !== port && failures.length < 20) failures.push(`${label}: original ${orig} port ${port}`); };
    let n = 0;
    for (const dt of [1, 0.5]) {   // DAT_008b1718 of the original and the port's world.dt: the blink counter adds `1.0 * dt` per pass
    mem.wf32(DT, dt); mem.wf32(0x8b171c, 1 / dt);
    // 1. every icon combination, one pass each (the blink counter starts at 0 and is reset by every non-blink pass)
    for (const ic of ICONS) for (const ctl of CONTROLS) for (const score of SCORES) {
      const gob = [0, 0x3ff, 0x5, 0x7ffffc00 | 0x201][n % 4];
      emu.setVar(0xc, ic); emu.setVar(0x5e, ctl); emu.setVar(0xce, score); emu.setVar(0xbc, gob);
      vars.set(0xc, ic); vars.set(0x5e, ctl); vars.set(0xce, score); vars.set(0xbc, gob);
      mem.wf32(BLINK, 0); csi.blink = 0;
      const r = emu.run(0x575ca0, []);
      csi.update(hud, vars, dt);
      const tag = `dt ${dt} pass ${n++} icons 0x${ic.toString(16)} control 0x${ctl.toString(16)} score ${score}`;
      check(`${tag} slot texture`, mem.r32(SLOT_TEX) | 0, hud.column[0].tex);
      check(`${tag} blink counter`, f32(BLINK), csi.blink);
      check(`${tag} text`, mem.cstr(TEXT), hud.centreText);
      check(`${tag} left text`, mem.cstr(0x5d4dd20), hud.leftText);
      check(`${tag} var 0xc`, emu.mem.r32(0x8a2d2c + 4 * 0xc) | 0, vars.get(0xc));
      void r;
    }
    // 2. the blink: 80 passes with a blink bit held (the counter runs 1, 2 ... 15 -> texture 4 then 5, passes 30 -> 0)
    mem.wf32(BLINK, 0); csi.blink = 0;
    const seq = [];
    for (let t = 0; t < 80; t++) {
      emu.setVar(0xc, 0x40); vars.set(0xc, 0x40);
      emu.run(0x575ca0, []);
      csi.update(hud, vars, dt);
      check(`dt ${dt} blink pass ${t} texture`, mem.r32(SLOT_TEX) | 0, hud.column[0].tex);
      check(`dt ${dt} blink pass ${t} counter`, f32(BLINK), csi.blink);
      seq.push(hud.column[0].tex);
    }
    notes.push(`dt ${dt}: blink textures over 80 passes: ${seq.join('')}`);
    }
    notes.push(`${n} single passes + 2 x 80 blink passes against FUN_00575ca0 (dt 1 and 0.5)`);
    return { checked, failures, notes };
  },
};
