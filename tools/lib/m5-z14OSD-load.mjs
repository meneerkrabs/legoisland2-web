// Node-test helper of the z14OSD worker: `loadHub` (tools/lib/hub-load.mjs: emulated set-up -> setupZone -> framework world work, mock context) plus what `registerHub` adds in the real game:
// the hub's mock context answers `soundOf` (emulated sound handles), the nodes' `ctorInit` runs, spec.afterSetup (node 45's sub-object matrices).
import '../../src/zones/index.ts';
import { loadHub, tick, press, hold } from './hub-load.mjs';
import { applySubMatrices } from '../../src/zones/z14OSD/setup.ts';

export { tick, press, hold };
export function loadOsd(ctx, opts = {}) {
  const H = loadHub(ctx, { zone: 'z14OSD', node: opts.node ?? 34, vars: opts.vars ?? {}, bricks: opts.bricks });
  H.ictx.fx = null;   // (the mock of hub-load.mjs keeps an array there: the particle engine is absent in node tests)
  const handles = new Map(H.emu.soundHandles.map((h) => [h.addr, h]));
  H.ictx.soundOf = (addr) => { const h = handles.get(addr); return h && h.kind !== 'music' ? h.id : -1; };
  H.ictx.musicGroove = (lvl) => { (H.ictx.grooves ??= []).push({ lvl, tick: H.world.tickCount }); };
  for (const rec of H.world.records) for (const n of rec.ctrl?.nodes ?? []) n.ctorInit?.(H.world, rec);
  H.subMatrices = applySubMatrices(H.world, H.emu);
  return H;
}
