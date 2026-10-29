import { dip, wrap } from './lib-z23DIP.mjs';
export default async ({ page, wait, log, shot }) => {
  const H = dip({ page, wait, log, shot });
  await H.waitHub(); await wait(500); await H.start();
  await H.freePepper();
  for (const key of ['ArrowRight', 'ArrowLeft']) {
    for (const ticks of [3, 6]) {
      await page.evaluate(() => { const z = window.__zone, p = z.loaded.pepper; p.x = 173.4; p.z = 40; p.ry = 0; p.rebuildYaw(); p.savePrev(); z.world.camera.init(p); });
      await wait(300);
      const a = await H.pep();
      await page.keyboard.down(key); await H.untilTicks(async () => false, ticks, 10); await page.keyboard.up(key);
      const b = await H.pep();
      log(key, ticks, 'ticks', 'dry', wrap(b.ry - a.ry).toFixed(3), 'ticks elapsed', b.tick - a.tick);
    }
  }
};
