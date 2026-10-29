// WP-VERIFY M2 shell, target 2: the menu engine. The ORIGINAL's engine step FUN_0041fd45 (with FUN_0041d765's page set-up calls, FUN_0041fa84 input, FUN_0041f695 cursor keys,
// FUN_0041f966 key capture, FUN_0041f181 mouse) runs natively in the x86 emulator (tools/lib/m7-shell-menu-emu.mjs) on the exe's own page table, next to the port's MenuEngine
// (src/shell/menu.ts): the same scripted keys, the same disable masks, the same page data; the page / item / stack / press counters / capture / scroll words, the returned event and its
// out values, the toggle and slider values, the list entries and the sounds are compared after every step. The page set-up functions are the original's, run natively and fed
// to the port exactly as the renderer feeds them (so only the engine logic is under test here; MenuUi's own set-ups are compared in m7-shell-menuui).
import { loadExe } from '../lib/engine-load.mjs';
import { MenuEmu, A, makeRng } from '../lib/m7-shell-menu-emu.mjs';
import { MenuEngine } from '../../src/shell/menu.ts';
import { toEnginePages } from '../../src/shell/menuui.ts';
import { readMenuPages } from '../../src/shell/tables.ts';
import { B } from '../../src/game/input.ts';

const SND = { select: 101, onoff: 102, back: 103, move: [111, 112, 113, 114] };
const KEYSETS = [
  [0, 0, 0, 0, B.DOWN, B.UP, B.LEFT, B.RIGHT, B.ENTER, B.SHIFT, B.ESC],
  [0, 0, B.DOWN, B.DOWN, B.DOWN, B.UP, B.ENTER, B.ENTER, B.ESC, B.RIGHT, B.LEFT],
  [0, B.DOWN, B.UP, B.LEFT, B.RIGHT, B.SPACE, B.CTRL, B.ALT, B.ENTER | B.DOWN, B.SHIFT | B.UP, B.ESC | B.ENTER, B.LEFT | B.RIGHT, B.UP | B.DOWN, B.Z, B.X, B.C, B.PAD9, B.KEY1000],
];

export default {
  name: 'm7-shell-menu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 80) failures.push(m); else if (failures.length === 80) failures.push('... more'); };
    const pe = loadExe(ctx.dataRoot);
    const raw = readMenuPages(pe);
    const stats = { steps: 0, scen: 0, ev: {}, pages: new Set(), maxDepth: 0, scrolls: 0, caps: 0, confirms: 0 };
    const known = new Map();      // deviation key -> { count, first }
    const knownDev = (key, msg) => { const k = known.get(key); if (k) k.count++; else known.set(key, { count: 1, first: msg }); };

    const run = (page, seed, steps, o = {}) => {
      const rng = makeRng(seed * 2654435761 + page);
      const E = new MenuEmu(pe);
      E.mem.w32(0x5d582c0, SND.select); E.mem.w32(0x5d5816c, SND.onoff); E.mem.w32(0x5d580d8, SND.back);
      [0x5d581a8, 0x5d581ac, 0x5d581b0, 0x5d581b4].forEach((a, i) => E.mem.w32(a, SND.move[i]));
      E.mem.w32(0x5d58208, 0);
      if (o.vars) for (const [i, v] of Object.entries(o.vars)) E.setVar(Number(i), v);
      E.cutscene = o.cutscene ?? 0;
      const sounds = [];
      const pages = toEnginePages(structuredClone(raw));
      const port = new MenuEngine(pages, {
        sound: (k) => sounds.push(k),
        poll: () => E.poll,
        setup: (pg, at, item, idx) => {
          if (!item) return 0;                                  // page level: the native pre-call already patched the items
          const p = E.scratch(item);
          const r = E.callSetup(at, p, 1, idx);
          const m = E.mem;
          item.label = m.cstr(p, 0x40); item.type = m.r32(p + 0x40); item.value = m.r32(p + 0x44); item.disable = m.u32(p + 0x48);
          return r;
        },
      });
      E.open(page);
      E.prepare(o.mask ?? 0);
      port.openAt(page);
      const label = `page ${page} seed ${seed}${o.tag ? ' ' + o.tag : ''}`;
      const keys = rng.pick(KEYSETS);
      const sync = (mask) => {
        // the original's renderer patches the items of the current page at the start of every step: run it natively, give the port the result
        E.prepare(mask);
        const cur = port.page, info = E.pageInfo(cur);
        port.cur.items.forEach((it, i) => { const n = E.item(cur, i); it.label = n.label; it.type = n.type; it.disable = n.disable; });
        void info;
      };
      stats.scen++;
      for (let s = 0; s < steps; s++) {
        const pressed = rng.pick(keys);
        const mask = o.mask ?? rng.pick([0, 0, 0x40, 0x80, 0xc0]);
        sync(mask);
        const before = E.state();
        E.poll = before.capture !== 0 && rng.chance(0.35) ? 0x10000 + 1 + rng.int(100) : 0;      // the key FUN_00438099 reports in this step
        let nat;
        try { nat = E.step(pressed, mask); } catch (e) { bad(`${label} step ${s}: the original failed: ${e.message}`); return; }
        sounds.length = 0;
        const pre = { page: port.page, item: port.item, depth: port.stack.length };
        const mine = port.step(pressed, mask);
        const after = E.state();
        stats.steps++; stats.pages.add(after.page); stats.ev[nat.ev] = (stats.ev[nat.ev] ?? 0) + 1;
        stats.maxDepth = Math.max(stats.maxDepth, after.depth);
        if (after.scroll !== before.scroll) stats.scrolls++;
        if (after.capture) stats.caps++;
        const where = `${label} step ${s} (keys ${pressed.toString(16)} mask ${mask.toString(16)}, page ${before.page} item ${before.item})`;
        const cmp = (what, a, b) => { checked++; if (a !== b) { bad(`${where}: ${what}: port ${a}, original ${b}`); return false; } return true; };
        const stk = (x) => x.map((e) => `${e.page}:${e.item}`).join(',');
        let same = true;
        if (nat.ev === 9) stats.confirms++;
        if (nat.ev === 8) E.cpu.call(0x437e82, [after.scroll - 1 + Math.floor(before.item / 10), nat.b]);    // FUN_0041b500 case 8 (the handler of the wrappers): the key table takes the new key
        same = cmp('event', mine.ev, nat.ev) && same;
        if (nat.a !== null) same = cmp('out a', mine.a, nat.a) && same;
        if (nat.b !== null) same = cmp('out b', mine.b, nat.b) && same;
        same = cmp('page', port.page, after.page) && same;
        same = cmp('item', port.item, after.item) && same;
        same = cmp('depth', port.stack.length, after.depth) && same;
        same = cmp('stack', stk(port.stack), stk(after.stack)) && same;
        same = cmp('press counter', port.press, after.press) && same;
        same = cmp('press kind', port.pressKind, after.pressKind) && same;
        same = cmp('capture', port.capture, after.capture) && same;
        same = cmp('scroll', port.scroll, after.scroll) && same;
        // values of the items of the page
        port.cur.items.forEach((it, i) => { const n = E.item(after.page, i); if (it.value !== n.value) { same = false; cmp(`item ${i} value`, it.value, n.value); } });
        // the sounds
        const natSounds = nat.sounds.map((id) => (id === SND.select ? 'select' : id === SND.onoff ? 'onoff' : id === SND.back ? 'back' : 'move'));
        same = cmp('sounds', sounds.join(','), natSounds.join(',')) && same;
        if (nat.sounds.some((id) => SND.move.includes(id))) {
          // the original cycles four move sounds; the port plays 'move' (the audio host's menu() cycles): the sequence of ids must be 111, 112, 113, 114, ...
          for (const id of nat.sounds.filter((x) => SND.move.includes(x))) { E.moveSeq = (E.moveSeq ?? -1) + 1; checked++; if (id !== SND.move[E.moveSeq % 4]) bad(`${where}: move sound cycle ${id}`); }
        }
        if (!same) { bad(`${where}: diverged (ev ${nat.ev}), the scenario stops`); return; }
        // list entries (kind 1 pages): compare what the renderer left natively with the port's list
        if (port.cur.kind === 1) {
          E.prepare(mask);
          const nl = E.list();
          nl.forEach((n, i) => {
            const pl = port.list[i];
            checked++;
            if ((pl === null) !== (n.r < 0)) { bad(`${where}: list entry ${i} present port ${pl !== null}, original ${n.r >= 0}`); return; }
            if (pl) { checked++; if (pl.value !== n.value || pl.disable !== n.disable || pl.type !== n.type) bad(`${where}: list entry ${i} value/disable/type ${pl.value}/${pl.disable}/${pl.type} vs ${n.value}/${n.disable}/${n.type}`); }
          });
        }
        void pre;
      }
    };

    const t0 = Date.now();
    for (let page = 0; page < 30; page++) for (let seed = 1; seed <= 7; seed++) run(page, seed, 180);
    // pause menus with cutscene state / story states (the set-up functions read them)
    for (const page of [5, 2, 3, 8, 7, 22, 26, 24]) for (const [tag, vars, cut] of [['node3', { 0x58: 3 }, 0], ['node30', { 0x58: 30 }, 0], ['node50', { 0x58: 50 }, 1], ['node70', { 0x58: 70 }, 0]]) for (let seed = 1; seed <= 2; seed++) run(page, seed + 100, 160, { vars, cutscene: cut, tag });

    notes.push(`scenarios ${stats.scen}, engine steps ${stats.steps} in ${Date.now() - t0} ms; events ${JSON.stringify(stats.ev)}; pages reached ${[...stats.pages].sort((a, b) => a - b).join(',')}; max stack depth ${stats.maxDepth}; scroll changes ${stats.scrolls}; steps in key capture ${stats.caps}, keys bound ${stats.ev[8] ?? 0}`);
    for (const [k, v] of known) notes.push(`DEVIATION ${k}: ${v.count} scenarios; first: ${v.first}`);
    return { checked, failures, notes };
  },
};
