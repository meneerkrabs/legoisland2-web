// The seven PeppSwit.c constructors of Ogel's island (z40OGL, story nodes 64 / 66; 22 attaches) registered by address (src/game/setup.ts registerCtor).
// docs/re/m5/z40OGL-peppswit.md: what each one does, what was verified against the original and how.
import { registerCtor } from '../../../game/setup.ts';
import { CTOR_OGL } from './globals.ts';
import { OglPepSwit, OglVoidFall } from './pepper.ts';
import { SlugNode } from './slug.ts';
import { RobotNode } from './robot.ts';
import { CitizenNode } from './citizen.ts';
import { StarDomeNode } from './star.ts';
import { HoloWatchNode } from './holo.ts';

registerCtor(CTOR_OGL.PEPPSWIT, () => new OglPepSwit());
registerCtor(CTOR_OGL.VOID, () => new OglVoidFall());
registerCtor(CTOR_OGL.SLUG, () => new SlugNode());
registerCtor(CTOR_OGL.ROBOT, () => new RobotNode());
registerCtor(CTOR_OGL.STAR, () => new StarDomeNode());
registerCtor(CTOR_OGL.CITIZEN, (a) => new CitizenNode(a as never));
registerCtor(CTOR_OGL.HOLO, () => new HoloWatchNode());

export { CTOR_OGL } from './globals.ts';
export { OglPepSwit, OglVoidFall } from './pepper.ts';
export { SlugNode } from './slug.ts';
export { RobotNode } from './robot.ts';
export { CitizenNode } from './citizen.ts';
export { StarDomeNode } from './star.ts';
export { HoloWatchNode } from './holo.ts';
