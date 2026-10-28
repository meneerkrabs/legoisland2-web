// Plays the movie(s) given by the URL and prints the statistics the player collected.
//   node tools/browse.mjs "http://localhost:5499/?play=1&movie=SdLogo&mute=1" tools/steps/movie.mjs
export default async ({ page, wait, shot, log, evaluate }) => {
  const t0 = Date.now();
  await wait(4000);
  await shot('movie-4s');
  await wait(6000);
  await shot('movie-10s');
  // wait until the file list page appears (movie ended)
  await page.waitForSelector('#le2-summary', { timeout: 180000 });
  log(`file list after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  log(JSON.stringify(await evaluate(() => window.__le2Movies), null, 1));
  log(await evaluate(() => document.getElementById('le2-summary').textContent));
  log(await evaluate(() => document.getElementById('le2-info').textContent));
  await shot('files');
};
