// M4 WP2 test fixture: the cutscene runner (src/shell/cutscene.ts) on the real island world of a story node (tools/lib/island-load.mjs), with an environment like
// CutsceneHost's (dictionaries of the emulated set-up, the island's waypoint maps in the global waypoint system, `.man` splines from the archive, message tables).
// Stand-ins for what the other work packages / the zone game provide in the real game (documented in docs/re/m4/wp2-cutscenes.md):
//   * Pepper's walker as FUN_0042207d creates it (PATH map, node -3, speed 0.016667, lane 0.01, turn 0.5236, radii 0.2 / 0.75, limit 0.25), re-pinned on the PATH node
//     nearest to her like the StartCSM trigger FUN_0051dd7e does with its waypoint (FUN_004625d7) before it starts the script;
//   * the script actors that walk / turn (MOVEPOSITION to a waypoint, FOLLOW) get a controller and a walker with the same settings (their NPC nodes do it in the game);
//   * the script actors that get SETANIM and have no animation instance get one on Pepper's rig (MFIG: the dictionary's clip numbers are that rig's).
import { CutsceneRunner, dictLookup, switchResolver } from '../../src/shell/cutscene.ts';
import { parseCutscene } from '../../src/formats/cutscene.ts';
import { parseMan } from '../../src/formats/anim.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import { Controller } from '../../src/game/controller.ts';
import { waypoints, MAP_PATH } from '../../src/game/walker.ts';
import { loadMessages } from '../../src/ui/strings.ts';

/** FUN_0042207d's walker settings */
export const PEP_WALKER = { speed: 0.016666666, lane: 0.01, turn: 0.523596, rmin: 0.2, rmax: 0.75, limit: 0.25 };

export function makeWalker(rec) {
  const h = waypoints.create(MAP_PATH, rec, -3);
  if (!h) return 0;
  waypoints.setSpeed(h, PEP_WALKER.speed); waypoints.setLane(h, PEP_WALKER.lane); waypoints.setTurnRate(h, PEP_WALKER.turn);
  waypoints.setRadiusMin(h, PEP_WALKER.rmin); waypoints.setRadiusMax(h, PEP_WALKER.rmax); waypoints.setRadiusLimit(h, PEP_WALKER.limit);
  // the StartCSM trigger (FUN_0051dd7e) re-pins Pepper's walker on its waypoint before the script; the NPCs' walkers follow their routes: the nearest PATH node
  waypoints.teleport(h, waypoints.nearestNode(MAP_PATH, rec.x, rec.y, rec.z));
  return h;
}

/** a simple deterministic random (the mouth frames) */
export function lcg(seed = 1) { let x = seed >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** the island's cutscene environment for the world of `I` (loadIsland). `speechTicks`: how long a voice plays in the mock */
export function islandEnv(ctx, I, opts = {}) {
  const w = I.world, setup = I.ictx.setup;
  waypoints.unload();
  waypoints.load(I.archive);
  const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
  const tables = new Map();
  const mans = new Map();
  const log = [];
  let voiceLeft = 0;
  const anim = dictLookup(setup.dictionaries.anims);
  const env = {
    world: w,
    wp: waypoints,
    waypoint: () => null,
    table: null,
    text(id) { return env.table?.text(id) ?? id; },
    say(id) { log.push(`say ${id}`); voiceLeft = opts.speechTicks ?? 20; return true; },
    speechIdle: () => voiceLeft <= 0,
    stopSpeech() { log.push('stop'); voiceLeft = 0; },
    setFov(f) { env.fov = f; log.push(`fov ${f}`); },
    getFov: () => env.fov,
    fov: 1,
    skip: false,
    skipPressed: () => env.skip,
    speechOn: () => opts.speechOn ?? true,
    textOn: () => true,
    letterbox(m) { env.bars = m; log.push(`bars ${m}`); },
    bars: 0,
    near: null,
    setNearPlane(n) { env.near = n; },
    animClip: (_a, name) => anim(name) ?? -1,
    varIndex: switchResolver(setup.dictionaries.switches, w.vars),
    loadMan(path) {
      const key = path.toUpperCase();
      if (!mans.has(key)) {
        const parts = path.split(/[\\/]/).filter(Boolean);
        const e = I.archive.find(parts.slice(1).join('/'));
        let m = null;
        try { m = e ? parseMan(I.archive.read(e)) : null; } catch { m = null; }
        mans.set(key, m);
      }
      return mans.get(key);
    },
    random: lcg(7),
    /** advance the mock voice */
    tickSpeech() { if (voiceLeft > 0) voiceLeft--; },
    log,
    tables,
  };
  return env;
}

/** the island's slots of the era (FUN_0045c397 calls of the emulated set-up), parsed */
export function islandSlots(ctx, I) {
  const setup = I.ictx.setup;
  const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
  const n = Array.isArray(setup.cutsceneSlots) ? setup.cutsceneSlots[0] : setup.cutsceneSlots;
  return {
    count: n,
    slots: setup.cutscenes.map((c) => {
      const e = I.archive.find(`cutscene/${c.name}.cut`);
      const script = parseCutscene(I.archive.read(e));
      let table = null;
      try { table = loadMessages(messages, [`${c.area.toUpperCase()}/Data/${c.messages}.str`]); } catch { table = null; }
      return { slot: c.slot, name: c.name, messages: c.messages, script, table };
    }),
  };
}

/** prepare the actors a script uses like their nodes would in the game (walkers, animation instances); returns what was added */
export function prepareActors(I, script) {
  const w = I.world, added = [];
  const find = (n) => w.records.find((r) => r.name.slice(0, 4) === n);
  const pep = I.pepper ?? find('PEPP');
  if (pep?.ctrl && !(pep.ctrl.walker && waypoints.get(pep.ctrl.walker))) { pep.ctrl.walker = makeWalker(pep); added.push('PEPP walker'); }
  for (const c of script.commands) {
    const a = find(c.actor);
    if (!a) continue;
    const walks = (c.cmd === 6 && c.targetKind === 'waypoint') || c.cmd === 7;
    if (walks) {
      if (!a.ctrl) { a.ctrl = new Controller(); added.push(`${a.name} controller`); }
      if (!(a.ctrl.walker && waypoints.get(a.ctrl.walker))) { a.ctrl.walker = makeWalker(a); added.push(`${a.name} walker`); }
    }
    if (c.cmd === 1 && !a.anim && pep?.anim) { a.anim = new AnimInstance(pep.anim.rig); added.push(`${a.name} anim`); }
  }
  return added;
}

export function newRunner(env, slots) {
  const r = new CutsceneRunner(env);
  r.allocate(slots.count);
  for (const s of slots.slots) r.define(s.slot, s.name, s.script);
  return r;
}
