// WP5: NUBB (SPD0's driver) becomes catchable. Run: node tools/browse.mjs "http://localhost:5497/?zone=z02LGI&node=3&mute=1" tools/steps/m4-wp5-nubb.mjs --size 1280x800 --out /tmp/m4-wp5
// 1. Pepper blocks SPD0's road: the car stops and falls apart, NUBB stays in it (as in the original: talking to him is blocked by MOVE_NUBB 0x20000).
// 2. Pepper delivers Nancy's pizza (NANC, her group partner): her conversation end ORs 3 into MOVE_NUBB (FUN_004240d1), SPD0 drives to ROAD node 94 and
//    its waypoint action ORs 8 there: NUBB gets out. 3. Shift next to NUBB: his cutscene, the bricks counter goes down by one.
import { island, blockRoad } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h; const S = island(h);
  await S.start();
  await S.skipCutscenes();
  const info = () => page.evaluate(() => { const w = window.__zone.world; const n = w.records.find((x) => x.name === 'NUBB'); const c = w.records.find((x) => x.name === 'SPD0');
    return { nubbCar: +Math.hypot(n.x - c.x, n.z - c.z).toFixed(1), carFlags: c.flags.toString(16), move: w.vars.get(0x80).toString(16) }; });
  // 1. the crash
  for (let i = 0; i < 10; i++) {
    await blockRoad(S, page, wait, 'NUBB', 20);
    await wait(900);
    const r = await info(); log('block', i, JSON.stringify(r));
    if (parseInt(r.carFlags, 16) & 0x8000) { await shot('nubb-crash'); break; }
  }
  const b0 = (await S.state()).bricks;
  await S.tap('ShiftLeft', 100); await wait(600);
  log('Shift at the crashed car: bricks', b0, '->', (await S.state()).bricks, JSON.stringify(await info()));
  // 2. Nancy's pizza
  for (let a = 0; a < 6; a++) {
    await S.teleportNear('NANC', 4, a * 0.7); await wait(250); await S.tap('ShiftLeft', 100); await wait(600);
    const s = await S.state(); if (s.cs) { await S.skipCutscenes(); break; }
  }
  log('after NANC', JSON.stringify(await info()));
  const out = await S.until(async () => (parseInt((await info()).move, 16) & 8) !== 0, 120000, 500);
  log('NUBB out of the car:', out, JSON.stringify(await info()));
  await wait(1500);
  await shot('nubb-out');
  // 3. talk to NUBB
  const b1 = (await S.state()).bricks;
  for (let a = 0; a < 6; a++) {
    await S.teleportNear('NUBB', 4, a * 0.7); await wait(250); await S.tap('ShiftLeft', 100); await wait(700);
    let s = await S.state(); if (s.cs) { await shot('nubb-cutscene'); await S.skipCutscenes(); s = await S.state(); }
    log('talk attempt', a, 'bricks', b1, '->', s.bricks);
    if (s.bricks < b1) { log('RESULT NUBB delivered: bricks', b1, '->', s.bricks); break; }
  }
  await shot('nubb-done');
};
