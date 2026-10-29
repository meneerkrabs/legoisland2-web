// Restored content, feature 'swimmer': BML2 (the swimming Brikimal) on the open sea off the north-east coast. Headless + muted:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5521/?zone=z02LGI&node=2&restored=1&mute=1" tools/steps/restore-swimmer.mjs --size 1280x800 --out /tmp/restore-swimmer
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  await S.skipCutscenes();
  const bml = () => page.evaluate(() => { const r = window.__zone.world.records.find((x) => x.name === 'BML2'); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), z: +r.z.toFixed(1), flags: r.flags, nodes: r.ctrl?.nodes.map((n) => n.kind) ?? [], v: window.__zone.world.vars.get(0x2e), sea: window.__zone.world.seaLevel }; });
  const b0 = await bml();
  log('BML2', JSON.stringify(b0));
  expect('BML2 has the Brikimal node and sits at the sea level', b0.nodes.includes('Brikimal') && Math.abs(b0.y - b0.sea) < 4, JSON.stringify(b0));
  // stand on the nearest ground (the coast) facing the swimmer; the camera behind Pepper looks out to sea. Several shots over time (the shape counter changes every 300 ticks)
  // Pepper (hidden) hovers 16 units east of the swimmer at the water, camera behind her facing it: a close picture (the swimmer wanders about 20 units around its home)
  const near = await page.evaluate(([bx, bz]) => {
    const z = window.__zone, w = z.world, p = z.loaded.pepper;
    const x = bx + 16, zz = bz;
    p.x = x; p.z = zz; p.y = w.seaLevel + 3; p.ry = Math.atan2(bx - x, bz - zz); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
    p.flags &= ~2;
    return { x, z: zz };
  }, [b0.x, b0.z]);
  log('camera at', JSON.stringify(near));
  expect('camera placed', !!near);
  await wait(800);
  for (let i = 0; i < 4; i++) {
    await S.untilTicks(async () => false, 200, 40);
    const b = await bml();
    log(`t${i}`, JSON.stringify(b));
    await shot(`swimmer-${i}-shape${b.v}`);
  }
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'passed');
  if (fail.length) process.exitCode = 1;
};
