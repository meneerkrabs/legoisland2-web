// z17WAS "Whack-A-Snake" (Adventure Island): ported in M3 (docs/re/m3/z17WAS.md). Registers the constructors of the zone's two behaviour nodes (`pepwas`,
// `zonewas`: src/zones/z17was/rules.ts) and the zone game (the 2D layer, the intro / banner texts, the medal variables, the sounds, the fixed camera).
import { registerCtor } from '../game/setup.ts';
import { seedFromTime } from '../game/crt.ts';
import { startTickClock } from './common/tickrand.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import { GATE_ON, ZoneParticles } from '../fx/particles/zone.ts';
import type { ZoneGame } from '../shell/zonegame.ts';
import { parseBlk } from '../formats/anim.ts';
import type { Blk } from '../formats/anim.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import type { SoundSlot } from '../audio/sfx.ts';
import { restoreHooks } from '../restore/flag.ts';
import {
  REC, CTOR_PEPWAS, CTOR_ZONEWAS, PepWasNode, ZoneWasNode, WasShared, ALL_SOUNDS_3D, WAS_FOV, resultOf, checkRecords, prepareWas, applyResult, resultLine, medalText,
} from './z17was/rules.ts';
import type { WasSounds } from './z17was/rules.ts';

/** the state the two nodes share in one run (the original's globals); a new one is made by every `pepwas` constructor, i.e. every time the zone starts */
let shared = new WasShared();
registerCtor(CTOR_PEPWAS, () => { shared = new WasShared(); return new PepWasNode(shared); });
registerCtor(CTOR_ZONEWAS, () => new ZoneWasNode(shared));

registerZoneGame('z17WAS', async (ctx) => {
  const { world, loaded, archive, vars, sh, hud } = ctx;
  const records = world.records;
  // FUN_00699dc7 srand(time()) then (loop prologue) FUN_00435c81 = the zone clock base; a restart (exit state 3) loops in place and does neither again (the port reloads the zone: skip them)
  if (ctx.attempt === 0) { seedFromTime(); startTickClock(); }
  const bad = checkRecords(records);
  if (bad.length) throw new Error(`z17WAS: ${bad.join('; ')}`);
  const pep = loaded.pepper;
  const rig = (n: string): Blk | null => { const e = archive.find(`anim/${n}.blk`); return e ? parseBlk(archive.read(e)) : null; };
  const { pepNode, node } = prepareWas(world, pep, { SNAK: rig('SNAK'), MFIG: rig('MFIG') }, sh.pe);
  ctx.gr.fov = WAS_FOV;
  // FUN_0069b337: four `wasfire.par` torches on the WAS record (22), at fixed offsets, always on (gate 2, 1, 1: the game variable 2 is always 1)
  const fx = await ZoneParticles.create(ctx);
  if (fx) {
    const was = records[REC.WAS].m;
    for (const p of [[-7.769999980926514, 8.5, 6.827000141143799], [7.7870001792907715, 8.5, 6.7789998054504395], [6.880000114440918, 6.5, -8.413999557495117], [-6.880000114440918, 6.5, -8.413999557495117]]) fx.start('wasfire.par', was, p, [-1.5707964, 0, 0], GATE_ON);
    fx.finish();
  }

  // sounds: 2D ones through the world's sink (the zone's list is loaded by the audio host), 3D ones (Pepper's swings) through GameAudio's positional slots
  const ga = sh.audio.ga;
  const slots3 = new Map<number, SoundSlot>();
  if (ga) {
    for (const id of ALL_SOUNDS_3D) ga.sfx.load3D(id).then((s) => slots3.set(id, s)).catch(() => { /* silent */ });
    // the original's z17WAS never sets the 3D listener: it keeps the pose the previous zone left (audio.md 11.4)
  }
  const sounds: WasSounds = {
    play: (id) => ctx.sfx(id),
    play3D: (id, x, y, z) => { const s = slots3.get(id); if (s && ga) ga.sfx.play3D(s, { x, y, z }); },
    cue: (name, kind) => restoreHooks.cue?.(name, { sfx: (id: number) => ctx.sfx(id), hud, strings: ctx.strings, kind }),   // restored content (option off: unset)
  };
  shared.sounds = sounds;

  hud.visible = false;
  hud.left = { tex: 0, tint: 0xffffffff };      // DAT_05d4dd14 = 0 / DAT_05d4dd38 = 1: the overlay textures of the gem and the hit counter
  hud.right = { tex: 1, tint: 0xffffffff };
  let spoken = false;
  let bannerDone = false;

  const syncHud = () => {
    hud.leftText = node.gemText;        // sprintf(DAT_05d4dd20, "%d", p+0x110)
    hud.rightText = node.hitText;       // sprintf(DAT_05d4dd44, "%d", p+0x114)
    hud.centreText = node.timeText;          // sprintf(DAT_05d4dd60, "%02d:%02d", ...)
  };
  syncHud();

  const game: ZoneGame = {
    // the zone's own intro (FUN_00698efe mode 0: ADSGWS06 at (320, 200), 28 characters wide; not the generic y = 120)
    config: { intro: true, help: true },
    introId: null,
    helpControls: 5,
    introTick() { if (!spoken) spoken = ctx.say('ADSGWS06'); },
    onStart() { hud.visible = true; },
    update() {
      syncHud();
      return resultOf(shared);
    },
    onBanner() {
      hud.visible = false;
      ctx.stopSpeech();
      ctx.say(resultLine(shared.finalScore));
      if (!bannerDone) { applyResult(vars, shared.finalScore); bannerDone = true; }
    },
    /** mode 4 keeps Pepper's cheer / sad clip running (FUN_0043b76a(Pepper, 1.0) in the loop) */
    bannerTick() { pep.anim?.advance(1.0, world.dt); },   // steps by 1.0 * DAT_008b1718 (dt-scaled inside FUN_0043b76a)
    draw2d(ui: Ui2D, _dt: number, mode: number) {
      if (mode === 1) ctx.text(ui, 'ADSGWS06', 320, 200, { maxChars: 28 });
      else if (mode === 2) ui.text(1, node.scoreText, 320, 400, { colour: 0, maxChars: 28 });   // FUN_00439c6f(0, font, "%d", 1, 0, 320, 400, 28)
    },
    drawBanner(ui: Ui2D) {
      const s = shared.finalScore;
      ui.text(1, String(s), 320, 100, { colour: 0, maxChars: 30 });
      if (medalText(s)) ctx.text(ui, medalText(s), 320, 150, { table: 'std', maxChars: 30 });
      ctx.text(ui, resultLine(s), 320, 200, { maxChars: 28 });
    },
    destroy() { /* FUN_0069b968 stops the torch loop: the zone exit resets the audio */ },
    debug() {
      return {
        score: node.score, gems: node.gems, hits: node.hits, timeLeft: node.timeLeft, elapsed: node.elapsed, state: [...node.state], hit: [...node.hit], holder: node.holder,
        squash: node.squash, stage: node.stage, done: shared.done, finalScore: shared.finalScore, clip: shared.clip, pepClip: pep.anim?.clip, pepFrame: pep.anim?.frame,
        busy: pepNode.busy, presses: pepNode.presses, timeText: node.timeText,
      };
    },
  };
  return game;
});
