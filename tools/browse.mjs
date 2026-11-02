#!/usr/bin/env node
// Headless, muted browser for testing the app without opening a window.
//
//   node tools/browse.mjs <url> [steps.mjs] [--out /tmp/shots] [--size 1024x768] [--profile /tmp/some-dir] [--browser chromium|webkit|firefox] [--touch] [--device "iPhone 13"]
// `--browser`: the engine (default chromium; webkit / firefox are the Playwright builds: `npx playwright install webkit firefox`). Always headless; audio is muted in every engine
//   (chromium: --mute-audio, firefox: media.volume_scale 0, webkit: everything that connects to the AudioContext destination is routed to a silent gain node).
// `--touch`: a touch screen (hasTouch + isMobile + coarse pointer; with `--size` as the viewport, landscape = WxH wider than high). `--device "<Playwright device name>"` takes a whole device descriptor (iPhone 13,
//   Pixel 7, iPad Pro 11 ...; `--device iPhone-13` also works) and implies --touch. Add `--landscape` to use the landscape variant of the device. Touch helpers in the steps: see below.
// `--profile <dir>`: a persistent browser profile in that folder (still headless and muted, never your own browser): storage (OPFS / IndexedDB: imported mods, the downloaded
// game) survives between runs, and the storage quota is the real one instead of the small quota of a throw-away profile (needed for multi-gigabyte mod imports).
//
// steps.mjs (optional) default-exports `async ({ page, click, key, shot, wait, evaluate, log }) => {}`:
//   click(x, y, { button })  logical screen coordinates (640x480 or 800x600) on the game canvas
//   down(x, y) / up(x, y)    press / release (to hold the verb coin); move(x, y)
//   key(name)                keyboard key, e.g. 'ArrowLeft', 'Escape'
//   tap(x, y)                (touch) a tap at logical game coordinates on the canvas; tapPage(x, y) a tap at page (CSS) coordinates; hold(ms) not needed: a tap lasts 90 ms
//   touchDown(id, px, py) / touchMove(id, px, py) / touchUp(id)   multi-touch at page (CSS) coordinates (chromium: CDP Input.dispatchTouchEvent; real fingers, several ids at once)
//   tapSel(selector, ms)     tap (hold ms, default 90) the centre of the element that matches the selector
//   shot(name)               PNG screenshot of the page -> <out>/<name>.png (prints the path)
//   wait(ms)                 sleep
//   evaluate(fn, arg)        run a function in the page (page.evaluate)
// Without steps it waits 3 s and writes one screenshot. Console errors are printed.
import { chromium, webkit, firefox, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const out = opt('--out', '/tmp/bdb-shots');
const [w, h] = opt('--size', '1024x768').split('x').map(Number);
const profile = opt('--profile', '');
const browserName = opt('--browser', process.env.BROWSER || 'chromium');
const deviceName = opt('--device', '');
const flagIdx = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const landscape = flagIdx('--landscape');
const touch = flagIdx('--touch') || !!deviceName;
const [url, stepsFile] = args;
if (!url) {
  console.error('usage: node tools/browse.mjs <url> [steps.mjs] [--out dir] [--size WxH]');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const engines = { chromium, webkit, firefox };
const engine = engines[browserName];
if (!engine) { console.error(`unknown --browser ${browserName} (chromium|webkit|firefox)`); process.exit(1); }
const launchArgs = browserName === 'chromium' ? ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
const launchOpts = { headless: true, args: launchArgs, ...(browserName === 'firefox' ? { firefoxUserPrefs: { 'media.volume_scale': '0.0', 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } } : {}) };
let ctxOpts = { viewport: { width: w, height: h } };
if (deviceName) {
  const d = devices[deviceName.replace(/-/g, ' ')] ?? devices[deviceName];
  if (!d) { console.error(`unknown device ${deviceName}`); process.exit(1); }
  const dd = landscape ? (devices[`${deviceName.replace(/-/g, ' ')} landscape`] ?? d) : d;
  const { defaultBrowserType, ...rest } = dd;
  ctxOpts = { ...rest };
  if (rest.isMobile && browserName === 'firefox') { delete ctxOpts.isMobile; }   // firefox has no isMobile
  if (process.argv.includes('--size')) ctxOpts.viewport = { width: w, height: h };
} else if (touch) {
  ctxOpts = { viewport: { width: w, height: h }, hasTouch: true, isMobile: browserName !== 'firefox', deviceScaleFactor: 2, userAgent: browserName === 'webkit' ? undefined : undefined };
}
if (ctxOpts.userAgent === undefined) delete ctxOpts.userAgent;
const browser = profile
  ? await engine.launchPersistentContext(profile, { ...launchOpts, ...ctxOpts })
  : await engine.launch(launchOpts);
const page = profile ? (browser.pages()[0] ?? (await browser.newPage())) : await (await browser.newContext(ctxOpts)).newPage();
// webkit / firefox without a mute flag: no node connects to the real output (AudioContext.destination); they go to a gain of 0
if (browserName !== 'chromium') {
  await page.addInitScript(() => {
    const orig = AudioNode.prototype.connect;
    const sink = new WeakMap();
    AudioNode.prototype.connect = function (dest, ...rest) {
      if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) {
        let g = sink.get(dest.context);
        if (!g) { g = dest.context.createGain(); g.gain.value = 0; orig.call(g, dest); sink.set(dest.context, g); }
        return orig.call(this, g, ...rest);
      }
      return orig.call(this, dest, ...rest);
    };
  });
}
// THROTTLE=4: CPU throttling (a slow machine / the live site): the bots must wait in game ticks, not wall time
if (process.env.THROTTLE && browserName === 'chromium') { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: +process.env.THROTTLE }); }
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
// The island's loop (FUN_004afaf7 mode 1) and the hubs' (src/hub) wait for a button before play starts, like the original. Older steps that just wait for the island to tick get a
// player's key tap from here; steps that look at that wait (the M4 ones) open the page with `&hold=1` or set NOPRESS=1.
if (!process.env.NOPRESS && !/[?&]hold=1/.test(url)) {
  await page.addInitScript(() => {
    setInterval(() => {
      const z = window.__zone;
      // the island and the M5 hubs (zone games without an intro panel: `introPanel === false`) wait for a button in mode 1
      if (z && z.info && (z.info.archive === 'z02LGI' || z.game?.introPanel === false) && z.machine && z.machine.mode === 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft', bubbles: true }));
        setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft', key: 'ArrowLeft', bubbles: true })), 60);
      }
    }, 250);
  });
}
await page.goto(url, { waitUntil: 'load' });

const canvasBox = async () => {
  const c = page.locator('canvas.bdb-screen, canvas.sh-canvas').first();
  await c.waitFor({ timeout: 15000 });
  let box = await c.boundingBox();
  // the shell's canvas in widescreen: the 2D layer (menus, clicks) is the centred 4:3 area of it
  if (await c.evaluate((e) => e.classList.contains('sh-canvas'))) { const w43 = Math.min(box.width, (box.height * 4) / 3), h43 = Math.min(box.height, (box.width * 3) / 4); box = { x: box.x + (box.width - w43) / 2, y: box.y + (box.height - h43) / 2, width: w43, height: h43 }; }
  const size = await page.evaluate(() => {
    const el = document.querySelector('canvas.bdb-screen, canvas.sh-canvas');
    return { w: el.dataset.logicalWidth ? +el.dataset.logicalWidth : 0, h: el.dataset.logicalHeight ? +el.dataset.logicalHeight : 0 };
  });
  return { box, lw: size.w || 640, lh: size.h || 480 };
};
const helpers = {
  page,
  async click(x, y, { button = 'left' } = {}) {
    const { box, lw, lh } = await canvasBox();
    await page.mouse.click(box.x + ((x + 0.5) * box.width) / lw, box.y + ((y + 0.5) * box.height) / lh, { button });
  },
  async down(x, y, { button = 'left' } = {}) {
    const { box, lw, lh } = await canvasBox();
    await page.mouse.move(box.x + ((x + 0.5) * box.width) / lw, box.y + ((y + 0.5) * box.height) / lh);
    await page.mouse.down({ button });
  },
  async up(x, y, { button = 'left' } = {}) {
    const { box, lw, lh } = await canvasBox();
    await page.mouse.move(box.x + ((x + 0.5) * box.width) / lw, box.y + ((y + 0.5) * box.height) / lh, { steps: 3 });
    await page.mouse.up({ button });
  },
  async move(x, y) {
    const { box, lw, lh } = await canvasBox();
    await page.mouse.move(box.x + ((x + 0.5) * box.width) / lw, box.y + ((y + 0.5) * box.height) / lh);
  },
  // a key tap: down, 70 ms, up; on a loaded page one frame can take far longer than that and both events would be handled between two samples of the input mapper (the original polls the
  // keyboard once per loop pass and does not see such a tap), so the key stays down until the shell's mapper has sampled it 3 times (the loop passes of the 60 Hz step; capped at 3 s;
  // without a shell, or when no loop runs (a movie), it is the plain 70 ms)
  async key(k) {
    const n0 = await page.evaluate(() => window.__shell?.input?.updates ?? -1).catch(() => -1);
    await page.keyboard.down(k);
    await page.waitForTimeout(70);
    if (n0 >= 0) await page.waitForFunction((n) => (window.__shell?.input?.updates ?? 0) >= n + 3, n0, { timeout: 3000 }).catch(() => {});
    await page.keyboard.up(k);
  },
  // touch: logical game coordinates -> page coordinates
  async toPage(x, y) { const { box, lw, lh } = await canvasBox(); return [box.x + ((x + 0.5) * box.width) / lw, box.y + ((y + 0.5) * box.height) / lh]; },
  async tap(x, y, ms = 90) { const [px, py] = await helpers.toPage(x, y); await helpers.tapPage(px, py, ms); },
  async tapPage(px, py, ms = 90) { await helpers.touchDown(0, px, py); await page.waitForTimeout(ms); await helpers.touchUp(0); },
  async tapSel(sel, ms = 90) { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error(`tapSel: ${sel} not found`); await helpers.tapPage(b.x + b.width / 2, b.y + b.height / 2, ms); },
  // multi-touch through CDP (chromium only): the fingers are keyed by id; every call sends the full set of active touch points
  touches: new Map(),
  async _touch(type) {
    helpers.cdp ??= await page.context().newCDPSession(page);
    await helpers.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...helpers.touches].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1 })) });
  },
  async touchDown(id, px, py) {
    if (browserName !== 'chromium') { await page.touchscreen.tap(px, py); return; }
    helpers.touches.set(id, { x: px, y: py }); await helpers._touch('touchStart');
  },
  async touchMove(id, px, py) { if (browserName !== 'chromium') return; helpers.touches.set(id, { x: px, y: py }); await helpers._touch('touchMove'); },
  async touchUp(id) {
    if (browserName !== 'chromium') return;
    helpers.touches.delete(id);
    // touchEnd carries the points that remain after the lift
    helpers.cdp ??= await page.context().newCDPSession(page);
    await helpers.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...helpers.touches].map(([i, p]) => ({ id: i, x: p.x, y: p.y })) });
  },
  wait: (ms) => page.waitForTimeout(ms),
  evaluate: (fn, arg) => page.evaluate(fn, arg),
  log: (...a) => console.log(...a),
  async shot(name) {
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`screenshot: ${file}`);
    return file;
  },
};

try {
  if (stepsFile) {
    const mod = await import(pathToFileURL(path.resolve(stepsFile)).href);
    await mod.default(helpers);
  } else {
    await page.waitForTimeout(3000);
    await helpers.shot('page');
  }
} catch (e) {
  console.log(`[steps error] ${e.stack ?? e}`);
  await helpers.shot('error').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
