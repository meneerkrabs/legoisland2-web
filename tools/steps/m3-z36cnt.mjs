// z36CNT, the centrifuge, played with real key input: the intro / help, the seat belt and the start button, a perfect player (gold) through the banner and the
// result menu (Continue -> the story advances, back on the island), then a second run without any input (lost: banner, result menu page 19, retry), and the pause menu.
//   node tools/browse.mjs "http://localhost:5499/?zone=z36CNT&mute=1" tools/steps/m3-z36cnt.mjs --size 800x600 --out /tmp/m3/z36CNT
// Needs the dev server (npx vite --port 5499). Muted and headless: the keys go to the page like a keyboard would.
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const url = page.url();
  const dbg = () => page.evaluate(() => { const z = window.__zone; return z ? { mode: z.machine.mode, tick: z.world.tickCount, arch: z.info.archive, node: z.sh.vars.get(0x58), d: z.game?.debug?.() ?? null } : null; }).catch(() => null);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const until = async (cond, what, timeout = 240000) => {
    const t0 = Date.now();
    for (;;) {
      const s = await dbg();
      if (s && (await cond(s))) return s;
      if (Date.now() - t0 > timeout) throw new Error(`timeout: ${what} ${JSON.stringify(s)}`);
      await wait(40);
    }
  };
  const inZone = (s) => s && s.arch === 'z36CNT';

  // ======================================================================= run 1: intro, help, belt, start, a perfect player
  await until((s) => inZone(s) && s.mode === 1, 'intro');
  let s = await dbg();
  expect('the zone starts at story node 59 in the intro (mode 1)', s.node === 59 && s.mode === 1, JSON.stringify(s));
  await wait(400);
  await shot('1-intro');
  await key('Enter'); await wait(400);
  s = await dbg();
  expect('a key leaves the intro: the controls help (mode 9)', s.mode === 9);
  await shot('2-help');
  await key('Enter'); await wait(500);
  s = await dbg();
  expect('another key starts the game (mode 2), waiting for the seat belt (state 1)', s.mode === 2 && s.d.state === 1 && s.d.clip === 1, JSON.stringify(s.d));
  await shot('3-waiting');
  // an arrow key does nothing before the belt is fastened
  await key('ArrowLeft'); await wait(200);
  s = await dbg();
  expect('arrow keys do nothing yet', s.d.state === 1 && s.d.score === 0);
  await key('ShiftLeft');                                                   // BUTTON_3: fasten the seat belt
  await wait(250);
  s = await dbg();
  expect('Shift starts the belt clip (15)', s.d.state === 7 && s.d.clip === 15, JSON.stringify(s.d));
  await wait(1200);
  await shot('4-belt');
  const sub = await page.evaluate(() => window.__zone.ctx.subtitle()?.id ?? null);
  expect('the seat belt line (LESGCE09) is spoken / subtitled during the belt clip', sub === 'LESGCE09', String(sub));
  await until((x) => x.d.clip === 12, 'visor clip');
  await wait(700);
  await shot('5-visor');
  await until((x) => x.d.state === 2, 'state 2 (ready)');
  s = await dbg();
  expect('after the visor clip the machine waits for the start button (state 2)', s.d.state === 2 && s.d.clip === 1);
  await shot('6-ready');
  await key('ShiftLeft');                                                   // start
  await until((x) => x.d.state === 3, 'running');
  s = await dbg();
  expect('the start clip ends in the running state (3) with 60 s on the clock', s.d.state === 3 && s.d.time > 1700 && s.d.power === 0, JSON.stringify(s.d));

  // the bot: left in the top window, right in the bottom window, as soon as the latch is free
  let shots = new Set();
  const play = async () => {
    for (;;) {
      const x = await dbg();
      if (!x || x.mode !== 2 || x.d.state !== 3) return x;
      const d = x.d;
      if (d.zone === 'top' && !d.latchL) await page.keyboard.press('ArrowLeft');
      else if (d.zone === 'bottom' && !d.latchR) await page.keyboard.press('ArrowRight');
      for (const [name, c] of [['7-run-slow', d.power > 0.1 && d.power < 0.3], ['8-run-fast', d.power > 0.6 && d.power < 0.75], ['9-full-power', d.power >= 1 && d.bonus]]) {
        if (c && !shots.has(name)) { shots.add(name); await shot(name); }
      }
      await wait(8);
    }
  };
  await play();
  s = await dbg();
  log('after the run', JSON.stringify(s.d));
  expect('the time ran out: stopping (state 4) with a high score', s.d.score > 6000 || s.d.state >= 4, `score ${s.d.score}`);
  // the stop: the arm slows, then (power passed 0.75) Pepper's phew clip, then the result
  await until((x) => x.mode === 4 || x.mode === 5, 'banner', 120000);
  await wait(300);
  s = await dbg();
  expect('the banner (mode 4): result 1, gold, shown score = score', s.mode === 4 && s.d.result === 1 && s.d.medalOk && s.d.shown === s.d.score && s.d.score >= 6000, JSON.stringify(s.d));
  expect('HISCORE_CNT (0x9b) = the score, TROPHY_CNT (0x86) = 3 (gold)', s.d.hiscore === s.d.score && s.d.trophy === 3, `${s.d.hiscore} / ${s.d.trophy}`);
  await shot('10-banner-gold');
  await press('Enter'); await wait(500);
  expect('the result menu: page 16 (continue / retry)', (await menu()).page === 16);
  await shot('11-result-menu');
  await select(1); await press('Enter');                                    // Verder (continue)
  await until((x) => x.arch !== 'z36CNT' && x.mode >= 1 && x.tick >= 0, 'next zone after the win', 300000);
  s = await dbg();
  expect('Continue leaves the zone with the story advanced: node 60 = the parachute (z38PAR)', s.arch === 'z38PAR' && s.node === 60, JSON.stringify({ arch: s.arch, node: s.node }));
  const best = await page.evaluate(() => window.__zone.sh.vars.get(0x9b));
  const trophy = await page.evaluate(() => window.__zone.sh.vars.get(0x86));
  expect('the hi-score and the trophy survive the zone (vars 0x9b / 0x86)', best >= 6000 && trophy === 3, `${best} / ${trophy}`);

  // ======================================================================= run 2: pause, restart, no input at all (lost), abort to the island
  await page.goto(url, { waitUntil: 'load' });
  await until((x) => inZone(x) && x.mode === 1, 'intro of run 2');
  await key('Enter'); await wait(300); await key('Enter'); await wait(400);
  await key('ShiftLeft'); await until((x) => x.d.clip === 12 || x.d.state === 2, 'belt done 2');
  await until((x) => x.d.state === 2, 'ready 2');
  await key('ShiftLeft'); await until((x) => x.d.state === 3, 'running 2');
  await wait(2500);
  await key('Escape'); await wait(500);
  s = await dbg();
  expect('Esc pauses (mode 3) with the mini-game pause page 18', s.mode === 3 && (await menu()).page === 18, JSON.stringify({ mode: s.mode }));
  await shot('13-pause');
  const t1 = s.d.time;
  await wait(1200);
  s = await dbg();
  expect('the machine is frozen while paused', s.d.time === t1);
  await press('Escape'); await wait(500);
  s = await dbg();
  expect('Esc again resumes (mode 2)', s.mode === 2, String(s.mode));
  await key('Escape'); await wait(500);
  await select(4); await press('Enter');                                    // Opnieuw starten (restart)
  await until((x) => inZone(x) && x.mode === 1 && x.d.state <= 1, 'restart', 120000);
  s = await dbg();
  expect('restart from the pause menu re-runs the zone: fresh machine, same story node', s.node === 59 && s.d.score === 0 && s.d.time === 1800 && s.d.angle === 0, JSON.stringify(s.d));
  await key('Enter'); await wait(300); await key('Enter'); await wait(400);
  await key('ShiftLeft'); await until((x) => x.d.state === 2, 'ready 2b');
  await key('ShiftLeft'); await until((x) => x.d.state === 3, 'running 2b');
  await key('ArrowRight');                                                  // a mistimed press (right in the top window) scores nothing
  await until((x) => x.mode === 4 || x.mode === 5, 'banner of the lost run', 200000);
  await wait(300);
  s = await dbg();
  expect('no input: result 2, score 0, no hi-score', s.d.result === 2 && s.d.score === 0 && s.d.hiscore === 0 && s.d.trophy === 0, JSON.stringify(s.d));
  await shot('14-banner-lost');
  await press('Enter'); await wait(500);
  expect('the result menu of a lost game: page 19 (retry / abort)', (await menu()).page === 19);
  await shot('15-result-lost');
  await select(0); await press('Enter');                                    // Opnieuw (retry)
  await until((x) => inZone(x) && x.mode === 1, 'intro again after retry', 120000);
  s = await dbg();
  expect('retry restarts the zone: fresh game, same story node', s.node === 59 && s.d.score === 0, JSON.stringify(s.d));
  await key('Enter'); await wait(300); await key('Enter'); await wait(400);
  await key('Escape'); await wait(500);
  await select(3); await press('Enter');                                    // pause menu: Afbreken (abort, value 1)
  await until((x) => x.arch === 'z02LGI' && x.mode === 2 && x.tick > 5, 'island after the abort', 300000);
  s = await dbg();
  expect('abort leaves for the island and rewinds the story to the hub node 58 (the walk to the centrifuge starts node 59 again)', s.arch === 'z02LGI' && s.node === 58, JSON.stringify({ arch: s.arch, node: s.node }));
  await shot('16-island-after-abort');

  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z36CNT checks passed');
  if (fail.length) process.exitCode = 1;
};
