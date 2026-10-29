// The hub context: `IslandCtx` (src/island/ctx.ts) for any hub zone (M5), generalised from the island's `IslandContext` (src/zones/z02LGI/ctx.ts, which stays
// as it is). It carries what the shared node families (src/island/*) and a hub's own behaviours ask of the shell: cutscene manager, speech, sound, the message
// tables the hub's story handler selects, the objective (the engine's FUN_00424270 family), the dictionaries the emulated set-up produced, the loader's rigs.
// It is created and installed on the world BEFORE `setupZone` runs (the node factories may look it up); the hub game binds the runner's services in `bind`.
import type { Archive } from '../formats/archive.ts';
import type { Pe, ZoneScene } from '../formats/exe.ts';
import type { IslandSetup } from '../formats/emusetup.ts';
import type { World } from '../game/world.ts';
import type { GameRecord } from '../game/record.ts';
import { RF_ENABLED } from '../game/record.ts';
import { partOverrides } from '../island/trigger/parts.ts';
import type { IslandCtx } from '../island/ctx.ts';
import { loadMessages } from '../ui/strings.ts';
import type { MessageTable } from '../ui/strings.ts';
import type { ZoneGameCtx } from '../shell/zonegame.ts';
import type { AudioHost } from '../shell/audiohost.ts';
import { Objective } from '../zones/z02LGI/objective.ts';
import { messagePath } from '../zones/z02LGI/ctx.ts';
import { brickMorph, brickBurst } from '../fx/bricks/island.ts';
import type { ZoneParticles } from '../fx/particles/zone.ts';
import type { Model } from '../formats/exe.ts';
import { cheatState } from '../shell/cheats.ts';
import { restoreHooks } from '../restore/flag.ts';


export class HubContext implements IslandCtx {
  readonly world: World;
  readonly pe: Pe;
  readonly archive: Archive;
  /** the emulated set-up of this zone start (`profile.emu`) */
  readonly setup: IslandSetup;
  /** story era: 0 for hubs (the era split is the island's; a hub reads var 0x58 itself) */
  readonly era: number;
  /** archive name of the zone ('z07CSI') */
  readonly zone: string;
  readonly scene?: ZoneScene;
  readonly text: { npc: MessageTable | null; hol: MessageTable | null } = { npc: null, hol: null };
  /** the paths of the two selected tables (diagnostics / tests) */
  readonly textPaths: { npc: string | null; hol: string | null } = { npc: null, hol: null };
  readonly shared: Record<string, unknown> = {};
  /** cutscene slots of the set-up whose script / message file is not in the data (left undeclared) */
  readonly missingCutscenes: string[] = [];
  /** the story's objective (the engine's FUN_00424270 family; src/zones/z02LGI/objective.ts is generic) */
  readonly goal = new Objective();
  readonly objective: NonNullable<IslandCtx['objective']>;
  /** the `messages` archive (the story handler's tables) */
  messages: Archive | null = null;
  /** PATH node position (FUN_00462be9(1, n)) for the objective's mode 3 */
  pathPos: (n: number) => readonly number[] | null = () => null;
  /** the zone game's own state a hub's behaviours share (a hub worker puts its services here; the node families of the island use `shared`) */
  readonly hub: Record<string, unknown> = {};
  /** M5 (z14OSD worker, additive): the zone's particle engine (`ZoneParticles.create` in the zone factory, src/hub/game.ts); null without particle data */
  fx: ZoneParticles | null = null;
  private zg: ZoneGameCtx | null = null;
  private audio: AudioHost | null = null;
  private tables = new Map<string, MessageTable | null>();
  private rigs: Map<number, string>;

  constructor(world: World, pe: Pe, archive: Archive, setup: IslandSetup, zone: string, scene?: ZoneScene) {
    this.world = world; this.pe = pe; this.archive = archive; this.setup = setup; this.era = setup.era; this.zone = zone; this.scene = scene;
    this.rigs = new Map(setup.loaderRigs.map((r) => [r.record, r.rig]));
    const goal = this.goal, self = this;
    this.objective = {
      target: (from: GameRecord | null) => goal.target(self.world.records, from, self.world.vars.get(0x5e), self.pathPos),
      get holoTimer() { return goal.holoTimer; },
      set holoTimer(v: number) { goal.holoTimer = v; },
    };
  }

  /** the runner's services (the zone game's construction) */
  bind(zg: ZoneGameCtx, messages: Archive | null) {
    this.zg = zg; this.audio = zg.sh.audio; this.messages = messages;
    zg.gr.partMatrices = (rec) => partOverrides(this.world, rec);
  }
  /** the runner's ZoneGameCtx after `bind` (null before) */
  get zoneCtx(): ZoneGameCtx | null { return this.zg; }

  // ---- sound / music handles of the hub's code (FUN_004433b0 / FUN_00443580 / FUN_00443290 results stored in globals, from the emulated loads: IslandSetup.soundHandles)
  private handles: Map<number, { id: number; name: string | null; kind: string }> | null = null;
  private handleOf(addr: number) {
    if (!this.handles) this.handles = new Map(this.setup.soundHandles.map((h) => [h.addr, h]));
    return this.handles.get(addr);
  }
  /** the sound id behind a handle global (`FUN_004435a0(DAT_05d588f0)` plays `soundOf(0x5d588f0)`), -1 when unknown */
  soundOf(addr: number): number { const h = this.handleOf(addr); return h && h.kind !== 'music' ? h.id : -1; }
  /** the music key behind a handle global (`FUN_004432c0(DAT_05d5888c)` plays `musicOf(0x5d5888c)` = 'Z07CSI'), null when unknown */
  musicOf(addr: number): string | null { const h = this.handleOf(addr); return h?.kind === 'music' ? h.name : null; }

  // ---- rig of a record (the loader's animation instance, from the emulation: `ensureAnim` of src/island/ambient/common.ts asks for it)
  rigOf(record: number): string | undefined { return this.rigs.get(record); }

  // ---- rendering services (as IslandContext)
  readonly inFrustum = (rec: GameRecord): boolean => {
    if ((rec.flags & RF_ENABLED) === 0) return false;
    const co = rec.colObj, gr = this.zg?.gr;
    if (!co || !gr) return true;
    return gr.sphereVisible(rec.toWorld(co.col.center), co.radius);
  };
  uvScroll(rec: GameRecord, du: number, dv: number) {
    const gr = this.zg?.gr;
    if (!gr) return;
    const n = gr.groupCount(rec);
    for (let g = 0; g < n; g++) gr.scrollGroup(rec, g, du, dv);
  }

  // ---- the story handler's message tables (FUN_00423fe0 / FUN_0088d280 load, FUN_00423ff6 / FUN_0088d296 free)
  table(raw: string): MessageTable | null {
    const p = messagePath(raw);
    if (this.tables.has(p)) return this.tables.get(p)!;
    let t: MessageTable | null = null;
    if (this.messages) { try { t = loadMessages(this.messages, [p]); } catch { t = null; } }
    this.tables.set(p, t);
    return t;
  }
  setText(which: 'npc' | 'hol', raw: string | null) {
    this.textPaths[which] = raw === null ? null : messagePath(raw);
    this.text[which] = raw === null ? null : this.table(raw);
  }

  // ---- cutscene manager
  startCutscene(slot: number): boolean { return this.zg?.cutscene.start(slot) ?? false; }
  cutsceneActive(): boolean { return this.zg?.cutscene.active() ?? false; }
  holdCutscene(on: boolean) { this.zg?.cutscene.hold(on); }

  // ---- speech
  say(table: MessageTable, id: string, id2?: string): boolean {
    const speak = (t: MessageTable, a: string, b?: string) => this.zg?.sayFrom(t, a, b) ?? false;
    return restoreHooks.say?.(table, id, id2, speak) ?? speak(table, id, id2);   // restored content (option off: unset)
  }
  expression(rec: GameRecord, n: number) { rec.face = n; }
  speechIdle(): boolean { return this.zg?.speechIdle() ?? true; }
  stopSpeech() { this.zg?.stopSpeech(); }

  // ---- sound
  sfx(id: number) { this.world.playSound(id); }
  stopSfx(id: number) { this.audio?.stop(id); }
  sfxFreq(id: number, hz: number) { this.audio?.rate(id, hz); }
  /** FUN_004433f0: a 3D sound at `pos` on the zone's 3D slot of the id (AudioHost loads the zone's list before the first frame; a sound outside it is loaded on demand and plays when ready) */
  sfxAt(id: number, pos: readonly [number, number, number]) { this.audio?.playAt(id, pos); }

  // ---- music (FUN_004432c0 / FUN_00443310 / FUN_00873e00 / FUN_004431e0)
  /** FUN_004432c0(handle of `key`): one DirectMusic prepare time later the segment replaces the running one (AudioHost.playMusic; the zone's init / help moments are in src/audio/zonemusic.ts) */
  music(key: string) { this.audio?.playMusic(key); }
  /** FUN_00443370: a segment notification was waiting (taken from the queue) */
  musicNotified(): number { try { return this.audio?.ga?.music.pollNotification() ? 1 : 0; } catch { return 0; } }
  musicGroove(level: number) { try { this.audio?.ga?.music.setGroove(level); } catch { /* silent */ } }
  musicMute(on: boolean) { try { this.audio?.ga?.music.setMute(on); } catch { /* silent */ } }
  ambience(name: string) { this.audio?.ga?.ambience.start(name).catch(() => { /* silent */ }); }

  // ---- M5 (z07CSI worker, additive): the decor / outfit swap's renderer calls (src/island/decor.ts: the castle's Control node swaps decor models / minifig hats with Enter, like the island's PepSwitc),
  //      the BAATAT cheat state the decor sets' era table reads, and the render mode FUN_00444550 of a record the set-up scan could not resolve
  decorRender = {
    setModel: (rec: GameRecord, model: Model | null) => { if (model) this.zg?.gr.setModel(rec, model); },
    setAttach: (rec: GameRecord, slot: number, bone: number, child: Model | null) => this.zg?.gr.setAttach(rec, slot, bone, child),
    attachLocal: (rec: GameRecord, slot: number, m: Float32Array | null) => {
      const gr = this.zg?.gr; if (!gr) return;
      let mm = gr.attachLocal.get(rec);
      if (!mm) gr.attachLocal.set(rec, (mm = new Map()));
      if (m) mm.set(slot, m); else mm.delete(slot);
    },
    shiny: (model: Model) => this.zg?.gr.setModelShiny(model),
  };
  baatat(): boolean { return cheatState.baatat; }
  partMode(rec: GameRecord, partMask: number, mode: number) { this.zg?.gr.setPartMode(rec, partMask, mode); }

  // ---- FX_Bricks (needs the brick library `installBrickLibrary`: HubSpec.bricks)
  brickMorph(rec: GameRecord, v: number, files: readonly string[], matrix: Float32Array) { return brickMorph(this.world, rec, v, files, matrix); }
  brickBurst(rec: GameRecord, kind: number) { brickBurst(this.world, rec, kind); }

  // ---- dictionaries
  animClip(name: string): number | undefined { return this.setup.dictionaries.anims.get(name); }
  switchVar(name: string): number | undefined { return this.setup.dictionaries.switches.get(name); }
}
