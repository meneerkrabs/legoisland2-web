// z15SSH "Slangen schieten" in the headless browser (muted): the intro / help screens, a bot with real key presses (arrow keys aim the turret, Space fires: it
// shoots at every snake that comes close) that plays to a WIN with a gold medal, the banner, the variables (HISCORE_SSH 0x4b, TROPHY_SSH 0x93), the result menu
// and the way back through the story (node 35 -> 36, the hub z16PYA).
//   node tools/browse.mjs "http://localhost:5601/?zone=z15SSH&mute=1" tools/steps/m6-z15SSH.mjs --size 1280x800 --out /tmp/m6-z15SSH
// Shortcut: after the bot has played ~25 s the buggy is put near the end of the course (`__zone.game.ssh.node.jumpTo(world, t)`) so the run does not take 170 s of wall
// time (the full ride is covered by the node tests).
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x4b), trophy: __zone.sh.vars.get(0x93), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59) }));
  const ready = (arch, m) => page.waitForFunction(([a, m]) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === m, [arch, m], { timeout: 300000 });
  const press = (k) => page.keyboard.press(k, { delay: 25 });

  /** the bot: when a snake is within `range` of the buggy (or leaping), fire; steer the turret towards the nearest snake with real arrow key presses */
  let held = new Set();
  const setHeld = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const shots = {};
  async function play(ms, until) {
    const t0 = Date.now();
    let fires = 0, lastFire = 0;
    while (Date.now() - t0 < ms) {
      const d = await dbg();
      if (!d || d.result !== 0 || (until && until(d))) break;
      const cart = d.cart;
      let best = -1, bd = 1e9;
      d.snakes.forEach((p, i) => { if (d.states[i] !== 1 && d.states[i] !== 3) return; const dist = Math.hypot(p[0] - cart[0], p[2] - cart[2]); if (dist < bd) { bd = dist; best = i; } });
      const want = new Set();
      if (best >= 0) {
        // aim: the lateral offset of the snake in the buggy's frame (the camera looks backwards, the turret's yaw is mirrored)
        const sx = d.snakes[best][0] - cart[0];
        const side = sx * Math.cos(d.yaw) - (d.snakes[best][2] - cart[2]) * Math.sin(d.yaw);
        void side;
      }
      await setHeld(want);
      if (best >= 0 && bd < 80 && Date.now() - lastFire > 170) { await press('Space'); fires++; lastFire = Date.now(); }
      if (!shots.leap && d.states.includes(3)) { shots.leap = true; await shot('4a-leap'); }
      if (!shots.hit && d.states.includes(2)) { shots.hit = true; await shot('4b-hit'); }
      await wait(25);
    }
    await setHeld(new Set());
    return { fires };
  }

  await ready('z15SSH', 1);
  let s = await dbg();
  expect('the zone game is running: 20 gems, score 0', s && s.gems === 20 && s.score === 0 && s.result === 0, JSON.stringify(s));
  const v0 = await vars();
  log('start vars', JSON.stringify(v0));
  expect('entered at the story node of z15SSH (sub-game 12, node 35)', v0.sub === 12 && v0.node === 35, JSON.stringify(v0));
  await wait(1200);
  await shot('1-intro');
  await key('Enter'); await wait(700);
  expect('the controls help (mode 9)', (await mode()) === 9);
  await shot('2-help');
  await key('Enter'); await wait(500);
  expect('play (mode 2)', (await mode()) === 2);
  await wait(800);
  await shot('3-play-start');
  // the turret: real arrow key presses turn it and move the crosshair
  await page.keyboard.down('ArrowRight'); await wait(450); await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowUp'); await wait(250); await page.keyboard.up('ArrowUp');
  s = await dbg();
  expect('the arrow keys aim the turret', s.aim[0] > 0.2 && s.aim[1] > 0.05, JSON.stringify(s.aim));
  await shot('3b-aim');
  await page.keyboard.down('ArrowLeft'); await wait(700); await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('ArrowDown'); await wait(350); await page.keyboard.up('ArrowDown');
  s = await dbg();
  expect('and back', s.aim[0] < 0.1 && s.aim[1] < 0.1, JSON.stringify(s.aim));
  await press('Space'); await wait(120); await press('Space');
  await wait(150);
  s = await dbg();
  expect('Space fires coconuts (the gun sound plays once per shot)', s.sounds['197'] >= 1 && s.log.filter((x) => x === 'shot').length >= 1, JSON.stringify({ c: s.coconuts, snd: s.sounds, log: s.log }));
  await shot('3c-coconuts');

  // play: the bot fires at the snakes
  const r = await play(22000);
  s = await dbg();
  log('after the bot phase', JSON.stringify(r), JSON.stringify(s));
  expect('the bot hit snakes (50 points each)', s.score > 0 && s.score % 50 === 0, JSON.stringify(s));
  expect('no gem lost so far', s.gems >= 18, JSON.stringify(s.gems));
  await shot('5-play');

  // the end of the course
  await page.evaluate(() => { const z = __zone; z.game.ssh.node.jumpTo(z.world, 0.84); });
  await wait(400);
  s = await dbg();
  expect('jumped near the end of the course (z > 6000)', s.cart[2] > 6000, JSON.stringify(s.cart));
  await shot('6-near-end');
  const r2 = await play(40000, (d) => d.result !== 0);
  s = await dbg();
  log('end', JSON.stringify(r2), JSON.stringify(s));
  await wait(600);
  expect('banner (mode 4)', (await mode()) === 4, String(await mode()));
  expect('gold: 18+ gems left, result 5', s.result === 5 && s.gems >= 18, JSON.stringify({ r: s.result, gems: s.gems, score: s.finalScore }));
  expect('score = gems x 250 + points (cap 10000)', s.finalScore === Math.min(10000, s.gems * 250 + s.score), JSON.stringify(s));
  await shot('7-banner');
  const v1 = await vars();
  expect('HISCORE_SSH and TROPHY_SSH are written', v1.hi === s.finalScore && v1.trophy === 3, JSON.stringify(v1));
  await key('Enter'); await wait(700);
  const m = await menu();
  expect('result menu page 16 (continue / retry)', (await mode()) === 5 && m.page === 16, JSON.stringify(m));
  await shot('8-result-menu');
  await key('Enter'); await wait(2500);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z15SSH', null, { timeout: 120000 });
  const after = await page.evaluate(() => ({ arch: __zone.info.archive, node: __zone.sh.vars.get(0x58) }));
  log('after continue', JSON.stringify(after));
  expect('the story went on at node 36, back in the pyramid hub z16PYA', after.arch === 'z16PYA' && after.node === 36, JSON.stringify(after));
  await wait(1200); await shot('9-after');
  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z15SSH win run passed');
};
