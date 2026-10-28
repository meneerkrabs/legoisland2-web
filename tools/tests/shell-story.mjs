// Story FSM + zone loop glue (FUN_00404aa0 / be7 / bb2 / b43 / af6 / c07 / FUN_00423bad / FUN_00404d14 / FUN_00404dc9 / FUN_0041786a / FUN_004b6475).
import fs from 'node:fs';
import path from 'node:path';
import { Pe } from '../../src/formats/exe.ts';
import { GameVars, V } from '../../src/game/vars.ts';
import { readZoneTable, readStoryFsm, readInitialVars } from '../../src/shell/tables.ts';
import { StoryFsm, ZoneLoopState, eraOfNode, GV, SW_FIRST, SW_COUNT } from '../../src/shell/story.ts';

export default {
  name: 'shell-story',
  run(ctx) {
    const failures = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
    if (!fs.existsSync(exePath)) return { checked: 0, failures: [`missing ${exePath}`] };
    const pe = new Pe(new Uint8Array(fs.readFileSync(exePath)));
    const zones = readZoneTable(pe), nodes = readStoryFsm(pe), init = readInitialVars(pe);
    const fresh = () => {
      const vars = new GameVars(); vars.a.set(init);
      const story = new StoryFsm(vars, nodes, zones), loop = new ZoneLoopState(story);
      return { vars, story, loop };
    };

    // -- era mapping (FUN_004b6475)
    ok(eraOfNode(0) === 0 && eraOfNode(6) === 0 && eraOfNode(7) === 1 && eraOfNode(0x1d) === 1 && eraOfNode(0x1e) === 2 && eraOfNode(0x33) === 2 && eraOfNode(0x34) === 3 && eraOfNode(0x3c) === 3 && eraOfNode(0x3d) === 4 && eraOfNode(71) === 4, 'era mapping');
    // the four island ids of the nodes agree with the era mapping
    for (let n = 2; n < 72; n++) {
      const z = nodes[n].zone;
      if ([2, 31, 32, 33].includes(z)) { const era = eraOfNode(n); ok(z === [2, 31, 32, 33][Math.min(era, 3)] || (era === 4 && z === 2), `island node ${n} zone ${z} era ${era}`); }
    }

    // -- start-up: sw.dat defaults, first zone
    {
      const { vars, story, loop } = fresh();
      const z = loop.begin();
      ok(z === 0 && vars.get(V.CURRENT_SUBGAME) === 0 && story.node === 0, 'start: node 0, zone 0 (front end)');
      ok(vars.get(GV.NUM_BRICKS) === 11 && vars.get(GV.NUM_PIZZAS) === 11 && vars.get(GV.MOVE_CNST) === 1 && vars.get(GV.MOVE_PIZ3) === 0 && vars.get(GV.PEPPHOUSE_SIZE) === 0 && vars.get(GV.PAGES_SET) === 0, 'start: bricks/pizzas 11 etc.');
      ok(vars.get(V.NS_NEXT_SUBGAME) === 0 && vars.get(V.PIZZAS_THROWN) === 0 && vars.get(GV.COMPLETE_SUB_GAME) === 0, 'start: var 5 = zone');
      ok(vars.get(0) === 1 && vars.get(2) === 1 && vars.get(1) === 0 && vars.get(9) === 1, 'start: CS_TEXT_ON, NS_ON, CS_SPEECH_ON');
      // node 0 completes immediately (NS_ON == 1): FUN_00423bad would advance (never called in the front end)
      ok(story.complete(), 'node 0 (NS_ON == 1) is complete');
    }

    // -- the whole story forward
    {
      const { vars, story, loop } = fresh();
      loop.begin();
      loop.newGame();
      let z = loop.afterZone(vars.get(V.NS_NEXT_SUBGAME)); // the front end returns var 5 = 2
      ok(z === 2 && story.node === 2 && vars.get(V.CURRENT_SUBGAME) === 2, `new game -> zone ${z} node ${story.node}`);
      ok(loop.loadDone() === 2 && loop.loadDone() === 0, 'loadDone returns the pending kind once (2 = new game)');
      const visited = [];
      for (let n = 2; n < 68; n++) {
        if (story.node !== n) { failures.push(`walk: expected node ${n}, at ${story.node}`); break; }
        const nd = nodes[n], zn = nd.zone;
        ok(vars.get(V.CURRENT_SUBGAME) === zn, `node ${n}: current subgame ${vars.get(V.CURRENT_SUBGAME)} != zone ${zn}`);
        // (node 56 is already complete on entry: COLORED_BOTHEADS stays 15 from node 8; the original advances on the next frame)
        vars.set(nd.var, nd.value);
        ok(story.complete(), `node ${n} complete after setting var ${nd.var}`);
        const nextZone = nodes[n + 1].zone;
        if (zones[zn].kind !== 1 && nd.var === GV.COMPLETE_SUB_GAME) {
          // mini-game exit with success
          vars.set(GV.COMPLETE_SUB_GAME, 0);
          const r = story.miniGameExit(true, true);
          ok(r === nextZone && story.node === n + 1 && vars.get(GV.COMPLETE_SUB_GAME) === 1, `mini-game node ${n} exit -> ${r}, node ${story.node}`);
          z = loop.afterZone(r);
        } else {
          const f = story.frame();
          ok(story.node === n + 1, `node ${n}: frame() advanced to ${story.node}`);
          ok(f === (nextZone !== zn ? 6 : 1), `node ${n}: frame() returned ${f}, zone ${zn} -> ${nextZone}`);
          // frame() does not advance twice when the next node is not complete either
          if (f === 6) z = loop.afterZone(story.zoneOf());
        }
        visited.push(story.zoneOf());
      }
      ok(story.node === 68 && story.zoneOf() === 2, 'story ends in node 68 (island free roam)');
      ok(!story.complete(), 'node 68 (NS_OFF == 1) never completes');
      const before = story.node; ok(story.frame() === 1 && story.node === before, 'frame() in node 68 does nothing');
    }

    // -- FUN_00423bad only reacts when the current subgame is the node's zone
    {
      const { vars, story } = fresh();
      story.vars.set(V.FSM_CURRENT_STATE, 3);
      vars.set(GV.NUM_BRICKS, 0);
      vars.set(V.CURRENT_SUBGAME, 5); // another zone is running
      ok(story.frame() === 1 && story.node === 3, 'frame(): wrong zone -> no advance');
      vars.set(V.CURRENT_SUBGAME, 2);
      ok(story.frame() === 1 && story.node === 4, 'frame(): advance inside the island returns 1');
      ok(story.snap[4] === vars.get(303), 'advance snapshots the var of the new node');
    }

    // -- mini-game failure rewinds to the last hub (kind 1) and restores the snapshot
    {
      const { vars, story, loop } = fresh();
      loop.begin();
      story.jump(9);
      ok(story.node === 9 && vars.get(V.NS_NEXT_SUBGAME) === 31, 'jump(9): node, var 5 = zone 31');
      vars.set(V.CURRENT_SUBGAME, 31); vars.set(V.NS_NEXT_SUBGAME, 5);
      ok(story.frame() === 6 && story.node === 10 && story.zoneOf() === 5, 'WAB door: frame() -> 6, node 10, zone 5');
      vars.set(V.CURRENT_SUBGAME, 5);
      const snap9 = story.snap[9];
      vars.set(V.NS_NEXT_SUBGAME, 77);
      let r = story.miniGameExit(false, false);
      ok(r === 31 && story.node === 9 && vars.get(V.NS_NEXT_SUBGAME) === snap9, `abort: back to hub zone ${r}, node ${story.node}, var 5 restored to ${snap9}`);
      // completed but not successful also rewinds
      story.vars.set(V.FSM_CURRENT_STATE, 10); vars.set(V.CURRENT_SUBGAME, 5);
      ok(story.miniGameExit(true, false) === 31 && story.node === 9, 'completed && !success rewinds');
      // success
      story.vars.set(V.FSM_CURRENT_STATE, 10); vars.set(V.CURRENT_SUBGAME, 5); vars.set(GV.COMPLETE_SUB_GAME, 0);
      r = story.miniGameExit(true, true);
      ok(r === 31 && story.node === 11 && vars.get(GV.COMPLETE_SUB_GAME) === 1, 'success advances to node 11 (zone 31)');
      // replay from a menu: current subgame != node zone -> PREV_SUBGAME
      story.vars.set(V.FSM_CURRENT_STATE, 40); vars.set(V.CURRENT_SUBGAME, 5); vars.set(V.PREV_SUBGAME, 13);
      ok(story.miniGameExit(true, true) === 13 && story.node === 40, 'replay: next = PREV_SUBGAME, FSM untouched');
      // rewind skips non-hub zones: node 63 (APO kind 0) <- 62 ASB (kind 2) <- 61 island
      story.vars.set(V.FSM_CURRENT_STATE, 63); vars.set(V.CURRENT_SUBGAME, 30);
      ok(story.miniGameExit(false, false) === 2 && story.node === 61, `rewind from 63 lands on node ${story.node}`);
      // rewind from 18 (BKD) -> 17 (castle hub)
      story.vars.set(V.FSM_CURRENT_STATE, 18); vars.set(V.CURRENT_SUBGAME, 7);
      ok(story.miniGameExit(false, false) === 6 && story.node === 17, 'rewind from BKD to the castle');
    }

    // -- stepBack / jump
    {
      const { vars, story } = fresh();
      story.vars.set(V.FSM_CURRENT_STATE, 5);
      story.snap[4] = 1234;
      story.stepBack();
      ok(story.node === 4 && vars.get(303) === 1234, 'stepBack restores the var of the previous node');
      const f = fresh();
      f.story.jump(10);
      ok(f.vars.get(79) === 0 && f.vars.get(81) === 1 && f.vars.get(165) === 4 && f.vars.get(142) === 15, 'forward jump forces GME vars to the node values');
      ok(f.vars.get(277) === 0 && f.vars.get(303) === 0 && f.vars.get(5) === 5, 'forward jump leaves zone-local vars alone, var 5 = zone of the target');
      ok(f.story.snap[3] === 0 && f.story.snap[6] === 1 && f.story.snap[7] === 4 && f.story.snap[8] === 15, 'forward jump snapshots the forced values');
      f.vars.set(81, 0);
      f.story.jump(6); // backward: restores snapshots of nodes 9..6
      ok(f.story.node === 6 && f.vars.get(81) === 1 && f.vars.get(165) === 4 && f.vars.get(5) === 2, 'backward jump restores snapshots');
      // mask test: node 30 forces NUM_PAGES to its value 2
      const g = fresh(); g.story.jump(32);
      ok(g.vars.get(165) === 2, 'forward jump forces the full s16 value of a masked node');
    }

    // -- zone loop glue
    {
      const { vars, story, loop } = fresh();
      loop.begin();
      story.vars.set(V.FSM_CURRENT_STATE, 9); vars.set(V.CURRENT_SUBGAME, 31); loop.zone = 31;
      vars.a[250] = 7; vars.a[318] = 9; vars.set(V.PIZZAS_THROWN, 7); vars.set(GV.COMPLETE_SUB_GAME, 1);
      let n = loop.afterZone(5);
      ok(n === 5 && vars.get(V.PREV_SUBGAME) === 31 && vars.get(V.CURRENT_SUBGAME) === 5 && vars.get(V.NS_NEXT_SUBGAME) === 5, 'afterZone: var 0xa3, 0x59, 5');
      ok(vars.a[250] === 0 && vars.a[318] === 0 && vars.get(V.PIZZAS_THROWN) === 0 && vars.get(GV.COMPLETE_SUB_GAME) === 0, 'zone start clears vars 0xfa..0x13e, 0x63 and 0x53');
      vars.a[0x13e] = 5; vars.a[0x13f - 1] = 5;
      n = loop.afterZone(31); ok(vars.a[0x13e] === 0 && vars.a[0xfa] === 0, 'var 0x13e is the last cleared var');
      // -1 = front end: node 0
      n = loop.afterZone(-1);
      ok(n === 0 && story.node === 0 && vars.get(V.PREV_SUBGAME) === 31, 'return -1 -> zone 0, node 0');
      // <= -2 quits, var 0x59 gets the negative number
      n = loop.afterZone(-2);
      ok(n < 0 && vars.get(V.CURRENT_SUBGAME) === -2, 'return -2 leaves the program');
      // pending load override beats the return value (even a quit), applies the node, and is cleared by loadDone
      const l = fresh(); l.loop.begin(); l.story.vars.set(V.FSM_CURRENT_STATE, 3); l.vars.set(V.CURRENT_SUBGAME, 2); l.loop.zone = 2;
      ok(l.loop.beginLoad(2, 3) === 1 && l.loop.pending.kind === 0, 'beginLoad: same node and zone restores in place');
      ok(l.loop.beginLoad(7, 18) === 2 && l.loop.pending.kind === 1, 'beginLoad: other node leaves the zone');
      n = l.loop.afterZone(-2);
      ok(n === 7 && l.story.node === 18 && l.vars.get(V.CURRENT_SUBGAME) === 7, 'override: zone 7, node 18');
      ok(l.loop.loadDone() === 1 && l.loop.pending.kind === 0, 'loadDone returns 1 (apply the save) and clears');
      // zones without code (22, 23): the FSM advances and the next node's zone runs
      const e = fresh(); e.loop.begin(); e.story.vars.set(V.FSM_CURRENT_STATE, 3); e.loop.zone = 2;
      n = e.loop.afterZone(22);
      ok(n === 2 && e.story.node === 4 && e.vars.get(V.PREV_SUBGAME) === 22, 'empty zone: FSM advanced, next zone runs');
      // new game: vars back to the snapshot, 6 overrides, var 5 = 2, pending node 2 zone 2
      const g = fresh(); g.loop.begin();
      for (let i = 15; i < 235; i++) g.vars.a[i] = i * 3;
      g.vars.a[235] = 77; g.vars.a[250] = 66; g.vars.set(5, 9);
      g.loop.newGame();
      let same = true;
      for (let i = 0; i < SW_COUNT; i++) { const v = g.vars.a[SW_FIRST + i], want = (SW_FIRST + i === 0x4f || SW_FIRST + i === 0xb0) ? 11 : (SW_FIRST + i === 0xb5 ? 1 : (SW_FIRST + i === 0xb3 || SW_FIRST + i === 0xb4 || SW_FIRST + i === 0x26) ? 0 : init[SW_FIRST + i]); if (v !== want) same = false; }
      ok(same, 'new game: vars 15..234 = launch snapshot + bricks/pizzas 11, house 0, MOVE_CNST 1');
      ok(g.vars.a[235] === 77 && g.vars.a[250] === 66 && g.vars.get(5) === 2, 'new game leaves vars >= 235 alone, var 5 = 2');
      ok(g.loop.pending.kind === 2 && g.loop.afterZone(0) === 2 && g.story.node === 2, 'new game override -> node 2 zone 2 even if the front end returned 0');
    }

    return { checked, failures };
  },
};
