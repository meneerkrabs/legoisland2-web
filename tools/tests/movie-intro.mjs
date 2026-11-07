// Movies: the start-up sequence of the port (src/files.ts INTRO_SEQUENCE) is the one in FUN_00402990's machine code: the three `call FUN_0048c813(path, hwnd, skippable)` in address order, each preceded
// by the push of its `%s<name>.mpg` format string (0x89a21c LegoSoftware, 0x89a230 SDLogo, 0x89a240 IntroFMV) and `push imm8` skippable (0, 1, 1: the first movie ignores the skip key; the movie window's hook
// FUN_0048cff2 skips on WM_KEYDOWN (0x100) only when the flag is set). The other callers of the movie player (FUN_0048c7b0: the front end's Intro / Outro replays, the PPH computer, the outro after z42BRP) pass 1.
import fs from 'node:fs';
import path from 'node:path';
import { Pe } from '../../src/formats/exe.ts';
import { INTRO_SEQUENCE } from '../../src/files.ts';

const CALL = 0x48c813, STRINGS = [[0x89a21c, 'LegoSoftware'], [0x89a230, 'SdLogo'], [0x89a240, 'IntroFmv']];

export default {
  name: 'movie-intro',
  async run(ctx) {
    const failures = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
    if (!fs.existsSync(exePath)) return { checked: 0, failures: [`missing ${exePath}`] };
    const pe = new Pe(new Uint8Array(fs.readFileSync(exePath)));
    const calls = [];
    for (let a = 0x402990; a < 0x402e00; a++) {
      if (pe.at(a) !== 0xe8 || (((a + 5 + (pe.u32(a + 1) | 0)) >>> 0) !== CALL)) continue;
      // `push imm8 (skippable); mov ecx, [hwnd]; push ecx; lea edx, [path]; push edx; call` and, 25 bytes earlier, `push offset format`
      const skippable = pe.at(a - 16) === 0x6a ? pe.at(a - 15) : -1;
      let fmt = 0;
      for (let k = a - 60; k < a; k++) if (pe.at(k) === 0x68 && STRINGS.some(([va]) => pe.u32(k + 1) === va)) fmt = pe.u32(k + 1);
      calls.push({ at: a, skippable, fmt });
    }
    ok(calls.length === 3, `three movie calls in FUN_00402990 (${calls.length})`);
    ok(calls.every((c) => c.skippable === 0 || c.skippable === 1), `skippable flags are push imm8 (${calls.map((c) => c.skippable)})`);
    ok(calls.map((c) => c.skippable).join() === '0,1,1', `skippable flags 0, 1, 1 in call order (${calls.map((c) => c.skippable)})`);
    ok(calls.map((c) => c.fmt).join() === STRINGS.map(([va]) => va).join(), `format strings in call order LegoSoftware, SDLogo, IntroFMV (${calls.map((c) => c.fmt.toString(16))})`);
    const text = (va) => { let s = ''; for (let k = 0; pe.at(va + k); k++) s += String.fromCharCode(pe.at(va + k)); return s; };
    ok(STRINGS.every(([va, n]) => text(va).toLowerCase() === `%s${n}.mpg`.toLowerCase()), 'the format strings are %s<name>.mpg');
    ok(INTRO_SEQUENCE.map((m) => m.name).join() === STRINGS.map(([, n]) => n).join(), `port order ${INTRO_SEQUENCE.map((m) => m.name)}`);
    ok(INTRO_SEQUENCE.map((m) => (m.skippable ? 1 : 0)).join() === calls.map((c) => c.skippable).join(), `port skippable flags ${INTRO_SEQUENCE.map((m) => m.skippable)}`);
    return { checked, failures, notes: [`call sites ${calls.map((c) => c.at.toString(16))}`] };
  },
};
