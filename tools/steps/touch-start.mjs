// The start screen with a finger: layout on a phone, the "Touchbesturing" option (auto / aan / uit) by tap, Spelen by tap leads to the game with the on-screen buttons (when on).
//   node tools/browse.mjs "http://localhost:5497/?mods=off" tools/steps/touch-start.mjs --touch --size 390x844 --out /tmp/touch-start
export default async (h) => {
  const { page, wait, log, shot, tapSel } = h;
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await page.waitForSelector('#le2-touch', { timeout: 30000 });
  await wait(500);
  await shot('01-start');
  const auto = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, value: document.getElementById('le2-touch').value, overflowX: document.documentElement.scrollWidth > innerWidth }));
  log('auto detection', JSON.stringify(auto));
  expect('touch device is detected as coarse pointer', auto.coarse);
  expect('start screen does not scroll sideways', !auto.overflowX);
  // choose "uit" through the select, reload: no buttons in game would follow; here only the stored value
  await page.selectOption('#le2-touch', 'off');
  expect('option stored', (await page.evaluate(() => JSON.parse(localStorage.getItem('le2-display')).touch)) === 'off');
  await page.selectOption('#le2-touch', 'auto');
  expect('option back to auto', (await page.evaluate(() => JSON.parse(localStorage.getItem('le2-display')).touch)) === 'auto');
  // every button on the start screen is big enough for a finger (>= 36 css px high)
  const small = await page.evaluate(() => [...document.querySelectorAll('.bdb-start button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 36).map((b) => b.textContent));
  expect('start buttons are finger sized', small.length === 0, small.join(','));
  // tap "Spelen": the game starts (intro movie first unless skipped), tap skips the movie
  await page.evaluate(() => { const c = document.getElementById('le2-skipintro'); if (c && !c.checked) c.click(); });
  await tapSel('.bdb-start .books button:first-child');
  await page.waitForFunction(() => window.__shell && window.__fe !== undefined, null, { timeout: 120000 }).catch(() => {});
  await page.waitForSelector('.tc-root', { timeout: 120000 });
  await wait(800);
  await shot('02-in-game');
  expect('buttons present after Spelen (auto on a touch device)', true);
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'all ok');
  if (fail.length) process.exitCode = 1;
};
