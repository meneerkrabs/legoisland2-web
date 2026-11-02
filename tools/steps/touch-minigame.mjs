// Touch in a mini-game: the intro / help panels are passed with the Enter button, the D-pad plays (taps), Alt / Shift work, Esc pauses (the pause menu is steered by the D-pad + Enter)
// and closes again. Zones: z05WAB (Whack-A-Bot), z17WAS (Whack-A-Snake), z39ASB (Asteroid Belt; the D-pad flies).
//   node tools/browse.mjs "http://localhost:5497/?zone=z05WAB&mute=1" tools/steps/touch-minigame.mjs --touch --size 390x844 --out /tmp/touch-wab
export default async (h) => {
  const { page, wait, log, shot, touchDown, touchUp, tapSel } = h;
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const mode = () => page.evaluate(() => (window.__zone ? window.__zone.machine.mode : -1));
  const menu = () => page.evaluate(() => { const e = window.__shell.menu.engine; return { open: e.open, page: e.page, item: e.item }; });
  const btn = (label, ms = 110) => tapSel(`.tc-btn:has(b:text("${label}"))`, ms);
  await page.waitForFunction(() => window.__zone && window.__zone.machine, null, { timeout: 120000 });
  await page.waitForSelector('.tc-root');
  const arch = await page.evaluate(() => window.__zone.info.archive);
  log('zone', arch, 'layout', await page.evaluate(() => window.__shell.touch.mode));
  await wait(800);
  await shot('01-intro');
  // Enter button through the panels until the play mode (2)
  let n = 0;
  for (; n < 12 && (await mode()) !== 2; n++) { await btn('Enter'); await wait(900); if (n === 0) await shot('02-after-enter'); }
  expect('Enter button passes the intro / help panels', (await mode()) === 2, `mode ${await mode()} after ${n} taps`);
  await wait(500);
  await shot('03-play');
  // D-pad taps are seen by the game: count the ticks in which a direction bit was pressed
  await page.evaluate(() => { window.__tcP = 0; const i = window.__shell.input; const u = i.update.bind(i); i.update = () => { u(); if (i.pressed & 0xf) window.__tcP++; }; });
  const pad = await page.locator('.tc-pad').boundingBox();
  const cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2, r = pad.width * 0.4;
  for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [0, -1], [1, 0]]) { await touchDown(1, cx + dx * r, cy + dy * r); await wait(90); await touchUp(1); await wait(250); }
  const seen = await page.evaluate(() => window.__tcP);
  expect('D-pad taps register as direction presses', seen >= 4, `${seen} of 6`);
  // multi-touch: a held direction plus Alt
  await touchDown(1, cx - r, cy); await touchDown(2, ...(await (async () => { const b = await page.locator('.tc-btn:has(b:text("Alt"))').boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; })()));
  await wait(250);
  const held = await page.evaluate(() => window.__shell.input.held);
  expect('left + Alt held at once', (held & 1) && (held & 0x20), `0x${held.toString(16)}`);
  await touchUp(2); await touchUp(1); await wait(200);
  await shot('04-playing');
  // pause: Esc button, D-pad + Enter in the menu, Esc closes
  await btn('Esc'); await wait(800);
  let m = await menu();
  expect('Esc button opens the pause menu', m.open, JSON.stringify(m));
  await shot('05-pause');
  const i0 = m.item;
  await touchDown(1, cx, cy + r); await wait(110); await touchUp(1); await wait(400);
  expect('D-pad moves the pause cursor', (await menu()).item !== i0);
  await btn('Esc'); await wait(800);
  expect('Esc button closes the pause menu', !(await menu()).open, JSON.stringify(await menu()));
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'all ok');
  if (fail.length) process.exitCode = 1;
};
