// M5 z13CAI, story node 51 (Adventure Island, the return from the Dino island: "nu moet je die bladzijden terugvliegen naar LEGO eiland"): a headless bot with REAL keys plays it:
// arrival in the helicopter, the hologram hint ADVHOL0 (Shift), the objective arrow at the portal PORS, steer into PORS (Left / Right / Space): the box portal sets var 0xfa |= 1
// (the story node's condition) and var 5 = 33, the story FSM goes to node 52 (zone 33 = the island, era 3) and the island arrives at PORA in the vehicle (PREV_SUBGAME 10).
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5513/?zone=z13CAI&node=51&mute=1&hold=1&debug=1" tools/steps/m5-z13CAI-node51.mjs --size 1280x800 --out /tmp/m5-z13CAI
import { cai, url } from './lib-z13CAI.mjs';
export default async (h) => {
  const { page, wait, log } = h;
  const S = cai(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await page.goto(url(51), { waitUntil: 'load' });
  await S.waitHub();
  let s = await S.state();
  expect('mode 1, node 51, zone 10', s.mode === 1 && s.node === 51 && s.sub === 10, JSON.stringify(s));
  const dbg0 = await S.debug();
  expect('the set-up: objective = the portal record PORS (53), hologram text advhol0', dbg0.objective.mode === 1 && dbg0.objective.recs[0] === 53 && /advhol0/i.test(dbg0.texts.hol ?? ''), JSON.stringify([dbg0.objective, dbg0.texts]));
  await wait(1200);
  await S.shot('cai51-01-mode1');
  await S.start();
  let v = await S.veh();
  expect('flying the helicopter, S250 = 0', v?.ctrl === 8 && v.name === 'PHEL' && v.s250 === 0, JSON.stringify(v));
  await S.keys(['ShiftLeft']);
  const holo = await S.untilTicks(async () => (await S.vars([0xc6]))[0xc6] === 1, 90);
  await wait(500);
  await S.shot('cai51-02-hologram');
  await S.release();
  expect('the hologram speaks the node-51 hint', holo);
  await wait(2500);
  // fly a loop first: away from the portal, then back into it
  const por = await S.at('PORS');
  await S.keys(['Space']); await wait(2500); await S.release();
  await S.shot('cai51-03-away');
  s = await S.flyTo(por[0], por[2], { done: async (st, d) => (st.s250 & 1) === 1 || d < 8, maxMs: 90000 });
  await S.shot('cai51-04-at-the-portal');
  const fired = await S.until(async () => ((await S.veh())?.s250 & 1) === 1 || (await S.zoneNow()).arch !== 'z13CAI', 20000, 50);
  expect('flying into PORS sets S250 (or the zone already ended)', fired, JSON.stringify(await S.veh()));
  const left = await S.untilLeft('z13CAI', 60000);
  expect('the zone ends: next is the island (z02LGI)', left === 'z02LGI', String(left));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && window.__zone.machine.mode >= 1, null, { timeout: 120000 }).catch(() => {});
  s = await S.state();
  expect('island era 3 (zone id 33), node 52, PREV_SUBGAME 10, in a vehicle', s?.arch === 'z02LGI' && s.sub === 33 && s.node === 52 && s.prev === 10 && (s.ctrl === 8 || s.ctrl === 0x40), JSON.stringify(s));
  await wait(1000);
  await S.shot('cai51-05-island');
  log(fail.length ? `FAILED: ${fail.join(' | ')}` : 'ALL OK');
  if (fail.length) process.exitCode = 1;
};
