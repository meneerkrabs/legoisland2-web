// z20DSP Desert Speedster in the headless browser (muted): the intro / help screens, the countdown, a bot with REAL key presses that drives the car (the run is shortened
// by putting the car on the track at 92 % of the way, `__zone.game.dsp.teleport`, so the finish is reached within seconds; the full lap is covered by the node tests),
// the finish, the result panel (medal text, score), the result menu and the way back through the story. A second part (-loss) runs the same with a slow clock.
//   node tools/browse.mjs "http://localhost:5604/?zone=z20DSP&mute=1" tools/steps/m6-z20DSP.mjs --size 1280x800 --out /tmp/m6-z20DSP
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x1e), best: __zone.sh.vars.get(0x77), trophy: __zone.sh.vars.get(0xdc), res: __zone.sh.vars.get(0x103), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59) }));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z20DSP' && window.__zone.machine.mode === 1, [], { timeout: 300000 });
  const v0 = await vars();
  log('start vars', JSON.stringify(v0));
  expect('entered in sub-game 16 (z20DSP)', v0.sub === 16, JSON.stringify(v0));
  await wait(1500);
  await shot('1-intro');
  const hudHidden = await page.evaluate(() => !__zone.hud.visible);
  expect('the HUD is not drawn in the intro', hudHidden);
  await key('Enter'); await wait(700);
  expect('the controls help (mode 9)', (await mode()) === 9);
  expect('the race state is 2 while the help shows (chase camera)', (await dbg()).state === 2, JSON.stringify(await dbg()));
  await shot('2-help');
  await key('Enter'); await wait(400);
  expect('play (mode 2)', (await mode()) === 2);
  await shot('3-countdown');
  await page.waitForFunction(() => window.__zone.game.debug().state === 5, [], { timeout: 20000 });
  let d = await dbg();
  expect('the countdown is over (state 5) and the clock runs', d.state === 5, JSON.stringify(d));
  // real key presses: Alt = accelerate, Left / Right = steer by the heading to a point ahead on the track
  const drive = async (ms, until) => {
    const t0 = Date.now();
    let left = false, right = false;
    await page.keyboard.down('Alt');
    while (Date.now() - t0 < ms) {
      const s = await page.evaluate(() => { const g = __zone.game; return { d: g.debug(), want: g.dsp.want(0.004) }; });
      if (until(s.d)) break;
      let e = s.want - s.d.yaw; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
      const wl = e < -0.05, wr = e > 0.05;
      if (wl !== left) { await (wl ? page.keyboard.down('ArrowLeft') : page.keyboard.up('ArrowLeft')); left = wl; }
      if (wr !== right) { await (wr ? page.keyboard.down('ArrowRight') : page.keyboard.up('ArrowRight')); right = wr; }
      await wait(25);
    }
    await page.keyboard.up('Alt');
    if (left) await page.keyboard.up('ArrowLeft');
    if (right) await page.keyboard.up('ArrowRight');
  };
  await drive(4000, () => false);
  d = await dbg();
  log('after 4 s of driving', JSON.stringify(d));
  expect('the car drives (path parameter and speed grow)', d.t > 0.035 && d.speed > 0.1, JSON.stringify(d));
  await shot('4-driving');
  // shortcut: 92 % of the way, a clock of 1:20 (gold)
  await page.evaluate(() => { const g = __zone.game.dsp; g.teleport(0.925); g.setClock(1500); });
  await wait(300);
  await shot('5-near-the-oasis');
  await drive(40000, (s) => s.state >= 6);
  d = await dbg();
  log('after the finish', JSON.stringify(d));
  expect('the finish was crossed (state 6 / 7)', d.state >= 6, JSON.stringify(d));
  await shot('6-finish');
  await page.waitForFunction(() => window.__zone.game.debug().state === 7, [], { timeout: 20000 });
  await wait(500);
  d = await dbg();
  expect('the result is gold (var 0x103 = 3)', d.result === 3, JSON.stringify(d));
  expect('score = 10000 - 3 * max(0, time ticks - 2100)', d.score === Math.max(0, 10000 - 3 * Math.max(0, Math.trunc(d.clock) - 2100)), JSON.stringify(d));
  expect('banner mode (4)', (await mode()) === 4);
  await shot('7-banner');
  const v1 = await vars();
  log('vars after the finish', JSON.stringify(v1));
  expect('trophy 3, hi-score and best time written', v1.trophy === 3 && v1.hi === d.score && v1.best < 3600 && v1.best > 0, JSON.stringify(v1));
  await key('Enter'); await wait(600);
  expect('result menu (mode 5)', (await mode()) === 5);
  await shot('8-result-menu');
  await key('Enter'); await wait(2500);
  const v2 = await vars();
  const arch = await page.evaluate(() => window.__zone?.info?.archive);
  log('after continue', JSON.stringify(v2), arch);
  expect('left the zone through the story (continue)', arch !== 'z20DSP', String(arch));
  log(fail.length ? 'FAILED: ' + fail.join('; ') : 'ALL OK');
  if (fail.length) throw new Error(fail.join('; '));
};
