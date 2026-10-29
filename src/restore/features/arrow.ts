// Restored feature 'arrow': the objective arrow (docs/re/restore-plan.md section 5 item 3, docs/re/restore.md).
//
// ORIGINAL (game data / code reused): texture 8 `Pointer` (32 x 32, yellow arrow pointing right in a blue frame) of the island's HUD overlay set (Overlays/Z02LGI text008, never drawn by
//   the island's HUD); the objective logic of the story handler (`Objective`, src/zones/z02LGI/objective.ts: `target()` = FUN_00424e37 resolves the destination) and the arrival radius
//   every objective setter writes to DAT_009da840 (`radiusSq` = (radius * 8)^2, which nothing in the executable reads: its natural reader is this arrow).
// RECONSTRUCTION (invented): the draw itself (position, size, rotation convention: arrow up = straight ahead), the hide rules (a cutscene, story node >= 0x3d, mode 0 = no destination,
//   within the arrival radius), the island only.
import type { World } from '../../game/world.ts';
import type { Hud } from '../../shell/hud.ts';
import type { Ui2D } from '../../ui/renderer2d.ts';
import type { Feature } from '../feature.ts';

/** ORIGINAL: texture 8 of the island HUD set (Overlays/Z02LGI text008 `Pointer`, the arrow points right) */
export const POINTER_TEXTURE = 8;
/** ORIGINAL: no HUD icons from story node 0x3d on (FUN_004b8ef0): no arrow either */
export const LAST_NODE = 0x3d;
/** RECONSTRUCTION: centre (800x600 reference grid, scaled by 0.8 like the rest of the HUD) and side of the arrow */
export const ARROW_X = 400, ARROW_Y = 112, ARROW_SIZE = 48;

/**
 * RECONSTRUCTION: the bearing of `to` as seen from `from` relative to the camera's viewing direction (eye -> look-at on the ground plane): 0 = straight ahead, +PI/2 = to the right (the
 * view's right vector is (fz, -fx): src/game/camera.ts updateView), +-PI = behind. Positions are [x, y, z].
 */
export function bearing(eye: ArrayLike<number>, look: ArrayLike<number>, from: ArrayLike<number>, to: ArrayLike<number>): number {
  let fx = look[0] - eye[0], fz = look[2] - eye[2];
  const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  const dx = to[0] - from[0], dz = to[2] - from[2];
  const ahead = dx * fx + dz * fz, right = dx * fz - dz * fx;
  return Math.atan2(right, ahead);
}

export interface ArrowInput {
  /** the objective's mode (0 = none / nearest NPC: not a destination) and arrival radius^2 */
  mode: number; radiusSq: number;
  /** the resolved target (null = none) and where Pepper (or her vehicle) is */
  target: { pos: readonly number[] } | null; focus: ArrayLike<number> | null;
  eye: ArrayLike<number>; look: ArrayLike<number>;
  /** story node (var 0x58) and whether a cutscene runs */
  node: number; cutscene: boolean;
}

/** the arrow's bearing (clockwise from straight ahead, radians), or null when no arrow is shown (RECONSTRUCTION of the hide rules) */
export function arrowAngle(i: ArrowInput): number | null {
  if (i.cutscene || i.node >= LAST_NODE || i.mode === 0 || !i.target || !i.focus) return null;
  const dx = i.target.pos[0] - i.focus[0], dz = i.target.pos[2] - i.focus[2];
  if (dx * dx + dz * dz <= i.radiusSq) return null;      // arrived: the original's radius, unused by the original
  return bearing(i.eye, i.look, i.focus, i.target.pos);
}

interface GameLike {
  ictx: { world: World; goal: { mode: number; radiusSq: number }; objective: { target(from: unknown): { pos: readonly number[] } | null }; cutsceneActive(): boolean };
  ctx: { hud: Hud };
}
const installed = new WeakSet<Hud>();

export function install(game: GameLike) {
  const hud = game.ctx.hud;
  if (installed.has(hud)) return;
  installed.add(hud);
  const w = game.ictx.world;
  hud.extras.push((ui: Ui2D) => {
    if (!hud.visible || game.ictx.goal.mode === 0) return;   // (mode 0: nothing to point at; skips the target scan)
    const f = w.focus;
    const c = w.camera.c;
    const a = arrowAngle({
      mode: game.ictx.goal.mode, radiusSq: game.ictx.goal.radiusSq, target: game.ictx.objective.target(f ?? null), focus: f ? [f.x, f.y, f.z] : null,
      eye: [c[0], c[1], c[2]], look: [c[3], c[4], c[5]], node: w.vars.get(0x58), cutscene: game.ictx.cutsceneActive(),
    });
    if (a === null) return;
    const k = 0.8;
    ui.anchor('centre');
    // the texture's arrow points right: turned by (bearing - 90 deg) clockwise it points up for "straight ahead"
    ui.spriteRot(hud.set, POINTER_TEXTURE, ARROW_X * k, ARROW_Y * k, ARROW_SIZE * k, a - Math.PI / 2);
  });
}

export const feature: Feature = {
  id: 'arrow',
  islandStart(g) { install(g as GameLike); },
};
