// Restored content, feature 'cave': at story node 68 (the ending) the wormhole opens without the cheat; walking into it leads to z50LTC (Teleport / Teleport2 sounds). Headless + muted:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5521/?zone=z02LGI&node=68&restored=1&mute=1" tools/steps/restore-cave.mjs --size 1280x800 --out /tmp/restore-cave
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  await S.skipCutscenes();
  let v = await S.vars([0xd, 0x58, 5]);
  log('vars', JSON.stringify(v));
  expect('the island at node 68', v[0x58] === 68);
  await S.until(async () => (await S.vars([0xd]))[0xd] === 5, 20000);
  v = await S.vars([0xd]);
  expect('var 0xd = 5 without typing SDREAMS', v[0xd] === 5, JSON.stringify(v));
  const worm = await S.rec('WORM');
  expect('the wormhole is visible', !!worm && worm.en, JSON.stringify(worm));
  // stand 9 units away on the ledge it hovers over (ground probed from just above the wormhole), facing it (the placement of tools/steps/m5-z50LTC-sdreams.mjs)
  await page.evaluate(() => {
    const z = window.__zone, w = z.world, p = z.loaded.pepper, r = w.records.find((x) => x.name === 'WORM');
    const px = r.x, pz = r.z + 9, g = w.col.groundRay(px, r.y + 6, pz);
    p.x = px; p.z = pz; p.y = g > -1e30 ? g : r.y; p.ry = Math.atan2(r.x - px, r.z - pz); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
  });
  await wait(800);
  await shot('cave-1-portal-open');
  const stats0 = await page.evaluate(() => { const s = window.__shell?.audio?.ga?.sfx?.stats; return s ? { ...s } : null; });
  log('audio stats before', JSON.stringify(stats0));
  await page.keyboard.down('ArrowUp');
  const ok = await S.until(async () => (await S.state())?.arch === 'z50LTC', 25000, 150);
  await page.keyboard.up('ArrowUp');
  const s = await S.state();
  expect('walking into WORM leads to z50LTC', ok && s?.arch === 'z50LTC', JSON.stringify(s));
  if (ok) { await wait(1500); await shot('cave-2-in-cave'); }
  const stats1 = await page.evaluate(() => { const s = window.__shell?.audio?.ga?.sfx?.stats; return s ? { ...s } : null; });
  log('audio stats after', JSON.stringify(stats1));
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'passed');
  if (fail.length) process.exitCode = 1;
};
