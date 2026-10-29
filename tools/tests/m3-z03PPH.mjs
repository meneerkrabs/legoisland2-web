// M3 z03PPH, Pepper's house: the hotspots / fixed cameras / door, the trophy room (EXE-extracted trophy table, tier flags by the TROPHY_xxx variables), the trophy browser,
// the wall map, the computer menu (pages 21..24 on the real page table, replay gating, var 0x4d state, movies / sound test), the island totals (FUN_00423bf0) and the
// exit rule. Scripted input on the real data (docs/re/m3/z03PPH.md).
import { loadZone, loadExe } from '../lib/engine-load.mjs';
import '../../src/zones/z03PPH.ts';
import { houseOf, scanHotspots, HOTSPOT, HOTSPOT_POS, HOTSPOT_RADIUS, CAM_POS, MODE, REC, TROPHY_SOUND, SOUND_NO_TROPHY, SOUND_NO_INDEX, FORCE_PART, trophyLevelId, BROWSE_HOME,
  MAP_TARGET, DOOR_POS, COMPUTER_POS, COMPUTER_EYE, ICON, CTOR } from '../../src/zones/z03PPH/house.ts';
import { ComputerMenu, PAGE, enterZone, unpackMenuInternals, COMPUTER_MASK } from '../../src/zones/z03PPH/computer.ts';
import { computeIslandTotals, IV, islandTrophy } from '../../src/zones/z03PPH/totals.ts';
import { MenuEngine } from '../../src/shell/menu.ts';
import { toEnginePages } from '../../src/shell/menuui.ts';
import { readMenuPages, readLevelSelect, packMenuInternals, replayEnabled } from '../../src/shell/tables.ts';
import { B } from '../../src/game/input.ts';
import { registeredCtors } from '../../src/game/setup.ts';

export default {
  name: 'm3-z03PPH',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const eq = (msg, a, b) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
    const near = (msg, a, b, e = 1e-3) => { checked++; if (!(Math.abs(a - b) <= e)) failures.push(`${msg}: got ${a}, want ${b}`); };
    const pe = loadExe(ctx.dataRoot);

    // ============================================================ the zone and its attaches (extraction)
    const L = loadZone(ctx, 'z03PPH');
    const w = L.world, vars = w.vars, rec = w.records;
    eq('no skipped attaches in the house', L.skipped.map((s) => s.ctorName), []);
    for (const a of Object.values(CTOR)) ok(registeredCtors().includes(a), `constructor 0x${a.toString(16)} registered`);
    const attaches = L.setup.attaches;
    const trophyAttaches = attaches.filter((a) => a.ctor === CTOR.TROPHY || a.ctor === CTOR.ISLAND_TROPHY);
    eq('23 trophy attaches (19 mini-games + the skate park, 4 islands)', [trophyAttaches.length, trophyAttaches.filter((a) => a.ctor === CTOR.ISLAND_TROPHY).length], [23, 4]);
    eq('the trophy records are 8..30 (the browser order)', trophyAttaches.map((a) => a.record).sort((a, b) => a - b), Array.from({ length: 23 }, (_, i) => i + 8));
    // each trophy: the variable names tie trophy / high score / record together (TWAB: TROPHY_WAB + HISCORE_WAB ...)
    const nm = (i) => vars.nameOf(i).replace(/^SWITCH_GME_/, '');
    const bad = [];
    for (const a of trophyAttaches) {
      const [tv, hv, snd] = a.argWords;
      const suffix = rec[a.record].name.slice(1);
      const isl = { OGL: 'OGL', ADV: 'ADV', LGI: 'LGI', CSI: 'CSI' }[suffix];
      const t = nm(tv), h = nm(hv);
      const want = suffix === 'SKP' ? 'BPK' : suffix === 'BPL' ? 'BRP' : suffix;
      if (!t.includes(want) || !t.includes('TROPHY')) bad.push(`${rec[a.record].name}: trophy var ${t}`);
      const hWant = isl ? (want === 'ADV' ? 'CAI' : want) : want;
      if (!h.includes(hWant) || !h.includes('HISCORE')) bad.push(`${rec[a.record].name}: hiscore var ${h}`);
      if (snd < 0 || snd > 22) bad.push(`${rec[a.record].name}: sound ${snd}`);
    }
    eq('trophy / high score variable names match the record names', bad, []);
    eq('sound indices are 0..22, each once', trophyAttaches.map((a) => a.argWords[2]).sort((a, b) => a - b), Array.from({ length: 23 }, (_, i) => i));
    eq('player chain: ClimLadr, SGwalk, PeppComp, browser, map (gates 0 / 1 / 4 / 2 / 0x20)', rec[REC.PEPP].ctrl.nodes.filter((n) => n.kind !== 'StubGuard').map((n) => [n.kind, n.var, n.mask, n.value]),
      [['ClimLadr', 0x5e, 0, 0], ['SGwalk', 0x5e, 1, 1], ['PeppComp', 0x5e, 4, 4], ['TrophyBrowser', 0x5e, 2, 2], ['MapView', 0x5e, 0x20, 0x20]]);
    eq('record names: 2 DOOR, 6 PHSE, 8 TOGL, 17 TSKP, 32 TIMM, 33 PEPP', [2, 6, 8, 17, 32, 33].map((i) => rec[i].name), ['DOOR', 'PHSE', 'TOGL', 'TSKP', 'TIMM', 'PEPP']);
    eq('level ids of the trophies', ['TOGL', 'TADV', 'TLGI', 'TCSI', 'TSKP', 'TBPL', 'TWAB'].map(trophyLevelId), ['LEVOGL', 'LEVCAI', 'LEVLGI', 'LEVCSI', 'LEVBPK', 'LEVBRP', 'LEVWAB']);
    // the part models of the trophies: 3 parts (gold / silver / bronze meshes)
    const parts = (i) => rec[i].model?.parts.filter(Boolean).length;
    eq('trophy models have 3 parts (gold, silver, bronze); the wall map and the door 1', [parts(8), parts(18), parts(17), parts(32), parts(2)], [3, 3, 3, 1, 1]);

    const st = houseOf(w), pep = L.pepper;
    const tick = (n = 1) => { for (let i = 0; i < n; i++) w.tick(); };
    const press = (code) => { w.input.setKey(code, true); w.tick(); w.input.setKey(code, false); w.tick(); };
    const place = (x, z, ry = 0) => { pep.x = x; pep.z = z; pep.ry = ry; pep.rebuildYaw(); };
    tick(2);
    eq('walking at the start (var 0x5e = 1)', vars.get(0x5e), MODE.WALK);

    // ============================================================ trophy tiers: the forced-part flags by the variable value
    const wab = rec[18], wabNode = wab.ctrl.nodes[0];
    eq('TWAB trophy node reads TROPHY_WAB (0x40) / HISCORE_WAB (0x20), sound index 1', [wabNode.trophyVar, wabNode.hiscoreVar, wabNode.sound], [0x40, 0x20, 1]);
    for (const v of [0, 1, 2, 3]) {
      vars.set(0x40, v); tick();
      eq(`TROPHY_WAB = ${v}: flags & 0x8700`, wab.flags & 0x8700, FORCE_PART[v]);
    }
    vars.set(0x40, 3); tick();
    ok((wab.flags & 0x2) !== 0, 'the trophy record stays enabled (only the draw part changes)');
    // every trophy follows its own variable
    for (const a of trophyAttaches) {
      const r = rec[a.record]; vars.set(a.argWords[0], 2); tick();
      eq(`${r.name} silver`, r.flags & 0x8700, 0x200); vars.set(a.argWords[0], 0);
    }
    tick();
    ok(trophyAttaches.every((a) => (rec[a.record].flags & 0x8000) !== 0), 'no trophy value: every trophy hidden (0x8000)');

    // ============================================================ hotspots (FUN_005402ac): the scan on its own, then in the world
    const id = (p) => [...p];
    eq('scan: in the computer corner (-6.5, -6.5)', scanHotspots(id, -6.5, -6.5, 0), HOTSPOT.COMPUTER);
    eq('scan: at the wall map (-15, 6)', scanHotspots(id, -15, 6, 0), HOTSPOT.MAP);
    eq('scan: at the door facing +z (-6, 9)', scanHotspots(id, -6, 9, 0.2), HOTSPOT.DOOR);
    eq('scan: at the door facing away -> the trophy box (every other place)', scanHotspots(id, -6, 9, 2.5), HOTSPOT.TROPHIES);
    eq('scan: |ry| exactly 0.78 still counts, 0.79 does not', [scanHotspots(id, -6, 9, Math.fround(0.78)), scanHotspots(id, -6, 9, 0.79)], [HOTSPOT.DOOR, HOTSPOT.TROPHIES]);
    eq('scan: the trophy box is 80 wide: the start place facing away from the door', scanHotspots(id, -3.75, 5.37, 3.0), HOTSPOT.TROPHIES);
    eq('scan: outside the 80 box (z = 90)', scanHotspots(id, 0, 90, 0), HOTSPOT.NONE);
    eq('scan: the corner of the computer box is exclusive of the next slot: (-6.5 + 8, ...) still the computer', scanHotspots(id, -6.52 + 8, -6.568 + 8, 0), HOTSPOT.COMPUTER);
    eq('scan: just beyond the computer box falls to the trophy box', scanHotspots(id, -6.52 + 8.01, -6.568, 0), HOTSPOT.TROPHIES);
    eq('hotspot table: radii and positions (the float constants of the executable)', JSON.stringify([HOTSPOT_RADIUS, HOTSPOT_POS[0], HOTSPOT_POS[4]]), JSON.stringify([[8, 8, 8, 80, 1.6], [-6.52, 0.96, -6.568], [-6, 0.96, 10]].map((a) => a.map((v) => Array.isArray(v) ? v : Math.fround(v)))));

    // in the world: the icon and the door flag follow the hotspot
    place(-3.75, 5.37, 3.0); tick();
    eq('start place facing away from the door: trophy icon, door closed', [st.icon, st.doorOpen, st.lastHotspot], [ICON.TROPHIES, false, HOTSPOT.TROPHIES]);
    place(-3.75, 5.37, 0); tick();
    eq('start place facing +z: inside the 8 box of the door (|dx| 2.25, |dz| 4.6): door icon', [st.icon, st.doorOpen, st.lastHotspot], [ICON.DOOR, true, HOTSPOT.DOOR]);
    place(-6, 9, 0.1); tick();
    eq('at the door facing it: door icon, door opens', [st.icon, st.doorOpen], [ICON.DOOR, true]);
    place(-6.4, -6.4, 0); tick();
    eq('at the computer: computer icon', [st.icon, st.doorOpen], [ICON.COMPUTER, false]);
    place(-15, 6, 0); tick();
    eq('at the map: no icon', [st.icon], [ICON.NONE]);

    // ============================================================ the door
    const door = rec[REC.DOOR].ctrl.nodes[0];
    st.doorOpen = true;
    const angles = []; for (let i = 0; i < 22; i++) { tick(); angles.push(door.angle); }
    // (the hotspot node resets doorOpen each tick, so drive the door node alone below)
    const dn = { angle: 0, state: 0 };
    const dr = rec[REC.DOOR];
    place(-3.75, 5.37, 0); tick(3);
    st.doorOpen = false;
    const ds = Object.create(Object.getPrototypeOf(door)); Object.assign(ds, { state: 0, angle: 0 });
    const hold = (open, n) => { const out = []; for (let i = 0; i < n; i++) { houseOf(w).doorOpen = open; ds.update(w, dr); out.push(ds.angle); } return out; };
    eq('door: opens 5 degrees per tick, then stays at 90', hold(true, 20).filter((_, i) => i === 0 || i >= 16), [0, 80, 85, 90, 90]);
    ok(ds.state === 2, 'door state 2 (open)');
    const closing = hold(false, 20);
    eq('door: closes 5 degrees per tick', closing.slice(0, 4), [90, 85, 80, 75].map((a, i) => i === 0 ? 90 : a));
    ok(ds.state === 0 && ds.angle === 0, `door closed again (state ${ds.state}, angle ${ds.angle})`);
    hold(true, 3);
    eq('door: re-open while closing reverses at once', [hold(true, 1)[0] > 0], [true]);
    near('door record sits at its hinge (-3.763, 0, 14.598)', dr.x, DOOR_POS[0]); near('door z', dr.z, DOOR_POS[2]);
    ds.angle = 90; ds.state = 2; ds.update(w, dr);
    near('door rotated 90 degrees about y: forward row = (1, 0, 0)', dr.m[8], 1, 1e-4);

    // ============================================================ walking out: z > 15 leaves, the door button leaves
    st.leave = false; place(-3.75, 14.9, 0); tick();
    ok(!st.leave, 'z = 14.9: still inside');
    place(-3.75, 15.2, 0); tick();
    ok(st.leave, 'z > 15: the house is left');
    st.leave = false;
    place(-6, 9, 0.1); tick(); ok(!st.leave, 'at the door without the button: nothing');
    w.input.setKey('ShiftLeft', true); tick(); w.input.setKey('ShiftLeft', false);
    ok(st.leave, 'Shift at the door: leave');
    st.leave = false; place(-5.5, 10.5, 3.0); tick();
    eq('behind the door spot facing away: trophies', st.lastHotspot, HOTSPOT.TROPHIES);
    // the exit slot of radius 1.6 is shadowed by the 80 box of the trophy slot (the original's order of tests)
    eq('slot 4 (door, radius 1.6) is never reached: slot 3 (80) matches first', scanHotspots(id, -6, 10, 3.0), HOTSPOT.TROPHIES);

    // ============================================================ the fixed camera: eases (0.1 of the distance per tick) to the floor camera
    const w2 = loadZone(ctx, 'z03PPH'); const W = w2.world, S = houseOf(W);
    W.tick();
    eq('camera starts at camera 1, one tick moves it 0.1 of the way to camera 0 (floor camera index 0 for a player on the ground)', [S.camCur.map((x) => +x.toFixed(2)), S.camIdx], [CAM_POS[1].map((c, i) => +(c + (CAM_POS[0][i] - c) * 0.1).toFixed(2)), 0]);
    const d0 = Math.hypot(...CAM_POS[0].map((c, i) => c - CAM_POS[1][i]));
    let prevD = d0; let geom = true;
    for (let i = 0; i < 40; i++) { W.tick(); const d = Math.hypot(...CAM_POS[0].map((c, k) => c - S.camCur[k])); if (d >= 0.1 && Math.abs(d / prevD - 0.9) > 0.02 && i > 0) geom = false; prevD = d; }
    ok(geom, 'the distance to the target shrinks by a factor 0.9 per tick');
    for (let i = 0; i < 80; i++) W.tick();
    eq('camera arrives exactly at camera 0', S.camCur.map((x) => +x.toFixed(4)), CAM_POS[0].map((x) => +x.toFixed(4)));
    eq('the camera looks at the player (the real camera state after the pre-render pass)', [W.camera.c[3], W.camera.c[5]].map((x) => +x.toFixed(3)), [w2.pepper.x, w2.pepper.z].map((x) => +x.toFixed(3)));
    // WP-VERIFY (m7-z03PPH-emu): the frame is drawn with the camera the PRE-RENDER pass left (the nodes' camera functions call FUN_0043cc5c = SetTransform(view) there, and the
    // PeppHse draw hook re-applies it); the older "display camera" of the update pass (4 above the player) was never what the original draws
    near('the drawn camera looks at the player\'s position (not 4 above)', W.camera.c[4], w2.pepper.y, 1e-4);
    // upper floor: the camera index follows the player height (y > 8.8)
    w2.pepper.y = 9.5; W.tick();
    eq('above y = 8.8 the second camera is used', S.camIdx, 1);
    w2.pepper.y = 0.3;

    // ============================================================ the computer
    place(-6.4, -6.4, 0); w.input.setKey('ShiftLeft', true); tick(); w.input.setKey('ShiftLeft', false);
    eq('Shift at the computer: PEPPER_CONTROL = 4', vars.get(0x5e), MODE.COMPUTER);
    tick();
    near('Pepper sits at the computer (x)', pep.x, COMPUTER_POS[0], 1e-4); near('... (z)', pep.z, COMPUTER_POS[2], 1e-4);
    ok(st.computerRan, 'the computer node ran (the zone game steps the menu)');
    eq('camera at the screen: eye / look', [w.camera.c[0], w.camera.c[1], w.camera.c[2], w.camera.c[3]].map((x) => +x.toFixed(3)), [COMPUTER_EYE[0], COMPUTER_EYE[1], COMPUTER_EYE[2], -10.92].map((x) => +x.toFixed(3)));
    vars.set(0x5e, MODE.WALK); place(-3.75, 5.37, 0); tick(2);

    // ---- the menu on the real page table
    const levels = readLevelSelect(pe);
    const pages = toEnginePages(readMenuPages(pe));
    const mkMenu = (mutate) => {
      const v = new (w.vars.constructor)(); v.a.set(vars.a); mutate?.(v);
      const eng = new MenuEngine(structuredClone(pages), { sound: () => {} });
      const log = { movies: [], music: [] };
      const cm = new ComputerMenu(eng, { vars: v, levels, movie: (n) => log.movies.push(n), music: (k) => log.music.push(k) });
      cm.attach();
      return { v, eng, cm, log };
    };
    /** one key press: the original needs 4 ticks for the press animation; returns whether the computer was left */
    const key = (M, k, n = 5) => { for (let i = 0; i < n; i++) if (M.cm.step(i === 0 ? k : 0)) return true; return false; };
    const idle = (M, n = 2) => { for (let i = 0; i < n; i++) M.cm.step(0); };
    let M = mkMenu();
    M.cm.reset(); idle(M, 1);
    eq('first step opens the root page 21 (PPHM0), item 1', [M.eng.page, M.eng.item, M.eng.stack.length, M.cm.started, M.cm.active], [PAGE.ROOT, 1, 0, true, true]);
    eq('STARTEDFROMMENU cleared by the open', M.v.get(0xb), 0);
    eq('the root page: replays / sound / movies / back', M.eng.cur.items.map((i) => [i.label, i.type, i.value]), [['!PPHM0', 0, 0], ['!PPHSUBGAME', 1, 24], ['!PPHSOUND', 1, 23], ['!PPHMOVIES', 1, 22], ['!BACK', 2, 0]]);
    // movies page
    key(M, B.DOWN, 1);
    key(M, B.ENTER); eq('Enter on "sound" opens page 23', M.eng.page, PAGE.SOUND);
    eq('sound test lists the 22 music keys', [M.eng.listCount, M.eng.list.filter(Boolean).length], [22, 8]);
    key(M, B.DOWN, 1); key(M, B.ENTER);
    eq('Enter on the 2nd entry plays its music key (Z02LGIM)', M.log.music, ['Z02LGIM']);
    key(M, B.ESC, 2); eq('Esc on a list entry moves the cursor to Back', [M.eng.page, M.eng.item], [PAGE.SOUND, 2]);
    key(M, B.ESC, 2);
    eq('a second Esc goes back to the root page', M.eng.page, PAGE.ROOT);
    // movies: item 3
    key(M, B.DOWN, 1); key(M, B.ENTER); eq('Enter on "Film" opens page 22', M.eng.page, PAGE.MOVIES);
    eq('the outro item is greyed out before story node 0x44 (68)', M.eng.cur.items[2].disable, 0x20);
    key(M, B.ENTER); eq('intro movie action 0x12', M.log.movies, [1]);
    key(M, B.DOWN, 1); key(M, B.ENTER); eq('the outro cannot be chosen yet', M.log.movies, [1]);
    key(M, B.DOWN, 1); key(M, B.ENTER); eq('Back item returns to the root', M.eng.page, PAGE.ROOT);
    M = mkMenu((v) => v.set(0x58, 0x44)); M.cm.reset(); idle(M, 1);
    key(M, B.DOWN, 1); key(M, B.DOWN, 1); key(M, B.ENTER);
    eq('node 68: the outro item is enabled', M.eng.cur.items[2].disable, 0);
    key(M, B.DOWN, 1); key(M, B.ENTER); eq('outro movie action 0x13', M.log.movies, [2]);
    // leaving: Back on the root page
    M = mkMenu(); M.cm.reset(); idle(M, 1);
    key(M, B.DOWN, 1); key(M, B.DOWN, 1); key(M, B.DOWN, 1);
    eq('cursor on Back (item 4)', M.eng.item, 4);
    ok(key(M, B.ENTER), 'Back on the root page leaves the computer');
    eq('after leaving: inactive, closed, not started', [M.cm.active, M.eng.open, M.cm.started], [false, false, false]);
    M = mkMenu(); M.cm.reset(); idle(M, 1);
    ok(key(M, B.ESC, 2), 'Esc on the root page leaves the computer');

    // ---- the replay list (page 24): the 19 entries, gated by the TROPHY_xxx variables
    eq('replay table: 19 entries, zones', levels.replays.map((r) => r.zone), [1, 4, 5, 7, 8, 9, 12, 14, 15, 16, 17, 18, 20, 21, 24, 25, 26, 30, 28]);
    M = mkMenu(); M.cm.reset(); idle(M, 1); key(M, B.ENTER);
    eq('page 24 is the replay list', M.eng.page, PAGE.REPLAYS);
    const dis = M.eng.list.map((i) => i && i.disable);
    eq('fresh game (story node 0): BPK and IFC replays are open, the others (visible window) greyed out', [dis[0], dis[1], dis.slice(2).every((d) => d === 0x20)], [0, 0, true]);
    eq('list entries: 19 in total (scrollable), labels from the table', [M.eng.listCount, M.eng.list[0].label, M.eng.list[1].label], [19, '!LEVBPK', '!LEVIFC']);
    // scrolling the list shows the other entries (the port's list engine uses the set-up function's remaining count)
    for (let i = 0; i < 12; i++) key(M, B.DOWN, 1);
    eq('the cursor walked down the list: window scrolled', M.eng.scroll > 0, true);
    eq('last entry reachable: MAP (index 18) is the 19th', M.eng.list.filter(Boolean).length === 8 && M.eng.scroll <= 11, true);
    // the gate variables: entry 2 (WAB) needs var 0x40
    const gated = levels.replays.filter((r) => r.gateVar !== -1).map((r) => [r.label, r.gateVar]);
    eq('gate variables are the TROPHY_xxx variables', gated.slice(0, 3), [['!LEVBPK', 0x8d], ['!LEVWAB', 0x40], ['!LEVBKD', 0x3d]]);
    M = mkMenu((v) => { v.set(0x40, 1); v.set(0xa3, 2); enterZone(v); }); M.cm.reset(); idle(M, 1); key(M, B.ENTER);
    eq('TROPHY_WAB = 1: the WAB replay is open', [M.eng.list[2].disable], [0]);
    // cursor to WAB (list entry 2), start it
    key(M, B.DOWN, 1); key(M, B.DOWN, 1);
    eq('cursor on list entry 3 (cursor value 30)', M.eng.item, 30);
    ok(key(M, B.ENTER), 'starting a replay leaves the computer');
    eq('var 5 = the WAB zone (5), STARTEDFROMMENU = 1, last action replay 2', [M.v.get(5), M.v.get(0xb), M.cm.lastAction], [5, 1, { kind: 'replay', arg: 2 }]);
    const u = unpackMenuInternals(M.v.get(0x4d));
    eq('var 0x4d packs page 24, the restore flag, the cursor, the scroll and the previous zone', [u.page, u.restore, u.item, u.scroll, u.prev], [24, true, 30, 0, 2]);
    // back in the house (a new run): the zone start opens the computer at the replay list
    const M2 = mkMenu(); M2.v.a.set(M.v.a); M2.v.set(0xa3, 3);             // the loop set PREV_SUBGAME = the house
    ok(enterZone(M2.v), 'enterZone: the flag in var 0x4d opens the computer at once');
    eq('... and var 0x5e = 4', M2.v.get(0x5e), 4);
    M2.cm.reset(); M2.cm.step(0);
    eq('the restore branch: replay list, cursor and stack back', [M2.eng.page, M2.eng.item, M2.eng.scroll, M2.eng.stack.map((s) => s.page), M2.v.get(0xa3), (M2.v.get(0x4d) & 0x80)], [24, 30, 0, [21], 2, 0]);
    // scrolled list: a state at scroll 5 survives the round trip
    const pk = packMenuInternals(24, 50, 5, 2);
    const M3 = mkMenu(); M3.v.set(0x4d, pk); M3.v.set(0xa3, 3); M3.cm.step(0);
    eq('scroll 5 / cursor 50 restored', [M3.eng.page, M3.eng.item, M3.eng.scroll], [24, 50, 5]);
    // zone start without a replay: the previous zone is parked in the top byte
    const V0 = mkMenu(); V0.v.set(0xa3, 2); V0.v.set(0x4d, 0x1234);
    ok(!enterZone(V0.v), 'a normal zone start does not open the computer');
    eq('var 0x4d = previous zone << 24', V0.v.get(0x4d), 2 << 24);
    // PREV_SUBGAME is restored from the parked byte on every step of the menu
    V0.v.set(0xa3, 99); V0.cm.reset(); V0.cm.step(0);
    eq('the step rewrites var 0xa3 from var 0x4d', V0.v.get(0xa3), 2);
    // replay entries on a mid-game story: IFC (entry 1) only for node < 7 or > 10, BPK for node < 7 or > 0x33
    const rp = (idx, node, vv = {}) => replayEnabled(levels.replays[idx], (i) => (i === 0x58 ? node : vv[i] ?? 0));
    eq('replay gates: IFC at node 5 / 8 / 20', [rp(1, 5), rp(1, 8), rp(1, 20)], [true, false, true]);
    eq('replay gates: BPK at node 5 / 20 / 60 (and with the trophy)', [rp(0, 5), rp(0, 20), rp(0, 60), rp(0, 20, { 0x8d: 1 })], [true, false, true, true]);
    eq('replay start: the zone, never a story node (all 19 entries have node -1)', levels.replays.every((r) => r.node === -1), true);

    // ============================================================ the trophy browser
    vars.set(0x5e, MODE.WALK); place(-3.75, 5.37, 3.0); tick(2);
    // give some trophies and scores
    vars.set(0x8f, 3); vars.set(0x25, 51234);              // island OGL: gold, high score
    vars.set(0x40, 1); vars.set(0x20, 4200);               // WAB: bronze, 4200
    vars.set(0x3d, 0); vars.set(0x2f, 77);                 // BKD: no trophy but a score
    w.input.setKey('ShiftLeft', true); place(-3.75, 5.37, 3.0); tick(); w.input.setKey('ShiftLeft', false);
    eq('Shift in the trophy area: browser (var 0x5e = 2) with the same press not leaving at once', [vars.get(0x5e), st.browseState], [MODE.TROPHIES, 0]);
    eq('the first trophy is TOGL (record 8)', st.trophyIndex, 8);
    st.sounds.length = 0;
    let n = 0; while (!st.lines.line1 && n++ < 200) tick();
    ok(n > 10 && n < 80, `the camera needs ${n} ticks to arrive at the first trophy`);
    eq('on arrival: HISCORE / score / level id of the Ogel island', [st.lines.line1, st.lines.line2, st.lines.line3], ['HISCORE', '51234', 'LEVOGL']);
    eq('the jingle of a trophy with index 22 played once', st.sounds, [TROPHY_SOUND[22]]);
    near('the camera is in front of the island trophy: eye = (x, y, z - 2.24)', w.camera.c[2], rec[8].z - 2.24, 0.02);
    near('island trophy camera: eye y = look y', w.camera.c[1], w.camera.c[4], 1e-6);
    tick(10); eq('no second jingle while standing there', st.sounds.length, 1);
    // Left from the first wraps to the last record (30 = TASB)
    press('ArrowLeft'); eq('Left on the first trophy: record 30 (TASB)', st.trophyIndex, 30);
    eq('while the camera travels, slots 1 and 3 are empty, the old score stays', [st.lines.line1, st.lines.line2, st.lines.line3], ['', '51234', '']);
    n = 0; while (!st.lines.line1 && n++ < 200) tick();
    eq('arrived at TASB: HISCORE, its score (HISCORE_ASB = 0x29), LEVASB', [st.lines.line1, st.lines.line3], ['HISCORE', 'LEVASB']);
    eq('TASB has no trophy: the no-trophy jingle (0x29a)', st.sounds.at(-1), SOUND_NO_TROPHY);
    // Right wraps to the first
    press('ArrowRight'); eq('Right on the last trophy: record 8', st.trophyIndex, 8);
    for (let i = 0; i < 4; i++) press('ArrowRight');
    eq('four more to the right: record 12 (TBKD)', st.trophyIndex, 12);
    n = 0; while (!st.lines.line1 && n++ < 200) tick();
    eq('TBKD: score 77, no trophy -> jingle 0x29a', [st.lines.line2, st.sounds.at(-1)], ['77', SOUND_NO_TROPHY]);
    near('mini-game trophy camera: eye 1.44 above, look 0.64 above', w.camera.c[1] - rec[12].y, 1.44, 0.02); near('look-at', w.camera.c[4] - rec[12].y, 0.64, 0.02);
    // WAB (record 18) has a trophy: its own jingle
    for (let g = 0; g < 30 && st.trophyIndex !== 18; g++) press('ArrowRight');
    n = 0; while (!st.lines.line1 && n++ < 200) tick();
    eq('WAB: bronze trophy, score 4200, jingle of index 1', [st.lines.line2, st.lines.line3, st.sounds.at(-1)], ['4200', 'LEVWAB', TROPHY_SOUND[1]]);
    // leaving: any other button
    press('ArrowUp');
    eq('Up leaves: state 1 (camera flies home)', [st.browseState, vars.get(0x5e)], [1, MODE.TROPHIES]);
    n = 0; while (vars.get(0x5e) === MODE.TROPHIES && n++ < 200) tick();
    eq('home again: walking, browser reset', [vars.get(0x5e), st.browseState, st.lines.line1, st.lines.line3], [MODE.WALK, -1, '', '']);
    eq('the score line stays (the original never clears it)', st.lines.line2, '4200');
    ok(n > 10, `${n} ticks to fly home`);
    // reopening starts again at the last trophy shown with the camera at home
    w.input.setKey('ShiftLeft', true); place(-3.75, 5.37, 3.0); tick(); w.input.setKey('ShiftLeft', false);
    eq('reopened: the browser starts at the last trophy (WAB, 18)', [vars.get(0x5e), st.trophyIndex], [MODE.TROPHIES, 18]);
    press('Space'); eq('Space leaves as well', st.browseState, 1);
    n = 0; while (vars.get(0x5e) === MODE.TROPHIES && n++ < 200) tick();
    eq('left again', vars.get(0x5e), MODE.WALK);
    // Esc / any other key set (Ctrl)
    w.input.setKey('ShiftLeft', true); place(-3.75, 5.37, 3.0); tick(); w.input.setKey('ShiftLeft', false);
    tick(60); press('ControlLeft'); eq('Ctrl leaves', st.browseState, 1);
    n = 0; while (vars.get(0x5e) === MODE.TROPHIES && n++ < 200) tick();

    // ============================================================ the wall map (TIMM)
    place(-15, 6, 0); tick();
    w.input.setKey('ShiftLeft', true); tick(); w.input.setKey('ShiftLeft', false);
    eq('Shift at the map: var 0x5e = 0x20', vars.get(0x5e), MODE.MAP);
    tick(120);
    eq('the camera focus arrives at the map (-15, 7, 6)', st.mapFocus.map((x) => +x.toFixed(3)), [...MAP_TARGET]);
    eq('eye 2.8 to the +x side of the map, look at it', [w.camera.c[0], w.camera.c[1], w.camera.c[2], w.camera.c[3]].map((x) => +x.toFixed(3)), [-12.2, 7, 6, -15]);
    press('ArrowLeft'); eq('any button flies back', st.mapState, 1);
    n = 0; while (vars.get(0x5e) === MODE.MAP && n++ < 200) tick();
    eq('back to walking', [vars.get(0x5e), st.mapState], [MODE.WALK, -1]);

    // ============================================================ the island totals (FUN_00423bf0)
    const T = (set) => { const v = new (w.vars.constructor)(); for (const [k, x] of Object.entries(set)) v.set(+k, x); computeIslandTotals(v); return v; };
    let t = T({ [IV.HISCORE_WAB]: 5000, [IV.HISCORE_CNT]: 2000, [IV.HISCORE_PAR]: 3000, [IV.HISCORE_BPK]: 1000, [IV.SCORE_LGI]: 500 });
    eq('LGI: 11000 + 500: subgames / total, trophy 1 (bronze)', [t.get(IV.SCORE_LGI_SUBGAMES), t.get(IV.HISCORE_LGI), t.get(IV.TROPHY_LGI)], [11000, 11500, 1]);
    const edge = (key, parts, lo, hi) => {
      const out = [];
      for (const total of [0, 1, lo - 1, lo, hi - 1, hi]) { const v = T({ [parts]: total }); out.push(v.get(key)); }
      return out;
    };
    eq('LGI trophy edges (0, 1, 47000, 47001, 55000, 55001)', edge(IV.TROPHY_LGI, IV.HISCORE_WAB, 47001, 55001), [0, 1, 1, 2, 2, 3]);
    eq('CSI trophy edges (30001 / 35001)', edge(IV.TROPHY_CSI, IV.HISCORE_RGB, 30001, 35001), [0, 1, 1, 2, 2, 3]);
    eq('ADV trophy edges (60001 / 70001)', edge(IV.TROPHY_ADV, IV.HISCORE_TRX, 60001, 70001), [0, 1, 1, 2, 2, 3]);
    eq('OGL trophy edges (35001 / 42001)', edge(IV.TROPHY_OGL, IV.HISCORE_MAP, 35001, 42001), [0, 1, 1, 2, 2, 3]);
    t = T({ [IV.HISCORE_SSH]: 1, [IV.HISCORE_WAS]: 2, [IV.HISCORE_MMP]: 3, [IV.HISCORE_DSP]: 4, [IV.HISCORE_FSH]: 5, [IV.HISCORE_BIP]: 6, [IV.HISCORE_TRX]: 7, [IV.HISCORE_HAT]: 8, [IV.SCORE_ADV]: 100 });
    eq('ADV sums its 8 mini-games, then the island score', [t.get(IV.SCORE_ADV_SUBGAMES), t.get(IV.HISCORE_CAI)], [36, 136]);
    t = T({ [IV.HISCORE_JST]: 1, [IV.HISCORE_RGB]: 2, [IV.HISCORE_BKD]: 4, [IV.SCORE_CSI]: 8 });
    eq('CSI sums JST + RGB + BKD', [t.get(IV.SCORE_CSI_SUBGAMES), t.get(IV.HISCORE_CSI)], [7, 15]);
    t = T({ [IV.HISCORE_APO]: 1, [IV.HISCORE_ASB]: 2, [IV.HISCORE_MAP]: 4, [IV.HISCORE_BRP]: 8, [IV.SCORE_OGL]: 16 });
    eq('OGL sums APO + ASB + MAP + BRP', [t.get(IV.SCORE_OGL_SUBGAMES), t.get(IV.HISCORE_OGL)], [15, 31]);
    eq('island trophy function', [islandTrophy(0, 10, 20), islandTrophy(1, 10, 20), islandTrophy(10, 10, 20), islandTrophy(20, 10, 20)], [0, 1, 2, 3]);

    // ============================================================ the exit rule and the replay / pause mapping (tables)
    eq('menu page 29 is the room pause menu (Pause, back, load, save list item, options, quit)', pages[29].items.map((i) => i.label), ['!Pause', '!PauseM4', '!FELODGAM', '!PauseM6', '!FEOPTION', '!FEQUIT']);
    ok(COMPUTER_MASK === 3, 'computer menu mask 3');
    notes.push(`trophy attaches ${trophyAttaches.length}, replays ${levels.replays.length}, sound test ${levels.sounds.length}`);
    return { checked, failures, notes };
  },
};
