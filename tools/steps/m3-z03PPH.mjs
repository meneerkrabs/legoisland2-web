// M3 z03PPH, Pepper's house in the real shell (headless, muted): island -> house through the pause menu, the fixed cameras / hotspots / door, the trophy room
// (tiers by the TROPHY_xxx variables, the browser with Left / Right, the HUD lines), the wall map, the computer (menu pages, sound test, movies, the replay of a
// mini-game and the way back to the same menu state), and the exit through the door back to the island.
//   node tools/browse.mjs "http://localhost:5499/?zone=z02LGI&node=5&mute=1" tools/steps/m3-z03PPH.mjs --size 1280x800 --out /tmp/m3/z03PPH
// The bot uses real key presses for everything the player does; it only puts Pepper on a hotspot with `place()` (page.evaluate) to save the walk.
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1, gap = 170) => { for (let i = 0; i < n; i++) { await key(k); await wait(gap); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, scroll: e.scroll, open: e.open, count: e.listCount }; });
  const dbg = () => page.evaluate(() => window.__zone.game.debug());
  const vars = (list) => page.evaluate((l) => l.map((i) => __zone.sh.vars.get(i)), list);
  const setVars = (pairs) => page.evaluate((p) => { for (const [k, v] of p) __zone.sh.vars.set(k, v); }, pairs);
  const pos = () => page.evaluate(() => { const p = __zone.loaded.pepper; return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), ry: +p.ry.toFixed(2) }; });
  const place = (x, z, ry) => page.evaluate(([x, z, ry]) => { const p = __zone.loaded.pepper; p.x = x; p.z = z; p.ry = ry; p.rebuildYaw(); }, [x, z, ry]);
  const inZone = (arch) => page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 12, arch, { timeout: 300000 });
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(100); } return false; };
  const select = async (idx, max = 14) => { for (let i = 0; i < max && (await menu()).item !== idx; i++) await press('ArrowDown'); };

  // ------------------------------------------------------------------ island -> house (pause menu: "Huis van Pepper")
  await inZone('z02LGI');
  await press('Escape'); await wait(500);
  await select(5); await press('Enter'); await wait(500);
  await inZone('z03PPH');
  await wait(2500);
  let d = await dbg();
  expect("Pepper's house runs (room, mode 2) with the computer, trophies and door hotspots", d.mode === 1);
  expect('the player starts in front of the door: door icon, door opens', d.icon === 0 && d.doorOpen && d.hotspot === 2, JSON.stringify(d));
  await shot('house-1-start-door');
  const start = await pos();

  // ------------------------------------------------------------------ real walking: Up moves away from the (fixed) camera
  await place(-3.0, 0.0, 3.0); await wait(900);
  const w0 = await pos();
  await page.keyboard.down('ArrowUp'); await wait(400); await page.keyboard.up('ArrowUp'); await wait(300);
  const w1 = await pos();
  const cam = await page.evaluate(() => { const c = __zone.world.camera.c; return [c[0], c[2], c[3], c[5]]; });
  const toward = (w1.x - w0.x) * (cam[2] - cam[0]) + (w1.z - w0.z) * (cam[3] - cam[1]);
  expect('Up walks along the camera direction (the camera is fixed in a corner)', Math.hypot(w1.x - w0.x, w1.z - w0.z) > 2 && toward > 0, `${JSON.stringify(w0)} -> ${JSON.stringify(w1)}`);
  await shot('house-2-walked');

  // ------------------------------------------------------------------ trophies: values of the variables decide what is on the shelves
  await setVars([[0x40, 1], [0x20, 4200], [0xd5, 2], [0xc8, 7600], [0x3d, 3], [0x2f, 9100], [0x8d, 3], [0xc0, 5100], [0x8f, 3], [0x25, 51234], [0x49, 2], [0x12, 47500], [0x90, 1], [0xce, 3000], [0xb9, 0], [0x17, 0]]);
  await place(-3.75, 9.0, 3.0); await wait(1200);      // facing away from the door: the trophy area
  await shot('house-3-shelves');
  expect('trophy icon in the trophy area', (await dbg()).icon === 1, JSON.stringify(await dbg()));

  // ------------------------------------------------------------------ the browser (Shift at the shelves): the first trophy is the Ogel island
  await press('Shift'); await wait(300);
  expect('Shift opens the trophy browser (var 0x5e = 2)', (await vars([0x5e]))[0] === 2);
  expect('the first trophy shown is the Ogel island (record 8)', (await dbg()).trophy === 8);
  expect('camera arrives and the HUD names it', await waitFor(async () => (await dbg()).lines.line1 === 'HISCORE'), JSON.stringify((await dbg()).lines));
  d = await dbg();
  expect('score line is the island high score and the level is LEVOGL', d.lines.line2 === '51234' && d.lines.line3 === 'LEVOGL', JSON.stringify(d.lines));
  await wait(400);
  await shot('house-4-trophy-ogel');
  await press('ArrowRight'); await wait(300);
  expect('Right: next trophy (record 9, Adventurers island, no trophy)', (await dbg()).trophy === 9);
  await waitFor(async () => (await dbg()).lines.line1 === 'HISCORE'); await wait(300);
  await shot('house-5-trophy-adv-none');
  for (let i = 0; i < 8; i++) { await press('ArrowRight', 1, 120); }
  d = await dbg();
  expect('8 more to the right: record 17 (the skate park)', d.trophy === 17, `trophy ${d.trophy}`);
  await waitFor(async () => (await dbg()).lines.line1 === 'HISCORE'); await wait(300);
  d = await dbg();
  expect('skate park: score 5100, LEVBPK', d.lines.line2 === '5100' && d.lines.line3 === 'LEVBPK', JSON.stringify(d.lines));
  await shot('house-6-trophy-skatepark');
  await press('ArrowRight'); await waitFor(async () => (await dbg()).lines.line1 === 'HISCORE'); await wait(300);
  d = await dbg();
  expect('record 18: Botten meppen (bronze 4200)', d.trophy === 18 && d.lines.line2 === '4200' && d.lines.line3 === 'LEVWAB', JSON.stringify(d));
  await shot('house-7-trophy-wab-bronze');
  await press('ArrowLeft', 11, 100);
  d = await dbg();
  expect('Left x11 from 18 wraps past the first: record 30', d.trophy === 30 || d.trophy === 7 + 23, `trophy ${d.trophy}`);
  await press('ArrowUp'); await wait(300);
  expect('Up leaves the browser: the camera flies home, walking again', await waitFor(async () => (await vars([0x5e]))[0] === 1, 6000));
  await wait(600);
  await shot('house-8-after-browser');

  // ------------------------------------------------------------------ the wall map
  await place(-14, 6, 0); await wait(900);
  await press('Shift');
  expect('Shift at the map: var 0x5e = 0x20', await waitFor(async () => (await vars([0x5e]))[0] === 0x20));
  await wait(2500);
  await shot('house-9-map');
  await press('ArrowRight');
  expect('a button flies back; walking again', await waitFor(async () => (await vars([0x5e]))[0] === 1, 6000));

  // ------------------------------------------------------------------ the computer
  await place(-5.0, -5.0, 0); await wait(900);
  expect('computer icon at the computer', (await dbg()).icon === 2, JSON.stringify(await dbg()));
  await shot('house-10-at-computer');
  await press('Shift');
  expect('Shift opens the computer (var 0x5e = 4)', await waitFor(async () => (await vars([0x5e]))[0] === 4));
  await wait(1500);
  let m = await menu();
  expect('menu root page 21 (PEPPER\'S COMPUTER)', m.open && m.page === 21 && m.item === 1, JSON.stringify(m));
  await shot('house-11-computer-menu');
  await press('Escape'); await wait(400);
  d = await dbg(); m = await menu();
  expect('Esc on the root page leaves the computer, no pause menu', (await vars([0x5e]))[0] === 1 && !m.open && (await page.evaluate(() => __zone.machine.mode)) === 2, JSON.stringify({ m, d: d.computer }));
  await press('Shift');
  await waitFor(async () => (await vars([0x5e]))[0] === 4); await wait(800);
  // movies page
  await press('ArrowDown', 2); await press('Enter', 1, 500);
  m = await menu(); expect('Film page (22)', m.page === 22, JSON.stringify(m));
  const items22 = await page.evaluate(() => __shell.menu.engine.cur.items.map((i) => [i.label, i.disable]));
  expect('the outro is greyed out until story node 68', items22[2][1] === 0x20, JSON.stringify(items22));
  await shot('house-12-movies');
  await select(1); await press('Enter', 1, 500);                            // IntroFMV (the dev data may not have the movie: the call must not break the room)
  d = await dbg();
  expect('the intro movie action was taken (and the computer stays)', d.computer.last?.kind === 'movie' && d.computer.last.arg === 1 && d.computer.active, JSON.stringify(d.computer));
  const playing = (await dbg()).movie;
  log(playing ? 'the movie plays; the room is held (the original blocks inside the menu step)' : 'no movie file in the data: the call returned at once');
  if (playing) { await wait(3000); await key('Space'); }                      // any key skips a movie
  expect('the room resumes after the movie', await waitFor(async () => !(await dbg()).movie, 60000));
  await wait(500);
  expect('movie page still open afterwards', (await menu()).page === 22 && (await menu()).open);
  await select(2); await press('Enter', 1, 500);                              // the greyed outro: nothing happens
  expect('choosing the greyed outro does nothing', (await menu()).page === 22 && !(await dbg()).movie);
  // (Esc does nothing while the cursor is on a greyed item, like the original engine: move to Back)
  await select(3); await press('Enter', 1, 500);
  m = await menu(); expect('Back: to the root page', m.page === 21, JSON.stringify(m));
  // sound test
  await select(2); await press('Enter', 1, 500);
  m = await menu(); expect('Geluid page (23): the 22 music keys', m.page === 23 && m.count === 22, JSON.stringify(m));
  await shot('house-13-sound-test');
  await press('ArrowDown', 2); await press('Enter', 1, 500);
  d = await dbg(); expect('selecting an entry plays its music (last action)', d.computer.last?.kind === 'music' && d.computer.last.arg === 'Z05WAB3', JSON.stringify(d.computer));
  await press('Escape', 2, 500);
  m = await menu(); expect('back to the root', m.page === 21, JSON.stringify(m));
  // the replay list
  await select(1);
  await press('Enter', 1, 500);
  m = await menu(); expect('Spelletjes in spelletjes page (24): 19 replays', m.page === 24 && m.count === 19, JSON.stringify(m));
  const dis = await page.evaluate(() => __shell.menu.engine.list.map((i) => (i ? i.disable : null)));
  expect('open: BPK and IFC (story node 5 < 7) and WAB (TROPHY_WAB != 0)', dis[0] === 0 && dis[1] === 0 && dis[2] === 0, JSON.stringify(dis));
  expect('greyed: replays without their trophy (JST, RGB, SSH); WAS (TROPHY_WAS = 2) is open', dis[4] === 0x20 && dis[5] === 0x20 && dis[6] === 0x20 && dis[7] === 0, JSON.stringify(dis));
  await shot('house-14-replays');
  await press('ArrowDown', 2, 200);
  m = await menu(); expect('cursor on the third entry (WAB)', m.item === 30, JSON.stringify(m));
  await press('Enter', 1, 600);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z03PPH', null, { timeout: 120000 });
  d = await page.evaluate(() => ({ arch: __zone.info.archive, v: [5, 0xb, 0xa3, 0x4d].map((i) => __zone.sh.vars.get(i)) }));
  expect('the replay runs the Whack-A-Bot zone, started from the menu (var 0xb = 1), previous zone = the house', d.arch === 'z05WAB' && d.v[1] === 1 && d.v[2] === 3, JSON.stringify(d));
  await shot('house-15-replay-zone');
  // abort the replay through its pause menu (item 3 of page 18): back to the house, the computer opens at the same place of the replay list
  for (let i = 0; i < 8 && (await page.evaluate(() => __zone.machine.mode)) !== 2; i++) { await press('Enter', 1, 500); }       // the brief and the controls help come first
  await wait(600);
  await press('Escape', 1, 500);
  m = await menu();
  if (m.page === 18) {
    await select(3); await press('Enter', 1, 500);
    if ((await menu()).open) { await press('Enter', 1, 500); }
  }
  await inZone('z03PPH');
  await wait(1500);
  m = await menu(); d = await dbg();
  expect('back in the house with the computer on the replay list, cursor on the WAB entry', (await vars([0x5e]))[0] === 4 && m.page === 24 && m.item === 30, JSON.stringify({ m, mode: d.mode }));
  expect('var 0xa3 restored to the island, var 0xb cleared', (await vars([0xa3, 0xb])).join() === '2,0', JSON.stringify(await vars([0xa3, 0xb])));
  await shot('house-16-back-at-replays');
  await press('Escape', 2, 500); await press('Escape', 1, 500);
  expect('leaving the computer again', (await vars([0x5e]))[0] === 1, JSON.stringify(await vars([0x5e])));

  // ------------------------------------------------------------------ the pause menu of the room (page 29) and the exit through the door
  await place(-3.75, 6, 0); await wait(600);
  await press('Escape', 1, 500);
  expect('room pause menu is page 29', (await menu()).page === 29);
  await shot('house-17-pause');
  await press('Escape', 1, 500);
  await place(-6, 9, 0.1); await wait(900);
  d = await dbg();
  expect('at the door: icon, door open', d.icon === 0 && d.doorOpen, JSON.stringify(d));
  await wait(700);
  await shot('house-18-door-open');
  await press('Shift');
  await inZone('z02LGI'); await wait(800);
  const back = await page.evaluate(() => { const p = __zone.loaded.pepper; return { arch: __zone.info.archive, pos: [p.x, p.y, p.z].map((x) => +x.toFixed(1)), prev: __zone.sh.vars.get(0xa3) }; });
  expect('the door leads back to the island, at the house door', back.arch === 'z02LGI' && back.prev === 3 && Math.hypot(back.pos[0] - start.x, back.pos[2] - start.z) > 20, JSON.stringify(back));
  await shot('house-19-island-again');

  // ------------------------------------------------------------------ the room pause menu: "PauseM6" (page 29, item 3) leaves the house like the door
  await press('Escape'); await wait(500);
  await select(5); await press('Enter'); await wait(500);
  await inZone('z03PPH'); await wait(1200);
  await press('Escape', 1, 500);
  expect('page 29 again', (await menu()).page === 29);
  await select(3); await press('Enter', 1, 500);
  await inZone('z02LGI'); await wait(500);
  expect('pause menu item 3 of the room: back to the island', (await page.evaluate(() => __zone.info.archive)) === 'z02LGI');

  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'Pepper\'s house checks passed');
  if (fail.length) process.exitCode = 1;
};
