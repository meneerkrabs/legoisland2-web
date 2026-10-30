// The real island context (src/island/ctx.ts `IslandCtx`): what the island's behaviour nodes ask of the shell, bound to the zone runner's services
// (playzone.ts `ZoneGameCtx`: cutscene host, speech + subtitles, sounds). It is created and installed on the world BEFORE `setupZone` runs (the node
// factories may look it up while they are built); the zone game binds the runner's services to it when it is constructed (`bind`).
import type { Archive } from '../../formats/archive.ts';
import type { Pe, ZoneScene } from '../../formats/exe.ts';
import type { IslandSetup } from '../../formats/emusetup.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { Model } from '../../formats/exe.ts';
import { cheatState } from '../../shell/cheats.ts';
import { RF_ENABLED } from '../../game/record.ts';
import { partOverrides } from '../../island/trigger/parts.ts';
import type { IslandCtx } from '../../island/ctx.ts';
import { loadMessages } from '../../ui/strings.ts';
import { restoreHooks } from '../../restore/flag.ts';
import type { MessageTable } from '../../ui/strings.ts';
import type { ZoneGameCtx, SubtitleMode } from '../../shell/zonegame.ts';
import type { AudioHost } from '../../shell/audiohost.ts';
import { Objective } from './objective.ts';
import type { VehicleObjective } from './objective.ts';
import { musicKeysFor } from '../../island/ambient/music.ts';
import type { SoundLoad } from '../../audio/zonesounds.ts';
import { brickMorph, brickBurst } from '../../fx/bricks/island.ts';
import { vehicles } from '../../island/vehicles/common.ts';
import { waypoints } from '../../game/walker.ts';
import type { ZoneParticles } from '../../fx/particles/zone.ts';

/** the `messages` archive path of a story-handler string such as `_DATA/messages/li/Data/lifsm1.str` -> `li/Data/lifsm1.str` */
export function messagePath(raw: string): string {
  const p = raw.replace(/\\/g, '/');
  const i = p.toLowerCase().indexOf('messages/');
  return i >= 0 ? p.slice(i + 'messages/'.length) : p;
}

export class IslandContext implements IslandCtx {
  readonly world: World;
  readonly pe: Pe;
  readonly archive: Archive;
  readonly setup: IslandSetup;
  readonly era: number;
  /** the zone's scene (WP4: model paths / sub-object matrices) */
  readonly scene?: ZoneScene;
  readonly text: { npc: MessageTable | null; hol: MessageTable | null } = { npc: null, hol: null };
  /** the paths of the two selected tables (diagnostics / tests) */
  readonly textPaths: { npc: string | null; hol: string | null } = { npc: null, hol: null };
  readonly shared: Record<string, unknown> = {};
  /** cutscene slots of the set-up whose script / message file is not in the data (left undeclared) */
  readonly missingCutscenes: string[] = [];
  /** the story's objective (objective.ts) */
  readonly goal = new Objective();
  readonly objective: NonNullable<IslandCtx['objective']>;
  /** the `messages` archive (the story handler's tables) */
  messages: Archive | null = null;
  /** the vehicle branch of the objective (FUN_00424e37): the vehicle tables of src/island/vehicles/common.ts */
  vehicleObjective(): VehicleObjective {
    const G = vehicles(this.world);
    return { kind: G.kind, docks: G.docks, pads: G.pads, nodePos: (map, node) => waypoints.nodePos(map, node) };
  }
  /** PATH node position (FUN_00462be9(1, n)) for the objective's mode 3 */
  pathPos: (n: number) => readonly number[] | null = () => null;
  private zg: ZoneGameCtx | null = null;
  private audio: AudioHost | null = null;
  private tables = new Map<string, MessageTable | null>();

  constructor(world: World, pe: Pe, archive: Archive, setup: IslandSetup, scene?: ZoneScene) {
    this.world = world; this.pe = pe; this.archive = archive; this.setup = setup; this.era = setup.era; this.scene = scene;
    const goal = this.goal, self = this;
    this.objective = {
      target: (from: GameRecord | null) => goal.target(self.world.records, from, self.world.vars.get(0x5e), self.pathPos, self.vehicleObjective()),
      get holoTimer() { return goal.holoTimer; },
      set holoTimer(v: number) { goal.holoTimer = v; },
    };
  }

  /** the runner's services (the zone game's construction) */
  bind(zg: ZoneGameCtx, messages: Archive | null) {
    this.zg = zg; this.audio = zg.sh.audio; this.messages = messages;
    this.loadObjectSounds();
    // WP10: the renderer draws the live sub-object matrices of doors / swinging parts / rotors (WP4's contract, src/island/trigger/parts.ts)
    zg.gr.partMatrices = (rec) => partOverrides(this.world, rec);
  }

  /**
   * What the constructors of the placed objects load beyond the zone's sound list: Sound3d (FUN_00538779) the 3D sound of its first argument, SGMFIG (FUN_00426151)
   * the 2D sound of its argument block; and the music keys of the Music node (FUN_004bc773 loads them at init, by story node). All of it is loaded before the first frame.
   */
  private loadObjectSounds() {
    const a = this.audio;
    if (!a?.ga) return;
    const loads: SoundLoad[] = [];
    for (const r of this.world.records) {
      for (const n of r.ctrl?.nodes ?? []) {
        if (n.kind === 'Sound3d') loads.push(['3d', (n as unknown as { soundId: number }).soundId]);
        else if (n.kind === 'SGMFIG') { const s = (n as unknown as { args?: { sound?: number } }).args?.sound; if (typeof s === 'number' && s > 0) loads.push(['2d', s]); }
      }
    }
    if (loads.length) a.loadExtra(loads);
    a.preloadMusic(musicKeysFor(this.world.vars.get(0x58)));
  }

  // ---- rendering services (WP10, docs/re/m4/wp10-render.md)
  /**
   * Record flag 1 (FUN_00444370, every frame): cleared for a record that is not enabled (flags & 2), set for one without a collision object, else the
   * collision sphere (col +0xc centre in record space, +0x24 radius) against the view frustum (FUN_00416590). The port tests against the planes of the
   * last drawn frame (the original's nodes also read the flag of the previous frame's test); true before the first frame / without a renderer.
   */
  readonly inFrustum = (rec: GameRecord): boolean => {   // an arrow: callers keep the bare function (src/island/npc/globals.ts)
    if ((rec.flags & RF_ENABLED) === 0) return false;
    const co = rec.colObj, gr = this.zg?.gr;
    if (!co || !gr) return true;
    return gr.sphereVisible(rec.toWorld(co.col.center), co.radius);
  };
  /** FUN_0043ebe0(model, 0, du, dv): accumulate a UV offset on every group of the record's part-0 mesh (GameRenderer.scrollGroup) */
  uvScroll(rec: GameRecord, du: number, dv: number) {
    const gr = this.zg?.gr;
    if (!gr) return;
    const n = gr.groupCount(rec);
    for (let g = 0; g < n; g++) gr.scrollGroup(rec, g, du, dv);
  }

  // ---- the story handler's message tables (FUN_00423fe0 / FUN_0088d280 load, FUN_00423ff6 / FUN_0088d296 free)
  /** a `.str` table of the messages archive by the executable's path string (cached; null when missing) */
  table(raw: string): MessageTable | null {
    const p = messagePath(raw);
    if (this.tables.has(p)) return this.tables.get(p)!;
    let t: MessageTable | null = null;
    if (this.messages) { try { t = loadMessages(this.messages, [p]); if (restoreHooks.messages) t = restoreHooks.messages(p, t); } catch { t = null; } }
    this.tables.set(p, t);
    return t;
  }
  setText(which: 'npc' | 'hol', raw: string | null) {
    this.textPaths[which] = raw === null ? null : messagePath(raw);
    this.text[which] = raw === null ? null : this.table(raw);
  }

  // ---- cutscene manager
  startCutscene(slot: number): boolean {
    const start = (s: number) => this.zg?.cutscene.start(s) ?? false;
    return restoreHooks.startCutscene?.(slot, start) ?? start(slot);   // restored content (option off: unset)
  }
  cutsceneActive(): boolean { const a = this.zg?.cutscene.active() ?? false; return restoreHooks.cutsceneActive ? restoreHooks.cutsceneActive(a) : a; }
  holdCutscene(on: boolean) { this.zg?.cutscene.hold(on); }

  // ---- speech
  say(table: MessageTable, id: string, id2?: string, voice = true, subtitle: SubtitleMode = 'timed'): boolean {
    const speak = (t: MessageTable, a: string, b?: string) => this.zg?.sayFrom(t, a, b, voice, subtitle) ?? false;
    return restoreHooks.say?.(table, id, id2, speak) ?? speak(table, id, id2);   // restored content (option off: unset)
  }
  clearSubtitle() { this.zg?.clearSubtitle(); }
  /** FUN_0043f2f0: the face frame of a minifig (the renderer draws `GameRecord.face`) */
  expression(rec: GameRecord, n: number) { rec.face = n; }
  speechIdle(): boolean { return this.zg?.speechIdle() ?? true; }
  stopSpeech() { this.zg?.stopSpeech(); }

  // ---- sound: the zone's sound list (FUN_004b037e + the constructor classes' loads) is loaded by `AudioHost.enterZone` before the loop starts, so every call finds its slot
  sfx(id: number) { this.world.playSound(id); }
  stopSfx(id: number) { this.audio?.stop(id); }
  /** FUN_00443600 */
  sfxFreq(id: number, hz: number) { this.audio?.rate(id, hz); }
  /** FUN_004433f0: a 3D sound at `pos` (the listener follows the camera in the audio module): plays, updates or culls by distance */
  sfxAt(id: number, pos: readonly [number, number, number]) { this.audio?.playAt(id, pos); }

  // ---- music (Music.c, WP7): FUN_004432c0 / FUN_00443310 / FUN_00873e00 / FUN_004431e0 forwarded to the session's GameAudio (silent without audio)
  /** FUN_004432c0(handle of `key`): the keys the Music node loads (musicKeysFor) are loaded when the zone starts (AudioHost.enterZone via `preloadMusic`) */
  music(key: string) { this.audio?.playMusic(key); }
  musicGroove(level: number) { try { this.audio?.ga?.music.setGroove(level); } catch { /* silent */ } }
  /** FUN_00443370: a DirectMusic segment notification was waiting (taken from the queue); 0 / 1 */
  musicNotified(): number { try { return this.audio?.ga?.music.pollNotification() ? 1 : 0; } catch { return 0; } }
  musicMute(on: boolean) { try { this.audio?.ga?.music.setMute(on); } catch { /* silent */ } }
  ambience(name: string) { this.audio?.ga?.ambience.start(name).catch(() => { /* silent */ }); }

  // ---- FX_Bricks (WP9, src/fx/bricks/island.ts: the manager needs the brick library the zone game installs, `installBrickLibrary`)
  /** FUN_00447d20 + FUN_00447da0 x n + FUN_00447d70 + FUN_00447e90(rec, 6) + FUN_00447e70: the Brikimal's morphing animal */
  brickMorph(rec: GameRecord, v: number, files: readonly string[], matrix: Float32Array) { return brickMorph(this.world, rec, v, files, matrix); }
  /** FUN_00447e90(rec, kind) */
  brickBurst(rec: GameRecord, kind: number) { brickBurst(this.world, rec, kind); }

  // ---- FX_Particles (src/island/emitters.ts)
  /** the decor / outfit swap's renderer calls (src/island/decor.ts) */
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
  /** FUN_00444550 (WP-RENDER `setPartMode`): the render mode of the parts of a record the set-up scan could not resolve (boat rip / wakes, record 370) */
  partMode(rec: GameRecord, partMask: number, mode: number) { this.zg?.gr.setPartMode(rec, partMask, mode); }
  /** the zone's particle engine (installed by the zone game, null without particle data): the island's nodes start their emitters through it (src/island/emitters.ts) */
  fx: ZoneParticles | null = null;

  // ---- dictionaries
  animClip(name: string): number | undefined { return this.setup.dictionaries.anims.get(name); }
  switchVar(name: string): number | undefined { return this.setup.dictionaries.switches.get(name); }
}
