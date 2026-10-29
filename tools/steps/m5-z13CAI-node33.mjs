// M5 z13CAI, story node 33 (Adventure Island, the first visit: "Vind je de woestijn dan leuk, Pepper?"): a headless bot with REAL key input plays the hub's part of the node:
// the arrival in the helicopter (set-up emulation), the frozen world of mode 1, any button -> play, the helicopter flies (Space forward, Left / Right), Shift calls the hologram
// (the node's hint ADVHOLA), the objective arrow points at the landing pad (PATH node 0), Ctrl near the pad lands, Pepper steps off, PEPPER_CONTROL = 1, pepswitc sets var 5 = 11
// and the story FSM (node 33: "var 5 == 11") hands over to z14OSD (node 34).
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5513/?zone=z13CAI&node=33&mute=1&hold=1&debug=1" tools/steps/m5-z13CAI-node33.mjs --size 1280x800 --out /tmp/m5-z13CAI
import { cai, url } from './lib-z13CAI.mjs';
export default async (h) => {
  const { page, wait, log } = h;
  const S = cai(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await page.goto(url(33), { waitUntil: 'load' });
  await S.waitHub();
  let s = await S.state();
  expect('mode 1 (the frozen world waits for a button), node 33, zone 10', s.mode === 1 && s.node === 33 && s.sub === 10, JSON.stringify(s));
  const dbg0 = await S.debug();
  expect('the set-up: objective = PATH node 0 (the landing pad), hologram text advholA', dbg0.objective.mode === 3 && dbg0.objective.node === 0 && /advholA/i.test(dbg0.texts.hol ?? ''), JSON.stringify([dbg0.objective, dbg0.texts]));
  await wait(1500);
  await S.shot('cai33-01-mode1');
  await S.start();
  s = await S.state();
  let v = await S.veh();
  expect('mode 2: Pepper flies the police helicopter (PEPPER_CONTROL 8)', s.mode === 2 && s.ctrl === 8 && v?.name === 'PHEL', JSON.stringify([s, v]));
  expect('the arrival place (-654, 98, 644)', Math.hypot(v.x + 654.3, v.z - 644.1) < 200, JSON.stringify(v));
  await wait(1500);
  await S.shot('cai33-02-flying');

  // Shift calls the hologram (hold ~1 s = 20 ticks)
  await S.keys(['ShiftLeft']);
  const holo = await S.untilTicks(async () => (await S.vars([0xc6]))[0xc6] === 1, 90);
  await wait(400);
  await S.shot('cai33-03-hologram');
  const holoDbg = await page.evaluate(() => ({ active: window.__zone.game.ictx.shared.holoActive ?? null }));
  await S.release();
  expect('Shift held: the hologram appears (var 0xc6 = 1)', holo, JSON.stringify(holoDbg));
  await wait(2500);

  // fly to the pad (PATH node 0): the pad is far away across the island
  const pad = await S.pathNode(0);
  log('pad', JSON.stringify(pad));
  let n = 0;
  const done = async (st, d) => { if (++n % 25 === 0) { log('  fly', JSON.stringify({ x: +st.x.toFixed(0), y: +st.y.toFixed(0), z: +st.z.toFixed(0), d: +d.toFixed(0) })); } if (n === 150) await S.shot('cai33-04-over-the-island'); return d < 55; };
  s = await S.flyTo(pad[0], pad[2], { done, maxMs: 150000 });
  const dpad = Math.hypot(pad[0] - s.x, pad[2] - s.z);
  expect('flew to within 55 units of the pad', dpad < 55, JSON.stringify(s));
  await S.shot('cai33-05-at-the-pad');
  // Ctrl: the helicopter lands by itself (state 2), Pepper steps off
  await page.keyboard.down('Control'); await wait(160); await page.keyboard.up('Control');
  const landed = await S.until(async () => (await S.veh())?.ctrl === 1 || (await S.zoneNow()).arch !== 'z13CAI', 30000, 50);
  s = await S.veh();
  expect('Ctrl lands the helicopter: Pepper walks (PEPPER_CONTROL 1) or the zone already ended', landed, JSON.stringify(s));
  await S.shot('cai33-06-landed');
  // var 5 = 11 -> the loop leaves for z14OSD, the story node advances to 34
  const left = await S.untilLeft('z13CAI', 60000);
  expect('the zone ends: next is z14OSD', left === 'z14OSD', String(left));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z14OSD' && window.__zone.world.tickCount > 2, null, { timeout: 120000 }).catch(() => {});
  s = await S.state();
  expect('story node 34 (z14OSD), PREV_SUBGAME 10', s?.arch === 'z14OSD' && s.node === 34 && s.prev === 10, JSON.stringify(s));
  await wait(800);
  await S.shot('cai33-07-oasis');
  log(fail.length ? `FAILED: ${fail.join(' | ')}` : 'ALL OK');
  if (fail.length) process.exitCode = 1;
};
