import { dip } from './lib-z23DIP.mjs';
export default async ({ page, wait, log, shot }) => {
  const H = dip({ page, wait, log, shot });
  await H.waitHub(); await wait(500); await H.start();
  await H.freePepper();
  log('start', JSON.stringify(await H.pep()));
  const ok = await H.walkPath([1, 17, 18, 10, 13, 15], { tol: 5, maxTicks: 900, carryOn: true });
  log('walked', ok, JSON.stringify(await H.pep()), JSON.stringify(await H.vars([0x101, 0x58, 0x5e, 0xc, 0xba])));
  await wait(500);
  log('after', JSON.stringify(await H.pep()), JSON.stringify(await H.vars([0x101, 0x58])));
  await shot('walk-end');
};
