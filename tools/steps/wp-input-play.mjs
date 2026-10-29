// WP-INPUT, play half (docs/re/input.md): the stub aids (F9) exist only with ?debug=1, the chase camera's mouse look (pointer lock, relative movement, buttons), headless and muted:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5491/?zone=z03PPH&mute=1" tools/steps/wp-input-play.mjs --out /tmp/wp-input-shots            (aids off)
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5491/?zone=z03PPH&mute=1&debug=1" tools/steps/wp-input-play.mjs --out /tmp/wp-input-shots     (aids on)
export default async ({ page, shot, wait, log }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const debug = /[?&]debug=1/.test(page.url());
  await page.waitForFunction(() => window.__zone && window.__zone.world.tickCount > 20, null, { timeout: 300000 });
  await wait(500);
  // F9 (stub aid): live only with the debug option; in the house it leaves through the door (the zone's loop ends / the leave flag is set)
  await page.keyboard.press('F9', { delay: 70 });
  const acted = await page.waitForFunction(() => window.__zone.info.archive !== 'z03PPH' || window.__zone.game.debug().leave || window.__zone.machine.mode !== 2, null, { timeout: debug ? 20000 : 1500 }).then(() => true, () => false);
  expect(debug ? 'F9 aid works with ?debug=1' : 'F9 does nothing without the debug option', acted === debug, String(acted));
  if (debug) { log(fail.length ? `FAILED: ${fail.join(', ')}` : 'all ok'); if (fail.length) process.exitCode = 1; return; }

  // mouse look: the chase camera asks for the pointer, the next click / key press gets it
  await page.evaluate(() => {
    const im = window.__zone.sh.input, orig = im.update.bind(im);
    window.__ml = [];
    im.update = () => { orig(); if (im.mouse.dx || im.mouse.dy || im.mouse.buttons) window.__ml.push({ ...im.mouse }); };
  });
  const box = await page.locator('canvas.sh-canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.click(cx, cy); await wait(500);
  let locked = await page.evaluate(() => !!document.pointerLockElement);
  log(locked ? 'real pointer lock granted' : 'no real pointer lock in this headless browser (WrongDocumentError): faking the lock to test the movement path');
  if (!locked) {
    await page.evaluate(() => {
      window.__locked = true; window.__exits = 0;
      Object.defineProperty(document, 'pointerLockElement', { get: () => (window.__locked ? document.querySelector('canvas.sh-canvas') : null), configurable: true });
      document.exitPointerLock = () => { window.__locked = false; window.__exits++; };
    });
  }
  await page.evaluate(() => { window.__ml = []; });
  for (let i = 0; i < 10; i++) { await page.evaluate((i) => window.dispatchEvent(new MouseEvent('mousemove', { movementX: 8 * (i + 1) / (i + 1), movementY: 4 })), i); await wait(40); }
  await wait(200);
  const ml = await page.evaluate(() => window.__ml);
  const sx = ml.reduce((a, m) => a + m.dx, 0), sy = ml.reduce((a, m) => a + m.dy, 0);
  // 10 events of (8, 4) counts at sensitivity 45 (x 2.5, truncated per tick): between 10 * 20 / 2 and 10 * 20 units depending on how the events fall into ticks
  expect('relative mouse movement arrives (dx right = +, dy down = -)', sx >= 100 && sx <= 200 && sy <= -50 && sy >= -100, JSON.stringify({ n: ml.length, sx, sy }));
  // buttons
  await page.evaluate(() => { window.__ml = []; });
  await page.mouse.down({ button: 'right' }); await wait(200); await page.mouse.up({ button: 'right' });
  await page.mouse.down({ button: 'left' }); await wait(200); await page.mouse.up({ button: 'left' });
  const mb = await page.evaluate(() => window.__ml.map((m) => m.buttons));
  expect('right button = 0x20, left = 0x10', mb.includes(0x20) && mb.includes(0x10), JSON.stringify([...new Set(mb)]));
  // Esc: the pause menu opens and the pointer is given back
  await page.keyboard.press('Escape', { delay: 70 }); await wait(800);
  const mode = await page.evaluate(() => ({ m: window.__zone.machine.mode, lock: !!document.pointerLockElement }));
  const exits = await page.evaluate(() => window.__exits ?? -1);
  expect('Esc pauses (mode 3) and releases the pointer', mode.m === 3 && (exits < 0 ? !mode.lock : exits > 0), JSON.stringify({ ...mode, exits }));
  await shot('play-paused');
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'all ok');
  if (fail.length) process.exitCode = 1;
};
