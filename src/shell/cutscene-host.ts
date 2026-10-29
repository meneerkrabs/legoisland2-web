// Browser glue of the cutscene runner (src/shell/cutscene.ts): loads the scripts of a zone's cutscene slots (`FUN_0045c366` / `FUN_0045c397`: script `Cutscene/<name>.cut` of an
// archive, messages `messages/<AREA>/Data/<name>.str`, the `.man` splines the scripts name), builds the runner's environment from the shell (speech, options, waypoints,
// dictionaries, FOV, near plane, letterbox) and draws the subtitle.
// The zone runner (playzone.ts) creates one per zone as `ctx.cutscene`; zones call `declare` in their factory, `start` where the original calls `FUN_0045c40c`, and `tick` where
// it calls `FUN_0045c402` (every frame of the modes that run scripts). The island zone game passes its waypoint system and the dictionaries of the emulated set-up
// (`IslandSetup.dictionaries`) through the options or `setDictionaries`.
import type { Archive } from '../formats/archive.ts';
import { parseCutscene } from '../formats/cutscene.ts';
import type { Cutscene } from '../formats/cutscene.ts';
import { parseMan } from '../formats/anim.ts';
import type { Man } from '../formats/anim.ts';
import { loadMessages } from '../ui/strings.ts';
import type { MessageTable } from '../ui/strings.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { B } from '../game/input.ts';
import type { World } from '../game/world.ts';
import { WaypointSystem, MAP_CSM, MAP_PATH, MAP_NAMES } from '../game/walker.ts';
import type { GameRenderer } from '../game/render.ts';
import type { Hud } from './hud.ts';
import type { Shell } from './shell.ts';
import { CutsceneRunner, dictLookup, switchResolver } from './cutscene.ts';
import type { CutsceneEnv } from './cutscene.ts';
import { drawSubtitle } from './helpscreen.ts';

export interface CutsceneSlotSpec {
  slot: number;
  /** archive that holds the script (`Cutscene/<script>.cut`): the zone name the manager was pointed at (`FUN_0045c366("z40OGL", "og")` for z40aPO) */
  zone: string;
  /** script file name without extension (FUN_0045c397's second argument) */
  script: string;
  /** message file name without extension (the third argument: it can differ from the script name) */
  strings: string;
  /** message area folder (`FUN_0045c366`'s second argument: "li", "ci", "ai", "og") */
  area: string;
}

/** the name dictionaries the loader resolves SETANIM / SETSWITCH names with (island: `IslandSetup.dictionaries`) */
export interface CutsceneDictionaries {
  /** DAT_05d4d484: animation name -> clip number (`<RIG>_<RIG>_<ANIM>`, `XIDLE` ...) */
  anims?: ReadonlyMap<string, number>;
  /** DAT_00987e20: the zone's switch names -> game variable (island: `SWITCH_LGI_*` -> 250..317); the SWITCH_GME_* names (DAT_00987e1c) come from the game variables */
  switches?: ReadonlyMap<string, number>;
}

export interface CutsceneHostOptions {
  /** the zone's waypoint system (the actors' walkers live in it; the island zone game: `waypoints` of src/game/walker.ts with the zone's maps loaded). Missing CSM / PATH
   *  maps are loaded from the archive. Default: a private system with the archive's W_CSM / W_PATH maps (no walkers: actor walks then do nothing, like a null walker) */
  waypoints?: WaypointSystem;
  dictionaries?: CutsceneDictionaries;
}

export class CutsceneHost {
  readonly runner: CutsceneRunner;
  readonly wp: WaypointSystem;
  private tables = new Map<number, MessageTable>();
  private mans = new Map<string, Man | null>();
  private anims = dictLookup(undefined);
  private switches = switchResolver(undefined, { indexOf: () => -1 });
  private world: World;
  private sh: Shell;
  private archive: Archive;

  constructor(sh: Shell, world: World, archive: Archive, gr: GameRenderer, hud: Hud, opts: CutsceneHostOptions = {}) {
    this.sh = sh;
    this.archive = archive;
    this.world = world;
    this.switches = switchResolver(undefined, world.vars);
    this.wp = opts.waypoints ?? new WaypointSystem();
    for (const slot of [MAP_PATH, MAP_CSM]) {
      if (this.wp.maps[slot]) continue;
      const e = archive.find(`Waypoints/W_${MAP_NAMES[slot]}_C.wpt`);
      if (e) { try { this.wp.loadMap(slot, archive.read(e)); } catch (err) { console.warn('cutscene waypoints', MAP_NAMES[slot], err); } }
    }
    if (opts.dictionaries) this.setDictionaries(opts.dictionaries);
    const env: CutsceneEnv = {
      world,
      wp: this.wp,
      waypoint: (name) => this.waypoint(name),
      text: (id) => this.tables.get(this.runner.currentSlot)?.text(id) ?? id,
      say: (id) => {
        const t = this.tables.get(this.runner.currentSlot);
        const v = t?.voice(id) ?? -1;
        if (v < 0) return false;
        const sp = sh.audio.ga?.speech;
        return sp ? sp.say(v, -1) : false;
      },
      speechIdle: () => sh.audio.ga?.speech.idle ?? true,
      stopSpeech: () => sh.audio.ga?.speech.stop(),
      setFov: (f) => { gr.fov = f; },
      getFov: () => gr.fov,
      setNearPlane: (n) => { gr.near = n; },
      skipPressed: () => (sh.input.pressed & B.SHIFT) !== 0,
      speechOn: () => sh.options.speechOn,
      textOn: () => sh.options.subtitlesOn,
      letterbox: (m) => { hud.letterbox = m; },
      animClip: (_a, name) => this.anims(name) ?? -1,
      varIndex: (name) => this.switches(name),
      loadMan: (path) => this.mans.get(path.toUpperCase()) ?? null,
      random: Math.random,
    };
    this.runner = new CutsceneRunner(env);
  }

  /** the zone's name dictionaries (island: `IslandSetup.dictionaries`) */
  setDictionaries(d: CutsceneDictionaries) {
    if (d.anims) this.anims = dictLookup(d.anims);
    if (d.switches) this.switches = switchResolver(d.switches, this.world.vars);
  }

  /** FUN_0045c397 for every slot of `specs` (FUN_0045c310(n) with n = the highest slot + 1); the `.man` splines the scripts name are loaded here */
  async declare(specs: CutsceneSlotSpec[]): Promise<void> {
    this.runner.allocate(Math.max(0, ...specs.map((s) => s.slot)) + 1);
    const messages = await this.sh.data.archive('messages');
    for (const s of specs) {
      const arc = await this.sh.data.archive(s.zone);
      const e = arc.find(`cutscene/${s.script}.cut`);
      if (!e) throw new Error(`${s.zone}: no cutscene/${s.script}.cut`);
      const cut = parseCutscene(arc.read(e));
      this.runner.define(s.slot, s.script, cut);
      this.tables.set(s.slot, loadMessages(messages, [`${s.area.toUpperCase()}/Data/${s.strings}.str`]));
      await this.loadSplines(cut);
    }
  }

  /** the `.man` files of a script's spline targets (`Z02LGI\MATANIM\X.MAN`: the first component is the zone archive) */
  private async loadSplines(cut: Cutscene) {
    for (const c of cut.commands) {
      if (c.targetKind !== 'spline' || !c.target) continue;
      const key = c.target.toUpperCase();
      if (this.mans.has(key)) continue;
      const parts = c.target.split(/[\\/]/).filter((p) => p !== '');
      let man: Man | null = null;
      try {
        const zone = parts.length > 1 ? parts[0] : this.archive.name;
        const arc = zone.toLowerCase() === this.archive.name.toLowerCase() ? this.archive : await this.sh.data.archive(zone);
        const e = arc.find(parts.slice(parts.length > 1 ? 1 : 0).join('/'));
        if (e) man = parseMan(arc.read(e));
      } catch (err) { console.warn('cutscene spline', c.target, err); }
      this.mans.set(key, man);
    }
  }

  /** the legacy lookup (FUN_00462b4e on CSM, then PATH; prefix match) */
  private waypoint(name: string): [number, number, number] | null {
    for (const map of [MAP_CSM, MAP_PATH]) {
      const i = this.wp.findNode(map, name.toUpperCase());
      if (i >= 0) { const p = this.wp.nodePos(map, i); return [p[0], p[1], p[2]]; }
    }
    return null;
  }

  /** FUN_0045c40c */
  start(slot: number): boolean { return this.runner.start(slot); }
  /** FUN_0045c402: the script's frame (call once per tick of the modes that run it) */
  tick() { this.runner.tick(); }
  /** FUN_0045c432 */
  active(): boolean { return this.runner.active(); }
  /** FUN_0045c456 */
  hold(on: boolean) { this.runner.override = on; }
  abort() { this.runner.abort(); }
  /** the logical attachments of ATTACH (records without a carry node) follow their parent's bone: call every frame (pre-render) also when no script runs */
  applyCarried() { this.runner.applyCarried(); }
  /** the subtitle of the running SAYTEXT, drawn like the HUD's four lines (helpscreen.ts `drawSubtitle`, FUN_0045d47f wrapping) */
  draw(ui: Ui2D) {
    const s = this.runner.subtitle;
    if (s) drawSubtitle(ui, s.text);
  }
}
