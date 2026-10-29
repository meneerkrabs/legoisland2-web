// Restored feature 'holo' in the real game (headless, muted): hold Shift (20 ticks, away from NPCs) to call the hint hologram several times and log what is spoken (sayFrom of the zone game):
// story node 8 (LIHOL6: 177 then B..E then 182) and, with NODE=32, LIHOL9 (681 when the pages are in hand and Pepper is on foot, else 682 + 683). Env: NODE, TIMES (default 7).
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z02LGI&node=8&mute=1&hold=1&restored=1&restoredoff=<all but holo>" tools/steps/restore-holo.mjs --size 1024x768 --out /tmp/restore-holo
import { island } from './lib-island.mjs';

export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  await S.start();
  await S.skipCutscenes();
  await page.evaluate(() => {
    const zg = window.__zone.game.ictx.zg, o = zg.sayFrom.bind(zg);
    window.__said = [];
    zg.sayFrom = (t, a, b) => { const r = o(t, a, b); if (r) window.__said.push({ a, v: t.voice(a), text: t.text(a), tick: window.__zone.world.tickCount }); return r; };
  });
  // a spot far from every NPC (Shift next to one starts a conversation instead of calling the hologram)
  const spot = await page.evaluate(() => {
    const z = window.__zone, w = z.world, p = z.loaded.pepper, npcs = w.records.filter((r) => (r.flags & 0x40) !== 0 && (r.flags & 2) !== 0);
    let best = null;
    for (let x = -300; x <= 300; x += 20) for (let zz = -300; zz <= 300; zz += 20) {
      const g = w.col.groundRay(x, 200, zz); if (g < -1e30 || g < 0.5) continue;
      const d = Math.min(...npcs.map((r) => Math.hypot(r.x - x, r.z - zz)));
      if (!best || d > best.d) best = { x, z: zz, g, d };
    }
    p.x = best.x; p.z = best.z; p.y = best.g; p.rebuildYaw(); p.savePrev(); w.camera.init(p);
    return best;
  });
  log('spot ' + JSON.stringify(spot));
  await wait(500);
  if (process.env.NODE_PAGES) await S.setVar(0xa5, Number(process.env.NODE_PAGES));
  const T = Number(process.env.TIMES ?? 7);
  for (let i = 0; i < T; i++) {
    const before = await page.evaluate(() => window.__said.length);
    // away from every NPC: a spot near the hologram's home is fine, the NPC talk radius is small; hold Shift 40 ticks
    await page.keyboard.down('ShiftLeft');
    const got = await S.untilTicks(async () => (await page.evaluate(() => window.__said.length)) > before, 150, 30);
    await page.keyboard.up('ShiftLeft');
    log(`call ${i + 1}: said=${got}`);
    if (i === 0) await shot('holo1');
    // the hologram goes away after its speech (210 ticks at the most) or on Shift: wait until it is idle again
    await S.untilTicks(async () => (await page.evaluate(() => window.__zone.sh.vars.get(0xc6))) === 0 && (await page.evaluate(() => window.__zone.game.ictx.speechIdle())), 400, 60);
    await wait(300);
  }
  const said = await page.evaluate(() => window.__said);
  log('SAID ' + JSON.stringify(said.map((s) => [s.a, s.v, s.text.slice(0, 50)])));
};
