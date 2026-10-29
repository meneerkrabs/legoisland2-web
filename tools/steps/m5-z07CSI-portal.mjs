// M5 z07CSI, the last leg only (debug aid of the chapter bot): start at node 29 (boat arrival), put the boat at the dock (what the chapter bot has reached by walking to it), sail round the island to the portal.
import { csi, url } from './lib-z07CSI.mjs';
export default async (h) => {
  const { page, wait, log } = h;
  const S = csi(h);
  await page.goto(url(29), { waitUntil: 'load' });
  await S.waitHub();
  await S.start();
  // the boat to the dock (231, 206)
  await page.evaluate(() => { const z = window.__zone, w = z.world, b = w.records.find((r) => r.name === 'SPBT'); b.x = 231.4; b.y = 0; b.z = 206.6; b.ry = 1.3; b.rebuildYaw(); b.savePrev(); w.camera.init(b); });
  await wait(500);
  const portal = await S.at('PORS');
  let v = await S.veh();
  log('boat', JSON.stringify([v.x, v.z, v.ctrl, v.node]), 'portal', JSON.stringify(portal));
  const route = await S.sailPlan(v.x, v.z, portal[0], portal[2]);
  log('route to the portal', JSON.stringify(route?.map((p) => p.map((q) => Math.round(q)))));
  for (let k = 1; route && k < route.length; k++) {
    const last = k === route.length - 1;
    await S.sailTo(route[k][0], route[k][1], { done: async (st, d) => d < (last ? 8 : 25) || (await S.zoneNow()).arch !== 'z07CSI', maxMs: 120000 });
    v = await S.veh();
    log('  leg', k, JSON.stringify([Math.round(v.x), Math.round(v.z), v.arch]));
  }
  await S.sailTo(portal[0], portal[2], { done: async (st, d) => d < 6 || (await S.zoneNow()).arch !== 'z07CSI', maxMs: 60000 });
  const left = await S.untilLeft('z07CSI', 90000);
  log('left for', left);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && window.__zone.world.tickCount > 2, null, { timeout: 120000 }).catch(() => {});
  log('state', JSON.stringify(await S.state()));
  await S.shot('csi-portal-island');
};
