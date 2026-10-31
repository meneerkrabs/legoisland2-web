// WP-SHELL-FINAL (input.md section 2): the key table of SDPad.cpp against the ORIGINAL's code in the x86 emulator: FUN_00437e82 (bind: remembers the entry's current key and flag, flags of the
// entries whose fixed key is the old / new key) and FUN_00437f6e (cancel: only the remembered entries, each with its OWN flag, the markers are cleared) run natively on the table at 0x8aeb20 (13 entries x
// 0x30: +0 fixed key, +4 current key, +0xc flag; backups at 0x9db038 / 3c / 44); the init is FUN_00436f7d's (flag 1 unless the fixed key is the current key of some entry). The port's InputMapper
// (`rebind` = init, `bindKey`, `cancelKeyBinds`) must hold the same current keys and flags after every operation.
import { loadExe } from '../lib/engine-load.mjs';
import { createGameCpu } from '../../src/formats/x86emu.ts';
import { InputMapper, KC, keyCode } from '../../src/game/input.ts';

const TABLE = 0x8aeb20, BKP = 0x9db038, SETTINGS = 0x9833f0;
export default {
  name: 'm9-input-keytable',
  run(ctx) {
    const failures = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    let seed = 12345; const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
    for (let scen = 0; scen < 60; scen++) {
      const cpu = createGameCpu(pe), mem = cpu.mem;
      cpu.exec = [[0x437e72, 0x437e80], [0x437e82, 0x437fdf], [0x4040ec, 0x404100]];
      cpu.fallback = (a) => { throw new Error('call to 0x' + a.toString(16)); };
      const fixed = Array.from({ length: 13 }, (_, i) => mem.r32(TABLE + i * 0x30) >>> 0);
      const bits = Array.from({ length: 13 }, (_, i) => mem.r32(TABLE + i * 0x30 + 8));
      // FUN_00436f7d: the current keys come from Settings[4 + i] (the exe's own defaults here, or a scenario's choice), the flags from the comparison
      const keys = fixed.slice();
      if (scen % 3) for (let k = 0; k < 3; k++) keys[rnd(13)] = keyCode(KC.KEY, 1 + rnd(0x80));
      for (let i = 0; i < 13; i++) { mem.w32(SETTINGS + 4 * (4 + i), keys[i]); mem.w32(TABLE + i * 0x30 + 4, keys[i]); }
      for (let i = 0; i < 13; i++) { mem.w8(TABLE + i * 0x30 + 0xc, 1); for (let j = 0; j < 13; j++) if (fixed[i] === keys[j]) mem.w8(TABLE + i * 0x30 + 0xc, 0); }
      const im = new InputMapper(fixed.map((k, i) => ({ code: k, bit: bits[i] })));
      im.rebind(keys.map((k, i) => ({ code: k, bit: bits[i] })));
      const natState = () => Array.from({ length: 13 }, (_, i) => [mem.r32(TABLE + i * 0x30 + 4) >>> 0, mem.r8(TABLE + i * 0x30 + 0xc) !== 0, mem.r32(BKP + i * 0x30)]);
      const portState = () => im.bindings.map((b) => [b.code >>> 0, b.defaultActive]);
      const check = (what) => {
        const n = natState(), p = portState();
        for (let i = 0; i < 13; i++) {
          checked += 2;
          if (n[i][0] !== p[i][0]) failures.push(`scenario ${scen} ${what}: entry ${i} current key original ${n[i][0].toString(16)}, port ${p[i][0].toString(16)}`);
          if (n[i][1] !== p[i][1]) failures.push(`scenario ${scen} ${what}: entry ${i} flag original ${n[i][1]}, port ${p[i][1]}`);
        }
      };
      check('init');
      for (let step = 0; step < 40; step++) {
        if (rnd(5) === 0) { cpu.call(0x437f6e, []); im.cancelKeyBinds(); check(`step ${step} cancel`); continue; }
        const i = rnd(13);
        // a key: sometimes another entry's fixed key (flags change), sometimes a fresh one, sometimes a mouse button
        const pick = rnd(4);
        const code = pick === 0 ? fixed[rnd(13)] : pick === 1 ? keyCode(KC.MOUSE, 2 + rnd(6)) : keyCode(KC.KEY, 1 + rnd(0x90));
        cpu.call(0x437e82, [i, code]);
        mem.w32(SETTINGS + 4 * (4 + i), code);
        im.bindKey(i, code);
        check(`step ${step} bind ${i} -> ${code.toString(16)}`);
        if (failures.length > 20) return { checked, failures };
      }
    }
    return { checked, failures };
  },
};
