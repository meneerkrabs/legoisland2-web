// DIP smoke run: load node N, start, walk, one screenshot.   BASE=http://localhost:5515 node tools/browse.mjs "<url>" tools/steps/m5-z23DIP-smoke.mjs --out /tmp/m5-z23DIP
import { hub } from './lib-hub.mjs';
export default async ({ page, wait, log, shot }) => {
  const H = hub({ page, wait, log, shot }, 'z23DIP');
  await H.waitHub();
  await wait(800);
  await H.start();
  log('state', JSON.stringify(await H.state()));
  await H.freePepper();
  await H.hold('ArrowUp', 1500);
  log('state2', JSON.stringify(await H.state()));
  log('kinds', JSON.stringify(await H.nodeKinds()));
  log('debug', JSON.stringify(await H.debug()).slice(0, 1500));
  await shot('dip-smoke');
};
