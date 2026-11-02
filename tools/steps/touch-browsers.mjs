// Touch on WebKit / Firefox (taps only: Playwright has no multi-touch there): the layer appears, an instantaneous tap (page.touchscreen.tap) of Esc opens the pause menu (the latch holds it until
// the mapper sampled it), a tap on a D-pad arrow moves the menu cursor, Esc closes. Also runs on chromium.
//   node tools/browse.mjs "http://localhost:5497/?zone=z02LGI&mute=1&touch=1&lego3d=0" tools/steps/touch-browsers.mjs --browser webkit --touch --size 844x390 --out /tmp/touch-wk
export default async ({ page, wait, log, shot }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await page.waitForFunction(() => window.__zone && window.__zone.machine && window.__zone.machine.mode === 2, null, { timeout: 180000 });
  await page.waitForSelector('.tc-root');
  await wait(1000);
  log('layout', await page.evaluate(() => window.__shell.touch.mode));
  await shot('01-island');
  const menu = () => page.evaluate(() => { const e = window.__shell.menu.engine; return { open: e.open, item: e.item }; });
  const tapEl = async (sel) => { const b = await page.locator(sel).first().boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
  await tapEl('.tc-btn:has(b:text("Esc"))'); await wait(900);
  expect('Esc tap opens the pause menu', (await menu()).open);
  await shot('02-pause');
  const i0 = (await menu()).item;
  const pad = await page.locator('.tc-pad').boundingBox();
  await page.touchscreen.tap(pad.x + pad.width / 2, pad.y + pad.height * 0.9); await wait(500);
  expect('D-pad tap moves the cursor', (await menu()).item !== i0);
  await tapEl('.tc-btn:has(b:text("Esc"))'); await wait(900);
  expect('Esc tap closes the menu', !(await menu()).open);
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'all ok');
  if (fail.length) process.exitCode = 1;
};
