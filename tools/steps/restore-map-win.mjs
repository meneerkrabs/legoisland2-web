// Restored content 'cues' (z41MAP, `map-medal` = sound id 0x1dc): the WIN of tools/steps/m3-z41MAP.mjs only (no pause / restart, no loss). Run through restore-ids.mjs to log the sound ids:
//   STEP=tools/steps/restore-map-win.mjs IDS=476 sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5771/?zone=z41MAP&mute=1&restored=1" tools/steps/restore-ids.mjs --size 800x600 --out /tmp/restore-ids/map
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

  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z41MAP win checks passed');
};
