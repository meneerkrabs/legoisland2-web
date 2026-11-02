// A movie with a finger: a tap skips it (the on-screen buttons are hidden while it plays).
//   node tools/browse.mjs "http://localhost:5497/?movie=SdLogo&mute=1&touch=1" tools/steps/touch-movie.mjs --touch --size 844x390 --out /tmp/touch-movie
export default async ({ page, wait, log, shot, tapPage }) => {
  await page.waitForSelector('.le2-movie', { timeout: 60000 });
  await wait(1500);
  await shot('01-movie');
  await tapPage(400, 200);
  const gone = await page.waitForFunction(() => !document.querySelector('.le2-movie'), null, { timeout: 15000 }).then(() => true).catch(() => false);
  log(gone ? 'ok   tap skips the movie' : 'FAIL tap did not skip the movie');
  if (!gone) process.exitCode = 1;
};
