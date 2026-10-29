// exploration helper (not a test): prints the triggers of the Dino island, then stands Pepper next to PTER (node 50) and reports the portal
import { hub } from './lib-hub.mjs';
export default async ({ page, wait, log, shot }) => {
  const H = hub({ page, wait, log, shot }, 'z23DIP');
  await H.waitHub(); await wait(500); await H.start();
  const info = await page.evaluate(() => {
    const z = window.__zone, w = z.world, out = [];
    for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) {
      if (/StartCSM|MeetPepp|hOLO/.test(n.kind)) out.push({ rec: r.index, name: r.name, kind: n.kind, pos: [r.x, r.y, r.z].map((v) => +v.toFixed(1)), gate: [n.var, n.mask, n.value], a: n.a ? JSON.parse(JSON.stringify(n.a)) : undefined, r2: n.radius2 });
    }
    return out;
  });
  for (const i of info) log(JSON.stringify(i));
  await H.freePepper();
  await H.skipCutscenes();
  await H.teleportNear('PTER', 6, 0.5);
  await wait(1500);
  log(JSON.stringify(await page.evaluate(() => { const z = window.__zone, r = z.world.records.find((x) => x.name === 'PTER'); const p = z.loaded.pepper; return { pter: [r.x, r.y, r.z], pep: [p.x, p.y, p.z], dist: r.ctrl.distSq, flags: r.flags, nodes: r.ctrl.nodes.map((n) => n.kind + ':' + (n.fired ?? '') + ':' + (n.age ?? '')), v257: z.sh.vars.get(0x101), v58: z.sh.vars.get(0x58) }; })));
  await shot('pter');
};
