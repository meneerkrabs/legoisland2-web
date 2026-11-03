// In-game looks at the glass of the buildings the LEGO 3D option does not replace (headless, muted; docs/re/lego3d.md section 16.10): the developer corner's free camera inside a building, and the game's own camera outside.
//   sh tools/m4-snapshot-server.sh 5830
//   PARAMS='&lego3d=1' PREFIX=after CAMS="SHP2:-300.6,22.77,94.38:-300.6,22.77,90.5:shop-window" sh tools/m5-botslot.sh node tools/browse.mjs http://localhost:5830/ tools/lego3d/steps/glass-look.mjs --profile /tmp/le2-r10 --size 800x600 --out /tmp/r10/shots
// CAMS = "REC:x,y,z:tx,ty,tz[:label]" in WORLD coordinates (`node tools/lego3d/glass-pick.mjs zone REC mesh group...` prints them: a room point of the mesh, the record's matrix applied; the island's near plane is 4.0, so the pane must be more than 4 units ahead). The page runs in debug mode (`&debug=1`): the camera is put at the eye with the
// chase camera, then the corner (key `) is opened and "Vrije camera aan" ticked (it takes the camera over), the chase camera is released, the corner closed. FLY="ArrowLeft:600,ArrowUp:300" then holds those keys (the corner's flight keys:
// Left / Right turn, Up / Down move along the view, with Ctrl sideways / pitch). OUTSIDE=REC:dist:angle:label shots use the game's own camera (no corner). `&mods=off` is not needed: `&lego3d=0` is the original.
import { island } from '../../steps/lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot, evaluate } = h;
  page.on('dialog', (d) => d.accept());
  const S = island(h);
  const base = process.env.BASE ?? 'http://localhost:5830/';
  await page.waitForSelector('.bdb-start', { timeout: 60000 }).catch(() => {});
  const zone = process.env.ZONE ?? 'z02LGI', prefix = process.env.PREFIX ?? 'glass';
  await page.goto(`${base}?zone=${zone}&mute=1&debug=1${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  await S.start();
  await S.skipCutscenes();
  log('lego3d:', JSON.stringify(await evaluate(() => (window.__lego3d ? { pack: window.__lego3d.pack, failed: window.__lego3d.failed, archives: Object.fromEntries(Object.entries(window.__lego3d.archives).map(([k, v]) => [k, [v.files, v.cached, v.bytes, v.by]])) } : null))));
  const info = () => evaluate(() => { const i = window.__zone.gr.info; return { draws: i.draws, triangles: i.triangles }; });
  // outside, the game's own camera
  for (const sc of (process.env.OUTSIDE ?? '').split(';').filter(Boolean)) {
    const [name, dist, ang, label] = sc.split(':');
    await S.teleportNear(name, +dist, +ang); await wait(300);
    await S.untilTicks(async () => false, 60, 40);
    await shot(`${prefix}-${label ?? name + '-out'}`);
    log(label ?? name, JSON.stringify(await info()));
  }
  let corner = false;
  const clickCheck = async (text) => evaluate((t) => { const el = [...document.querySelectorAll('label, .dc-check')].find((e) => e.textContent.trim().startsWith(t)); const inp = el?.querySelector?.('input') ?? el; if (inp) inp.click(); return inp ? (inp.checked ?? true) : false; }, text);
  for (const sc of (process.env.CAMS ?? '').split(';').filter(Boolean)) {
    const [name, c, t, label] = sc.split(':');
    const cam = c.split(',').map(Number), tgt = t.split(',').map(Number);
    await evaluate((n) => { const w = window.__zone.world, r = w.records.find((x) => x.name === n); if (r?.ctrl) r.ctrl.flags &= ~2; window.__zone.loaded.pepper.flags &= ~2; }, name);
    await S.teleportNear(name, 12, 0.9); await wait(300);
    // 1. put the camera at the eye (the chase camera, patched in the page)
    await evaluate(([cam, tgt]) => {
      const w = window.__zone.world;
      if (!w.camera.__chase) w.camera.__chase = w.camera.chase;
      w.camera.chase = function () { const q = this.c; q[0] = cam[0]; q[1] = cam[1]; q[2] = cam[2]; q[3] = tgt[0]; q[4] = tgt[1]; q[5] = tgt[2]; this.updateView(); };
    }, [cam, tgt]);
    await S.untilTicks(async () => false, 30, 40);
    // 2. the corner's free camera takes it over (key `, tick "Vrije camera aan"), the chase camera is released, the corner closes
    if (!process.env.NOCORNER) {
      await page.keyboard.press('Backquote'); await wait(600);
      await evaluate(() => { [...document.querySelectorAll('.dc-tab')].find((e) => /Camera en tekenen/.test(e.textContent))?.click(); });
      await wait(400);
      log('free camera tick:', await clickCheck('Vrije camera aan'));
      await wait(300);
      await evaluate(() => { const w = window.__zone.world; if (w.camera.__chase) { w.camera.chase = w.camera.__chase; delete w.camera.__chase; } });
      await page.keyboard.press('Backquote'); await wait(400);
      corner = true;
    }
    for (const f of (process.env.FLY ?? '').split(',').filter(Boolean)) { const [k, ms] = f.split(':'); await S.hold(k.replace('Ctrl+', ''), +ms); }
    await S.untilTicks(async () => false, 40, 40);
    const tag = label ?? `${name}-cam`;
    await shot(`${prefix}-${tag}`);
    log(tag, JSON.stringify(await info()), JSON.stringify(await evaluate(() => Array.from(window.__zone.world.camera.c.slice(0, 6)).map((v) => +v.toFixed(2)))));
    if (!process.env.NOCORNER) {   // back to the game's camera for the next one
      await page.keyboard.press('Backquote'); await wait(400);
      await clickCheck('Vrije camera aan'); await wait(200);
      await page.keyboard.press('Backquote'); await wait(300);
    }
  }
  log('corner used:', corner);
};
