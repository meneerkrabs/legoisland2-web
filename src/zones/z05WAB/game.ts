// The zone game of z05WAB for the generic zone runner (src/shell/zonegame.ts): binds the game logic of wab.ts (the two nodes the set-up attached) to the shell: sound,
// speech, texture frames, the HUD (FUN_0046055f: hits left, misses right, clock in the middle; the percentage line at y 400), the score / medal / trophy rules of the loop
// FUN_0056905a and the result banner. The loop template itself (fade, intro LESGWB11, help of 4 controls, pause, banner, result menu, exits) is the runner's.
import type { ZoneGame, ZoneGameCtx } from '../../shell/zonegame.ts';
import type { Ui2D } from '../../ui/renderer2d.ts';
import { expandMessage } from '../../ui/strings.ts';
import type { BannerSpec } from '../../shell/helpscreen.ts';
import { MODE } from '../../shell/loopmachine.ts';
import { ALL_SOUNDS, BotNode, CTOR, LINE, PepNode, REC, SND, WAB, WabShared, initCamera, medalOfScore, scoreOf } from './wab.ts';
import type { WabHost } from './wab.ts';

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

export function createWabGame(ctx: ZoneGameCtx): ZoneGame {
  const { world, hud, sh } = ctx;
  const shared = takeShared();
  if (!shared?.bot || !shared.pep) throw new Error('z05WAB: the behaviour nodes were not attached by the zone set-up');
  const host: WabHost = {
    play: (id) => ctx.sfx(id),
    stop: (id) => sh.audio.stop(id),
    play3d: (id, pos) => { if (pos) ctx.sfx(id); },
    say: (id) => { ctx.say(id); },
    random: (n) => Math.floor(Math.random() * n),
    ...frameHost(ctx),
  };
  shared.host = host;
  const pepper = world.records[REC.PEPP];
  // the music starts when play starts (mode 9 -> 2: FUN_004432c0), not with the zone: drop what the runner started (this also forgets the sounds it loaded)
  sh.audio.leaveZone();
  // the zone's sounds are loaded at set-up (FUN_00569dd0); `play` of a sound that is not loaded yet only starts the load (the first play of an id is dropped)
  for (const id of ALL_SOUNDS) sh.audio.play(id);
  // node constructors: record 0 (pepwab) and 1 (botwab); the first update does the same, the first frames of the intro already show the start state
  const bot = shared.bot, pep = shared.pep;
  pep.init(world, pepper);
  bot.init(world);
  initCamera(world, pepper);
  hud.left = { tex: 0, tint: 0xffffffff }; hud.right = { tex: 1, tint: 0xffffffff };   // FUN_00569b80: DAT_05d4dd14 = 0, DAT_05d4dd38 = 1
  hud.leftText = '0'; hud.rightText = '0'; hud.centreText = bot.timeText;
  hud.visible = false;       // the HUD is drawn in mode 2 only (FUN_0046055f in the loop's case 2)
  let scoreWritten = false;

  const game: ZoneGame = {
    introId: LINE.INTRO,
    helpControls: 4,
    onStart() {
      hud.visible = true;
      sh.audio.enterZone('z05WAB');
    },
    update() {
      hud.leftText = bot.hitsText; hud.rightText = bot.missText; hud.centreText = bot.timeText;
      if (!shared.over) return 0;
      return shared.score >= WAB.BRONZE ? 1 : 2;
    },
    onBanner(result) {
      hud.visible = false;
      ctx.stopSpeech();
      host.stop(SND.AMBIENT);
      const score = shared.score;
      // the trophy and the hiscore are only ever raised (FUN_00417575 / FUN_00417597 in the draw code of mode 4)
      if (!scoreWritten) {
        scoreWritten = true;
        if (ctx.vars.get(VAR.HISCORE) < score) ctx.vars.set(VAR.HISCORE, score);
        const medal = medalOfScore(score);
        if (ctx.vars.get(VAR.TROPHY) < medal) ctx.vars.set(VAR.TROPHY, medal);
      }
      if (score >= WAB.GOLD) ctx.say(LINE.GOLD);
      else if (score >= WAB.SILVER) ctx.say(LINE.SILVER);
      else if (score >= WAB.BRONZE) ctx.say(LINE.BRONZE);
      else ctx.say(LINE.NEAR1, LINE.NEAR2);
      void result;
    },
    bannerTick() { pepper.anim?.advance(1); },     // FUN_0043b76a(Pepper, 1.0) while the banner is up: the win / lose clip plays on
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
