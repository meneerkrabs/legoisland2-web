// The arrival of Pepper in a hub (M5), the part every hub set-up shares with the island's FUN_004c2d22: when the emulated set-up copies Pepper's matrix into a
// vehicle record (the boat the castle is reached by, the helicopter / Ptera of the other islands: `FUN_0051e4b0` picks the record, var 0x5e gets the control mode),
// the vehicle stands where Pepper is and Pepper sits in it from the first tick (`vehicles(world).current`, PEPPER_CONTROL = the mode the set-up wrote; the vehicle's
// own node then takes her in, exactly like the island's WP6 / WP13). Without such a record Pepper walks. `setupZone` resets var 0x5e to 1, so the emulated value is
// restored here.
import type { IslandSetup } from '../formats/emusetup.ts';
import type { Loaded } from '../game/setup.ts';
import type { World } from '../game/world.ts';
import { V } from '../game/vars.ts';
import { vehicles } from '../island/vehicles/common.ts';

export interface EmulatedArrival {
  /** record index of Pepper (PEPP) */
  pepper: number;
  /** the vehicle record the emulated code gave Pepper's matrix (its translation equals Pepper's), -1 none */
  vehicle: number;
  /** the value the set-up wrote to var 0x5e last (PEPPER_CONTROL), null when it never wrote it */
  control: number | null;
  /** Pepper's emulated position */
  pos: [number, number, number];
}

/** read the arrival out of the emulation */
export function emulatedArrival(emu: IslandSetup): EmulatedArrival {
  const pepper = emu.records.findIndex((r) => r.name === 'PEPP');
  const p = emu.records[pepper]?.pos ?? [0, 0, 0];
  let vehicle = -1;
  for (const c of emu.changed) {
    if (c.record === pepper || c.field !== 'pos') continue;
    const q = c.to as number[];
    if (q[0] === p[0] && q[1] === p[1] && q[2] === p[2]) vehicle = c.record;
  }
  const w = [...emu.varWrites].reverse().find((x) => x.var === V.PEPPER_CONTROL && x.op !== 'direct');
  return { pepper, vehicle, control: w ? w.after & 0xffff : null, pos: [p[0], p[1], p[2]] };
}

/** apply it to the world after `setupZone`: PEPPER_CONTROL back to the emulated value, a vehicle record gets Pepper's matrix and becomes `vehicles(world).current` when a node of her chain takes that mode */
export function applyEmulatedArrival(emu: IslandSetup, world: World, loaded: Loaded): EmulatedArrival {
  const a = emulatedArrival(emu);
  const pep = loaded.pepper;
  const chain = pep.ctrl?.nodes ?? [];
  const control = a.control;
  const taken = control !== null && chain.some((n) => n.var === V.PEPPER_CONTROL && (n.mask & control) !== 0 && n.value === control);
  if (control !== null && (taken || control === 1)) world.vars.set(V.PEPPER_CONTROL, control);
  if (a.vehicle < 0 || control === null) return a;
  const v = world.records[a.vehicle];
  if (!v) return a;
  if (taken) {
    v.x = pep.x; v.y = pep.y; v.z = pep.z; v.ry = pep.ry; v.rebuildYaw(); v.savePrev();
    vehicles(world).current = v;
  } else loaded.notes.push(`arrival in vehicle record ${a.vehicle} (PEPPER_CONTROL 0x${control.toString(16)}): no node for that mode on Pepper's chain yet, walking`);
  return a;
}
