// M5 / z40OGL PeppSwit nodes in the hub world (the real chain: SGwalk, skate and the PeppSwit nodes together; the node-by-node proof against the original is m5-z40OGL-peppswit-emu).
import { loadOgl } from '../lib/m5-ogl-load.mjs';
import { tick, hold, press } from '../lib/hub-load.mjs';
import { registeredCtors } from '../../src/game/setup.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { CTOR_OGL, oglGlobals } from '../../src/zones/z40OGL/peppswit/globals.ts';
import { OglPepSwit, OglVoidFall } from '../../src/zones/z40OGL/peppswit/pepper.ts';
import { SlugNode } from '../../src/zones/z40OGL/peppswit/slug.ts';
import { RobotNode } from '../../src/zones/z40OGL/peppswit/robot.ts';
import { CitizenNode } from '../../src/zones/z40OGL/peppswit/citizen.ts';

export default {
  name: 'm5-z40OGL-peppswit',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const kinds = (H) => { const k = {}; for (const r of H.world.records) for (const n of r.ctrl?.nodes ?? []) k[n.kind] = (k[n.kind] ?? 0) + 1; return k; };
    for (const a of Object.values(CTOR_OGL)) ok(registeredCtors().includes(a), `ctor 0x${a.toString(16)} registered`);

    for (const node of [64, 66]) {
      const H = loadOgl(ctx, { node });
      const k = kinds(H), W = H.world, P = H.pepper;
      ok(k.PeppSwit === 1 && k.PeppVoid === 1 && k.PeppSlug === 8 && k.PeppRobot === 5 && k.PeppStar === 1 && k.PeppHolo === 1, `node ${node}: attach counts ${JSON.stringify(k)}`);
      ok((k.PeppCitizen ?? 0) === (node === 64 ? 5 : 0), `node ${node}: citizens ${k.PeppCitizen ?? 0}`);
      ok(P.ctrl.nodes.filter((n) => n.kind !== 'StubGuard').map((n) => n.kind).join() === 'PeppSwit,SGwalk,skate,PeppVoid', `node ${node}: Pepper's chain ${P.ctrl.nodes.map((n) => n.kind)}`);
      ok(oglGlobals(W).part === (node === 64 ? 1 : 2), `node ${node}: DAT_05d5f3bc = ${oglGlobals(W).part}`);
      tick(H, 3);
      ok(W.records[104].flags % 4 < 2 && vehicles(W).board === 0x1d, 'constructor effects: decor templates hidden, board = SKBD');
      ok(W.records[3].variant === 0x20b01 && W.records[75].variant === 0x100a01, `outfit / crystal variant words ${W.records[3].variant.toString(16)} ${W.records[75].variant.toString(16)}`);
      ok(H.log.some((l) => l.startsWith('p2 #806')), 'the ambience plays');
      ok(H.log.some((l) => l.startsWith('mode 104 255 1')), 'constructor render mode 1 on the decor templates');

      // Ctrl on the ground: the skateboard (mode 4, clip 0x16, board shown, sound 0x150), Ctrl again: off (0x1c, sound 0x106)
      W.vars.set(0x5e, 1); tick(H, 2); H.log.length = 0;
      P.anim.start(0, 0); W.pep.mailbox = 0;
      press(H, 'ControlLeft');
      ok((W.vars.get(0x5e) & 0xfff) === 4, `Ctrl: skateboard mode (${W.vars.get(0x5e).toString(16)})`);
      ok(H.log.includes('p2 #336'), 'board-on sound 0x150');
      tick(H, 5);
      press(H, 'ControlLeft', 2);
      ok((W.vars.get(0x5e) & 0xfff) === 1, `Ctrl again: walking (${W.vars.get(0x5e).toString(16)})`);
      ok(H.log.includes('p2 #262'), 'board-off sound 0x106');
    }

    // the void: below the sea level Pepper is put 160 above PATH node 0x3e and falls to it, then walks again; the skate reset flag is set
    {
      const H = loadOgl(ctx, { node: 64 }), W = H.world, P = H.pepper;
      W.vars.set(0x5e, 1); tick(H, 2);
      P.ctrl.nodes = P.ctrl.nodes.filter((n) => n.kind === 'PeppSwit' || n.kind === 'PeppVoid');     // (the walk node clamps the height to the sea level over ground-less terrain)
      P.y = -150; tick(H, 1);
      ok((W.vars.get(0x5e) & 0xfff) === 0x20, `void mode (${W.vars.get(0x5e).toString(16)})`);
      ok(vehicles(W).skateReset === 1, 'DAT_05d58009 set');
      tick(H, 1);
      ok(P.y > -90 && Number.isFinite(P.x), `put above the respawn node (${P.x.toFixed(1)} ${P.y.toFixed(1)} ${P.z.toFixed(1)})`);
      let n = 0; while ((W.vars.get(0x5e) & 0xfff) === 0x20 && n++ < 600) tick(H, 1);
      ok((W.vars.get(0x5e) & 0xfff) === 1 && n < 600, `landed after ${n} ticks, walking again`);
      ok(H.log.includes('p2 #618'), 'fall sound 618 played');
    }

    // a slug bites: Pepper next to SLG1 -> mailbox 1, both bite sounds
    {
      const H = loadOgl(ctx, { node: 64 }), W = H.world, P = H.pepper, s = W.records[22];
      tick(H, 2);
      P.x = s.x + 1.5; P.y = s.y; P.z = s.z; H.log.length = 0;
      let bit = false;
      for (let i = 0; i < 200 && !bit; i++) { tick(H, 1); bit = s.ctrl.nodes.find((n) => n instanceof SlugNode).state === 2; }
      ok(bit, 'a slug next to Pepper bites (state 2)');
      ok(H.log.includes('p2 #616') && H.log.includes('p2 #617'), 'both bite sounds');
    }

    // saved state round trips
    {
      const H = loadOgl(ctx, { node: 64 }), W = H.world;
      tick(H, 5);
      const ps = W.records[2].ctrl.nodes.find((n) => n instanceof OglPepSwit), sl = W.records[21].ctrl.nodes.find((n) => n instanceof SlugNode), ro = W.records[16].ctrl.nodes.find((n) => n instanceof RobotNode), ci = W.records[6].ctrl.nodes.find((n) => n instanceof CitizenNode);
      ok(ps instanceof OglPepSwit && W.records[2].ctrl.nodes.some((n) => n instanceof OglVoidFall), 'PEPPSWIT / void classes');
      const b1 = sl.saveBlock(); sl.state = 0; sl.loadBlock(W, W.records[21], W.records[21].ctrl, b1); ok(sl.saveBlock().join() === b1.join(), 'slug blob');
      ok(ro.saveBlock().length === 1 && ci.saveBlock().length === 12 && ps.saveBlock(W).length === 16, 'blob sizes (1 / 12 / 16 bytes)');
    }
    return { checked, failures, notes };
  },
};
