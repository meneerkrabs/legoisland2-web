// M4 WP16: a bot plays era 2 of the island (story nodes 30..33, zone id 32) with real key input, then the adventure arc's stubs back to the island:
//   node 30: the era intro (LGIBR05, the Brickster takes the skate park and the garage apart) -> the two Constructopedia pages PAG1 / PAG2 (LGIBR06 hospital,
//            LGIBR07 police station: POLB, PCAR, PHEL, JAIL, FECL.. come back) -> NUM_PAGES & 2
//   node 31: walk to the police station (StartCSM on POLB, gate node 0x1f) -> LGI08 "NICK_CHOPPER" -> S277 = 2
//   node 32: Ctrl at the police helicopter PHEL, fly (Space forward, ArrowDown climb) into the air portal PORA (gate node 0x20: S281 |= 2, var 5 = 10)
//   node 33: z13CAI (Adventure Island, a stub) ... node 51: F9 (stub aid) in every stub zone until the story flies home -> island era 3 (zone id 33),
//            node 52: Pepper arrives at PORA in the helicopter (FUN_004c2d22, PREV_SUBGAME 10).
//   node tools/browse.mjs "http://localhost:5490/?zone=z02LGI&node=30&mute=1&hold=1" tools/steps/m4-era2.mjs --size 1280x800 --out /tmp/wp16
// Long walks / flights are teleports (Pepper or her helicopter put near the target, facing it); the keys do the actions.
// Env: STOP=<phase> ends after that phase (intro, pages, police, heli, stubs); FROM=stubs starts at the stubs (URL ?zone=z13CAI&node=33&mute=1&hold=1);
//      FROM=castle starts in the castle hub at node 29 (URL ?zone=z07CSI&node=29&mute=1&hold=1) and arrives by boat.
import { island } from './lib-island.mjs';

export default async (h) => {
  const { page, wait, log, shot, key } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const phase = (n) => { log('--- phase', n); return process.env.STOP === n; };
  const cs = async () => { let n = 0; for (let i = 0; i < 6; i++) { n += await S.skipCutscenes(); await wait(200); if (!(await S.state())?.cs) break; } return n; };
  const shown = (names) => page.evaluate((l) => Object.fromEntries(l.map((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return [n, r ? (r.flags & 2 ? 1 : 0) : -1]; })), names);
  const veh = () => page.evaluate(() => { const g = window.__zone.world.ext.get('island.vehicles'); const c = g?.current; return c ? { name: c.name, x: +c.x.toFixed(1), y: +c.y.toFixed(1), z: +c.z.toFixed(1) } : null; });
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

  let s;
  const castle = process.env.FROM === 'castle';
  if (process.env.FROM !== 'stubs') {
  // FROM=castle (URL ?zone=z07CSI&node=29): node 29 waits for NEXT_SUBGAME == 32 in the castle hub (a stub: F9), then the island era 2 with
  // PREV_SUBGAME 6: Pepper arrives at the sea portal PORS on the speedboat (FUN_004c2d22), the era intro plays, then she docks (Ctrl at a dock)
  if (castle) {
    await page.waitForFunction(() => window.__zone && window.__zone.machine.mode === 2, null, { timeout: 120000 });
    for (let i = 0; i < 10 && (await page.evaluate(() => window.__zone?.info.archive)) !== 'z02LGI'; i++) { await key('F9'); await wait(1500); }
    await S.waitIsland();
    s = await S.state();
    const arr = await page.evaluate(() => window.__zone.game.debug().arrival);
    expect('from the castle: island era 2, node 30, on the boat at PORS (control 8)', s.sub === 32 && s.node === 30 && s.ctrl === 8 && arr?.vehicle >= 0, JSON.stringify([s, arr]));
    await S.start();
    await cs(); await wait(500);
    expect('after the intro Pepper still steers the boat', ((await S.state()).ctrl & 0x1ff) === 8 && !!(await veh()), JSON.stringify(await veh()));
    await shot('e2-00-boat');
    await page.evaluate(() => {
      const w = window.__zone.world, g = w.ext.get('island.vehicles'), c = g.current, ic = window.__zone.game.ictx;
      let best = null;
      for (const d of g.docks) { if (d.taken) continue; const q = ic.pathPos(d.node); if (!q) continue; const e = Math.hypot(q[0] - c.x, q[2] - c.z); if (!best || e < best.e) best = { e, q }; }
      c.x = best.q[0] + 10; c.z = best.q[2]; c.savePrev();
    });
    await wait(400);
    await S.tap('ControlLeft', 120);
    const docked = await S.until(async () => ((await S.state()).ctrl & 0x1ff) === 1, 15000, 100);
    expect('Ctrl at a dock: Pepper steps ashore', docked, JSON.stringify(await S.state()));
    await shot('e2-00-ashore');
  }
  await S.start();
  s = await S.state();
  expect('island era 2 (zone id 32), node 30', s.arch === 'z02LGI' && s.sub === 32 && s.node === 30, JSON.stringify(s));
  await shot('e2-00-start');

  // ---- node 30: the era intro (fires at once: StartCSM on SKTP, gate 0x54 & 2 == 0)
  if (phase('intro')) return;
  if (!castle) expect('era intro cutscene LGIBR05 plays', s.cs, JSON.stringify(s));
  await cs();
  s = await S.state();
  expect('after the intro: walking, var 0x54 & 2', s.ctrl === 1 && ((await S.vars([0x54]))[0x54] & 2) === 2, JSON.stringify(s));
  {
    const v = await shown(['SKTP', 'GRGE', 'POLB', 'PHEL']);
    expect('the intro took SKTP / GRGE apart, POLB / PHEL still gone', v.SKTP === 0 && v.GRGE === 0 && v.POLB === 0 && v.PHEL === 0, JSON.stringify(v));
  }
  await shot('e2-01-intro-done');

  // ---- node 30: the two pages
  if (phase('pages')) return;
  for (const pg of ['PAG1', 'PAG2']) {
    const p0 = (await S.state()).pages;
    await nearLevel(pg, 10); await wait(400);
    await page.keyboard.down('ArrowUp');
    const got = await S.until(async () => (await S.state()).pages > p0, 4000, 30);
    await page.keyboard.up('ArrowUp');
    await S.until(async () => (await S.state()).cs, 3000, 50);
    await shot(`e2-02-${pg}`);
    await cs(); await wait(800);
    s = await S.state();
    expect(`page ${pg}`, got && s.pages === p0 + 1 && s.ctrl === 1, JSON.stringify(s));
  }
  await S.until(async () => (await S.state()).node === 31, 5000);
  s = await S.state();
  expect('two pages: node 31', s.node === 31, JSON.stringify(s));
  {
    // the buildings fall in brick by brick (FX_Bricks, era 2 set FUN_004bfec3: 3 s of drops, then a wait of up to 7 s) and are shown at the end
    const names = ['SKTP', 'GRGE', 'HOSP', 'POLB', 'PCAR', 'PHEL', 'JAIL', 'FECL'];   // LGIBR07 also names FECM / FECN: no such records (its loader stops there, docs/re/m4/wp2-cutscenes.md 3)
    await S.until(async () => Object.values(await shown(names)).every((x) => x === 1), 20000, 250);
    const v = await shown(names);
    expect('pages rebuilt SKTP / GRGE / HOSP / POLB and the police props', Object.values(v).every((x) => x === 1), JSON.stringify(v));    // faithful to the original: LGIBR07's loader stopped at FECM, so its 'BILL invisible' / SWITCH05 = 3 never run and the Brickster stays at S1LPAT3
    log('after the pages: BILL / NICK / LICK shown', JSON.stringify(await shown(['BILL', 'NICK', 'LICK'])));
  }

  // ---- node 31: the police station (StartCSM on POLB: walk in) -> LGI08 -> S277 = 2
  if (phase('police')) return;
  await S.teleportNear('POLB', 45, 0.0); await wait(400);
  await page.keyboard.down('ArrowUp');
  const fired = await S.until(async () => (await S.state()).cs, 6000, 50);
  await page.keyboard.up('ArrowUp');
  await wait(1500); await shot('e2-03-nick');
  await cs(); await wait(800);
  await S.until(async () => (await S.state()).node === 32, 4000);
  s = await S.state();
  expect('police station cutscene: S277 = 2, node 32', fired && s.s277 === 2 && s.node === 32 && s.ctrl === 1, JSON.stringify(s));
  await shot('e2-04-node32');

  // ---- node 32: the police helicopter into the air portal
  if (phase('heli')) return;
  await S.teleportNear('PHEL', 8, Math.PI / 2); await wait(500);
  await S.tap('ControlLeft', 120);
  const inHeli = await S.until(async () => (await veh())?.name === 'PHEL' && ((await S.state()).ctrl & 8) !== 0, 4000, 50);
  expect('Ctrl at PHEL: Pepper flies the helicopter', inHeli, JSON.stringify([await veh(), await S.state()]));
  await S.hold('ArrowDown', 1500);   // take off / climb
  await shot('e2-05-heli');
  // put the flying helicopter 70 units from PORA at the portal's height, facing it, then fly in (Space = nose down)
  await page.evaluate(() => {
    const w = window.__zone.world, c = w.ext.get('island.vehicles').current, r = w.records.find((x) => x.name === 'PORA');
    c.x = r.x - 70; c.z = r.z; c.y = r.y; c.ry = Math.atan2(r.x - c.x, r.z - c.z); c.rebuildYaw(); c.savePrev();
  });
  await wait(300);
  await page.keyboard.down('Space');
  const left = await S.until(async () => (await page.evaluate(() => window.__zone.sh.vars.get(5))) === 10 || (await S.state())?.arch !== 'z02LGI', 15000, 50);
  await page.keyboard.up('Space');
  s = await page.evaluate(() => ({ next: window.__zone.sh.vars.get(5), s281: window.__zone.sh.vars.get(0x119), node: window.__zone.sh.vars.get(0x58), arch: window.__zone.info.archive }));
  expect('PORA: S281 |= 2, var 5 = 10 (z13CAI)', left && s.next === 10, JSON.stringify(s));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z02LGI' && window.__zone.world.tickCount > 3, null, { timeout: 120000 }).catch(() => {});
  s = await page.evaluate(() => ({ arch: window.__zone?.info.archive, node: window.__zone?.sh.vars.get(0x58) }));
  expect('node 33 in z13CAI', s.arch === 'z13CAI' && s.node === 33, JSON.stringify(s));
  await shot('e2-06-cai');

  } else await page.waitForFunction(() => window.__zone && window.__zone.world, null, { timeout: 120000 });

  // ---- nodes 33..51: the stubs (F9 completes the story step / finishes the mini-game)
  if (phase('stubs')) return;
  // z17WAS (node 37) is a ported mini-game: the Whack-A-Snake bot of tools/steps/m3-z17WAS.mjs plays it (clock shortened to 3 s after a few seconds)
  const BTN = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];
  const playWas = async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const d = await page.evaluate(() => window.__zone?.game?.debug?.());
      if (!d || d.done) break;
      if (Date.now() - t0 > 5000) await page.evaluate(() => { const n = __zone.world.records[22]?.ctrl?.nodes.find((x) => x.kind === 'zonewas'); if (n && n.timeLeft > 90) n.timeLeft = 90; });
      if (!d.busy && d.presses === 0 && !d.squash) {
        const k = d.state.findIndex((st, i) => st === 2 && d.hit[i] === 0);
        if (k >= 0) { await page.keyboard.press(BTN[k], { delay: 25 }); if (d.holder === k) { await wait(70); await page.keyboard.press(BTN[k], { delay: 25 }); } }
      }
      await wait(30);
    }
  };
  const visited = [];
  for (let i = 0; i < 120; i++) {
    const z = await page.evaluate(() => ({ arch: window.__zone?.info.archive, mode: window.__zone?.machine.mode, node: window.__zone?.sh.vars.get(0x58), menu: __shell.menu?.engine?.open ? __shell.menu.engine.page : -1 }));
    if (z.arch === 'z02LGI') break;
    if (visited.at(-1) !== `${z.arch}:${z.node}`) visited.push(`${z.arch}:${z.node}`);
    if (z.menu >= 0) { await key('Enter'); await wait(600); continue; }
    if (z.mode === 1 || z.mode === 9 || z.mode === 4) { await key('Enter'); await wait(500); continue; }
    if (z.mode === 2 && z.arch === 'z17WAS') { await playWas(); continue; }
    if (z.mode === 2) { await key('F9'); await wait(900); continue; }
    await wait(500);
  }
  log('stub zones', visited.join(' '));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && (window.__zone.machine.mode === 1 || window.__zone.machine.mode === 2), null, { timeout: 120000 }).catch(() => {});
  s = await S.state();
  expect('home: island era 3 (zone id 33), node 52, from z13CAI', s?.arch === 'z02LGI' && s.sub === 33 && s.node === 52, JSON.stringify(s));
  const arr = await page.evaluate(() => window.__zone.game.debug().arrival);
  expect('arrival at PORA in a helicopter / Ptera (PEPPER_CONTROL 8 / 0x40)', arr && arr.vehicle >= 0 && (s.ctrl === 8 || s.ctrl === 0x40), JSON.stringify([arr, s.ctrl]));
  await S.start();
  await wait(1500);
  s = await S.state();
  const v = await veh();
  await shot('e2-07-home');
  expect('Pepper sits in the vehicle near PORA', v && Math.hypot(v.x - 546, v.z - 0) < 120 && Math.hypot(s.pos[0] - v.x, s.pos[2] - v.z) < 6, JSON.stringify([v, s]));
  // node 52 (PEPPER_CONTROL == 1): skip the era-3 intro, fly to a free helipad (teleport above the nearest one), Ctrl = land, Pepper steps off
  await cs(); await wait(500);
  s = await S.state();
  expect('after the era 3 intro Pepper still flies (control 8)', (s.ctrl & 0x1ff) === 8 && (await veh())?.name === 'PHEL', JSON.stringify(s));
  await shot('e2-08-flying-home');
  const pad = await page.evaluate(() => {
    const w = window.__zone.world, g = w.ext.get('island.vehicles'), c = g.current, ic = window.__zone.game.ictx;
    let best = null;
    for (const p of g.pads) { if (p.taken) continue; const q = ic.pathPos(p.node); if (!q) continue; const d = Math.hypot(q[0] - c.x, q[2] - c.z); if (!best || d < best.d) best = { d, q }; }
    c.x = best.q[0] + 20; c.z = best.q[2]; c.y = best.q[1] + 30; c.savePrev();
    return best.q.map((v) => +v.toFixed(1));
  });
  await wait(500);
  await S.tap('ControlLeft', 120);
  // landed = Pepper on foot (node 52 complete): the node-53 cutscene may start the same frame, so the node counts too
  const landed = await S.until(async () => { const t = await S.state(); return (t.ctrl & 0x1ff) === 1 || t.node >= 53; }, 30000, 100);
  await S.until(async () => (await S.state()).node === 53, 4000);
  await cs();
  s = await S.state();
  expect('Ctrl: the helicopter lands on the pad, Pepper walks (node 53)', landed && s.node >= 53, JSON.stringify([pad, s]));
  await shot('e2-09-landed');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'era 2 passed');
  if (fail.length) process.exitCode = 1;
};
