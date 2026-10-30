// M5 z23DIP node tests (no oracle): the zone module's structure on the loaded worlds of story nodes 47 and 50 (record table, Pepper's chain, set-up leftovers, node ports).
import { loadHub, tick } from '../lib/hub-load.mjs';
import '../../src/zones/index.ts';
import { dipAfterSetup } from '../../src/zones/z23DIP/index.ts';
import { REC, REC_NAMES, CTOR, LOON } from '../../src/zones/z23DIP/consts.ts';
import { animTimes, HIDDEN_LIST_VA } from '../../src/zones/z23DIP/setup.ts';
import { registeredCtors } from '../../src/game/setup.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';

export default {
  name: 'm5-z23DIP',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    for (const node of [47, 50]) {
      const H = loadHub(ctx, { zone: 'z23DIP', node });
      for (const rec of H.world.records) for (const n of rec.ctrl?.nodes ?? []) n.ctorInit?.(H.world, rec);
      dipAfterSetup({ ictx: H.ictx, world: H.world, loaded: H.L, archive: H.archive });
      const w = H.world, R = w.records;
      for (const [i, n] of Object.entries(REC_NAMES)) ok(R[+i]?.name === n, `node ${node}: record ${i} is ${n} (${R[+i]?.name})`);
      ok(R.length === 270, `node ${node}: 270 records`);
      ok(registeredCtors().includes(CTOR.PEPPSW) && registeredCtors().includes(CTOR.LOON) && !registeredCtors().includes(CTOR.DEAD), 'constructors registered (the third class is dead: never attached)');
      ok(H.pepper.ctrl.nodes.map((n) => n.kind).join() === 'PeppSw,SGwalk,sgswim,skate', `node ${node}: Pepper's chain ${H.pepper.ctrl.nodes.map((n) => n.kind)}`);
      ok(vehicles(w).board === REC.SKBD, 'DAT_009daa7c = 0x1c');
      ok(H.L.skipped.length === 0, `node ${node}: no constructor skipped (the sky is the scene node of src/island/ambient/seabed.ts) (${JSON.stringify(H.L.skipped)})`);
      // FUN_007651a3 / FUN_00420837(4)
      ok(R.filter((r) => r.variant).length === 22, `node ${node}: 22 decor records carry a variant word (${R.filter((r) => r.variant).length})`);
      let hidden = 0;
      for (let va = HIDDEN_LIST_VA; (H.pe.u32(va) | 0) !== -1; va += 4) if (R[H.pe.u32(va)].flags === 0) hidden++;
      ok(hidden === 16, `node ${node}: the 16 decor templates are hidden (flags 0): ${hidden}`);
      ok(R[REC.TREX ?? 8].variant === 0 && R[13].variant === ((9 << 8) | 1 | (36 << 16)), 'JOHN: variant word set 9, variant 36');
      // animation times
      const at = animTimes(H.emu);
      if (node === 50) {
        ok(at.map((a) => `${R[a.record].name}=${a.time}`).join() === 'REX2=7,REX3=2,REX4=5,REX5=10,REX6=12,REX7=9', `node 50: animTime calls ${at.map((a) => R[a.record].name + '=' + a.time)}`);
        for (const a of at) ok(R[a.record].anim.frame === a.time, `node 50: ${R[a.record].name} posed at frame ${a.time}`);
        const loon = R[REC.LOON];
        ok(Math.abs(loon.y - Math.fround(17.600000381469727)) < 1e-4 && (loon.flags & 2) !== 0 && loon.ctrl.nodes[0].kind === 'PeppSw.loon', 'node 50: the balloon lifted by 17.6, visible, node attached');
        ok(LOON.TOP === 56, 'balloon constants');
      } else ok(at.length === 0 && R[REC.LOON].ctrl === null, 'node 47: no animTime calls, no balloon node');
      // 120 ticks run
      tick(H, 120);
      ok([H.pepper.x, H.pepper.y, H.pepper.z].every(Number.isFinite), `node ${node}: 120 ticks`);
    }
    return { checked, failures, notes };
  },
};
