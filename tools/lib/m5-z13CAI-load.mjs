// z13CAI node-test world: tools/lib/hub-load.mjs (emulated set-up + the framework's world work, mock island context) + what src/zones/z13CAI/index.ts adds after the set-up
// (`applyCaiSetup`: Pepper's chain, the helipad table, the vehicle arrival, the gulls' constructors, the roster) and in `onCreate` (var 0xc5).
import { loadHub, tick, press, hold } from './hub-load.mjs';
import { applyCaiSetup } from '../../src/zones/z13CAI/index.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';

export { tick, press, hold };
export function loadCai(ctx, opts = {}) {
  const H = loadHub(ctx, { zone: 'z13CAI', node: opts.node ?? 33, vars: opts.vars ?? {}, bricks: opts.bricks });
  H.ictx.fx = null;                  // the mock's `fx: []` list of hub-load.mjs is not the particle engine src/island/emitters.ts looks for (`ictx.fx`)
  // the framework's ctorInit pass (src/hub/game.ts afterSetup: every node that defines `ctorInit(world, record)`, in record order), then the zone's own afterSetup
  for (const rec of H.world.records) for (const n of rec.ctrl?.nodes ?? []) n.ctorInit?.(H.world, rec);
  applyCaiSetup(H.ictx, H.world, H.L);
  H.world.vars.set(0xc5, vehicles(H.world).current?.index === 24 ? 5 : 1);
  H.G = vehicles(H.world);
  return H;
}
