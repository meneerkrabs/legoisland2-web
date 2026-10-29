// Restored content, feature 'arrow': the objective arrow at a story node (node from the URL). Muted, own Chromium:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z02LGI&node=8&restored=1&mute=1&hold=1" tools/steps/restore-arrow.mjs --size 1280x800 --out /tmp/restore
import { island } from './lib-island.mjs';

export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  await S.start();
  for (let i = 0; i < 4; i++) { await S.skipCutscenes(); await wait(300); if (!(await S.state())?.cs) break; }
  await wait(1200);
  const info = await page.evaluate(() => { const z = window.__zone, d = z.game.debug(); const c = z.world.camera.c, p = z.world.focus; return { node: d.node, mode: d.objective.mode, recs: d.objective.recs, pnode: d.objective.node, target: d.objective.target, radius: Math.sqrt(z.game.ictx.goal.radiusSq), pepper: [p.x, p.y, p.z].map((x) => +x.toFixed(1)), cs: d.cutscene, extras: z.game.ctx.hud.extras.length }; });
  log(JSON.stringify(info));
  await shot(`arrow-node${info.node}`);
  // turn the camera: Pepper walks right for a moment, the arrow turns with the view
  await S.hold('ArrowRight', 700); await wait(400);
  await shot(`arrow-node${info.node}-turned`);
  // walk up to the objective: the camera is put behind Pepper facing it, so the arrow must point straight up; then to the left of it (arrow turns right)
  if (info.mode === 1) {
    const name = await page.evaluate((r) => window.__zone.world.records[r].name, info.recs[0]);
    await S.teleportNear(name, 200, 0); await wait(700); await shot(`arrow-node${info.node}-ahead`);
    await S.teleportNear(name, 200, 1.57); await wait(700); await shot(`arrow-node${info.node}-side`);
    const a = await page.evaluate(() => { const z = window.__zone, c = z.world.camera.c, p = z.world.focus, t = z.game.ictx.objective.target(p); const fx = c[3] - c[0], fz = c[5] - c[2]; return { fwd: [fx, fz].map((x) => +x.toFixed(1)), d: [t.pos[0] - p.x, t.pos[2] - p.z].map((x) => +x.toFixed(1)), viewRight: [c[9], c[11]].map((x) => +x.toFixed(2)) }; });
    log('side', JSON.stringify(a));
  }
};
