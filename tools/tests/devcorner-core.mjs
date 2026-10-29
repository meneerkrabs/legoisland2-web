// Ontwikkelaarshoek core: the F9 dialog's variable / jump / record logic (springen, variabelen, records, cheats).
import { loadExe } from '../lib/engine-load.mjs';
import { scanVarRefs } from '../../src/devcorner/var-scan.ts';
import { gobLine, moveRecord, HIDDEN_NAMES } from '../../src/devcorner/records.ts';
import { GameRecord } from '../../src/game/record.ts';
import { GameVars } from '../../src/game/vars.ts';
import { StoryFsm } from '../../src/shell/story.ts';
import { readStoryFsm, readZoneTable, readLevelSelect, readInitialVars } from '../../src/shell/tables.ts';
import { UNREACHABLE_NODES } from '../../src/devcorner/springen.ts';
import { CHEAT_WORDS } from '../../src/devcorner/cheats.ts';
import { LOCKED } from '../../src/devcorner/variabelen.ts';

export default {
  name: 'devcorner-core',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const pe = loadExe(ctx.dataRoot);
    // variables: 319, names, locked 1 and 2 (FUN_00417597), evidence scan (unused.md 6.12: 155 never touched by a constant index, a lower bound)
    const v = new GameVars(); v.loadNames(pe); v.a.set(readInitialVars(pe));
    ok(v.a.length === 319 && v.nameOf(0x58) === 'SWITCH_GME_FSM_CURRENT_STATE' || /FSM_CURRENT_STATE/.test(v.nameOf(0x58)), `var 0x58 name ${v.nameOf(0x58)}`);
    v.set(1, 5); v.set(2, 9); ok(v.get(1) === 0 && v.get(2) === 1 && LOCKED.has(1) && LOCKED.has(2), 'vars 1 and 2 are locked');
    const refs = scanVarRefs(pe);
    const none = [...refs.read].filter((x, i) => !x && !refs.write[i]).length;
    ok(refs.read[0x58] > 3 && refs.write[0x58] > 0, 'FSM_CURRENT_STATE is read and written with a constant index');
    ok(none > 100 && none < 220, `vars without a constant reference: ${none} (research: about 155)`);
    notes.push(`variables without a constant-index reference: ${none} (research 6.12: 155, a lower bound of the touched ones)`);
    // story jump = FUN_00404c07
    const zones = readZoneTable(pe), nodes = readStoryFsm(pe);
    const st = new StoryFsm(v, nodes, zones);
    ok(nodes.length === 72, '72 story nodes');
    v.set(0x58, 5); st.jump(40); ok(st.node === 40 && v.get(5) === nodes[40].zone, 'jump(40): node and var 5 = the node zone');
    st.jump(3); ok(st.node === 3 && v.get(5) === nodes[3].zone, 'jump back');
    ok([...UNREACHABLE_NODES].every((n) => n >= 68 && nodes[n].var === 1 || n === 71 || n === 69 || n === 70), 'nodes 68-71 parked behind var 1');
    ok(nodes[68].var === 1 && nodes[68].mask === 0x7fff && nodes[68].value === 1, 'node 68 waits for NS_OFF = 1 (never true)');
    const ls = readLevelSelect(pe);
    ok(ls.checkpoints.length === 37 && ls.allZones.length === 26, `page 17 has ${ls.checkpoints.length} entries, page 26 ${ls.allZones.length}`);
    ok(ls.allZones.slice(1).every((e) => (e.mask & 0x20) !== 0) && ls.allZones[0].mask === 0, 'page 26: only the first row is enabled');
    // records
    const r = new GameRecord('PEPP'); r.m.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); r.x = 10.04; r.y = 2; r.z = -3.256; r.ctrl = {};
    ok(gobLine(r, 7) === 'PEPP @  10.0,   2.0, -3.26. V:Y, AI:Y (   7)' || /^PEPP @ +10\.0, +2\.0, +-3\.26\. V:Y, AI:Y \( +7\)$/.test(gobLine(r, 7)), `gob line "${gobLine(r, 7)}"`);
    moveRecord(r, 'by', [1, 1, 1]); ok(Math.abs(r.x - 11.04) < 1e-4 && r.prev[12] === r.x, 'Move By');
    moveRecord(r, 'to', [0, 0, 0]); ok(r.x === 0 && r.y === 0 && r.z === 0, 'Move To');
    r.setEuler(0, Math.PI / 2, 0, 0, 0, 0); moveRecord(r, 'fwd', [0, 0, 5]); ok(Math.abs(Math.abs(r.x) - 5) < 1e-3, `Forwards follows the record's yaw (x ${r.x})`);
    ok(HIDDEN_NAMES.test('BTB7') && HIDDEN_NAMES.test('XXX3') && !HIDDEN_NAMES.test('PEPP'), 'hidden record names');
    ok(CHEAT_WORDS.map((w) => w.word).join() === 'PEPPERONI,FSMADVANCE,RHUNRHEGED,BAATAT,SDREAMS,DAFFODILE', 'the six cheat words in table order');
    return { checked, failures, notes };
  },
};
