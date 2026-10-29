// z28HAT "hot-air balloon" (Adventure Island): the player flies a hot-air balloon over Mr Hates' dinosaur valley, winches the eleven dinosaurs up with the hook, drops them at
// the landing site, dodges the fireballs Bronty (Mr Hates' brontosaurus) burps at him and finally drops sandbags into Bronty's mouth to free him. Zone loop FUN_00790fc0,
// result banner FUN_00790c19, set-up FUN_007927b5 / FUN_007a6bf3 / FUN_00791990 (docs/re/m6/z28HAT.md). The game logic is in src/zones/z28hat/ (pure, node-testable); this
// file registers the constructors and builds the zone game (HUD, cutscenes ADV08 / ADV09, banner, speech, sounds, music fade, the winch rope).
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame, registerZoneSetup } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import type { CutsceneSlotSpec } from '../shell/cutscene-host.ts';
import { MODE } from '../shell/loopmachine.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import type { Renderer } from '../render/index.ts';
import type { Mat4 } from '../render/math.ts';
import type { SoundBackend } from './parachute/sound.ts';
import { CTOR, K, REC, applyResult, medalOf, readAnimDictionary, resultLines } from './z28hat/rules.ts';
import { BABY_ARGS, DINO_ARGS, HatBalloon, HatBaby, HatBronty, HatDino, HatFireball, HatMrHates, HatPepp, HatPtera, HatSandbag, HatWinch } from './z28hat/nodes.ts';
import { hatSnapshot, hatSounds, hatUpdate, prepareHat } from './z28hat/game.ts';

registerCtor(CTOR.PEPP, () => new HatPepp());
registerCtor(CTOR.BALLOON, () => new HatBalloon());
registerCtor(CTOR.BRONTY, () => new HatBronty());
registerCtor(CTOR.WINCH, () => new HatWinch());
registerCtor(CTOR.MRHATES, () => new HatMrHates());
registerCtor(CTOR.DINO, (a) => new HatDino(DINO_ARGS[a.record] ?? DINO_ARGS[9]));
registerCtor(CTOR.BABY, (a) => new HatBaby(BABY_ARGS[a.record] ?? BABY_ARGS[10]));
registerCtor(CTOR.FIREBALL, () => new HatFireball());
registerCtor(CTOR.SANDBAG, () => new HatSandbag());
registerCtor(CTOR.PTERA, () => new HatPtera());

/**
 * FUN_0079798f (the balloon's constructor) calls `FUN_00444550(ZAPP, 0xff, 2)`: the electric fence around the T-rex is drawn in render mode 2 (translucent). The extraction of the
 * set-up reads FUN_00791990 only, so the entry is added here, before the renderer builds its views.
 */
registerZoneSetup('z28HAT', {
  afterSetup(_sh, _world, loaded) {
    loaded.setup?.modes.push({ at: CTOR.BALLOON, fn: CTOR.BALLOON, cond: [], record: REC.ZAPP, partMask: 0xff, mode: 2 });
  },
  /** the cutscene scripts' animation names (`xtalk3`, `INFO_PONDERING` ...) resolve through the loader's dictionary (read from the executable) */
  cutsceneOptions(sh) { return { dictionaries: { anims: readAnimDictionary(sh.pe) } }; },
});

/** FUN_00791940: `FUN_0045c310(2)`, `FUN_0045c366("z28HAT", "ai")`, slot 0 = ADV08 (the intro: Mr Hates), slot 1 = ADV09 (Mr Hates defeated, the outro) */
export const HAT_CUTSCENES: CutsceneSlotSpec[] = [
  { slot: 0, zone: 'z28HAT', script: 'ADV08', strings: 'ADV08', area: 'ai' },
  { slot: 1, zone: 'z28HAT', script: 'ADV09', strings: 'ADV09', area: 'ai' },
];

/** a line from `a` to `b` as a flat white wire (FUN_004445e0 -> FUN_0087da0b: two vertices with colour 0xffffffff): the winch's rope */
function drawLine(r: Renderer, a: number[], b: number[]) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-4) return;
  const up = [d[0] / len, d[1] / len, d[2] / len];
  const ref = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  let p = [up[1] * ref[2] - up[2] * ref[1], up[2] * ref[0] - up[0] * ref[2], up[0] * ref[1] - up[1] * ref[0]];
  const pl = Math.hypot(p[0], p[1], p[2]); p = [p[0] / pl, p[1] / pl, p[2] / pl];
  const q = [up[1] * p[2] - up[2] * p[1], up[2] * p[0] - up[0] * p[2], up[0] * p[1] - up[1] * p[0]];
  const m = new Float32Array(16);
  m[0] = p[0]; m[1] = p[1]; m[2] = p[2];
  m[4] = d[0]; m[5] = d[1]; m[6] = d[2];
  m[8] = q[0]; m[9] = q[1]; m[10] = q[2];
  m[12] = a[0]; m[13] = a[1]; m[14] = a[2]; m[15] = 1;
  r.drawBox(m as Mat4, [0, 0, 0], [0, 1, 0], [1, 1, 1, 1]);
}

async function hatGame(ctx: ZoneGameCtx): Promise<ZoneGame> {
  const { world, archive, sh, hud, vars } = ctx;
  const ga = sh.audio.ga;
  const sound = hatSounds((ga?.sfx ?? null) as unknown as SoundBackend | null);
  void sound.load();
  // DAT_0094000c: how many dinosaurs there are (the executable's 11)
  const total = sh.pe.u32(0x94000c);
  const { shared: S, nodes } = prepareHat(world, archive, sound, { total });
  S.say = (a, b) => { const ok = ctx.say(a, b ?? null); if (ok) { S.spoken.push(a); if (b) S.spoken.push(b); } return ok; };
  S.onFade = (f) => { ga?.music.setFade(f); };
  const R = S.recs;
  let outro = false;

  // the two cutscenes; the intro plays at the first start of the loop (FUN_00790fc0 `local_20`), not after a restart
  await ctx.cutscene.declare(HAT_CUTSCENES);
  if (ctx.attempt === 0) ctx.cutscene.start(0);

  // the winch rope is a wire from 14.4 under the balloon to the hook (the pre-render hook FUN_00795bd6)
  ctx.gr.effects = (r) => drawLine(r, [R.hotb.x, R.hotb.y - K.ROPE_TOP, R.hotb.z], [R.winch.x, R.winch.y, R.winch.z]);

  hud.visible = false;
  const syncHud = () => {
    const u = hatUpdate(world);
    hud.centreText = u.score;                            // sprintf(DAT_05d4dd60, "%d", score)
    hud.rightText = u.left;                              // sprintf(DAT_05d4dd44, "%d", 11 - delivered)
    hud.right = { tex: 0, tint: 0xffffffff };            // DAT_05d4dd38 = 0
    hud.left = { tex: u.leftIcon, tint: 0xffffffff };    // DAT_05d4dd14 = -1, or 2 once everything is down
  };
  syncHud();
  let bannerDone = false;
  let queued = false;

  const game: ZoneGame = {
    config: { intro: true, help: true },
    introId: 'ADSGMC19',
    helpControls: 5,
    introHold: () => ctx.cutscene.active(),
    /** mode 1: the intro cutscene runs; the brief shows when it is over (FUN_0045c432 == 0) */
    introTick() {
      if (ctx.cutscene.active()) ctx.cutscene.tick();
      ctx.cutscene.applyCarried();
    },
    onStart() { hud.visible = true; },
    update() {
      syncHud();
      return S.result;
    },
    onBanner() {
      hud.visible = false;
      if (bannerDone) return;
      bannerDone = true;
      ctx.stopSpeech();
      const m = medalOf(S.score);
      S.medal = m > 0;
      const l = resultLines(S.score);
      ctx.say(l[0].id, l[1]?.id ?? null);
      applyResult(vars, S.score);
    },
    bannerTick() { applyResult(vars, S.score); },
    /** mode 5: the outro cutscene runs before the result menu when a medal was earned (FUN_00790fc0 mode 5) */
    resultTick() {
      ctx.cutscene.tick();
      ctx.cutscene.applyCarried();
      if (S.medal && !ctx.cutscene.active() && !outro) { outro = true; vars.set(0xc5, 4); ctx.cutscene.start(1); queued = true; }
    },
    resultHold: () => ctx.cutscene.active() || (S.medal && !outro),
    draw2d(ui: Ui2D, _dt: number, mode: number) {
      if (mode === MODE.INTRO || mode === MODE.RESULT) ctx.cutscene.draw(ui);
    },
    drawBanner(ui: Ui2D) {
      const s = S.score;
      const lines = resultLines(s).map((l) => ctx.line(l.id, l.y, 0x20));
      ctx.banner(ui, { score: { text: String(s).padStart(5, ' '), y: 100 }, medal: medalOf(s), lines });
    },
    /** FUN_004434d0 every frame: the listener is the camera (eye, forward, up) */
    beforeRender() {
      const c = world.camera.c;
      ga?.sfx.setListener({ x: c[0], y: c[1], z: c[2] }, { x: c[15], y: c[16], z: c[17] }, { x: c[12], y: c[13], z: c[14] });
    },
    destroy() {
      sound.stopAll();
      ga?.music.setFade(1);
      ctx.cutscene.abort();
      ctx.gr.effects = null;
    },
    debug() {
      return { ...hatSnapshot(world), medal: S.medal, outro: queued, cutscene: ctx.cutscene.active(), spoken: S.spoken.slice(-8), nodes: Object.keys(nodes).length };
    },
  };
  return game;
}
registerZoneGame('z28HAT', hatGame);
