// Shell tables read from the executable: zone table, story FSM, menu pages, captions, level-select lists, decor tables, initial vars.
// Expected values come from the decompile helper scripts (tools/zones.py, fsm_dump.py, gs_menu.py of decomp-le2) and architecture.md 2.1 / 2.2 / 3.1.
import fs from 'node:fs';
import path from 'node:path';
import { Pe } from '../../src/formats/exe.ts';
import {
  readZoneTable, readStoryFsm, readMenuPages, readFsmCaptions, readLevelSelect, readDecorTables, defaultDecor, readInitialVars, replayEnabled, packMenuInternals,
  decorGroupOfZone, ZONE_COUNT, STORY_NODE_COUNT,
} from '../../src/shell/tables.ts';

// fsm_dump.py: [zone, var, mask, value] per node
const FSM = [[0,2,32767,1],[1,250,32767,1],[2,277,32767,16],[2,79,32767,0],[2,303,32767,1],[2,277,32767,1],[2,81,32767,1],[31,165,32767,4],[31,142,32767,15],[31,5,32767,5],[5,83,32767,1],[31,277,32767,256],[31,277,32767,512],[31,94,32767,8],[31,302,32767,1],[6,94,32767,1],[6,86,32767,12],[6,86,32767,2],[7,83,32767,1],[6,86,32767,17],[6,86,32767,2],[6,86,32767,3],[6,86,32767,4],[8,83,32767,1],[6,86,32767,5],[6,86,32767,6],[9,83,32767,1],[6,86,32767,37],[6,94,32767,8],[6,5,32767,32],[32,165,2,2],[32,277,32767,2],[32,281,32767,2],[10,5,32767,11],[11,257,1,1],[12,83,32767,1],[13,254,32767,1],[14,83,32767,1],[13,255,32767,1],[15,83,32767,1],[13,256,32767,1],[16,83,32767,1],[17,252,32767,1],[17,83,32767,1],[17,252,32767,2],[11,259,32767,7],[18,83,32767,1],[19,257,32767,2],[20,83,32767,1],[21,83,32767,1],[19,257,32767,1],[10,250,32767,1],[33,94,32767,1],[33,277,32767,4],[33,38,32767,15],[33,277,32767,12],[33,142,32767,15],[33,277,32767,7],[33,284,32767,1],[24,83,32767,1],[25,83,32767,1],[2,284,32767,2],[26,83,32767,1],[30,83,32767,1],[27,256,32767,1],[28,83,32767,1],[27,257,32767,1],[29,83,32767,1],[2,1,32767,1],[3,1,32767,1],[4,1,32767,1],[34,1,32767,1]];
// gs_menu.py: item counts of the 30 pages
const PAGE_ITEMS = [5, 3, 9, 9, 6, 7, 5, 9, 9, 5, 6, 5, 4, 4, 3, 3, 3, 3, 7, 3, 3, 5, 4, 3, 3, 5, 3, 6, 3, 6];
// zones.py (internal id, kind) per table index
const ZONES = [['z00FRE',1],['z01BPK',1],['z90PSX',1],['z03PPH',3],['z04IFC',3],['z05WAB',3],['z90CAS',1],['z08BKD',3],['z09JST',4],['z10RGB',4],['z90ADV',1],['z90OSD',1],['z15SSH',2],['z90PYA',1],['z17WAS',3],['z18MMP',3],['z20DSP',2],['z21FSH',3],['z22BIP',2],['z90DIP',1],['z27TRX',2],['z28HAT',4],['z29PAI',1],['z30PLI',1],['z36CNT',3],['z38PAR',3],['z39ASB',2],['z90OGL',1],['z41MAP',3],['z42BRP',3],['z40APO',0],['z91PSX',1],['z92PSX',1],['z93PSX',1],['z50LTC',1]];

export default {
  name: 'shell-tables',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
    if (!fs.existsSync(exePath)) return { checked: 0, failures: [`missing ${exePath}`] };
    const pe = new Pe(new Uint8Array(fs.readFileSync(exePath)));

    // -- zone table
    const zt = readZoneTable(pe);
    ok(zt.length === ZONE_COUNT && ZONE_COUNT === 35, 'zone table has 35 records');
    ZONES.forEach(([id, kind], i) => {
      ok(zt[i].id === id, `zone ${i} id ${zt[i].id} != ${id}`);
      ok(zt[i].kind === kind, `zone ${i} (${id}) kind ${zt[i].kind} != ${kind}`);
      ok(zt[i].index === i, `zone ${i} index`);
    });
    ok(zt[0].runAt === 0x470ac3 && zt[2].runAt === 0x4afaf7 && zt[31].runAt === 0x4afaf7 && zt[33].runAt === 0x4afaf7, 'run addresses (front end, island x4)');
    ok(zt[6].runAt === 0x572780 && zt[25].runAt === 0x465d39 && zt[34].runAt === 0x83942f, 'run addresses (castle wrapper, parachute, LTC wrapper)');
    ok(!zt[22].hasRun && !zt[23].hasRun && zt[22].archive === null && zt[23].archive === null, 'zones 22 and 23 have no code and no archive');
    ok(zt.filter((z) => z.hasRun).length === 33, '33 zones have code');
    const want = { z00FRE: 'z60FRE', z90PSX: 'z02LGI', z91PSX: 'z02LGI', z92PSX: 'z02LGI', z93PSX: 'z02LGI', z90CAS: 'z07CSI', z90ADV: 'z13CAI', z90OSD: 'z14OSD', z90PYA: 'z16PYA', z90DIP: 'z23DIP', z90OGL: 'z40OGL', z40APO: 'z40aPO' };
    const names = new Set(ctx.archives.map((a) => a.name));
    for (const z of zt) {
      if (!z.hasRun) continue;
      if (want[z.id]) ok(z.archive === want[z.id], `archive of ${z.id}: ${z.archive} != ${want[z.id]}`);
      ok(names.has(z.archive), `archive ${z.archive} of ${z.id} exists in the data`);
    }
    ok(new Set(zt.filter((z) => z.archive).map((z) => z.archive)).size === 30, '30 distinct archives');

    // -- story FSM
    const fsm = readStoryFsm(pe);
    ok(fsm.length === STORY_NODE_COUNT && STORY_NODE_COUNT === 72, 'story FSM has 72 nodes');
    FSM.forEach(([zone, v, mask, value], i) => {
      const n = fsm[i];
      ok(n.zone === zone && n.var === v && (n.mask & 0xffff) === mask && n.value === value, `node ${i}: ${JSON.stringify(n)} != ${JSON.stringify([zone, v, mask, value])}`);
    });
    ok(fsm[30].mask === 2 && fsm[34].mask === 1, 'masks 2 and 1 at nodes 30 and 34');
    ok(zt[fsm[10].zone].id === 'z05WAB' && zt[fsm[67].zone].id === 'z42BRP' && zt[fsm[63].zone].id === 'z40APO', 'node zones by name (10 WAB, 63 APO, 67 BRP)');
    // every node's zone is a zone with code
    ok(fsm.every((n) => zt[n.zone].hasRun), 'every story node points at a zone with code');

    // -- menu pages
    const pages = readMenuPages(pe);
    ok(pages.length === 30, '30 menu pages');
    pages.forEach((p, i) => { ok(p.nitems === PAGE_ITEMS[i] && p.items.length === PAGE_ITEMS[i], `page ${i} items ${p.nitems} != ${PAGE_ITEMS[i]}`); });
    ok(pages[0].items[0].label === '!MAINMENU' && pages[0].items[1].label === '!FESTART' && pages[0].items[1].type === 1 && pages[0].items[1].id === 6, 'page 0 main menu: Start -> page 6');
    ok(pages[6].items[1].label === '!FENEWGAM' && pages[6].items[1].type === 4 && pages[6].items[1].id === 3, 'page 6 start menu: New game = action 3');
    ok(pages[2].setupFn === 0x41ae6e && pages[2].type === 1 && pages[2].items.slice(1, 8).every((it, k) => it.id === 0x14 + k && it.type === 9), 'page 2 load list: actions 0x14..0x1a (setup 0x41ae6e)');
    ok(pages[3].items.slice(1, 8).every((it, k) => it.id === 0x1e + k) && pages[8].items.slice(1, 8).every((it, k) => it.id === 0x28 + k), 'save ids 0x1e.., erase ids 0x28..');
    ok(pages[7].items.slice(1, 8).every((it, k) => it.id === 3 + k && it.type === 4), 'page 7 new-game slots: actions 3..9');
    ok(pages[5].items[3].label === '!SAVE' && pages[5].items[3].mask === 0x40 && pages[5].items[5].id === 0x11, 'page 5 pause: save disabled by mask 0x40, Pepper house = action 0x11');
    ok(pages[18].items[3].mask === 0x80 && pages[13].kind === 1 && pages[24].kind === 1, 'page 18 masks 0x80, pages 13/24 are dynamic lists');
    ok(pages.filter((p) => p.kind === 1).map((p) => p.index).join() === '13,14,17,23,24,26,28', 'dynamic list pages');
    ok(pages[11].items.slice(1, 4).map((i) => i.label).join() === '!FEMUSVOL,!FESNDVOL,!FESPCVOL' && pages[11].items[1].type === 6, 'sound page: three sliders');
    ok(pages[12].items[1].label === '!FESPEECH' && pages[12].items[2].label === '!FESUBTLE' && pages[12].items[1].type === 5, 'cutscene page toggles speech / subtitles');
    ok(pages[29].items.length === 6 && pages[29].items[0].label === '!Pause', 'page 29 pause');

    // -- save-slot captions
    const caps = readFsmCaptions(pe);
    ok(caps.length === 71, `71 FSMSTATE captions, got ${caps.length}`);
    ok(caps[0] === 'FSMSTATE02' && caps[4] === 'FSMSTATE03' && caps[70] === 'FSMSTATE65' && caps[11] === 'FSMSTATE10', 'caption spot checks');
    ok(caps.every((c, i) => i === 0 || Number(c.slice(8)) >= Number(caps[i - 1].slice(8))), 'captions are non-decreasing along the story');

    // -- level select
    const ls = readLevelSelect(pe);
    ok(ls.replays.length === 19 && ls.checkpoints.length === 36 && ls.allZones.length === 25 && ls.sounds.length === 22, 'level select counts 19 / 36 / 25 / 22');
    ok(ls.replays.every((r) => r.node === -1) && ls.replays[0].label === '!LEVBPK' && ls.replays[0].zone === 1 && ls.replays[0].gateVar === 141 && ls.replays[18].zone === 28, 'replay list: BPK first, MAP last, no node jumps');
    ok(ls.replays.every((r) => zt[r.zone].kind !== 1 || r.zone === 1), 'replays are mini-games (or the skate park)');
    ok(ls.checkpoints.filter((c) => c.node >= 0).length === 32 && ls.checkpoints[2].node === 2 && ls.checkpoints[35].zone === 29 && ls.checkpoints[35].node === 67, 'checkpoint list');
    ok(ls.checkpoints.every((c) => c.node < 0 || zt[fsm[c.node].zone].archive === zt[c.zone].archive), 'checkpoint nodes belong to their zones (island variants share the archive)');
    ok(ls.allZones.every((c) => c.node === -1 && zt[c.zone].hasRun) && ls.allZones[0].zone === 25, 'all-zones list');
    ok(ls.sounds[0].musicKey === 'Z01BPK' && ls.sounds[21].label === 'LEVFRE', 'sound test list');
    // FUN_0041b12d: gate var set / not set; entry 1 (IFC) special; entry 0 special
    const vget = (m) => (i) => m[i] ?? 0;
    ok(replayEnabled(ls.replays[1], vget({ 0x58: 3 })) && !replayEnabled(ls.replays[1], vget({ 0x58: 8 })) && replayEnabled(ls.replays[1], vget({ 0x58: 40 })), 'IFC replay rule (node outside 7..10)');
    ok(replayEnabled(ls.replays[0], vget({ 0x58: 3 })) && !replayEnabled(ls.replays[0], vget({ 0x58: 20 })) && replayEnabled(ls.replays[0], vget({ 0x58: 20, 141: 5 })), 'BPK replay rule');
    ok(!replayEnabled(ls.replays[2], vget({})) && replayEnabled(ls.replays[2], vget({ 64: 1 })), 'WAB replay unlocked by its gate var');
    ok(packMenuInternals(24, 1, 0, 2) === (24 | 0x80 | (1 << 8) | (2 << 24)), 'menu internals packing');

    // -- decor tables
    const dt = readDecorTables(pe);
    ok(dt.groups.length === 6 && dt.groups[0].first === 0, 'decor groups');
    ok(dt.groups.every((g) => g.first + g.count <= 0x1c0) && dt.groups.reduce((s, g) => s + g.count, 0) <= 0x1c0, 'decor groups inside the 0x1c0 entries');
    ok(defaultDecor(pe).length === 0x380, 'default decor blob 0x380 bytes');
    ok(decorGroupOfZone(2) === 0 && decorGroupOfZone(33) === 0 && decorGroupOfZone(6) === 1 && decorGroupOfZone(11) === 2 && decorGroupOfZone(13) === 3 && decorGroupOfZone(19) === 4 && decorGroupOfZone(27) === 5 && decorGroupOfZone(5) === -2, 'decor group of zone');

    // -- initial game vars (.data)
    const iv = readInitialVars(pe), nz = [];
    iv.forEach((v, i) => { if (v) nz.push(`${i}:${v}`); });
    ok(nz.join(' ') === '0:1 2:1 9:1 84:1 85:1 87:1 119:3600', `initial vars: ${nz.join(' ')}`);

    notes.push(`zones ${zt.length}, nodes ${fsm.length}, pages ${pages.length} (${pages.reduce((s, p) => s + p.nitems, 0)} items), captions ${caps.length}, replays ${ls.replays.length}`);
    return { checked, failures, notes };
  },
};
