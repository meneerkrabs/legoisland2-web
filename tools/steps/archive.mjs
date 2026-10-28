// archive.org path headless: real download of the cabinet (~342 MB) into OPFS, play the first movie (streamed from
// archive.org) to its end, then reload to check that the second start uses the stored files.
//   node tools/browse.mjs "http://localhost:5498/" tools/steps/archive.mjs
export default async ({ page, wait, shot, log, evaluate, key }) => {
  await page.waitForSelector('button:has-text("Spelen")');
  const t0 = Date.now();
  await page.locator('button:has-text("Spelen")').click();
  const status = page.locator('.bdb-start .note').first();
  let lastShot = 0;
  const poll = setInterval(async () => {
    const t = await page.evaluate(() => [...document.querySelectorAll('.bdb-start .note')].map((n) => n.textContent).find((x) => /MB|Spel laden/.test(x) && !/archive\.org/.test(x)) ?? '').catch(() => '');
    log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s: ${t}`);
  }, 15000);
  setTimeout(() => shot('arch-0-downloading').catch(() => {}), 12000);
  await page.waitForSelector('.le2-movie-canvas', { timeout: 900000 });
  clearInterval(poll);
  const tDownload = (Date.now() - t0) / 1000;
  log(`download + open + first movie visible after ${tDownload.toFixed(1)} s`);
  const sizes = await evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('le2-archive'); const o = {}; for await (const [n, h] of d.entries()) o[n] = (await h.getFile()).size; return o; });
  log(`OPFS le2-archive: ${JSON.stringify(sizes)}`);
  await wait(4000);
  await shot('arch-1-movie1-4s');
  // let SdLogo play to its end (streamed from archive.org), then skip the rest
  await page.waitForFunction(() => (window.__le2Movies ?? []).length >= 1, null, { timeout: 120000 });
  const m = await evaluate(() => window.__le2Movies[0]);
  log(`SdLogo from archive.org: ${JSON.stringify(m)}`);
  await wait(800);
  await key('Space'); await wait(800); await key('Space');
  await page.waitForSelector('#le2-summary', { timeout: 60000 });
  log(await evaluate(() => document.getElementById('le2-summary').textContent));
  await wait(2000);
  log(await evaluate(() => document.getElementById('le2-info').textContent));
  await shot('arch-2-files');
  // second start: everything from OPFS
  await page.reload();
  await page.waitForSelector('button:has-text("Spelen")');
  log('after reload: ' + (await evaluate(() => [...document.querySelectorAll('.note')].map((n) => n.textContent).join(' | ').slice(0, 220))));
  const t1 = Date.now();
  await page.locator('button:has-text("Spelen")').click();
  await page.waitForSelector('.le2-movie-canvas', { timeout: 60000 });
  log(`second start: first movie visible after ${((Date.now() - t1) / 1000).toFixed(1)} s (no download)`);
  await key('Space'); await wait(500); await key('Space'); await wait(500); await key('Space');
  await page.waitForSelector('#le2-summary', { timeout: 60000 });
  log(await evaluate(() => document.getElementById('le2-summary').textContent));
};
