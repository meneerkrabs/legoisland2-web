import { IfcRoom, SND, ST, CLIP, CAM, DOOR, PIN, PEPPER_PLACE, MODEL_OFFSET, CAPTION, CHAR_PAGE0, EXIT_PAGE } from '../../src/zones/z04IFC/ifc.ts';
import { readIfcPages, infoLines, labelId, IFC_PAGE_COUNT } from '../../src/zones/z04IFC/pages.ts';
import { dialogRows, dialogY0, TEXT_X, TEXT_WIDTH } from '../../src/zones/z04IFC/dialog.ts';
import { IFC_CTOR, IFC_RECORDS } from '../../src/zones/z04IFC.ts';
import { MessageTable, MenuStrings, loadMessages, MENU_FILES, IFC_FILES } from '../../src/ui/strings.ts';
import { readExeSoundTable } from '../../src/formats/sound.ts';
import { B } from '../../src/game/input.ts';
import { loadExe, loadZone } from '../lib/engine-load.mjs';

// z04IFC, the Information Centre (docs/re/m3/z04IFC.md): the DOM-free room logic driven with scripted keys (camera states, the pins and their caption, the door, the info
// menu with its location / character pages, the exit question), the page table and the texts checked against the executable and the message files, the zone set-up
// (the four behaviours attach to the right records, nothing is skipped) and the dialog layout.

const f32 = (u) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u >>> 0, true); return d.getFloat32(0, true); };
const f64 = (lo, hi) => { const d = new DataView(new ArrayBuffer(8)); d.setUint32(0, lo >>> 0, true); d.setUint32(4, hi >>> 0, true); return d.getFloat64(0, true); };

/** a scripted host: records the sounds / clips, a fixed clock and a rand that returns what the test wants */
function makeHost(msgs) {
  const log = { play: [], all: [], restart: [], clips: [], vars: new Map(), menu: [] };
  const h = {
    log,
    clock: 100000, r: 0.5,
    play: (id) => { log.play.push(id); log.all.push(id); },
    restart: (id) => log.restart.push(id),
    pepperClip: (c) => log.clips.push(c),
    ms() { return this.clock; },
    rand() { return this.r; },
    text: (id) => msgs.label('!' + id),
    menuSound: (k) => log.menu.push(k),
    setVar: (i, v) => log.vars.set(i, v),
  };
  return h;
}

export default {
  name: 'm3-z04IFC',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, t = 1e-5) => Math.abs(a - b) <= t;
    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'messages');
    const msgs = new MenuStrings(...MENU_FILES.map((f) => loadMessages(arch, f)));
    const ifc = loadMessages(arch, IFC_FILES);
    const snd = readExeSoundTable(pe.data);

    // ============================================================ executable: constants
    ok(near(CAM.EYE_Y, f32(0x40e147ae), 1e-6) && near(CAM.EYE_Z, f32(0xc099999a), 1e-6) && near(CAM.FAR_Z, f32(0x40e66666), 1e-6), 'camera heights / depths');
    ok(f32(pe.u32(0x8921a4)) === CAM.START_X, 'start x 24.0 at 0x8921a4');
    ok(f32(pe.u32(0x892624)) === CAM.SLIDE && f32(pe.u32(0x892090)) === CAM.EIGHT, 'slide factor 0.15 and 8 (0x892624, 0x892090)');
    ok(f32(pe.u32(0x892620)) === CAM.ZOOM, 'zoom factor 0.065 (0x892620)');
    ok(f32(pe.u32(0x89261c)) === CAM.FAR_Z && f32(pe.u32(0x892618)) === CAM.EYE_Z, 'far z 7.2 / near z -4.8 at 0x89261c / 0x892618');
    ok(f32(pe.u32(0x89207c)) === CAM.PI && f32(pe.u32(0x89237c)) === CAM.TURN_DIV && f64(pe.u32(0x892610), pe.u32(0x892614)) === CAM.TURN_Z, 'pi, 20, 7.2 (a double: fsubr qword) at 0x89207c / 0x89237c / 0x892610');
    ok(near(f64(0x80000000, 0x3ff41b2f), CAM.HOLD, 0), 'state 8 holds the angle of the double 0x3ff41b2f80000000');
    ok(f32(pe.u32(0x8920d8)) === DOOR.DEG && f32(pe.u32(0x892070)) === DOOR.RATE && f32(pe.u32(0x892628)) === DOOR.OPEN, 'door: 0.01745 deg to rad, 5 per tick, -90');
    ok(near(f32(0x418e5604), DOOR.X, 0) && near(f32(0x408e8f5c), DOOR.Y, 0) && near(f32(0xbf0f1aa0), DOOR.Z, 0), 'door position immediates of FUN_0054caa1');
    ok(near(f32(0x402a0c4a), PEPPER_PLACE.x, 0) && near(f32(0xc070b439), PEPPER_PLACE.z, 0) && near(f32(0x40490fdb), PEPPER_PLACE.yaw, 0), "Pepper's place immediates of FUN_0054bce3");
    ok(f32(pe.u32(0x89211c)) === PIN.STEP && f32(pe.u32(0x892094)) === PIN.WRAP && f32(0x3d23d70a) === PIN.AMP, 'pin bob: 0.04 amplitude, 10 degree step, wrap 2 pi');
    ok(f32(pe.u32(0x89206c)) === MODEL_OFFSET.RIGHT && f32(pe.u32(0x892068)) === MODEL_OFFSET.UP, 'figure offset 2.8 / 2.16 at 0x89206c / 0x892068');
    ok(f32(pe.u32(0x8923b4)) === 542 && f32(pe.u32(0x892394)) === 400 && f32(pe.u32(0x89238c)) === 600 && f32(pe.u32(0x892390)) === 800, 'caption at (400, 542) of 800 x 600');
    ok(CAPTION.X === 400 && CAPTION.Y === 542, 'caption constants');
    // the sound ids of FUN_0054cd70 and their names
    const sndNames = { [SND.MAINLOOP]: 'SND_IFC_MAINLOOP', [SND.MAINON]: 'SND_IFC_MAINON', [SND.MAINOFF]: 'SND_IFC_MAINOFF', [SND.POINTER]: 'SND_IFC_POINTER', [SND.INFO[0]]: 'SND_IFC_INFO1', [SND.INFO[1]]: 'SND_IFC_INFO2', [SND.INFO[2]]: 'SND_IFC_INFO3', [SND.TYPING]: 'SND_IFC_TYPING', [SND.PRINTER]: 'SND_IFC_PRINTER', [SND.GARAGE2]: 'SND_IFC_GARAGE2', [SND.GARAGE3]: 'SND_IFC_GARAGE3', [SND.BOING]: 'SND_IFC_BOING', [SND.WIBBLE]: 'SND_IFC_WIBBLE' };
    for (const [id, n] of Object.entries(sndNames)) ok(snd[+id]?.name === n, `sound ${id} is ${snd[+id]?.name}, expected ${n}`);
    // FUN_0054cd70: FUN_00443580(id) for the 13 ids in order
    {
      const code = pe.slice(0x54cd70, 0x105);
      const ids = [];
      for (let i = 0; i + 5 < code.length; i++) {
        if (code[i] === 0x68) { const v = code[i + 1] | (code[i + 2] << 8) | (code[i + 3] << 16); if (v >= 0x27b && v <= 0x2be && code[i + 5] === 0xe8) ids.push(v); }
      }
      ok(JSON.stringify(ids) === JSON.stringify([0x27b, 0x27c, 0x27d, 0x27e, 0x27f, 0x280, 0x281, 0x2ba, 0x2b9, 699, 700, 0x2bd, 0x2be]), `FUN_0054cd70 loads ${ids.map((x) => x.toString(16))}`);
    }
    // the clip numbers: FUN_0043b6a3(anim, clip, 0) immediates in FUN_0054ce86 (0x3a Pepper), 0x73 (29 figures and Pepper's menu pose), 0x78 (menu closed)
    ok(CLIP.SETUP === 0x3a && CLIP.MENU_OPEN === 0x73 && CLIP.MENU_CLOSE === 0x78, 'clip numbers');
    {
      const setup = pe.slice(0x54bce3, 0x32a);   // FUN_0054bce3: the call to FUN_0043b6a3 with 0x73
      let n73 = 0;
      for (let i = 0; i + 1 < setup.length; i++) if (setup[i] === 0x6a && setup[i + 1] === 0x73) n73++;
      ok(n73 >= 2, 'FUN_0054bce3 pushes clip 0x73 twice (the two keys that open the menu)');
    }

    // ============================================================ the page table
    const pages = readIfcPages(pe);
    ok(pages.length === IFC_PAGE_COUNT && pages.length === 46, '46 pages');
    ok(pages.slice(0, 17).every((p) => p.kind === 0) && pages.slice(17).every((p) => p.kind === 2), 'pages 0..16 are normal pages, 17..45 dialog pages');
    ok(pages.slice(17).length === 29, '29 character pages');
    const gotoTargets = [];
    for (let i = 0; i < 17; i++) {
      const p = pages[i];
      ok(p.items[0].type === 0 && p.items.at(-1).label === '!BACK' && p.items.at(-1).type === 2, `page ${i}: title ... back`);
      ok(msgs.label(p.items[0].label) !== p.items[0].label.slice(1), `page ${i} title ${p.items[0].label} resolves`);
      for (const it of p.items.slice(1, -1)) {
        ok(it.type === 1 && it.value >= CHAR_PAGE0 && it.value < 46, `page ${i}: goto ${it.label} -> ${it.value}`);
        ok(pages[it.value].items[0].label === it.label, `page ${i}: goto target ${it.value} is the page of ${it.label} (${pages[it.value].items[0].label})`);
        gotoTargets.push(it.value);
      }
    }
    {
      const unreachable = [];
      for (let p = CHAR_PAGE0; p < 46; p++) if (!gotoTargets.includes(p)) unreachable.push(pages[p].items[0].label);
      ok(new Set(gotoTargets).size === 25 && gotoTargets.length === 25, `the 17 locations lead to 25 character pages, each once (${gotoTargets.length})`);
      ok(JSON.stringify(unreachable) === JSON.stringify(['!IFCBILL', '!IFCXXX0', '!IFCXXX1', '!IFCXXX2']), `Bill and the three footballers have a page but no location links to it: ${unreachable}`);
      notes.push(`unreachable character pages (data): ${unreachable.join(' ')}`);
    }
    for (let k = 0; k < 29; k++) {
      const p = pages[CHAR_PAGE0 + k];
      const name = labelId(p.items[0].label);
      ok(p.items[0].value === k + 1, `character page ${CHAR_PAGE0 + k} shows record ${k + 1}`);
      ok(p.items[1].label === `!${name}02` || /^!IFC...02$|^!IFCXXX\d02$/.test(p.items[1].label), `page ${CHAR_PAGE0 + k} line label ${p.items[1].label}`);
      ok(p.items[2].label === '!BACK' && p.items[2].type === 2, `page ${CHAR_PAGE0 + k} back item`);
      ok(ifc.has(name) && ifc.has(labelId(p.items[1].label)), `page ${CHAR_PAGE0 + k}: ${name} and its line exist in IFC.str`);
    }

    // ============================================================ the texts
    ok(ifc.text('IFCBRIK') === 'Brickster' && ifc.text('IFCBRIK02') === 'Beroep: boef', 'IFC.str: Brickster / Beroep: boef');
    {
      const fits = (s) => s.length * 11 <= TEXT_WIDTH;
      const l1 = infoLines('!IFCBRIK02', (id) => ifc.text(id), fits);
      ok(JSON.stringify(l1) === JSON.stringify(['Beroep: boef']), `one line for IFCBRIK02: ${JSON.stringify(l1)}`);
      const l2 = infoLines('!IFCRICH02', (id) => ifc.text(id), (s) => s.length <= 20);
      ok(l2.join(' ') === 'Beroep: student aan de kunstacademie' && l2.length === 2 && l2.every((s) => s.length <= 20), `a long line wraps at the last space: ${JSON.stringify(l2)}`);
      const l3 = infoLines('!IFCXXX002', (id) => ifc.text(id), fits);
      ok(l3.length === 1 && l3[0] === 'Beroep: voetballer', `numbered ids with three digits: ${JSON.stringify(l3)}`);
      // a following line: ids 03, 04 ... until a lookup returns its own id
      const t = new MessageTable([Uint8Array.from(Buffer.from('IFCA02:-1  eerste\r\nIFCA03:-1  tweede\r\nIFCA04:-1  derde\r\n', 'latin1'))]);
      ok(JSON.stringify(infoLines('!IFCA02', (id) => t.text(id), fits)) === JSON.stringify(['eerste', 'tweede', 'derde']), 'the lines 02, 03, 04 are shown in order');
    }
    for (let k = 0; k < 29; k++) {
      const p = pages[CHAR_PAGE0 + k];
      const l = infoLines(p.items[1].label, (id) => ifc.text(id), (s) => s.length * 10 <= TEXT_WIDTH);
      ok(l.length >= 1 && l[0].startsWith('Beroep:'), `character page ${CHAR_PAGE0 + k} shows its Beroep line: ${JSON.stringify(l)}`);
    }

    // ============================================================ the room: the camera and the keys
    const host = makeHost(msgs);
    const room = new IfcRoom(pages, host);
    // the pins as the set-up attaches them: records 32..48, pages from FUN_0054ce86 (arg of each attach)
    const PIN_PAGES = [7, 0, 16, 15, 6, 8, 1, 5, 14, 2, 13, 9, 4, 11, 10, 3, 12];
    PIN_PAGES.forEach((pg, i) => room.addPin(32 + i, pg, labelId(pages[pg].items[0].label)));
    room.setSelected(IFC_RECORDS.START_PIN);
    ok(host.log.vars.get(0xfa) === 47 && room.pins.get(47).page === 3 && room.pins.get(47).id === 'IFCINFC', 'the first selected pin is record 47 = the Info Centre (var 0xfa)');
    const tick = (keys = 0, n = 1) => { for (let i = 0; i < n; i++) { host.log.play.length = 0; room.update(keys); room.camera(); for (const [rec] of room.pins) room.pinUpdate(rec, 5); room.doorUpdate(); room.afterFrame(keys); } };
    /** a button in the menu fires its action after the 4 tick press animation of the engine (param_1[3] = 4 counts down to 1) */
    const menuPress = (k) => { tick(k); tick(0, 4); };
    // --- the fly-in: x = 24 - 1.2 * cnt, z 7.2, 21 ticks, then the far view (state 3)
    ok(room.state === ST.ENTER && room.cnt === 0, 'starts in state 0');
    room.update(0); room.camera();
    ok(near(room.eye[0], 24) && near(room.eye[2], 7.2, 1e-6) && near(room.eye[1], 7.04, 1e-6) && room.target[2] === CAM.TARGET_Z && room.cnt === 1, 'tick 0: eye x 24');
    for (let i = 1; i < 20; i++) { room.update(0); room.camera(); }
    ok(near(room.eye[0], 24 - 1.2 * 19, 1e-5) && room.state === ST.ENTER, 'tick 19: eye x 1.2');
    room.update(0); room.camera();
    ok(near(room.eye[0], 0, 1e-5) && room.state === ST.IDLE && room.cnt === 21, 'tick 20 is the last fly-in step (x = 0) and the same call settles into state 3 (4 -> 3)');
    room.update(0); room.camera();
    ok(room.state === ST.IDLE && room.eye[0] === 0 && near(room.eye[2], 7.2, 1e-6) && room.pinsOff === 1, 'the far view: state 3, pins off');
    // keys that do nothing in state 3: Right, Esc
    tick(B.RIGHT); tick(B.ESC);
    ok(room.state === ST.IDLE, 'Right / Esc do nothing at the far view');
    // --- zoom in with Up (state 5, 21 ticks, z = 7.2 - 0.52 cnt), the sound MAINON
    host.log.restart.length = 0;
    tick(B.UP);
    ok(room.state === ST.ZOOM_IN && host.log.restart.includes(SND.MAINON), 'Up in state 3 starts the zoom and the MAINON sound');
    ok(near(room.eye[2], 7.2, 1e-5) && room.cnt === 1, 'zoom tick 0: z 7.2');
    tick(0, 19);
    ok(near(room.eye[2], 7.2 - 0.52 * 19, 1e-5) && room.state === ST.ZOOM_IN, 'zoom tick 19');
    tick(0, 1);
    ok(near(room.eye[2], 7.2 - 0.52 * 20, 1e-5) && room.state === ST.MAP && room.cnt === 21, 'zoom tick 20: z -3.2 and state 1 (map)');
    tick(0);
    ok(room.state === ST.MAP && near(room.eye[2], -4.8, 1e-6) && room.pinsOff === 0, 'the map view: eye z -4.8, pins on');
    ok(room.caption === 'Infocentrum', `caption of the selected pin: ${room.caption}`);
    // --- Left / Right move the selection to the neighbouring pin record; the key is used up
    host.log.restart.length = 0;
    tick(B.LEFT);
    ok(room.selected === 46 && host.log.vars.get(0xfa) === 46 && host.log.restart.includes(SND.POINTER), 'Left selects record 46 and plays the pointer sound');
    tick(0);
    ok(room.caption === 'Winkel 2', `caption ${room.caption}`);
    tick(B.RIGHT); tick(B.RIGHT);
    ok(room.selected === 48, 'Right twice: record 48 (the last pin)');
    tick(B.RIGHT);
    ok(room.selected === 48, 'no pin after the last one');
    for (let i = 0; i < 20; i++) tick(B.LEFT);
    ok(room.selected === 32, 'Left stops at the first pin (record 32)');
    tick(B.LEFT);
    ok(room.selected === 32, 'no pin before the first one');
    // a pass in record order: a key used by the first pin is gone for the next (RIGHT moves one step, not two)
    {
      room.setSelected(40); room.keys = B.RIGHT;
      const y0 = 5;
      room.pinUpdate(40, y0);
      ok(room.selected === 41 && room.keys === 0, 'the pin that moved the selection cleared the key');
      room.pinUpdate(41, y0);
      ok(room.selected === 41, 'the next pin did not see the key');
      room.setSelected(47);
    }
    // --- the bobbing: 37 steps per period, amplitude 0.04
    {
      const r2 = new IfcRoom(pages, makeHost(msgs));
      r2.addPin(47, 3, 'IFCINFC'); r2.setSelected(47);
      let y = 5, lo = 5, hi = 5;
      for (let i = 0; i < 37; i++) { y = r2.pinUpdate(47, y); lo = Math.min(lo, y); hi = Math.max(hi, y); }
      ok(hi - 5 > 0.45 && hi - 5 < 0.46 && lo >= 5 - 1e-6 && Math.abs(y - 5) < 1e-3, `bob: rises by ${hi - 5} (0.04 * 11.4) and is back at the start after one period (${y - 5})`);
      const a37 = r2.pins.get(47).angle;
      ok(a37 === 0 || a37 > 0, 'the angle wraps');
      r2.pinUpdate(47, 0);
      ok(near(r2.pins.get(47).angle, PIN.STEP, 1e-6) || r2.pins.get(47).angle < 6.3, 'angle keeps below 2 pi + step');
      // a pin that is not selected does not move
      r2.addPin(46, 10, 'IFCSHP2');
      ok(r2.pinUpdate(46, 7) === 7, 'a pin that is not selected stays');
    }
    // --- the menu: Enter opens it; the first frame only starts the engine at the pin's page
    host.log.clips.length = 0;
    tick(B.ENTER);
    ok(room.state === ST.MENU && room.menuOpen === 1 && room.pauseBlocked === false, 'Enter in state 1 opens the menu (this tick the pause trigger was still allowed)');
    ok(host.log.clips[0] === CLIP.MENU_OPEN, "Pepper's clip 0x73 starts");
    ok(room.menu.open && room.menu.page === room.selectedPage() && room.menu.item === 1, "the engine started at the selected pin's page");
    {
      const s = room.selected; const pg = room.pins.get(s).page;
      ok(room.menu.page === pg, `the engine page ${room.menu.page} is the pin's page ${pg}`);
    }
    // --- go through the pages of the Info Centre pin (page 3: Infomaniak): Enter on the person, then the dialog
    // (reselect the Info Centre pin: close the menu first with Esc)
    tick(B.ESC);
    ok(room.state === ST.MAP && room.menuOpen === 0 && host.log.clips.at(-1) === CLIP.MENU_CLOSE, 'Esc on the top page closes the menu: state 1, Pepper clip 0x78');
    room.setSelected(47);
    tick(B.SHIFT);
    ok(room.state === ST.MENU && room.menu.page === 3, 'Shift opens the menu as well, at page 3');
    host.rand = () => 0.5;
    room.menu.item = 1;
    host.log.all.length = 0;
    menuPress(B.ENTER);                                  // goto: item 1 = Infomaniak -> page 18
    ok(room.menu.page === 18 && room.characterRecord() === 2, 'Enter on the person opens page 18, record 2 (INFO)');
    ok(room.menu.item === 2 && room.menu.cur.kind === 2, 'a dialog page keeps the cursor on its back button (FUN_0041fd45)');
    ok(host.log.all.some((id) => SND.INFO.includes(id)), 'a page change plays one of the three info sounds');
    ok(host.log.menu.includes('select'), 'and the engine plays select');
    // the info sound choice: rand * ms % 3
    {
      const h2 = makeHost(msgs), r2 = new IfcRoom(pages, h2);
      r2.addPin(47, 3, 'IFCINFC'); r2.setSelected(47);
      const seen = new Set();
      for (const rr of [0.1, 0.2, 0.3]) {           // floor(rand * 10) % 3 = 1, 2, 0
        r2.menuInit = true; r2.menu.openAt(3); r2.menuInit = true; r2.state = ST.MENU; r2.menuOpen = 1;
        h2.r = rr; h2.clock = 10;
        r2.menu.item = 1; h2.log.all.length = 0;
        r2.menuFrame(B.ENTER); for (let q = 0; q < 4; q++) r2.menuFrame(0);
        for (const id of h2.log.all) if (SND.INFO.includes(id)) seen.add(id);
      }
      ok(seen.size === 3, `the three info sounds are picked by rand * ms % 3: ${[...seen]}`);
    }
    menuPress(B.ENTER);                                  // Enter on the back button of the dialog
    ok(room.menu.page === 3 && room.characterRecord() === -1, 'Enter on the dialog back button goes back to the location page');
    menuPress(B.ENTER);                                  // item 1 again: the person
    tick(B.ESC);                                         // Esc on the dialog = back
    ok(room.menu.page === 3, 'Esc on a dialog page goes back');
    tick(B.ESC);
    ok(room.state === ST.MAP && room.menuOpen === 0, 'Esc on the location page closes the menu');
    // every location page: its people, open each character page
    for (let li = 0; li < 17; li++) {
      const pin = [...room.pins.values()].find((p) => p.page === li);
      room.setSelected(pin.rec);
      tick(B.ENTER);
      ok(room.menu.page === li, `location ${li} opens its page`);
      const people = pages[li].items.slice(1, -1);
      for (let pi = 0; pi < people.length; pi++) {
        room.menu.item = 1 + pi;
        menuPress(B.ENTER);
        ok(room.menu.page === people[pi].value && room.characterRecord() === people[pi].value - 16, `location ${li}: person ${people[pi].label} opens page ${people[pi].value}`);
        tick(B.ESC);
        ok(room.menu.page === li, `location ${li}: back from ${people[pi].label}`);
      }
      tick(B.ESC);
      ok(room.state === ST.MAP, `location ${li}: closed`);
    }
    // --- zoom out with Down: state 6, 21 ticks, z = -4.8 + 0.52 cnt, MAINOFF, back at the far view
    host.log.restart.length = 0;
    tick(B.DOWN);
    ok(room.state === ST.ZOOM_OUT && host.log.restart.includes(SND.MAINOFF) && near(room.eye[2], -4.8, 1e-6), 'Down in the map view zooms out');
    tick(0, 19);
    ok(near(room.eye[2], -4.8 + 0.52 * 19, 1e-5), 'zoom out tick 19');
    tick(0);
    ok(room.state === ST.IDLE && near(room.eye[2], 7.2, 1e-6), 'zoom out ends at the far view (state 6 -> 3 and the state 3 branch sets z 7.2 in the same call)');

    // ============================================================ the exit question
    ok(room.exitAsk === 0 && room.doorWanted === 0, 'no exit question yet');
    tick(B.LEFT);
    ok(room.state === ST.TURN && room.doorWanted === 1 && room.cnt === 1, 'Left at the far view starts the turn and wants the door open');
    ok(near(room.target[0], 0) && near(room.target[2], CAM.TURN_Z - 1, 1e-6) && near(room.eye[2], 7.2, 1e-6), 'turn tick 0: target (0, 6.2)');
    tick(0, 7);
    ok(room.state === ST.TURN && room.exitAsk === 0, 'turn tick 7');
    ok(near(room.target[0], Math.sin((7 * CAM.PI) / 20), 1e-5) && near(room.target[2], CAM.TURN_Z - Math.cos((7 * CAM.PI) / 20), 1e-5), 'turn tick 7: target on the unit circle around (0, 7.2)');
    tick(0);
    ok(room.state === ST.TURNED && room.exitAsk === 1, 'after 9 ticks (8 < cnt) the exit question is due (DAT_05d587cc = 1) and state 8');
    ok(near(room.target[0], Math.sin(CAM.HOLD), 1e-6) && near(room.target[2], CAM.TURN_Z - Math.cos(CAM.HOLD), 1e-6), 'state 8 holds the angle of the double constant');
    ok(room.state === ST.TURNED, 'held');
    // the door opens by 5 degrees per tick while it is wanted: 18 ticks to -90 (a 19th tick stays there)
    {
      const r3 = new IfcRoom(pages, makeHost(msgs));
      r3.doorWanted = 1;
      const seq = [];
      for (let i = 0; i < 21; i++) seq.push(r3.doorUpdate());
      ok(seq[0] === 0 && seq[1] === -5 && seq[17] === -85 && seq[18] === -90 && seq[19] === -90 && seq[20] === -90, `door opens: ${seq.slice(0, 4)} ... ${seq.slice(16)}`);
      ok(r3.doorState === 2, 'door state 2 = open');
      r3.doorWanted = 0;
      const seq2 = [];
      for (let i = 0; i < 20; i++) seq2.push(r3.doorUpdate());
      ok(seq2[0] === -90 && seq2[1] === -85 && seq2.at(-1) === 0 && r3.doorState === 0, `door closes: ${seq2.slice(0, 3)} ... ${seq2.slice(-2)}`);
      // wanted again while closing: reverses
      r3.doorWanted = 1; r3.doorUpdate(); r3.doorUpdate(); r3.doorUpdate();
      const a = r3.doorAngle;
      r3.doorWanted = 0; r3.doorUpdate();
      r3.doorWanted = 1; r3.doorUpdate();
      ok(r3.doorAngle < a + 5 && r3.doorState === 1, 'wanted again while closing: opens again');
    }
    // the answer "Annuleren": back to the far view; the door closes
    room.exitAnswered(false);
    tick(0);
    ok(room.exitAsk === 0 && room.state === ST.TURN_BACK && room.doorWanted === 0, 'cancel: state 9 (turn back), door closes');
    tick(0, 8);
    ok(room.state === ST.TURN_BACK, 'turn back runs 9 ticks');
    tick(0);
    ok(room.state === ST.IDLE, 'and ends at the far view');
    // and again, now with "OK": the room stays asking (the runner leaves)
    tick(B.DOWN); tick(0, 8);
    ok(room.exitAsk === 1 && room.state === ST.TURNED, 'Down also starts the turn');
    room.exitAnswered(true);
    tick(0, 3);
    ok(room.exitAsk === 1 && room.state === ST.TURNED, 'after OK the room stays turned (the runner leaves the zone)');

    // ============================================================ ambient sounds: rand * ms % 2000
    {
      const h4 = makeHost(msgs), r4 = new IfcRoom(pages, h4);
      const t = (rand, ms) => { h4.r = rand; h4.clock = ms; h4.log.play.length = 0; r4.update(0); return h4.log.play.slice(3); };
      ok(JSON.stringify(t(0.5, 4000 + 0x479 * 2 - 0 + 0)) !== 'x', 'ambient probe');
      // rand * ms = 0x479 + 2000 k  ->  ms = (0x479 + 2000) / rand
      const pick = (want) => { h4.r = 0.5; h4.clock = 2 * (want + 2000 * 3); h4.log.play.length = 0; r4.update(0); return h4.log.play.slice(3); };
      ok(JSON.stringify(pick(0x479)) === JSON.stringify([SND.WIBBLE]), 'WIBBLE at 0x479');
      ok(JSON.stringify(pick(0xf4)) === JSON.stringify([SND.GARAGE3]), 'GARAGE3 at 0xf4');
      ok(JSON.stringify(pick(0x330)) === JSON.stringify([SND.BOING]), 'BOING at 0x330');
      ok(JSON.stringify(pick(0x635)) === JSON.stringify([SND.GARAGE2]), 'GARAGE2 at 0x635');
      ok(JSON.stringify(pick(100)) === JSON.stringify([]), 'no ambient sound at 100');
      h4.r = 0.5; h4.clock = 10; h4.log.play.length = 0; r4.update(0);
      ok(JSON.stringify(h4.log.play.slice(0, 3)) === JSON.stringify([SND.MAINLOOP, SND.TYPING, SND.PRINTER]), 'the three loops are started every tick');
    }

    // ============================================================ dialog layout
    {
      const table = Array.from({ length: 20 }, (_, i) => pe.u32(0x8a99c8 + 4 * i) | 0).map((v) => (v >= 0x80000000 ? v - 0x100000000 : v));
      ok(JSON.stringify(table) === JSON.stringify([-5, 0, -2, -1, -7, -7, -7, -7, -7, -7, -7, -7, -7, -7, -7, -1, 2, -1, 3, -1]), `the dialog row table 0x8a99c8: ${table}`);
      const rows = dialogRows(table, 3);
      ok(rows.length === 18 && rows[17] === -6 && rows[16] === 2 && rows[4] === -7 && rows[14] === -7 && rows[15] === -1, `18 rows for 3 items: ${rows}`);
      ok(dialogY0(3) === 36, 'the panel starts at y = 0xf0 - (17 * 24) / 2 = 36');
      ok(TEXT_X === 272 && TEXT_WIDTH === 336, 'text column x = (8 - 10) * 24 + 320, wrap width (12 + 2) * 24');
    }

    // ============================================================ zone set-up: the four behaviours attach, nothing is skipped
    {
      const L = loadZone(ctx, 'z04IFC', {});
      const w = L.world;
      ok(L.skipped.length === 0 || L.skipped.every((s) => ![IFC_CTOR.CONTROLLER, IFC_CTOR.PIN, IFC_CTOR.CHARACTER, IFC_CTOR.DOOR].includes(s.ctor)), `no skipped attach of the room: ${JSON.stringify(L.skipped.slice(0, 3))}`);
      const kinds = w.records.map((r) => r.ctrl?.nodes.map((n) => n.kind).join('+') ?? '');
      ok(kinds[7].includes('IfcMap'), 'record 7 (PEPP) has the controller');
      let pins = 0, chars = 0;
      for (let i = 0; i < w.records.length; i++) {
        if (kinds[i].includes('IfcPin')) { pins++; ok(w.records[i].name === 'PONT' && i >= 32 && i <= 48, `pin on record ${i} (${w.records[i].name})`); }
        if (kinds[i].includes('IfcChar')) { chars++; ok(i >= 1 && i <= 29 && i !== 7, `character node on record ${i} (${w.records[i].name})`); }
      }
      ok(pins === 17 && chars === 28, `17 pins and 28 character nodes: ${pins} / ${chars}`);
      ok(kinds[30].includes('IfcDoor') && w.records[30].name === 'DOOR', 'the door record 30 has the door node');
      const pinPages = w.records.slice(32, 49).map((r) => r.ctrl.nodes.find((n) => n.kind === 'IfcPin').page);
      ok(JSON.stringify(pinPages) === JSON.stringify(PIN_PAGES), `pin pages by record: ${pinPages}`);
      // record names: the figure of page 17 + k is record 1 + k and carries the name of the page title
      for (let k = 0; k < 29; k++) ok(`!IFC${w.records[k + 1].name}` === pages[CHAR_PAGE0 + k].items[0].label, `record ${k + 1} (${w.records[k + 1].name}) is the figure of page ${CHAR_PAGE0 + k} (${pages[CHAR_PAGE0 + k].items[0].label})`);
      for (let i = 1; i <= 29; i++) if (i !== 7) ok((w.records[i].flags & 2) === 0, `figure record ${i} starts hidden`);
      ok(w.records[7].name === 'PEPP', 'record 7 is PEPP');
      // pins by their place: record order = x descending (so Left = the next higher x = the next pin to the left of the picture)
      const xs = w.records.slice(32, 49).map((r) => r.x);
      ok(xs.every((x, i) => i === 0 || x <= xs[i - 1]), 'the pins are in record order by decreasing x');
      ok(near(L.world.records[30].x, DOOR.X, 0.01) && near(L.world.records[30].y, DOOR.Y, 0.01), 'the door sits where FUN_0054caa1 puts it');
      // the camera of the controller, run through the world
      let pagesOk = true;
      for (let i = 0; i < pages.length; i++) pagesOk = pagesOk && pages[i].items.length >= 3;
      ok(pagesOk, 'every page has at least title / item / back');
      notes.push(`pins ${pins}, characters ${chars}, pages ${pages.length}, exit page ${EXIT_PAGE}`);
    }

    return { checked, failures, notes };
  },
};
