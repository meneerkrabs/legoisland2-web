// The horse of the castle island (Common\Z07CSI\Horse.c): the three constructors the castle's set-up attaches (docs/re/m5/z07CSI-horse.md).
//   0x579178  HORS (record 48), the horse: ride, gait, jump, collisions, camera, hooves        -> hors.ts
//   0x579725  Pepper's chain entry @5 (PEPPER_CONTROL & 0x10) and the jockey kit JKIT (46)      -> rider.ts
//   0x579948  RSAD / GSAD / CLOK (51 / 52 / 53): the saddle and cloak parts that follow HORS    -> rider.ts
import { registerCtor } from '../../../game/setup.ts';
import { CTOR_HORSE, horseFactory } from './hors.ts';
import { CTOR_RIDER, CTOR_SADDLE, riderFactory, saddleFactory } from './rider.ts';

registerCtor(CTOR_HORSE, horseFactory);
registerCtor(CTOR_RIDER, riderFactory);
registerCtor(CTOR_SADDLE, saddleFactory);
