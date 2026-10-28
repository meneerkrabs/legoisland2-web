// The whole shell flow, headless and muted: start -> movies skipped -> front end -> new game -> first zone of the story (island, node 2) -> walk -> pause
// -> save -> quit to the front end -> load -> continue in the same place -> options persist after a reload.
//   node tools/browse.mjs "http://localhost:5499/?play=1&mute=1" tools/steps/shell-flow.mjs --size 1280x800
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const enter = async (idx) => { await select(idx); await press('Enter'); await wait(500); };
  const zoneState = async () => { for (let i = 0; i < 20; i++) { try { return await zoneStateOnce(); } catch (e) { await wait(300); } } return zoneStateOnce(); };
  const zoneStateOnce = () => page.evaluate(() => {
    const z = window.__zone; if (!z) return null;
    const p = z.loaded.pepper, v = z.sh.vars;
    return { zone: z.info.archive, index: z.info.index, mode: z.machine.mode, pos: [p.x, p.y, p.z].map((x) => +x.toFixed(2)), yaw: +p.ry.toFixed(3), node: v.get(0x58), sub: v.get(0x59), tick: z.world.tickCount };
  });
  const waitZone = async (archive, mode = 2) => {
    await page.waitForFunction(([a, m]) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === m && window.__zone.world.tickCount > 5 && window.__zone.sh.live, [archive, mode], { timeout: 300000 });
  };

  // 1. movies (skipped with a key press when they play) -> front end
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => window.__fe && window.__fe.mode === 2)) break;
    if (await page.evaluate(() => !!document.querySelector('.le2-movie'))) await key('Space');
    await wait(500);
  }
  await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 300000 });
  expect('front end is up', true);
  await shot('flow-1-frontend');

  // 2. Starten -> Nieuw spel
  await enter(1);
  let m = await menu(); expect('start page (6)', m.page === 6);
  await shot('flow-2-start-page');
  await enter(1);
  await waitZone('z02LGI');
  let z = await zoneState();
  expect('new game starts the island at story node 2', z.zone === 'z02LGI' && z.node === 2, JSON.stringify(z));
  await wait(1500);
  await shot('flow-3-island');

  // 3. walk
  const before = (await zoneState()).pos;
  await page.keyboard.down('ArrowUp'); await wait(2500); await page.keyboard.up('ArrowUp');
  await wait(300);
  const after = (await zoneState()).pos;
  const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
  expect('Pepper walked', moved > 5, `moved ${moved.toFixed(1)}`);
  await shot('flow-4-walked');

  // 4. pause menu
  await press('Escape'); await wait(500);
  z = await zoneState(); m = await menu();
  expect('Esc pauses (mode 3, island pause page 5)', z.mode === 3 && m.page === 5 && m.open);
  const tickPaused = z.tick; await wait(600);
  expect('the world is frozen while paused', (await zoneState()).tick === tickPaused);
  await shot('flow-5-pause');

  // 5. save in slot 1
  await enter(3);
  m = await menu(); expect('save page (3)', m.page === 3);
  await shot('flow-6-save-page');
  await select(1); await press('Enter'); await wait(800);
  z = await zoneState();
  expect('saving closes the menu and resumes', z.mode === 2);
  const saved = z.pos;
  const slot = await page.evaluate(() => { const b = __shell.slots[0]; return b ? { len: b.length, node: new DataView(b.buffer, b.byteOffset).getUint32(0x10, true), sub: new DataView(b.buffer, b.byteOffset).getUint32(8, true) } : null; });
  log('slot 0', JSON.stringify(slot));
  expect('slot 0 holds a save (0x51c8c bytes, node 2, sub-game 2)', slot && slot.len === 0x51c8c && slot.node === 2 && slot.sub === 2);

  // 6. walk away, then quit to the front end
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowUp'); await wait(2500); await page.keyboard.up('ArrowRight'); await page.keyboard.up('ArrowUp');
  const away = (await zoneState()).pos;
  expect('walked away from the saved place', Math.hypot(away[0] - saved[0], away[2] - saved[2]) > 5);
  await press('Escape'); await wait(500);
  await enter(6);                                      // Stoppen -> confirm page
  m = await menu(); expect('quit confirm page (1)', m.page === 1);
  await shot('flow-7-quit-confirm');
  await select(2); await press('Enter'); await wait(500);
  await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 120000 });
  expect('back in the front end', true);

  // 7. load slot 1
  await enter(1);                                      // Starten
  await enter(2);                                      // Spel laden (page 2)
  m = await menu(); expect('load page (2)', m.page === 2);
  await shot('flow-8-load-page');
  await select(1); await press('Enter'); await wait(500);
  await waitZone('z02LGI');
  await wait(500);
  z = await zoneState();
  const d = Math.hypot(z.pos[0] - saved[0], z.pos[2] - saved[2]);
  expect('loaded game continues at the saved place', d < 1.5, `saved ${saved} now ${z.pos} (d ${d.toFixed(2)})`);
  expect('loaded game keeps the story node', z.node === 2);
  await shot('flow-9-loaded');

  // 8. in-place load from the pause menu
  await press('Escape'); await wait(400);
  await enter(2);                                       // Laden
  await select(1); await press('Enter'); await wait(800);
  z = await zoneState(); expect('in-place load resumes the game', z.mode === 2);

  // 8b. the ?save=0 test shortcut: a fresh page load continues from the slot (IndexedDB survives the reload), options persist too
  await page.goto('http://localhost:5499/?save=0&mute=1', { waitUntil: 'load' });
  await waitZone('z02LGI');
  await wait(500);
  z = await zoneState();
  expect('?save=0 starts in the saved place', Math.hypot(z.pos[0] - saved[0], z.pos[2] - saved[2]) < 1.5, `now ${z.pos}`);
  const opts = await page.evaluate(() => Array.from(__shell.options.a));
  expect('options survive the reload (defaults here)', opts[0] === 80 && opts.length === 23);

  // 9. erase the slot from the front end: back to the front end first (pause -> Stoppen -> yes)
  await press('Escape'); await wait(400);
  await enter(6); await select(2); await press('Enter'); await wait(500);
  await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 120000 });
  await enter(1);                                      // Starten
  await enter(3);                                      // Spel wissen (page 8)
  m = await menu(); expect('erase page (8)', m.page === 8);
  await shot('flow-10-erase-page');
  await select(1); await press('Enter'); await wait(600);
  const gone = await page.evaluate(async () => ({ mem: __shell.slots[0], idb: await __shell.saves.backend.get('Save00.lgo') }));
  expect('erase removes the save (memory and IndexedDB)', gone.mem === null && gone.idb === null);

  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'all flow checks passed');
  if (fail.length) process.exitCode = 1;
};
