// M5 audit: the cheat-code detector (FUN_004375a8, src/shell/cheats.ts): the table rows of the executable decode to the typed words, SDREAMS sets var 0xd, and the detector keeps
// the original's quirks (a row that is not armed is skipped until a keystroke that continues no sequence re-arms every row, so the first key of a first-ever SDREAMS is lost).
import { loadExe } from '../lib/engine-load.mjs';
import { CheatDetector, CHEAT_TABLE_VA, CHEAT_ROWS } from '../../src/shell/cheats.ts';
import { codeToDik } from '../../src/shell/dik.ts';

// FUN_00437fdf's value for a keyboard key: 0x10000 | DIK
const K = (s) => [...s].map((ch) => 0x10000 | codeToDik(`Key${ch}`));
export default {
  name: 'm5-audit-cheats',
  run(ctx) {
    const failures = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const pe = loadExe(ctx.dataRoot);
    // the rows as words (DIK -> letter through the browser key table)
    const letter = (d) => { const c = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find((l) => codeToDik(`Key${l}`) === d); return c ?? '?'; };
    const words = [];
    for (let r = 0; r < CHEAT_ROWS; r++) {
      let w = '';
      for (let k = 0; k < 16; k++) { const d = pe.u32(CHEAT_TABLE_VA + r * 0x40 + k * 4); if (d === 0) break; w += letter(d); }
      words.push(w);
    }
    ok(words[0] === 'PEPPERONI' && words[1] === 'FSMADVANCE' && words[4] === 'SDREAMS' && words[3] === 'BAATAT', `rows ${words.join(' ')}`);
    const fire = [];
    const mk = () => { const d = new CheatDetector(pe); d.onCheat = (r) => fire.push(r); return d; };
    const type = (d, s) => { for (const c of K(s)) { d.poll(c); d.poll(0); } };
    // a first-ever SDREAMS: the first S re-arms the rows (row 4 starts un-armed) and is lost, so the sequence does not complete ...
    let d = mk();
    type(d, 'SDREAMS');
    ok(fire.length === 0, 'the very first SDREAMS does not fire (row 4 is not armed yet)');
    // ... and typed again it still does not: the R of the word started row 2 (RHUN...) and the final S started row 4 again (pos 1), so the next first S is a miss; a key that continues
    // no sequence (here X) resets the state, after that SDREAMS fires (the original's detector has the same blind spot)
    type(d, 'SDREAMS');
    ok(fire.length === 0, 'the second SDREAMS right after the first does not fire either');
    // any other key first arms the rows
    fire.length = 0; d = mk();
    type(d, 'X'); type(d, 'SDREAMS');
    ok(fire.length === 1 && fire[0] === 4, 'X then SDREAMS fires');
    // a wrong key in the middle breaks it
    fire.length = 0; d = mk();
    type(d, 'X'); type(d, 'SDRX'); type(d, 'EAMS');
    ok(fire.length === 0, 'a wrong key breaks the sequence');
    // holding a key does not repeat it; two keys down: the lowest code counts (FUN_00437fdf)
    fire.length = 0; d = mk();
    type(d, 'X');
    const seq = K('SDREAMS');
    for (const c of seq) { d.poll(c); d.poll(c); d.poll(0); }
    ok(fire.length === 1, 'a held key counts once');
    // windowed-only rows are not scanned in the default (full-screen) mode
    fire.length = 0; d = mk();
    type(d, 'X'); type(d, 'PEPPERONI'); type(d, 'FSMADVANCE');
    ok(fire.length === 0, 'rows 0 / 1 are not scanned');
    fire.length = 0; d = new CheatDetector(pe, 0); d.onCheat = (r) => fire.push(r);
    type(d, 'X'); type(d, 'PEPPERONI'); type(d, 'FSMADVANCE');
    ok(fire.join() === '0,1', `windowed mode scans rows 0 and 1 (${fire})`);
    return { checked, failures, notes: [`rows: ${words.join(' / ')}`] };
  },
};
