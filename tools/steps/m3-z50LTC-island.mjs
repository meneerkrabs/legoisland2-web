// z50LTC entered from the island the way the wormhole does it (var 5 = 34) with the story at node 5 (not the room's own story node), then back through PORC:
//   node tools/browse.mjs "http://localhost:5499/?zone=z02LGI&node=5&mute=1" tools/steps/m3-z50LTC-island.mjs --size 1280x800 --out /tmp/m3/z50LTC
// (the island's WORM portal itself is not ported yet (M4): the step writes var 5 like it would.) The story FSM must not bounce the player out of the room.
export default async ({ page, shot, wait, log }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const st = () => page.evaluate(() => { const z = window.__zone; if (!z) return null; const p = z.loaded.pepper; return { arch: z.info.archive, mode: z.machine.mode, tick: z.world.tickCount, pos: [p.x, p.y, p.z].map((x) => +x.toFixed(1)), var5: z.sh.vars.get(5), node: z.sh.vars.get(0x58), prev: z.sh.vars.get(0xa3), cur: z.sh.vars.get(0x59) }; });
  const until = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(100); } return false; };
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && window.__zone.world.tickCount > 10, null, { timeout: 300000 });
  let s = await st();
  expect('island at story node 5', s.arch === 'z02LGI' && s.node === 5, JSON.stringify(s));
  await page.evaluate(() => window.__zone.sh.vars.set(5, 34));
  expect('the room opens (zone 34)', await until(async () => { const z = await st(); return z && z.arch === 'z50LTC' && z.tick > 20 && z.mode === 2; }), JSON.stringify(await st()));
  s = await st();
  expect('current zone 34, previous zone is the island, story node unchanged', s.cur === 34 && s.prev === 2 && s.node === 5, JSON.stringify(s));
  await wait(2500);
  s = await st();
  expect('the story does not move the player out of the room', s.arch === 'z50LTC' && s.mode === 2 && s.node === 5, JSON.stringify(s));
  await shot('ltc-island-1-room');
  // the wormhole
  await page.evaluate(() => { const z = window.__zone, p = z.loaded.pepper; p.x = -4; p.z = 118; p.y = 5; p.ry = 0; p.rebuildYaw(); p.savePrev(); z.world.camera.init(p); });
  await wait(600);
  await page.keyboard.down('ArrowUp');
  const left = await until(async () => { const z = await st(); return !z || z.arch !== 'z50LTC'; }, 40000);
  await page.keyboard.up('ArrowUp');
  expect('walking into PORC leaves the room', left);
  expect('back on the island, story node 5 unchanged', await until(async () => { const z = await st(); return z && z.arch === 'z02LGI' && z.tick > 5; }, 120000), JSON.stringify(await st()));
  s = await st();
  expect('the island is the current zone again and the story is where it was', s.cur === 2 && s.node === 5, JSON.stringify(s));
  await shot('ltc-island-2-back');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z50LTC island round trip passed');
  if (fail.length) process.exitCode = 1;
};
