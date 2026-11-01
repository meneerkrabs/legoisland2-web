// Finished brick models of the island (houses, cars) for before / after shots of the LEGO 3D brick library: per record (REC=HOSP,POLB,... ) the slot's morph is run to its end (BrickFxManager.finish),
// the bricks are shown (burst kind 6) and Pepper is put in front of the record on two sides (the game's own camera follows). Headless + muted.
//   PREFIX=new REC=HOSP,POLB,SPD0 node tools/browse.mjs "http://localhost:5745/?zone=z02LGI&node=30&mute=1&hd=0&lego3d=bricks" tools/lego3d/steps/bricks-view.mjs --profile /tmp/le2-x --size 800x600 --out DIR
import { island } from '../../steps/lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const prefix = process.env.PREFIX ?? 'v', recs = (process.env.REC ?? 'HOSP').split(','), dist = Number(process.env.DIST ?? 28);
  await S.start(); await S.skipCutscenes(); await wait(500);
  for (const name of recs) {
    const info = await page.evaluate((n) => {
      const z = window.__zone, fx = z.world.ext.get('brickFx'), r = z.world.records.find((x) => x.name === n);
      if (!fx || !r) return null;
      r.enabled = true;
      for (const s of fx.slots) if (s && s.record === r) { fx.finish(s.index); }
      fx.burst(r, 6);
      // the finished model is drawn as long as the slot says so: keep `drawn` and the bricks' visibility on, with the record's matrix
      const sl = fx.slots.find((x) => x && x.record === r);
      if (sl) { const m = sl.models[sl.models.length - 1]; for (const mm of sl.models) mm.parent = r.m; const keep = () => { sl.drawn = true; for (const b of m.bricks) b.visible = true; }; keep(); window.__keep = window.__keep ?? []; window.__keep.push(keep); if (!window.__keepT) window.__keepT = setInterval(() => window.__keep.forEach((f) => f()), 16); }
      const s = fx.slots.find((x) => x && x.record === r);
      return { pos: [r.x, r.y, r.z], models: s?.models.length, bricks: s?.models[s.models.length - 1]?.bricks.length };
    }, name);
    log(name, JSON.stringify(info));
    if (!info) continue;
    for (const [k, ang] of [['a', 0.6], ['b', 2.6]]) {
      await S.teleportNear(name, dist, ang);   // Pepper (and the game's camera behind him) in front of the record, looking at it
      await wait(1500);
      await S.teleportNear(name, dist, ang);
      await wait(800);
      await shot(`${prefix}-${name}-${k}`);
    }
  }
};
