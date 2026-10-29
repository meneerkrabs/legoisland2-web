// Small pieces of the shell: DirectInput key table, credits table, island HUD state, exit -> next zone mapping of the stub zones.
import { codeToDik, dikToCodes, readKeyNames, keyCodeName } from '../../src/shell/dik.ts';
import { Credits, buildCredits, CREDITS_LINES } from '../../src/shell/credits.ts';
import { Hud } from '../../src/shell/hud.ts';
import { configFor, nextAfterExit, PAUSE_PAGE } from '../../src/shell/playzone.ts';
import { EXIT } from '../../src/shell/loopmachine.ts';
import { StoryFsm } from '../../src/shell/story.ts';
import { readStoryFsm, readZoneTable, readInitialVars } from '../../src/shell/tables.ts';
import { loadMessages, CREDITS_FILES } from '../../src/ui/strings.ts';
import { GameVars } from '../../src/game/vars.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { B } from '../../src/game/input.ts';

export default {
  name: 'shell-ui',
  run(ctx) {
    const failures = []; let checked = 0;
    const eq = (name, a, b) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
    const pe = loadExe(ctx.dataRoot);

    // ---- keys: the defaults of the executable's key table map to browser codes and back
    eq('Up arrow', [dikToCodes(0xc8), codeToDik('ArrowUp')], [['ArrowUp'], 0xc8]);
    eq('letters', [codeToDik('KeyZ'), codeToDik('KeyX'), codeToDik('KeyC')], [0x2c, 0x2d, 0x2e]);
    for (const d of [0x01, 0x1c, 0x39, 0x56, 0x1d, 0x2a, 0x38, 0xd3]) eq(`dik ${d.toString(16)} round trip`, dikToCodes(d).every((c) => codeToDik(c) === d), true);
    const names = readKeyNames(pe);
    eq('key names come from the EXE table', [names.get(0x01), names.get(0x1c), names.get(0x1d)], ['ESCAPE', 'RETURN', 'LCTRL']);
    eq('FUN_0043839f formats', [keyCodeName(0x10039, names), keyCodeName(0x00001, names), keyCodeName(0x20003, names)], [names.get(0x39), 'MOUSE 1', 'JOY 3']);

    // ---- credits: 225 table lines, wrapped to 600 px, scrolling from -480, ended by any button but Space
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const table = loadMessages(messages, CREDITS_FILES);
    const lines = buildCredits(pe, table, (cls, s) => s.length * 12);
    eq('credit lines at least the table', lines.length >= CREDITS_LINES, true);
    eq('first lines: title, game, subtitle', lines.slice(0, 5).map((l) => l.text), ['CREDITS', '', '', 'LEGO ISLAND II', "THE BRICKSTER'S REVENGE"]);
    eq('stage characters walk in for some lines', lines.some((l) => l.record >= 0), true);
    const c = new Credits(lines);
    for (let i = 0; i < 100; i++) c.tick(0);
    eq('scrolls one pixel per tick from -480', c.pos, -380);
    eq('Space does not end the credits', c.tick(B.SPACE), false);
    eq('any other button ends them', c.tick(B.ENTER), true);
    const c2 = new Credits(lines);
    let n = 0; while (!c2.tick(0) && n < 20000) n++;
    eq('they end by themselves after scrolling through the list', n > 1000 && n < 20000, true);

    // ---- island HUD (FUN_004b908d)
    const vars = new GameVars(); vars.a.set(readInitialVars(pe));
    const hud = new Hud(null);
    vars.set(0x58, 3); vars.set(0x59, 2); vars.set(0xb0, 11 - 4); vars.set(0x4f, 11 - 2);
    hud.updateIsland(vars);
    eq('before node 7: pizzas and bricks', [hud.left.tex, hud.leftText, hud.right.tex, hud.rightText], [2, '4/11', 7, '2/11']);
    vars.set(0x58, 9); vars.set(0x52, 3); vars.set(0xa5, 2); vars.set(0x8e, 5);
    hud.initIsland(vars); hud.updateIsland(vars);   // FUN_004b8ef0 runs once per island start (the era is fixed per zone run)
    eq('from node 7: bot heads, pages, coloured head icons', [hud.left.tex, hud.leftText, hud.right.tex, hud.rightText, hud.column.slice(1).map((x) => x.tint === 0xffffffff)], [0, '3', 1, '2/4', [true, false, true, false]]);
    vars.set(0x58, 0x3d); hud.initIsland(vars); hud.updateIsland(vars);
    eq('no counters from node 0x3d', [hud.left.tex, hud.leftText], [-1, '']);

    // ---- stub zones: loop config per zone kind, exit -> next zone
    const zones = readZoneTable(pe), nodes = readStoryFsm(pe);
    const zone = (id) => zones.find((z) => z.id === id);
    eq('hub config: island pause page 5', [configFor(zone('z90PSX')).hub, PAUSE_PAGE[configFor(zone('z90PSX')).pauseKind]], [true, 5]);
    eq('mini-game config: page 18 mask 0x40', [configFor(zone('z05WAB')).pauseMask, PAUSE_PAGE[configFor(zone('z05WAB')).pauseKind]], [0x40, 18]);
    eq('room config: page 29', PAUSE_PAGE[configFor(zone('z03PPH')).pauseKind], 29);
    const sh = (v) => { const story = new StoryFsm(v, nodes, zones); return { vars: v, story }; };
    const v = new GameVars(); v.a.set(readInitialVars(pe));
    v.set(0x58, 9); v.set(0x59, 5); const s1 = sh(v);   // WAB is the story's zone at node 10; sub-game 5
    s1.story.jump(10); v.set(0x59, 5);
    eq('mini-game finished -> story advances, next zone = node 11 zone (island era 1)', nextAfterExit(s1, zone('z05WAB'), configFor(zone('z05WAB')), EXIT.FINISHED), 31);
    eq('restart stays in the zone', nextAfterExit(s1, zone('z05WAB'), configFor(zone('z05WAB')), EXIT.RESTART), 5);
    eq('quit -> front end', nextAfterExit(s1, zone('z05WAB'), configFor(zone('z05WAB')), EXIT.QUIT), -1);
    const v2 = new GameVars(); v2.a.set(readInitialVars(pe)); const s2 = sh(v2);
    s2.story.jump(10); v2.set(0x59, 5);
    eq('mini-game abandoned -> back to the last hub', nextAfterExit(s2, zone('z05WAB'), configFor(zone('z05WAB')), EXIT.ABANDON), 31);
    eq('node rewound to a hub node', s2.story.node < 10 && zones[nodes[s2.story.node].zone].kind === 1, true);
    const v3 = new GameVars(); v3.a.set(readInitialVars(pe)); const s3 = sh(v3);
    v3.set(5, 3);
    eq('hub: var 5 leaves for that zone', nextAfterExit(s3, zone('z90PSX'), configFor(zone('z90PSX')), EXIT.VAR5), 3);
    return { checked, failures };
  },
};
