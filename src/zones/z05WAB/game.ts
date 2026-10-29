// The zone game of z05WAB for the generic zone runner (src/shell/zonegame.ts): binds the game logic of wab.ts (the two nodes the set-up attached) to the shell: sound,
// speech, texture frames, the HUD (FUN_0046055f: hits left, misses right, clock in the middle; the percentage line at y 400), the score / medal / trophy rules of the loop
// FUN_0056905a and the result banner. The loop template itself (fade, intro LESGWB11, help of 4 controls, pause, banner, result menu, exits) is the runner's.
import type { ZoneGame, ZoneGameCtx } from '../../shell/zonegame.ts';
import type { Ui2D } from '../../ui/renderer2d.ts';
import { expandMessage } from '../../ui/strings.ts';
import type { BannerSpec } from '../../shell/helpscreen.ts';
import { MODE } from '../../shell/loopmachine.ts';
import { B } from '../../game/input.ts';
import { BotNode, CTOR, LINE, PepNode, REC, SND, WAB, WabShared, initCamera, medalOfScore, scoreOf } from './wab.ts';
import type { WabFx, WabHost } from './wab.ts';
import { msClock, tickPick } from '../common/tickrand.ts';
import type { SoundSlot } from '../../audio/sfx.ts';
import { GATE_OFF, type ZoneParticles } from '../../fx/particles/zone.ts';
import { restoreHooks } from '../../restore/flag.ts';

/** FUN_00569dd0 loads these three through FUN_004433b0 (3D, played with FUN_004433f0 at the active hole's position); the other twelve are 2D */
const SOUNDS_3D: readonly number[] = [SND.HIT_BOT, SND.HIT_INFO, SND.MISS];

/** HISCORE_WAB / TROPHY_WAB (tools/gamevars.tsv: SWITCH_GME_HISCORE_WAB 0x20, SWITCH_GME_TROPHY_WAB 0x40) */
export const VAR = { HISCORE: 0x20, TROPHY: 0x40 } as const;
/** music key of the zone (FUN_00569ca6: FUN_00443290("Z05WAB1"); the levels 2 and 3 of the table are never requested) */
export const MUSIC = 'Z05WAB1';

// ---- the nodes the set-up attaches (ctor addresses of ZoneSetup.attaches); the zone game picks them up in its factory
let pending: WabShared | null = null;
/** the shared state of the nodes created by the last `setupZone` (cleared by `takeShared`) */
export function takeShared(): WabShared | null { const s = pending; pending = null; return s; }
export function createPepNode(): PepNode { pending ??= new WabShared(); return new PepNode(pending); }
export function createBotNode(): BotNode { pending ??= new WabShared(); return new BotNode(pending); }
export { CTOR };

/** record `LAND` / `FLSH` texture frames: slot -> texture id through the model's first texture list (FUN_00443120 -> FUN_00411202) */
function frameHost(ctx: ZoneGameCtx): Pick<WabHost, 'setFrame' | 'scrollV'> {
  return {
    /** FUN_0043ebe0(model, 0x1642, group, dv): the original's loop adds `dv` once per mesh group to the vertices of the group, so the V offset grows by dv * (number of groups) per call */
    scrollV(group, dv) {
      const rec = ctx.world.records[REC.LAND];
      ctx.gr.scrollGroup(rec, group, 0, dv * Math.max(1, ctx.gr.groupCount(rec)));
    },
    setFrame(target, slot, frame) {
      const rec = ctx.world.records[target === 'land' ? REC.LAND : REC.FLSH];
      const part = rec?.model?.parts[0];
      const id = part ? ctx.scene.texLists[part.texList]?.[slot] : undefined;
      if (id === undefined || id < 0) return;
      ctx.gr.renderer.setTextureFrame(ctx.archive, id, 2, frame);
    },
  };
}

/**
 * FUN_0056b2d5: the emitters of the zone: wabswirl.swl on the Infomaniac record (INFO), bolts01.par x 4 on the resting bot of each hole at (0, 5, 0), all with the
 * LAND record in their collision list, all started OFF (gate 1, 1, 1); `bolts[k]` is switched on by a hit (FUN_00569f50), the swirl by hitting the Infomaniac
 */
export function wabEffects(ctx: ZoneGameCtx, fx: ZoneParticles): WabFx {
  const HALF = -1.5707964;
  const w = ctx.world;
  const swirl = fx.startSwirl('wabswirl.swl', [0, 0, 0], [HALF, 0, 0], GATE_OFF);
  const bolts = REC.HOLE.map((i) => {
    const h = fx.start('bolts01.par', w.records[i].m, [0, 5, 0], [HALF, 0, 0], GATE_OFF);
    fx.collideWith(h, w.records[REC.LAND]);
    return h;
  });
  for (const h of bolts) fx.off(h);      // the constructor's FUN_00442a20(h, 1, 1, 1) on the four bolts, then the swirl (0x56b88b..0x56b8eb)
  fx.off(swirl);
  fx.finish();
  return {
    hitBot: (hole) => fx.on(bolts[hole]),
    // FUN_0043b00b(local, base record + 0xc) copies the hole's matrix, then local[13] = 5.5 (0x40b00000, the y of the swirl); FUN_00442a00 gives the swirl its own copy
    hitInfo: (hole) => { const m = new Float32Array(w.records[REC.HOLE[hole]].m); m[13] = 5.5; fx.setMatrix(swirl, m); fx.on(swirl); },
    clear: () => { for (const h of bolts) fx.off(h); fx.off(swirl); },
  };
}

export function createWabGame(ctx: ZoneGameCtx, fx: ZoneParticles | null = null): ZoneGame {
  const { world, hud, sh } = ctx;
  const shared = takeShared();
  if (!shared?.bot || !shared.pep) throw new Error('z05WAB: the behaviour nodes were not attached by the zone set-up');
  // the three positional sounds go through GameAudio's 3D slots (the listener = the fixed camera, FUN_004434d0); muted / no audio: silent
  const ga = sh.audio.ga;
  const slots3 = new Map<number, SoundSlot>();
  if (ga) {
    for (const id of SOUNDS_3D) ga.sfx.load3D(id).then((s) => slots3.set(id, s)).catch(() => { /* silent */ });
  }
  const host: WabHost = {
    play: (id) => ctx.sfx(id),
    stop: (id) => sh.audio.stop(id),
    play3d: (id, pos) => { restoreHooks.cue?.(id === SND.HIT_BOT ? 'wab-hit' : id === SND.HIT_INFO ? 'wab-info' : 'wab-miss', ctx); const s = slots3.get(id); if (pos && s && ga) { try { ga.sfx.play3D(s, { x: pos[0], y: pos[1], z: pos[2] }); } catch { /* silent */ } } },
    say: (id) => { ctx.say(id); },
    random: (n) => tickPick(msClock(world), n),     // RNG: ftol(FUN_004388ae(FUN_00435c91())) & 3 / & 7 / % 3 (src/zones/common/tickrand.ts)
    ...frameHost(ctx),
  };
  if (fx) host.fx = wabEffects(ctx, fx);
  shared.host = host;
  const pepper = world.records[REC.PEPP];
  // the zone's sounds (FUN_00569dd0) are loaded and the music (Z05WAB1, mode 9 -> 2: FUN_004432c0) is started by the audio host (src/shell/audiohost.ts)
  // node constructors: record 0 (pepwab) and 1 (botwab); the first update does the same, the first frames of the intro already show the start state
  const bot = shared.bot, pep = shared.pep;
  pep.init(world, pepper);
  bot.init(world);
  initCamera(world, pepper);
  if (ga) {   // the listener is the camera, which never moves in this zone
    const c = world.camera.c;
    const f = [c[3] - c[0], c[4] - c[1], c[5] - c[2]], l = Math.hypot(f[0], f[1], f[2]) || 1;
    ga.sfx.setListener({ x: c[0], y: c[1], z: c[2] }, { x: f[0] / l, y: f[1] / l, z: f[2] / l }, { x: 0, y: 1, z: 0 });
  }
  hud.left = { tex: 0, tint: 0xffffffff }; hud.right = { tex: 1, tint: 0xffffffff };   // FUN_00569b80: DAT_05d4dd14 = 0, DAT_05d4dd38 = 1
  hud.leftText = '0'; hud.rightText = '0'; hud.centreText = bot.timeText;
  hud.visible = false;       // the HUD is drawn in mode 2 only (FUN_0046055f in the loop's case 2)
  let scoreWritten = false;

  const game: ZoneGame = {
    introId: LINE.INTRO,
    helpControls: 4,
    /** FUN_0056905a mode 4 leaves for the result menu when ANY button is HELD (`DAT_0098383c != 0`, not just pressed: the banner is skipped at once while a key is down; M5 audit) */
    skipBanner() { return (sh.input.held & ~B.ESC) !== 0; },
    onStart() { hud.visible = true; },
    update() {
      hud.leftText = bot.hitsText; hud.rightText = bot.missText; hud.centreText = bot.timeText;
      if (!shared.over) return 0;
      return shared.score >= WAB.BRONZE ? 1 : 2;
    },
    onBanner(result) {
      hud.visible = false;
      ctx.stopSpeech();
      host.stop(SND.AMBIENT);
      sh.audio.playMusic('Z05WAB1');   // 103970: the end of the game plays the segment again (FUN_004432c0(DAT_05d5881c), from its start)
      const score = shared.score;
      if (score >= WAB.GOLD) ctx.say(LINE.GOLD);
      else if (score >= WAB.SILVER) ctx.say(LINE.SILVER);
      else if (score >= WAB.BRONZE) ctx.say(LINE.BRONZE);
      else ctx.say(LINE.NEAR1, LINE.NEAR2);
      void result;
    },
    bannerTick() {
      pepper.anim?.advance(1, world.dt);
      // the trophy and the hiscore are only ever raised, in the draw code of the FIRST banner frame (FUN_00417575 / FUN_00417597 in mode 4): the tick after the one that switched the mode
      if (!scoreWritten) {
        scoreWritten = true;
        const score = shared.score;
        if (ctx.vars.get(VAR.HISCORE) < score) ctx.vars.set(VAR.HISCORE, score);
        const medal = medalOfScore(score);
        if (ctx.vars.get(VAR.TROPHY) < medal) ctx.vars.set(VAR.TROPHY, medal);
      }
    },     // FUN_0043b76a(Pepper, 1.0) while the banner is up: the win / lose clip plays on
    draw2d(ui: Ui2D, _dt: number, mode: number) {
      if (mode === MODE.PLAY && !shared.over) ui.text(1, expandMessage(bot.pctText), 320, 400, { colour: 0, maxChars: 30 });
    },
    drawBanner(ui: Ui2D) {
      const score = scoreOf(shared.pct);
      const spec: BannerSpec = { score: { text: String(score), y: 100 }, medal: medalOfScore(score) };
      if (score >= WAB.BRONZE) spec.lines = [{ text: ctx.strings?.text(score >= WAB.GOLD ? LINE.GOLD : score >= WAB.SILVER ? LINE.SILVER : LINE.BRONZE) ?? '', y: 200, wrap: 30 }];
      else spec.lines = [{ text: ctx.strings?.text(LINE.NEAR1) ?? '', y: 200, wrap: 30 }, { text: ctx.strings?.text(LINE.NEAR2) ?? '', y: 0x14a, wrap: 30 }];
      ctx.banner(ui, spec);
    },
    destroy() {
      for (const id of [SND.AMBIENT, SND.ALARM1, SND.ALARM2]) host.stop(id);     // FUN_00569ef9
    },
    debug() {
      return {
        timeLeft: bot.timeLeft, elapsed: bot.elapsed, hits: bot.hits, misses: bot.misses, state: bot.state.slice(), isInfo: bot.isInfo.slice(), whacked: bot.whacked.slice(),
        y: bot.y.slice(), hold: bot.hold, gap: bot.gap, over: shared.over, pct: shared.pct, score: shared.score, stun: shared.stun, clip: shared.clip,
        pepClip: pepper.anim?.clip, pepFrame: pepper.anim?.frame, busy: pep.busy, lock: pep.lock, tUp: bot.tUp.slice(), clock: bot.timeText, pctText: bot.pctText,
      };
    },
  };
  return game;
}
