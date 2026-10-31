// z42BRP, the other ending (headless, muted): there is no "lost" result in this zone, only falls: real arrow keys run Pepper off the first gap of the tower (the side run restarts),
// the recorded run then takes her up and the roof is left alone (the bots knock her off the back, the floor falls away, the hit counter resets), the pause menu restarts the zone
// (a fresh run: the clock starts again) and abandons it (the story rewinds to the Ogel hub, node 66).
//   node tools/browse.mjs "http://localhost:5612/?zone=z42BRP&mute=1" tools/steps/m6-z42BRP-loss.mjs --size 1280x800 --out /tmp/m6-z42BRP
import { PLAN1, PLAN1_START } from '../../src/zones/z42BRP/bot-plan.ts';

export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const dbg = () => page.evaluate(() => { const z = window.__zone; return z ? { mode: z.machine.mode, arch: z.info.archive, tick: z.world.tickCount, node: z.sh.vars.get(0x58), attempt: z.ctx.attempt, g: z.game ? z.game.debug() : null } : null; });
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  // the pause menu's restart / abort go through the confirm page (0x14: Annuleren, OK; src/shell/menu.ts case 9): choose OK
  const confirm = async () => {
    await wait(500);
    const m = await menu();
    if (m.open && m.page === 0x14) { for (let i = 0; i < 6 && (await menu()).item !== 2; i++) await press('ArrowDown'); await shot('confirm'); await key('Enter'); }
  };
  const start = async () => {
    await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z42BRP' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
    await wait(400); await key('Enter'); await wait(500); await key('Enter');
    await page.waitForFunction(() => window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 3, null, { timeout: 60000 });
  };
  await start();
  let s = await dbg();
  expect('a new run: phase 1, restarts 0, clock near 0', s.g.phase === 1 && s.g.restarts === 0 && s.g.elapsed < 200, JSON.stringify({ phase: s.g.phase, elapsed: s.g.elapsed }));

  // ---- real keys: run left into the first gap (a fall of a few seconds, then the run starts again)
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(() => window.__zone.game.debug().restarts >= 1, null, { timeout: 60000 });
  await page.keyboard.up('ArrowLeft');
  await wait(300);
  s = await dbg();
  expect('the fall off the tower restarts the climb (Pepper at the start again, clock still running)', s.g.restarts >= 1 && s.g.pepper.y < 8 && s.g.elapsed > 150, JSON.stringify({ restarts: s.g.restarts, pepper: s.g.pepper, elapsed: s.g.elapsed }));
  await shot('1-restart');

  // ---- pause: restart (a fresh run), then the recorded run takes her up; on the roof nothing is done
  await key('Escape'); await wait(600);
  expect('pause menu page 18', (await menu()).page === 18, JSON.stringify(await menu()));
  await select(4); await shot('2-pause-restart'); await key('Enter'); await confirm();                 // Opnieuw starten
  await start();
  s = await dbg();
  expect('restart: a fresh run (attempt 1, phase 1, clock reset, no restarts or falls)', s.attempt === 1 && s.g.phase === 1 && s.g.elapsed < 200 && s.g.restarts === 0 && s.g.falls === 0, JSON.stringify({ attempt: s.attempt, phase: s.g.phase, elapsed: s.g.elapsed }));
  await page.evaluate(async ([plan, start]) => {
    const z = window.__zone, w = z.world, inp = z.sh.input;
    const codes = { 1: 'ArrowLeft', 2: 'ArrowRight', 4: 'ArrowUp', 8: 'ArrowDown', 0x20: 'AltLeft', 0x80: 'Space', 0x10: 'ControlLeft' };
    const flat = [];
    for (const [m, n] of plan) for (let i = 0; i < n; i++) flat.push(m);
    const B = window.__bot = { off: false };
    const orig = inp.update.bind(inp);
    inp.update = () => {
      let mask = 0;
      if (!B.off && z.machine.mode === 2 && w.vars.get(0xfa) === 1) { const t = w.tickCount; mask = t >= start ? (flat[t - start] ?? 0) : 0; }
      // only drive the keys while the bot plays (mode 2), and release them once when it stops: else the menu's arrow taps of the steps are wiped before they are sampled
      const driving = !B.off && z.machine.mode === 2;
      if (driving || B.drove) for (const [bit, code] of Object.entries(codes)) inp.setKey(code, (mask & +bit) !== 0);
      B.drove = driving;
      orig();
    };
  }, [PLAN1, PLAN1_START]);
  await page.waitForFunction(() => window.__zone.machine.mode === 10, null, { timeout: 240000 });
  await shot('3-help2');
  await key('Enter');
  await page.waitForFunction(() => window.__zone.machine.mode === 2, null, { timeout: 30000 });
  await page.evaluate(() => { window.__bot.off = true; });
  const t1 = Date.now();
  let shotFall = false;
  for (;;) {
    s = await dbg();
    if (s.mode !== 2) break;
    if (!shotFall && s.g.top && s.g.top.fall > 4) { shotFall = true; await shot('4-falling'); }
    if (s.g.falls >= 2 || Date.now() - t1 > 90000) break;
    await wait(200);
  }
  s = await dbg();
  expect('on the roof: the floor and the bots make her fall, the game goes on', s.mode === 2 && s.g.falls >= 1 && s.g.hits === 0 && s.g.endState === 0, JSON.stringify({ mode: s.mode, falls: s.g.falls, hits: s.g.hits, restarts: s.g.restarts }));
  expect('the clock kept running', s.g.elapsed > 1500, `${s.g.clock}`);
  await shot('5-roof-after-fall');

  // ---- pause again: abandon
  await key('Escape'); await wait(600);
  // (under heavy machine load a tap can fall between two ticks: re-select and press again while the pause page is still up)
  for (let tries = 0; tries < 3; tries++) {
    await select(3); if (tries === 0) await shot('6-pause-abort');
    await key('Enter'); await confirm();                    // Afbreken
    await wait(800);
    const m = await menu().catch(() => null);
    if (!m || !m.open || m.page !== 18) break;
    log('the pause page is still open, again', JSON.stringify(m));
  }
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z40OGL' && window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 5, null, { timeout: 300000 });
  s = await dbg();
  expect('abort: the story rewinds to the Ogel hub at node 66 (to the palace)', s.arch === 'z40OGL' && s.node === 66, JSON.stringify({ arch: s.arch, node: s.node }));
  await shot('7-hub');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z42BRP loss / abort run passed');
  if (fail.length) process.exitCode = 1;
};
