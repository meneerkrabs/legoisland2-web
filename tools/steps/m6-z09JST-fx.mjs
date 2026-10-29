// z09JST particles (WP-PART-WIRE): the mud clouds (orsemud1) at the hooves of both horses while the knights ride at each other (state 9). The charge is built by the bot of tools/lib/jst-bot.mjs
// through the page: real key presses are not needed to see the emitters (the state is forced with the duel's own state machine: press LEFT / RIGHT, then SPACE).
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5513/?zone=z09JST&mute=1" tools/steps/m6-z09JST-fx.mjs --size 1024x768 --out /tmp/m6-z09JST-fx
export default async ({ page, shot, wait, log, key }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z09JST' && window.__zone.machine.mode === 1 && window.__particles, null, { timeout: 300000 });
  await key('Enter'); await wait(600); await key('Enter'); await wait(1500);
  const st = () => page.evaluate(() => ({ state: __zone.game.duel.state, st: window.__particles.stats, live: window.__particles.engine.drawList.length }));
  let pressed1 = false, released = false, shots = 0;
  for (let i = 0; i < 1200 && shots < 3; i++) {
    const s = await st();
    if (s.state === 1 && !pressed1) { pressed1 = true; await page.keyboard.down('Space'); await wait(120); await page.keyboard.up('Space'); }
    else if (s.state === 3 && !released) {
      // the charge is built by alternating LEFT / RIGHT; put a charge of 40 on the gauge and let go with SPACE (what a player does after a few seconds)
      released = true;
      await page.evaluate(() => { const d = __zone.game.duel; d.speed = 40; d.gauge = 40; });
      await page.keyboard.down('Space'); await wait(120); await page.keyboard.up('Space');
    } else if (s.state === 9) { shots++; await shot('mud' + shots); log('mud', JSON.stringify(s)); await wait(400); }
    if (i % 20 === 0) log('state', s.state);
    await wait(60);
  }
  log('end', JSON.stringify(await st()));
};
