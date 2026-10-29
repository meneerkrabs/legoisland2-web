// Restored content, feature 'looks': every vehicle with extra looks shown in its original look 0, its last original look and every new look; then Enter cycles the police car through the
// real machinery (cycler + brick morph). Headless + muted:
//   sh tools/m4-snapshot-server.sh 5521
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5521/?zone=z02LGI&node=2&restored=1&mute=1" tools/steps/restore-looks.mjs --size 1280x800 --out /tmp/restore-looks
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  await S.skipCutscenes();
  const info = () => page.evaluate(() => {
    const w = window.__zone.world, L = w.ext.get('island.looks');
    return L ? L.entries.map((e) => ({ rec: e.rec, name: w.records[e.rec].name, n: e.looks.length, part: e.part, v: e.varIdx, x: w.records[e.rec].x, y: w.records[e.rec].y, z: w.records[e.rec].z })) : null;
  });
  await S.until(async () => !!(await info()), 20000);
  const entries = await info();
  log('roster', JSON.stringify(entries.map((e) => `${e.name}:${e.n}`)));
  const want = process.env.ONLY ? process.env.ONLY.split(',') : ['AMBU', 'JSKI', 'RHEL', 'PCAR'];
  const orig = { AMBU: 7, JSKI: 7, RHEL: 6, SPD0: 9, PCAR: 7 };
  const ANG = { JSKI: 4.0 };
  const setLook = (rec, part) => page.evaluate(([rec, part]) => {
    const z = window.__zone, w = z.world, L = w.ext.get('island.looks'), e = L.entries.find((x) => x.rec === rec);
    e.part = part; w.vars.set(e.varIdx, part);
    return w.vars.get(e.varIdx);
  }, [rec, part]);
  // the record stays where it is (its AI is switched off: the ambulance and the speedsters drive around), Pepper is hidden and stands 11 units away at an angle: a clean picture of the vehicle
  const freeze = (name) => page.evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n); if (r.ctrl) r.ctrl.flags &= ~2; window.__zone.loaded.pepper.flags &= ~2; }, name);
  const settle = async (name) => { await wait(400); await S.until(async () => page.evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return (r.flags & 0x8000) === 0 && (r.flags & 2) !== 0; }, name), 30000, 300); await S.untilTicks(async () => false, 150, 40); };
  for (const name of want) {
    const e = entries.find((x) => x.name === name);
    if (!e) continue;
    const parts = [0, ...Array.from({ length: e.n - orig[name] }, (_, i) => orig[name] + i)];
    for (const part of parts) {
      await setLook(e.rec, part);
      await freeze(name);
      await S.teleportNear(name, 11, ANG[name] ?? 0.9); await wait(300);
      await S.teleportNear(name, 11, ANG[name] ?? 0.9);
      await settle(name);
      await shot(`${name}-look${part}${part >= orig[name] ? '-NEW' : ''}`);
    }
  }
  // the real Enter key on the police car: the cycler, the busy list and the brick morph
  if (want.includes('PCAR')) {
    const e = entries.find((x) => x.name === 'PCAR');
    await setLook(e.rec, e.n - 1); await settle('PCAR');
    await S.teleportNear('PCAR', 6, 0.6); await wait(300);
    const before = (await info()).find((x) => x.name === 'PCAR').part;
    await S.tap('Enter', 90);
    await wait(1500);
    const mid = await page.evaluate(() => { const r = window.__zone.world.records.find((x) => x.name === 'PCAR'); return { flags: r.flags }; });
    await settle('PCAR');
    const after = (await info()).find((x) => x.name === 'PCAR');
    expect('Enter on the police car after the last new look wraps to the original paint', before === e.n - 1 && after.part === 0, `part ${before} -> ${after.part}, flags during ${mid.flags.toString(16)}`);
    await shot('PCAR-enter-wrap');
  }
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'passed');
  if (fail.length) process.exitCode = 1;
};
