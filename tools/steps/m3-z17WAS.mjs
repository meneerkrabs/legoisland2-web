// z17WAS Whack-A-Snake in the headless browser (muted): the intro / help screens, a bot with real key presses that plays to a WIN (whacks snakes, double-presses the
// gem holders) and a LOSS (no input), the banner, the result menu and the way back through the story.
//   node tools/browse.mjs "http://localhost:5499/?zone=z17WAS&mute=1" tools/steps/m3-z17WAS.mjs --size 1280x800 --out /tmp/m3/z17WAS
// Shortcut used: after the bot has played ~15 s the zonewas node's clock (`__zone.world.records[22].ctrl.nodes[0].timeLeft`) is set to 3 s so the run does not take 90 s of wall time
// (the full 2700 ticks are covered by the node tests); the LOSS run does the same after 3 s without input.
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(200), trophy: __zone.sh.vars.get(0xd5), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59) }));
  const ready = (arch, m) => page.waitForFunction(([a, m]) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === m && window.__zone.world.tickCount >= 0, [arch, m], { timeout: 300000 });
  const BTN = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];     // basket k = 0..3
  const tap = (k) => page.keyboard.press(BTN[k], { delay: 25 });

  /** the bot: whack every snake that is up; double-press the one that holds the gem; for `ms` milliseconds or until the game is over */
  const shots = {};
  async function play(ms) {
    const t0 = Date.now();
    let presses = 0, grabs = 0;
    while (Date.now() - t0 < ms) {
      const d = await dbg();
      if (!d || d.done) break;
      if (!shots.gem && d.holder >= 0 && d.state[d.holder] === 2) { shots.gem = true; await shot('5a-gem-holder'); }
      if (!shots.squash && d.squash) { shots.squash = true; await shot('5b-squash'); }
      if (!d.busy && d.presses === 0 && !d.squash) {
        const k = d.state.findIndex((s, i) => s === 2 && d.hit[i] === 0);
        if (k >= 0) {
          await tap(k); presses++;
          if (d.holder === k) { await wait(70); await tap(k); grabs++; }
        }
      }
      await wait(30);
    }
    return { presses, grabs };
  }

  // ------------------------------------------------------------------ the first run: WIN
  await ready('z17WAS', 1);
  let s = await dbg();
  expect('the zone game is running and the clock is at 90 s', s && s.timeLeft === 2700 && s.timeText === '' || s.timeText === '01:30', JSON.stringify(s));
  const v0 = await vars();
  log('start vars', JSON.stringify(v0));
  expect('entered at the story node of z17WAS (sub-game 14)', v0.sub === 14, JSON.stringify(v0));
  await wait(1200);
  await shot('1-intro');
  await key('Enter'); await wait(700);
  expect('the controls help (mode 9)', (await mode()) === 9);
  await shot('2-help');
  await key('Enter'); await wait(500);
  expect('play (mode 2)', (await mode()) === 2);
  await wait(1500);
  await shot('3-play-start');
  const r = await play(9000);
  s = await dbg();
  log('after the first bot phase', JSON.stringify(r), JSON.stringify(s));
  expect('the bot scored (whacks)', s.score > 0 && s.hits > 0, JSON.stringify(s));
  await shot('4-play');
  // a gem: keep playing until one is taken (a third of the snakes carry it), at most 20 s more
  for (let i = 0; i < 4 && (await dbg()).gems === 0; i++) await play(5000);
  s = await dbg();
  expect('a gem was taken with the double press', s.gems >= 1, JSON.stringify(s));
  await shot('5-play-gem');
  // let the clock run out quickly
  await page.evaluate(() => { __zone.world.records[22].ctrl.nodes.find((n) => n.kind === 'zonewas').timeLeft = 90; });
  await play(6000);
  await wait(800);
  s = await dbg();
  expect('the game ended: banner (mode 4)', (await mode()) === 4 && s.done, JSON.stringify(s));
  log('final', s.finalScore, 'gems', s.gems, 'hits', s.hits);
  const v1 = await vars();
  expect('HISCORE_WAS = the score, TROPHY_WAS = its medal', v1.hi === s.finalScore && v1.trophy === (s.finalScore >= 8501 ? 3 : s.finalScore >= 5001 ? 2 : s.finalScore >= 101 ? 1 : 0), JSON.stringify(v1));
  await shot('6-banner');
  await wait(1500); await shot('6b-banner-later');
  await key('Enter'); await wait(700);
  const m1 = await menu();
  expect('result menu page 16 (continue / retry)', (await mode()) === 5 && m1.page === 16, JSON.stringify(m1));
  await shot('7-result-menu');
  await key('Enter'); await wait(3500);                  // Continue
  await page.waitForFunction(() => window.__zone && window.__zone.world.tickCount >= 0 && window.__zone.info.archive !== 'z17WAS', null, { timeout: 120000 }).catch(() => {});
  const after = await page.evaluate(() => ({ arch: window.__zone?.info.archive, node: __zone?.sh.vars.get(0x58), mode: window.__zone?.machine.mode }));
  log('after Continue', JSON.stringify(after));
  expect('Continue leaves the zone (back to the story\'s next zone)', after.arch && after.arch !== 'z17WAS', JSON.stringify(after));
  await wait(1500); await shot('8-after-win');

  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z17WAS win run passed');
};
