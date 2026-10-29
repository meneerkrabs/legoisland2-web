// z42BRP: the zone game (loop FUN_0081fd64, set-up FUN_008212a3 / FUN_00820f4e, texts brp.str / brp2.str, the end cutscene BRP01): what the generic zone runner (src/shell/playzone.ts)
// needs from the zone: the intro line and the two controls helps, the update of mode 2 (the game clock = the score, the end sequence), the clock text and the end banner.
// The game logic is in nodes.ts; docs/re/m6/z42BRP.md.
import { registerZoneGame } from '../../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../../shell/zonegame.ts';
import { MODE } from '../../shell/loopmachine.ts';
import type { Ui2D } from '../../ui/renderer2d.ts';
import { loadMessages } from '../../ui/strings.ts';
import type { MessageTable } from '../../ui/strings.ts';
import { prepareWorld, giveWalkers, snapshot, ZoneLoop } from './nodes.ts';
import type { BrpEnv } from './nodes.ts';
import {
  VAR, SOUNDS_2D, SOUNDS_3D, scoreOf, medalOf, writeResult, clockText, RESULT_LINES, readAnimDictionary, readSwitchDictionary,
} from './rules.ts';
import './nodes.ts';
import { NO_HANDLE, ZoneParticles } from '../../fx/particles/zone.ts';

/** the end cutscene: FUN_00820f12 `FUN_0045c310(1)`, `FUN_0045c366("z42brp", "og")`, `FUN_0045c397(0, "BRP01", "ogl02")` (script BRP01 of this archive, texts ogl02.str) */
export const CUTSCENE = { slot: 0, zone: 'z42BRP', script: 'BRP01', strings: 'ogl02', area: 'og' } as const;

type Slot3D = Awaited<ReturnType<NonNullable<ZoneGameCtx['sh']['audio']['ga']>['sfx']['load3D']>>;

registerZoneGame('z42BRP', async (ctx: ZoneGameCtx): Promise<ZoneGame> => {
  const w = ctx.world;
  const S = prepareWorld(w, ctx.archive);
  const ga = ctx.sh.audio.ga;
  // brp.str and brp2.str share the ids CONTROL0 ..: the loop keeps them in two tables (DAT_05d5f58c / DAT_05d5f56c), the shell merged both into `ctx.strings`
  const messages = await ctx.sh.data.archive('messages');
  const brp: MessageTable = loadMessages(messages, ['OG/Data/brp.str']);
  const brp2: MessageTable = loadMessages(messages, ['OG/Data/brp2.str']);

  // the end cutscene's actors need the zone's dictionaries (clip names, SWITCH_BRP_DOOR) and walkers (FUN_00462d4f in the constructors)
  ctx.cutscene.setDictionaries({ anims: readAnimDictionary(ctx.sh.pe), switches: readSwitchDictionary(ctx.sh.pe) });
  await ctx.cutscene.declare([CUTSCENE]);
  giveWalkers(w, ctx.cutscene.wp);

  // the sound set (FUN_00820b70): 2D ones preloaded, the 3D ones one slot per handle of the original (`voice`)
  ctx.sh.audio.preload(SOUNDS_2D);
  const bank = new Map<string, Slot3D | null | 'loading'>();
  const play3 = (id: number, pos: [number, number, number], voice: number) => {
    if (!ga) return;
    const key = `${id}:${voice}`;
    const s = bank.get(key);
    if (s === undefined) { bank.set(key, 'loading'); ga.sfx.load3D(id).then((x) => bank.set(key, x)).catch(() => bank.set(key, null)); return; }
    if (s && s !== 'loading') { try { ga.sfx.play3D(s, { x: pos[0], y: pos[1], z: pos[2] }); } catch { /* silent */ } }
  };
  if (ga) {
    for (const id of SOUNDS_3D) {
      const key = `${id}:0`;
      bank.set(key, 'loading');
      ga.sfx.load3D(id).then((x) => bank.set(key, x)).catch(() => bank.set(key, null));
    }
  }

  const env: BrpEnv = {
    rng: Math.random,
    ms: () => Math.max(1, performance.now()),
    sfx: (id) => ctx.sfx(id),
    sfx3: (id, pos, voice = 0) => play3(id, pos, voice),
    say: (a, b, stop) => { if (stop) ctx.stopSpeech(); ctx.say(a, b ?? null); },
    letterbox: (on) => { ctx.hud.letterbox = on ? 1 : 0; },
    startCutscene: () => {
      if (ctx.vars.get(VAR.STARTED_FROM_MENU) !== 0) return false;
      ctx.stopSpeech();       // the line of the last hit must not run into the cutscene's first subtitle
      return ctx.cutscene.start(CUTSCENE.slot);
    },
    cutsceneActive: () => ctx.cutscene.active(),
  };
  S.env = env;

  // ---- particles (FUN_0082714a, Brickster's constructor): smoke2, flame1, flame1 on the static matrix DAT_05d5f608 (`S.bossFxM`) at (0, 0.3, 0.2), no rotation, gate off; the Brickster
  // and roof nodes switch them (`S.bossFx`) and refresh the matrix from bone 10 (nodes.ts). The ctor's identity store precedes the starts.
  const fx = await ZoneParticles.create(ctx);
  if (fx) {
    const up = Math.fround(0.3), fwd = Math.fround(0.2);       // 0x3e99999a, 0x3e4ccccd
    const hs = ['smoke2.par', 'flame1.par', 'flame1.par'].map((n) => fx.start(n, S.bossFxM, [0, up, fwd], [0, 0, 0]));
    fx.finish();
    S.bossFx = (on) => on.forEach((v, k) => { if (hs[k] !== NO_HANDLE) { if (v) fx.on(hs[k]); else fx.off(hs[k]); } });
  }

  const loop = new ZoneLoop();
  let resultWritten = false;
  const sync = () => {
    // FUN_004434d0 (every constructor / update): the sound listener at Pepper
    const p = w.records[90];
    try { ga?.sfx.setListener({ x: p.m[12], y: p.m[13], z: p.m[14] }, { x: p.m[8], y: p.m[9], z: p.m[10] }, { x: p.m[4], y: p.m[5], z: p.m[6] }); } catch { /* silent */ }
  };
  sync();
  ctx.hud.visible = false;

  return {
    config: { intro: true, help: true },
    introLines: [{ id: 'OGSGBP34', y: 100, wrap: 0x20 }],
    helpControls: 0,
    /** FUN_0045c402 first (the cutscene's frame), then the nodes (world.tick) */
    beforeTick() { ctx.cutscene.tick(); sync(); },
    update() {
      return loop.update(w, S, ctx.cutscene.active()) || undefined;
    },
    wantsHelp2() { return loop.takeHelp2(); },
    onHelp2End() { try { ga?.music.setGroove(0); } catch { /* silent */ } },
    onStart() { try { ga?.music.setGroove(-1); } catch { /* silent */ } },
    onBanner() {
      // mode 4 of the loop: the result variables, the speech (the loop writes them every frame; once is the same)
      ctx.stopSpeech();
      ctx.hud.letterbox = 0;       // the banner has no HUD (FUN_0046055f is not called in mode 4)
      const score = scoreOf(S.elapsed);
      const medal = writeResult(w.vars, score);
      resultWritten = true;
      const [a, b] = RESULT_LINES[medal];
      ctx.say(a, b);
    },
    draw2d(ui: Ui2D, _dt: number, mode: number) {
      ctx.hud.visible = mode === MODE.PLAY;
      if (mode === MODE.HELP) ctx.help(ui, 3, brp);
      else if (mode === MODE.HELP2) ctx.help(ui, 5, brp2);
      else if (mode === MODE.PLAY) {
        // FUN_00439c6f(0, font, "%02d:%02d", 3, 0, 500, 0x32, 0x20): only while no cutscene runs
        if (!ctx.cutscene.active()) ui.text(1, clockText(S.elapsed), 500, 50, { colour: 0, maxChars: 0x20 });
        ctx.cutscene.draw(ui);
      }
    },
    drawBanner(ui: Ui2D) {
      const score = scoreOf(S.elapsed);
      const medal = medalOf(score);
      const [a, b] = RESULT_LINES[medal];
      ctx.banner(ui, { score: { text: `Score ${score}` }, medal, lines: [ctx.line(a, 200, 0x20), ctx.line(b, 0x140, 0x20)] });
    },
    destroy() { for (const s of bank.values()) { if (s && s !== 'loading') { try { ga?.sfx.stop(s); } catch { /* silent */ } } } },
    debug() { return { ...snapshot(w), resultWritten, help2Done: loop.help2Done, cutscene: ctx.cutscene.active(), score: scoreOf(S.elapsed), clock: clockText(S.elapsed) }; },
  };
});
