// Pepper on the locomotive (headless, muted): the ride of src/island/pizza/train.ts (Pepper's seat at (1, 4.5, -6.5), the cab) without waiting for a station: the boarding branch of TrainNode.prerender is
// applied by hand (node.riding, PEPPER_CONTROL = 0x80, the vehicle globals' current record, the speed factor), then Up / Space speed it up; a shot every GAP ticks, camera CAM="side,back,up" in the loco's frame
// (default 5,-9,4: the cab from behind and the side), or the game's own ride camera with CAM=game.
//   BASE=http://localhost:PORT/  PARAMS="&lego3d=1"  N=5  GAP=25  PREFIX=train  CAM=5,-9,4   sh tools/m5-botslot.sh node tools/browse.mjs $BASE tools/lego3d/steps/vehicles-train.mjs --profile DIR --out DIR
import { island } from '../../steps/lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot, evaluate } = h;
  page.on('dialog', (d) => d.accept());
  const S = island(h);
  await page.waitForSelector('.bdb-start', { timeout: 60000 }).catch(() => {});
  await page.goto(`${process.env.BASE}?zone=z02LGI&mute=1${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  await S.start(); await S.skipCutscenes();
  const prefix = process.env.PREFIX ?? 'train';
  log('board', JSON.stringify(await evaluate(() => {
    const z = window.__zone, w = z.world, rec = w.records.find((r) => r.name === 'TRNL'), node = rec?.ctrl?.nodes?.find((n) => 'seat' in n && 'riding' in n);
    if (!node) return 'no train node';
    let V = null, G = null;
    for (const [, v] of w.ext) { if (v && typeof v === 'object' && 'current' in v && 'range' in v) V = v; if (v && typeof v === 'object' && 'boarded' in v && 'factor' in v) G = v; }
    if (!V || !G) return `no globals V=${!!V} G=${!!G}`;
    V.current = rec; w.vars.set(0x5e, 0x80); node.riding = true; node.stopTicks = 0; node.moving = false; G.factor = 0.1; G.boarded = true; node.phase = 0;
    z.loaded.pepper.anim?.start(0x43, 0);
    return 'riding';
  })));
  await wait(800);
  const cam = process.env.CAM ?? '5,-9,4';
  if (cam !== 'game') {
    const [cs, cb, cu] = cam.split(',').map(Number);
    await evaluate(([cs, cb, cu]) => {
      const w = window.__zone.world, r = w.records.find((x) => x.name === 'TRNL'), c = w.camera;
      if (!c.__uv) c.__uv = c.updateView.bind(c);
      c.updateView = function () { const v = this.c, a = r.ry ?? 0, sa = Math.sin(a), ca = Math.cos(a); v[0] = r.x + sa * cb + ca * cs; v[1] = r.y + cu; v[2] = r.z + ca * cb - sa * cs; v[3] = r.x; v[4] = r.y + 3.5; v[5] = r.z; c.__uv(); };
    }, [cs, cb, cu]);
  }
  await page.keyboard.down('Space');
  for (let k = 0; k < +(process.env.N ?? 5); k++) {
    await S.untilTicks(async () => false, +(process.env.GAP ?? 25), 40);
    await shot(`${prefix}-${k}`);
    log(k, JSON.stringify(await evaluate(() => { const w = window.__zone.world, r = w.records.find((x) => x.name === 'TRNL'), p = window.__zone.loaded.pepper; return { loco: [r.x, r.y, r.z].map((v) => +v.toFixed(1)), pepper: [p.x, p.y, p.z].map((v) => +v.toFixed(1)), var5e: window.__zone.sh.vars.get(0x5e) }; })));
  }
  await page.keyboard.up('Space');
};
