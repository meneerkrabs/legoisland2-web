// The generic hub zone game (M5): everything the six hub loops (z07CSI FUN_00572910, z13CAI FUN_0061a821, z14OSD FUN_00627c90, z16PYA FUN_00675930, z23DIP
// FUN_00725ec1, z40OGL FUN_007e247f) share with the island's FUN_004afaf7 on top of the zone runner (src/shell/playzone.ts, loopmachine.ts HUB_CONFIG):
//   set-up   the hub's root (code.root of zoneCodeIndex: loader + set-up proper) runs in the x86 emulation against the live game variables
//            (profileFor(..., { emuVars }) -> `profile.emu`), the HubContext is installed before the behaviour nodes are built (`registerZoneSetup`),
//            the emulated PEPP position is Pepper's arrival (HubSpec.arrival overrides), the set-up's waypoint maps and the shared node families' world work
//            (walkers, ground snap, animation instances from the loader's rigs) run after `setupZone`;
//   mode 1   waits for any button with the frozen world on screen (`introPanel = false`, like the island);
//   mode 2   cutscene frame -> controllers (world.tick) -> story FSM (FUN_00423bad) -> the hub's story handler when var 0x58 changed (HubSpec.story, the
//            island's {prev,next} protocol, story.ts) -> the hub's per-frame code every loop pass (HubSpec.frame: the loop's HUD function FUN_00575ca0 / FUN_0061bf8c ...).
// What a hub worker supplies (HubSpec): the story handler port, the per-frame / HUD port, the arrival place, its own constructors (`ctors`, registerCtor by
// address) and services (`HubContext.hub`). Registration: `registerHub({ archive: 'z07CSI', ... })` from the hub's module (src/zones/z07CSI/index.ts).
import { debugAids } from '../game/debug.ts';
import '../island/index.ts';
import { registerCtor } from '../game/setup.ts';
import type { CtorFactory, ZoneProfile, Loaded } from '../game/setup.ts';
import { registerZoneGame, registerZoneSetup } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import { EXIT } from '../shell/loopmachine.ts';
import type { CutsceneSlotSpec } from '../shell/cutscene-host.ts';
import type { Shell } from '../shell/shell.ts';
import type { Archive } from '../formats/archive.ts';
import type { ZoneScene } from '../formats/exe.ts';
import type { IslandSetup } from '../formats/emusetup.ts';
import type { World } from '../game/world.ts';
import type { GameRecord } from '../game/record.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { UiTextureSet } from '../ui/renderer2d.ts';
import { V } from '../game/vars.ts';
import { waypoints, MAP_PATH, NPC_SPEED, NPC_TURN_RATE, NPC_RADIUS_MIN, NPC_RADIUS_MAX, NPC_RADIUS_LIMIT } from '../game/walker.ts';
import { installCtx } from '../island/ctx.ts';
import { decorStore } from '../island/decor.ts';
import { loadIslandWalkMaps, startIslandNpcs } from '../island/npc/index.ts';
import { startPizzaNodes } from '../island/pizza/index.ts';
import { ensureAnim } from '../island/ambient/common.ts';
import { computeIslandTotals } from '../zones/z03PPH/totals.ts';
import { pathPositions } from '../zones/z02LGI/index.ts';
import { BrickLibrary } from '../formats/bricks.ts';
import { installBrickLibrary, islandBrickFx, drawBrickFx } from '../fx/bricks/index.ts';
import { ZoneParticles } from '../fx/particles/zone.ts';
import { HubContext } from './ctx.ts';
import { liveHubStoryEnv } from './story.ts';
import { applyEmulatedArrival } from './arrival.ts';
import { replaySetupState } from './setupstate.ts';
import type { HubStoryHandler, StoryRef } from './story.ts';

const CTX_KEY = 'island';   // the key of src/island/ctx.ts (`installCtx`): the island node families find the hub context under it
/** the hub context installed on a world */
export const hubOf = (w: World) => w.ext.get(CTX_KEY) as HubContext;

/** FUN_0042207d: Pepper's lane offset (0x3c23d70a) */
const PEPPER_LANE = 0.01;

/** where Pepper arrives: position + yaw (the record's own yaw when omitted) */
export interface HubArrival { pos: [number, number, number]; yaw?: number }

/** what `HubSpec.arrival` gets */
export interface HubArrivalEnv {
  /** zone table index of the zone Pepper comes from (var 0xa3 PREV_SUBGAME) and the story node (var 0x58) */
  prev: number; node: number;
  records: GameRecord[];
  /** the emulated set-up (`emu.records[i].pos` = the position the original's code gave the record, e.g. Pepper's) */
  emu: IslandSetup;
  /** FUN_00462be9(1, n): a node of the hub's PATH map */
  pathPos: (n: number) => readonly number[] | null;
  vars: { get(i: number): number };
}

export interface HubSpec {
  /** archive name of the hub ('z07CSI') */
  archive: string;
  /** the hub's story handler port (FUN_00574e40 for the castle): called once by the set-up with `setupCall` and on every node change in play */
  story?: HubStoryHandler;
  /** the hub's per-frame code of its GameLoop (HUD / counters: FUN_00575ca0, FUN_0061bf8c, FUN_00628410, FUN_006760d0, FUN_00726610, FUN_007e2ad0): every loop pass, any mode */
  frame?: (h: HubGame, mode: number) => void;
  /** extra 2D drawing on top of the cutscene subtitle (the HUD's draw part); `mode` as ZoneGame.draw2d */
  draw2d?: (h: HubGame, ui: Ui2D, dt: number, mode: number) => void;
  /** the arrival place (the hub's set-up writes it itself: default = the position the emulated code gave Pepper's record; return null = leave Pepper where the set-up put her) */
  arrival?: (env: HubArrivalEnv) => HubArrival | null;
  /** the hub's own behaviour constructors (registerCtor by address; the shared families of src/island are registered already) */
  ctors?: ReadonlyArray<readonly [number, CtorFactory]>;
  /** after `setupZone` and the shared world work (walkers, animation instances): the hub's own node initialisation */
  afterSetup?: (a: { ictx: HubContext; world: World; loaded: Loaded; archive: Archive }) => void;
  /** the game exists (the set-up's story call is done): bind services, hook the HUD */
  onCreate?: (h: HubGame) => void;
  /** the loop mode 2 starts (after the intro): music, sounds */
  onStart?: (h: HubGame) => void;
  /** override of the zone the run ends with (the wrapper's `iVar2 == 2` code, e.g. FUN_005726f0); undefined = the default (`next` of the story handler, else the runner's mapping) */
  exit?: (h: HubGame, exit: number) => number | undefined;
  /** false: do not apply the emulated vehicle arrival (arrival.ts: the vehicle record the set-up gave Pepper's matrix + the control mode it wrote) */
  vehicleArrival?: boolean;
  /** install the brick library (FX_Bricks: `ictx.brickMorph` etc.) like the island does */
  bricks?: boolean;
  /** M5 (z23DIP worker, additive): the `Overlays/<dir>` texture set of the HUD when it is not the zone's own (the Dino island's wrapper FUN_007265c0 loads `data\\Overlays\\z14OSD`) */
  overlay?: string;
  /** the zone ends: free what the hub created */
  destroy?: (h: HubGame) => void;
  /** extra debug state (`window.__zone.game.debug()`) */
  debug?: (h: HubGame) => Record<string, unknown>;
}

/** the cutscene slots of the set-up (FUN_0045c366(dir, area) + FUN_0045c397(slot, script, strings)) */
export function hubSlotSpecs(emu: IslandSetup, archiveName: string): CutsceneSlotSpec[] {
  return emu.cutscenes.filter((c) => c.slot !== null && !!c.name).map((c) => ({
    slot: c.slot!, script: c.name!, strings: c.messages ?? c.name!, area: c.area ?? 'li',
    zone: !c.zoneDir || c.zoneDir.toLowerCase() === archiveName.toLowerCase() ? archiveName : c.zoneDir,
  }));
}

export class HubGame implements ZoneGame {
  readonly ctx: ZoneGameCtx;
  readonly ictx: HubContext;
  readonly spec: HubSpec;
  /** the loop's local_8: the node the story handler last handled */
  readonly ref: StoryRef = { prev: -1, next: -10 };
  /** the handler asked to leave: the next zone (the loop's DAT_05d588xx), -1 none */
  next = -1;
  /** story-handler calls during play (diagnostics: node, return) */
  readonly storyLog: { node: number; prev: number; ret: number; tick: number }[] = [];
  private offKey: () => void;
  private aid = false;

  config = { intro: true, help: false };
  introPanel = false;

  constructor(ctx: ZoneGameCtx, ictx: HubContext, spec: HubSpec) {
    this.ctx = ctx; this.ictx = ictx; this.spec = spec;
    const vars = ctx.vars;
    computeIslandTotals(vars);                // FUN_00423bf0 (every hub wrapper calls it)
    // the text tables and the objective the set-up code selected (FUN_00423fe0 / FUN_0088d280 / FUN_00424270 ...), in call order
    replaySetupState(ictx);
    // the set-up's own story-handler call (prev uninitialised): message tables and objective; its record / variable writes were made by the emulation
    if (spec.story) spec.story(liveHubStoryEnv(ictx, true), { prev: -1, next: -10 }, vars.get(V.FSM_CURRENT_STATE));
    this.ref.prev = vars.get(V.FSM_CURRENT_STATE);
    // dev aid (not in the original, like the island's): F9 completes the condition of the current story node
    const onKey = (e: KeyboardEvent) => { if (e.code === 'F9') { this.aid = true; e.preventDefault(); } };
    if (debugAids()) addEventListener('keydown', onKey);   // only with the debug option: the original has no such key
    this.offKey = () => removeEventListener('keydown', onKey);
    spec.onCreate?.(this);
  }

  /** FUN_0045c402: the cutscene frame, before the controllers */
  beforeTick() { this.ctx.cutscene.tick(); }

  update(): number | undefined {
    this.ctx.cutscene.applyCarried();   // actors a script attached to another (until every carrier node is ported)
    if (this.aid) {
      this.aid = false;
      const sh = this.ctx.sh, nd = sh.nodes[sh.story.node];
      if (nd) sh.vars.set(nd.var, (sh.vars.get(nd.var) & ~nd.mask) | nd.value);
    }
    return undefined;
  }

  /** after FUN_00423bad: the story handler when var 0x58 changed */
  storyTick(): number | undefined {
    if (!this.spec.story) return undefined;
    const node = this.ctx.vars.get(V.FSM_CURRENT_STATE);
    if (node === this.ref.prev) return undefined;
    const prev = this.ref.prev;
    const ret = this.spec.story(liveHubStoryEnv(this.ictx), this.ref, node);
    if (this.ref.prev !== prev || ret !== EXIT.RUNNING) this.storyLog.push({ node, prev, ret, tick: this.ctx.world.tickCount });   // (a running cutscene defers it: not logged)
    if (ret === EXIT.RUNNING) return undefined;
    this.next = this.ref.next;
    return ret;
  }

  /** the loop's exit: the hub's own mapping, else local_24 = the handler's zone (exit 2), else the runner's mapping (exit 6 -> FUN_00404be7, 8 -> var 5, 0 -> front end) */
  exitNext(exit: number): number | undefined {
    const own = this.spec.exit?.(this, exit);
    if (own !== undefined) return own;
    if (exit === EXIT.FINISHED && this.next >= 0) return this.next;
    return undefined;
  }

  everyTick(mode: number) { this.spec.frame?.(this, mode); }

  onStart() { this.spec.onStart?.(this); }

  draw2d(ui: Ui2D, dt: number, mode: number) {
    // the cutscene's SAYTEXT subtitle (FUN_0045d47f)
    if (this.ctx.cutscene.active()) this.ctx.cutscene.draw(ui);
    this.spec.draw2d?.(this, ui, dt, mode);
  }

  destroy() { this.spec.destroy?.(this); this.offKey(); this.ctx.cutscene.abort(); }

  debug() {
    const ic = this.ictx, g = ic.goal;
    return {
      zone: this.spec.archive, node: this.ctx.vars.get(V.FSM_CURRENT_STATE), prev: this.ref.prev, next: this.next, texts: { ...ic.textPaths },
      objective: { mode: g.mode, recs: [...g.recs], node: g.node, holoTimer: g.holoTimer, target: ic.objective.target(this.ctx.world.focus ?? null) },
      cutscene: this.ctx.cutscene.active(), missingCutscenes: ic.missingCutscenes, storyLog: this.storyLog.slice(-10), arrival: ic.shared.arrival ?? null, notes: this.ctx.loaded.notes,
      skipped: this.ctx.loaded.skipped.length, attaches: ic.setup.attaches.length, ...(this.spec.debug?.(this) ?? {}),
    };
  }
}

/**
 * Register a hub: its set-up hooks (emulated set-up, context, arrival, walkers), its constructors and its zone game. `import '../../hub/index.ts'` +
 * `registerHub({ archive: 'z07CSI', story, frame, ... })` is all a hub module needs.
 */
export function registerHub(spec: HubSpec) {
  for (const [addr, f] of spec.ctors ?? []) registerCtor(addr, f);
  const hubCtx = (w: World) => hubOf(w);
  registerZoneSetup(spec.archive, {
    profileOptions: (sh, archive) => ({ emuVars: sh.vars, archive }),
    cutsceneOptions: (_sh, world) => ({ waypoints, dictionaries: hubCtx(world).setup.dictionaries }),
    // (a save made in a vehicle keeps it through the exact node blocks, see the island's zone game)
    beforeSetup(sh: Shell, world: World, profile: ZoneProfile, archive: Archive, scene: ZoneScene) {
      const emu = profile.emu;
      if (!emu) throw new Error(`${spec.archive}: no emulated set-up (profileFor needs emuVars)`);
      const ictx = new HubContext(world, sh.pe, archive, emu, spec.archive, scene);
      ictx.pathPos = pathPositions(archive);
      installCtx(world, ictx);
      // the arrival: the set-up code itself put Pepper's record where the original wants her (applySetup applies it), the hub's rule may override
      profile.start = (_arc, records) => {
        if (!spec.arrival) return null;
        const a = spec.arrival({ prev: sh.vars.get(V.PREV_SUBGAME), node: sh.vars.get(V.FSM_CURRENT_STATE), records, emu, pathPos: ictx.pathPos, vars: sh.vars });
        ictx.shared.arrival = a;
        if (!a) return null;
        const pep = records.find((r) => r.name === 'PEPP');
        return { pos: a.pos, yaw: a.yaw ?? pep?.ry ?? 0 };
      };
    },
    afterSetup(_sh, world, loaded, archive) {
      const ictx = hubCtx(world);
      decorStore.ensureDefaults(ictx.pe);   // every hub's roster constructor (FUN_00655de3 / FUN_00698963 / FUN_006277b9 / FUN_005b2a23 ...) runs FUN_00420837: its once-per-process copy of the decor defaults into the saved blob
      // the set-up's waypoint maps (FUN_004630c0) and the shared families' world work (walkers, ground snap, animations)
      loadIslandWalkMaps(archive, ictx.setup);
      // the animation instances the zone's loader gave records (rig + clip from the emulated loader)
      for (const r of ictx.setup.loaderRigs) { const rec = world.records[r.record]; if (rec) ensureAnim(world, rec); }
      startPizzaNodes(world);
      startIslandNpcs(world);
      // FUN_0042207d(PEPP): Pepper's walker on PATH (no node) with the NPC tuning; the cutscenes walk / turn her with it
      const pep = loaded.pepper;
      if (pep.ctrl && waypoints.mapCount(MAP_PATH) > 0) {
        const h = waypoints.create(MAP_PATH, pep, -3);
        pep.ctrl.walker = h;
        if (h) {
          waypoints.setSpeed(h, NPC_SPEED); waypoints.setLane(h, PEPPER_LANE); waypoints.setTurnRate(h, NPC_TURN_RATE);
          waypoints.setRadiusMin(h, NPC_RADIUS_MIN); waypoints.setRadiusMax(h, NPC_RADIUS_MAX); waypoints.setRadiusLimit(h, NPC_RADIUS_LIMIT);
        }
      }
      // the vehicle the set-up put Pepper into (the castle's boat ...) and the control mode it wrote (setupZone reset var 0x5e)
      if (spec.vehicleArrival !== false) ictx.shared.emulatedArrival = applyEmulatedArrival(ictx.setup, world, loaded);
      // M5 (z14OSD worker, additive): the world-dependent half of a node constructor (animation start, record flags, emitters), for the node classes that define it
      // (`ctorInit(world, record)`: the hubs' shared Gems / scorpion / Tumblewd nodes, src/zones/z14OSD): in record order, right after the framework's own world work
      for (const rec of world.records) for (const n of rec.ctrl?.nodes ?? []) (n as { ctorInit?: (w: World, r: GameRecord) => void }).ctorInit?.(world, rec);
      spec.afterSetup?.({ ictx, world, loaded, archive });
    },
  });
  registerZoneGame(spec.archive, async (ctx) => {
    const ictx = hubOf(ctx.world);
    let messages: Archive | null = null;
    try { messages = await ctx.sh.data.archive('messages'); } catch { /* no texts */ }
    ictx.bind(ctx, messages);
    try { ictx.fx = await ZoneParticles.create(ctx); } catch (e) { console.warn(`${spec.archive} particles`, e); }   // M5 (z14OSD worker, additive): every hub gets its particle engine
    // ... and the nodes that start emitters in their constructors do it now (`startEmitters(fx, record)`, record order); the hub's `onCreate` calls `fx.finish()` (FUN_0044e8d0) after its own emitters
    if (ictx.fx) for (const rec of ctx.world.records) for (const n of rec.ctrl?.nodes ?? []) (n as { startEmitters?: (f: ZoneParticles, r: GameRecord) => void }).startEmitters?.(ictx.fx, rec);
    if (spec.overlay) {
      // the HUD's picture set of a zone whose wrapper loads another zone's overlay directory (src/shell/playzone.ts loaded `Overlays/<zone>`)
      try { ctx.hud.set = UiTextureSet.load(ctx.sh.gl.gl, await ctx.sh.data.archive('Overlays'), spec.overlay); } catch (e) { console.warn(`${spec.archive} overlay ${spec.overlay}`, e); }
    }
    if (spec.bricks) {
      try {
        const [bricks, morph] = await Promise.all([ctx.sh.data.archive('Bricks'), ctx.sh.data.archive('BrickMorph')]);
        installBrickLibrary(ctx.world, new BrickLibrary(ctx.sh.pe, bricks, morph));
        ctx.gr.effects = (r) => { const fx = islandBrickFx(ctx.world); if (fx) drawBrickFx(r, fx); };
      } catch (e) { console.warn(`${spec.archive} bricks`, e); }
    }
    // slots whose script is not in the data are left empty; a missing message file (z40OGL OGL03 / OGL04) only means no texts: the original defines the script anyway
    const specs = hubSlotSpecs(ictx.setup, ctx.info.archive ?? spec.archive).filter((sp) => {
      const have = !!ctx.archive.find(`cutscene/${sp.script}.cut`);
      if (!have) ictx.missingCutscenes.push(sp.script);
      return have || sp.zone.toLowerCase() !== ctx.archive.name.toLowerCase();
    });
    try { await ctx.cutscene.declare(specs); } catch (e) { console.warn(`${spec.archive} cutscenes`, e); }
    return new HubGame(ctx, ictx, spec);
  });
}
