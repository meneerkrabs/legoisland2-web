// z15SSH particles (WP-PART-WIRE): the dust of the two `trexfeet` emitters at the rear wheels while the buggy rides; screenshots + particle statistics.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5513/?zone=z15SSH&mute=1" tools/steps/m6-z15SSH-fx.mjs --size 1024x768 --out /tmp/m6-z15SSH-fx
export default async ({ page, shot, wait, log, key }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z15SSH' && window.__zone.machine.mode === 1 && window.__particles, null, { timeout: 300000 });
  await key('Enter'); await wait(600); await key('Enter'); await wait(800);
  for (let i = 0; i < 4; i++) {
    await wait(2500);
    log('particles', JSON.stringify(await page.evaluate(() => ({ st: window.__particles.stats, live: window.__particles.engine.drawList.length, speed: __zone.game.ssh.node.speed }))));
    await shot('dust' + i);
  }
};
