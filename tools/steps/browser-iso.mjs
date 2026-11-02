// Own ISO (450 MB written to OPFS in 8 MB chunks through src/opfsio.ts) and own CD folder (<input webkitdirectory>) per engine; persistent profile in webkit.
//   LE2_ISO=/path/le2.iso node tools/browse.mjs "http://localhost:5497/?source=archive&mute=1" tools/steps/browser-iso.mjs --browser webkit --profile /tmp/bc/prof-iso-w
//   BC_WHAT=cd  -> the CD folder instead (LE2_CD, default the extracted CD); BC_NOWRITABLE=1 without createWritable (Safari < 26)
const ISO = process.env.LE2_ISO ?? '/Users/sander/Documents/legoeiland2-extract/le2.iso';
const CD = process.env.LE2_CD ?? '/Users/sander/Documents/legoeiland2-extract/iso';
export default async ({ page, shot, wait, log, evaluate }) => {
  const what = process.env.BC_WHAT ?? 'iso';
  const fail = [];
  const expect = (n, c, x = '') => { log(c ? 'ok  ' : 'FAIL', n, x); if (!c) fail.push(n); };
  await page.waitForLoadState('load'); await wait(2500);
  await evaluate(async () => { const r = await navigator.storage.getDirectory(); for await (const [n] of r.entries()) await r.removeEntry(n, { recursive: true }).catch(() => {}); });
  if (process.env.BC_NOWRITABLE === '1') await page.addInitScript(() => { try { delete FileSystemFileHandle.prototype.createWritable; } catch { /* */ } });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('button:has-text("Spelen")');
  await page.locator('summary', { hasText: 'Eigen cd of ISO' }).click();
  const t0 = Date.now();
  if (what === 'iso') {
    await page.locator('input[type=file][accept=".iso,.ISO"]').setInputFiles(ISO);
    await page.waitForFunction(() => document.querySelector('button')?.title === 'Van je eigen ISO', null, { timeout: 300000 });
    const stored = await evaluate(async () => (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('isos')).getFileHandle('le2.iso').then((f) => f.getFile())).size);
    expect('ISO stored in OPFS (size equals the file)', stored > 4.4e8, `${stored} bytes after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await page.reload({ waitUntil: 'load' }); await page.waitForSelector('button:has-text("Spelen")');
    expect('after a reload the start screen reads from the stored ISO', (await evaluate(() => document.querySelector('button').title)) === 'Van je eigen ISO');
  } else {
    await page.locator('input[type=file]:not([accept])').last().setInputFiles(CD);
  }
  if (what === 'iso') await page.waitForSelector('button:has-text("Spelen")');
  if (what === 'iso') await page.locator('button:has-text("Spelen")').click();
  await page.waitForSelector('.le2-movie-canvas', { timeout: 120000 });
  await wait(2500);
  expect('the first intro movie plays from that source', true);
  await shot(`${what}-movie1`);
  log(fail.length ? 'FAILED: ' + fail.join('; ') : `all ${what} checks passed`);
  if (fail.length) process.exitCode = 1;
};
