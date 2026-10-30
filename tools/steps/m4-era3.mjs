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
//   node tools/browse.mjs "http://localhost:5489/?zone=z02LGI&node=52&mute=1&debug=1&hold=1" tools/steps/m4-era3.mjs --size 1280x800 --out /tmp/wp17
// Long walks are teleports (Pepper put next to the target, facing it); the keys do the actions (walk in, Space throw, Shift skip, Enter in menus).
// Env: STOP=<phase> ends after that phase (intro, pages, radio, heads, police, tower, cnt, par, era4); FROM=cnt starts in z36CNT (URL ?zone=z36CNT&node=59&mute=1&hold=1),
//      FROM=pages starts after the landing of the full story (island era 3, node 53 / 54: the cutscenes of the arrival are skipped first), FROM=radio starts at node 55 (URL ?zone=z02LGI&node=55&mute=1&hold=1), FROM=tower at node 58 (node=58), FROM=asb at z39ASB (zone=z39ASB&node=62), FROM=abort the two aborts (zone=z36CNT&node=59), FROM=end node 68 (node=68), FROM=era4 starts at node 61 (URL ?zone=z02LGI&node=61&mute=1&hold=1).
import { island, pathNode, teleportTo } from './lib-island.mjs';
import { makeRunner, installStoryTrace, playMini } from './lib-story.mjs';
import { ogelArc } from './lib-ogelarc.mjs';

const BOTS = [['BBY0', 0x8a], ['BBB0', 0x2b], ['BBG0', 0xc9], ['BBR0', 0x0f]];
const D = new URL('.', import.meta.url).pathname;

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
  const ORDER = ['', 'pages', 'radio', 'tower', 'cnt', 'era4', 'asb', 'end'];
  if (from === 'abort') return abortRuns();
  if (!ORDER.includes(from)) throw new Error(`FROM=${from}?`);
  const runs = (p) => ORDER.indexOf(from) <= ORDER.indexOf(p);
  if (!from || from === 'pages') {
    if (from === 'pages') {
      // the full story lands the helicopter (tools/steps/m4-era2.mjs, tail): node 53 (LGI09 fires at once at the pizzeria trigger) -> node 54
      await S.start(); await cs(); await wait(500);
      await S.until(async () => (await S.state()).node === 54, 8000);
      s = await S.state();
      expect('after the landing + LGI09: walking, var 0x54 & 4, S277 = 4, node 54', s.ctrl === 1 && s.s277 === 4 && s.node === 54, JSON.stringify(s));
      await shot('e3-01-node54');
    } else {
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
    }

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
    // (waits are counted in game ticks, not wall time: 600 ticks of dancing take 20 s of game time, and a loaded page runs slower than 30 ticks per second)
    for (const [name] of BOTS) {
      if (((await v(0x8e)) & BIT[name]) !== 0) { log(name, 'already collected (it came to Pepper while she danced with another bot)'); continue; }
      let dazed = false;
      await S.teleportNear(name, 5, 0);
      for (let round = 0; round < 6 && !dazed; round++) {
        // dance for up to 900 ticks with Pepper next to the bot (re-placed when the bot wanders off: it walks its own route, Pepper must stay within 12)
        dazed = await S.untilTicks(async () => {
          const b = await botOf(name);
          if (!b || ((await v(0x8e)) & BIT[name]) !== 0) return true;
          if (b.armed === 0) return true;
          if (b.d > 9) await S.teleportNear(name, 5, 0);
          return false;
        }, 900, 100);
      }
      const b1 = await botOf(name);
      dazed = dazed && (!b1 || b1.armed === 0 || ((await v(0x8e)) & BIT[name]) !== 0);
      if (dazed) await shot(`e3-05-${name}-dazed`);
      const h0 = await v(0x8e);
      let got = (h0 & BIT[name]) !== 0;
      for (let k = 0; k < 4 && !got; k++) {
        await S.teleportNear(name, 4, k * 2);
        await page.keyboard.down('ArrowUp');
        got = await S.untilTicks(async () => ((await v(0x8e)) & BIT[name]) !== 0, 90, 30);
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

  // ---- node 59: z36CNT, the centrifuge (tools/steps/m3-z36cnt.mjs: the perfect player; stopped when the zone is left) and node 60: z38PAR, the parachute
  //      (tools/steps/m3-z38PAR.mjs: the page-side pilot, decided inside the page every 4 ms: a pilot that decides in this process loses runs when the machine is loaded)
  if (runs('cnt')) {
    if (phase('cnt')) return;
    const R = makeRunner(h, { allowGoto: false });
    await R.arm();
    await waitArch('z36CNT');
    let r = await playMini(R, h, { file: D + 'm3-z36cnt.mjs', zone: 'z36CNT', label: 'z36CNT', ms: 20 * 60000 });
    expect('z36CNT won through the result menu (Continue)', r.ok, r.fails.join(' | '));
    await waitArch('z38PAR');
    s = await zst();
    expect('Continue: node 60 = z38PAR', s.arch === 'z38PAR' && s.node === 60, JSON.stringify(s));
    if (phase('par')) return;
    r = await playMini(R, h, { file: D + 'm3-z38PAR.mjs', zone: 'z38PAR', label: 'z38PAR', ms: 20 * 60000 });
    expect('z38PAR won through the result menu (Continue)', r.ok, r.fails.join(' | '));
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

  // ---- nodes 62..67: the Ogel arc (tools/steps/lib-ogelarc.mjs: z39ASB, z40aPO, z40OGL, z41MAP, z40OGL, z42BRP with their own win bots, the outro movie, the island at node 68)
  if (runs('asb')) {
    if (phase('asb')) return;
    const R = makeRunner(h, { allowGoto: false });
    await R.arm();
    await installStoryTrace(page);
    const r = await ogelArc(h, R, { fromNode: process.env.FROM === 'asb' ? 62 : 62, stamp: () => '' });
    expect('the Ogel arc ran z39ASB:62 z40aPO:63 z40OGL:64 z41MAP:65 z40OGL:66 z42BRP:67 and ended in the island at node 68', r.ok, r.fails.join(' || '));
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
