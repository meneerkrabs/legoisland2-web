// Mod import end to end per engine: a zip (DecompressionStream + OPFS writes through src/opfsio.ts) and a RAR (unrar.wasm) picked in the start screen's file input, order / persistence after a reload.
// Needs a persistent profile in webkit (OPFS); the files are the local test mods of the project (MODS_DIR, default ~/Documents/legoeiland2-extract/mods):
//   node tools/browse.mjs "http://localhost:5497/?mute=1" tools/steps/browser-mods.mjs --browser webkit --profile /tmp/bc/prof-mods-w --out /tmp/bc/w
//   BC_NOWRITABLE=1 ... = without createWritable (Safari < 26)
import os from 'node:os';
const DIR = process.env.MODS_DIR ?? `${os.homedir()}/Documents/legoeiland2-extract/mods`;
export default async ({ page, shot, wait, log, evaluate }) => {
  const fail = [];
  const expect = (n, c, x = '') => { log(c ? 'ok  ' : 'FAIL', n, x); if (!c) fail.push(n); };
  page.on('dialog', (d) => d.accept());
  const nw = process.env.BC_NOWRITABLE === '1';
  await page.waitForLoadState('load'); await wait(2500);
  await evaluate(async () => { const r = await navigator.storage.getDirectory(); for await (const [n] of r.entries()) await r.removeEntry(n, { recursive: true }).catch(() => {}); });
  if (nw) await page.addInitScript(() => { try { delete FileSystemFileHandle.prototype.createWritable; } catch { /* */ } });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.bdb-start'); await page.click('.bdb-mods summary');
  const titles = () => evaluate(() => [...document.querySelectorAll('.bdb-modhead b')].map((e) => e.textContent));
  await page.locator('.bdb-mods input[type=file]').nth(0).setInputFiles([`${DIR}/ixs-look/IXS-look.zip`]);
  await page.waitForFunction(() => document.querySelectorAll('.bdb-mod').length >= 1 || document.querySelector('.bdb-error'), null, { timeout: 60000 });
  await wait(800);
  let t = await titles();
  expect('zip imported (IXS-look)', t.length === 1, t.join(' | '));
  await page.locator('.bdb-mods input[type=file]').nth(0).setInputFiles([`${DIR}/downloads/skeleton_mod_for_mod_manager.rar`]);
  await page.waitForFunction(() => document.querySelectorAll('.bdb-mod').length >= 2 || document.querySelector('.bdb-error'), null, { timeout: 120000 });
  await wait(800);
  t = await titles();
  expect('rar imported (Skeleton mod, unrar.wasm)', t.length === 2, t.join(' | '));
  const errs = await evaluate(() => [...document.querySelectorAll('.bdb-error')].map((e) => e.textContent));
  expect('no error banner', errs.length === 0, errs.join(' | '));
  await shot('mods-list');
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.bdb-start'); await page.click('.bdb-mods summary'); await wait(800);
  const after = await titles();
  expect('the list survives a reload (OPFS)', JSON.stringify(after) === JSON.stringify(t), after.join(' | '));
  log(fail.length ? 'FAILED: ' + fail.join('; ') : 'all mod checks passed');
  if (fail.length) process.exitCode = 1;
};
