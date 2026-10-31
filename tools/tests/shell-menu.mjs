// Menu engine (src/shell/menu.ts) on the page table read from the EXE, and the per-zone loop template (src/shell/loopmachine.ts).
import { MenuEngine, IT } from '../../src/shell/menu.ts';
import { toEnginePages } from '../../src/shell/menuui.ts';
import { readMenuPages } from '../../src/shell/tables.ts';
import { LoopMachine, MODE, EXIT, HUB_CONFIG, MINIGAME_CONFIG } from '../../src/shell/loopmachine.ts';
import { B } from '../../src/game/input.ts';
import { loadExe } from '../lib/engine-load.mjs';

export default {
  name: 'shell-menu',
  run(ctx) {
    const failures = []; let checked = 0;
    const eq = (name, a, b) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
    const pe = loadExe(ctx.dataRoot);
    const pages = toEnginePages(readMenuPages(pe));
    const sounds = [];
    const mk = () => { const e = new MenuEngine(structuredClone(pages), { sound: (k) => sounds.push(k) }); return e; };
    /** run `n` ticks with `pressed` on the first one, collect events other than 0 */
    const run = (e, first, n = 6, mask = 0) => { const evs = []; for (let i = 0; i < n; i++) { const r = e.step(i === 0 ? first : 0, mask); if (r.ev) evs.push({ tick: i, ...r }); } return evs; };

    // ---- the main menu: Starten / Opties / Credits / Stoppen, cursor keys wrap
    let e = mk(); e.openAt(0);
    eq('main menu starts at item 1', e.item, 1);
    for (const want of [2, 3, 4, 1]) { e.step(B.DOWN, 0); e.step(0, 0); eq(`down -> ${want}`, e.item, want); }
    e.step(B.UP, 0); eq('up wraps to the last entry', e.item, 4);
    eq('four move sounds', sounds.filter((s) => s === 'move').length, 5);

    // ---- Enter takes 4 ticks to act (press animation counter 4 -> 1) and goes to the page the item names
    e = mk(); e.openAt(0); e.step(B.DOWN, 0); // Opties
    let evs = run(e, B.ENTER);
    eq('enter on Opties: one goto event after 3 ticks', evs.map((x) => [x.tick, x.ev, x.b]), [[3, 1, 4]]);
    eq('now on the options page', [e.page, e.item, e.stack.length], [4, 1, 1]);
    evs = run(e, B.ESC, 2);
    eq('Esc goes back', [evs[0].ev, e.page, e.item], [2, 0, 2]);
    evs = run(e, B.ESC, 2);
    eq('Esc at the root reports "nothing to pop" (a = -1)', [evs[0].ev, evs[0].a], [2, -1]);

    // ---- an action item (Credits, id 2) returns type 4 with its id
    e = mk(); e.openAt(0); e.step(B.DOWN, 0); e.step(B.DOWN, 0);
    evs = run(e, B.SHIFT);
    eq('Shift activates too; action id', evs.map((x) => [x.ev, x.b]), [[4, 2]]);

    // ---- quit confirmation: Stoppen -> page 1 (No = back, Yes = event 3)
    e = mk(); e.openAt(0); e.item = 4; run(e, B.ENTER);
    eq('Stoppen opens the confirm page', e.page, 1);
    e.item = 2; evs = run(e, B.ENTER); eq('yes = event 3', evs.map((x) => x.ev), [3]);

    // ---- toggles and sliders (page 12 speech toggle, page 11 music volume)
    e = mk(); e.openAt(12); evs = run(e, B.RIGHT);
    eq('toggle flips on the action tick', [evs[0].ev, evs[0].b], [5, 0]);
    e = mk(); e.openAt(11); e.pages[11].items[1].value = 80;
    e.step(B.RIGHT, 0); eq('slider changes at once (+10)', e.pages[11].items[1].value, 90);
    for (let i = 0; i < 5; i++) e.step(B.RIGHT, 0);
    eq('slider is clamped to 100', e.pages[11].items[1].value, 100);
    evs = run(e, B.LEFT); eq('slider reports event 6', evs.some((x) => x.ev === 6), true);

    // ---- disabled entries do nothing (greyed 0x20 and caller masks)
    e = mk(); e.openAt(3); e.pages[3].items[1].disable = 0x20; e.item = 1;
    eq('greyed slot gives no event', run(e, B.ENTER, 8), []);
    e = mk(); e.openAt(5); const save = e.pages[5].items.findIndex((i) => i.label === '!SAVE'); e.item = save;
    eq('Save is disabled with caller mask 0x40', run(e, B.ENTER, 8, 0x40), []);
    e = mk(); e.openAt(5); e.item = save; evs = run(e, B.ENTER, 8, 0x80);
    eq('Save opens its page with mask 0x80', [evs.length, e.page], [1, 3]);

    // ---- the page table itself
    eq('30 pages', pages.length, 30);
    eq('page 5 (island pause) items', pages[5].items.map((i) => i.label), ['!Pause', '!PauseM4', '!FELODGAM', '!SAVE', '!FEOPTION', '!LEVPPH', '!FEQUIT']);
    eq('page 18 (mini-game pause) Abort / Restart', pages[18].items.slice(3, 5).map((i) => [i.type, i.value, i.disable]), [[IT.LIST, 1, 0x80], [IT.LIST, 0xf, 0x80]]);

    // ---- key capture (page 13 is a list page): the host feeds a key, the engine returns event 8
    e = new MenuEngine(structuredClone(pages), { setup: (page, at, item, idx) => { if (!item) return 0; if (idx >= 13) return -1; item.label = `K${idx}`; item.value = 0x10000 + idx; return 1; } });
    e.openAt(13); e.step(0, 0); eq('list page: first entry selected', e.item, 10);
    run(e, B.ENTER, 1); for (let i = 0; i < 4; i++) e.step(0, 0);
    eq('capture waits', e.capture !== 0, true);
    e.feedKey(0x10017); const r = e.step(0, 0); eq('bound key event', [r.ev, r.b], [8, 0x10017]);

    // ---- loop template: fade in (16 steps + the pass that sees 1.0 = 17 passes: FUN_0043ec80(f) first, then `1.0 <= f`, then `f += 0.0625 * dt`), play, pause, resume, quit through the fade out
    const m = new LoopMachine(HUB_CONFIG);
    let n = 0; while (m.mode === MODE.FADE_IN && n < 40) { m.tick({ pressed: 0 }); n++; }
    eq('fade in takes 17 passes', n, 17);
    eq('the last pass hands 1.0 to the fade', m.fade, 1);
    m.tick({ pressed: 0 }); m.tick({ pressed: 0 });
    eq('init -> play', m.mode, MODE.PLAY);
    m.tick({ pressed: B.ESC }); eq('Esc pauses', m.mode, MODE.PAUSE);
    m.tick({ pressed: B.ESC }); eq('Esc is ignored in the pause mode', m.mode, MODE.PAUSE);
    m.tick({ pressed: 0, pauseResult: 1 }); eq('resume restores the mode', m.mode, MODE.PLAY);
    m.tick({ pressed: B.ESC }); m.tick({ pressed: 0, pauseResult: -1 });
    eq('quit starts the fade out', m.mode, MODE.FADE_OUT);
    n = 0; while (!m.done && n < 40) { m.tick({ pressed: 0 }); n++; }
    eq('fade out takes 17 passes and ends with exit 0', [n, m.exit], [17, EXIT.QUIT]);
    // dt 0.5 (the 60 Hz step): twice the steps, the shown fade is the level BEFORE the step of that pass
    {
      const h = new LoopMachine(HUB_CONFIG); const shown = []; let k = 0;
      while (h.mode === MODE.FADE_IN && k < 100) { h.tick({ pressed: 0, dt: 0.5 }); shown.push(h.fade); k++; }
      eq('fade in at dt 0.5 takes 33 passes', k, 33);
      eq('the shown fade starts at 0 and steps by 1/32', [shown[0], shown[1], shown[2], shown[32]], [0, 0.03125, 0.0625, 1]);
      h.tick({ pressed: 0 }); h.tick({ pressed: 0 });
      h.leave(EXIT.QUIT); let j = 0; while (!h.done && j < 100) { h.tick({ pressed: 0, dt: 0.5 }); j++; }
      eq('fade out at dt 0.5 takes 33 passes', j, 33);
    }
    // exits of a mini-game: abort -> 4, restart -> 3, finish via banner and result menu -> 2
    const run2 = (f) => { const x = new LoopMachine(MINIGAME_CONFIG); for (let i = 0; i < 18; i++) x.tick({ pressed: 0 }); f(x); let k = 0; while (!x.done && k++ < 60) x.tick({ pressed: 0 }); return x.exit; };
    eq('abort from the pause menu', run2((x) => { x.tick({ pressed: B.ESC }); x.tick({ pressed: 0, pauseResult: -3 }); }), EXIT.ABANDON);
    eq('restart from the pause menu', run2((x) => { x.tick({ pressed: B.ESC }); x.tick({ pressed: 0, pauseResult: -2 }); }), EXIT.RESTART);
    eq('intro waits for a button, game over -> banner -> result menu -> finished', run2((x) => {
      eq('  intro', x.mode, MODE.INTRO); x.tick({ pressed: B.ENTER }); eq('  play', x.mode, MODE.PLAY);
      x.tick({ pressed: 0, gameOver: 1 }); eq('  banner', x.mode, MODE.BANNER); x.tick({ pressed: B.ENTER }); eq('  result', x.mode, MODE.RESULT);
      x.tick({ pressed: 0, resultResult: 1 });
    }), EXIT.FINISHED);
    eq('story advance leaves with exit 6', run2((x) => { x.tick({ pressed: B.ENTER }); x.tick({ pressed: 0, storyAdvanced: true }); }), EXIT.STORY);
    eq('var 5 change leaves with exit 8', run2((x) => { x.tick({ pressed: B.ENTER }); x.tick({ pressed: 0, varChanged: true }); }), EXIT.VAR5);
    return { checked, failures };
  },
};
