// Section 11 "Vliegen" (fly like the station master), the logic without DOM (importable in node; tools/tests/devcorner-vliegen.mjs).
// PORT EXTENSION, not in the original: the original has no manual flight. What is verified is the carried-Pepper logic of SUPE (src/island/pizza/supe.ts: the swoop, the pick-up,
// the carry FUN_0053ac79, the camera FUN_0053ab93, the drop at the nearest helipad exit node); the corner only sets `SupeNode.manual` (null = the original, byte for byte)
// and the node steers by the pad bits while it is set (state ST.MANUAL 0x11), see docs/re/unused.md 5.3.
import type { World } from '../game/world.ts';
import type { GameRecord } from '../game/record.ts';
import type { SupeNode } from '../island/pizza/supe.ts';

/** the key that switches the flight (`KeyboardEvent.code`): free in the original's key table 0x8aeb20 (arrows, Ctrl, Alt, Shift, Space, `<>`, Z, X, C, Enter; the port adds WASD / Q / right-hand twins) and in the port (F8 / F9 / F10 / F12, E / I on the slot pages, H) */
export const FLY_KEY = 'KeyF';
export const FLY_KEY_LABEL = 'F';

/** the state names of the node (+0x38) */
export const STATE_NAMES: Record<number, string> = {
  0: 'staat (station)', 1: 'landt', 2: 'vliegt (route)', 3: 'vliegt vrij', 4: 'aangekomen', 5: 'stijgt op', 6: 'duikt op Pepper af', 7: 'stijgt op', 8: 'tilt Pepper op',
  9: 'oost: draait', 10: 'oost: richt uit', 11: 'oost: spoor', 12: 'naar 80 boven het platform', 13: '16 boven het platform', 14: 'zakt naar het platform', 15: 'zet Pepper af', 16: 'klimt terug naar de hub',
  17: 'HANDMATIG VLIEGEN',
};

export interface SupeHandle { rec: GameRecord; node: SupeNode }

/** the SUPE record (45) and its node, null in a zone without one (every zone except the island) */
export function findSupe(world: World): SupeHandle | null {
  for (const rec of world.records) {
    const node = rec.ctrl?.nodes.find((n) => n.kind === 'supe') as SupeNode | undefined;
    if (node) return { rec, node };
  }
  return null;
}

export const NOT_AVAILABLE = 'niet beschikbaar in deze zone';

/** switch the manual flight on / off: the message for the footer */
export function setFlight(world: World, on: boolean): string {
  const s = findSupe(world);
  if (!s) return NOT_AVAILABLE;
  if (on) {
    const err = s.node.startManual(world, s.rec);
    return err ? `Vliegen kan nu niet: ${err}` : 'De stationschef komt Pepper halen; daarna stuur je hem zelf.';
  }
  if (!s.node.manual) return 'De vlucht staat niet aan.';
  s.node.stopManual();
  return 'De stationschef brengt Pepper naar het dichtstbijzijnde helikopterplatform.';
}
export const flightOn = (world: World): boolean => !!findSupe(world)?.node.manual;
/** the toggle key / the check box */
export function toggleFlight(world: World): string { return setFlight(world, !flightOn(world)); }

/** per-tick numbers for the readout (the speed is measured: the distance he moved in the last tick) */
export class FlightProbe {
  private px = NaN; private py = NaN; private pz = NaN;
  speed = 0;
  sample(world: World) {
    const s = findSupe(world);
    if (!s) { this.speed = 0; this.px = NaN; return; }
    const r = s.rec;
    this.speed = Number.isNaN(this.px) ? 0 : Math.hypot(r.x - this.px, r.y - this.py, r.z - this.pz);
    this.px = r.x; this.py = r.y; this.pz = r.z;
  }
  readout(world: World) {
    const s = findSupe(world);
    if (!s) return null;
    const P = world.focus;
    return {
      state: s.node.state, name: STATE_NAMES[s.node.state] ?? `onbekend (${s.node.state})`, manual: !!s.node.manual, ticks: s.node.manual?.ticks ?? 0,
      pos: [s.rec.x, s.rec.y, s.rec.z] as [number, number, number], pep: P ? [P.x, P.y, P.z] as [number, number, number] : null,
      yaw: s.rec.ry, pitch: s.rec.rx, speed: this.speed, pc: world.vars.get(0x5e),
    };
  }
}
