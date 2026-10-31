// z38PAR "Parachute" (story node 60: the island sends Pepper out of a plane over the island): skydive through three rings and land on the target.
// GameLoop FUN_00465d39, set-up FUN_00466e90 / FUN_00466c36, sound handles FUN_00467370, HUD FUN_00466f50, the pilot FUN_004686a3 and the props
// FUN_004676cd .. FUN_0046a926 (docs/re/m3/z38PAR.md). The game logic is in src/zones/parachute/ (pure, node-testable); this file registers the constructors,
// the zone game (HUD, scoring at the end, banner, speech) and the browser glue.
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import { medalOf } from '../shell/zonegame.ts';
import { MODE } from '../shell/loopmachine.ts';
import { V } from '../game/vars.ts';
import { B } from '../game/input.ts';
import type { Archive } from '../formats/archive.ts';
import type { World } from '../game/world.ts';
import type { GameRecord } from '../game/record.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { ParPilot, CLIP, eulerLocalToWorld, PILOT } from './parachute/par-pilot.ts';
import { ParBoat, ParBirds, ParBalloon, ParPlane, ParCanopy } from './parachute/par-props.ts';
import { parRun, dropParRun } from './parachute/par-run.ts';
import { ParFx } from './parachute/par-fx.ts';
import { ZoneParticles } from '../fx/particles/zone.ts';
import type { ParRun } from './parachute/par-run.ts';
import { ParHud, drawGauge } from './parachute/par-hud.ts';
import { SoundBank } from './parachute/sound.ts';
import { giveAnimations } from './parachute/rigs.ts';
import { PAR_SOUNDS } from './parachute/par-run.ts';
import type { SoundBackend } from './parachute/sound.ts';
import { installCtx } from '../island/ctx.ts';
import type { IslandCtx } from '../island/ctx.ts';

/** constructor addresses of the zone (FUN_00423532's second argument, the extraction's `Attach.ctor`) */
export const PAR_CTOR = { PILOT: 0x46a926, CANOPY: 0x4684ec, PLANE: 0x4681c0, BALLOON: 0x467fae, BIRD: 0x467d38, BOAT: 0x4676cd } as const;
registerCtor(PAR_CTOR.PILOT, () => new ParPilot());
registerCtor(PAR_CTOR.CANOPY, () => new ParCanopy());
registerCtor(PAR_CTOR.PLANE, () => new ParPlane());
registerCtor(PAR_CTOR.BALLOON, () => new ParBalloon());
registerCtor(PAR_CTOR.BIRD, () => new ParBirds());
registerCtor(PAR_CTOR.BOAT, () => new ParBoat());

/** game variables the loop writes (tools/gamevars.tsv) */
export const PAR_VARS = { HISCORE: 0xaa, TROPHY: 0xd1 } as const;
/** medal thresholds of the loop (2000 / 3000 / 5000: 0x8923d0 / d4 / d8) */
export const PAR_MEDALS = { BRONZE: 2000, SILVER: 3000, GOLD: 5000 } as const;

/** what the loop does at the end of a game (FUN_00465d39 case 2): raise the hiscore and the trophy, decide success. Returns the result (1 success, 2 failed). */
export function parFinish(vars: { get(i: number): number; set(i: number, v: number): void }, score: number): 1 | 2 {
  if (vars.get(PAR_VARS.HISCORE) < score) {
    vars.set(PAR_VARS.HISCORE, Math.trunc(score));
    vars.set(PAR_VARS.TROPHY, medalOf(score, PAR_MEDALS.BRONZE, PAR_MEDALS.SILVER, PAR_MEDALS.GOLD));
  }
  return vars.get(PAR_VARS.HISCORE) < 2000 ? 2 : 1;
}

/** the speech lines of the end (FUN_00465d39 case 2): [first pair, queued third line] by score */
export function parResultSpeech(score: number): { say: [string, string | null]; queued: string | null } {
  if (score >= PAR_MEDALS.GOLD) return { say: ['LESGPT02', 'LESGPT03'], queued: null };
  if (score >= PAR_MEDALS.SILVER) return { say: ['LESGPT04', 'LESGPT05'], queued: null };
  if (score >= PAR_MEDALS.BRONZE) return { say: ['LESGPT06', 'LESGPT07'], queued: 'LESGPT08' };
  return { say: ['LESGPT09', 'LESGPT10'], queued: 'LESGPT11' };
}

/**
 * The state the loop sets up before play (FUN_00465d39's top of the outer loop): the camera behind and above the pilot (target = pilot + 1.2, eye = the pilot's
 * frame * (0, 13.6, -4), 85 % of the way from the previous camera), the pilot's constructor effects.
 */
export function startParRun(world: World, archive: Archive | null): ParRun {
  const run = parRun(world);
  if (archive) giveAnimations(world, archive, 'PTER', 'PTER');     // the pterodactyls' rig: the records are plain in the scene
  const rec = run.recs.pepp;
  const pilot = rec.ctrl?.find<ParPilot>('ParPilot');
  if (!pilot) throw new Error('z38PAR: the pilot node is not attached');
  pilot.init(world, rec);
  // PARA keeps the scene's flags 2 like the original: its collision object is header-only (z38PAR: PARA_Chute.col via FUN_0043f700, found by `headerOnlyColSlots`; z40aPO: solaarwing.col is an
  // NCOL file), so no sweep finds a polygon in it (tools/tests/m8-para-collision.mjs runs the original's FUN_00441270). 0x8000 = the port's 'zero scale, do not draw' bit
  if (run.recs.para) run.recs.para.flags |= 0x8000;
  // the generic blob shadow of the walk code would draw at sea level under a pilot 1300 units up
  world.vars.set(V.PEPPERSSHADOW, -1);
  world.camera.init(rec);      // FUN_00422b50 runs after the pilot's constructor moved the record (FUN_00466c36)
  const c = world.camera.c;
  // the pilot's chase camera formulas (par-pilot.ts `camera`, every operation a float32) for the camera of the first frame
  const r = Math.fround;
  const eye = eulerLocalToWorld(rec.ry, rec.rz, [rec.x, rec.y, rec.z], [0, r(13.6), r(-4)]);
  c[3] = r(rec.x); c[4] = r(r(PILOT.CAM_LIFT * 8) + r(rec.y)); c[5] = r(rec.z);
  for (let i = 0; i < 3; i++) c[i] = r(r(r(eye[i] - c[i]) * PILOT.CAM_LERP) + c[i]);
  c[6] = 0; c[7] = 1; c[8] = 0;
  world.camera.updateView(); world.camera.savePrev();
  return run;
}

/** the state a scripted player (tools/lib/par-bot.mjs: node tests and the browser steps) decides from; plain data */
export function parSnapshot(world: World) {
  const run = parRun(world), R = run.recs;
  const pilot = R.pepp.ctrl?.find<ParPilot>('ParPilot');
  const at = (r: { x: number; y: number; z: number }) => ({ x: r.x, y: r.y, z: r.z });
  return {
    pepper: { x: R.pepp.x, y: R.pepp.y, z: R.pepp.z, rx: R.pepp.rx, ry: R.pepp.ry },
    state: pilot?.state ?? -1, yawRate: pilot?.yawRate ?? 0,
    score: run.score, ring: [...run.ring] as number[], chuteOk: run.chuteOk, height: run.height, over: run.over, spoken: [...run.spoken],
    rings: R.rings.map(at), targets: R.targets.map(at),
  };
}

async function parGame(ctx: ZoneGameCtx): Promise<ZoneGame> {
  const world = ctx.world;
  dropParRun(world);
  // the shore foam SEAE carries the island's SeaAmin node (0x4b1212): its texture wobble is FUN_0043ebe0(model, 0, &0, &v), which adds v to the V coordinates of every group of the
  // mesh. The node reaches it through the island context's `uvScroll`; this zone installs just that service (M5 audit: it was skipped, the foam stood still)
  installCtx(world, { world, shared: {}, uvScroll(rec: GameRecord, du: number, dv: number) { const n = ctx.gr.groupCount(rec); for (let g = 0; g < n; g++) ctx.gr.scrollGroup(rec, g, du, dv); } } as unknown as IslandCtx);
  const run = startParRun(world, ctx.archive);
  // the emitters, in the order of the zone's attaches (the pilot's constructor FUN_0046a926 first: footsmoke x 2 + spray01, then the boat's FUN_004676cd: James01), then FUN_0044e8d0
  const fxz = await ZoneParticles.create(ctx);
  if (fxz) {
    const pf = new ParFx(fxz);
    run.fx = pf;
    const a = run.recs.pepp.anim;
    pf.pilotCtor(run.recs.land, run.recs.pepp, a?.clip ?? 0, a?.frame ?? 0);
    if (run.recs.boat) pf.boatCtor(run.recs.boat);
    fxz.finish();
  }
  // FUN_0043ebe0(SHAD model, 2, DAT_05d57da8, 0) in the draw hook FUN_00468250: the five vertices of the shadow patch are the points FUN_00442a70 computed (ParPilot.ground)
  const shad = run.recs.shad;
  if (shad) {
    const canopy = run.recs.para?.ctrl?.find<ParCanopy>('ParCanopy');
    if (canopy) canopy.drawShadow = (rec, verts) => ctx.gr.drawRecordLive(rec, verts, true);   // FUN_00468250: the patch is drawn inside the canopy's draw hook, z test off
  }
  const sfx = ctx.sh.audio.ga?.sfx ?? null;
  run.sound = new SoundBank(PAR_SOUNDS, sfx as unknown as SoundBackend | null);
  void run.sound.load();
  run.say = (id) => ctx.say(id);
  const hud = new ParHud();
  const pep = run.recs.pepp;
  let result = 0;
  let queued: string | null = null;
  let wasOver = false;
  let passMode: number = MODE.INIT;   // the loop mode the current pass started in (see `everyTick`)

  /** FUN_004434d0 once per frame: the listener is the camera target (z38PAR passes DAT_009da5f4), facing along the view */
  const listen = () => {
    const c = world.camera.c;
    sfx?.setListener({ x: c[3], y: c[4], z: c[5] }, { x: c[15], y: c[16], z: c[17] }, { x: c[12], y: c[13], z: c[14] });
  };

  const apply = () => {
    const f = hud.update(run, pep.ry, world.dt);
    ctx.hud.centreText = f.text;
    ctx.hud.left = { tex: f.compass, tint: 0xffffffff };
    ctx.hud.right = { tex: f.chuteIcon, tint: 0xffffffff };
    ctx.hud.column = f.rings.map((tex) => ({ tex, tint: 0xffffffff }));
    return f;
  };

  return {
    introId: 'LESGPT01',
    helpControls: 6,
    /**
     * FUN_00468338 (the canopy, with the shadow patch FUN_00468250) is a DRAW hook: it runs in every loop pass, also where the update pass does not (only mode 2 updates here): the canopy
     * keeps closing behind the end banner and the pause menu. `everyTick` gets the mode after the transition: the mode the pass started in is kept.
     */
    everyTick(mode: number) {
      const start = passMode; passMode = mode;
      if (start === MODE.PLAY) return;
      const para = run.recs.para;
      para?.ctrl?.find<ParCanopy>('ParCanopy')?.update(world, para);
    },
    /** FUN_00465d39 mode 0 (0x465db8): `FUN_004376f9(0, ..)` = the buttons HELD in this one pass; any of them skips the intro and the help: mode 2 and `FUN_004435a0(plane_flyoff)` */
    skipInit() {
      if (ctx.sh.input.held === 0) return false;
      run.sound.play('flyOff');
      return true;
    },
    onStart() { ctx.hud.visible = true; },
    /** FUN_00465d39 mode 4 leaves for the result menu when ANY button is HELD (`DAT_0098383c != 0`, not just pressed; M5 audit) */
    skipBanner() { return (ctx.sh.input.held & ~B.ESC) !== 0; },
    update() {
      if (!run.over) apply();      // FUN_00466f50 runs in the play mode only
      listen();
      if (!run.over) return 0;
      if (result === 0) result = parFinish(ctx.vars, run.score);
      return result;
    },
    onBanner() {
      if (wasOver) return;
      wasOver = true;
      ctx.hud.visible = false;
      run.sound.stopAll();
      ctx.stopSpeech();
      const sp = parResultSpeech(run.score);
      ctx.say(sp.say[0], sp.say[1]);
      queued = sp.queued;
    },
    bannerTick() {
      // mode 4: the queued third line when the first two have been spoken, and Pepper's cheer / sad clip keeps playing (clip 8 / 9)
      if (queued && ctx.speechIdle()) { ctx.say(queued); queued = null; }
      const a = pep.anim;
      if (a && (a.clip === CLIP.CHEER || a.clip === CLIP.SAD)) { a.advance(1, world.dt); a.prevFrame = a.frame; a.prevClip = a.clip; }
    },
    draw2d(ui: Ui2D, _dt: number, mode: number) {
      if (mode !== MODE.PLAY || !ctx.hud.visible) return;
      drawGauge(ui, ctx.hud.set, hud.frame.gauge);
    },
    drawBanner(ui: Ui2D) {
      const s = run.score;
      const medal = medalOf(s, PAR_MEDALS.BRONZE, PAR_MEDALS.SILVER, PAR_MEDALS.GOLD);
      const L = (id: string, y: number) => ctx.line(id, y);
      const lines = s >= PAR_MEDALS.GOLD ? [L('LESGPT02', 200), L('LESGPT03', 320)]
        : s >= PAR_MEDALS.SILVER ? [L('LESGPT04', 200), L('LESGPT05', 320)]
        : s >= PAR_MEDALS.BRONZE ? [L('LESGPT06', 200), L('LESGPT07', 270), L('LESGPT08', 400)]
        : [L('LESGPT09', 200), L('LESGPT10', 280), L('LESGPT11', 380)];
      ctx.banner(ui, { score: { text: String(Math.trunc(s)), y: 100 }, medal, lines });
    },
    destroy() { run.sound.stopAll(); dropParRun(world); ctx.gr.vertexOverride = null; },
    debug() { return { ...parSnapshot(world), result, hiscore: ctx.vars.get(PAR_VARS.HISCORE), trophy: ctx.vars.get(PAR_VARS.TROPHY) }; },
  };
}
registerZoneGame('z38PAR', parGame);
void PILOT;
