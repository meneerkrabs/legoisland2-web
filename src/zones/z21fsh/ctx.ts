// z21FSH: the services the shared talking-minifig node (SGMFIG, FUN_00426151 / FUN_004254a5 / FUN_004249a6) asks of the engine: the cutscene manager's override flag, the speech
// player, the zone's message table (the original loads `AI/Data/fsh.str` with FUN_00423fe0: the `FSHMA` / `FSHMC` lines the fisherman says), the objective the NPC points at.
// A reduced `IslandCtx` (src/island/ctx.ts, the island / hub versions are src/zones/z02LGI/ctx.ts and src/hub/ctx.ts): only what the nodes of this zone use.
import type { IslandCtx } from '../../island/ctx.ts';
import type { ZoneGameCtx } from '../../shell/zonegame.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { MessageTable } from '../../ui/strings.ts';
import { Objective } from '../z02LGI/objective.ts';
import type { ZoneParticles } from '../../fx/particles/zone.ts';

export function makeFshCtx(zg: ZoneGameCtx, fx: ZoneParticles | null): IslandCtx {
  const world = zg.world, goal = new Objective();
  const ctx = {
    world, pe: zg.sh.pe, archive: zg.archive,
    // the emulated island set-up does not exist for a mini-game; nothing of the nodes of this zone reads it
    setup: { era: 0, loaderRigs: [], soundHandles: [], dictionaries: { anims: new Map(), switches: new Map() } },
    era: 0,
    startCutscene: (slot: number) => zg.cutscene.start(slot),
    cutsceneActive: () => zg.cutscene.active(),
    holdCutscene: (on: boolean) => zg.cutscene.hold(on),
    /** `npc` = the table FUN_00423fe0 loaded (fsh.str); `hol` = fshhol.str (FUN_0088d280): only read by a hologram node (hOLO, 0x88d41f), the zone has none */
    text: { npc: zg.strings as MessageTable | null, hol: null as MessageTable | null },
    say: (table: MessageTable, id: string, id2?: string) => zg.sayFrom(table, id, id2),
    speechIdle: () => zg.speechIdle(),
    stopSpeech: () => zg.stopSpeech(),
    sfx: (id: number) => zg.sfx(id),
    stopSfx: (id: number) => zg.sh.audio.stop(id),
    sfxAt: (id: number, pos: readonly [number, number, number]) => zg.sh.audio.playAt(id, pos),
    fx,
    inFrustum: (rec: GameRecord) => {
      if ((rec.flags & RF_ENABLED) === 0) return false;
      const co = rec.colObj;
      return !co || zg.gr.sphereVisible(rec.toWorld(co.col.center), co.radius);
    },
    expression: (rec: GameRecord, n: number) => { rec.face = n; },
    objective: {
      target: (from: GameRecord | null) => goal.target(world.records, from, world.vars.get(0x5e), () => null),
      get holoTimer() { return goal.holoTimer; },
      set holoTimer(v: number) { goal.holoTimer = v; },
    },
    animClip: () => undefined,
    switchVar: () => undefined,
    shared: {},
  };
  return ctx as unknown as IslandCtx;
}
