import { GameVars, V, PC } from '../../src/game/vars.ts';
import { Controller, updatePass, prerenderPass, drawPass, registerNode, createNode, registeredNodes, NODE_NONE, NODE_STOP, NODE_CONTINUE, NODE_RERUN } from '../../src/game/controller.ts';
import { World } from '../../src/game/world.ts';
import { GameRecord, RF_ENABLED } from '../../src/game/record.ts';
import { loadExe } from '../lib/engine-load.mjs';

// Game variables (names from the EXE), behaviour-node gating and the three passes of the object framework.
export default {
  name: 'engine-framework',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    // --- game variables
    const v = new GameVars(); v.loadNames(pe);
    ok(v.names.length === 319, `${v.names.length} variable names`);
    ok(v.nameOf(0x5e) === 'SWITCH_GME_PEPPER_CONTROL', `var 0x5e is ${v.nameOf(0x5e)}`);
    ok(v.nameOf(0x58) === 'SWITCH_GME_FSM_CURRENT_STATE' && v.nameOf(0x59) === 'SWITCH_GME_CURRENT_SUBGAME', `vars 0x58 / 0x59: ${v.nameOf(0x58)} / ${v.nameOf(0x59)}`);
    ok(v.nameOf(2) === 'SWITCH_NS_ON' && v.nameOf(1) === 'SWITCH_NS_OFF' && v.nameOf(5) === 'SWITCH_NS_NEXT_SUBGAME', 'NS variables');
    ok(v.nameOf(V.PEPPERSSHADOW) === 'SWITCH_GME_PEPPERSSHADOW', `var 0xc5 is ${v.nameOf(V.PEPPERSSHADOW)}`);
    ok(v.indexOf('PEPPER_CONTROL') === 0x5e, 'indexOf by short name');
    ok(v.get(1) === 0 && v.get(2) === 1, 'NS_OFF reads 0, NS_ON reads 1');
    v.set(1, 5); v.set(2, 0); ok(v.get(1) === 0 && v.get(2) === 1, 'vars 1 and 2 are read-only');
    v.set(0x5e, 1); v.or(0x5e, 0x1000); ok(v.get(0x5e) === 0x1001, 'or'); v.andNot(0x5e, 1); ok(v.get(0x5e) === 0x1000, 'and-not'); v.add(0x5e, 2); ok(v.get(0x5e) === 0x1002, 'add');
    ok(v.gate(0x5e, 0, 0) && v.gate(2, 1, 1) && !v.gate(0x5e, 1, 1) && v.gate(0x5e, 2, 2), 'gate: (var & mask) == value, mask 0 / value 0 = always, NS_ON with 1/1 = always on');
    // --- the three passes with gating and return codes
    const w = new World();
    const log = [];
    const mk = (name, ret, gate = [2, 0, 0]) => ({
      kind: name, var: gate[0], mask: gate[1], value: gate[2], stamp: 0xfffffffe,
      update() { log.push(`u:${name}`); return typeof ret === 'function' ? ret() : ret; },
      prerender() { log.push(`p:${name}`); },
      draw() { log.push(`d:${name}`); return name === 'stop' ? NODE_STOP : 2; },
    });
    const rec = (n) => { const r = new GameRecord(n); r.ctrl = new Controller(); w.records.push(r); return r; };
    const a = rec('AAAA'), b = rec('BBBB'), c = new GameRecord('CCCC'); w.records.push(c);
    a.ctrl.attach(mk('a1', NODE_CONTINUE), 0);
    a.ctrl.attach(mk('a2', NODE_STOP), 1);
    a.ctrl.attach(mk('a3', NODE_CONTINUE), 2);          // never reached: a2 stops the chain
    b.ctrl.attach(mk('b1', NODE_NONE), 0);              // did not run: no pre-render / draw
    b.ctrl.attach(mk('b2', NODE_CONTINUE, [0x5e, 1, 1]), 1);   // gated on PEPPER_CONTROL & 1
    b.ctrl.attach(mk('stop', NODE_CONTINUE, [2, 1, 1]), 2);
    w.vars.set(0x5e, 0);
    updatePass(w);
    ok(log.join() === 'u:a1,u:a2,u:b1,u:stop', `update order / gating / stop: ${log.join()}`);
    log.length = 0; const f0 = w.frame;
    prerenderPass(w);
    ok(log.join() === 'p:a1,p:a2,p:stop', `pre-render only for nodes that ran: ${log.join()}`);
    ok(w.frame === f0 + 1 && a.ctrl.nodes[0].stamp === f0 + 1, 'frame counter advances, node stamps = frame + 1');
    log.length = 0;
    const fallback = [];
    drawPass(w, (r) => fallback.push(r.name));
    ok(log.join() === 'd:a1,d:a2,d:stop', `draw hooks of the nodes that ran: ${log.join()}`);
    ok(fallback.join() === 'CCCC', `default draw only for the record without a handled draw: ${fallback.join()}`);
    // gating changes with the variable
    log.length = 0; w.vars.set(0x5e, 1); updatePass(w);
    ok(log.includes('u:b2') && log.includes('u:stop'), `gated node runs once the var matches: ${log.join()}`);
    // frozen: nothing runs
    log.length = 0; w.frozen = true; updatePass(w); ok(log.length === 0, 'frozen update pass'); w.frozen = false;
    // disabled controller (flag 2 clear)
    a.ctrl.flags &= ~2; log.length = 0; updatePass(w); ok(!log.includes('u:a1'), 'controller flag 2 off: the record is skipped');
    // return code 3 runs the exclusive node's update again after the chain (the exclusive node is set by node code; the original never sets it in the traced code)
    {
      const r2 = rec('DDDD'); let runs = 0;
      const ex = mk('ex', () => { runs++; return NODE_CONTINUE; }, [2, 1, 1]);
      r2.ctrl.attach(mk('d1', NODE_RERUN), 0); r2.ctrl.attach(ex, 1);
      r2.ctrl.exclusive = ex;
      log.length = 0; runs = 0; updatePass(w);
      ok(log.filter((l) => l === 'u:ex').length === 1 && runs === 1, `exclusive node runs once as the current exclusive node (${log.join()})`);
    }
    // attach positions: 0 resets, n inserts, long positions append
    const ctl = new Controller(); const n1 = mk('n1', 0), n2 = mk('n2', 0), n3 = mk('n3', 0), n4 = mk('n4', 0);
    ctl.attach(n1, 0); ctl.attach(n2, 1); ctl.attach(n3, 1); ctl.attach(n4, 9);
    ok(ctl.nodes.map((n) => n.kind).join() === 'n1,n3,n2,n4', `attach positions: ${ctl.nodes.map((n) => n.kind)}`);
    ctl.attach(n2, 0); ok(ctl.nodes.length === 1, 'attach at 0 resets the list');
    // registry
    registerNode('TestNode', () => mk('reg', 0));
    ok(registeredNodes().includes('TestNode') && createNode('TestNode').kind === 'reg', 'registry');
    let threw = false; try { createNode('Nope'); } catch { threw = true; } ok(threw, 'unknown node throws');
    // fixed step: the world's dt is always one 30 Hz tick
    ok(w.dt === 1, 'dt = 1.0 per tick');
    ok(PC.WALK === 1 && PC.SWIM === 2 && (RF_ENABLED & 2) === 2, 'constants');
    notes.push(`registered nodes: ${registeredNodes().join(', ')}`);
    return { checked, failures, notes };
  },
};
