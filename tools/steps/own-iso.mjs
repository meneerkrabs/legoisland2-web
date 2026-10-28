// Own-ISO path headless: feed the local ISO to the picker (it is copied into OPFS), start, skip the intro movies, list the files.
//   LE2_ISO=/path/to/le2.iso node tools/browse.mjs "http://localhost:5499/?source=archive" tools/steps/own-iso.mjs
// (?source=archive keeps the dev copy out of the way so the ISO is what gets used.)
const ISO = process.env.LE2_ISO ?? '/Users/sander/Documents/legoeiland2-extract/le2.iso';
export default async ({ page, wait, shot, log, evaluate, key }) => {
  const t0 = Date.now();
  await page.waitForSelector('button:has-text("Spelen")');
  await shot('iso-0-start');
  await page.locator('summary').click();
  await page.locator('input[type=file][accept=".iso,.ISO"]').setInputFiles(ISO);
  // the ISO is stored, then the start screen is rebuilt with source "Van je eigen ISO"
  await page.waitForFunction(() => document.querySelector('button')?.title === 'Van je eigen ISO', null, { timeout: 300000 });
  log(`ISO stored in OPFS after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const stored = await evaluate(async () => { const f = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('isos')).getFileHandle('le2.iso'); return (await f.getFile()).size; });
  log(`OPFS isos/le2.iso: ${stored} bytes`);
  await page.locator('button:has-text("Spelen")').click();
  const t1 = Date.now();
  await page.waitForSelector('.le2-movie-canvas', { timeout: 120000 });
  log(`first movie shown ${((Date.now() - t1) / 1000).toFixed(1)} s after Spelen`);
  await wait(2500);
  await shot('iso-1-movie1');
  for (let i = 0; i < 3; i++) { await key('Space'); await wait(1500); await shot(`iso-2-after-skip${i + 1}`); }
  await page.waitForSelector('#le2-summary', { timeout: 60000 });
  log(await evaluate(() => document.getElementById('le2-summary').textContent));
  await wait(1500);
  log(await evaluate(() => document.getElementById('le2-info').textContent));
  log(JSON.stringify((await evaluate(() => window.__le2Movies)).map((m) => ({ n: m.name, f: m.frames, skipped: m.skipped, s: +m.mediaSeconds.toFixed(1) }))));
  await shot('iso-3-files');
};
