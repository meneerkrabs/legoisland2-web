// M5 audit run of the story part of z41MAP: copy of the M3 step, run against the audit's snapshot server: sh tools/m5-botslot.sh node tools/browse.mjs 'http://localhost:5514/?zone=z41MAP&mute=1' tools/steps/m5-z41MAP.mjs --size 1280x800 --out /tmp/m5-z41MAP
// z41MAP "Pizza making" in the browser (headless, muted): intro + help, a bot with real key input plays a WIN (medal, trophy, banner, result menu "continue",
// story advances to the Ogel hub z40OGL) and then a LOSS (wrong toppings only: no medal, banner text, result menu "retry / abort", abort rewinds to the hub).
//   node tools/browse.mjs "http://localhost:5499/?zone=z41MAP&mute=1" tools/steps/m3-z41MAP.mjs --size 1280x800 --out /tmp/m3/z41MAP
// The game runs in real time (30 ticks per second): a win takes about two minutes, the loss as long. Reads `window.__zone.game.debug()` (snapshot of the zone state).
import { Bot, CODE } from '../lib/z41map-bot.mjs';

export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const dbg = () => page.evaluate(() => { const z = window.__zone; return z ? { mode: z.machine.mode, arch: z.info.archive, tick: z.world.tickCount, node: z.sh.vars.get(0x58), g: z.game ? z.game.debug() : null } : null; });
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const ready = (arch, mode) => page.waitForFunction(([a, m]) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === m && window.__zone.world.tickCount >= 0, [arch, mode], { timeout: 300000 });
  const arrived = (arch) => page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 5, arch, { timeout: 300000 });

  /** hold the buttons of `mask` with the page keyboard (only the differences are sent) */
  const down = new Set();
  const hold = async (mask) => {
    const want = new Set(Object.entries(CODE).filter(([bit]) => mask & +bit).map(([, c]) => c));
    for (const c of [...down]) if (!want.has(c)) { await page.keyboard.up(c); down.delete(c); }
    for (const c of want) if (!down.has(c)) { await page.keyboard.down(c); down.add(c); }
  };

  /** play with the bot until the zone reaches the end banner (mode 4); screenshots of the interesting moments */
  const play = async (mode, tag) => {
    const bot = new Bot(mode, { latency: 2 });
    const t0 = Date.now();
    const shots = { fly: false, layers: false, deliver: false, hit: false, round2: false };
    let s;
    for (;;) {
      s = await dbg();
      if (!s) { await wait(50); continue; }
      if (s.mode === 4 || s.mode === 5 || s.arch !== 'z41MAP') break;
      if (Date.now() - t0 > 420000) { fail.push(`${tag}: timeout`); break; }
      const g = s.g;
      if (g && g.papa) {
        if (!shots.fly && g.toppings?.some((t) => t[0] === 2 && t[1] === 1 && t[3] >= 22)) { shots.fly = true; await shot(`${tag}-fly`); }   // in the air, past Pepper's body
        if (!shots.layers && g.papa.layers) { shots.layers = true; await shot(`${tag}-layers`); }
        if (!shots.hit && g.log?.includes('papa')) { shots.hit = true; await shot(`${tag}-papahit`); }
        if (!shots.deliver && g.papa.state === 7) { shots.deliver = true; await shot(`${tag}-deliver`); }
        if (!shots.round2 && g.papa.level === 1 && g.papa.state === 2) { shots.round2 = true; await shot(`${tag}-round2`); }
      }
      await hold(g ? bot.step(g) : 0);
      await wait(12);
    }
    await hold(0);
    return { s, ms: Date.now() - t0 };
  };

  // ---- entry: the story's first visit (node 65), intro line, controls help
  await ready('z41MAP', 1);
  let s = await dbg();
  expect('z41MAP runs at story node 65 (the zone after the Ogel hub)', s.node === 65, JSON.stringify({ node: s.node, arch: s.arch }));
  await wait(500);
  await shot('1-intro');
  expect('intro: the zone game is registered with its introId', await page.evaluate(() => window.__zone.game.introId === 'OGSGMP14' && window.__zone.game.helpControls === 7));
  await key('Enter'); await wait(700);
  expect('help screen (mode 9)', (await dbg()).mode === 9);
  await shot('2-help');
  await key('Enter');
  await arrived('z41MAP');
  s = await dbg();
  expect('play starts (mode 2), HUD visible', s.mode === 2 && s.g.hudMode === 2, JSON.stringify(s.g.queue));
  await wait(2500);
  await shot('3-start');
  const hud0 = await page.evaluate(() => { const h = window.__zone.hud; return { left: h.leftText, centre: h.centreText, tex: h.left.tex, column: h.column.map((c) => c.tex) }; });
  expect('HUD: five rounds left, score 0, pizza icon 8', hud0.left === '5' && hud0.centre === '0' && hud0.tex === 8, JSON.stringify(hud0));

  // ---- pause menu (page 18) and restart: the zone is rebuilt (new nodes, score 0)
  await wait(3000);
  const before = await dbg();
  await key('Escape'); await wait(600);
  expect('pause menu page 18 in the game', (await menu()).page === 18, JSON.stringify(await menu()));
  await shot('4-pause');
  for (let i = 0; i < 12 && (await menu()).item !== 4; i++) { await key('ArrowDown'); await wait(170); }
  await key('Enter');                           // Opnieuw starten
  await ready('z41MAP', 1);
  s = await dbg();
  expect('restart: a fresh run (attempt 1, round 1, score 0, nobody in the queue yet)', (await page.evaluate(() => window.__zone.ctx.attempt)) === 1 && s.g.papa.level === 0 && s.g.papa.score === 0 && s.g.queue.every((q) => q === 0) && s.tick < before.tick, JSON.stringify({ tick: s.tick, before: before.tick, q: s.g.queue }));
  await key('Enter'); await wait(500); await key('Enter');
  await arrived('z41MAP');
  await wait(500);

  // ---- the WIN
  const w = await play('win', 'win');
  s = w.s;
  log(`win: ${(w.ms / 1000).toFixed(0)} s, mode ${s.mode}, score ${s.g.papa.score}, medal ${s.g.papa.medal}, result ${s.g.result}`);
  expect('WIN: the end banner opens with result 1 and a medal', s.mode === 4 && s.g.result === 1 && s.g.papa.medal >= 1, JSON.stringify({ mode: s.mode, result: s.g.result, medal: s.g.papa.medal }));
  const vars = await page.evaluate(() => ({ trophy: __shell.vars.get(0x3f), hi: __shell.vars.get(0xda) }));
  expect('WIN: TROPHY_MAP = medal, HISCORE_MAP = score', vars.trophy === s.g.papa.medal && vars.hi === s.g.papa.score, JSON.stringify(vars));
  await wait(1500);
  await shot('win-banner');
  await key('Enter'); await wait(700);
  expect('then the result menu page 16 (continue / retry)', (await menu()).page === 16, JSON.stringify(await menu()));
  await shot('win-menu');
  await key('Enter');                          // Verder (continue)
  await arrived('z40OGL');
  s = await dbg();
  expect('WIN -> continue: the story advanced to node 66 in the Ogel hub', s.arch === 'z40OGL' && s.node === 66, JSON.stringify({ arch: s.arch, node: s.node }));
  await shot('win-hub');

  // ---- the LOSS: back into the zone (the story node is 66 now, so go to the zone again through the URL: a fresh run at node 65)
  await page.goto(page.url(), { waitUntil: 'load' });
  await ready('z41MAP', 1);
  await key('Enter'); await wait(500); await key('Enter');
  await arrived('z41MAP');
  await wait(1000);
  const l = await play('lose', 'loss');
  s = l.s;
  log(`loss: ${(l.ms / 1000).toFixed(0)} s, mode ${s.mode}, score ${s.g.papa.score}, medal ${s.g.papa.medal}, result ${s.g.result}`);
  expect('LOSS: the end banner opens with result 2 and no medal', s.mode === 4 && s.g.result === 2 && s.g.papa.medal === 0 && s.g.papa.score < 2501, JSON.stringify({ mode: s.mode, result: s.g.result, score: s.g.papa.score }));
  await wait(1500);
  await shot('loss-banner');
  await key('Enter'); await wait(700);
  expect('then the result menu page 19 (retry / abort)', (await menu()).page === 19, JSON.stringify(await menu()));
  await shot('loss-menu');
  // select "Afbreken" (the second item) and confirm
  for (let i = 0; i < 6 && (await menu()).item !== 2; i++) { await key('ArrowDown'); await wait(200); }
  await key('Enter');
  await arrived('z40OGL');
  s = await dbg();
  expect('LOSS -> abort: the story rewinds to the Ogel hub (node 64)', s.arch === 'z40OGL' && s.node === 64, JSON.stringify({ arch: s.arch, node: s.node }));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z41MAP checks passed');
  if (fail.length) process.exitCode = 1;
};
