// What a player can actually see of a replaced building (docs/re/lego3d.md section 16.9): Pepper is put at an offset from a record and walks (real keys, real collision, the game's own camera), then a screenshot.
//   POSES="REC:dx,dz:walkMs:label[:faceX,faceZ]" separated by ';' (dx, dz = world offset from the record; walkMs = ArrowUp held; face = a world offset to look at, default the record)
//   BASE=http://localhost:5851/ PREFIX=r PARAMS='&hd=0&lego3d=1' [OFF=1] sh tools/m5-botslot.sh node tools/browse.mjs $BASE tools/lego3d/steps/bldg-reach.mjs --profile /tmp/le2-r7 --size 800x600 --out /tmp/r7/shots
import { island } from '../../steps/lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot, evaluate } = h;
  page.on('dialog', (d) => d.accept());
  const S = island(h);
  await page.waitForSelector('.bdb-start', { timeout: 60000 }).catch(() => {});
  const zone = process.env.ZONE ?? 'z02LGI', prefix = process.env.PREFIX ?? 'reach';
  await page.goto(`${process.env.BASE ?? 'http://localhost:5830/'}?zone=${zone}&mute=1${process.env.OFF ? '&mods=off' : ''}${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  await S.start(); await S.skipCutscenes();
  for (const sc of (process.env.POSES ?? '').split(';').filter(Boolean)) {
    const [name, d, ms, label, f] = sc.split(':');
    const [dx, dz] = d.split(',').map(Number), face = f ? f.split(',').map(Number) : [0, 0];
    await evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n); if (r?.ctrl) r.ctrl.flags &= ~2; window.__zone.loaded.pepper.flags &= ~2; }, name);
    await evaluate(([n, dx, dz, face]) => {
      const z = window.__zone, w = z.world, p = z.loaded.pepper, r = w.records.find((x) => x.name === n);
      p.x = r.x + dx; p.z = r.z + dz; p.y = r.y + 1;
      const g = w.col.groundRay(p.x, r.y + 20, p.z); if (g > -1e30) p.y = g;
      p.ry = Math.atan2(r.x + face[0] - p.x, r.z + face[1] - p.z); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
    }, [name, dx, dz, face]);
    await wait(400);
    if (+ms > 0) await S.hold('ArrowUp', +ms);
    await S.untilTicks(async () => false, 30, 40);
    await shot(`${prefix}-${label}`);
    const st = await S.state();
    log(label, JSON.stringify(await evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n), p = window.__zone.loaded.pepper; return { pepper: [p.x - r.x, p.y - r.y, p.z - r.z].map((v) => +v.toFixed(1)), ry: +r.ry.toFixed(2) }; }, name)));
  }
};
