// WP-VERIFY M2 shell, target 3b / 4: the generic panel, the controls help and the key labels (src/shell/helpscreen.ts, src/shell/dik.ts). The ORIGINAL's FUN_00460a66 (panel),
// FUN_00461175 (help), FUN_00460f31 (CONTROLn parser), the tile helpers and the key label FUN_004384c9 -> FUN_0043839f (+ FUN_00438212) run natively in the x86 emulator
// (tools/lib/m7-shell-help-emu.mjs); the recorded sprite / text calls (tile, rectangle, colour, font, text, position, alignment) are compared with the port's calls on a recording Ui2D stub.
import { loadExe } from '../lib/engine-load.mjs';
import { HelpEmu, FONT_MAIN, FONT_MENU, KEYTAB } from '../lib/m7-shell-help-emu.mjs';
import { makeRng } from '../lib/m7-shell-menu-emu.mjs';
import { loadMessages, ZONE_FILES, FRONTEND_FILES } from '../../src/ui/strings.ts';
import { drawPanel, drawHelp, parseControlLine } from '../../src/shell/helpscreen.ts';
import { readKeyNames, keyCodeLabel, keyCodeName, localiseKeyNames } from '../../src/shell/dik.ts';
import { resetUiOffsets } from '../../src/shell/uioffsets.ts';

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
const sameCalls = (a, b) => a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
const firstDiff = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return `call ${i}: port ${JSON.stringify(a[i])}, original ${JSON.stringify(b[i])}`; return `lengths port ${a.length}, original ${b.length}`; };

export default {
  name: 'm7-shell-help',
  run(ctx) {
    resetUiOffsets();   // (WP-SHELL) the oracle runs with the executable's start-up offsets 14 / -4; the port's are globals that earlier tests of this process may have switched to 0x12 / -2 (gaps.md U4)
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 60) failures.push(m); else if (failures.length === 60) failures.push('... more'); };
    const ok = (c, m) => { checked++; if (!c) bad(m); };
    const pe = loadExe(ctx.dataRoot);
    const messages = ctx.archives.find((a) => a.name === 'messages');
    const front = loadMessages(messages, FRONTEND_FILES);
    const tableOf = (z) => (ZONE_FILES[z]?.length ? loadMessages(messages, ZONE_FILES[z]) : null);
    const stats = { calls: 0, helps: 0, panels: 0, labels: 0, lines: 0 };

    // ---- 1. the panel for many sizes
    {
      const E = new HelpEmu(pe);
      for (const [width, rows, title] of [[0x16, 0x14, 0], [0x16, 13, 1], [0x16, 8, 1], [0x16, 14, 1], [0x16, 18, 1], [0x16, 10, 0], [0x10, 12, 1], [0x15, 12, 1], [0x14, 9, 0], [0x1e, 20, 0], [0x16, 21, 1], [0x16, 5, 0], [0x16, 4, 1]]) {
        const nat = E.draw(0x460a66, [width, rows, title]).map(natNorm);
        const ui = stubUi();
        drawPanel(ui, { set: {}, press: '!PRESS', title: '!FECONTRL' }, rows, title === 1, width);
        stats.panels++; stats.calls += nat.length;
        ok(sameCalls(ui.out, nat), `panel width ${width} rows ${rows} title ${title}: ${firstDiff(ui.out, nat)}`);
      }
      ok(E.unhooked.size === 0, `panel: unhooked calls ${[...E.unhooked].map(([a]) => a.toString(16))}`);
    }

    // ---- 2. the help of every zone, default and random key bindings
    const names0 = readKeyNames(pe);
    for (const z of Object.keys(ZONE_FILES)) {
      const tbl = tableOf(z);
      if (!tbl) continue;
      for (let seed = 0; seed < 4; seed++) {
        const rng = makeRng(seed * 977 + z.length + z.charCodeAt(3));
        const E = new HelpEmu(pe);
        E.menuText = (id) => front.raw(id);
        const bits = E.bits();
        const codes = bits.map((b, i) => {
          if (seed === 0) return E.mem.u32(KEYTAB + i * 0x30 + 4);           // the defaults of the exe
          const d = rng.pick([1, 1, 1, 0, 2]);
          return d === 1 ? (1 << 16) | rng.pick([...names0.keys()].filter((k) => k >= 0)) : d === 0 ? rng.int(8) : (2 << 16) | rng.int(20);
        });
        if (seed > 0) E.setKeys(codes);
        const names = new Map(names0); localiseKeyNames(pe, names, E.feErase);
        const keyName = (bit) => { const i = bits.indexOf(bit); return keyCodeName(codes[i], names); };
        for (const n of [0, 3, 5, 6, 7, 0xb, 12]) {
          const t = E.token((id) => tbl.raw(id));
          let nat;
          try { nat = E.draw(0x461175, [t, n]).map(natNorm); } catch (e) { bad(`${z} seed ${seed} n ${n}: the original failed: ${e.message}`); continue; }
          const ui = stubUi();
          drawHelp(ui, {}, tbl, n, { press: '!PRESS', title: '!FECONTRL', keyName, menuText: (id) => front.raw(id) });
          // the port's drawHelp is the whole screen (panel + lines); FUN_00461175 does the same (panel first)
          stats.helps++; stats.calls += nat.length;
          ok(sameCalls(ui.out, nat), `${z} seed ${seed} n ${n}: ${firstDiff(ui.out, nat)}`);
        }
        if (E.unhooked.size) bad(`${z}: unhooked calls ${[...E.unhooked].map(([a]) => a.toString(16))}`);
      }
    }

    // ---- 3. random CONTROLn lines (token parser FUN_00460f31 incl. the two-button form and the malformed ones)
    {
      const toks = ['BUTTON_UP', 'BUTTON_DOWN', 'BUTTON_LEFT', 'BUTTON_RIGHT', 'BUTTON_1', 'BUTTON_2', 'BUTTON_3', 'BUTTON_4', 'BUTTON_9', 'BUTTON_', 'button_up', ''];
      const seps = [' ', '+', '', '  ', ' +', '+ '];
      const words = ['Vooruit draaien', 'x', '', 'Vulling gooien (links)', 'a+b', ' lead'];
      const rng = makeRng(31415);
      const lines = [];
      for (let k = 0; k < 400; k++) lines.push(`${rng.pick(toks)}${rng.pick(seps)}${rng.chance(0.4) ? rng.pick(toks) + rng.pick(seps) : ''}${rng.pick(words)}`);
      // a valid first token followed by '+' and an invalid second token makes the original look up a NULL id (undefined behaviour: it would crash): no shipped text has it
      for (let k = lines.length - 1; k >= 0; k--) if (/^BUTTON_(UP|DOWN|LEFT|RIGHT|1|2|3|4)\+/.test(lines[k]) && !parseControlLine(lines[k]).ok) lines.splice(k, 1);
      const E = new HelpEmu(pe);
      E.menuText = () => null;
      const bits = E.bits(), codes = bits.map((b, i) => E.mem.u32(KEYTAB + i * 0x30 + 4));
      const names = new Map(names0); localiseKeyNames(pe, names, E.feErase);
      const keyName = (bit) => { const i = bits.indexOf(bit); return keyCodeName(codes[i], names); };
      for (let k = 0; k < lines.length; k += 5) {
        const chunk = lines.slice(k, k + 5);
        const t = E.token((id) => { const m = /^CONTROL(\d+)$/.exec(id); return m ? chunk[Number(m[1])] ?? null : null; });
        const nat = E.draw(0x461175, [t, chunk.length]).map(natNorm);
        const ui = stubUi();
        drawHelp(ui, {}, { raw: (id) => { const m = /^CONTROL(\d+)$/.exec(id); return m ? chunk[Number(m[1])] ?? null : null; } }, chunk.length, { press: '!PRESS', title: '!FECONTRL', keyName });
        stats.lines += chunk.length; stats.calls += nat.length;
        ok(sameCalls(ui.out, nat), `lines ${JSON.stringify(chunk)}: ${firstDiff(ui.out, nat)}`);
        for (const l of chunk) { const p = parseControlLine(l); checked++; if (p.ok !== p.ok) bad('parse'); }
      }
      ok(E.unhooked.size === 0, `lines: unhooked calls ${[...E.unhooked].map(([a]) => a.toString(16))}`);
    }

    // ---- 4. key labels: every device / id, every keyboard layout of the game's language
    for (const word of ['ERASE', 'WISSEN', 'SUPPRIMER', 'BORRAR', 'ELIMINA', 'SLETT', 'APAGAR', 'RADERA', 'ELIMINAR', 'x', 'Wissen', 'erase']) {
      const E = new HelpEmu(pe);
      E.feErase = word;
      const names = new Map(names0); localiseKeyNames(pe, names, word);
      const codes = [];
      for (let id = 0; id <= 0x100; id++) codes.push((1 << 16) | id);
      for (let id = 0; id < 12; id++) codes.push(id, (2 << 16) | id, (3 << 16) | id, (7 << 16) | id);
      codes.push(0xffff, 0x1ffff, 0x2ffff, 0x10100, 0x101d3, 0x10000, 0x30001);
      E.mem.w8(0x8af6f0, 1);                                     // DAT_008af6f0: the layout renames still have to run
      for (const code of codes) {
        const p = E.cpu.call(0x43839f, [code]);
        const nat = E.mem.cstr(p, 64), mine = keyCodeLabel(code, names);
        stats.labels++;
        ok(nat === mine, `key label of 0x${code.toString(16)} (FEERASE=${word}): port '${mine}', original '${nat}'`);
      }
      if (E.unhooked.size) bad(`key labels: unhooked calls ${[...E.unhooked].map(([a]) => a.toString(16))}`);
    }

    notes.push(`panels ${stats.panels}, helps ${stats.helps}, random lines ${stats.lines}, key labels ${stats.labels}, recorded draw calls compared ${stats.calls}`);
    return { checked, failures, notes };
  },
};
