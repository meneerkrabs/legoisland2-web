// The primary archive.org item is made to fail (requests aborted): the download must fall back to the second Dutch ISO.
export default async ({ page, wait, log, evaluate, key }) => {
  await page.route(/archive\.org\/download\/legoeiland2dutch\//, (r) => r.abort());
  await page.waitForSelector('button:has-text("Spelen")');
  const t0 = Date.now();
  await page.locator('button:has-text("Spelen")').click();
  await page.waitForSelector('.le2-movie-canvas', { timeout: 600000 });
  log(`opened after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  log('stored item: ' + (await evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('le2-archive'); return await (await (await d.getFileHandle('complete.json')).getFile()).text(); })));
  await key('Space'); await wait(500); await key('Space'); await wait(500); await key('Space');
  await page.waitForSelector('#le2-summary', { timeout: 60000 });
  log(await evaluate(() => document.getElementById('le2-summary').textContent));
  await wait(1500);
  log(await evaluate(() => document.getElementById('le2-info').textContent));
};
