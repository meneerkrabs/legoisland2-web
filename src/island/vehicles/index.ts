// WP6: Pepper's modes and the island's vehicles (docs/re/m4/wp6-vehicles.md). Importing this file registers the constructors (src/game/setup.ts registerCtor):
//   0x4bbef8 PepSwitc (island)   0x43310c skateboard (thunk to skate.c FUN_00492cc2)   0x4333c2 SGVehic   0x4bb582 Ptera (riding, on PEPP)
//   0x430e6c SGBoat               0x4325e8 SGHeli                                       0x88fb35 SGCar
//   0x4bb1a6 Ptera (WP13: the flying PTER / GLDR, ptera.ts)
import { registerCtor } from '../../game/setup.ts';
import { ArgView } from '../args.ts';
import { IslandPepSwitch, VehicleSeat, PteraRide } from './pepswitch.ts';
import { SkateNode } from './skate.ts';
import { BoatNode } from './boat.ts';
import { HeliNode } from './heli.ts';
import { CarNode } from './car.ts';
import { PteraNode } from './ptera.ts';

export const CTOR_WP6 = {
  PEPSWITC: 0x4bbef8, SKATE: 0x43310c, SGVEHIC: 0x4333c2, PTERA_RIDE: 0x4bb582, SGBOAT: 0x430e6c, SGHELI: 0x4325e8, SGCAR: 0x88fb35,
} as const;

registerCtor(CTOR_WP6.PEPSWITC, () => new IslandPepSwitch());
registerCtor(CTOR_WP6.SKATE, () => new SkateNode());
registerCtor(CTOR_WP6.SGVEHIC, () => new VehicleSeat());
registerCtor(CTOR_WP6.PTERA_RIDE, () => new PteraRide());
registerCtor(CTOR_WP6.SGBOAT, (a) => new BoatNode(ArgView.of(a)));
registerCtor(CTOR_WP6.SGHELI, () => new HeliNode());
registerCtor(CTOR_WP6.SGCAR, () => new CarNode());
/** WP13: FUN_004bb1a6, argument +0 = the home PATH node */
export const CTOR_PTERA = 0x4bb1a6;
registerCtor(CTOR_PTERA, (a) => new PteraNode(ArgView.of(a).i32(0)));

export { vehicles, VehicleGlobals } from './common.ts';
export { IslandPepSwitch, VehicleSeat, PteraRide, findFreeSpot } from './pepswitch.ts';
export { SkateNode } from './skate.ts';
export { BoatNode } from './boat.ts';
export { HeliNode } from './heli.ts';
export { CarNode, CAR_DRIVEN, CAR_PLAYER } from './car.ts';
export { PteraNode } from './ptera.ts';
