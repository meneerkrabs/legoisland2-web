// Checks in the running page that the generated brick meshes are in use: vertex counts of a few LOD meshes of the BrickLibrary of the island (and the first-colour counts).
import { island } from '../../steps/lib-island.mjs';
export default async (h) => {
  const { page, wait, log } = h;
  const S = island(h);
  await S.start(); await wait(500);
  log(JSON.stringify(await page.evaluate(() => {
    const z = window.__zone, lib = z.world.ext.get('brickLib') ?? z.world.ext.get('brickLibrary');
    if (!lib) return { keys: [...z.world.ext.keys()] };
    const out = {};
    for (const n of ['window4x2', 'door4x5_1pane', 'fat1x2_45slopeinvert', 'wheel01', 'fat3x2']) { const t = lib.types.find((x) => x && x.name === n); if (t) { const m = lib.meshOf(t, 0); out[n] = [m.vertexCount, m.indices.length / 3, lib.splitOf(t, 0)]; } }
    return out;
  })));
};
