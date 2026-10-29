// M5 z13CAI: the ten emitters of FUN_0061bc41 (vol01-04, lava01-03, spray01/02) run: stats of window.__particles, a look at the volcano (the helicopter is put 120 units from it).
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5513/?zone=z13CAI&node=33&mute=1&hold=1&debug=1" tools/steps/m5-z13CAI-particles.mjs --size 1280x800 --out /tmp/m5-z13CAI
import { cai, url } from './lib-z13CAI.mjs';
export default async (h) => {
  const { page, wait, log } = h;
  const S = cai(h);
  await page.goto(url(33), { waitUntil: 'load' });
  await S.waitHub(); await S.start(); await wait(1500);
  await page.evaluate(() => { const g = window.__zone.world.ext.get('island.vehicles'), c = g.current; c.x = -250; c.z = -100; c.y = 150; c.ry = Math.PI; c.rebuildYaw(); c.savePrev(); });
  await wait(2500);
  const st = await page.evaluate(() => ({ stats: window.__particles?.stats ?? null, handles: window.__particles ? Object.keys(window.__particles).slice(0, 12) : null }));
  log('particles', JSON.stringify(st));
  await S.shot('cai-particles-volcano');
};
