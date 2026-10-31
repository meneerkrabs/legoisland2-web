// z41MAP: the zone game (loop FUN_00811abc, set-up FUN_00813cce / FUN_008138bd, HUD FUN_0081167c, banner FUN_00811790): what the generic zone runner
// (src/shell/playzone.ts) needs from the zone: the intro line and controls help, the update of mode 2, the HUD and the end banner, and the models the
// original draws by hand (the dough, the layers on it and the toppings in the air are drawn through draw hooks with arbitrary matrices; the port gives them
// invisible helper records that follow those matrices).
import { registerZoneGame } from '../../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../../shell/zonegame.ts';
import type { Ui2D, UiTextureSet } from '../../ui/renderer2d.ts';
import type { World } from '../../game/world.ts';
import { GameRecord } from '../../game/record.ts';
import { prepareWorld, stateOf, snapshot, drawPlanet } from './nodes.ts';
import type { MapState } from './nodes.ts';
import { SND, ROUNDS } from './rules.ts';
import './nodes.ts';
import { restoreHooks } from '../../restore/flag.ts';
import { rand as crtRand, getTickCount } from '../../game/crt.ts';
import { MODE } from '../../shell/loopmachine.ts';

/** HUD of the original (FUN_0081167c + DrawHUD 0x46055f): colours of the pulsing first wanted topping */
const GREY = 0x7f7f7f7f, WHITE = 0xffffffff;

/** the clone records: per slot of the ten toppings in the air one record per topping model (the renderer builds its views from the model a record has at that moment), the dough and its four layers (TOMA, MEAT, CHEE, GREE) */
interface Clones { toppings: Record<string, GameRecord>[]; dough: GameRecord; layers: { rec: GameRecord; bit: number; step: number }[] }

function makeClone(w: World, name: string): GameRecord {
  const r = new GameRecord(name);
  r.index = w.records.length;
  r.hide();
  w.records.push(r);
  return r;
}

export function createClones(w: World): Clones {
  const byName = (n: string) => w.records.find((r) => r.name === n);
  const c: Clones = { toppings: [], dough: makeClone(w, 'DOUG'), layers: [] };
  for (let i = 0; i < 10; i++) {
    const m: Record<string, GameRecord> = {};
    for (const t of ['TOP1', 'TOP2', 'TOP3', 'TOP4']) { const r = makeClone(w, 'TFLY'); r.model = byName(t)?.model ?? null; m[t] = r; }
    c.toppings.push(m);
  }
  c.dough.model = byName('PIZ1')?.model ?? null;
  // the draw hook FUN_00812ea5: TOMA (4) at z - 0.2, MEAT (8) -0.05 further, CHEE (2), GREE (1)
  for (const [name, bit, step] of [['TOMA', 4, 0.1], ['MEAT', 8, 0.05], ['CHEE', 2, 0.05], ['GREE', 1, 0.05]] as const) {
    const rec = makeClone(w, name + 'L');
    rec.model = byName(name)?.model ?? null;
    c.layers.push({ rec, bit, step });
  }
  return c;
}

/** put the helper records on the matrices the draw hooks use */
export function syncClones(w: World, S: MapState, c: Clones) {
  const set = (r: GameRecord, show: boolean, m?: Float32Array) => {
    if (!show || !m) { r.hide(); return; }
    const was = r.enabled;
    r.m.set(m);
    if (!was) { r.show(); r.prev.set(r.m); }
  };
  const t = S.toppings;
  c.toppings.forEach((byTpl, i) => {
    const s = t?.slots[i];
    const live = !!s && s.active !== 0 && s.state !== 4 && !!s.tpl;
    for (const [name, r] of Object.entries(byTpl)) set(r, live && s!.tpl!.name === name, s?.m);
  });
  const p = S.papa;
  const dough = !!p && p.showDough !== 0 && p.hand[15] !== 0;
  set(c.dough, dough, p?.hand);
  let z = p ? Math.fround(p.hand[14] - Math.fround(0.1)) : 0;
  for (const l of c.layers) {
    if (dough && p && (p.layers & l.bit) !== 0) {
      z = Math.fround(z - Math.fround(l.step));
      const m = new Float32Array(p.hand); m[14] = z;
      set(l.rec, true, m);
    } else set(l.rec, false);
  }
}

registerZoneGame('z41MAP', (ctx: ZoneGameCtx): ZoneGame => {
  const w = ctx.world;
  const S = prepareWorld(w, ctx.archive);
  const tickBase = getTickCount();
  const clones = createClones(w);
  const ga = ctx.sh.audio.ga;
  // the zone's sound set is loaded at its start (FUN_00813500); the 3D flight loop has its own slot below
  ctx.sh.audio.preload(Object.values(SND).filter((id) => id !== SND.FOOD_MOVE));
  // 3D loop of a topping in the air (SND_MAP_FOOD_MOVE, FUN_004433b0 + FUN_004433f0 / 4434b0)
  let slot3d: Awaited<ReturnType<NonNullable<typeof ga>['sfx']['load3D']>> | null = null;
  let loading = false;
  if (ga) { loading = true; ga.sfx.load3D(SND.FOOD_MOVE).then((s) => { slot3d = s; }).catch(() => { /* silent */ }).finally(() => { loading = false; }); }
  S.env = {
    rng: crtRand,        // the shared C runtime generator (src/game/crt.ts)
    // FUN_00435c91 = GetTickCount() - base: it only scales the picks of the swing / round end / throw / hit sounds (`ftol(rand(ms)) & 1` ...): the real clock since the zone's start
    ms: () => Math.max(1, getTickCount() - tickBase),
    sfx: (id) => ctx.sfx(id),
    say: (id) => { ctx.say(id); },
    flight: (pos) => {
      if (!ga || !slot3d || loading) return;
      try { if (pos) ga.sfx.play3D(slot3d, { x: pos[0], y: pos[1], z: pos[2] }); else ga.sfx.stop(slot3d); } catch { /* silent */ }
    },
    puff: () => { /* the "eatpizza" particle burst (FUN_008153c0) is not ported: no particle runtime yet */ },
  };
  ctx.gr.refreshViews();
  let phase = 0;
  let hudMode = 0;
  const hud = ctx.hud;
  hud.visible = false;       // the HUD exists in mode 2 only (FUN_0081167c)

  /** FUN_0081167c: the HUD data of mode 2 */
  const updateHud = () => {
    const p = S.papa;
    if (!p) return;
    hud.left = { tex: 8, tint: WHITE };
    hud.leftText = String(ROUNDS - p.level);
    hud.centreText = String(p.score);
    let first = true;
    hud.column = [0, 1, 2, 3].map((i) => {
      const tex = S.hudIcons[i];
      let tint: number;
      if (p.pending[i] === 0) tint = GREY;
      else if (!first) tint = WHITE;
      else { tint = (0xff000000 | (phase << 16) | (phase << 8) | phase) >>> 0; first = false; }
      return { tex, tint };
    });
    phase = (phase + 0x10) & 0xff;
  };

  const sync = () => {
    syncClones(w, S, clones);
    const c = w.camera.c;
    try {
      ga?.sfx.setListener({ x: c[0], y: c[1], z: c[2] }, { x: c[15], y: c[16], z: c[17] }, { x: c[12], y: c[13], z: c[14] });
    } catch { /* silent */ }
  };
  sync();

  return {
    introId: 'OGSGMP14',
    helpControls: 7,
    tickInBanner: true,
    update() {
      sync();
      updateHud();
      return S.result || undefined;
    },
    bannerTick() { sync(); },
    // the planet's draw hook (FUN_00814964) runs in every pass of the original's loop; the update modes (2, 4) run it in the PLAN node
    everyTick(mode: number) { if (mode !== MODE.PLAY && mode !== MODE.BANNER) drawPlanet(w); },
    beforeRender() { ctx.gr.near = S.near; },
    onBanner() {
      // FUN_00811790: the speech of the medal (or the two sentences of the failure)
      ctx.stopSpeech();
      const m = S.papa?.medal ?? 0;
      if (m > 0) restoreHooks.cue?.('map-medal', { sfx: (id: number) => ctx.sfx(id) });   // restored content (option off: unset)
      if (m === 1) ctx.say('OGSGMP03');
      else if (m === 2) ctx.say('OGSGMP02');
      else if (m === 3) ctx.say('OGSGMP01');
      else ctx.say('OGSGMP04', 'OGSGMP05');
    },
    draw2d(ui: Ui2D, _dt: number, mode: number) {
      // the HUD (icons, counters) only exists in mode 2 (FUN_0081167c)
      hud.visible = mode === 2;
      hudMode = mode;
      if (mode !== 2) return;
      drawMeter(ui, ctx.hud.set, S.gauge);
    },
    drawBanner(ui: Ui2D) {
      const p = S.papa;
      const score = p?.score ?? 0;
      ui.text(1, String(score).padStart(5, ' '), 320, 100, { colour: 0, align: 'centre', maxChars: 30 });
      const m = p?.medal ?? 0;
      if (m >= 1) {
        ctx.text(ui, m === 1 ? 'SGBRONZE' : m === 2 ? 'SGSILVER' : 'SGGOLD', 320, 150, { table: 'std', maxChars: 30 });
        ctx.text(ui, m === 1 ? 'OGSGMP03' : m === 2 ? 'OGSGMP02' : 'OGSGMP01', 320, 200, { maxChars: 32 });
      } else {
        ctx.text(ui, 'OGSGMP04', 320, 200, { maxChars: 32 });
        ctx.text(ui, 'OGSGMP05', 320, 320, { maxChars: 32 });
      }
    },
    destroy() {
      try { if (ga && slot3d) ga.sfx.stop(slot3d); } catch { /* silent */ }
    },
    debug() { return { hudMode, ...snapshot(S) }; },
  };
});

/** the time gauge of the HUD (FUN_00460214 with the block 0x5d4e0b8): 12 coloured segments at x 732 and the arrow at x 696 that follows the gauge (800x600 grid -> 640x480) */
function drawMeter(ui: Ui2D, set: UiTextureSet | null, gauge: number) {
  const k = 0.8;
  const f = gauge >= 12 ? 1 : gauge <= 0 ? 0 : gauge / 12;
  const v = 508 - 192 * f;
  ui.sprite(set, 4, [696 * k, (v - 16) * k, 728 * k, (v + 16) * k], WHITE);
  const tex = [7, 7, 7, 7, 6, 6, 6, 6, 5, 5, 5, 5];
  for (let i = 0; i < 12; i++) {
    const top = 492 - 16 * i;
    ui.sprite(set, tex[i], [732 * k, top * k, 764 * k, (top + 16) * k], WHITE);
  }
}

export { stateOf };
