// Test helper of M5 / z40OGL: a hub world of Ogel's island (tools/lib/hub-load.mjs) with the recording stand-ins the PeppSwit nodes talk to (sound log, render modes, particles).
// `loadOgl(ctx, { node })` -> H as loadHub (H.world, H.pepper, H.ictx ...) plus `H.log` (one array of strings: `p2 #id`, `p3 #id x y z`, `s #id`, `mode record mask mode`) in call order.
import '../../src/zones/index.ts';
import '../../src/zones/z40OGL/peppswit/index.ts';
import { loadHub } from './hub-load.mjs';
import { FakeFx } from './fake-fx.mjs';
import { decorStore } from '../../src/island/decor.ts';

export function loadOgl(ctx, opts = {}) {
  decorStore.blob = null;   // the stored decor / outfit state is process-wide (the game's saved state): every load here is a new game, whatever the tests before left in it
  const H = loadHub(ctx, { zone: 'z40OGL', node: opts.node ?? 64, vars: opts.vars });
  const ic = H.ictx;
  H.log = [];
  ic.fx = new FakeFx(H.world);
  const f = Math.fround;
  ic.sfx = (id) => { H.log.push(`p2 #${id}`); };
  ic.stopSfx = (id) => { H.log.push(`s #${id}`); };
  ic.sfxAt = (id, pos) => { H.log.push(`p3 #${id} ${pos.map((v) => f(v)).join(' ')}`); };
  ic.partMode = (rec, mask, mode) => { H.log.push(`mode ${rec.index} ${mask} ${mode}`); };
  H.world.playSound = (id) => ic.sfx(id);
  return H;
}
