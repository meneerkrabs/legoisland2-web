// z04IFC, the Information Centre, played with real key input (headless, muted):
//   node tools/browse.mjs "http://localhost:5499/?zone=z02LGI&mute=1" tools/steps/m3-z04IFC.mjs --size 1280x800 --out /tmp/m3/z04IFC
// Scenario 1 (from the island, as in the game: the door sets var 5 = 4): the fly-in, the far view, Up zooms to the map, the pins with their captions (Left / Right), Enter opens the
// info menu (location page, person, back), the pause menu is blocked while the info menu is open and available outside it, Down zooms out, Left asks to leave (mode 5, page 15):
// Annuleren turns back, OK leaves to the zone the player came from (the island). Scenario 2 (`?zone=z04IFC` = story node 70): the exit follows the story (FUN_00404d14) to z50LTC.
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const dbg = () => page.evaluate(() => { const z = window.__zone; if (!z) return null; return { arch: z.info.archive, mode: z.machine.mode, tick: z.world.tickCount, g: z.game?.debug?.() ?? null, node: z.sh.vars.get(0x58), prev: z.sh.vars.get(0xa3), v5: z.sh.vars.get(5), menu: z.sh.menu.engine.open ? z.sh.menu.engine.page : -1, imenu: z.game?.debug?.().page ?? -1 }; });
  const ready = (arch) => page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 3, arch, { timeout: 300000 });
  const until = async (fn, what, ms = 8000) => { const t0 = Date.now(); for (;;) { const s = await dbg(); if (s && fn(s)) return s; if (Date.now() - t0 > ms) { log('timeout waiting for', what, JSON.stringify(s)); return s; } await wait(60); } };
  const press = async (k) => { await key(k); await wait(110); };

  // ------------------------------------------------------------------ the island, then the door of the Information Centre (var 5 = 4)
  await ready('z02LGI');
  let s = await dbg();
  expect('on the island first', s.arch === 'z02LGI', JSON.stringify({ node: s.node }));
  await page.evaluate(() => window.__shell.vars.set(5, 4));
  await ready('z04IFC');
  s = await dbg();
  expect('the Information Centre runs (zone 4)', s.arch === 'z04IFC' && s.mode === 2 && s.prev === 2, JSON.stringify({ prev: s.prev, node: s.node }));
  expect('the room starts with the camera fly-in (state 0 / 3 / 4)', s.g.state === 0 || s.g.state === 3, JSON.stringify(s.g));
  expect('17 pins, pin 47 (the Info Centre) selected, var 0xfa = 47', s.g.pins === 17 && s.g.selected === 47 && s.g.var === 47);
  await shot('ifc-1-flyin');
  s = await until((x) => x.g.state === 3, 'the far view');
  expect('far view: state 3, eye (0, 7.04, 7.2), no caption', s.g.state === 3 && Math.abs(s.g.eye[2] - 7.2) < 1e-3 && s.g.caption === '', JSON.stringify(s.g.eye));
  await shot('ifc-2-far');

  // ------------------------------------------------------------------ the map
  await press('ArrowUp');
  s = await until((x) => x.g.state === 1, 'the map view');
  await wait(250); s = await dbg();
  expect('Up zooms to the map: state 1, eye z -4.8, caption "Infocentrum"', s.g.state === 1 && Math.abs(s.g.eye[2] + 4.8) < 1e-3 && s.g.caption === 'Infocentrum', JSON.stringify(s.g));
  await wait(200);
  await shot('ifc-3-map-infocentrum');
  await press('ArrowLeft'); await wait(150);
  s = await dbg(); expect('Left selects the pin to the left (record 46): "Winkel 2"', s.g.selected === 46 && s.g.caption === 'Winkel 2' && s.g.var === 46, JSON.stringify([s.g.selected, s.g.caption]));
  await shot('ifc-4-map-winkel2');
  for (let i = 0; i < 3; i++) await press('ArrowRight');
  s = await dbg(); expect('Right x3 from record 46 stops at the last pin (48)', s.g.selected === 48, String(s.g.selected));
  for (let i = 0; i < 17; i++) await press('ArrowLeft');
  s = await dbg(); expect('Left x17 stops at the first pin (32): the Space Port', s.g.selected === 32 && s.g.caption === 'Space Port', JSON.stringify([s.g.selected, s.g.caption]));
  await shot('ifc-5-map-spaceport');

  // ------------------------------------------------------------------ the info menu: Space Port -> Technician Bob
  await press('Enter');
  s = await until((x) => x.g.menuOpen === 1 && x.g.page === 7, 'the Space Port page (7)');
  expect('Enter opens the info menu at the pin\'s page (7, Space Port); the pause trigger is off', s.g.menuOpen === 1 && s.g.page === 7 && s.g.state === 2, JSON.stringify([s.g.menuOpen, s.g.page]));
  await wait(300);
  await shot('ifc-6-menu-location');
  await press('Escape'); await wait(300);
  s = await dbg(); expect('Esc on the top page closes the menu (and does not open the pause menu in the same tick)', s.g.menuOpen === 0 && s.g.state === 1 && s.mode === 2, JSON.stringify([s.g.menuOpen, s.mode]));
  // the menu is open: Esc is the menu's back key; outside it Esc is the pause menu (page 29, rooms)
  await press('Enter'); await wait(500);
  await press('Enter'); await wait(500);       // the cursor is on the first person
  s = await dbg(); expect('Enter on the person: the character page (28 = Technician Bob, record 12)', s.g.page === 28 && s.g.character === 12, JSON.stringify([s.g.page, s.g.character]));
  await wait(400);
  await shot('ifc-7-character');
  await press('Escape'); await wait(300);
  s = await dbg(); expect('Esc on the character page goes back to the location page', s.g.page === 7 && s.mode === 2, JSON.stringify([s.g.page, s.mode]));
  await press('Escape'); await wait(300);
  s = await dbg(); expect('Esc: menu closed', s.g.menuOpen === 0 && s.mode === 2);
  await press('Escape'); await wait(500);
  s = await dbg(); expect('Esc outside the menu opens the pause menu (page 29)', s.mode === 3 && s.menu === 29, JSON.stringify([s.mode, s.menu]));
  await shot('ifc-8-pause');
  await press('Escape'); await wait(400);
  s = await dbg(); expect('Esc closes the pause menu', s.mode === 2, String(s.mode));

  // ------------------------------------------------------------------ zoom out, the exit question
  await press('ArrowDown');
  s = await until((x) => x.g.state === 3, 'the far view again');
  expect('Down zooms out to the far view', s.g.state === 3);
  await press('ArrowLeft');
  s = await until((x) => x.mode === 5 && x.menu === 15, 'the exit question (mode 5)');
  expect('Left at the far view: the turn, the door opens, then the exit question (mode 5, page 15 AFSLUITEN)', s.mode === 5 && s.g.exitAsk === 1 && s.menu === 15 && s.g.door[0] >= 1, JSON.stringify([s.mode, s.g.exitAsk, s.menu, s.g.door]));
  await wait(300);
  await shot('ifc-9-exit-question');
  // item 2 = Annuleren
  await press('ArrowDown'); await press('Enter');
  s = await until((x) => x.mode === 2, 'back to play');
  expect('Annuleren: back to the room (mode 2), the turn goes back', s.mode === 2 && s.g.exitAsk === 0 && s.arch === 'z04IFC', JSON.stringify([s.mode, s.g.exitAsk, s.g.state]));
  s = await until((x) => x.g.state === 3, 'the far view after cancel');
  expect('and ends at the far view; the door closes', s.g.state === 3);
  await wait(900);
  s = await dbg(); expect('door closed again', s.g.door[1] === 0 && s.g.door[0] === 0, JSON.stringify(s.g.door));
  await press('ArrowLeft');
  s = await until((x) => x.mode === 5 && x.menu === 15, 'the exit question again');
  expect('the exit question again', s.mode === 5 && s.menu === 15);
  await press('Enter');                         // item 1 = OK
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 3, null, { timeout: 30000 }).catch(() => {});
  s = await dbg();
  expect('OK leaves the Information Centre for the zone the player came from (the island)', s.arch === 'z02LGI', JSON.stringify({ node: s.node, prev: s.prev }));
  await shot('ifc-10-back-on-island');

  // ------------------------------------------------------------------ pause menu "Stoppen" (quit): FUN_0054996a falls through to the abort exit, so it ends on the island, not in the front end
  await page.evaluate(() => window.__shell.vars.set(5, 4));
  await ready('z04IFC');
  await wait(500);
  await press('Escape'); await wait(500);
  s = await dbg(); expect('pause menu (page 29) opens in the room', s.mode === 3 && s.menu === 29, JSON.stringify([s.mode, s.menu]));
  for (let i = 0; i < 12; i++) { const m = await page.evaluate(() => window.__shell.menu.engine.item); if (m === 5) break; await press('ArrowDown'); }
  await press('Enter'); await wait(500);
  s = await dbg(); expect('Stoppen opens the confirm page 1', s.menu === 1, String(s.menu));
  for (let i = 0; i < 4; i++) { const m = await page.evaluate(() => window.__shell.menu.engine.item); if (m === 2) break; await press('ArrowDown'); }
  await press('Enter');
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 3, null, { timeout: 30000 }).catch(() => {});
  s = await dbg(); expect('quitting from the room ends on the island (exit state 4 through FUN_00404d14), not in the front end', s.arch === 'z02LGI', JSON.stringify({ arch: s.arch, node: s.node }));

  // ------------------------------------------------------------------ scenario 2: ?zone=z04IFC (story node 70): the exit follows the story, FUN_00404d14 -> z50LTC
  await page.goto(`${new URL(page.url()).origin}/?zone=z04IFC&mute=1`, { waitUntil: 'load' });
  await ready('z04IFC');
  s = await dbg(); expect('?zone=z04IFC starts at story node 70', s.arch === 'z04IFC' && s.node === 70, JSON.stringify({ node: s.node }));
  await until((x) => x.g.state === 3, 'far view');
  await press('ArrowLeft');
  await until((x) => x.mode === 5 && x.menu === 15, 'exit question');
  await press('Enter');
  await ready('z50LTC');
  s = await dbg(); expect('OK with the story at the Info Centre: the node completes (COMPLETE_SUB_GAME) and the story moves on to z50LTC (node 71)', s.arch === 'z50LTC' && s.node === 71, JSON.stringify({ arch: s.arch, node: s.node }));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'Information Centre checks passed');
  if (fail.length) process.exitCode = 1;
};
