// In-game looks at the brick-built buildings (headless, muted; docs/re/lego3d.md section 16.8): a fixed camera relative to a record.
//   sh tools/m4-snapshot-server.sh 5830; MODE... PARAMS='&hd=0&lego3d=1' BASE=http://localhost:5830/ PREFIX=x CAMS="GRGE:6,9,12:0,4,0;RESQ:..." sh tools/m5-botslot.sh node tools/browse.mjs http://localhost:5830/ tools/lego3d/steps/bldg-look.mjs --profile /tmp/le2-r6 --size 800x600 --out /tmp/r6/shots
// CAMS = "REC:dx,dy,dz:tx,ty,tz[:label]" (offsets from the record's position, world axes; the camera is patched in the page, the harness only). OFF=1: &mods=off (original). STAT=1: draws / triangles / lit vertices per shot.
import { island } from '../../steps/lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot, evaluate } = h;
  page.on('dialog', (d) => d.accept());
  const S = island(h);
  const base = process.env.BASE ?? 'http://localhost:5830/';
  await page.waitForSelector('.bdb-start', { timeout: 60000 }).catch(() => {});
  const zone = process.env.ZONE ?? 'z02LGI', prefix = process.env.PREFIX ?? 'look';
  await page.goto(`${base}?zone=${zone}&mute=1${process.env.OFF ? '&mods=off' : ''}${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  await S.start();
  await S.skipCutscenes();
  log('lego3d:', JSON.stringify(await evaluate(() => (window.__lego3d ? { pack: window.__lego3d.pack, failed: window.__lego3d.failed, archives: Object.fromEntries(Object.entries(window.__lego3d.archives).map(([k, v]) => [k, [v.files, v.cached, v.bytes]])) } : null))));
  log('active mods:', JSON.stringify(await evaluate(() => window.__le2Mods && window.__le2Mods.mods)));
  for (const sc of (process.env.CAMS ?? '').split(';').filter(Boolean)) {
    const [name, c, t, label] = sc.split(':');
    const cam = c.split(',').map(Number), tgt = t.split(',').map(Number);
    await evaluate((n) => { const w = window.__zone.world, r = w.records.find((x) => x.name === n); if (r?.ctrl) r.ctrl.flags &= ~2; window.__zone.loaded.pepper.flags &= ~2; }, name);
    await S.teleportNear(name, 12, 0.9); await wait(300);
    await evaluate(([n, cam, tgt]) => {
      const zz = window.__zone, w = zz.world, r = w.records.find((x) => x.name === n);
      if (!w.camera.__chase) w.camera.__chase = w.camera.chase;
      w.camera.chase = function () { const q = this.c; q[0] = r.x + cam[0]; q[1] = r.y + cam[1]; q[2] = r.z + cam[2]; q[3] = r.x + tgt[0]; q[4] = r.y + tgt[1]; q[5] = r.z + tgt[2]; this.updateView(); };
    }, [name, cam, tgt]);
    await S.untilTicks(async () => false, 60, 40);
    const tag = label ?? `${name}-${cam.join('_')}`;
    await shot(`${prefix}-${tag}`);
    log(tag, JSON.stringify(await evaluate(() => { const i = window.__zone.gr.info; const r = window.__zone.world.records.find((x) => x.name === 'GRGE'); return { draws: i.draws, triangles: i.triangles }; })));
  }
  log('record GRGE/RESQ', JSON.stringify(await evaluate(() => window.__zone.world.records.filter((x) => ['GRGE', 'RESQ'].includes(x.name)).map((r) => ({ n: r.name, x: r.x, y: r.y, z: r.z, ry: r.ry })))));
};
