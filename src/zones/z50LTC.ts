// z50LTC: the "Meet the team" cave (easter egg room of the developers, zone table index 34), ported in M3 (docs/re/m3/z50LTC.md).
// Wrapper FUN_0083942f, loop FUN_00838e41 (the hub loop template: mode 1 .. 8, pause page 5 with mask 0x80), set-up FUN_008399da / FUN_00839748.
// The island's wormhole (WORM, only while var 0xd is set by the cheat code SDREAMS) leads here; the room's own wormhole (PORC) writes var 5 = 2 and leads back.
import { registerCtor } from '../game/setup.ts';
import type { Loaded } from '../game/setup.ts';
import type { World } from '../game/world.ts';
import type { Pe } from '../formats/exe.ts';
import { Controller, CF_ENABLED, runDrawHooks } from '../game/controller.ts';
import { RF_NPC } from '../game/record.ts';
import { B } from '../game/input.ts';
import type { GameRecord } from '../game/record.ts';
import { AnimInstance } from '../game/anim.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import { restoreHooks } from '../restore/flag.ts';
import { ZoneParticles } from '../fx/particles/zone.ts';
import { LtcFx } from './z50LTC/fx.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { LtcGlobals, LtcPepSwitch, PeopleNode, persisted, readPeopleTable, readPersonSounds } from './z50LTC/people.ts';
import { PortalNode } from './z50LTC/portal.ts';
import type { PortalArgs } from './z50LTC/portal.ts';

/** the room's shared state (DAT_05d5f6dc ...): the pepswitc constructor (called while the zone is set up) and the people use the same object */
export const ltc = new LtcGlobals();

/** FUN_0083ab7b: constructor of the zone's own PepSwitc (attach at 0x839abe: pos 0, var 0x5e, mask 0, value 0) */
export const CTOR_LTC_PEPSWITC = 0x83ab7b;
/** FUN_0051ea3c: the box portal constructor (shared with the island, castle ...); the room attaches it to PORC (record 53) at 0x8399ab */
export const CTOR_PORTAL = 0x51ea3c;
/** FUN_0043310c: the skateboard node of the zone (PEPPER_CONTROL & 4): never active in this room, not ported */
export const CTOR_SKATE = 0x43310c;
registerCtor(CTOR_LTC_PEPSWITC, () => new LtcPepSwitch(ltc));

/** the argument block FUN_00839748 builds for the portal (stores at 0x83991f..0x839998: half extents 16 / 24 / 16 as 0x41800000 / 0x41c00000 / 0x41800000, target zone 2, both flag bytes 1) */
export const PORTAL_ARGS: PortalArgs = { half: [16, 24, 16], orVar: 0, orBits: 0, table: 0, target: 2, faceCamera: true, spin: true, keyMask: 0, iconBits: 0 };
/** 0x839803: FUN_004238b7(controller, 0x13) for every person, FUN_004238b7(controller, 0x26) for the portal (0x8399a1: record 53) */
const CTRL_PEOPLE = 0x13, CTRL_PORTAL = 0x26;

/** the HUD text slots FUN_00460003 draws: font 0 (Balloon12), centred at x = 400 / 800 W, y = 494 / 600 H (name) and 518 / 600 H (job) (0x892394 / 0x892390, 0x8923ac / 0x8923a8 / 0x89238c) */
export const NAME_Y = (494 / 600) * 480, ROLE_Y = (518 / 600) * 480, TEXT_X = (400 / 800) * 640;

/** record 28 (RICH, Rich Hancock) is moved 8 units along x by FUN_00839748 */
export const RICH_RECORD = 28;

/** what `buildLtc` made of the zone (tests drive these directly) */
export interface LtcRoom { g: LtcGlobals; people: PeopleNode[]; portal: PortalNode | null; pep: LtcPepSwitch | null }

/** FUN_008399da + FUN_00839748 on top of the extracted set-up: the people, the portal, the crystal boxes, Pepper's chain. `loaded` comes from `setupZone`, `pe` is the executable. */
export function buildLtc(world: World, loaded: Loaded, pe: Pe): LtcRoom {
  const g = ltc;
  g.reset(persisted.toggle);
  g.sounds = readPersonSounds(pe);
  const records = world.records;
  const pepper = loaded.pepper;

  // ---- FUN_00839748: the people (controller flags 0x13, People node at position 0, record flag 0x40)
  const rig = loaded.rigs.get('MFIG') ?? null;
  const table = readPeopleTable(pe);
  const people: PeopleNode[] = [];
  // 0x839782: DAT_00983804 + 0xb9c (x of record 28, RICH) += 8.0 before the loop
  if (records[RICH_RECORD]) { records[RICH_RECORD].x += 8; records[RICH_RECORD].savePrev(); }
  table.forEach((entry, i) => {
    const rec = records[entry.record];
    if (!rec) return;
    // the People constructor (0x83a93c): FUN_00441270(rec, pos, (0, -80, 0), ..., mask 3, radius 1.0, skin 0) puts the minifig on the ground below its placement
    const hit = world.col.sweep(rec, [rec.x, rec.y, rec.z], [0, -80, 0], 3, 1.0, 0);
    if (hit) { rec.x = hit.point[0]; rec.y = hit.point[1]; rec.z = hit.point[2]; rec.savePrev(); }
    if (rig) { rec.anim = new AnimInstance(rig); rec.anim.start(entry.idleClip, 0); }      // FUN_0043b6a3(anim, idle clip, 0) of the constructor
    const node = new PeopleNode(entry, i, g);
    node.var = 2; node.mask = 0; node.value = 0;
    rec.ctrl = new Controller();
    rec.ctrl.flags = CTRL_PEOPLE;
    rec.ctrl.attach(node, 0);
    rec.flags |= RF_NPC;
    people.push(node);
  });
  // the crystals (G000 ...): the box of the .col file instead of the polygons (FUN_004427e0 loop of FUN_00839748)
  for (const r of records) if (r.name.charCodeAt(0) === 71 && !r.ctrl && r.colObj) r.colObj.setBoxFromFile();

  // ---- the portal home: StartCSM at position 0 of PORC (record 53), gate var 2 & 1 == 1
  const portalAt = loaded.setup?.attaches.find((a) => a.ctor === CTOR_PORTAL);
  let portal: PortalNode | null = null;
  const portalRec = portalAt ? records[portalAt.record] : undefined;
  if (portalAt && portalRec) {
    portal = new PortalNode(PORTAL_ARGS);
    portal.var = portalAt.var; portal.mask = portalAt.mask; portal.value = portalAt.value;
    portalRec.ctrl = new Controller();
    portalRec.ctrl.flags = CTRL_PORTAL | CF_ENABLED;
    portalRec.ctrl.attach(portal, portalAt.pos);
  }
  // the attaches handled here are not "skipped" any more (the skateboard node is never active in the room)
  loaded.skipped = loaded.skipped.filter((s) => s.ctor !== CTOR_PORTAL && s.ctor !== CTOR_SKATE && s.ctor !== CTOR_LTC_PEPSWITC);

  // Pepper's chain of the original: pepswitc, SGwalk (the M1 safety net of the stub chain is replaced by the pepswitc fall guard)
  const pc = pepper.ctrl;
  if (pc) pc.nodes = pc.nodes.filter((n) => n.kind !== 'StubGuard');
  const pep = pc?.find<LtcPepSwitch>('pepswitc') ?? null;
  // FUN_0083ab7b (the attach at 0x839abe) stores the record's position when the node is created, before anything moves Pepper
  if (pep) { pep.home = [pepper.x, pepper.y, pepper.z]; pep.homeSet = true; }
  return { g, people, portal, pep };
}

export async function createLtcGame(ctx: ZoneGameCtx): Promise<ZoneGame> {
  const { world, loaded, sh } = ctx;
  const { g, people, portal, pep } = buildLtc(world, loaded, sh.pe);
  // the emitters of the People constructors (FUN_0083a7d2, in the order of the people table) on the GENERICBITS engine of FUN_00442900 (0x839c11)
  const fxz = await ZoneParticles.create(ctx);
  if (fxz) {
    const lf = new LtcFx(fxz);
    for (const p of people) { const rec = world.records[p.entry.record]; if (rec) lf.ctor(rec, world.records[1]); }
    lf.bind(g);
    fxz.finish();
  }
  const records = world.records;
  const pepper = loaded.pepper;
  // the person's sound (FUN_00839560 loads the 27 as 3D sounds): FUN_004433f0 at Pepper's position when the talk starts
  g.playSound = (id) => sh.audio.playAt(id, [pepper.x, pepper.y, pepper.z]);
  const pc = pepper.ctrl;
  // FUN_00429e00 of the talk start (0x83a44a) is the walk node's slope alignment
  const walker = pc?.nodes.find((n) => typeof (n as unknown as { alignToGround?: unknown }).alignToGround === 'function') as unknown as { alignToGround(w: World, rec: GameRecord): void } | undefined;
  if (walker) g.alignPepper = (w, rec) => walker.alignToGround(w, rec);
  // FUN_0042271b (the draw pass) runs after the update and pre-render passes of every loop pass; its hooks (the pepswitc fall guard / candidate reset) therefore run once per sim step here,
  // not once per rAF call of the renderer (LtcPepSwitch.draw ignores the renderer's repeat within the same tick)
  if (pep) world.afterTick = (w) => { runDrawHooks(w, pepper, (n) => (n === pep ? pep.draw(w, pepper, pepper.ctrl!) : undefined)); };
  restoreHooks.cue?.('ltc-arrive', { sfx: (id: number) => ctx.sfx(id) });   // restored content (option off: unset)

  return {
    // the loop FUN_00838e41 has mode 1: it waits for ANY button (DAT_00983840 != 0, no panel, no brief) before play starts (gaps.md U8)
    config: { intro: true, help: false },
    introPanel: false,
    /**
     * Esc before the update pass (FUN_00838dd5 at the loop top switches to the pause mode first): that iteration runs neither the update nor the pre-render pass (both are mode 2
     * only in this loop). The runner ticks the world first, so the update pass is frozen and the pre-render lists (the nodes that ran) are emptied for that tick.
     */
    beforeTick() {
      const esc = (sh.input.pressed & B.ESC) !== 0;
      world.frozen = esc;
      if (esc) for (const r of records) r.ctrl?.ran.fill(false);
    },
    update() {
      world.frozen = false;
      // (the draw hook of the pepswitc node, FUN_0083aa8d, runs from `world.afterTick` above, once per sim step, only when the node ran)
      ctx.hud.letterbox = g.letterbox;
      return 0;
    },
    draw2d(ui: Ui2D) {
      if (g.name) ui.text(0, g.name, TEXT_X, NAME_Y, { colour: 0, align: 'centre' });
      if (g.role) ui.text(0, g.role, TEXT_X, ROLE_Y, { colour: 0, align: 'centre' });
    },
    destroy() { persisted.toggle = g.toggle; g.candidate = null; g.letterbox = 0; g.name = ''; g.role = ''; },
    debug() {
      return {
        toggle: g.toggle, timer: g.timer, candidate: g.candidate?.entry.name ?? null, candDist: g.candDist, talks: g.talks, letterbox: g.letterbox, name: g.name,
        talking: people.filter((p) => p.talking).map((p) => p.entry.name),
        visible: people.filter((p) => records[p.entry.record].enabled).map((p) => p.entry.name),
        respawns: pep?.respawns ?? 0, portal: portal ? { fired: portal.fired, age: portal.age, last: portal.last } : null,
      };
    },
  };
}

registerZoneGame('z50LTC', createLtcGame);
