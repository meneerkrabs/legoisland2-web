// Browser glue of the cutscene runner (src/shell/cutscene.ts): loads the scripts of a zone's cutscene slots (`FUN_0045c366` / `FUN_0045c397`: script `Cutscene/<name>.cut` of an
// archive, messages `messages/<AREA>/Data/<name>.str`), builds the runner's environment from the shell (speech, options, waypoints, FOV, letterbox) and draws the subtitle.
// The zone runner (playzone.ts) creates one per zone as `ctx.cutscene`; zones call `declare` in their factory, `start` where the original calls `FUN_0045c40c`, and `tick` where
// it calls `FUN_0045c402` (every frame of the modes that run scripts).
import type { Archive } from '../formats/archive.ts';
import { parseCutscene } from '../formats/cutscene.ts';
import { parseCompiledWaypoints } from '../formats/waypoints.ts';
import type { CompiledWaypoints } from '../formats/waypoints.ts';
import { loadMessages } from '../ui/strings.ts';
import type { MessageTable } from '../ui/strings.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { B } from '../game/input.ts';
import type { World } from '../game/world.ts';
import type { GameRenderer } from '../game/render.ts';
import type { Hud } from './hud.ts';
import type { Shell } from './shell.ts';
import { CutsceneRunner } from './cutscene.ts';
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

export class CutsceneHost {
  readonly runner: CutsceneRunner;
  private tables = new Map<number, MessageTable>();
  private maps: CompiledWaypoints[] = [];
  private sh: Shell;

  constructor(sh: Shell, world: World, archive: Archive, gr: GameRenderer, hud: Hud) {
    this.sh = sh;
    for (const f of ['Waypoints/W_CSM_C.wpt', 'Waypoints/W_PATH_C.wpt']) {
      const e = archive.find(f);
      if (e) { try { this.maps.push(parseCompiledWaypoints(archive.read(e))); } catch (err) { console.warn('cutscene waypoints', f, err); } }
    }
    const env: CutsceneEnv = {
      world,
      waypoint: (name) => this.waypoint(name),
      text: (id) => this.tables.get(this.runner.currentSlot)?.text(id) ?? id,
      say: (id) => {
        const t = this.tables.get(this.runner.currentSlot);
        const v = t?.voice(id) ?? -1;
        if (v < 0) return true;
        const sp = sh.audio.ga?.speech;
        return sp ? sp.say(v, -1) : true;
      },
      speechIdle: () => sh.audio.ga?.speech.idle ?? true,
      stopSpeech: () => sh.audio.ga?.speech.stop(),
      setFov: (f) => { gr.fov = f; },
      getFov: () => gr.fov,
      skipPressed: () => (sh.input.pressed & B.SHIFT) !== 0,
      speechOn: () => sh.options.speechOn,
      textOn: () => sh.options.subtitlesOn,
      letterbox: (m) => { hud.letterbox = m; },
      varIndex: (name) => { const i = world.vars.indexOf(name); return i >= 0 ? i : null; },
    };
    this.runner = new CutsceneRunner(env);
  }

  /** FUN_0045c397 for every slot of `specs` (FUN_0045c310(n) with n = the highest slot + 1) */
  async declare(specs: CutsceneSlotSpec[]): Promise<void> {
    this.runner.allocate(Math.max(0, ...specs.map((s) => s.slot)) + 1);
    const messages = await this.sh.data.archive('messages');
    for (const s of specs) {
      const arc = await this.sh.data.archive(s.zone);
      const e = arc.find(`cutscene/${s.script}.cut`) ?? arc.find(`Cutscene/${s.script}.cut`);
      if (!e) throw new Error(`${s.zone}: no cutscene/${s.script}.cut`);
      this.runner.define(s.slot, s.script, parseCutscene(arc.read(e)));
      this.tables.set(s.slot, loadMessages(messages, [`${s.area.toUpperCase()}/Data/${s.strings}.str`]));
    }
  }

  private waypoint(name: string): [number, number, number] | null {
    const up = name.toUpperCase();
    for (const m of this.maps) {
      const n = m.nodes.find((x) => x.name === up) ?? m.nodes.find((x) => x.name.startsWith(up));
      if (n) return [n.x, n.y, n.z];
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
  /** the subtitle of the running SAYTEXT, drawn like the HUD's four lines (helpscreen.ts `drawSubtitle`) */
  draw(ui: Ui2D) {
    const s = this.runner.subtitle;
    if (s) drawSubtitle(ui, s.text);
  }
}
