// The real island context (src/island/ctx.ts `IslandCtx`): what the island's behaviour nodes ask of the shell, bound to the zone runner's services
// (playzone.ts `ZoneGameCtx`: cutscene host, speech + subtitles, sounds). It is created and installed on the world BEFORE `setupZone` runs (the node
// factories may look it up while they are built); the zone game binds the runner's services to it when it is constructed (`bind`).
import type { Archive } from '../../formats/archive.ts';
import type { Pe, ZoneScene } from '../../formats/exe.ts';
import type { IslandSetup } from '../../formats/emusetup.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';
import { partOverrides } from '../../island/trigger/parts.ts';
import type { IslandCtx } from '../../island/ctx.ts';
import { loadMessages } from '../../ui/strings.ts';
import type { MessageTable } from '../../ui/strings.ts';
import type { ZoneGameCtx } from '../../shell/zonegame.ts';
import type { AudioHost } from '../../shell/audiohost.ts';
import { Objective } from './objective.ts';
import { brickMorph, brickBurst } from '../../fx/bricks/island.ts';

/** the `messages` archive path of a story-handler string such as `_DATA/messages/li/Data/lifsm1.str` -> `li/Data/lifsm1.str` */
export function messagePath(raw: string): string {
  const p = raw.replace(/\\/g, '/');
  const i = p.toLowerCase().indexOf('messages/');
  return i >= 0 ? p.slice(i + 'messages/'.length) : p;
}

type Slot3D = Awaited<ReturnType<NonNullable<AudioHost['ga']>['sfx']['load3D']>>;

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
  /** PATH node position (FUN_00462be9(1, n)) for the objective's mode 3 */
  pathPos: (n: number) => readonly number[] | null = () => null;
  private zg: ZoneGameCtx | null = null;
  private audio: AudioHost | null = null;
  private tables = new Map<string, MessageTable | null>();
  private slots3d = new Map<number, Slot3D | null | 'loading'>();

  constructor(world: World, pe: Pe, archive: Archive, setup: IslandSetup, scene?: ZoneScene) {
    this.world = world; this.pe = pe; this.archive = archive; this.setup = setup; this.era = setup.era; this.scene = scene;
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
    // WP10: the renderer draws the live sub-object matrices of doors / swinging parts / rotors (WP4's contract, src/island/trigger/parts.ts)
    zg.gr.partMatrices = (rec) => partOverrides(this.world, rec);
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
  say(table: MessageTable, id: string, id2?: string): boolean { return this.zg?.sayFrom(table, id, id2) ?? false; }
  /** FUN_0043f2f0: the face frame of a minifig (the renderer draws `GameRecord.face`) */
  expression(rec: GameRecord, n: number) { rec.face = n; }
  speechIdle(): boolean { return this.zg?.speechIdle() ?? true; }
  stopSpeech() { this.zg?.stopSpeech(); }

  // ---- sound
  sfx(id: number) { this.world.playSound(id); }
  stopSfx(id: number) { this.audio?.stop(id); }
  /** FUN_00443600 */
  sfxFreq(id: number, hz: number) { this.audio?.rate(id, hz); }
  /** FUN_004433f0: a 3D one-shot at `pos` (the listener follows the camera in the audio module); the first play of an id only loads it, like the 2D sink */
  sfxAt(id: number, pos: readonly [number, number, number]) {
    const ga = this.audio?.ga;
    if (!ga) return;
    try {
      const s = this.slots3d.get(id);
      if (s === undefined) {
        this.slots3d.set(id, 'loading');
        ga.sfx.load3D(id).then((x) => this.slots3d.set(id, x)).catch(() => this.slots3d.set(id, null));
      } else if (s && s !== 'loading') ga.sfx.play3D(s, { x: pos[0], y: pos[1], z: pos[2] });
    } catch { /* silent */ }
  }

  // ---- music (Music.c, WP7): FUN_004432c0 / FUN_00443310 / FUN_00873e00 / FUN_004431e0 forwarded to the session's GameAudio (silent without audio)
  private musicKey = '';
  music(key: string) {
    const ga = this.audio?.ga;
    if (!ga) return;
    this.musicKey = key;
    ga.music.load(key).then((h) => { if (h && this.musicKey === key) ga.music.play(h); }).catch(() => { /* a missing key plays nothing */ });
  }
  musicGroove(level: number) { try { this.audio?.ga?.music.setGroove(level); } catch { /* silent */ } }
  musicMute(on: boolean) { try { this.audio?.ga?.music.setMute(on); } catch { /* silent */ } }
  ambience(name: string) { this.audio?.ga?.ambience.start(name).catch(() => { /* silent */ }); }

  // ---- FX_Bricks (WP9, src/fx/bricks/island.ts: the manager needs the brick library the zone game installs, `installBrickLibrary`)
  /** FUN_00447d20 + FUN_00447da0 x n + FUN_00447d70 + FUN_00447e90(rec, 6) + FUN_00447e70: the Brikimal's morphing animal */
  brickMorph(rec: GameRecord, v: number, files: readonly string[], matrix: Float32Array) { return brickMorph(this.world, rec, v, files, matrix); }
  /** FUN_00447e90(rec, kind) */
  brickBurst(rec: GameRecord, kind: number) { brickBurst(this.world, rec, kind); }

  // ---- dictionaries
  animClip(name: string): number | undefined { return this.setup.dictionaries.anims.get(name); }
  switchVar(name: string): number | undefined { return this.setup.dictionaries.switches.get(name); }
}
