// The island's director FUN_004b7c78 (the update of LGI_FSM, ctor FUN_004b8c73): WP7's port was merged with WP4's into ONE node by WP9
// (src/island/trigger/lgifsm.ts, registered there: particle emitters, cue sounds from the executable, WORM = record 370, FX_Bricks). This module keeps
// WP7's names for its callers and tests.
import { LgiFsmNode, CTOR_LGI_FSM } from '../trigger/lgifsm.ts';
export { directorTick, DirectorState, cueTable, CTOR_LGI_FSM } from '../trigger/lgifsm.ts';
export type { Cue } from '../trigger/lgifsm.ts';
/** the LGI_FSM node (FUN_004b8c73) */
export const DirectorNode = LgiFsmNode;
/** the constructor is registered by src/island/trigger/lgifsm.ts; kept as a no-op for old callers */
export function registerDirector(): number { return CTOR_LGI_FSM; }
