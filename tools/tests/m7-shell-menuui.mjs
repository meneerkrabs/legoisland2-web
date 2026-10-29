// WP-VERIFY M2 shell, target 2b: what MenuUi (src/shell/menuui.ts) puts around the engine. The ORIGINAL's page set-up functions (run natively in the x86 emulator: FUN_0041ae6e, 0041aef3,
// 0041afbc, 0041b2c1, 0041b2fd, 0041b037, 0041b227 ..., each with the page renderer FUN_0041d765's calls) and its event handler FUN_0041b500 run next to the port's `MenuUi`
// (refreshPage / setup / handle) in the same environment (story node, cutscene flag, save slot files, options); pages' items (label, type, value, disable mask), list entries, the result
// codes of the handler, the game variables and options it changes and the slot / key calls it makes are compared.
import fs from 'node:fs';
import { loadExe } from '../lib/engine-load.mjs';
import { MenuEmu, A, makeRng } from '../lib/m7-shell-menu-emu.mjs';
import { MenuUi, MR } from '../../src/shell/menuui.ts';
import { Options, S } from '../../src/shell/options.ts';
import { GameVars } from '../../src/game/vars.ts';
import { readMenuPages, readFsmCaptions, readLevelSelect } from '../../src/shell/tables.ts';
import { readSaveHeader } from '../../src/shell/save.ts';

const hex = (n) => '0x' + (n >>> 0).toString(16);

/** why a page is not expected to match (documented design decisions / zones that do not use MenuUi) */
const UNUSED = 'no caller in the port opens or reaches this page (the Pepper\'s-house menus 21..24 / 26 belong to z03PPH, 14 / 28 are the display-mode lists of a PC)';
const PAGE_NOTES = {
  10: 'graphics page: the resolution entries are the browser display choice (shell.ts menuContext.display), the mode list FUN_00406715 does not exist in a browser',
  14: UNUSED, 22: UNUSED, 23: UNUSED, 24: UNUSED, 26: UNUSED, 28: UNUSED,
};

export default {
  name: 'm7-shell-menuui',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 80) failures.push(m); else if (failures.length === 80) failures.push('... more'); };
    const pe = loadExe(ctx.dataRoot);
    const rawPages = readMenuPages(pe);
    const captions = readFsmCaptions(pe);
    const checkpoints = readLevelSelect(pe).checkpoints;
    const known = new Map();
    const options0 = Options.fromExe(pe);
    const knownDev = (key, msg) => { const k = known.get(key); if (k) k.count++; else known.set(key, { count: 1, first: msg }); };
    const stats = { env: 0, pages: 0, items: 0, handler: 0, codes: {} };

    const randOptions = (rng) => {
      const o = new Int32Array(0x17);
      for (let i = 0; i < 0x17; i++) o[i] = rng.int(101);
      o[S.SPEECH_ON] = rng.int(2); o[S.SUBTITLES_ON] = rng.int(2); o[S.TEXTURE_QUALITY] = rng.int(2); o[S.GAMEPAD] = rng.int(2);
      for (let k = 0; k < 13; k++) o[S.KEY_FIRST + k] = 0x10000 | (1 + k * 7 + rng.int(5));
      return o;
    };
    const header = (h) => {
      const b = new Uint8Array(0x40), dv = new DataView(b.buffer);
      dv.setUint32(0, 0x40, true); dv.setUint32(4, 0xd, true); dv.setInt32(8, h.subgame, true); dv.setUint32(0xc, h.time, true); dv.setInt32(0x10, h.fsm, true); dv.setUint32(0x14, 0x8088008, true);
      return b;
    };
    const makeEnv = (rng) => ({
      node: rng.int(72), cutscene: rng.int(3) === 0 ? 1 : 0, options: randOptions(rng),
      headers: Array.from({ length: 7 }, () => (rng.chance(0.6) ? { subgame: 1 + rng.int(40), time: rng.u32(), fsm: rng.int(71) } : null)),
      vars: Int32Array.from({ length: 319 }, () => (rng.chance(0.5) ? rng.int(100) : rng.u32() | 0)),
    });
    /** both sides in the same environment */
    const build = (env, o = {}) => {
      const E = new MenuEmu(pe);
      E.setVar(0x58, env.node); E.cutscene = env.cutscene; E.setOptions(env.options);
      if (o.allVars) for (let i = 0; i < 319; i++) if (i !== 1 && i !== 2) E.setVar(i, env.vars[i]);
      E.setVar(0x58, env.node); E.setVar(9, env.options[S.SPEECH_ON]); E.setVar(0, env.options[S.SUBTITLES_ON]);   // FUN_0041bbd6 reads vars 9 / 0 into options 2 / 3: the shell keeps them equal (applyToVars)
      for (let k = 0; k < 13; k++) { checked++; if (E.mem.r32(0x8aeb20 + k * 0x30) !== options0.defaultOf(S.KEY_FIRST + k)) bad(`key ${k}: fixed key ${hex(E.mem.r32(0x8aeb20 + k * 0x30))} in the exe, Options default ${hex(options0.defaultOf(S.KEY_FIRST + k))}`); E.mem.w32(0x8aeb24 + k * 0x30, env.options[S.KEY_FIRST + k]); }   // the key table follows the options (FUN_00403e30 / FUN_00437e82)
      E.setSlots(env.headers.map((h, i) => [`_data//Save${String(i).padStart(2, '0')}.lgo`, h ? header(h) : null]).filter(([, b]) => b));
      E.saveRet = o.saveRet ?? 1; E.loadRet = o.loadRet ?? 1; E.newRet = o.newRet ?? 1;
      const log = [];
      const options = Options.fromExe(pe); options.a.set(env.options);
      const vars = new GameVars();
      for (let i = 0; i < 319; i++) vars.a[i] = E.getVar(i);
      if (o.allVars) vars.a.set(env.vars);
      const mctx = {
        options, vars, msgs: { label: (l) => (l.startsWith('!') ? l.slice(1) : l) }, keyNames: new Map(), keyBits: [], rows: {},
        sound: () => {}, slotHeader: (s) => { const h = env.headers[s]; return h ? readSaveHeader(header(h)) : null; }, captionId: (n) => captions[n] ?? null,
        storyNode: () => vars.get(0x58), cutsceneRunning: () => env.cutscene !== 0,
        saveSlot: (s) => { log.push(`save ${s}`); return E.saveRet !== 0; }, loadSlot: (s) => { log.push(`load ${s}`); return E.loadRet; }, eraseSlot: (s) => { log.push(`erase ${s}`); },
        newGame: () => { log.push('newgame'); return E.newRet !== 0; }, keysChanged: () => log.push('keys-changed'), captureKey: () => 0, optionChanged: (i) => log.push(`opt ${i}`),
        measure: () => 0, checkpoints, gotoCheckpoint: (e) => log.push(`goto ${e.node} ${e.zone}`),
      };
      const ui = new MenuUi(mctx, structuredClone(rawPages));
      return { E, ui, log, options, vars };
    };

    // ------------------------------------------------------------------------------------------------------------------------------------ 1. page set-up functions
    for (let seed = 1; seed <= 24; seed++) {
      const rng = makeRng(seed * 40503);
      const env = makeEnv(rng);
      const { E, ui } = build(env);
      E.cpu.call(0x41bbd6, [0]);                       // FUN_0041bbd6: the items that show an option get its value
      stats.env++;
      for (let page = 0; page < 30; page++) {
        const mask = rng.pick([0, 0x40, 0x80]);
        E.open(page); E.prepare(mask);
        ui.open(page, mask, false);
        ui['refreshPage']();
        const e = ui.engine;
        stats.pages++;
        const info = E.pageInfo(page);
        const label = `env ${seed} page ${page} (node ${env.node}, cutscene ${env.cutscene})`;
        const diffs = [];
        for (let i = 0; i < e.cur.items.length; i++) {
          const n = E.item(page, i), p = e.cur.items[i];
          checked += 4; stats.items++;
          if (page !== 13 && p.label !== n.label) diffs.push(`item ${i} label '${p.label}' vs '${n.label}'`);
          if (p.type !== n.type) diffs.push(`item ${i} type ${p.type} vs ${n.type}`);
          if (p.value !== n.value) diffs.push(`item ${i} value ${hex(p.value)} vs ${hex(n.value)}`);
          if (p.disable !== n.disable) diffs.push(`item ${i} disable ${hex(p.disable)} vs ${hex(n.disable)}`);
        }
        if (info.kind === 1) {
          const nl = E.list();
          nl.forEach((n, i) => {
            const pl = e.list[i];
            checked++;
            if ((pl === null) !== (n.r < 0)) { diffs.push(`list ${i} present ${pl !== null} vs ${n.r >= 0}`); return; }
            if (pl) { checked += 3; if (pl.value !== n.value) diffs.push(`list ${i} value ${hex(pl.value)} vs ${hex(n.value)}`); if (pl.disable !== n.disable) diffs.push(`list ${i} disable ${hex(pl.disable)} vs ${hex(n.disable)}`); if (pl.label !== (page === 13 ? n.label.replace(/^!/, '') : n.label)) diffs.push(`list ${i} label '${pl.label}' vs '${n.label}'`); }
          });
        }
        if (diffs.length) {
          if (PAGE_NOTES[page]) knownDev(`page ${page}`, `${PAGE_NOTES[page]}; e.g. ${label}: ${diffs[0]}`);
          else for (const d of diffs.slice(0, 3)) bad(`${label}: ${d}`);
        }
      }
    }

    // ------------------------------------------------------------------------------------------------------------------------------------ 2. the wrappers: keys in, result codes / vars / options / slot calls out
    const KEYMIX = [0, 0, 0, 0, 0x8, 0x8, 0x4, 0x10000, 0x10000, 0x40, 0x40000000, 0x1, 0x2, 0x1, 0x2];
    const runWrapper = (which, kind, seed, mask, steps, o = {}) => {
      const rng = makeRng(seed * 7717 + kind * 13 + (which === 'front' ? 1 : which === 'pause' ? 2 : 3));
      const env = makeEnv(rng);
      const { E, ui, log, options, vars } = build(env, { allVars: true, saveRet: o.saveRet, loadRet: o.loadRet, newRet: o.newRet });
      // game state as the zone has it: the vars equal on both sides, vars 9 / 0 = the options (see above)
      for (let i = 0; i < 319; i++) if (i !== 1 && i !== 2) E.setVar(i, env.vars[i]);
      E.setVar(0x58, env.node); E.setVar(9, env.options[S.SPEECH_ON]); E.setVar(0, env.options[S.SUBTITLES_ON]); E.setVar(5, 0x20); E.setVar(0xb, 5);
      for (let i = 0; i < 319; i++) vars.a[i] = E.getVar(i);
      vars.a[1] = 0; vars.a[2] = 1;
      const base = { vars: vars.a.slice(), opts: env.options.slice() };
      void base;
      const page = which === 'front' ? 0 : which === 'pause' ? [5, 0x12, 0x1d][kind] : kind === 1 ? 0x10 : kind === 2 ? 0x13 : 0xf;
      const label = `${which} kind ${kind} seed ${seed} mask ${mask.toString(16)} (node ${env.node} cutscene ${env.cutscene})`;
      // ports: the shell's newGame does FUN_0041786a + var 5 = 2; the handler of the original does var 5 = 2 itself: the stub applies only that
      ui.ctx.newGame = () => { log.push('newgame'); vars.set(5, 2); return E.newRet !== 0; };   // shell.ts: loop.newGame() sets var 5 = NEW_GAME_ZONE (2)
      const resMap = { 0: 0 };
      void resMap;
      let nat = E.wrapper(which, mask, kind, 0);        // the opening call
      E.mem.w32(A.CTX + 4 * 3, 0);
      ui.open(page, mask, which === 'pause');
      const cutE = E;
      void cutE;
      stats.wrappers = (stats.wrappers ?? 0) + 1;
      if (nat !== 0) { bad(`${label}: the opening call returned ${nat}`); return; }
      for (let s = 0; s < steps; s++) {
        let pressed = rng.pick(KEYMIX) | (rng.chance(0.05) ? 0x10 : 0);
        if (which === 'result') pressed &= ~0x40000000;      // the loops turn Esc into the pause menu before FUN_0041c092 sees it (FUN_00423170), the wrapper's Esc result -3 cannot happen
        log.length = 0;
        const sBefore = E.state();
        if (sBefore.page === 10 && sBefore.item >= 3) { knownDev('wrapper page 10', `${label} step ${s}: the cursor is on the greyed resolution entries of the graphics page (port: always greyed; original: only on a device with one mode): Esc / Enter do nothing there in the port`); return; }
        let r;
        try { r = E.wrapper(which, mask, kind, pressed); } catch (e) { bad(`${label} step ${s}: the original failed: ${e.message}`); return; }
        const mine = ui.step(pressed);
        if (mine !== 0) { ui.close(); if (which === 'result') vars.set(0xb, 0); }     // the callers (playzone.ts) close the menu when a result comes back; FUN_0041c092 also clears STARTEDFROMMENU
        const where = `${label} step ${s} (keys ${pressed.toString(16)}, page ${sBefore.page} item ${sBefore.item})`;
        stats.codes[r] = (stats.codes[r] ?? 0) + 1;
        checked++;
        if (mine !== r) { bad(`${where}: result code port ${mine}, original ${r}`); return; }
        const after = E.state();
        stats.visited ??= new Set(); stats.visited.add(`${which}:${after.page}`);
        checked += 4;
        if (ui.engine.page !== after.page || ui.engine.item !== after.item || ui.engine.stack.length !== after.depth) { bad(`${where}: page/item/depth port ${ui.engine.page}/${ui.engine.item}/${ui.engine.stack.length}, original ${after.page}/${after.item}/${after.depth}`); return; }
        const natVars = E.vars();
        const dv = [];
        for (let i = 0; i < 319; i++) if ((i !== 1 && i !== 2) && natVars[i] !== vars.get(i)) dv.push(`var ${i}: port ${vars.get(i)}, original ${natVars[i]}`);
        checked += 319;
        if (dv.length) { bad(`${where}: ${dv.slice(0, 4).join('; ')}`); return; }
        const natOpts = E.options();
        const od = [];
        for (let i = 0; i < 0x17; i++) if (natOpts[i] !== options.a[i]) od.push(`option ${i}: port ${options.a[i]}, original ${natOpts[i]}`);
        checked += 0x17;
        if (od.length) { bad(`${where}: ${od.slice(0, 4).join('; ')}`); return; }
        const natLog = E.slotLog.join(','), myLog = log.filter((x) => !x.startsWith('opt ') && x !== 'keys-changed').join(',');
        checked++;
        if (natLog !== myLog) { bad(`${where}: slot calls port [${myLog}], original [${natLog}]`); return; }
        if (r !== 0) {
          // the wrapper closed the menu: the next call of the original opens it again (a tick without step), the port's caller does the same
          E.wrapper(which, mask, kind, 0);
          ui.open(page, mask, which === 'pause');
          const nv = E.vars();
          checked += 319;
          for (let i = 0; i < 319; i++) if (i !== 1 && i !== 2 && nv[i] !== vars.get(i)) { bad(`${label} re-open after step ${s}: var ${i}: port ${vars.get(i)}, original ${nv[i]}`); return; }
        }
      }
    };
    stats.wrappers = 0;
    for (let seed = 1; seed <= 30; seed++) {
      runWrapper('front', 0, seed, 0, 500);
      for (const [kind, mask] of [[0, 0x80], [1, 0x40], [2, 0x40], [0, 0x80]]) runWrapper('pause', kind, seed, mask, 400, { saveRet: seed % 3 === 0 ? 0 : 1, loadRet: seed % 3 });
      for (const kind of [0, 1, 2]) runWrapper('result', kind, seed, 0, 120);
    }
    {
      const src = fs.readFileSync(new URL('../../src/shell/playzone.ts', import.meta.url), 'utf8');
      checked++;
      if (!/sh\.menu\.close\(\); sh\.vars\.set\(0xb, 0\);/.test(src)) bad('playzone.ts does not clear var 0xb (STARTEDFROMMENU) when the result menu returns (FUN_0041c092)');
    }
    notes.push(`wrapper runs ${stats.wrappers}; result codes seen ${JSON.stringify(stats.codes)}; pages visited ${[...stats.visited].sort().join(' ')}`);
    notes.push(`environments ${stats.env}, pages compared ${stats.pages}, items ${stats.items}`);
    for (const [k, v] of known) notes.push(`KNOWN ${k}: ${v.count} environments; ${v.first}`);
    return { checked, failures, notes };
  },
};
