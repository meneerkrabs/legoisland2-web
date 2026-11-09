// QA bot of the island vehicles (train, Ptera / glider, station master): board the Ptera (VEH=GLDR: the glider) with Ctrl, take off, cruise / Space / Alt / turns / dive / climb (node 52 = era 3)
//   sh tools/m4-snapshot-server.sh 5931
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5931/?zone=z02LGI&node=52&debug=1" tools/steps/qa-ptera-fly.mjs --size 800x600 --out DIR
// No mute=1 (the audio engine runs; the browser itself is muted). Frames: DIR/<TAG>-*.png (TAG env), per-tick log + sound calls: $OUT/<kind>-<TAG>.json (OUT env, default /tmp/qa-vehicles).
// Helpers: tools/steps/lib-qa-vehicles.mjs (per-tick sampler on world.afterTick, sound log, the audio slots' playing flags).
import fs from 'node:fs';
import { qa } from './lib-qa-vehicles.mjs';
export default async (h) => {
  const Q = qa(h); const { S, page, wait, log, shot, evaluate } = Q;
  const tag = process.env.TAG ?? 'p';
  const veh = process.env.VEH ?? 'PTER';
  await Q.start(); await Q.install();
  const nd = () => evaluate((veh) => { const w = window.__zone.world, r = w.records.find((x) => x.name === veh); const n = r.ctrl.nodes.find((q) => q.kind === 'Ptera'); const P = window.__zone.loaded.pepper; let V = null; for (const [, v] of w.ext) if (v && typeof v === 'object' && 'pads' in v) V = v; const f = (v) => +v.toFixed(2); return { x: f(r.x), y: f(r.y), z: f(r.z), ry: f(r.ry), rx: f(r.rx), rz: f(r.rz), st: n.state, sp: f(n.speed), pad: n.pad, yr: +n.yawRate.toFixed(4), pr: +n.pitchRate.toFixed(4), pc: window.__zone.sh.vars.get(0x5e), v5: window.__zone.sh.vars.get(0xc5), va9: window.__zone.sh.vars.get(0xa9), ic: window.__zone.sh.vars.get(0x0c), clip: r.anim?.clip, pclip: P.anim.clip, P: [f(P.x), f(P.y), f(P.z)], bounce: n.bouncing, cur: V.current?.name ?? null }; }, veh);
  log('tele', JSON.stringify(await S.teleportNear(veh, 7, 0.8)));
  await S.untilTicks(async () => false, 10, 20);
  log('pre', JSON.stringify(await nd()));
  await shot(`${tag}-0-parked`);
  await Q.rec(true);
  await Q.key('ControlLeft', 3);
  log('post-ctrl', JSON.stringify(await nd()));
  let k = 1;
  for (let i = 0; i < 6; i++) { await S.untilTicks(async () => false, 14, 20); await shot(`${tag}-${k++}-takeoff`); }
  log('takeoff', JSON.stringify(await nd()));
  await S.until(async () => (await nd()).st === 0, 20000, 60);
  log('flying', JSON.stringify(await nd()));
  const seg = async (name, keys, ticks, shots = 2) => {
    for (const key of keys) await page.keyboard.down(key);
    for (let i = 0; i < shots; i++) { await S.untilTicks(async () => false, ticks / shots, 20); await shot(`${tag}-${k++}-${name}`); }
    for (const key of keys) await page.keyboard.up(key);
    log(name, JSON.stringify(await nd()));
  };
  await seg('cruise', [], 40, 1);
  await seg('space', ['Space'], 80, 2);
  await seg('alt', ['AltLeft'], 100, 1);
  await seg('left', ['ArrowLeft'], 120, 2);
  await seg('right', ['ArrowRight'], 140, 2);
  await seg('down', ['ArrowDown'], 100, 2);
  await seg('up', ['ArrowUp'], 140, 2);
  await seg('level', [], 100, 1);
  await Q.rec(false);
  const data = await Q.take(); const snd = await Q.snd();
  fs.mkdirSync(process.env.OUT ?? '/tmp/qa-vehicles', { recursive: true }); fs.writeFileSync(`${process.env.OUT ?? '/tmp/qa-vehicles'}/ptera-${tag}.json`, JSON.stringify({ data, snd }));
  log('errs', JSON.stringify(Q.errs));
};
