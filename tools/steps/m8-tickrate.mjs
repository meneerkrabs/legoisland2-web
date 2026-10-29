// measures the logic tick rate of a zone in the headless browser (ticks per wall-clock second in play mode): the bots' fixed waits assume 30
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5514/?zone=z17WAS&mute=1" tools/steps/m8-tickrate.mjs --size 1280x800 --out /tmp/d-tick
export default async ({ page, wait, log }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.machine.mode >= 1, null, { timeout: 600000 });
  for (let i = 0; i < 12 && (await page.evaluate(() => window.__zone.machine.mode)) !== 2; i++) { await page.keyboard.down('Enter'); await wait(120); await page.keyboard.up('Enter'); await wait(900); }
  await wait(1000);
  for (let k = 0; k < 4; k++) {
    const a = await page.evaluate(() => ({ t: performance.now(), n: window.__zone.world.tickCount }));
    await wait(3000);
    const b = await page.evaluate(() => ({ t: performance.now(), n: window.__zone.world.tickCount }));
    log('tick rate', ((b.n - a.n) / ((b.t - a.t) / 1000)).toFixed(1), 'ticks/s');
  }
};
