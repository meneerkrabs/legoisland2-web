// Restored feature 'tips' in the real game (headless, muted): talk to Darren (record DARR) six times at story node 56 (band 13) and log what the NPC code asks the context to say (ids, speech
// indices, subtitle text); screenshots of the subtitle. URL needs &restored=1 (and `&restoredoff=` with every other feature to isolate this one); `&hold=1` so the bot starts the zone itself.
//   (sh tools/m4-snapshot-server.sh 5731)  sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z02LGI&node=56&mute=1&hold=1&restored=1&restoredoff=<all but tips>" tools/steps/restore-tips.mjs --size 1024x768 --out /tmp/restore-tips
import { island } from './lib-island.mjs';

export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  await S.start();
  await S.skipCutscenes();
  // log every say the island context gets (the NPC code's calls, after the restored hook decided)
  await page.evaluate(() => {
    // the zone game's sayFrom is what the island context finally calls (after the restored `say` hook rewrote the request): log there
    const zg = window.__zone.game.ictx.zg, o = zg.sayFrom.bind(zg);
    window.__said = [];
    zg.sayFrom = (t, a, b, ...m) => { const r = o(t, a, b, ...m); if (r) window.__said.push({ a, b: b ?? null, r, v: t.voice(a), v2: b ? t.voice(b) : null, text: t.text(a), tick: window.__zone.world.tickCount }); return r; };
  });
  const N = Number(process.env.TALKS ?? 6);
  for (let i = 0; i < N; i++) {
    const before = (await page.evaluate(() => window.__said.length));
    for (let k = 0; k < 3; k++) { await S.teleportNear('DARR', 4); await wait(120); }
    await S.tap('ShiftLeft', 80);
    let got = await S.untilTicks(async () => (await page.evaluate(() => window.__said.length)) > before, 90, 30);
    if (!got) { for (let k = 0; k < 3; k++) { await S.teleportNear('DARR', 4); await wait(120); } await S.tap('ShiftLeft', 80); got = await S.untilTicks(async () => (await page.evaluate(() => window.__said.length)) > before, 120, 30); }
    if (i < 2) await shot(`talk${i + 1}`);
    // wait for the conversation to end (the NPC holds the cutscene manager while it talks)
    await S.untilTicks(async () => !(await page.evaluate(() => window.__zone.game.ictx.cutsceneActive())) && (await page.evaluate(() => window.__zone.game.ictx.speechIdle())), 900, 60);
    await wait(200);
    log(`talk ${i + 1}: said=${got}`);
  }
  const said = await page.evaluate(() => window.__said);
  log('SAID ' + JSON.stringify(said.map((s) => [s.a, s.b, s.v, s.v2, s.r, s.text.slice(0, 40)])));
  const node = (await S.state()).node;
  log(`node ${node}; ids: ${said.map((s) => s.a + (s.b ? '+' + s.b : '')).join(' ')}`);
};
