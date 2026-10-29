// M4 WP17: a bot plays era 3 of the island (story nodes 52..58, zone id 33), the two Space Port mini-games and era 4 (node 61, zone id 2) with real key input:
//   node 52 (PEPPER_CONTROL == 1): on foot (URL shortcut: arrival at the skate park) -> the era intro LGIBR08 (StartCSM on HSE2, gate 0x54 & 4 == 0)
//   node 53 (S277 == 4): StartCSM on PIZB (gate node 0x35, no waypoint) fires at once: LGI09 (the bots at the pizzeria) -> S277 = 4
//   node 54 (PAGES_SET == 15): the four Constructopedia pages PAG1..4 -> LGIBR09..12 (the 4th rebuilds the Space Port: TOWE / CTRL / PLAT / SHTL)
//   node 55 (S277 == 12): StartCSM on RADI (PATH dd, 45, de, df, dc) -> LGI10 (DJAB) -> S277 = 12
//   node 56 (COLORED_BOTHEADS == 15): the four coloured bots (thrown pizza, walk into the dazed bot)
//   node 57 (S277 == 7): StartCSM on POLB (PATH 4c, 1a3, 4b, 49, 4a) -> LGI12 (Infomaniac) -> S277 = 7
//   node 58 (S284 == 1): StartCSM on TOWE (PATH 215 INSIDESPACE, no cutscene) -> S284 = 1 -> node 59 = z36CNT (the FSM leaves the island)
//   node 59 z36CNT (centrifuge: the m3 bot's perfect player) -> node 60 z38PAR (parachute: tools/lib/par-bot.mjs) -> node 61 island era 4 (arrival at SPBT)
//   node 61 (S284 == 2): StartCSM on TOWE (PATH 216) -> LGI13 (the shuttle) -> node 62 z39ASB
//   node tools/browse.mjs "http://localhost:5489/?zone=z02LGI&node=52&mute=1&hold=1" tools/steps/m4-era3.mjs --size 1280x800 --out /tmp/wp17
// Long walks are teleports (Pepper put next to the target, facing it); the keys do the actions (walk in, Space throw, Shift skip, Enter in menus).
// Env: STOP=<phase> ends after that phase (intro, pages, radio, heads, police, tower, cnt, par, era4); FROM=cnt starts in z36CNT (URL ?zone=z36CNT&node=59&mute=1&hold=1),
//      FROM=radio starts at node 55 (URL ?zone=z02LGI&node=55&mute=1&hold=1), FROM=tower at node 58 (node=58), FROM=asb at z39ASB (zone=z39ASB&node=62), FROM=abort the two aborts (zone=z36CNT&node=59), FROM=end node 68 (node=68), FROM=era4 starts at node 61 (URL ?zone=z02LGI&node=61&mute=1&hold=1).
import { island, pathNode, teleportTo } from './lib-island.mjs';
import { parBotStep } from '../lib/par-bot.mjs';
import { apoBotStep } from '../lib/apo-bot.mjs';
import { Bot as MapBot, CODE as MAP_CODE } from '../lib/z41map-bot.mjs';
import { PLAN1 as BRP_PLAN } from '../../src/zones/z42BRP/bot-plan.ts';

const BOTS = [['BBY0', 0x8a], ['BBB0', 0x2b], ['BBG0', 0xc9], ['BBR0', 0x0f]];
const PAR_KEYS = [[4, 'ArrowUp'], [8, 'ArrowDown'], [1, 'ArrowLeft'], [2, 'ArrowRight'], [0x40, 'ShiftLeft']];

export default async (h) => {
  const { page, wait, log, shot, key } = h;
  const S = island(h);
  page.on('crash', () => console.log('[page crashed]'));
  page.on('close', () => console.log('[page closed]'));
  page.context().browser()?.on('disconnected', () => console.log('[browser disconnected]'));
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const phase = (n) => { log('--- phase', n); return process.env.STOP === n; };
  const cs = async () => { let n = 0; for (let i = 0; i < 8; i++) { n += await S.skipCutscenes(200); await wait(250); if (!(await S.state())?.cs) break; } return n; };
  const shown = (names) => page.evaluate((l) => Object.fromEntries(l.map((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return [n, r ? (r.flags & 2 ? 1 : 0) : -1]; })), names);
  const v = async (i) => (await S.vars([i]))[i];
  const zst = () => page.evaluate(() => { const z = window.__zone; return z ? { arch: z.info.archive, mode: z.machine.mode, node: z.sh.vars.get(0x58), tick: z.world.tickCount } : null; }).catch(() => null);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const waitArch = (a, ms = 300000) => page.waitForFunction((x) => window.__zone && window.__zone.info.archive === x && window.__zone.machine.mode !== 7 && window.__zone.machine.mode !== 0 && window.__zone.world.tickCount >= 0, a, { timeout: ms });
  /** put Pepper `d` units from the record on ground about level with it (tries 24 directions), facing it */
  const nearLevel = (name, d) => page.evaluate(([n, d]) => {
    const z = window.__zone, w = z.world, p = z.loaded.pepper; const r = w.records.find((x) => x.name === n);
    let best = null;
    for (let k = 0; k < 24; k++) {
      const a = k * Math.PI / 12, x = r.x + Math.sin(a) * d, zz = r.z + Math.cos(a) * d, g = w.col.groundRay(x, r.y + 20, zz);
      if (g < -1e30) continue;
      const e = Math.abs(g - (r.y - 2)); if (!best || e < best.e) best = { e, x, z: zz, g };
    }
    p.x = best.x; p.z = best.z; p.y = best.g; p.ry = Math.atan2(r.x - best.x, r.z - best.z); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
    return [best.x, best.g, best.z].map((v) => +v.toFixed(1));
  }, [name, d]);
  /** walk into a waypoint trigger: Pepper `d` units from PATH node `n` (first from Pepper's side, then from other sides), ArrowUp until a cutscene / `done` */
  const walkToNode = async (n, done, d = 12) => {
    const q = await pathNode(page, n);
    if (!q) return false;
    const p = (await S.state()).pos;
    const a0 = Math.atan2(p[0] - q[0], p[2] - q[2]);
    for (let k = 0; k < 8; k++) {
      const a = a0 + k * Math.PI / 4;
      await teleportTo(page, q[0] + Math.sin(a) * d, q[2] + Math.cos(a) * d, q[0], q[2]); await wait(300);
      await page.keyboard.down('ArrowUp');
      const ok = await S.until(async () => (await S.state())?.cs || (await done()), 4000, 40);
      await page.keyboard.up('ArrowUp');
      if (ok) return true;
    }
    return false;
  };
  // FROM=abort (URL ?zone=z36CNT&node=59&mute=1&hold=1): Afbreken in the pause menus of z36CNT and z38PAR rewinds the story to node 58 (FUN_00404d14 ->
  // FUN_00404b43: the last node of a kind-1 zone) and the island puts Pepper at CTRL (PREV_SUBGAME 0x18) / SPBT (0x19) on PATH 0xff (node < 0x3b), FUN_004c2d22
  async function abortRuns() {
    for (const [zone, node, base] of [['z36CNT', 59, 'CTRL'], ['z38PAR', 60, 'SPBT']]) {
      if (zone !== 'z36CNT') await page.goto(page.url().replace(/zone=[^&]+/, `zone=${zone}`).replace(/node=\d+/, `node=${node}`), { waitUntil: 'load' });
      await waitArch(zone);
      await page.waitForFunction(() => window.__zone.machine.mode === 1, null, { timeout: 60000 }).catch(() => {});
      await key('Enter'); await wait(500); await key('Enter'); await wait(1200);
      await key('Escape'); await wait(600);
      const m = await menu();
      for (let i = 0; i < 12 && (await menu()).item !== 3; i++) { await key('ArrowDown'); await wait(170); }
      await key('Enter');                                   // Afbreken
      await waitArch('z02LGI');
      await S.waitIsland();
      const st = await S.state(), r = await S.rec(base), path = await pathNode(page, 0xff);
      expect(`${zone}: pause menu (page ${m.page}) Afbreken -> island node 58, PREV_SUBGAME ${zone === 'z36CNT' ? 0x18 : 0x19}`, st.node === 58 && st.sub === 33 && (await v(0xa3)) === (zone === 'z36CNT' ? 0x18 : 0x19), JSON.stringify(st));
      // both cases use PATH 0xff while node < 0x3b (the Space Port, ~80 from CTRL); the record (CTRL / SPBT) only gives the facing (FUN_004c2d22 cases 0x18 / 0x19)
      expect(`${zone}: Pepper arrives on PATH 0xff (${base} gives the yaw)`, Math.hypot(st.pos[0] - path[0], st.pos[2] - path[2]) < 1, JSON.stringify([st.pos, path, r]));
      await S.start(); await cs();
      await shot(`e3-ab-${zone}`);
    }
    log(fail.length ? `FAILED: ${fail.join('; ')}` : 'aborts passed');
    if (fail.length) process.exitCode = 1;
  }

  let s;
  const from = process.env.FROM ?? '';
  const ORDER = ['', 'radio', 'tower', 'cnt', 'era4', 'asb', 'end'];
  if (from === 'abort') return abortRuns();
  if (!ORDER.includes(from)) throw new Error(`FROM=${from}?`);
  const runs = (p) => ORDER.indexOf(from) <= ORDER.indexOf(p);
  if (!from) {
    await S.waitIsland();
    s = await S.state();
    expect('island era 3 (zone id 33), node 52', s.arch === 'z02LGI' && s.sub === 33 && s.node === 52, JSON.stringify(s));
    {
      const sp = await shown(['TOWE', 'CTRL', 'PLAT', 'SHTL', 'TBOB', 'PAG1', 'PAG2', 'PAG3', 'PAG4']);
      expect('era 3 start: the Space Port (TOWE / CTRL / PLAT / SHTL) is not built yet, the 4 pages are out', sp.TOWE === 0 && sp.CTRL === 0 && sp.PLAT === 0 && sp.SHTL === 0 && sp.PAG1 + sp.PAG2 + sp.PAG3 + sp.PAG4 === 4, JSON.stringify(sp));
    }
    await S.start();
    await shot('e3-00-start');

    // ---- node 52 -> 53 -> 54: the era intro (HSE2), then LGI09 at the pizzeria (PIZB, gate node 0x35)
    if (phase('intro')) return;
    s = await S.state();
    expect('the era intro (LGIBR08) plays at once', s.cs, JSON.stringify(s));
    await cs(); await wait(500);
    await S.until(async () => (await S.state()).node === 54, 8000);
    s = await S.state();
    expect('after LGIBR08 + LGI09: walking, var 0x54 & 4, S277 = 4, node 54', s.ctrl === 1 && ((await v(0x54)) & 4) === 4 && s.s277 === 4 && s.node === 54, JSON.stringify(s));
    await shot('e3-01-node54');

    // ---- node 54: the four pages
    if (phase('pages')) return;
    for (const pg of ['PAG1', 'PAG2', 'PAG3', 'PAG4']) {
      const p0 = (await S.state()).pages;
      let got = false;
      for (let k = 0; k < 3 && !got; k++) {
        await nearLevel(pg, 10 - 2 * k); await wait(400);
        await page.keyboard.down('ArrowUp');
        got = await S.until(async () => (await S.state()).pages > p0, 4000, 30);
        await page.keyboard.up('ArrowUp');
      }
      await S.until(async () => (await S.state()).cs, 3000, 50);
      await shot(`e3-02-${pg}`);
      await cs(); await wait(800);
      s = await S.state();
      expect(`page ${pg}`, got && s.pages === p0 + 1 && s.ctrl === 1, JSON.stringify(s));
    }
    await S.until(async () => (await S.state()).node === 55, 6000);
    await cs();
    s = await S.state();
    expect('four pages: PAGES_SET = 15, node 55', s.node === 55 && (await v(0x26)) === 15, JSON.stringify(s));
    {
      // LGIBR12 hides TOWE / PLAT / CTRL / SHTL and sets the four BRICKFX_SPACE* switches; the era-3 brick set (FUN_004bf737) has no SPACESHUTTLE effect,
      // so the shuttle stays hidden until the island is loaded again (the set-up shows it from node 54 on): faithful to the original
      const names = ['TOWE', 'CTRL', 'PLAT'];
      await S.until(async () => Object.values(await shown(names)).every((x) => x === 1), 20000, 250);
      const sp = await shown([...names, 'SHTL']);
      expect('the 4th page rebuilt the Space Port (TOWE, CTRL, PLAT shown; SHTL not: no brick effect in era 3)', sp.TOWE + sp.CTRL + sp.PLAT === 3 && sp.SHTL === 0, JSON.stringify(sp));
    }
    await nearLevel('CTRL', 40); await wait(1500);
    await shot('e3-03-spaceport');
  }
  if (runs('radio')) {
    if (from) { await S.start(); await cs(); s = await S.state(); expect('start at node 55', s.node === 55 && s.ctrl === 1, JSON.stringify(s)); }

    // ---- node 55: the radio station (StartCSM on RADI, waypoints) -> LGI10 -> S277 = 12
    if (phase('radio')) return;
    let fired = await walkToNode(0xdd, async () => (await S.state()).s277 === 12);
    await wait(1200); await shot('e3-04-radio');
    await cs(); await wait(600);
    await S.until(async () => (await S.state()).node === 56, 4000);
    s = await S.state();
    expect('radio station: LGI10, S277 = 12, node 56', fired && s.s277 === 12 && s.node === 56 && s.ctrl === 1, JSON.stringify(s));

    // ---- node 56: the four coloured bot heads
    if (phase('heads')) return;
    // era 3: pizzas no longer hit (FUN_00429556 returns 0 from node 0x34); Pepper carries the ghetto blaster (GETO, var 0x22) and a bot within 24 dances
    // (BOTMUSIC FUN_00536a44); after 600 ticks of dancing with Pepper within 12 it is danced out (its var |= 0x1000000), falls over (BotHit, how -1)
    // and Pepper walks into it to collect the head
    const BIT = { BBY0: 1, BBR0: 2, BBG0: 4, BBB0: 8 };
    const botOf = (name) => page.evaluate((n) => { const z = window.__zone, r = z.world.records.find((x) => x.name === n); const hn = r?.ctrl?.nodes.find((x) => x.kind === 'BotHit'); const p = z.loaded.pepper;
      return hn ? { armed: hn.armed, dying: hn.dying, v: z.sh.vars.get(hn.var), d: Math.hypot(r.x - p.x, r.z - p.z) } : null; }, name);
    for (const [name] of BOTS) {
      if (((await v(0x8e)) & BIT[name]) !== 0) { log(name, 'already collected (it came to Pepper while she danced with another bot)'); continue; }
      let dazed = false;
      const t0 = Date.now();
      await S.teleportNear(name, 5, 0);
      while (Date.now() - t0 < 45000 && !dazed) {
        const b = await botOf(name);
        if (!b || ((await v(0x8e)) & BIT[name]) !== 0) break;
        dazed = b.armed === 0;
        if (!dazed && b.d > 9) await S.teleportNear(name, 5, 0);
        await wait(250);
      }
      if (dazed) await shot(`e3-05-${name}-dazed`);
      const h0 = await v(0x8e);
      let got = (h0 & BIT[name]) !== 0;
      for (let k = 0; k < 3 && !got; k++) {
        await S.teleportNear(name, 4, k * 2);
        await page.keyboard.down('ArrowUp');
        got = await S.until(async () => ((await v(0x8e)) & BIT[name]) !== 0, 2500, 30);
        await page.keyboard.up('ArrowUp');
      }
      expect(`bot head ${name} (danced out, walked into)`, got, `COLORED_BOTHEADS ${(await v(0x8e)).toString(16)} ${JSON.stringify(await botOf(name))}`);
      await wait(500);
      if ((await S.state()).cs) await cs();
    }
    await S.until(async () => (await S.state()).node >= 57, 5000);
    await cs();
    s = await S.state();
    // (the police trigger of node 57 may fire at once when the last bot was danced out next to the police station)
    expect('four heads: COLORED_BOTHEADS = 15, node 57', s.node >= 57 && (await v(0x8e)) === 15, JSON.stringify(s));
    await shot('e3-05-heads');

    // ---- node 57: the police station (StartCSM on POLB) -> LGI12 -> S277 = 7
    if (phase('police')) return;
    fired = (await S.state()).s277 === 7 || await walkToNode(0x4c, async () => (await S.state()).s277 === 7);
    await wait(1200); await shot('e3-06-police');
    await cs(); await wait(600);
    await S.until(async () => (await S.state()).node === 58, 4000);
    s = await S.state();
    expect('police station: LGI12, S277 = 7, node 58', fired && s.s277 === 7 && s.node === 58 && s.ctrl === 1, JSON.stringify(s));

  }
  if (runs('tower')) {
    if (from === 'tower') { await S.start(); await cs(); s = await S.state(); expect('start at node 58', s.node === 58 && s.ctrl === 1, JSON.stringify(s)); }
    // ---- node 58: the Space Port tower (StartCSM on TOWE, no cutscene) -> S284 = 1 -> z36CNT
    if (phase('tower')) return;
    const fired = await walkToNode(215, async () => (await v(0x11c)) === 1 || (await zst())?.arch !== 'z02LGI');
    await shot('e3-07-tower');
    await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z02LGI', null, { timeout: 60000 }).catch(() => {});
    s = await zst();
    expect('tower: S284 = 1, the FSM leaves for z36CNT (node 59)', fired && s?.node === 59, JSON.stringify(s));
  }

  // ---- node 59: z36CNT, the centrifuge (the perfect player of tools/steps/m3-z36cnt.mjs)
  if (runs('cnt')) {
    if (phase('cnt')) return;
    await waitArch('z36CNT');
    const dbg = () => page.evaluate(() => { const z = window.__zone; return z ? { mode: z.machine.mode, arch: z.info.archive, node: z.sh.vars.get(0x58), d: z.game?.debug?.() ?? null } : null; }).catch(() => null);
    const until = async (cond, ms = 240000) => { const t0 = Date.now(); for (;;) { const x = await dbg(); if (x && (await cond(x))) return x; if (Date.now() - t0 > ms) return null; await wait(40); } };
    await until((x) => x.arch === 'z36CNT' && x.mode === 1);
    await key('Enter'); await wait(400); await key('Enter'); await wait(500);
    await key('ShiftLeft'); await until((x) => x.d?.state === 2);
    await key('ShiftLeft'); await until((x) => x.d?.state === 3);
    await shot('e3-08-cnt');
    for (;;) {
      const x = await dbg();
      if (!x || x.mode !== 2 || x.d?.state !== 3) break;
      if (x.d.zone === 'top' && !x.d.latchL) await page.keyboard.press('ArrowLeft');
      else if (x.d.zone === 'bottom' && !x.d.latchR) await page.keyboard.press('ArrowRight');
      await wait(8);
    }
    await until((x) => x.mode === 4 || x.mode === 5, 120000);
    s = await dbg();
    expect('z36CNT won (result 1)', s?.d?.result === 1, JSON.stringify(s?.d));
    await wait(300); await key('Enter'); await wait(600);
    for (let i = 0; i < 12 && (await menu()).item !== 1; i++) { await key('ArrowDown'); await wait(170); }
    await key('Enter');
    await waitArch('z38PAR');
    s = await zst();
    expect('Continue: node 60 = z38PAR', s.arch === 'z38PAR' && s.node === 60, JSON.stringify(s));
  }

  // ---- node 60: z38PAR, the parachute (tools/lib/par-bot.mjs)
  if (runs('cnt')) {
    if (phase('par')) return;
    const dbg = () => page.evaluate(() => { const z = window.__zone; return z && z.game ? { mode: z.machine.mode, arch: z.info.archive, node: z.sh.vars.get(0x58), tick: z.world.tickCount, ...z.game.debug() } : null; }).catch(() => null);
    const held = new Set();
    const setKeys = async (mask) => {
      for (const [bit, code] of PAR_KEYS) {
        const want = (mask & bit) !== 0;
        if (want && !held.has(code)) { await page.keyboard.down(code); held.add(code); }
        if (!want && held.has(code)) { await page.keyboard.up(code); held.delete(code); }
      }
    };
    // the scripted pilot reacts with the latency of the page round trips: a lost run (result 2) is retried from the result menu (page 19, item 0 Opnieuw)
    // (a smaller viewport keeps the page round trips short enough for the pilot, as in tools/steps/m3-z38PAR.mjs)
    const vp = page.viewportSize();
    await page.setViewportSize({ width: 640, height: 480 });
    let won = false;
    for (let attempt = 0; attempt < 3 && !won; attempt++) {
      await page.waitForFunction(() => window.__zone?.info.archive === 'z38PAR' && window.__zone.machine.mode === 1, null, { timeout: 120000 }).catch(() => {});
      await wait(500); await key('Enter'); await wait(500); await key('Enter'); await wait(800);
      for (let i = 0; i < 6000; i++) {
        const x = await dbg();
        if (!x || x.mode !== 2 || x.over) break;
        await setKeys(parBotStep(x, { land: 3 }));
        await wait(40);
      }
      await setKeys(0);
      s = await dbg();
      won = s?.result === 1;
      log('z38PAR attempt', attempt, JSON.stringify({ score: s?.score, result: s?.result }));
      await page.waitForFunction(() => window.__zone.machine.mode === 4 || window.__zone.machine.mode === 5, null, { timeout: 30000 }).catch(() => {});
      await wait(900); await key('Enter'); await wait(700);
      if (won) { await shot('e3-08-par-won'); await key('Enter'); }
      else { for (let i = 0; i < 12 && (await menu()).item !== 0; i++) { await key('ArrowUp'); await wait(170); } await key('Enter'); }
    }
    expect('z38PAR won (result 1)', won, JSON.stringify({ score: s?.score, result: s?.result }));
    await page.setViewportSize(vp);
    await waitArch('z02LGI');
  }

  // ---- node 61: island era 4 (zone id 2), arrival at SPBT (PREV_SUBGAME z38PAR)
  if (runs('era4')) {
    if (phase('era4')) return;
    await S.waitIsland();
    s = await S.state();
    const arr = await page.evaluate(() => window.__zone.game.debug().arrival);
    expect('island era 4 (zone id 2), node 61', s.arch === 'z02LGI' && s.sub === 2 && s.node === 61, JSON.stringify(s));
    if (from !== 'era4') {
      const sp = await S.rec('SPBT');
      expect('arrival from z38PAR next to SPBT (PREV_SUBGAME 0x19, PATH 0x18e)', (await v(0xa3)) === 0x19 && Math.hypot(s.pos[0] - sp.x, s.pos[2] - sp.z) < 40, JSON.stringify([s.pos, sp, arr]));
    }
    await S.start();
    await cs();
    await shot('e3-09-era4');
    {
      const sp = await shown(['TOWE', 'CTRL', 'PLAT', 'SHTL']);
      expect('era 4: the Space Port with the shuttle stands (set-up)', Object.values(sp).every((x) => x === 1), JSON.stringify(sp));
    }
    const fired = await walkToNode(216, async () => (await v(0x11c)) === 2);
    await wait(1500); await shot('e3-10-shuttle');
    await cs();
    await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z02LGI', null, { timeout: 60000 }).catch(() => {});
    s = await zst();
    expect('node 61: TOWE -> LGI13, S284 = 2, the FSM leaves for z39ASB (node 62)', fired && s?.node === 62 && s?.arch === 'z39ASB', JSON.stringify(s));
  }

  // ---- nodes 62..67: z39ASB (test aid F9 = the shuttle at the finish), z40aPO (tools/lib/apo-bot.mjs), z40OGL (stub, F9), z41MAP (tools/lib/z41map-bot.mjs),
  //      z42BRP (stub, F9) -> the outro movie (node 67) -> credits -> island node 68
  if (runs('asb')) {
    if (phase('asb')) return;
    const continueMenu = async () => {
      await page.waitForFunction(() => window.__zone && (window.__zone.machine.mode === 4 || window.__zone.machine.mode === 5), null, { timeout: 600000 });
      await wait(1000); await key('Enter'); await wait(700);
      for (let i = 0; i < 12 && (await menu()).item !== 1; i++) { await key('ArrowDown'); await wait(170); }
      const m = await menu();
      await key('Enter');
      return m;
    };
    const held = new Set();
    const setKeys = async (mask, table) => {
      for (const [bit, code] of table) {
        const want = (mask & bit) !== 0;
        if (want && !held.has(code)) { await page.keyboard.down(code); held.add(code); }
        if (!want && held.has(code)) { await page.keyboard.up(code); held.delete(code); }
      }
    };
    const visited = [];
    let outro = false, creditsShot = false, brpPorted = false;
    const t0 = Date.now();
    for (let i = 0; Date.now() - t0 < 1200000; i++) {
      const z = await Promise.race([
        page.evaluate(() => ({ arch: window.__zone?.info.archive, mode: window.__zone?.machine.mode, node: window.__zone?.sh.vars.get(0x58), movie: !!document.querySelector('.le2-movie') })).catch(() => ({})),
        new Promise((r) => setTimeout(() => r({ hung: true }), 20000)),
      ]);
      if (z.hung) { log('the page does not answer (20 s)'); continue; }
      if (process.env.DEBUG) log('loop', i, JSON.stringify(z));
      if (z.movie) { outro = true; await key('Space'); await wait(800); continue; }
      if (z.arch === 'z02LGI' && i > 0) break;
      if (outro && !creditsShot) { creditsShot = true; await wait(1500); await shot('e3-12-credits'); }
      if (z.arch && visited.at(-1) !== `${z.arch}:${z.node}`) { visited.push(`${z.arch}:${z.node}`); log('zone', z.arch, 'node', z.node, 'mode', z.mode); await shot(`e3-11-${z.arch}`); }
      if (outro && z.arch !== 'z02LGI') { await key('Enter'); await wait(1000); continue; }     // the credits after the outro movie (the front end stage): a key ends them
      if (!z.arch || z.mode === 7 || z.mode === 0) { await wait(500); continue; }
      if (z.mode === 3) { await key('Escape'); await wait(500); continue; }
      if (z.mode === 1 || z.mode === 9 || z.mode === 10) { await key('Enter'); await wait(500); continue; }
      if (z.mode === 4 || z.mode === 5) { await continueMenu(); await wait(1500); continue; }
      if (z.mode !== 2) { await wait(300); continue; }
      if (z.arch === 'z39ASB') { await key('F9'); await wait(800); continue; }
      if (z.arch === 'z40aPO') {
        const dbg = () => page.evaluate(() => { const zz = window.__zone; return zz && zz.game ? { mode: zz.machine.mode, ...zz.game.debug() } : null; }).catch(() => null);
        for (let k = 0; k < 120 && (await dbg())?.cutscene; k++) { await page.keyboard.down('ShiftLeft'); await wait(70); await page.keyboard.up('ShiftLeft'); await wait(70); }
        if ((await dbg())?.mode !== 2) continue;
        const T = [[4, 'ArrowUp'], [8, 'ArrowDown'], [1, 'ArrowLeft'], [2, 'ArrowRight'], [0x40, 'ShiftLeft']];
        for (let k = 0; k < 9000; k++) { const d = await dbg(); if (!d || d.mode !== 2 || d.over) break; await setKeys(apoBotStep(d, { land: 3 }), T); await wait(30); }
        await setKeys(0, [[4, 'ArrowUp'], [8, 'ArrowDown'], [1, 'ArrowLeft'], [2, 'ArrowRight'], [0x40, 'ShiftLeft']]);
        const d = await dbg();
        expect('z40aPO won (result 1)', d?.result === 1, JSON.stringify({ score: d?.score, result: d?.result }));
        continue;
      }
      if (z.arch === 'z41MAP') {
        const bot = new MapBot('win', { latency: 2 });
        const T = Object.entries(MAP_CODE).map(([b, c]) => [+b, c]);
        for (let k = 0; k < 40000; k++) {
          const g = await page.evaluate(() => { const zz = window.__zone; return zz && zz.info.archive === 'z41MAP' && zz.machine.mode === 2 ? zz.game.debug() : null; }).catch(() => null);
          if (!g) break;
          if (k % 500 === 0) { log('z41MAP play', k, JSON.stringify({ result: g.result, papa: g.papa && { level: g.papa.level, state: g.papa.state, score: g.papa.score } })); await shot(`e3-11-z41MAP-${k}`); }
          await setKeys(bot.step(g), T); await wait(12);
        }
        await setKeys(0, Object.entries(MAP_CODE).map(([b, c]) => [+b, c]));
        log('z41MAP', JSON.stringify(await zst()));
        continue;
      }
      if (z.arch === 'z42BRP' && (await page.evaluate(() => !!window.__zone.game)) && !process.env.BRP) {
        // z42BRP is ported (M6, tools/steps/m6-z42BRP.mjs plays it to the outro, the credits and node 68); its in-page bot is slow headless: the arc ends here
        // unless BRP=1; the end of the game is checked with FROM=end (URL ?zone=z02LGI&node=68)
        brpPorted = true;
        break;
      }
      if (z.arch === 'z42BRP' && (await page.evaluate(() => !!window.__zone.game))) {
        // the ported palace (M6): the bot of tools/steps/m6-z42BRP.mjs (the recorded side run, the look-ahead bot on the roof) through the input mapper
        if (!(await page.evaluate(() => !!window.__bot))) {
          await page.evaluate(async (plan) => {
            const zz = window.__zone, w = zz.world, inp = zz.sh.input;
            const bot = await import('/src/zones/z42BRP/bot.ts');
            const nodes = await import('/src/zones/z42BRP/nodes.ts');
            const codes = { 1: 'ArrowLeft', 2: 'ArrowRight', 4: 'ArrowUp', 8: 'ArrowDown', 0x20: 'AltLeft', 0x80: 'Space', 0x10: 'ControlLeft' };
            const flat = [];
            for (const [m, n] of plan) for (let k = 0; k < n; k++) flat.push(m);
            const St = nodes.stateOf(w);
            const B = window.__bot = { mask: 0, p2: null };
            const orig = inp.update.bind(inp);
            inp.update = () => {
              let mask = 0;
              if (zz.machine.mode === 2) {
                const t = w.tickCount;
                if (w.vars.get(0xfa) === 1) mask = t >= 16 ? (flat[t - 16] ?? 0) : 0;
                else if (St.endState === 0) { B.p2 ??= new bot.Phase2Bot(w, new nodes.ZoneLoop()); mask = B.p2.step(); }
              }
              for (const [bit, code] of Object.entries(codes)) inp.setKey(code, (mask & +bit) !== 0);
              B.mask = mask;
              orig();
            };
          }, BRP_PLAN);
          log('z42BRP: the M6 bot plays the palace');
        }
        await wait(500);
        continue;
      }
      await key('F9'); await wait(900);
    }
    log('zones', visited.join(' '));
    const first = +(visited[0] ?? ':62').split(':')[1];
    const arc = ['z39ASB:62', 'z40aPO:63', 'z40OGL:64', 'z41MAP:65', 'z40OGL:66', 'z42BRP:67'].filter((x) => +x.split(':')[1] >= first);
    expect(`the Ogel arc ran ${arc.join(' ')}`, arc.every((x) => visited.includes(x)), visited.join(' '));
    if (brpPorted) { log('z42BRP (node 67) reached: the ported palace is played by tools/steps/m6-z42BRP.mjs (BRP=1 runs its bot here)'); return finish(); }
    expect('the outro movie played after z42BRP', outro);
  }

  // ---- node 68: the end of the game: free roam on the island (era 4 code, zone id 2), NS_OFF never completes
  if (runs('end')) {
    if (phase('end')) return;
    await S.waitIsland();
    await S.start();
    await cs();
    s = await S.state();
    expect('node 68: island zone id 2, walking', s.arch === 'z02LGI' && s.node === 68 && s.sub === 2 && s.ctrl === 1, JSON.stringify(s));
    const d = await page.evaluate(() => { const z = window.__zone, h = z.hud; return { dbg: z.game.debug(), hud: { left: h.leftText, centre: h.centreText, right: h.rightText, lt: h.left?.tex, rt: h.right?.tex, col: h.column?.map((c) => c.tex) } }; });
    log('node 68', JSON.stringify(d));
    await shot('e3-12-node68');
    // walk around: the story stays at 68
    await S.teleportNear('PIZB', 30, 1); await S.hold('ArrowUp', 2500);
    await S.teleportNear('TOWE', 40, 2); await S.hold('ArrowUp', 1500);
    await wait(1000);
    s = await S.state();
    expect('node 68 stays (free roam)', s.node === 68 && !s.cs, JSON.stringify(s));
    await shot('e3-13-roam');
  }
  return finish();
  function finish() {
    log(fail.length ? `FAILED: ${fail.join('; ')}` : 'era 3 passed');
    if (fail.length) process.exitCode = 1;
  }
};
