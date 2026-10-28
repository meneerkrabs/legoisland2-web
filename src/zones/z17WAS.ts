// z17WAS "Whack-A-Snake" (Adventure Island): ported in M3 (docs/re/m3/z17WAS.md). Registers the constructors of the zone's two behaviour nodes (`pepwas`,
// `zonewas`: src/zones/z17was/rules.ts) and the zone game (the 2D layer, the intro / banner texts, the medal variables, the sounds, the fixed camera).
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame } from '../shell/zonegame.ts';
import { parseBlk } from '../formats/anim.ts';
import type { Blk } from '../formats/anim.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import type { SoundSlot } from '../audio/sfx.ts';
import {
  CTOR_PEPWAS, CTOR_ZONEWAS, PepWasNode, ZoneWasNode, WasShared, ALL_SOUNDS_2D, ALL_SOUNDS_3D, WAS_FOV, resultOf, checkRecords, prepareWas, applyResult, resultLine, medalText,
} from './z17was/rules.ts';
import type { WasSounds } from './z17was/rules.ts';

/** the state the two nodes share in one run (the original's globals); a new one is made by every `pepwas` constructor, i.e. every time the zone starts */
let shared = new WasShared();
registerCtor(CTOR_PEPWAS, () => { shared = new WasShared(); return new PepWasNode(shared); });
registerCtor(CTOR_ZONEWAS, () => new ZoneWasNode(shared));

registerZoneGame('z17WAS', async (ctx) => {
  const { world, loaded, archive, vars, sh, hud } = ctx;
  const records = world.records;
  const bad = checkRecords(records);
  if (bad.length) throw new Error(`z17WAS: ${bad.join('; ')}`);
  const pep = loaded.pepper;
  const rig = (n: string): Blk | null => { const e = archive.find(`anim/${n}.blk`); return e ? parseBlk(archive.read(e)) : null; };
  const { pepNode, node } = prepareWas(world, pep, { SNAK: rig('SNAK'), MFIG: rig('MFIG') }, sh.pe);
  ctx.gr.fov = WAS_FOV;

  // sounds: 2D ones through the world's sink (the first play of an id only loads it), 3D ones (Pepper's swings) through GameAudio's positional slots
  const ga = sh.audio.ga;
  const slots3 = new Map<number, SoundSlot>();
  if (ga) {
    for (const id of ALL_SOUNDS_3D) ga.sfx.load3D(id).then((s) => slots3.set(id, s)).catch(() => { /* silent */ });
    const c = world.camera.c;
    const f = [c[3] - c[0], c[4] - c[1], c[5] - c[2]], l = Math.hypot(f[0], f[1], f[2]) || 1;
    ga.sfx.setListener({ x: c[0], y: c[1], z: c[2] }, { x: f[0] / l, y: f[1] / l, z: f[2] / l }, { x: 0, y: 1, z: 0 });
  }
  for (const id of ALL_SOUNDS_2D) ctx.sfx(id);
  const sounds: WasSounds = {
    play: (id) => ctx.sfx(id),
    play3D: (id, x, y, z) => { const s = slots3.get(id); if (s && ga) ga.sfx.play3D(s, { x, y, z }); },
  };
  shared.sounds = sounds;

  hud.visible = false;
  hud.left = { tex: 0, tint: 0xffffffff };      // DAT_05d4dd14 = 0 / DAT_05d4dd38 = 1: the overlay textures of the gem and the hit counter
  hud.right = { tex: 1, tint: 0xffffffff };
  let spoken = false;
  let bannerDone = false;

  const syncHud = () => {
    hud.leftText = String(node.gems);        // sprintf(DAT_05d4dd20, "%d", p+0x110)
    hud.rightText = String(node.hits);       // sprintf(DAT_05d4dd44, "%d", p+0x114)
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
    bannerTick() { pep.anim?.advance(1.0); },
    draw2d(ui: Ui2D, _dt: number, mode: number) {
      if (mode === 1) ctx.text(ui, 'ADSGWS06', 320, 200, { maxChars: 28 });
      else if (mode === 2) ui.text(1, String(node.score), 320, 400, { colour: 0, maxChars: 28 });   // FUN_00439c6f(0, font, "%d", 1, 0, 320, 400, 28)
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
