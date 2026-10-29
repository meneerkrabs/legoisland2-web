// WP7 ambient family (docs/re/m4/wp7-ambient.md): importing this file registers the constructors of the island's animals (Bunny, butterflies, swifts),
// Spin, SeaAmin, Sound3d, BOTMUSIC, Brikimal and Music. The director (LGI_FSM, FUN_004b8c73 / FUN_004b7c78) is the merged node of
// src/island/trigger/lgifsm.ts (registered there); director.ts re-exports it under the WP7 names.
import './animals.ts';
import './misc.ts';
import './brikimal.ts';
import './music.ts';
export { directorTick, DirectorState, DirectorNode, registerDirector, cueTable } from './director.ts';
export { MusicNode, musicKeysFor, MUSIC_BUILDINGS } from './music.ts';
export { islandRigs, ensureAnim, islandSoundHandles, setAmbientRandom } from './common.ts';
