// M5 z07CSI, the nine cutscene scripts of the castle (csi01, csi02, csi04 .. csi09; csi02a is in the archive but no slot of the set-up names it, csi03 does not exist): every script the
// ORIGINAL's set-up declares (emulated FUN_0045c397 calls, `emu.cutscenes`) is run to its end by the cutscene runner on the castle world of its stage, and every name it uses must resolve:
//   * actors (FUN_0045d5c0: 4-char record name, CMRA / SWCH / PLAY global), SETANIM names (the zone's animation dictionary), SETSWITCH names (SWITCH_CSI_* / SWITCH_GME_CSM_SFXn),
//     SAYTEXT ids (the script's message table `CI/Data/<strings>.str`, voice id >= 0), waypoints (CSM / PATH maps), splines (.man files);
//   * the script ends by itself (no Shift) and leaves the world in the state the story needs (PEPPER_CONTROL's 0x100 bit cleared again).
import { loadCsi } from '../lib/m5-z07CSI-load.mjs';
import { parseCutscene } from '../../src/formats/cutscene.ts';
import { CutsceneRunner, dictLookup, switchResolver } from '../../src/shell/cutscene.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { waypoints } from '../../src/game/walker.ts';
import { readSoundTable, SOUND_HANDLES } from '../../src/zones/z07CSI/csifsm.ts';
import { ZONE_SOUND_SETUP } from '../../src/audio/zonesounds.ts';

// stage (story node, previous zone) -> the scripts the story starts there (the set-up declares the whole stage set's slots: csi09's actors only exist from node 27 on)
const STAGES = [[15, 0, ['csi01']], [19, 7, ['csi02', 'csi04', 'csi05', 'csi06']], [24, 8, ['csi07', 'csi08']], [27, 9, ['csi09']]];
/** FOLLOW / ATTACH partner words that are no record: ATTACH ... NULL (detach), FOLLOW CMRA ACTO (the camera's own placeholder); the loader's find gives a null pointer for them */
const NULL_PARTNERS = new Set(['NULL', 'ACTO']);

export default {
  name: 'm5-z07CSI-cutscenes',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const csi = ctx.archives.find((a) => a.name.toLowerCase() === 'z07csi');
    const played = new Map();   // script -> { ticks, lines, voiced }
    for (const [node, prev, mine] of STAGES) {
      const H = loadCsi(ctx, { node, vars: { 0xa3: prev } });
      const specs = H.emu.cutscenes.filter((c) => c.slot !== null && !!c.name && mine.includes(c.name));
      ok(specs.length === mine.length, `node ${node}: the stage declares ${mine} (${specs.map((c) => c.name)})`);
      ok(specs.length > 0, `node ${node}: the set-up declares cutscene slots`);
      const anims = dictLookup(H.emu.dictionaries.anims), sw = switchResolver(H.emu.dictionaries.switches, H.world.vars);
      for (const s of specs) {
        const e = csi.find(`cutscene/${s.name}.cut`);
        ok(!!e, `node ${node}: slot ${s.slot} script ${s.name} exists`);
        if (!e) continue;
        const cut = parseCutscene(csi.read(e));
        const table = loadMessages(messages, [`${(s.area ?? 'ci').toUpperCase()}/Data/${s.messages ?? s.strings ?? s.name}.str`]);
        let lines = 0, voiced = 0, sfx = 0;
        for (const c of cut.commands) {
          const bad = (what) => failures.push(`node ${node} ${s.name} cmd ${c.name} ${c.actor}: ${what}`);
          checked++;
          if (c.actor !== 'CMRA' && c.actor !== 'SWCH' && c.actor !== 'PLAY' && !H.world.records.some((r) => r.name.toUpperCase() === c.actor)) bad(`unknown actor ${c.actor}`);
          if (c.cmd === 1 && !((anims(c.anim) ?? -1) >= 0)) bad(`animation ${c.anim} not in the dictionary`);
          if (c.cmd === 8 && sw(c.switchName) === null) bad(`switch ${c.switchName} unknown`);
          // the cutscene sound switches (SWITCH_GME_CSM_SFXn): CSIFSM's table (FUN_005753b0) must have the variable, and its sound must be in the zone's preload list
          if (c.cmd === 8 && /^SWITCH_GME_CSM_SFX/i.test(c.switchName)) {
            const cue = readSoundTable(H.pe).find((q) => q.var === sw(c.switchName));
            const id = cue ? H.ictx.soundOf(SOUND_HANDLES + 4 * cue.slot) : -1;
            if (!cue) bad(`${c.switchName}: no entry in CSIFSM's sound table`);
            else if (!ZONE_SOUND_SETUP.z07CSI.loads.some((l) => l[1] === id)) bad(`${c.switchName}: sound ${id} is not preloaded`);
            else sfx++;
          }
          if (c.cmd === 2) { lines++; if (!table.has(c.textId)) bad(`text ${c.textId} missing`); else if (table.voice(c.textId) >= 0) voiced++; else bad(`text ${c.textId} has no voice id`); }
          if (c.targetKind === 'actor' && !H.world.records.some((r) => r.name.toUpperCase() === c.target)) bad(`target actor ${c.target} unknown`);
          if (c.targetKind === 'waypoint' && !(waypointPos(H, c.target))) bad(`waypoint ${c.target} not in CSM / PATH`);
          if ((c.cmd === 7 || c.cmd === 14) && c.other && !NULL_PARTNERS.has(c.other) && !H.world.records.some((r) => r.name.toUpperCase() === c.other)) bad(`partner ${c.other} unknown`);
        }
        // run it: the real runner on this world, no Shift, the voice replaced by the text's own length (speech off: the command lasts (strlen + 20) / 20 s)
        const env = {
          world: H.world, wp: waypoints,
          waypoint: (n) => waypointPos(H, n),
          text: (id) => table.text(id), say: () => false, speechIdle: () => true, stopSpeech() {}, setFov() {}, getFov: () => 1, skipPressed: () => false, speechOn: () => false, textOn: () => true,
          letterbox() {}, animClip: (_a, n) => anims(n) ?? -1, varIndex: (n) => sw(n), loadMan: () => null, random: () => 0.5,
        };
        const r = new CutsceneRunner(env);
        r.allocate(s.slot + 1); r.define(s.slot, s.name, cut);
        H.world.vars.set(0xb, 0);
        const before = H.world.vars.get(0x5e);
        ok(r.start(s.slot), `node ${node}: ${s.name} starts`);
        let t = 0;
        while (r.active() && t < 20000) { r.tick(); H.world.tick(); t++; }
        ok(!r.active(), `node ${node}: ${s.name} ends by itself (${t} ticks)`);
        ok(t > 60, `node ${node}: ${s.name} runs a while (${t} ticks)`);
        ok((H.world.vars.get(0x5e) & 0x100) === 0, `node ${node}: ${s.name} clears the cutscene bit of PEPPER_CONTROL (${before.toString(16)} -> ${H.world.vars.get(0x5e).toString(16)})`);
        const p = played.get(s.name);
        if (!p) played.set(s.name, { ticks: t, lines, voiced, sfx });
      }
    }
    for (const [n, p] of played) notes.push(`${n}: ${p.ticks} ticks, ${p.lines} lines (${p.voiced} voiced), ${p.sfx} sound switches`);
    ok(played.size === 8, `eight different scripts run in the four stages (${[...played.keys()]})`);
    return { checked, failures, notes: [notes.join('; ')] };
  },
};

function waypointPos(H, name) {
  for (const map of [2, 1]) {
    const i = waypoints.findNode(map, String(name).toUpperCase());
    if (i >= 0) { const p = waypoints.nodePos(map, i); return [p[0], p[1], p[2]]; }
  }
  return null;
}
