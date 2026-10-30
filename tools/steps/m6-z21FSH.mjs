// z21FSH Fishing in the headless browser (muted): the opening cutscene (skipped with Shift), the intro / help screens, a bot with real key presses that walks to a spot,
// casts, strikes and reels in three small fish and then Big Bertha (WIN), the score panel, the end sequence (ADV11), the result menu and the way back through the story.
//   node tools/browse.mjs "http://localhost:5602/?zone=z21FSH&mute=1" tools/steps/m6-z21FSH.mjs --size 1280x800 --out /tmp/m6-z21FSH
// Shortcut used (not in the original): when the line is out and no fish bites after a while the bot moves a fish of the shoal (or Bertha) to the bobber: waiting for the
// swimming shoal to come by takes minutes of wall time (the pick / bite rules themselves are covered by the node tests).
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x38), trophy: __zone.sh.vars.get(0x88), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59), fb: __zone.sh.vars.get(0xfb), fc: __zone.sh.vars.get(0xfc), done: __zone.sh.vars.get(0x53) }));
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const ready = (m) => page.waitForFunction((m) => window.__zone && window.__zone.info.archive === 'z21FSH' && window.__zone.machine.mode === m && window.__zone.world.tickCount >= 0, m, { timeout: 300000 });
  const tap = (k, ms = 70) => page.keyboard.press(k, { delay: ms });
  const until = async (name, f, ms = 60000) => { const t0 = Date.now(); for (;;) { const d = await dbg(); if (d && f(d)) return d; if (Date.now() - t0 > ms) { log('TIMEOUT', name, JSON.stringify(d)); fail.push('timeout ' + name); return d; } await wait(40); } };
  /** the shortcut: a fish of the shoal (i) or Bertha (-1) next to the bobber */
  const bring = (i) => page.evaluate((i) => {
    const w = __zone.world, d = __zone.game.debug();
    const fish = i < 0 ? w.records[1].ctrl.nodes.find((n) => n.kind === 'Bertha').fish : w.records[2].ctrl.nodes.find((n) => n.kind === 'Shoal').fish[i];
    fish.x = d.bobber[0] + 0.5; fish.y = -1; fish.z = d.bobber[2] + 0.5;
  }, i);

  await ready(1);
  expect('the opening cutscene runs (story node 42, S252 = 1)', (await page.evaluate(() => __zone.ctx.cutscene.active())) && (await vars()).fc === 1, JSON.stringify(await vars()));
  await wait(2500); await shot('1-cutscene');
  // skip: the Shift edge ends the command that runs, so tap it until the script is over
  for (let i = 0; i < 80 && (await page.evaluate(() => __zone.ctx.cutscene.active())); i++) { await tap('Shift', 40); await wait(60); }
  expect('the cutscene is over, the brief shows (mode 1)', !(await page.evaluate(() => __zone.ctx.cutscene.active())));
  await wait(600); await shot('2-intro');
  await key('Enter'); await wait(600);
  expect('the controls help (mode 9)', (await mode()) === 9);
  await shot('3-help');
  await key('Enter'); await wait(600);
  expect('play (mode 2) in state 1 with the walk node on (fb = 1)', (await mode()) === 2 && (await dbg()).state === 1 && (await vars()).fb === 1, JSON.stringify(await vars()));
  await wait(800); await shot('4-walk');

  // ---- to a spot: Shift
  await tap('Shift');
  await until('walk to the spot', (d) => d.state === 3 || d.state === 4 || d.state === 6);
  await shot('5-walking');
  await until('ready', (d) => d.state === 6);
  let d = await dbg();
  expect('arrived at the spot, fishing mode (fb = 2), 20 casts', d.state === 6 && d.casts === 20 && (await vars()).fb === 2, JSON.stringify(d));
  await shot('6-ready');

  // ---- casting / catching
  let shots = {};
  async function fishOne(i, label) {
    await until('ready ' + label, (d) => d.state === 6);
    await wait(250);
    await tap('Control');                                        // start the cast
    d = await until('charge ' + label, (d) => d.state === 7);
    // the gauge shot is taken while the power meter runs; the release comes at power 34 (good casts are 10..60)
    const gaugeP = shots.charge ? null : (shots.charge = true, until('gauge', (d) => d.state === 7 && d.sub === 1 && d.power >= 4, 8000).then(() => shot('7-charge-gauge')));
    d = await until('power ' + label, (d) => d.state === 7 && d.sub === 1 && d.power >= 34);
    await tap('Control');                                        // release
    if (gaugeP) await gaugeP;
    d = await until('flight ' + label, (d) => d.state === 7 && (d.sub === 3 || d.sub === 4) || d.state === 8, 20000);
    if (!shots.flight) { shots.flight = true; await shot('8-flight'); }
    d = await until('landed ' + label, (d) => d.state === 8);
    if (!shots.wait) { shots.wait = true; await wait(500); await shot('9-wait'); }
    await wait(1200);
    // the shortcut (a fish next to the bobber) and the strike: the bite lasts 30 ticks (1 s), so the loop runs in the page at the frame rate and sends the DOM key events
    // the input layer reads (keydown / keyup of ArrowUp) at once
    const struck = await page.evaluate((i) => new Promise((resolve) => {
      const w = __zone.world, d0 = __zone.game.debug();
      const fish = i < 0 ? w.records[1].ctrl.nodes.find((n) => n.kind === 'Bertha').fish : w.records[2].ctrl.nodes.find((n) => n.kind === 'Shoal').fish[i];
      // the other fish are sent far away (no natural bite in the way); the chosen one swims right to the bobber
      for (const o of [...w.records[2].ctrl.nodes.find((n) => n.kind === 'Shoal').fish, w.records[1].ctrl.nodes.find((n) => n.kind === 'Bertha').fish]) if (o !== fish) { o.x = 400; o.y = -1; o.z = 400; o.approaching = false; }
      fish.x = d0.bobber[0] + 0.5; fish.y = -1; fish.z = d0.bobber[2] + 0.5;
      // the strike is decided once per game TICK (inside the input mapper's update, which the loop runs before every tick): the bite lasts 30 ticks and a loaded page runs
      // several ticks per frame, so a loop on requestAnimationFrame can miss it
      const inp = __zone.sh.input, orig = inp.update.bind(inp);
      let n = 0, hold = -1;
      inp.update = () => {
        const d = __zone.game.debug();
        if (hold < 0 && d.bite === 1) { inp.setKey('ArrowUp', true); hold = 3; }
        else if (hold > 0 && --hold === 0) { inp.setKey('ArrowUp', false); inp.update = orig; resolve(true); }
        else if (hold < 0 && ++n > 1800) { inp.update = orig; resolve(false); }   // 60 s of game time
        orig();
      };
    }), i);
    if (!struck) { log('NO BITE', label); fail.push('no bite ' + label); }
    d = await until('fight ' + label, (d) => d.state === 11, 5000);
    // reel: hold DOWN while the tension is low enough (the loop runs in the page at the game's frame rate; the key events are the DOM's keydown / keyup the input layer reads)
    const fightP = page.evaluate(() => new Promise((resolve) => {
      // (decided once per game tick, in the input mapper's update: see the strike above)
      const inp = __zone.sh.input, orig = inp.update.bind(inp);
      let down = false; const seen = new Set(); let n = 0;
      inp.update = () => {
        const d = __zone.game.debug();
        for (const p of d.popups) seen.add(p);
        if (d.state !== 11 || ++n > 60000) { if (down) inp.setKey('ArrowDown', false); inp.update = orig; resolve([...seen]); orig(); return; }
        const want = d.tension < 36;
        if (want !== down) { down = want; inp.setKey('ArrowDown', want); }
        orig();
      };
    }));
    if (!shots.fight) { shots.fight = true; await wait(250); await shot('11-fight'); }
    const out = await fightP;
    log('fight popups', JSON.stringify(out));
    return await dbg();
  }
  d = await fishOne(10, 'fish 1');
  expect('a fish was landed: score counted, back to ready (state 6)', d.count === 1 && d.total > 0 && d.state === 6, JSON.stringify({ c: d.count, t: d.total, s: d.state }));
  await shot('12-landed');
  d = await fishOne(6, 'fish 2');
  d = await fishOne(3, 'fish 3');
  expect('three fish caught', d.count === 3, JSON.stringify({ c: d.count, t: d.total }));
  // ---- Big Bertha
  d = await fishOne(-1, 'Bertha');
  await until('score panel', (d) => d.state === 13, 20000);
  d = await dbg();
  expect('Bertha caught: the score panel (state 13)', d.state === 13 && d.hooked && d.hooked.bertha, JSON.stringify(d));
  const total = d.total;
  await wait(600); await shot('13-panel');
  await tap('Enter');
  await until('end countdown', (d) => d.state === 14 || d.state === 0, 5000);
  const v = await vars();
  expect('HISCORE_FSH / TROPHY_FSH written', v.hi === total && v.trophy === (total < 4000 ? 1 : total < 7000 ? 2 : 3), JSON.stringify({ v, total }));
  await until('the end cutscene or the result', (d) => d.state === 0, 20000);
  await wait(500);
  const cs = await page.evaluate(() => __zone.ctx.cutscene.active());
  log('end cutscene active', cs); if (cs) { await shot('14-end-cutscene'); for (let i = 0; i < 80 && (await page.evaluate(() => __zone.ctx.cutscene.active())); i++) { await tap('Shift', 40); await wait(60); } }
  await page.waitForFunction(() => window.__zone.machine.mode === 5, null, { timeout: 60000 });
  const m1 = await menu();
  expect('result menu page 16 (continue / retry)', m1.page === 16, JSON.stringify(m1));
  await shot('15-result-menu');
  await key('Enter');
  for (let i = 0; i < 8; i++) { await wait(700); log('after continue', JSON.stringify(await page.evaluate(() => ({ arch: __zone.info.archive, node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59), mode: __zone.machine.mode, fc: __zone.sh.vars.get(0xfc) })))); }
  const v2 = await vars();
  expect('Continue leaves the zone: the story went on (the zone is entered again at node 44 or left for the oasis)', v2.node >= 44, JSON.stringify(v2));
  log(fail.length ? 'FAILED ' + fail.join('; ') : 'ALL OK');
};
