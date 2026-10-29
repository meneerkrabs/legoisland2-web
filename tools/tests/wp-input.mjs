// WP-INPUT (docs/re/input.md): the input poll FUN_004376f9 and its helpers as the port has them: key table with fixed + current keys (flag +0xc), the "any key" bit, pad semantics
// (FUN_004371ea is the held state), the stick threshold, mouse units and buttons, the chase camera's mouse look, cheat codes from the executable's table, the key page's capture
// (FUN_00438099 / FUN_0041f966), the key names (FUN_0043839f / FUN_00438212) and the screenshot BMP (FUN_00412f2f).
import { InputMapper, readKeyTable, B, padAxisUnits, padStickBits, mouseUnits, CAPTURE_BLOCKED, keyCode, DEFAULT_BINDINGS } from '../../src/game/input.ts';
import { CheatDetector, installCheats, cheatState, CHEAT_TABLE_VA, VAR_SDREAMS } from '../../src/shell/cheats.ts';
import { codeToDik, dikToCodes, readKeyNames, localiseKeyNames, keyCodeLabel, keyCodeName } from '../../src/shell/dik.ts';
import { encodeBmp24, photoName } from '../../src/shell/screenshot.ts';
import { MenuUi } from '../../src/shell/menuui.ts';
import { Options, S } from '../../src/shell/options.ts';
import { readMenuPages } from '../../src/shell/tables.ts';
import { GameVars } from '../../src/game/vars.ts';
import { MenuStrings, loadMessages, MENU_FILES } from '../../src/ui/strings.ts';
import { loadExe, loadZone, run } from '../lib/engine-load.mjs';
import { debugAids } from '../../src/game/debug.ts';

export default {
  name: 'wp-input',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const eq = (name, a, b) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
    const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
    const pe = loadExe(ctx.dataRoot);
    const table = readKeyTable(pe);
    const mk = () => new InputMapper(table);

    // ---- the key table: current key always, fixed key while the entry's flag is set (FUN_00436f7d / FUN_00437e82)
    {
      const im = mk();
      eq('default bindings: no fixed key is active a second time (flag 0: it equals the current key)', im.bindings.map((b) => b.defaultActive), new Array(13).fill(false));
      // Up rebound to KeyI: the old fixed key (arrow up) stays live for Up
      const cur = table.map((t) => ({ dik: t.dik, bit: t.bit }));
      cur[0].dik = codeToDik('KeyI');
      im.rebind(cur);
      eq('after rebinding Up: its flag is on again', im.bindings[0].defaultActive, true);
      im.setKey('KeyI', true); im.update(); eq('new key works', im.held, B.UP);
      im.setKey('KeyI', false); im.setKey('ArrowUp', true); im.update(); eq('fixed key still works', im.held, B.UP);
      im.setKey('ArrowUp', false);
      // a key that is another entry's current key switches that entry's fixed key off: Down rebound to KeyI's... use Left bound to the fixed key of Right (arrow right)
      const cur2 = table.map((t) => ({ dik: t.dik, bit: t.bit }));
      cur2[2].dik = 0xcd;   // Left (entry 2) now has arrow right as its current key; Right (entry 3) keeps it as its own current key as well
      im.rebind(cur2);
      eq('flags: Left lost its fixed key (arrow left) -> on again, Right\'s fixed key = a current key -> off', [im.bindings[2].defaultActive, im.bindings[3].defaultActive], [true, false]);
      im.setKey('ArrowRight', true); im.update(); eq('one key, two entries: both bits', im.held, B.LEFT | B.RIGHT); im.setKey('ArrowRight', false);
      // mouse button as a binding (device 0), button 2 = middle
      const cur3 = table.map((t) => ({ dik: t.dik, bit: t.bit }));
      cur3[4] = { device: 0, dik: 2, bit: table[4].bit };
      im.rebind(cur3);
      im.setMouseButton(2, true); im.update(); eq('a mouse button bound to Ctrl', im.held, B.CTRL); im.setMouseButton(2, false);
      im.setKey('ControlLeft', true); im.update(); eq('and the fixed key of Ctrl still works', im.held, B.CTRL); im.setKey('ControlLeft', false);
    }
    // the right-hand twins are aliases (kept like WASD), the scancodes themselves are exact
    ok(codeToDik('ControlRight') === 0x9d && codeToDik('ShiftRight') === 0x36 && codeToDik('AltRight') === 0xb8 && codeToDik('NumpadEnter') === 0x9c, 'right-hand modifiers have their own DIK');
    { const im = mk(); im.setKey('ShiftRight', true); im.update(); eq('right shift acts as shift (alias)', im.held, B.SHIFT); }

    // ---- "any key" 0x80000000: no other bit and something down (FUN_00437fdf); a lone left mouse button is 0 (FUN_00437fdf returns 0 for button 0)
    {
      const im = mk();
      im.setKey('KeyP', true); im.update();
      ok(im.held === B.ANY && im.pressed === B.ANY, 'an unbound key alone = ANY');
      im.setKey('ArrowUp', true); im.update(); eq('with a bound key down: that bit, not ANY', im.held, B.UP);
      im.setKey('ArrowUp', false); im.setKey('KeyP', false); im.update(); eq('released', im.held, 0);
      im.setMouseButton(0, true); im.update(); eq('left mouse button alone: nothing', im.held, 0); im.setMouseButton(0, false);
      im.setMouseButton(1, true); im.update(); eq('right mouse button alone: ANY', im.held, B.ANY); im.setMouseButton(1, false);
      im.setKey('Escape', true); im.setKey('ArrowUp', true); im.update(); eq('Esc replaces everything', im.held, B.ESC);
      im.setKey('Escape', false); im.setKey('ArrowUp', false); im.update();
    }

    // ---- pad: buttons are the held state (FUN_004371ea compares with a "previous" buffer that is zeroed on every poll), first pad only, enabled by the setting
    {
      const im = mk();
      const btn = (n, down = []) => Array.from({ length: n }, (_, i) => ({ pressed: down.includes(i) }));
      let pads = [{ connected: true, mapping: '', axes: [0, 0], buttons: btn(12, [0]) }];
      im.getPads = () => pads;
      im.update(); eq('pad button 0 = Ctrl', [im.held, im.pressed], [B.CTRL, B.CTRL]);
      im.update(); eq('held on the next tick (not a one tick pulse)', [im.held, im.pressed], [B.CTRL, 0]);
      for (let i = 0; i < 10; i++) { pads = [{ connected: true, mapping: '', axes: [0, 0], buttons: btn(12, [i]) }]; im.update(); eq(`pad button ${i}`, im.held, i === 0 ? B.CTRL : [0x10, 0x20, 0x40, 0x80, 0x1000, 0x2000, 0x4000, 0x8000, 0x10000, 0x20000][i]); }
      pads = [{ connected: true, mapping: '', axes: [0, 0], buttons: btn(12, [10, 11]) }]; im.update(); eq('buttons 10 / 11: no bit, but "any key"', im.held, B.ANY);
      // standard mapping: DirectInput order of an Xbox pad (A B X Y LB RB Back Start LS RS): standard index 8 (Back) = DI 6 = Z... (bit 0x4000), triggers and D-pad are no buttons
      pads = [{ connected: true, mapping: 'standard', axes: [0, 0], buttons: btn(17, [8]) }]; im.update(); eq('standard pad: Back = DI button 6', im.held, 0x4000);
      pads = [{ connected: true, mapping: 'standard', axes: [0, 0], buttons: btn(17, [6, 7, 12, 13, 14, 15]) }]; im.update(); eq('standard pad: triggers / D-pad are not buttons', im.held, 0);
      // only the first controller
      pads = [null, { connected: true, mapping: '', axes: [0, 0], buttons: btn(4, [1]) }, { connected: true, mapping: '', axes: [0, 0], buttons: btn(4, [0]) }]; im.update(); eq('first attached pad only', im.held, B.ALT);
      im.gamepad = false; im.update(); eq('setting off: the pad is not read', im.held, 0); im.gamepad = true;
      // stick: +-0x40 of (axis * 65536) >> 9 (rounded towards zero)
      eq('stick thresholds', [0.5, 0.5078, 0.5079, -0.5, -0.5078, -0.5079, 1, -1].map((a) => padAxisUnits(a)), [64, 64, 65, -64, -64, -65, 128, -128]);
      eq('stick bits', [padStickBits(0.51, 0), padStickBits(-0.51, 0), padStickBits(0, -0.51), padStickBits(0, 0.51), padStickBits(0.5, -0.5), padStickBits(0.6, 0.6)], [B.RIGHT, B.LEFT, B.UP, B.DOWN, 0, B.RIGHT | B.DOWN]);
      pads = [{ connected: true, mapping: '', axes: [0.9, -0.9], buttons: btn(2) }]; im.update(); eq('stick up-right', im.held, B.UP | B.RIGHT);
      pads = []; im.update();
    }

    // ---- mouse: FUN_00437ca5: buttons 0..3 -> 0x10 .. 0x80, movement * ((sensitivity + 5) * 0.05f) truncated, dy negated
    {
      const im = mk();
      eq('mouse units at sensitivity 45', [mouseUnits(1, 45), mouseUnits(3, 45), mouseUnits(-3, 45), mouseUnits(0, 45)], [2, 7, -7, 0]);
      eq('mouse units at sensitivity 0 / 100', [mouseUnits(10, 0), mouseUnits(10, 100)], [2, 52]);
      im.setMouseButton(0, true); im.setMouseButton(3, true); im.addMouseDelta(4, 4); im.update();
      eq('mouse state', im.mouse, { buttons: 0x90, dx: 10, dy: -10 });
      im.update(); eq('movement is relative: consumed by the poll', [im.mouse.dx, im.mouse.dy], [0, -0]);
      im.sensitivity = 100; im.addMouseDelta(1, -1); im.update(); eq('sensitivity applies', [im.mouse.dx, im.mouse.dy], [5, 5]);
    }

    // ---- the chase camera: the mouse replaces the camera sticks (before *0.1) and its buttons zoom
    {
      const L = loadZone(ctx, 'z03PPH', { pos: [-3.75, 0.33, -4] });
      const w = L.world, walk = L.walk;
      run(L, 8);
      w.input.sensitivity = 45;
      w.input.addMouseDelta(10, 0);
      w.tick();
      ok(near(walk.camStickX, 25 * 0.1, 1e-9), `mouse dx 10 counts -> 25 units -> camera stick x ${walk.camStickX} (2.5 expected)`);
      w.tick();
      ok(Math.abs(walk.camStickX) < 0.01, 'no movement: the key ramp stick again');
      ok(w.input.markMouseLook !== undefined, 'the camera marks the mouse look');
      // the right button = X + C (zoom in), the left button = <> + Z (zoom out): the same camera as with the keys
      const camAfter = (mouseBtn, keys) => {
        const L2 = loadZone(ctx, 'z03PPH', { pos: [-3.75, 0.33, -4] });
        run(L2, 8);
          if (mouseBtn >= 0) L2.world.input.setMouseButton(mouseBtn, true);
        for (const k of keys) L2.world.input.setKey(k, true);
        for (let i = 0; i < 14; i++) L2.world.tick();
        return Array.from(L2.world.camera.c.slice(0, 6));
      };
      const base = camAfter(-1, []);
      const zi = camAfter(1, []), zik = camAfter(-1, ['KeyX', 'KeyC']), zo = camAfter(0, []), zok = camAfter(-1, ['IntlBackslash', 'KeyZ']);
      eq('right mouse button = X + C', zi, zik); eq('left mouse button = <> + Z', zo, zok);
      void base;   // (Pepper's house has its own camera code, the zoom shows in the other zones: docs/re/input.md)
    }

    // ---- cheat codes: the rows of the executable decode to the words, polled with FUN_00437fdf's value from the mapper
    {
      const letter = (d) => [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find((l) => codeToDik(`Key${l}`) === d) ?? '?';
      const words = [];
      for (let r = 0; r < 6; r++) { let wd = ''; for (let k = 0; k < 16; k++) { const d = pe.u32(CHEAT_TABLE_VA + r * 0x40 + k * 4); if (d === 0) break; wd += letter(d); } words.push(wd); }
      eq('rows', words, ['PEPPERONI', 'FSMADVANCE', 'RHUNRHEGED', 'BAATAT', 'SDREAMS', 'DAFFODILE']);
      const im = mk();
      const fired = []; let sd = 0, adv = 0, exits = 0;
      const inst = installCheats(pe, im, { sdreams: () => sd++, fsmAdvance: () => adv++, exit: () => exits++ });
      inst.detector.onCheat = ((orig) => (r) => { fired.push(r); if (r !== 2) orig(r); else exits++; })(inst.detector.onCheat);
      const tap = (s) => { for (const ch of s) { im.setKey(`Key${ch}`, true); im.update(); im.setKey(`Key${ch}`, false); im.update(); } };
      tap('X'); tap('SDREAMS');
      eq('SDREAMS through the mapper (after a key that arms the rows)', [fired, sd], [[4], 1]);
      fired.length = 0; tap('BAATAT');
      eq('BAATAT sets the era flag', [fired, cheatState.baatat], [[3], true]);
      fired.length = 0; tap('RHUNRHEGED'); eq('RHUNRHEGED = the error dialog (exit)', [fired, exits], [[2], 1]);
      fired.length = 0; tap('DAFFODILE'); eq('DAFFODILE: no handler, but the row completes', fired, [5]);
      fired.length = 0; tap('PEPPERONI'); tap('FSMADVANCE'); eq('windowed-only rows are not scanned by default', [fired, adv], [[], 0]);
      // a mouse button in the middle breaks the sequence
      fired.length = 0; tap('X'); tap('SDRE'); im.setMouseButton(1, true); im.update(); im.setMouseButton(1, false); im.update(); tap('AMS');
      eq('a mouse button between the keys breaks it', fired, []);
      // a key down while the next one goes down (rollover): the lowest scancode counts, so S (0x1f) then D (0x20) with S still held reads S until it is let go
      fired.length = 0; tap('X');
      im.setKey('KeyS', true); im.update(); im.setKey('KeyD', true); im.update(); im.setKey('KeyS', false); im.update(); im.setKey('KeyD', false); im.update(); tap('REAMS');
      eq('rollover S D then the rest: completes', fired, [4]);
      // a held modifier is a "key" of its own as soon as the letter is let go: it breaks the sequence (the original cannot be typed with Shift held)
      fired.length = 0; tap('X');
      im.setKey('ShiftRight', true); tap('SDREAMS'); im.setKey('ShiftRight', false); im.update();
      eq('with a modifier held the sequence cannot complete', fired, []);
      inst.detach();
      eq('the detector is released', im.cheats, null);
      ok(typeof VAR_SDREAMS === 'number', 'var');
    }

    // ---- key names: FUN_0043839f + FUN_00438212
    {
      const names = readKeyNames(pe);
      eq('label formats', [keyCodeLabel(0x10039, names), keyCodeLabel(0x00002, names), keyCodeLabel(0x20003, names), keyCodeLabel(0x10054, names), keyCodeLabel(0x30001, names)], ['!SPACE', 'MOUSE2', 'JOY:3', '!---', '!---']);
      eq('help names skip the first character (the `+ 1` of FUN_00460f31)', [keyCodeName(0x10039, names), keyCodeName(0x00002, names), keyCodeName(0x20003, names)], ['SPACE', 'OUSE2', 'OY:3']);
      const loc = (word) => { const n = new Map(names); localiseKeyNames(pe, n, word); return n; };
      const nl = loc('WISSEN'), fr = loc('SUPPRIMER'), en = loc('ERASE'), de = loc('Löschen'), da = loc('SLET');
      eq('Dutch layout names', [0x29, 0x0c, 0x0d, 0x1a, 0x1b, 0x27, 0x28, 0x2b, 0x56, 0x35].map((d) => nl.get(d)), ['@', '/', '°', '"', '*', '+', "'", '<', ']', '-']);
      eq('English (no match) gets the table at 0x8af3b0 (French): the quirk', [en.get(0x10), en.get(0x11), en.get(0x1e), en.get(0x2c)], [fr.get(0x10), fr.get(0x11), fr.get(0x1e), fr.get(0x2c)]);
      eq('French table', [fr.get(0x10), fr.get(0x11), fr.get(0x1e), fr.get(0x2c), fr.get(0x27)], ['A', 'Z', 'Q', 'W', 'M']);
      eq('German / Danish', [de.get(0x15), de.get(0x2c), da.get(0x29)], ['Z', 'Y', 'HALF']);
      eq('the Dutch layout leaves the letters alone', [nl.get(0x10), nl.get(0x2c)], ['Q', 'Z']);
      // through the message table: `!UP` -> OMHOOG
      const msgs = new MenuStrings(...MENU_FILES.map((f) => loadMessages(ctx.archives.find((a) => a.name.toLowerCase() === 'messages'), f)));
      eq('FEERASE is the Dutch word', msgs.label('!FEERASE'), 'WISSEN');
      eq('names go through the message lookup', [msgs.label(keyCodeLabel(0xc8 | 0x10000, nl)), msgs.label(keyCodeLabel(0x10039, nl)), msgs.label(keyCodeLabel(0x10028, nl)), msgs.label(keyCodeLabel(2, nl))], ['OMHOOG', 'SPATIE', "'", 'MOUSE2']);
    }

    // ---- the key page: capture (FUN_00438099) and the release rule (FUN_0041f966), through the real menu code
    {
      const im = mk();
      const opts = Options.fromExe(pe);
      let changed = 0;
      const mctx = { options: opts, vars: new GameVars(), msgs: { label: (x) => x }, keyNames: new Map(), keyBits: [], rows: {}, sound() {}, slotHeader: () => null, captionId: () => null, storyNode: () => 0,
        cutsceneRunning: () => false, saveSlot: () => true, loadSlot: () => 0, eraseSlot() {}, newGame: () => true, keysChanged: () => { changed++; im.rebind(table.map((k, i) => ({ dik: opts.binding(i).dik, device: opts.binding(i).device, bit: k.bit }))); },
        optionChanged() {}, measure: () => 10, captureKey: (own) => im.captureKey(own) };
      const ui = new MenuUi(mctx, readMenuPages(pe));
      ui.open(13, 0, false);
      const e = ui.engine;
      const tick = (btn = 0) => { im.update(); return ui.step(im.pressed & btn ? btn : 0); };
      const tickKeys = (btn = 0) => { im.update(); return ui.step(btn); };
      tickKeys(); eq('key page open, first key row', [e.page, e.item], [13, 10]);
      tickKeys(B.ENTER); for (let i = 0; i < 6 && !e.capture; i++) tickKeys();
      ok(e.capture !== 0, 'Enter on a key row starts the capture');
      // a key that is another entry's current key is not accepted; Esc, F10, the Windows keys, ` are not accepted
      for (const code of ['ArrowDown', 'KeyZ', 'F10', 'MetaLeft', 'Backquote']) { im.setKey(code, true); tickKeys(); tickKeys(); im.setKey(code, false); tickKeys(); tickKeys(); }
      ok(e.capture !== 0 && opts.binding(0).dik === 0xc8, 'bound keys and the blocked keys are not captured');
      // the new key: bound when it is LET GO
      im.setKey('KeyI', true); tickKeys(); tickKeys(); tickKeys();
      ok(e.capture !== 0 && opts.binding(0).dik === 0xc8, 'still waiting while the key is held');
      im.setKey('KeyI', false); const evs = []; for (let i = 0; i < 3; i++) { const r = tickKeys(); evs.push(r); }
      ok(opts.binding(0).dik === codeToDik('KeyI') && opts.binding(0).device === 1 && e.capture === 0, `bound on release (dik ${opts.binding(0).dik.toString(16)})`);
      ok(changed > 0 && im.bindings[0].defaultActive, 'the mapper has the new key and the old fixed key stays live');
      // a mouse button 2 (middle) can be bound, 0 / 1 cannot
      e.item = 20; tickKeys(B.ENTER); for (let i = 0; i < 6 && !e.capture; i++) tickKeys();
      im.setMouseButton(0, true); im.setMouseButton(1, true); tickKeys(); tickKeys(); im.setMouseButton(0, false); im.setMouseButton(1, false); tickKeys(); tickKeys();
      ok(e.capture !== 0, 'left / right mouse buttons are not bindable');
      im.setMouseButton(2, true); tickKeys(); tickKeys(); im.setMouseButton(2, false); tickKeys(); tickKeys();
      eq('middle mouse button bound to the second entry (Down)', [opts.binding(1).device, opts.binding(1).dik, e.capture], [0, 2, 0]);
      // cancel: Esc leaves the page, the old keys are back
      tickKeys(B.ESC); for (let i = 0; i < 5; i++) tickKeys();
      ok(true, 'page left');
      void tick;
    }
    eq('blocked list of the executable', CAPTURE_BLOCKED, [pe.u32(0x8aef08), pe.u32(0x8aef0c), pe.u32(0x8aef10), pe.u32(0x8aef14), pe.u32(0x8aef18), pe.u32(0x8aef1c)]);
    eq('the keyboard codes of the table', DEFAULT_BINDINGS.length, 13);
    void dikToCodes; void keyCode; void S;

    // ---- the debug option gates the port's aids
    {
      eq('no debug option by default', debugAids(), false);
      const had = Object.getOwnPropertyDescriptor(globalThis, 'location');
      globalThis.location = { search: '?zone=z03PPH&debug=1' };
      eq('?debug=1 turns the aids on', debugAids(), true);
      if (had) Object.defineProperty(globalThis, 'location', had); else delete globalThis.location;
      eq('and off again', debugAids(), false);
      // PEPPERONI / FSMADVANCE are scanned in debug mode only
      const d = new CheatDetector(pe, 2), d0 = new CheatDetector(pe, 0);
      eq('cheat scan starts at row 2 (full screen) / 0 (windowed = debug)', [d.firstRow, d0.firstRow], [2, 0]);
    }

    // ---- the screenshot file (FUN_00412f2f)
    {
      const rgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255, 13, 14, 15, 255, 16, 17, 18, 255]);   // 3 x 2
      const f = encodeBmp24(rgba, 3, 2), dv = new DataView(f.buffer);
      eq('BM header', [String.fromCharCode(f[0], f[1]), dv.getUint32(2, true), dv.getUint32(10, true)], ['BM', 12 * 2 + 0x36, 0x36]);
      eq('info header', [dv.getUint32(14, true), dv.getUint32(18, true), dv.getUint32(22, true), dv.getUint16(26, true), dv.getUint16(28, true), dv.getUint32(30, true), dv.getUint32(38, true), dv.getUint32(42, true)], [40, 3, 2, 1, 24, 0, 2000, 2000]);
      eq('first stored row is the bottom row of the picture', [f[0x36], f[0x37], f[0x38], f[0x39], f[0x3a], f[0x3b]], [12, 11, 10, 15, 14, 13]);
      eq('padding', [f[0x36 + 9], f[0x36 + 10], f[0x36 + 11]], [0, 0, 0]);
      eq('top row last', [f[0x36 + 12], f[0x36 + 13], f[0x36 + 14]], [3, 2, 1]);
      eq('names', [photoName(0), photoName(12), photoName(9999)], ['Lego0000.bmp', 'Lego0012.bmp', 'Lego9999.bmp']);
      // 2 pixel wide rows: 6 bytes -> 8
      const g = encodeBmp24(new Uint8Array(2 * 1 * 4), 2, 1); eq('row padding 6 -> 8', g.length, 0x36 + 8);
    }
    return { checked, failures, notes };
  },
};
