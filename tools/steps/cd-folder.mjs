// CD-folder path headless: pick the extracted CD root with the folder picker, start, skip the intro, list the files.
//   LE2_CD=/path/to/cd-root node tools/browse.mjs "http://localhost:5498/" tools/steps/cd-folder.mjs
const CD = process.env.LE2_CD ?? '/Users/sander/Documents/legoeiland2-extract/iso';
export default async ({ page, wait, shot, log, evaluate, key }) => {
  const t0 = Date.now();
  await page.waitForSelector('button:has-text("Spelen")');
  await page.locator('summary').click();
  await page.locator('input[type=file]:not([accept])').setInputFiles(CD);
  await page.waitForSelector('.le2-movie-canvas', { timeout: 120000 });
  log(`first movie shown ${((Date.now() - t0) / 1000).toFixed(1)} s after picking the folder`);
  await wait(2000);
  await shot('cd-1-movie1');
  for (let i = 0; i < 3; i++) { await key('Escape'); await wait(1200); }
  await page.waitForSelector('#le2-summary', { timeout: 60000 });
  log(await evaluate(() => document.getElementById('le2-summary').textContent));
  await wait(1500);
  log(await evaluate(() => document.getElementById('le2-info').textContent));
  // a movie from the CD folder (a Blob stream), to its end would take 22 s: check it starts and has the right size
  log(JSON.stringify((await evaluate(() => window.__le2Movies)).map((m) => ({ n: m.name, f: m.frames, skipped: m.skipped }))));
  await shot('cd-2-files');
};
