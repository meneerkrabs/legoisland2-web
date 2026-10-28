// z40aPO "Parachute landing on Ogel" (story node 63: the island sends Pepper to the shuttle): a copy of the z38PAR loop (0x7cf929) with an intro cutscene (ogl02 of the z40OGL
// archive: the shuttle tells Pepper to jump), 15 rings in three groups, asteroids, rock monsters and rocket brickbots. Set-up FUN_007d0b50 / 007d0cb0 / 007d0839, HUD FUN_007d0f00,
// pilot FUN_007d3187 (constructor FUN_007d53af), props FUN_007d1429 .. FUN_007d2fae (docs/re/m3/z40aPO.md). The game logic is in src/zones/parachute/ (pure, node-testable).
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import { medalOf } from '../shell/zonegame.ts';
import { MODE } from '../shell/loopmachine.ts';
import { V } from '../game/vars.ts';
import type { Archive } from '../formats/archive.ts';
import type { World } from '../game/world.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { ApoPilot, ACLIP } from './parachute/apo-pilot.ts';
import { ApoAsteroids, ApoBots, ApoRockMonsters, ApoWing, ApoSky } from './parachute/apo-props.ts';
import { apoRun, dropApoRun, APO_SOUNDS } from './parachute/apo-run.ts';
import type { ApoRun } from './parachute/apo-run.ts';
import { ApoHud } from './parachute/apo-hud.ts';
import { drawGauge } from './parachute/par-hud.ts';
import { SoundBank } from './parachute/sound.ts';
import type { SoundBackend } from './parachute/sound.ts';
import { giveAnimations } from './parachute/rigs.ts';
import { transformPoint } from './parachute/util.ts';
import { buildMatrix } from '../formats/matrix.ts';

/** constructor addresses of the zone (FUN_007d0839's FUN_00423532 calls) */
export const APO_CTOR = { PILOT: 0x7d53af, WING: 0x7d2fae, ROCKMON: 0x7d2bf2, BOTS: 0x7d2650, ASTEROIDS: 0x7d1778, SKY: 0x7d1429 } as const;
registerCtor(APO_CTOR.PILOT, () => new ApoPilot());
registerCtor(APO_CTOR.WING, () => new ApoWing());
registerCtor(APO_CTOR.ROCKMON, () => new ApoRockMonsters());
registerCtor(APO_CTOR.BOTS, () => new ApoBots());
registerCtor(APO_CTOR.ASTEROIDS, () => new ApoAsteroids());
registerCtor(APO_CTOR.SKY, () => new ApoSky());

/** game variables the loop writes (tools/gamevars.tsv: SWITCH_GME_HISCORE_APO / TROPHY_APO) */
export const APO_VARS = { HISCORE: 0x2c, TROPHY: 0x43 } as const;
/** medal thresholds of the loop (2000 / 5000 / 8000: 0x8923d0 / 0x8923d8 / 0x89297c) */
export const APO_MEDALS = { BRONZE: 2000, SILVER: 5000, GOLD: 8000 } as const;
/** the intro cutscene: FUN_007d0839 `FUN_0045c366("z40OGL", "og")` + `FUN_0045c397(0, "ogl02", "apo01")` */
export const APO_CUTSCENE = { slot: 0, zone: 'z40OGL', script: 'ogl02', strings: 'apo01', area: 'og' } as const;

/** the end of a game (FUN_007cf929 case 2): raise hiscore and trophy, decide success (the stored hiscore decides, like in z38PAR) */
export function apoFinish(vars: { get(i: number): number; set(i: number, v: number): void }, score: number): 1 | 2 {
  if (vars.get(APO_VARS.HISCORE) < score) {
    vars.set(APO_VARS.HISCORE, Math.trunc(score));
    vars.set(APO_VARS.TROPHY, medalOf(score, APO_MEDALS.BRONZE, APO_MEDALS.SILVER, APO_MEDALS.GOLD));
  }
  return vars.get(APO_VARS.HISCORE) < 2000 ? 2 : 1;
}

/** the speech lines of the end: gold 01 + 02, silver 03 + 04, bronze 05, failed 06 + 07 */
export function apoResultSpeech(score: number): [string, string | null] {
  if (score >= APO_MEDALS.GOLD) return ['OGSGPO01', 'OGSGPO02'];
  if (score >= APO_MEDALS.SILVER) return ['OGSGPO03', 'OGSGPO04'];
  if (score >= APO_MEDALS.BRONZE) return ['OGSGPO05', null];
  return ['OGSGPO06', 'OGSGPO07'];
}

/** the state the loop sets up: the pilot's constructor effects, the camera (FUN_00422b50 after the constructor), the animations of the rock monsters */
export function startApoRun(world: World, archive: Archive | null): ApoRun {
  const run = apoRun(world);
  if (archive) giveAnimations(world, archive, 'ROC1', 'ROCK', 2), giveAnimations(world, archive, 'ROC2', 'ROCK', 2), giveAnimations(world, archive, 'ROC3', 'ROCK', 2);
  const rec = run.recs.pepp;
  const pilot = rec.ctrl?.find<ApoPilot>('ApoPilot');
  if (!pilot) throw new Error('z40aPO: the pilot node is not attached');
  pilot.init(world, rec);
  if (run.recs.para) run.recs.para.flags |= 0x10 | 0x8000;
  world.vars.set(V.PEPPERSSHADOW, -1);
  world.camera.init(rec);
  return run;
}

/** the state a scripted player decides from (tools/lib/apo-bot.mjs) */
export function apoSnapshot(world: World) {
  const run = apoRun(world), R = run.recs;
  const pilot = R.pepp.ctrl?.find<ApoPilot>('ApoPilot');
  const at = (r: { x: number; y: number; z: number }) => ({ x: r.x, y: r.y, z: r.z });
  return {
    pepper: { x: R.pepp.x, y: R.pepp.y, z: R.pepp.z, rx: R.pepp.rx, ry: R.pepp.ry },
    state: pilot?.state ?? -1, yawRate: pilot?.yawRate ?? 0,
    score: run.score, ring: Array.from(run.ring), group: [...run.group], chuteOk: run.chuteOk, height: run.height, over: run.over, spoken: [...run.spoken],
    rc: R.rc.map(at), targets: R.targets.map(at), rocks: R.rocks.map(at), bots: R.bots.map((b) => ({ ...at(b), on: b.enabled })),
  };
}

async function apoGame(ctx: ZoneGameCtx): Promise<ZoneGame> {
  const world = ctx.world;
  dropApoRun(world);
  const run = startApoRun(world, ctx.archive);
  const sfx = ctx.sh.audio.ga?.sfx ?? null;
  run.sound = new SoundBank(APO_SOUNDS, sfx as unknown as SoundBackend | null);
  void run.sound.load();
  run.say = (id) => ctx.say(id);
  const hud = new ApoHud();
  const pep = run.recs.pepp;
  let result = 0;
  let wasOver = false;

  // the intro: FUN_0045c366("z40OGL", "og") + FUN_0045c397(0, "ogl02", "apo01"), started at the top of the loop (FUN_0045c40c(0)); the loop's mode 1 runs the script
  await ctx.cutscene.declare([APO_CUTSCENE]);
  ctx.cutscene.start(APO_CUTSCENE.slot);

  const listen = () => {
    const c = world.camera.c;
    sfx?.setListener({ x: c[3], y: c[4], z: c[5] }, { x: c[15], y: c[16], z: c[17] }, { x: c[12], y: c[13], z: c[14] });
  };
  const apply = () => {
    const f = hud.update(run);
    ctx.hud.centreText = f.text;
    ctx.hud.left = { tex: -1, tint: 0xffffffff };
    ctx.hud.right = { tex: f.chuteIcon, tint: 0xffffffff };
    ctx.hud.column = f.groups.map((tex) => ({ tex, tint: 0xffffffff }));
  };

  return {
    introId: 'OGSGPO12',
    helpControls: 6,
    introHold: () => ctx.cutscene.active(),
    /** mode 1 (FUN_007cf929 case 1): the cutscene runs; when it is over the camera settles behind the hanging pilot and the brief shows */
    introTick() {
      run.sound.play('engine');                       // FUN_004435a0(DAT_05d5ee4c) at the top of the loop: the shuttle's engine
      if (ctx.cutscene.active()) {
        ctx.cutscene.tick();
        hud.update(run);                              // FUN_007d0f00 draws the bars
        return;
      }
      // after the script: Pepper is put back at the shuttle (0, 2000, 0) and the camera eases to its place (eye = pilot frame * (16, 13.6, 2.4), 85 % per tick)
      const c = world.camera.c;
      const eye = transformPoint(buildMatrix(0, pep.ry, pep.rz, pep.x, pep.y, pep.z), [16, 13.6, 2.4]);
      c[3] = pep.x; c[4] = pep.y + 2; c[5] = pep.z;
      for (let i = 0; i < 3; i++) c[i] = (eye[i] - c[i]) * 0.85 + c[i];
      world.camera.updateView(); world.camera.savePrev();
      pep.x = 0; pep.y = 2000; pep.z = 0; pep.savePrev();
    },
    onStart() { ctx.hud.visible = true; run.sound.play('boxOpen'); },
    update() {
      if (!run.over) apply();
      listen();
      if (!run.over) return 0;
      if (result === 0) result = apoFinish(ctx.vars, run.score);
      return result;
    },
    onBanner() {
      if (wasOver) return;
      wasOver = true;
      ctx.hud.visible = false;
      run.sound.stopAll();
      ctx.stopSpeech();
      const sp = apoResultSpeech(run.score);
      ctx.say(sp[0], sp[1]);
    },
    bannerTick() {
      const a = pep.anim;
      if (a && (a.clip === ACLIP.CHEER || a.clip === ACLIP.SAD)) { a.advance(1); a.prevFrame = a.frame; a.prevClip = a.clip; }
    },
    draw2d(ui: Ui2D, _dt: number, mode: number) {
      if (mode === MODE.INTRO) ctx.cutscene.draw(ui);
      if (mode !== MODE.PLAY || !ctx.hud.visible) return;
      drawGauge(ui, ctx.hud.set, hud.frame.gauge);
    },
    drawBanner(ui: Ui2D) {
      const s = run.score;
      const medal = medalOf(s, APO_MEDALS.BRONZE, APO_MEDALS.SILVER, APO_MEDALS.GOLD);
      const L = (id: string, y: number) => ctx.line(id, y);
      const lines = s >= APO_MEDALS.GOLD ? [L('OGSGPO01', 200), L('OGSGPO02', 0x14a)]
        : s >= APO_MEDALS.SILVER ? [L('OGSGPO03', 200), L('OGSGPO04', 0x140)]
        : s >= APO_MEDALS.BRONZE ? [L('OGSGPO05', 200)]
        : [L('OGSGPO06', 200), L('OGSGPO07', 0x140)];
      ctx.banner(ui, { score: { text: String(Math.trunc(s)), y: 100 }, medal, lines });
    },
    destroy() { run.sound.stopAll(); ctx.cutscene.abort(); dropApoRun(world); },
    debug() { return { ...apoSnapshot(world), result, hiscore: ctx.vars.get(APO_VARS.HISCORE), trophy: ctx.vars.get(APO_VARS.TROPHY), cutscene: ctx.cutscene.active(), log: ctx.cutscene.runner.log }; },
  };
}
registerZoneGame('z40aPO', apoGame);
