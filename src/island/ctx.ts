// What the island's behaviour nodes need from the shell / the zone game (src/zones/z02LGI): the services of the original's globals and engine calls that
// are not part of `World` (cutscene manager, speech, the message tables the story handler selects, the sound sink, the animation / switch dictionaries the
// emulated set-up produced ...). Nodes get it with `ctxOf(world)`; the island zone game installs it (`installCtx`); node tests install a mock
// (tools/lib/island-load.mjs). Workers: add members here when a node needs a service (optional members with a doc comment saying which function of the
// original they stand for), and implement them in src/zones/z02LGI/ctx.ts.
import type { Archive } from '../formats/archive.ts';
import type { Pe } from '../formats/exe.ts';
import type { IslandSetup } from '../formats/emusetup.ts';
import type { World } from '../game/world.ts';
import type { GameRecord } from '../game/record.ts';
import type { ZoneScene } from '../formats/exe.ts';
import type { MessageTable } from '../ui/strings.ts';

export interface IslandCtx {
  readonly world: World;
  readonly pe: Pe;
  /** the zone archive (z02LGI) */
  readonly archive: Archive;
  /** the emulated set-up of this zone start (docs/re/m4/emu.md): attaches with argument blocks, dictionaries, the story handler's calls */
  readonly setup: IslandSetup;
  /** story era 0..4 (FUN_004b6475: node < 7, < 0x1e, < 0x34, < 0x3d, else) */
  readonly era: number;

  // ---- cutscene manager (Common\CSM: FUN_0045c40c / 0045c432 / 0045c456)
  /** FUN_0045c40c(slot): start the script of a slot (ignored while STARTEDFROMMENU != 0); false when it did not start */
  startCutscene(slot: number): boolean;
  /** FUN_0045c432: a cutscene runs (or a dialog holds the cutscene flag) */
  cutsceneActive(): boolean;
  /** FUN_0045c456(on): the override flag DAT_05d4dc8c that dialogs / triggers set */
  holdCutscene(on: boolean): void;

  // ---- text and speech (SDText.c, FUN_00439bf8 / FUN_00435a11 / FUN_00435ad3)
  /** the message tables the story handler selected for the current node: `npc` = LI/Data/lifsmN.str (the lines the talking NPCs say: tags `<NAME>A`, `<NAME>C` ...), `hol` = lihol N.str (hologram hints) */
  readonly text: { npc: MessageTable | null; hol: MessageTable | null };
  /** FUN_00439bf8 + FUN_00435a11: speak line `id` of `table` (voice = the id's voice field) and show its subtitle when the option is on; false while another line is busy */
  /** `id2` (WP3, FUN_00435a11's second voice): a second line spoken right after the first (the subtitle is both texts, FUN_0085b580); the talking NPCs pass `<NAME>B` / `<NAME>D` */
  say(table: MessageTable, id: string, id2?: string): boolean;
  /** FUN_00435ad3: no speech is playing */
  speechIdle(): boolean;
  /** FUN_00435b07 */
  stopSpeech(): void;

  // ---- sound (FUN_004435a0 play, FUN_004435b0 stop, FUN_004433f0 play at a position)
  sfx(id: number): void;
  stopSfx(id: number): void;
  sfxAt(id: number, pos: readonly [number, number, number]): void;
  /** WP6 (vehicles): FUN_00443600(handle, hz): the playback frequency (Hz) of a looping sound: the boat / helicopter engines change their pitch with the
   *  throttle (src/island/vehicles). The vehicles call `sfx(id)` every tick while the engine runs (FUN_004435a0 restarts nothing when it plays). Optional. */
  sfxFreq?(id: number, hz: number): void;

  // ---- particle emitters (FX_Particles: FUN_0044e920 / FUN_0044ebb0 create a `.par` emitter, FUN_0044ea00 moves it, FUN_0044ea60(h, mode, ...) switches it)
  /** WP5 (Pizza.c): the emitter `name` ('throwpizza.par', 'pizzasplat.par') of record `owner` (each node owns its own emitters) at `pos`; mode 2 = emit,
   *  1 = stop emitting (live particles fade out), 0 = move it (FUN_0044ea00). Optional. */
  particles?(name: string, mode: number, pos: readonly [number, number, number], owner: number): void;
  /** WP5 (speeder.c): FUN_00447e90(rec, kind) = FUN_0044a3b0: start burst `kind` (0xd: a car hit by / hitting Pepper falls apart; 6, 0xb, 0xc others) on the
   *  brick object bound to `rec` (FX_Bricks, WP9). The car also sets record flag 0x8000 (its mesh is not drawn while the bricks fly). Optional. */
  brickBurst?(rec: GameRecord, kind: number): void;

  // ---- the story's objective (WP8, src/zones/z02LGI/objective.ts: the globals DAT_009da82c.. that FUN_004b7040 sets through FUN_00424270 / 00424230 / 0042419f / 004242b9)
  /** FUN_00424e37(&out, from): the position the talking NPCs point at after their line (FUN_004254a5) and the hologram faces; null = no target.
   *  `holoTimer` = DAT_05defbcc: FUN_0088d2bc sets 90 when the story just advanced, the hologram (hOLO, FUN_0088d41f) counts it down by dt and calls Pepper at 0.
   *  The default target (no objective) is the nearest talk NPC: its head node must have `ctor === 0x426151` and a non-zero `talk50` (the short at node + 0x50). */
  objective?: { target(from: GameRecord | null): { pos: [number, number, number]; record: number } | null; holoTimer: number };

  // ---- dictionaries of the emulated set-up
  /** animation clip number of a cutscene animation name (`SKBD_SKBD_ONTOBOARD`), undefined when unknown */
  animClip(name: string): number | undefined;
  /** game variable index of a `SWITCH_LGI_*` name */
  switchVar(name: string): number | undefined;

  // ---- WP3 (talking NPCs, src/island/npc): optional services
  /** record flag 1 (FUN_00444370: the record's box is in the view frustum); without it every record counts as in view */
  inFrustum?(rec: GameRecord): boolean;
  /** FUN_0043f2f0(model, n): the face (mouth / eyes frame) of a minifig; the speaking NPC changes it at random */
  expression?(rec: GameRecord, n: number): void;
  /** FUN_0045f750(on): the cutscene manager's camera hold flag (DAT_05d4dcbc) the conversation sets while it runs */
  cameraHold?(on: boolean): void;
  /** WP10: FUN_0043ebe0(model, 0, &du, &dv) = FUN_0088350d mode 0: ADD (du, dv) to the UVs of every vertex of the record's part-0 mesh (SeaAmin's shore foam); the renderer accumulates it */
  uvScroll?(rec: GameRecord, du: number, dv: number): void;

  // ---- WP7 (music, ambience, brick-morph animals: src/island/ambient): optional services, the nodes run without them
  /** FUN_004432c0(handle): play the DirectMusic key (`Z02LGIT`, `Z02Papa`, `bbotsM`, `radio` ...; a key whose file is missing, `Z02LGIB`, plays nothing):
   *  a hard primary-segment switch (docs/re/audio.md 7.3) */
  music?(key: string): void;
  /** FUN_00443310(level): the groove level offset (the island sets 0 and `want - 3` = -2 .. 0) */
  musicGroove?(level: number): void;
  /** FUN_00443370 (FUN_00876e7f): 1 when a DirectMusic notification (segment end / loop) arrived since the last call, else 0 */
  musicNotified?(): number;
  /** FUN_00873e00(on): mute the music (BOTMUSIC's pre-render hook mutes it while no bot dances in era 3; Music.c unmutes at set-up) */
  musicMute?(on: boolean): void;
  /** FUN_004431e0(name): the MIDI ambience bed (`LGIBirds`) */
  ambience?(name: string): void;
  /** FX_Bricks (FUN_00447d20(rec, var) + FUN_00447da0 per `brickmorph/<file>` + FUN_00447e70(h, matrix)): a brick-morph object bound to `rec` that morphs
   *  between the shapes of `files` when game variable `v` changes, drawn at `matrix` (the Brikimal node rewrites it every tick); `state()` = FUN_00447e60
   *  (2 = idle / ready to morph). WP9. Without it the Brikimal node shows the record's plain model. */
  brickMorph?(rec: GameRecord, v: number, files: readonly string[], matrix: Float32Array): { state(): number } | null;

  /** an open bag for state the original keeps in globals (DAT_009daa80 current interactive record, the objective arrow, ...): each node family documents its keys */
  readonly shared: Record<string, unknown>;

  /** the zone's scene (WP4: the mesh paths of the records' models; FUN_0043ea60 returns the sub-object matrices of a record's mesh = its MATL table, src/island/trigger/parts.ts). Optional: without it doors / swinging parts stay inert */
  readonly scene?: ZoneScene;
}

const KEY = 'island';
export function installCtx(world: World, ctx: IslandCtx) { world.ext.set(KEY, ctx); }
export function ctxOf(world: World): IslandCtx {
  const c = world.ext.get(KEY) as IslandCtx | undefined;
  if (!c) throw new Error('no island context installed on the world');
  return c;
}
/** the context when there is one (nodes that also run in tests without it) */
export function tryCtx(world: World): IslandCtx | undefined { return world.ext.get(KEY) as IslandCtx | undefined; }
