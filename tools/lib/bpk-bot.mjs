// A scripted skater for z01BPK (the node tests and the browser steps use the same decisions): from a snapshot of the run (`BpkSkate` + Pepper's record: see `bpkSnapshot`)
// it returns the held button mask for the next tick. It rolls until it is on open ground, crouches (Alt) until the charge is full, lets go (the jump), and in the air holds a stunt
// (button + direction) until the landing is near; with `plan.hold = true` it keeps the stunt held to the landing (the crash scenario: a stunt past 100 at the landing).
import { B } from '../../src/game/input.ts';

/** the snapshot the bot decides from: plain data */
export function bpkSnapshot(game) {
  const s = game.skate, p = game.pepper;
  return {
    control: game.world?.vars?.get(0x5e) ?? 4,
    state: s.state, clip: p.anim?.clip ?? 0, charge: s.charge, progress: s.progress, t: s.t, grounded: s.grounded, onPipe: s.onPipe,
    x: p.x, y: p.y, z: p.z, ry: p.ry, speed: s.speed, fwdX: p.m[8], fwdZ: p.m[10], trickScore: game.run.trickScore, steer: s.steer, stickY: s.stickY, locked: s.locked,
  };
}

/**
 * plan = { trick: { button, dir } (default Space + Left + Up: clip 0x69, progress 4 per tick), crouch: charge at which Alt is let go (default 1.9), release: progress at which the stunt
 * keys are let go (default 80; Infinity = never), hold: keep everything pressed to the landing, area: open ground the crouch may start in }
 */
export function bpkBotStep(s, plan = {}) {
  if (s.control !== 4) return 0;
  const trick = plan.trick ?? { button: B.SPACE, dir: B.LEFT | B.UP };
  const target = plan.crouch ?? 1.9;
  const area = plan.area ?? { x: 24, zMin: -10, zMax: 10 };
  let mask = 0;
  const open = Math.abs(s.x) < area.x && s.z > area.zMin && s.z < area.zMax && s.y < 1.5 && s.grounded === 1;
  switch (s.state) {
    case 0x29:
    case 0x2d:
      if (open && !s.onPipe) mask |= B.ALT;
      break;
    case 0x2a:
      mask |= B.ALT;
      break;
    case 0x2b:
      if (s.charge < target) mask |= B.ALT;
      break;
    case 0x20:
      if (s.clip === 0x20) mask |= trick.button | trick.dir;                       // pick the stunt
      else if (plan.hold || s.progress < (plan.release ?? 80)) mask |= trick.button | trick.dir;   // keep it held while the progress is low
      break;
    default: break;
  }
  return mask;
}
