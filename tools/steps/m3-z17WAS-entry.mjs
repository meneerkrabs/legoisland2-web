// Entry through the story: start in the pyramid hub z16PYA (the hub the story node of z17WAS follows), F9 completes the hub's story step, the story moves on to z17WAS.
//   node tools/browse.mjs "http://localhost:5499/?zone=z16PYA&mute=1&debug=1" tools/steps/m3-z17WAS-entry.mjs --size 1280x800 --out /tmp/m3/z17WAS
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z16PYA' && window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 5, null, { timeout: 300000 });
  const n0 = await page.evaluate(() => __zone.sh.vars.get(0x58));
  log('in z16PYA at story node', n0);
  await wait(500);
  await key('F9');
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z17WAS' && window.__zone.machine.mode === 1, null, { timeout: 120000 });
  const s = await page.evaluate(() => ({ node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59), prev: __zone.sh.vars.get(0xa3), game: !!__zone.game }));
  expect('the story led from z16PYA into z17WAS (sub-game 14) with the ported game', s.sub === 14 && s.game, JSON.stringify(s));
  await wait(1000); await shot('e1-intro-from-story');
  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z17WAS entry passed');
};
