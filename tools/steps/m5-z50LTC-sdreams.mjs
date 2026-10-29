// M5 audit: the cheat code SDREAMS typed with real keys on the island (story era 4, node 61) opens the wormhole WORM (var 0xd: 1 -> 2 -> 5) and walking into it leads to the developers'
// cave z50LTC (FUN_004375a8 / FUN_00437515 case 4 -> LGI_FSM scale-in -> the box portal -> var 5 = 34):
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5512/?zone=z02LGI&node=61&mute=1" tools/steps/m5-z50LTC-sdreams.mjs --size 1280x800 --out /tmp/m5-ltc-sdreams
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  await S.skipCutscenes();
  let v = await S.vars([0xd, 0x58, 5]);
  expect('the island at era 4 (node 61), var 0xd = 0', v[0xd] === 0 && v[0x58] === 61, JSON.stringify(v));
  const worm0 = await S.rec('WORM');
  expect('the wormhole is hidden', !worm0 || !worm0.en, JSON.stringify(worm0));
  // any key first (the detector arms its rows on the first key that continues no sequence), then the word, real key presses
  await S.tap('KeyX');
  for (const k of ['KeyS', 'KeyD', 'KeyR', 'KeyE', 'KeyA', 'KeyM', 'KeyS']) { await S.tap(k, 80); await wait(40); }
  await S.until(async () => (await S.vars([0xd]))[0xd] !== 0, 3000);
  v = await S.vars([0xd]);
  expect('SDREAMS sets var 0xd (1, then the scale-in runs: 2 -> 5)', v[0xd] === 1 || v[0xd] === 2 || v[0xd] === 5, JSON.stringify(v));
  await S.until(async () => (await S.vars([0xd]))[0xd] === 5, 20000);
  v = await S.vars([0xd]);
  expect('the wormhole has scaled in: var 0xd = 5', v[0xd] === 5, JSON.stringify(v));
  const worm = await S.rec('WORM');
  expect('the wormhole record is visible', !!worm && worm.en, JSON.stringify(worm));
  await shot('sdreams-worm-open');
  // walk into it: stand 9 units away on the ledge it hovers over (ground probed from just above the wormhole) facing it and hold Up
  await page.evaluate(() => {
    const z = window.__zone, w = z.world, p = z.loaded.pepper, r = w.records.find((x) => x.name === 'WORM');
    const px = r.x, pz = r.z + 9, g = w.col.groundRay(px, r.y + 6, pz);
    p.x = px; p.z = pz; p.y = g > -1e30 ? g : r.y; p.ry = Math.atan2(r.x - px, r.z - pz); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
  });
  await wait(300);
  await shot('sdreams-near-worm');
  await page.keyboard.down('ArrowUp');
  const ok = await S.until(async () => (await S.state())?.arch === 'z50LTC', 25000, 150);
  await page.keyboard.up('ArrowUp');
  const s = await S.state();
  expect('walking into WORM leads to z50LTC', ok && s?.arch === 'z50LTC', JSON.stringify(s));
  if (ok) { await wait(1500); await shot('sdreams-in-cave'); }
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'SDREAMS passed');
  if (fail.length) process.exitCode = 1;
};
