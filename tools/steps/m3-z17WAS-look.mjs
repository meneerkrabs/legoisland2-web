export default async ({ page, shot, wait, key, log }) => {
  page.on('pageerror', (e) => log('PAGEERROR', e.message));
  const mode = () => page.evaluate(() => window.__zone.machine.mode);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z17WAS' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  await wait(500);
  log('mode', await mode());
  await key('Enter'); await wait(800); log('mode after Enter', await mode()); await shot('look-help');
  await key('Enter'); await wait(800); log('mode after Enter', await mode());
  await wait(2500);
  await shot('look-play1');
  log(JSON.stringify(await page.evaluate(() => window.__zone.game?.debug?.())));
  await wait(6000);
  await shot('look-play2');
  log(JSON.stringify(await page.evaluate(() => window.__zone.game?.debug?.())));
};
