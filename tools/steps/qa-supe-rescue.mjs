// QA bot of the island vehicles (train, Ptera / glider, station master): Pepper onto the rail (X / Z / GY env): the station master swoops, carries her to the nearest helipad and drops her
//   sh tools/m4-snapshot-server.sh 5931
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5931/?zone=z02LGI&debug=1" tools/steps/qa-supe-rescue.mjs --size 800x600 --out DIR
// No mute=1 (the audio engine runs; the browser itself is muted). Frames: DIR/<TAG>-*.png (TAG env), per-tick log + sound calls: $OUT/<kind>-<TAG>.json (OUT env, default /tmp/qa-vehicles).
// Helpers: tools/steps/lib-qa-vehicles.mjs (per-tick sampler on world.afterTick, sound log, the audio slots' playing flags).
import fs from 'node:fs';
import { qa } from './lib-qa-vehicles.mjs';
export default async (h) => {
  const Q = qa(h); const { S, page, wait, log, shot, evaluate } = Q;
  const tag = process.env.TAG ?? 's';
  const X = +(process.env.X ?? 0), Z = +(process.env.Z ?? 158);
  await Q.start(); await Q.install();
  await evaluate(() => { const w = window.__zone.world, r = w.records.find((x) => x.name === 'SUPE'); const n = r.ctrl.nodes.find((q) => q.kind === 'supe'); window.__ext = () => ({ ss: n.state, sm: n.mode, tm: +(+n.timer).toFixed(1), surf: w.pep.surfaceAtFeet, rd: n.road, pd: n.pad, ea: n.east, sclip: r.anim?.clip, sfr: r.anim ? +r.anim.frame.toFixed(1) : null, pfr: window.__zone.loaded.pepper.anim ? +window.__zone.loaded.pepper.anim.frame.toFixed(1) : null, sflags: r.flags }); });
  const nd = () => evaluate(() => { const w = window.__zone.world, r = w.records.find((x) => x.name === 'SUPE'); const n = r.ctrl.nodes.find((q) => q.kind === 'supe'); const P = window.__zone.loaded.pepper; const f = (v) => +v.toFixed(1); const sk = w.records[9]; return { s: [f(r.x), f(r.y), f(r.z)], ry: +r.ry.toFixed(2), st: n.state, mode: n.mode, tm: +(+n.timer).toFixed(1), P: [f(P.x), f(P.y), f(P.z)], pc: window.__zone.sh.vars.get(0x5e), surf: w.pep.surfaceAtFeet, sk: sk?.name + ':' + sk?.flags, clip: P.anim?.clip, cs: !!window.__zone.game?.debug?.().cutscene }; });
  log('pre', JSON.stringify(await nd()));
  // Pepper onto the rail
  log('tele', JSON.stringify(await evaluate(([x, z, GY]) => { const zz = window.__zone, w = zz.world, p = zz.loaded.pepper; p.x = x; p.z = z; const g = w.col.groundRay(x, GY, z); if (g > -1e30) p.y = g; p.ry = Math.PI / 2; p.rebuildYaw(); p.savePrev(); w.camera.init(p); return [p.x, p.y, p.z]; }, [X, Z, +(process.env.GY ?? 46)])));
  await Q.rec(true);
  let k = 0, last = '';
  const t0 = await S.ticks();
  for (let i = 0; i < 400; i++) {
    await S.untilTicks(async () => false, 10, 10);
    const s = await nd();
    if (i % 2 === 0 || s.st !== +last) { await shot(`${tag}-${String(k++).padStart(2, '0')}-st${s.st.toString(16)}`); log(i, JSON.stringify(s)); }
    last = s.st;
    if (i > 20 && s.st === 3 && s.pc === 1) break;
    if (k > 40) break;
  }
  await S.untilTicks(async () => false, 90, 20);
  await shot(`${tag}-${String(k++).padStart(2, '0')}-after`);
  log('after', JSON.stringify(await nd()));
  await Q.rec(false);
  const data = await Q.take(); const snd = await Q.snd();
  fs.mkdirSync(process.env.OUT ?? '/tmp/qa-vehicles', { recursive: true }); fs.writeFileSync(`${process.env.OUT ?? '/tmp/qa-vehicles'}/supe-${tag}.json`, JSON.stringify({ data, snd }));
  log('errs', JSON.stringify(Q.errs));
};
