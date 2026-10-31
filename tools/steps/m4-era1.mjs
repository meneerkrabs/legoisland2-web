// M4 WP15: a bot plays the rest of era 1 (island zone id 31, story nodes 11..14) with real key input, the castle arc's stubs and the return to the island:
//   node 11: back from Whack-A-Bot at the Info Center: the INFC trigger (gate node 0xb) starts LGI06 at once (the mainframe; skipped with Shift taps) -> S277 0x100
//   save / load in node 12: Esc -> Opslaan slot 1 -> walk away -> Esc -> Laden (in place) -> back at the saved place; Esc -> Stoppen -> front end -> Laden
//   node 12: walk into the Res-Q trigger (RESQ, PATH waypoints 0xc9 ..) -> LGI07 -> S277 0x200
//   node 13: Ctrl at the Res-Q speedboat SPBT -> PEPPER_CONTROL 8 (node 14); save in the boat, quit, load from the front end: Pepper is back in the boat
//   node 14: drive (Space) into the sea portal PORS -> S302 |= 1, var 5 = 6: the castle island z07CSI (a stub in M4)
//   nodes 15..29: F9 (stub aid: complete the story step) in z07CSI, Enter through the stub mini-games z08BKD / z09JST / z10RGB (banner, Continue)
//   node 30: the island era 2 (zone id 32): Pepper arrives on the boat at PORS (FUN_004c2d22, PREV_SUBGAME 6), the era intro (LGIBR05) is skipped, she
//            drives to the dock by the portal (PATH 0x1b5) and gets off with Ctrl -> walking.
//   node tools/browse.mjs "http://localhost:5491/?zone=z02LGI&node=11&mute=1&debug=1&hold=1" tools/steps/m4-era1.mjs --size 1280x800 --out /tmp/wp15
// The dev entry (?node=11) is the original's story jump FUN_00404c07 followed by the era-1 reset FUN_004c3226 (bit 1 of AI_STATE_RESET was never set):
// NUM_PAGES / PAGES_SET / COLORED_BOTHEADS are 0 then, where a real game has 4 / 15 / 15; the bot sets those three for the HUD (cosmetic, logged).
// Long walks / rides are teleports; the keys do the actions. Env: STOP=<phase> ends after that phase (node11, save, node12, node13, node14, castle);
// CHAPTER1=1 plays chapter 1 first (tools/steps/m4-chapter1.mjs, from the front end: URL ?start=frontend&mute=1) and continues from its node 11.
import { island, pathNode, teleportTo } from './lib-island.mjs';
import chapter1 from './m4-chapter1.mjs';

export default async (h) => {
  const { page, wait, log, shot, key } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const phase = (n) => { log('--- phase', n); return process.env.STOP === n; };
  const done = () => { log(fail.length ? `FAILED: ${fail.join('; ')}` : 'era 1 passed'); if (fail.length) process.exitCode = 1; };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const enter = async (idx) => { await select(idx); await press('Enter'); await wait(500); };
  const cs = async () => { let n = 0; for (let i = 0; i < 8; i++) { n += await S.skipCutscenes(200); await wait(300); if (!(await S.state())?.cs) break; } return n; };
  const veh = () => page.evaluate(() => {
    const w = window.__zone.world, g = w.ext.get('island.vehicles'), b = w.records.find((r) => r.name === 'SPBT');
    return { cur: g?.current?.name ?? null, boat: [b.x, b.y, b.z].map((x) => +x.toFixed(1)), pc: w.vars.get(0x5e), moveBoat: w.vars.get(0x82) };
  });
  /** the boat and Pepper read in ONE call (a boat that coasts at 60 units a second moves 3 units between two page round trips) */
  const boatPep = () => page.evaluate(() => { const z = window.__zone, w = z.world, b = w.records.find((r) => r.name === 'SPBT'), p = z.loaded.pepper; return { boat: [b.x, b.y, b.z].map((x) => +x.toFixed(1)), pos: [p.x, p.y, p.z].map((x) => +x.toFixed(1)), tick: w.tickCount }; });
  const boatTo = (x, z, fx, fz) => page.evaluate(([x, z, fx, fz]) => {
    const b = window.__zone.world.records.find((r) => r.name === 'SPBT'); const yaw = Math.atan2(fx - x, fz - z);
    b.setEuler(0, yaw, 0, x, b.y, z); b.rx = 0; b.ry = yaw; b.rz = 0; b.savePrev();
  }, [x, z, fx, fz]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  // a save slot (list item, type 9) goes to the confirm page 20 (FUN_0041fd45 case 9: the exactness pass of the menu): its "yes" item (type 10) runs the slot's action
  const confirmYes = async () => {
    await wait(300);
    for (let i = 0; i < 6; i++) {
      const m = await page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, type: e.current()?.type ?? -1, open: e.open }; });
      if (!m.open || m.page !== 20) return;
      if (m.type === 10) break;
      await key('ArrowDown'); await wait(200);
    }
    await key('Enter'); await wait(500);
  };
  /** pause menu -> Opslaan -> slot 1 (the world is frozen while the menu is open: the state read first is the saved one) */
  const save = async () => { await press('Escape'); await wait(500); const s = await S.state(); await enter(3); await select(1); await press('Enter'); await confirmYes(); await wait(800); return s; };
  const loadInPlace = async () => { await press('Escape'); await wait(500); await enter(2); await select(1); await key('Enter'); await confirmYes(); await wait(60); const s = await S.state(); log('just loaded', JSON.stringify(s), JSON.stringify(await menu())); await wait(1100); return s; };
  const loadFromFrontEnd = async () => {
    await press('Escape'); await wait(500);
    await enter(6); await select(2); await press('Enter'); await wait(500);      // Stoppen -> yes
    await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 120000 });
    await enter(1); await enter(2); await select(1); await press('Enter'); await confirmYes();   // Starten -> Spel laden -> slot 1 -> yes
    // the state right after the load, while the island still waits for a button (mode 1, tick 0): a saved vehicle keeps its momentum (the save restores it), so a second later it has coasted on
    await S.waitIsland();
    const frozen = { s: await S.state(), v: await veh().catch(() => null), bp: await boatPep().catch(() => null) };
    await S.start(); await wait(1000);
    return frozen;
  };

  // ---- node 11
  if (process.env.CHAPTER1) { await chapter1(h); if (process.exitCode) { log('chapter 1 failed: stopping'); return; } }
  await S.start();
  let s = await S.state();
  expect('island era 1 (zone id 31), node 11', s.arch === 'z02LGI' && s.sub === 31 && s.node === 11, JSON.stringify(s));
  if (!process.env.CHAPTER1 && !process.env.INPLACE) {
    const v = await S.vars([0xa5, 0x26, 0x8e]);
    log('dev entry: NUM_PAGES / PAGES_SET / COLORED_BOTHEADS', JSON.stringify(v), '-> 4 / 15 / 15 as after chapter 1 (HUD)');
    await S.setVar(0xa5, 4); await S.setVar(0x26, 15); await S.setVar(0x8e, 15);
  }
  if (phase('node11')) return done();
  await wait(500);
  s = await S.state();
  expect('node 11: the mainframe cutscene (LGI06) starts at once', s.cs || s.node === 12, JSON.stringify(s));
  await shot('era1-01-lgi06');
  const taps = await cs();
  s = await S.state();
  expect('node 11 -> 12: S277 = 0x100, Pepper walks', s.node === 12 && s.s277 === 0x100 && (s.ctrl & 0xfff) === 1, `${taps} taps ${JSON.stringify(s)}`);
  {
    const p0 = s.pos; await S.hold('ArrowUp', 1200); s = await S.state();
    expect('node 12: Pepper can walk after the cutscene', dist(p0, s.pos) > 3, JSON.stringify(s.pos));
  }
  await shot('era1-02-node12');

  // ---- save / load in node 12
  if (phase('save')) return done();
  {
    await S.hold('ArrowLeft', 300); await wait(300);   // at the Info Center (far from the Res-Q trigger: walking into it would start LGI07, and no load is possible during a cutscene)
    const saved = await save();
    expect('saved (node 12, the menu closes)', saved.node === 12 && (await S.state()).mode === 2, JSON.stringify(saved));
    await S.hold('ArrowUp', 1800);
    expect('walked away', dist((await S.state()).pos, saved.pos) > 5);
    const s1 = await loadInPlace();
    s = await S.state();
    log('in-place load: right after', s1.pos, '1.2 s later', s.pos);
    expect('in-place load: back at the saved place, node 12', dist(s.pos, saved.pos) < 1.5 && s.node === 12 && s.mode === 2, `saved ${saved.pos} now ${s.pos}`);
    await S.hold('ArrowUp', 1500);
    await loadFromFrontEnd();
    s = await S.state();
    // (the start tap of `S.start` is an arrow key held for 70 ms = 4 or 5 steps of the 60 Hz loop: Pepper walks up to 2 units before the state is read)
    expect('load from the front end: island era 1, node 12, at the saved place', s.sub === 31 && s.node === 12 && dist(s.pos, saved.pos) < 3 && (s.ctrl & 0xfff) === 1, `saved ${saved.pos} now ${JSON.stringify(s)}`);
    await shot('era1-03-loaded');
  }

  // ---- node 12: the Res-Q trigger
  if (phase('node12')) return done();
  {
    const n = await pathNode(page, 0xc9), r = await S.rec('RESQ');
    const dx = n[0] - r.x, dz = n[2] - r.z, l = Math.hypot(dx, dz);
    await teleportTo(page, n[0] + dx / l * 45, n[2] + dz / l * 45, n[0], n[2]); await wait(400);
    await page.keyboard.down('ArrowUp');
    await S.until(async () => (await S.state()).cs, 6000, 100);
    await page.keyboard.up('ArrowUp');
    expect('node 12: walking to the Res-Q HQ starts LGI07', (await S.state()).cs);
    await wait(1500); await shot('era1-04-lgi07');
    await cs();
    s = await S.state();
    expect('node 12 -> 13: S277 = 0x200, Pepper walks', s.node === 13 && s.s277 === 0x200 && (s.ctrl & 0xfff) === 1, JSON.stringify(s));
  }

  // ---- node 13: the boat
  if (phase('node13')) return done();
  {
    const e = await pathNode(page, 0x18e), b = await S.rec('SPBT');   // the jetty (exit node of the Res-Q docks)
    await teleportTo(page, e[0], e[2], b.x, b.z); await wait(400);
    await S.tap('ControlLeft', 100);
    await S.until(async () => (await S.state()).node === 14, 6000, 100);
    let v = await veh(); s = await S.state();
    expect('node 13 -> 14: Ctrl at the jetty, Pepper takes the Res-Q boat', s.node === 14 && v.cur === 'SPBT' && v.pc === 8 && v.moveBoat === 1, `${JSON.stringify(v)} ${JSON.stringify(s)}`);
    await wait(800); await shot('era1-05-boat');
    const b0 = (await veh()).boat; await S.hold('Space', 1500); v = await veh();
    { const bp = await boatPep(); expect('the boat drives (Space) with Pepper on it', dist(b0, v.boat) > 10 && dist(bp.boat, bp.pos) < 3, `${b0} -> ${v.boat}, Pepper ${bp.pos}`); }
    // save in the boat, quit, load: back in the boat (WP15 fix, src/zones/z02LGI/savevehicle.ts)
    const saved = await save();
    await S.hold('Space', 1200);
    const fz = await loadFromFrontEnd();
    s = fz.s; v = fz.v;
    expect('load from the front end in the boat: node 14, boat at the saved place (read at the frozen first tick), Pepper in it', s.node === 14 && v.cur === 'SPBT' && v.pc === 8 && dist(s.pos, saved.pos) < 2 && dist(fz.bp.pos, fz.bp.boat) < 3, `saved ${saved.pos} now ${JSON.stringify(v)} ${s.pos}`);
    const b1 = (await boatPep()).boat; await S.hold('Space', 1500); v = await veh(); const bp1 = await boatPep();
    expect('and drives on with Pepper', dist(b1, bp1.boat) > 10 && dist(bp1.boat, bp1.pos) < 3, `${b1} -> ${bp1.boat}, Pepper ${bp1.pos}`);
    await shot('era1-06-boat-loaded');
  }

  // ---- node 14: the sea portal
  if (phase('node14')) return done();
  {
    const p = await S.rec('PORS');
    await boatTo(p.x + 90, p.z + 60, p.x, p.z); await wait(300);
    await shot('era1-07-portal');
    await page.keyboard.down('Space');
    const left = await S.until(async () => (await S.state()).next === 6, 15000, 100);
    await page.keyboard.up('Space');
    const v = await S.vars([0x12e, 0xbb, 5]);
    expect('node 14: the boat sails into PORS -> S302 = 1, PORTAL_VEHICLE 0 (SPBT), var 5 = 6', left && (v[0x12e] & 1) === 1 && v[0xbb] === 0, JSON.stringify(v));
    await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z07CSI', null, { timeout: 120000 });
    s = await page.evaluate(() => ({ arch: window.__zone.info.archive, node: window.__zone.sh.vars.get(0x58) }));
    expect('the castle island z07CSI (stub), node >= 15', s.arch === 'z07CSI' && s.node >= 15, JSON.stringify(s));
  }

  // ---- the castle arc (stubs): F9 / Enter until the island era 2
  if (phase('castle')) return done();
  {
    const st = () => page.evaluate(() => { const z = window.__zone; if (!z) return null; const v = z.sh.vars; return { arch: z.info.archive, mode: z.machine.mode, node: v.get(0x58), tick: z.world.tickCount }; });
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const t = await st();
      if (!t) { await wait(800); continue; }
      seen.add(`${t.arch}:${t.node}`);
      if (t.arch === 'z02LGI') break;
      if (t.mode === 1 || t.mode === 9 || t.mode === 4 || t.mode === 5) { await key('Enter'); await wait(700); continue; }
      if (t.mode === 2 && t.tick > 10) { await key('F9'); await wait(1200); continue; }
      await wait(600);
    }
    log('castle arc:', [...seen].join(' '));
    expect('the stubs: BKD, JST, RGB played', ['z08BKD:18', 'z09JST:23', 'z10RGB:26'].every((k) => seen.has(k)));
  }
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && window.__zone.machine.mode === 1, null, { timeout: 180000 });
  let v = await veh(); s = await S.state();
  expect('back on the island era 2 (zone id 32), node 30, on the boat at PORS', s.sub === 32 && s.node === 30 && v.cur === 'SPBT' && v.pc === 8 && dist(v.boat, [-447, 0, -630.7]) < 80, `${JSON.stringify(v)} ${JSON.stringify(s)}`);
  await S.start();
  await shot('era1-08-era2-arrival');
  await cs();
  v = await veh(); s = await S.state();
  expect('after the era intro: still in the boat', v.cur === 'SPBT' && (v.pc & 0xfff) === 8 && !s.cs, `${JSON.stringify(v)} ${JSON.stringify(s)}`);
  {
    const b0 = v.boat; await S.hold('Space', 1200); v = await veh();
    expect('the boat drives', dist(b0, v.boat) > 5, `${b0} -> ${v.boat}`);
    const d = await pathNode(page, 0x1b5);    // the dock nearest the portal (common.ts DOCKS[3])
    await boatTo(d[0] + 10, d[2] + 8, d[0], d[2]); await wait(300);
    await S.tap('ControlLeft', 100);
    const off = await S.until(async () => ((await veh()).pc & 0xfff) === 1, 10000, 150);
    v = await veh(); s = await S.state();
    expect('Ctrl at the dock: the boat moors, Pepper steps off and walks', off && v.cur === null && v.moveBoat === 0, `${JSON.stringify(v)} ${JSON.stringify(s)}`);
    const p0 = s.pos; await S.hold('ArrowUp', 1200); s = await S.state();
    expect('Pepper walks on the island era 2', dist(p0, s.pos) > 3, `${p0} -> ${s.pos}`);
    await shot('era1-09-era2-ashore');
  }
  done();
};
