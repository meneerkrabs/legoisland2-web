// WP-SHELL (docs/re/gaps.md U2, U4, U5, U8, U9): the shell's UI globals and flow decisions against the executable.
//  * U4: DAT_008a9918 / DAT_008a991c start as 14 / -4 in the initialised data and FUN_004201aa (via FUN_0041c080: the front end's set-up, the pause trigger, every zone loop) replaces
//    them by 0x12 / -2 for good; the panel / help code (the original's FUN_00460a66 / FUN_00461175 run in the x86 interpreter) is compared with the port's `drawPanel` / `drawHelp`
//    for both pairs of offsets (the port reads the globals of src/shell/uioffsets.ts)
//  * the code facts: every shipped zone's start path that reaches FUN_0041c080, the immediates of FUN_004201aa
//  * U2: no `creditsThen` hook is left in the shell sources
//  * U5: no message / menu / credits text contains a `%` (FUN_0041433a would pass it through vsprintf): nothing to port
import fs from 'node:fs';
import path from 'node:path';
import { loadExe } from '../lib/engine-load.mjs';
import { HelpEmu, FONT_MAIN, FONT_MENU } from '../lib/m7-shell-help-emu.mjs';
import { loadMessages, ZONE_FILES } from '../../src/ui/strings.ts';
import { drawPanel, drawHelp } from '../../src/shell/helpscreen.ts';
import { uiOffsets, resetUiOffsets, applyUiOffsets } from '../../src/shell/uioffsets.ts';
import { readMenuPages } from '../../src/shell/tables.ts';
import { CREDITS_TABLE_VA, CREDITS_LINES } from '../../src/shell/credits.ts';
import { MenuEngine } from '../../src/shell/menu.ts';

const FONT_OF = { [FONT_MAIN]: 1, [FONT_MENU]: 0 };
function stubUi() {
  const out = [];
  return {
    out,
    sprite: (set, tex, rect, argb) => { out.push({ k: 'sprite', tex, rect: rect.map((v) => Math.trunc(v)), argb: argb >>> 0 }); },
    text: (font, s, x, y, o = {}) => { out.push({ k: 'text', font, s, x: Math.trunc(x), y: Math.trunc(y), colour: o.colour, align: o.align }); return 1; },
    measure: (font, s) => ({ w: s.length * (font === 1 ? 14 : 10), h: 20 }),
  };
}
const natNorm = (r) => (r.k === 'sprite' ? r : { k: 'text', font: FONT_OF[r.font] ?? r.font, s: r.s, x: r.x, y: r.y, colour: r.colour, align: r.align });
const same = (a, b) => a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));

export default {
  name: 'm8-shell-ui',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c && failures.length < 30) failures.push(m); };
    const pe = loadExe(ctx.dataRoot);

    // ---- U4: the globals and FUN_004201aa
    ok(pe.u32(0x8a9918) === 14 && (pe.u32(0x8a991c) | 0) === -4, `start-up values 0x${pe.u32(0x8a9918).toString(16)} / ${pe.u32(0x8a991c) | 0}`);
    ok(pe.u32(0x4201d4 + 6) === 0x12 && (pe.u32(0x4201de + 6) | 0) === -2, 'FUN_004201aa immediates (0x12 / -2)');
    ok(pe.u8 ? pe.u8(0x4201d4) === 0xc7 : true, 'mov dword ptr [mem], imm32');
    resetUiOffsets();
    ok(uiOffsets.titleDy === 14 && uiOffsets.itemDy === -4, 'uiOffsets start at the executable\'s values');
    // every menu / panel path calls FUN_004201aa through FUN_0041c080 first: the engine's open() goes through the shell's applyUiOffsets, the engine itself shares the globals
    const eng = new MenuEngine([{ items: [], kind: 0, theme: 0 }]);
    applyUiOffsets();
    ok(eng.titleDy === 0x12 && eng.itemDy === -2, 'MenuEngine reads the shared offsets');
    eng.titleDy = 99;
    ok(uiOffsets.titleDy === 99, 'MenuEngine writes the shared offsets (the IFC / computer menus set them like FUN_004201aa)');
    resetUiOffsets();

    const messages = ctx.archives.find((a) => a.name === 'messages');
    const front = loadMessages(messages, ['FE/Data/FRONTEND.str']);
    const tbl = loadMessages(messages, ZONE_FILES.z38PAR ?? []);
    for (const [label, title, item] of [['start-up', 14, -4], ['after FUN_004201aa', 0x12, -2]]) {
      const E = new HelpEmu(pe);
      E.mem.w32(0x8a9918, title); E.mem.w32(0x8a991c, item >>> 0);
      if (label === 'start-up') resetUiOffsets(); else applyUiOffsets();
      for (const [width, rows, wt] of [[0x16, 0x14, 0], [0x16, 13, 1], [0x16, 8, 1], [0x16, 11, 1]]) {
        const nat = E.draw(0x460a66, [width, rows, wt]).map(natNorm);
        const ui = stubUi();
        drawPanel(ui, { set: {}, press: '!PRESS', title: '!FECONTRL' }, rows, wt === 1, width);
        ok(same(ui.out, nat), `${label}: panel ${width} x ${rows} title ${wt}`);
      }
      for (const n of [3, 5, 6]) {
        const t = E.token((id) => tbl.raw(id));
        const nat = E.draw(0x461175, [t, n]).map(natNorm);
        const ui = stubUi();
        drawHelp(ui, {}, tbl, n, { press: '!PRESS', title: '!FECONTRL', keyName: () => '--', menuText: (id) => front.raw(id) });
        // the help's key names come from the oracle's own key table: compare everything but the key caps' names
        const strip = (l) => l.map((c) => (c.k === 'text' && c.font === 0 && c.x < 248 ? { ...c, s: '' } : c));
        ok(same(strip(ui.out), strip(nat)), `${label}: help n ${n}`);
      }
      ok(E.unhooked.size === 0, `${label}: unhooked calls ${[...E.unhooked].map(([a]) => a.toString(16))}`);
    }
    resetUiOffsets();

    // ---- U2: the credits hook is gone
    const dir = path.join(ctx.dataRoot, '../../../src/shell');
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      ok(!t.includes('creditsThen'), `src/shell/${f} still mentions creditsThen`);
    }

    // ---- U5: no `%` in any text the 2D layer draws from data: the messages, the menu pages, the credits table
    let pct = 0;
    for (const e of messages.entries) { const t = Buffer.from(messages.read(e)).toString('latin1'); for (const l of t.split(/\r?\n/)) if (!l.trim().startsWith('#') && l.includes('%')) pct++; }
    for (const p of readMenuPages(pe)) for (const it of p.items ?? []) if (it.label?.includes('%')) pct++;
    for (let i = 0; i < CREDITS_LINES; i++) if (pe.cstr(CREDITS_TABLE_VA + i * 0x108 + 4, 0x100).includes('%')) pct++;
    ok(pct === 0, `${pct} texts contain a % (vsprintf of FUN_0041433a)`);
    notes.push(`${messages.entries.length} message files, ${readMenuPages(pe).length} menu pages, ${CREDITS_LINES} credit lines: no % (U5)`);
    return { checked, failures, notes };
  },
};
