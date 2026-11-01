// Lists the brick-effect slots of the island (record, state, stage, model files, bricks per model that the LEGO 3D generator replaced) at a story node (?node=N), no screenshots.
//   node tools/browse.mjs "http://localhost:5745/?zone=z02LGI&node=30&mute=1&hd=0&lego3d=bricks" tools/lego3d/steps/bricks-probe.mjs --profile /tmp/le2-x --size 800x600 --out DIR
import { island } from '../../steps/lib-island.mjs';
export default async (h) => {
  const { page, wait, log } = h;
  const S = island(h);
  await S.start(); await S.skipCutscenes(); await wait(500);
  const rows = await page.evaluate(() => {
    const z = window.__zone, fx = z.world.ext.get('brickFx');
    if (!fx) return 'no fx';
    return fx.slots.filter(Boolean).map((s) => ({ rec: s.record.name, pos: [s.record.x, s.record.y, s.record.z].map((v) => +v.toFixed(1)), state: s.state, stage: s.stage, running: s.running, enabled: !!s.record.enabled, models: s.models.map((m) => `${m.file}:${m.bricks.length}`) }));
  });
  log(JSON.stringify(rows, null, 0).replace(/\},\{/g, '},\n{'));
};
