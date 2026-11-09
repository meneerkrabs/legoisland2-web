// QA bot of the island vehicles (train, Ptera / glider, station master): board at the first station with the real Ctrl, ride, brake at the north station, get off with Ctrl
//   sh tools/m4-snapshot-server.sh 5931
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5931/?zone=z02LGI&debug=1" tools/steps/qa-train-ride.mjs --size 800x600 --out DIR
// No mute=1 (the audio engine runs; the browser itself is muted). Frames: DIR/<TAG>-*.png (TAG env), per-tick log + sound calls: $OUT/<kind>-<TAG>.json (OUT env, default /tmp/qa-vehicles).
// Helpers: tools/steps/lib-qa-vehicles.mjs (per-tick sampler on world.afterTick, sound log, the audio slots' playing flags).
import fs from 'node:fs';
import { qa } from './lib-qa-vehicles.mjs';
export default async (h) => {
  const Q = qa(h); const { S, page, wait, log, shot, evaluate } = Q;
  const tag = process.env.TAG ?? 'b';
  await Q.start(); await Q.install();
  const nd = () => evaluate(() => { const w = window.__zone.world, r = w.records.find((x) => x.name === 'TRNL'); const n = r.ctrl.nodes.find((q) => q.kind === 'train'); const g = w.ext.get('train'); return { x: +r.x.toFixed(1), z: +r.z.toFixed(1), stop: n.stopTicks, phase: n.phase, riding: n.riding, moving: n.moving, f: +g.factor.toFixed(3), route: n.routeIdx, pc: window.__zone.sh.vars.get(0x5e), ic: window.__zone.sh.vars.get(0x0c), t: w.tickCount }; });
  const toPlatform = () => evaluate(() => {
    const z = window.__zone, w = z.world, P = z.loaded.pepper, r = w.records.find((x) => x.name === 'TRNL');
    for (const s of [1, -1]) {
      const out = [r.x + s * -8 * r.m[0], r.y + 8 + s * -8 * r.m[1], r.z + s * -8 * r.m[2]];
      const hh = w.col.probe(r, out, [0, -16, 0], 3);
      if (hh && (hh.rec === w.records[5] || hh.rec === w.records[6])) { P.x = out[0]; P.z = out[2]; P.y = hh.point[1]; P.ry = Math.atan2(r.x - P.x, r.z - P.z); P.rebuildYaw(); P.savePrev(); w.camera.init(P); return { side: s, rec: hh.rec.name, at: [P.x, P.y, P.z].map((v) => +v.toFixed(1)) }; }
    }
    return null;
  });
  await S.until(async () => { const n = await nd(); return n.stop > 0 && n.x > 150; }, 200000, 200);
  log('platform', JSON.stringify(await toPlatform()));
  await S.untilTicks(async () => false, 6, 20);
  await Q.key('ControlLeft', 3);
  await page.keyboard.down('ArrowUp');
  // ride until x<125 on the north run, then brake
  await S.until(async () => { const n = await nd(); return n.route === 2 && n.x < 128; }, 200000, 60);
  await page.keyboard.up('ArrowUp'); await page.keyboard.down('ArrowDown');
  await Q.rec(true);
  let k = 0;
  const icons = [];
  await S.until(async () => { const n = await nd(); icons.push([n.x, n.ic]); return !n.moving; }, 60000, 30);
  await page.keyboard.up('ArrowDown');
  log('braked', JSON.stringify(await nd()));
  await S.untilTicks(async () => false, 10, 20);
  await shot(`t${tag}-${k++}-stopped`);
  log('icon at stop', JSON.stringify(await evaluate(() => ({ ic: window.__zone.sh.vars.get(0x0c) }))));
  await Q.key('ControlLeft', 3);
  log('after Ctrl', JSON.stringify(await nd()), JSON.stringify(await evaluate(() => { const P = window.__zone.loaded.pepper; return { P: [P.x, P.y, P.z].map((v) => +v.toFixed(2)), clip: P.anim.clip, ry: P.ry }; })));
  for (let i = 0; i < 4; i++) { await shot(`t${tag}-${k++}-left`); await S.untilTicks(async () => false, 40, 20); log('t', JSON.stringify(await nd())); }
  // walk a bit on the platform
  await page.keyboard.down('ArrowUp'); await S.untilTicks(async () => false, 30, 20); await page.keyboard.up('ArrowUp');
  await shot(`t${tag}-${k++}-walk`);
  await S.untilTicks(async () => false, 200, 40);
  await shot(`t${tag}-${k++}-later`);
  log('later', JSON.stringify(await nd()), JSON.stringify(await S.state()));
  await Q.rec(false);
  const data = await Q.take(); const snd = await Q.snd();
  fs.mkdirSync(process.env.OUT ?? '/tmp/qa-vehicles', { recursive: true }); fs.writeFileSync(`${process.env.OUT ?? '/tmp/qa-vehicles'}/train-${tag}.json`, JSON.stringify({ data, snd, icons }));
  log('errs', JSON.stringify(Q.errs));
};
