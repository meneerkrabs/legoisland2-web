// The particle emitters of z20DSP: FUN_006bf633 (called by the runner FUN_006bf929 after FUN_00442900("Z20DSP")): seven FUN_00442960 starts, all with the gate (var, 1, 1):
//   cactus      x2  parent: record 2's matrix (DAT_00983804 + 0xdc), offsets (+-0.145, 0.1, -0.85), gate var 0xfa (the turbo)
//   problow     x2  parents: the rear wheel-ground matrices DAT_05d5c2c0 / 300, offsets (-+0.25, 0, 0.35), gate var 0xfc (the skid)
//   problow     x2  parents: DAT_05d5c340 / 380, offsets (-+0.25, 1, -0.5), gate var 0xfd (the dust)
//   cactuspop02     parent: record 2's matrix, offset (0, 0.25, 0), rotation (-pi/2, 0, 0), gate var 0xfb (a cactus was smashed)
// The Speedster moves the matrices (`emit.m`, rewritten at the top of every update) and rebinds / restarts the emitters (speedster.ts dustBlock, the cactus hit).
import type { World } from '../../game/world.ts';
import type { DspShared } from './shared.ts';

const f = Math.fround;
/** the float constants of the call sites (0x3e147ae1, 0x3dcccccd, 0xbf59999a, 0xbe800000, 0x3eb33333, 0x3e800000, 0xbf000000, 0xbfc90fdb) */
const C = { X: f(0.145), Y: f(0.1), Z: f(-0.85), SIDE: f(0.25), UP: f(0.35), HALF: f(-0.5), POP_UP: f(0.25), DOWN: f(-Math.PI / 2) };

export function startDspEmitters(sh: DspShared, w: World) {
  const fx = sh.fx;
  if (!fx) return;
  const rec2 = w.records[2].m, M = sh.emit.m, H = sh.emit.h;
  const none = [0, 0, 0];
  H[0] = fx.start('cactus', rec2, [C.X, C.Y, C.Z], none, [0xfa, 1, 1]);
  H[1] = fx.start('cactus', rec2, [-C.X, C.Y, C.Z], none, [0xfa, 1, 1]);
  H[2] = fx.start('problow.par', M[0], [-C.SIDE, 0, C.UP], none, [0xfc, 1, 1]);
  H[3] = fx.start('problow.par', M[1], [C.SIDE, 0, C.UP], none, [0xfc, 1, 1]);
  H[4] = fx.start('problow.par', M[2], [-C.SIDE, 1, C.HALF], none, [0xfd, 1, 1]);
  H[5] = fx.start('problow.par', M[3], [C.SIDE, 1, C.HALF], none, [0xfd, 1, 1]);
  H[6] = fx.start('cactuspop02', rec2, [0, C.POP_UP, 0], [C.DOWN, 0, 0], [0xfb, 1, 1]);
}
