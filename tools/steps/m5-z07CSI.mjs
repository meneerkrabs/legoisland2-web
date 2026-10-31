// M5 z07CSI, the castle chapter: a headless bot with REAL key input plays the hub's part of story nodes 15 .. 29 (arrival by boat -> the landing cutscene -> the bridge -> [z08BKD] -> ...).
// Phases are selected with PHASE (default: all that exist). Port of the server: CSI_PORT (default 5518).
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5518/?zone=z07CSI&node=15&mute=1&hold=1&debug=1" tools/steps/m5-z07CSI.mjs --size 1280x800 --out /tmp/m5-z07CSI
import { csi, url } from './lib-z07CSI.mjs';
export default async (h) => {
  const { page, wait, log } = h;
  const S = csi(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await page.goto(url(15), { waitUntil: 'load' });
  await S.waitHub();
  let s = await S.state();
  expect('node 15, mode 1 (the frozen world waits for a button), zone 6, PEPPER_CONTROL 8 (the speedboat)', s.mode === 1 && s.node === 15 && s.sub === 6 && s.ctrl === 8, JSON.stringify(s));
  const dbg0 = await S.debug();
  expect('set-up: objective = PATH node 0x6f (the dock), hologram text csihol1', dbg0.objective.mode === 3 && dbg0.objective.node === 0x6f && /csihol1/i.test(dbg0.texts.hol ?? ''), JSON.stringify([dbg0.objective, dbg0.texts]));
  await wait(1200);
  await S.shot('csi15-01-mode1');
  await S.start();
  s = await S.veh();
  expect('mode 2: Pepper drives the speedboat SPBT', s.name === 'SPBT' && s.ctrl === 8, JSON.stringify(s));

  // ---- node 15: sail to the dock (PATH node 0x6f), Ctrl moors the boat, Pepper steps off at node 0x72 (PEPPER_CONTROL 1)
  const dock = await S.pathNode(0x6f), exit = await S.pathNode(0x72);
  log('dock', JSON.stringify(dock), 'exit', JSON.stringify(exit));
  // the island lies between the arrival (west) and the dock: a route over the water from the game's own collision (BFS over a grid of water cells)
  s = await S.veh();
  const route = await S.sailPlan(s.x, s.z, dock[0], dock[2]);
  expect('a route over the water to the dock exists', !!route, JSON.stringify(route));
  log('route', JSON.stringify(route?.map((p) => p.map((v) => Math.round(v)))));
  let n = 0;
  for (let k = 1; route && k < route.length; k++) {
    const last = k === route.length - 1;
    const done = async (st, d) => { if (++n % 40 === 0) log('  sail', k, JSON.stringify({ x: +st.x.toFixed(0), z: +st.z.toFixed(0), d: +d.toFixed(0) })); if (n === 100) await S.shot('csi15-02-sailing'); return d < (last ? 20 : 25); };
    s = await S.sailTo(route[k][0], route[k][1], { done, maxMs: 120000, slow: last ? 50 : 0 });
  }
  s = await S.sailTo(dock[0], dock[2], { done: async (st, d) => d < 20, maxMs: 60000, slow: 50 });
  s = await S.dockApproach(dock[0], dock[2], { r: 16 });
  const dd = Math.hypot(dock[0] - s.x, dock[2] - s.z);
  expect('sailed to within 20 units of the dock', dd < 20, JSON.stringify(s));
  await S.shot('csi15-03-at-the-dock');
  // the dock icon (var 0xc bit 0x80 blinks): Ctrl moors
  await page.keyboard.down('Control'); await wait(200); await page.keyboard.up('Control');
  const moored = await S.untilTicks(async () => ((await S.veh()).ctrl & 0xff) === 1, 400);
  s = await S.veh();
  expect('Ctrl at the dock: the boat moors, Pepper steps off (PEPPER_CONTROL 1, bit 0x100 = the hologram calls her)', moored && (s.ctrl & 0xff) === 1, JSON.stringify(s));
  expect('Pepper stands at the exit node', Math.hypot(s.px - exit[0], s.pz - exit[2]) < 12, JSON.stringify([s.px, s.pz, exit]));
  await S.shot('csi15-04-stepped-off');

  // ---- node 16: the landing cutscene csi01 starts at once (the trigger of PATH node 0x72 = 114: slot 0)
  const gotCs = await S.untilTicks(async () => (await S.state()).cs === true, 300);
  s = await S.state();
  expect('story node 16 (csifsm1 / csihol1) and the cutscene csi01 runs', gotCs && s.node === 16, JSON.stringify(s));
  const dbg16 = await S.debug();
  log('texts', JSON.stringify(dbg16.texts), 'objective', JSON.stringify(dbg16.objective));
  await wait(2500);
  await S.shot('csi16-01-cutscene');
  await wait(3000);
  await S.shot('csi16-02-cutscene');
  const skipped = await S.skipCutscenes();
  log('cutscene skipped with', skipped, 'Shift taps');
  await S.untilTicks(async () => (await S.vars([0x56]))[0x56] === 12 || (await S.state()).node >= 17, 300);
  s = await S.state();
  expect('after csi01: var 0x56 = 12, story node 17', s.node === 17, JSON.stringify(s));

  // ---- node 17: walk across the island to the bridge (PATH node 9): the trigger of the node sets var 0x56 = 2 (the Control node's own hook: node 0x11 and x < -60 does the same)
  await S.freePepper();
  const dbg17 = await S.debug();
  expect('node 17: objective = the bridge record BRGE (4), texts csifsm1 / csihol1', dbg17.objective.mode === 1 && dbg17.objective.recs[0] === 4, JSON.stringify([dbg17.objective, dbg17.texts]));
  // ---- Enter next to a castle tree (Control's FUN_005b2e9f -> decor swap FUN_00420bb7): teleport next to TREE record 101 (a type-1 decor record) on the landing side, real Enter press
  {
    const tree = () => page.evaluate(() => { const z = window.__zone, w = z.world, r = w.records[101], D = w.ext.get('island.decor'); return { name: r.name, v: r.variant, cnt: D ? [...D.cnt] : null }; });
    await page.evaluate(() => { const z = window.__zone, w = z.world, p = z.loaded.pepper, r = w.records[101]; const px = r.x + Math.sin(0.5) * 4, pz = r.z + Math.cos(0.5) * 4; p.x = px; p.z = pz; p.y = r.y + 1; const g = w.col.groundRay(px, r.y + 20, pz); if (g > -1e30) p.y = g; p.ry = Math.atan2(r.x - px, r.z - pz); p.rebuildYaw(); p.savePrev(); w.camera.init(p); });
    await wait(600);
    const t0 = await tree();
    await page.keyboard.down('Enter'); await wait(150); await page.keyboard.up('Enter');
    await wait(120);
    const t1 = await tree();
    await S.shot('csi17-00-decor-pop');
    await wait(1800);
    const t2 = await tree();
    await S.shot('csi17-00-decor-done');
    log('decor', JSON.stringify([t0, t1, t2]));
    expect('Enter next to a castle tree: the swap runs (a slot counts down) and the variant word moves on (set << 8 | 1 | variant << 16)', t1.cnt?.some((c) => c >= 0) && t2.v !== t0.v && (t2.v & 0xff) === 1, JSON.stringify([t0, t1, t2]));
  }
  // (the decor test left Pepper between the trees 101 / 102 / 103: the walk to the bridge starts from the landing place again, where the cutscene left her)
  await page.evaluate(() => { const z = window.__zone, w = z.world, p = z.loaded.pepper; p.x = 203; p.z = 197.5; p.y = w.col.groundRay(p.x, 200, p.z); p.ry = -1.97; p.rebuildYaw(); p.savePrev(); w.camera.init(p); });
  await wait(400);
  const bridgeNode = await S.pathNode(9);
  log('bridge node', JSON.stringify(bridgeNode));
  let w = 0;
  const stop17 = async (p) => { if (++w % 30 === 0) log('  walk', JSON.stringify({ x: +p.x.toFixed(0), z: +p.z.toFixed(0), node: p.node })); return p.node !== 17 || p.arch !== 'z07CSI'; };
  const r17 = await S.walkSmart(bridgeNode[0], bridgeNode[2], { tol: 10, maxTicks: 6000, stop: stop17 });
  log('walk result', JSON.stringify(r17));
  await S.shot('csi17-01-at-the-bridge');
  await S.untilTicks(async () => (await S.state()).node !== 17, 200);
  s = await S.state();
  expect('node 17 done: the story leaves for z08BKD (node 18) or the next node', s.node >= 18 || s.arch !== 'z07CSI', JSON.stringify(s));

  // ---- node 18: the story hands over to z08BKD (the bridge mini-game); the mini-game is skipped with the node skip (its story condition is set), the castle comes back with PREV_SUBGAME 7
  const miniGame = async (arch, label) => {
    await page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a, arch, { timeout: 120000 }).catch(() => {});
    const z = await S.zoneNow();
    expect(`${label}: the loop left the castle for ${arch}`, z.arch === arch, JSON.stringify(z));
    // the full-story bot (tools/steps/full-story.mjs) plays the mini-game itself (its own win bot, real keys) instead of the node skip below
    if (globalThis.LE2_MINIGAME) {
      const played = await globalThis.LE2_MINIGAME(arch);
      if (played !== 'skip') {     // (MINI_ONLY in full-story.mjs: the other mini-games are skipped with the node skip below, to test one mini-game in the chain context quickly)
        await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z07CSI', null, { timeout: 120000 }).catch(() => {});
        return;
      }
    }
    await wait(1500);
    await S.shot(`csi-${arch}-mini-game`);
    // the mini-game's intro panel waits for a key (mode 1); then its loop runs and the story FSM sees the condition
    for (let k = 0; k < 8; k++) {
      const m = await page.evaluate(() => window.__zone?.machine?.mode ?? -1);
      if (m === 2) break;
      await page.keyboard.press('ArrowLeft', { delay: 80 });
      await wait(900);
    }
    await wait(800);
    await S.shot(`csi-${arch}-mini-game-play`);
    const node = await S.completeNode();
    log(`${arch}: story node ${node} completed (node skip: the mini-game's condition is set)`);
    await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z07CSI', null, { timeout: 120000 }).catch(() => {});
  };
  await miniGame('z08BKD', 'node 18 (BKD)');
  await S.waitHub();
  s = await S.state();
  expect('back in the castle: node 19, arriving on foot (prev 7, PEPPER_CONTROL 1)', s.arch === 'z07CSI' && s.node === 19 && s.prev === 7 && (s.ctrl & 0xff) === 1, JSON.stringify(s));
  await S.shot('csi19-01-back-from-bkd');
  await S.start();

  // particle probe: the largest numbers the renderer's particle stats showed while the chapter ran (armour.par on the tent, the goblets' twinkle, cedric.par)
  await page.evaluate(() => { window.__pmax = { listed: 0, visible: 0, polygons: 0, draws: 0 }; setInterval(() => { const st = window.__particles?.stats; if (st) for (const k of Object.keys(window.__pmax)) window.__pmax[k] = Math.max(window.__pmax[k], st[k] || 0); }, 16); });
  // ---- node 19: the cutscene csi02 starts at once (slot 0, no waypoint), then var 0x56 = 0x11
  const cs19 = await S.untilTicks(async () => (await S.state()).cs === true, 200);
  expect('node 19: csi02 starts at once', cs19, JSON.stringify(await S.state()));
  const dbg19 = await S.debug();
  expect('node 19: objective = the Bull castle BCAS (202), texts csifsm2 / csihol2', dbg19.objective.mode === 1 && dbg19.objective.recs[0] === 202 && /csifsm2/i.test(dbg19.texts.npc ?? '') && /csihol2/i.test(dbg19.texts.hol ?? ''), JSON.stringify([dbg19.objective, dbg19.texts]));
  await wait(2500);
  await S.shot('csi19-02-cutscene');
  log('particles in csi02 (armour.par on the tent, stages 19-22)', JSON.stringify(await page.evaluate(() => { const P = window.__particles; return P ? { stats: P.stats } : null; })));
  await S.skipCutscenes();
  await S.untilTicks(async () => (await S.state()).node >= 20, 400);
  s = await S.state();
  expect('after csi02: story node 20', s.node === 20, JSON.stringify(s));
  await S.freePepper();

  // ---- a goblet (GOB0..GOB9, var 0xbc one bit each): walk onto the nearest one; +1000 score (vars 0xaf / 0xce), the HUD counter "x1"
  {
    const gobs = await page.evaluate(() => window.__zone.world.records.filter((r) => /^GOB\d$/.test(r.name)).map((r) => ({ n: r.name, x: r.x, y: r.y, z: r.z, vis: r.enabled })));
    const me = await S.pep();
    gobs.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    // the nearest goblets in a straight line may lie below a cliff or across the water: try them in turn (a failed try is put back on the landing path)
    const start = await S.pep();
    const before = await S.vars([0xbc, 0xaf, 0xce]);
    let g = null;
    for (const cand of gobs.filter((q) => q.vis).slice(0, 5)) {
      log('goblet', JSON.stringify(cand), 'before', JSON.stringify(before));
      const t0 = Date.now();
      const rg = await S.walkSmart(cand.x, cand.z, { tol: 1.2, maxTicks: 4000, stop: async (p) => Date.now() - t0 > 120000 });
      log('walk to the goblet', JSON.stringify(rg));
      if (rg.ok) { g = cand; break; }
      await page.evaluate((s0) => { const z = window.__zone, w = z.world, p = z.loaded.pepper; z.sh.vars.set(0x5e, 1); p.x = s0.x; p.z = s0.z; p.y = w.col.groundRay(p.x, 200, p.z); p.rebuildYaw(); p.savePrev(); w.camera.init(p); }, start);
      await wait(400);
    }
    expect('a goblet could be reached on foot', !!g, JSON.stringify(gobs.slice(0, 5)));
    await S.untilTicks(async () => (await S.vars([0xbc]))[0xbc] !== before[0xbc], 60);
    const after = await S.vars([0xbc, 0xaf, 0xce]);
    await S.shot('csi19-03-goblet');
    const hud = await page.evaluate(() => ({ left: window.__zone.game.ctx.hud.leftText, centre: window.__zone.game.ctx.hud.centreText }));
    log('particles right after the pick-up', JSON.stringify(await page.evaluate(() => { const P = window.__particles; return P ? { stats: P.stats } : null; })));
    const pop = (v) => { let n = 0; for (; v; v >>>= 1) n += v & 1; return n; };   // (csi02 may already have brushed a goblet on its way: the counter is the number of bits of var 0xbc)
    expect('goblet picked up: var 0xbc gets a bit, +1000 on vars 0xaf / 0xce, HUD x<count>', pop(after[0xbc]) === pop(before[0xbc]) + 1 && after[0xaf] === before[0xaf] + 1000 && after[0xce] === before[0xce] + 1000 && hud.left === `x${pop(after[0xbc])}`, JSON.stringify([before, after, hud]));
  }

  // ---- node 20: walk to the Bull castle's gate (PATH node 80): the trigger starts csi04 (slot 1) and sets var 0x56 = 2
  const bull = await S.pathNode(80);
  log('Bull castle gate', JSON.stringify(bull));
  w = 0;
  const stop20 = async (p) => { if (++w % 40 === 0) log('  walk', JSON.stringify({ x: +p.x.toFixed(0), z: +p.z.toFixed(0), node: p.node, cs: p.cs })); return p.node !== 20 || p.cs || p.arch !== 'z07CSI'; };
  const r20 = await S.walkSmart(bull[0], bull[2], { tol: 8, maxTicks: 6000, stop: stop20 });
  log('walk result', JSON.stringify(r20));
  await S.shot('csi20-01-at-the-bull-castle');
  const cs20 = await S.untilTicks(async () => (await S.state()).cs === true, 200);
  expect('node 20: the trigger at the Bull castle starts csi04', cs20, JSON.stringify(await S.state()));
  await wait(2500);
  await S.shot('csi20-02-cutscene');
  await S.skipCutscenes();
  await S.untilTicks(async () => (await S.state()).node >= 21, 400);
  s = await S.state();
  expect('after csi04: story node 21 (the story handler puts Pepper on the horse: PEPPER_CONTROL 0x10)', s.node === 21, JSON.stringify(s));
  const hasHorse = await page.evaluate(() => window.__zone.loaded.pepper.ctrl.nodes.some((n) => n.kind === 'Horse'));
  log('horse nodes on Pepper\'s chain:', hasHorse, JSON.stringify(await S.state()));
  await S.shot('csi21-01-horse');

  // ---- nodes 21 / 22 / 25 are ridden on the horse (PEPPER_CONTROL 0x10, the csi-horse worker's nodes): `ride(label, pathNode, node)` rides along the PATH map's route (the original's hop table) to a PATH node
  //      with the walk keys (Pepper's pose is the horse's); the straight line between the castles is blocked by cliffs and walls
  const ride = async (label, pathNode, node, tol = 10) => {
    const st = await S.state();
    expect(`${label}: Pepper sits on the horse (PEPPER_CONTROL ${(st.ctrl & 0xff).toString(16)}), the horse nodes run`, (st.ctrl & 0xff) === 0x10 && hasHorse, JSON.stringify(st));
    w = 0;
    const stop = async (p) => { if (++w % 40 === 0) log('  ride', JSON.stringify({ x: +p.x.toFixed(0), z: +p.z.toFixed(0), node: p.node, ctrl: p.ctrl })); return p.node !== node || p.cs || p.arch !== 'z07CSI'; };
    const r = await S.walkRoute(pathNode, { tol, maxTicks: 9000, stop });
    log(`${label}: ride result`, JSON.stringify(r));
    return r;
  };
  // node 21: ride to the Lion castle (PATH node 6): the trigger starts csi05 (slot 2), var 0x56 = 3
  const lion = await S.pathNode(6);
  await ride('node 21', 6, 21);
  const cs21 = await S.untilTicks(async () => (await S.state()).cs === true, 300);
  expect('node 21: the trigger at the Lion castle starts csi05', cs21, JSON.stringify(await S.state()));
  await wait(2000);
  await S.shot('csi21-02-cutscene');
  await S.skipCutscenes();
  await S.untilTicks(async () => (await S.state()).node >= 22, 400);
  s = await S.state();
  expect('after csi05: story node 22 (the Dark Knight appears)', s.node === 22, JSON.stringify(s));
  const dbg22 = await S.debug();
  expect('node 22: objective = the bridge BRGE (4), texts csifsm4 / csihol4', dbg22.objective.mode === 1 && dbg22.objective.recs[0] === 4 && /csifsm4/i.test(dbg22.texts.npc ?? ''), JSON.stringify([dbg22.objective, dbg22.texts]));
  await S.shot('csi22-01-dark-knight');
  // node 22: back to the bridge (PATH node 9): csi06 (slot 3), var 0x56 = 4
  s = await S.state();
  if ((s.ctrl & 0xff) !== 0x10 && hasHorse) log('node 22: Pepper is not on the horse (', s.ctrl, ')');
  await ride('node 22', 9, 22);
  const cs22 = await S.untilTicks(async () => (await S.state()).cs === true, 300);
  expect('node 22: the trigger at the bridge starts csi06', cs22, JSON.stringify(await S.state()));
  await wait(2000);
  await S.shot('csi22-02-cutscene');
  await S.skipCutscenes();
  await S.untilTicks(async () => (await S.state()).node >= 23 || (await S.state()).arch !== 'z07CSI', 400);

  // ---- node 23: z09JST (the joust), skipped; the castle comes back for node 24 (prev 8)
  await miniGame('z09JST', 'node 23 (JST)');
  await S.waitHub();
  s = await S.state();
  expect('back in the castle: node 24, on the horse (prev 8: the ride goes on after the joust, as in the original: PEPPER_CONTROL 0x10)', s.arch === 'z07CSI' && s.node === 24 && s.prev === 8 && (s.ctrl & 0xff) === 0x10, JSON.stringify(s));
  await S.shot('csi24-01-back-from-jst');
  await S.start();
  const cs24 = await S.untilTicks(async () => (await S.state()).cs === true, 200);
  expect('node 24: csi07 starts at once', cs24, JSON.stringify(await S.state()));
  await wait(2000);
  await S.shot('csi24-02-cutscene');
  await S.skipCutscenes();
  await S.untilTicks(async () => (await S.state()).node >= 25, 400);
  s = await S.state();
  expect('after csi07: story node 25 (horse again: PEPPER_CONTROL 0x10)', s.node === 25, JSON.stringify(s));
  const dbg25 = await S.debug();
  expect('node 25: objective = the Bull castle BCAS (202), texts csifsm5 / csihol5', dbg25.objective.mode === 1 && dbg25.objective.recs[0] === 202 && /csifsm5/i.test(dbg25.texts.npc ?? ''), JSON.stringify([dbg25.objective, dbg25.texts]));
  await ride('node 25', 80, 25);
  const cs25 = await S.untilTicks(async () => (await S.state()).cs === true, 300);
  expect('node 25: the trigger at the Bull castle starts csi08', cs25, JSON.stringify(await S.state()));
  await wait(2000);
  await S.shot('csi25-01-cutscene');
  await S.skipCutscenes();
  await S.untilTicks(async () => (await S.state()).node >= 26 || (await S.state()).arch !== 'z07CSI', 400);

  // ---- node 26: z10RGB (the Res-Q boat race), skipped; the castle comes back for node 27 (prev 9)
  await miniGame('z10RGB', 'node 26 (RGB)');
  await S.waitHub();
  s = await S.state();
  expect('back in the castle: node 27, on foot (prev 9)', s.arch === 'z07CSI' && s.node === 27 && s.prev === 9 && (s.ctrl & 0xff) === 1, JSON.stringify(s));
  await S.shot('csi27-01-back-from-rgb');
  await S.start();
  const cs27 = await S.untilTicks(async () => (await S.state()).cs === true, 200);
  expect('node 27: csi09 starts at once', cs27, JSON.stringify(await S.state()));
  await wait(2000);
  await S.shot('csi27-02-cutscene');
  await S.skipCutscenes();
  await S.untilTicks(async () => (await S.state()).node >= 28, 400);
  s = await S.state();
  expect('after csi09: story node 28 (objective = the portal PORS (165), texts csifsm6 / csihol7)', s.node === 28, JSON.stringify(s));
  const dbg28 = await S.debug();
  expect('node 28: objective record 165 (PORS)', dbg28.objective.mode === 1 && dbg28.objective.recs[0] === 165 && /csihol7/i.test(dbg28.texts.hol ?? ''), JSON.stringify([dbg28.objective, dbg28.texts]));

  // ---- node 28: back to the speedboat at the dock (Ctrl next to it: PEPPER_CONTROL 8), node 29: sail to the portal (var 5 = 0x20: the island, era 2)
  await S.freePepper();
  const boat = await S.at('SPBT');
  log('speedboat', JSON.stringify(boat));
  w = 0;
  const stop28 = async (p) => { if (++w % 40 === 0) log('  walk', JSON.stringify({ x: +p.x.toFixed(0), z: +p.z.toFixed(0), node: p.node })); return p.node !== 28 || p.cs || p.arch !== 'z07CSI'; };
  const r28 = await S.walkSmart(boat[0], boat[2], { tol: 12, maxTicks: 9000, stop: stop28 });
  log('walk to the boat', JSON.stringify(r28));
  await page.keyboard.down('Control'); await wait(200); await page.keyboard.up('Control');
  await S.untilTicks(async () => (await S.state()).node >= 29 || ((await S.veh()).ctrl & 0xff) === 8, 300);
  s = await S.veh();
  expect('node 28: Pepper sits in the speedboat (PEPPER_CONTROL 8)', s.name === 'SPBT' && (s.ctrl & 0xff) === 8, JSON.stringify(s));
  await S.untilTicks(async () => (await S.state()).node >= 29, 200);
  s = await S.state();
  expect('node 29', s.node === 29, JSON.stringify(s));
  const portal = await S.at('PORS');
  log('portal', JSON.stringify(portal));
  const route29 = await S.sailPlan((await S.veh()).x, (await S.veh()).z, portal[0], portal[2]);
  log('route to the portal', JSON.stringify(route29?.map((p) => p.map((v) => Math.round(v)))));
  for (let k = 1; route29 && k < route29.length; k++) {
    const last = k === route29.length - 1;
    await S.sailTo(route29[k][0], route29[k][1], { done: async (st, d) => d < (last ? 8 : 25) || (await S.zoneNow()).arch !== 'z07CSI', maxMs: 120000 });
  }
  await S.sailTo(portal[0], portal[2], { done: async (st, d) => d < 6 || (await S.zoneNow()).arch !== 'z07CSI', maxMs: 60000 });
  const left = await S.untilLeft('z07CSI', 90000);
  expect('the portal leaves the castle: the island (z02LGI)', left === 'z02LGI', String(left));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && window.__zone.world.tickCount > 2, null, { timeout: 120000 }).catch(() => {});
  s = await S.state();
  expect('island era 2, story node 30, PREV_SUBGAME 6', s?.arch === 'z02LGI' && s.node === 30 && s.prev === 6, JSON.stringify(s));
  await wait(800);
  await S.shot('csi30-01-island');
  log('particles: the largest stats seen from node 19 on', JSON.stringify(await page.evaluate(() => window.__pmax ?? null).catch(() => null)));
  log(fail.length ? `FAILED: ${fail.join(' | ')}` : 'ALL OK');
  if (fail.length) process.exitCode = 1;
};
