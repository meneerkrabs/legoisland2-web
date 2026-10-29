// The mod list of the start screen end to end in the headless browser: import three zips (the Dutch Mod Manager mods; MODS_DIR holds them, default /tmp/li2mods, download them
// from https://archive.org/download/legoeiland2dutch/ to /tmp only), order, enable / disable, remove, persistence across a reload, the start-screen options and a game
// start with the enabled mods (wide mode, no intro movies), and the pointer mapping in wide mode.
//   node tools/browse.mjs "http://localhost:5611/" tools/steps/mods-flow.mjs --size 1280x720 --out /tmp/ws
const DIR = process.env.MODS_DIR ?? '/tmp/li2mods';
export default async ({ page, shot, wait, log }) => {
  const fail = [];
  const expect = (n, c, x = '') => { log(c ? 'ok  ' : 'FAIL', n, x); if (!c) fail.push(n); };
  page.on('dialog', (d) => d.accept());
  await page.waitForSelector('.bdb-start');
  await page.click('.bdb-mods summary');
  const titles = () => page.evaluate(() => [...document.querySelectorAll('.bdb-modhead b')].map((e) => e.textContent));
  await page.locator('.bdb-mods input[type=file]').nth(0).setInputFiles([`${DIR}/li2_nicer_skies_dutch.zip`, `${DIR}/li2_skateboard_speed_modifier_dutch.zip`, `${DIR}/li2_bi-plane_fuel_fix_dutch.zip`]);
  await page.waitForFunction(() => document.querySelectorAll('.bdb-mod').length >= 4, null, { timeout: 60000 });
  await wait(500);
  let t = await titles();
  expect('4 mods imported (the fuel zip holds two)', t.length === 4, t.join(' | '));
  const summary = () => page.evaluate(() => document.querySelector('.bdb-mods summary').textContent);
  expect('summary counts', (await summary()) === 'Mods (4 van 4 aan)', await summary());
  // order: first down
  await page.locator('.bdb-mod').nth(0).locator('button', { hasText: '↓' }).click(); await wait(300);
  const t2 = await titles();
  expect('move down swaps the first two', t2[0] === t[1] && t2[1] === t[0], t2.join(' | '));
  // disable
  await page.locator('.bdb-mod').nth(1).locator('input[type=checkbox]').uncheck(); await wait(300);
  expect('disabling updates the summary', (await summary()) === 'Mods (3 van 4 aan)', await summary());
  // remove the last
  await page.locator('.bdb-mod').nth(3).locator('button', { hasText: '✕' }).click(); await wait(400);
  expect('remove drops the mod', (await titles()).length === 3);
  // persistence across a reload
  const before = await titles();
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.bdb-start'); await page.click('.bdb-mods summary'); await wait(500);
  const after = await titles();
  expect('the list survives a reload (OPFS)', JSON.stringify(before) === JSON.stringify(after), after.join(' | '));
  expect('enabled state survives', (await page.locator('.bdb-mod input[type=checkbox]:checked').count()) === 2);
  await shot('flow-list');
  // options on the start screen
  await page.selectOption('#le2-mode', 'wide'); await page.check('#le2-skipintro');
  const prefs = await page.evaluate(() => localStorage.getItem('le2-display'));
  expect('prefs stored', /"mode":"wide"/.test(prefs) && /"skipIntro":true/.test(prefs), prefs);
  // play: intro skipped, wide, mods applied (only the enabled)
  await page.click('button:has-text("Spelen")');
  await page.waitForFunction(() => window.__shell && __shell.menu && __shell.menu.engine.open, null, { timeout: 300000 });
  const info = await page.evaluate(() => ({ mode: __shell.displayMode, mods: window.__le2Mods && window.__le2Mods.mods, canvas: [__shell.canvas.clientWidth, __shell.canvas.clientHeight], movies: window.__le2Movies ? window.__le2Movies.length : 0 }));
  expect('game started wide without movies, with the 2 enabled mods', info.mode === 'wide' && info.mods && info.mods.length === 2 && !info.movies, JSON.stringify(info));
  await wait(1000);
  // pointer in wide mode: the centre of the window is the centre of the 640x480 grid
  await page.mouse.move(640, 360); await wait(300);
  const p = await page.evaluate(() => ({ x: __shell.pointer.x, y: __shell.pointer.y, view: __shell.ui.view }));
  expect('pointer maps into the centred 4:3 area (wide)', Math.abs(p.x - 320) < 2 && Math.abs(p.y - 240) < 2 && p.view.x === 160, JSON.stringify(p));
  await page.mouse.move(100, 100); await wait(200);
  const p2 = await page.evaluate(() => ({ x: __shell.pointer.x, y: __shell.pointer.y }));
  expect('pointer left of the 4:3 area is negative', p2.x < 0, JSON.stringify(p2));
  log(fail.length ? 'FAILED: ' + fail.join('; ') : 'all flow checks passed');
};
