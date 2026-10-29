// Restored feature 'joke' in the real castle hub (headless, muted): talk twice to the tournament figure BAR2 (story node 22, CI/Data/CSIFSM4.str) and log what is spoken (sayFrom of the zone game):
// first talk BAR2A, second talk BAR2C + the middle line, then BAR2D alone when the speech is idle. URL needs &restored=1 (and `&restoredoff=` with every other feature to isolate this one).
//   (sh tools/m4-snapshot-server.sh 5731)  sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z07CSI&node=22&mute=1&hold=1&restored=1&restoredoff=<all but joke>" tools/steps/restore-joke.mjs --size 1024x768 --out /tmp/restore-joke
// Env: FIG (default BAR2).
import { hub } from './lib-hub.mjs';

export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = hub(h, 'z07CSI');
  const fig = process.env.FIG ?? 'BAR2';
  await S.start();
  await S.skipCutscenes();
  await S.freePepper();
  // node 22 starts on the boat (arrival by sea): put the boat at the dock (PATH node 0x6f) and moor with Ctrl, like tools/steps/m5-z07CSI.mjs does after sailing there
  if ((((await S.state()).ctrl) & 0xff) !== 1) {
    const dock = await S.pathNode(0x6f);
    await page.evaluate(([x, z]) => { const c = window.__zone.world.ext.get('island.vehicles')?.current; if (c) { c.setEuler(c.rx, c.ry, c.rz, x, c.y, z); c.savePrev?.(); } }, [dock[0], dock[2]]);
    await wait(500);
    for (let k = 0; k < 3 && (((await S.state()).ctrl) & 0xff) !== 1; k++) { await page.keyboard.down('Control'); await wait(200); await page.keyboard.up('Control'); await S.until(async () => (((await S.state()).ctrl) & 0xff) === 1, 4000); }
    log('moored: ' + JSON.stringify(await S.state()));
    await S.skipCutscenes(); await S.freePepper();
  }
  const have = await page.evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return r ? { x: r.x, y: r.y, z: r.z, en: (r.flags & 2) !== 0 } : null; }, fig);
  log(`${fig}: ${JSON.stringify(have)}`);
  await page.evaluate(() => {
    const zg = window.__zone.game.ctx, o = zg.sayFrom.bind(zg);
    window.__said = [];
    zg.sayFrom = (t, a, b) => { const r = o(t, a, b); if (r) window.__said.push({ a, b: b ?? null, v: t.voice(a), v2: b ? t.voice(b) : null, text: t.raw(a), text2: b ? t.raw(b) : null, tick: window.__zone.world.tickCount }); return r; };
  });
  for (let i = 0; i < 2; i++) {
    const before = await page.evaluate(() => window.__said.length);
    for (let k = 0; k < 3; k++) { await S.teleportNear(fig, 4); await wait(120); }
    await S.tap('ShiftLeft', 80);
    let got = await S.untilTicks(async () => (await page.evaluate(() => window.__said.length)) > before, 90, 30);
    if (!got) { for (let k = 0; k < 3; k++) { await S.teleportNear(fig, 4); await wait(120); } await S.tap('ShiftLeft', 80); got = await S.untilTicks(async () => (await page.evaluate(() => window.__said.length)) > before, 120, 30); }
    log(`talk ${i + 1}: said=${got}`);
    if (i === 1) {
      // the follow-up (D) arrives when the first speech is over: wait for the log to grow, with a screenshot of each subtitle
      await shot('talk2-first');
      const grew = await S.untilTicks(async () => (await page.evaluate(() => window.__said.length)) > before + 1, 600, 60);
      log(`D follows: ${grew}`);
      if (grew) await shot('talk2-second');
    }
    await S.untilTicks(async () => !(await page.evaluate(() => window.__zone.game.ictx.cutsceneActive())) && (await page.evaluate(() => window.__zone.game.ictx.speechIdle())), 900, 60);
    await wait(200);
  }
  const said = await page.evaluate(() => window.__said);
  log('SAID ' + JSON.stringify(said.map((s) => [s.a, s.b, s.v, s.v2, s.text.slice(0, 40), s.text2?.slice(0, 40)])));
};
