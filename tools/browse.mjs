#!/usr/bin/env node
// Headless, muted browser for testing the app without opening a window.
//
//   node tools/browse.mjs <url> [steps.mjs] [--out /tmp/shots] [--size 1024x768] [--profile /tmp/some-dir]
// `--profile <dir>`: a persistent browser profile in that folder (still headless and muted, never your own browser): storage (OPFS / IndexedDB: imported mods, the downloaded
// game) survives between runs, and the storage quota is the real one instead of the small quota of a throw-away profile (needed for multi-gigabyte mod imports).
//
// steps.mjs (optional) default-exports `async ({ page, click, key, shot, wait, evaluate, log }) => {}`:
//   click(x, y, { button })  logical screen coordinates (640x480 or 800x600) on the game canvas
//   down(x, y) / up(x, y)    press / release (to hold the verb coin); move(x, y)
//   key(name)                keyboard key, e.g. 'ArrowLeft', 'Escape'
//   shot(name)               PNG screenshot of the page -> <out>/<name>.png (prints the path)
//   wait(ms)                 sleep
//   evaluate(fn, arg)        run a function in the page (page.evaluate)
// Without steps it waits 3 s and writes one screenshot. Console errors are printed.
import { chromium } from 'playwright';
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
const [url, stepsFile] = args;
if (!url) {
  console.error('usage: node tools/browse.mjs <url> [steps.mjs] [--out dir] [--size WxH]');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const launchArgs = ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = profile
  ? await chromium.launchPersistentContext(profile, { headless: true, args: launchArgs, viewport: { width: w, height: h } })
  : await chromium.launch({ headless: true, args: launchArgs });
const page = profile ? (browser.pages()[0] ?? (await browser.newPage())) : await browser.newPage({ viewport: { width: w, height: h } });
// THROTTLE=4: CPU throttling (a slow machine / the live site): the bots must wait in game ticks, not wall time
if (process.env.THROTTLE) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: +process.env.THROTTLE }); }
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
// The island's loop (FUN_004afaf7 mode 1) waits for a button before play starts, like the original. Older steps that just wait for the island to tick get a
// player's key tap from here; steps that look at that wait (the M4 ones) open the page with `&hold=1` or set NOPRESS=1.
if (!process.env.NOPRESS && !/[?&]hold=1/.test(url)) {
  await page.addInitScript(() => {
    setInterval(() => {
      const z = window.__zone;
      if (z && z.info && z.info.archive === 'z02LGI' && z.machine && z.machine.mode === 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft', bubbles: true }));
        setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft', key: 'ArrowLeft', bubbles: true })), 60);
      }
    }, 250);
  });
}
await page.goto(url, { waitUntil: 'load' });

const canvasBox = async () => {
  const c = page.locator('canvas.bdb-screen');
  await c.waitFor({ timeout: 15000 });
  const box = await c.boundingBox();
  const size = await page.evaluate(() => {
    const el = document.querySelector('canvas.bdb-screen');
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
  key: (k) => page.keyboard.press(k),
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
