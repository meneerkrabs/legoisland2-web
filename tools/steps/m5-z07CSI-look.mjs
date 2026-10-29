// quick look at the castle: arrival by boat, mode 1, play, screenshots, state.
import { csi, url } from './lib-z07CSI.mjs';
export default async (h) => {
  const { page, wait, log } = h;
  const S = csi(h);
  await page.goto(url(Number(process.env.NODE ?? 15)), { waitUntil: 'load' });
  await S.waitHub();
  log('state', JSON.stringify(await S.state()));
  await wait(1500);
  await S.shot('csi-01-mode1');
  await S.start();
  await wait(1500);
  log('veh', JSON.stringify(await S.veh()));
  await S.shot('csi-02-play');
  log('dbg', JSON.stringify(await S.csi()).slice(0, 600));
  log('chain', JSON.stringify(await page.evaluate(() => window.__zone.loaded.pepper.ctrl.nodes.map((n) => n.kind))));
  await S.keys(['Space']); await wait(4000); await S.release();
  log('veh', JSON.stringify(await S.veh()));
  await S.shot('csi-03-sailing');
};
