// z20DSP: the LOSS run (finish with a clock above 150 s = no medal): the failure texts, result menu page 19, retry (the zone restarts: second attempt, clock 0, countdown),
// then the pause menu (Esc) and abort -> back to the story.
//   node tools/browse.mjs "http://localhost:5604/?zone=z20DSP&mute=1" tools/steps/m6-z20DSP-loss.mjs --size 1280x800 --out /tmp/m6-z20DSP
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x1e), best: __zone.sh.vars.get(0x77), trophy: __zone.sh.vars.get(0xdc), res: __zone.sh.vars.get(0x103), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59) }));
  const ready = (m) => page.waitForFunction((m) => window.__zone && window.__zone.info.archive === 'z20DSP' && window.__zone.machine.mode === m, m, { timeout: 300000 });
  await ready(1);
  const v0 = await vars();
  await wait(1000);
  await key('Enter'); await wait(600); await key('Enter'); await wait(300);
  await page.waitForFunction(() => window.__zone.game.debug().state === 5, [], { timeout: 20000 });
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
  // shortcut: 92 % of the way with a clock of 2:40 (the bronze limit is 2:30)
  await page.evaluate(() => { const g = __zone.game.dsp; g.teleport(0.925); g.setClock(4800); });
  await drive(40000, (s) => s.state >= 6);
  log('after the drive', JSON.stringify(await dbg()));
  await page.waitForFunction(() => window.__zone.game.debug().state === 7, [], { timeout: 20000 });
  await wait(500);
  const d = await dbg();
  log('after the finish', JSON.stringify(d));
  expect('no medal (var 0x103 = 0)', d.result === 0, JSON.stringify(d));
  expect('the banner (mode 4) of a failed run', (await mode()) === 4);
  await shot('1-loss-banner');
  const v1 = await vars();
  expect('no trophy, no best time written', v1.trophy === 0 && v1.best === 3600, JSON.stringify(v1));
  await key('Enter'); await wait(600);
  expect('result menu (mode 5)', (await mode()) === 5);
  const m1 = await menu();
  expect('menu page 19 (retry / abort)', m1.page === 19, JSON.stringify(m1));
  await shot('2-loss-menu');
  await key('Enter'); await wait(1500);                // retry: the zone restarts
  await ready(1);
  const d2 = await dbg();
  expect('restarted: attempt 2, clock 0, state 0, the car at the start', d2.clock === 0 && d2.state === 0 && Math.abs(d2.pos[2] - 37.543) < 0.01, JSON.stringify(d2));
  await shot('3-restarted');
  await key('Enter'); await wait(600); await key('Enter'); await wait(400);
  await page.waitForFunction(() => window.__zone.game.debug().state === 5, [], { timeout: 20000 });
  await wait(1000);
  await key('Escape'); await wait(700);
  expect('pause menu (mode 3, page 18)', (await mode()) === 3 && (await menu()).page === 18, JSON.stringify(await menu()));
  await shot('4-pause');
  const c0 = (await dbg()).clock;
  await wait(800);
  expect('the clock stands still while paused', (await dbg()).clock === c0);
  // the pause page 18: continue / restart / abort -> the last item
  await key('ArrowDown'); await key('ArrowDown'); await wait(200);
  await key('Enter'); await wait(600);
  await key('ArrowDown'); await wait(200); await key('Enter');       // the confirmation page (Annuleren / OK): OK
  // the way back loads the hub (z16PYA): wait for it (a hub zone is much bigger than a mini-game)
  await page.waitForFunction(() => window.__zone?.info?.archive === 'z16PYA', [], { timeout: 120000 }).catch(() => {});
  await wait(1000);
  const arch = await page.evaluate(() => window.__zone?.info?.archive);
  const v2 = await vars();
  log('after abort', arch, JSON.stringify(v2));
  expect('aborted: left z20DSP, the story is back at the hub node before the race', arch === 'z16PYA' && v2.node === v0.node - 1, JSON.stringify({ arch, v0, v2 }));
  log(fail.length ? 'FAILED: ' + fail.join('; ') : 'ALL OK');
  if (fail.length) throw new Error(fail.join('; '));
};
