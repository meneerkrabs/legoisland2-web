// z16PYA node-test helper (M5): `loadHub` (tools/lib/hub-load.mjs: the shell's set-up path with a mock island context) + what the Pyramid's hub module and the framework do after the
// set-up in the real game: the mock context answers `soundOf` (the emulated sound handles) and `musicGroove`, the particle engine the island nodes ask the context for is the recording
// FakeFx, the nodes' `ctorInit` pass (src/hub/game.ts, the shared scorpion / Gems / Tumblewd nodes of src/zones/z14OSD) and `applyPyaSetup` (PeppSw's roster, Pepper's chain, the board record).
//   const H = loadPya(ctx, 36);   // H.world, H.pepper, H.ictx (mock: sounds, stopped, cutscenes, said, fx, grooves), H.emu, H.rec(name) ...; tick(H, n), press(H, code), hold(H, [codes], n)
import '../../src/zones/index.ts';
import { loadHub } from './hub-load.mjs';
import { FakeFx } from './fake-fx.mjs';
import { applyPyaSetup } from '../../src/zones/z16PYA/index.ts';

export { tick, press, hold } from './hub-load.mjs';

export function loadPya(ctx, node = 36, opts = {}) {
  const H = loadHub(ctx, { zone: 'z16PYA', node, vars: opts.vars ?? {}, bricks: opts.bricks });
  const handles = new Map(H.emu.soundHandles.map((h) => [h.addr, h]));
  H.ictx.soundOf = (addr) => { const h = handles.get(addr); return h && h.kind !== 'music' ? h.id : -1; };
  H.ictx.grooves = [];
  H.ictx.musicGroove = (lvl) => { H.ictx.grooves.push({ lvl, tick: H.world.tickCount }); };
  H.ictx.fx = new FakeFx(H.world);
  for (const rec of H.world.records) for (const n of rec.ctrl?.nodes ?? []) n.ctorInit?.(H.world, rec);
  applyPyaSetup({ setup: H.emu, pe: H.pe }, H.world, H.L);
  return H;
}
