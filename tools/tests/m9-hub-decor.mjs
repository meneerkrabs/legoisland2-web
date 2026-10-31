// WP-SHELL-FINAL (gaps S2 in the hubs): the type-1 outfit / decor swap (FUN_00420bb7 / FUN_00420dc4) on the Oasis, the Pyramid and the Dino island: Enter next to a record whose variant word is of type 1
// starts the swap, the variant advances after 15 ticks (the middle of the 30 tick pop animation), the stored decor (`decorStore`, what a save writes) follows; the stored decor is applied at the zone start
// (FUN_00421bbe(group)). The swap machinery itself is compared to the original in `m4-decor` (it is generic in the decor group).
import { loadHub, tick, press } from '../lib/hub-load.mjs';
import '../../src/zones/index.ts';
import { constructRoster } from '../../src/zones/z14OSD/looks.ts';
import { applyPyaSetup } from '../../src/zones/z16PYA/index.ts';
import { dipAfterSetup } from '../../src/zones/z23DIP/index.ts';
import { decorStore, DecorState } from '../../src/island/decor.ts';
import { decorOf } from '../../src/island/vehicles/looks.ts';
import { readDecorTables, decorGroupOfZone } from '../../src/shell/tables.ts';

export default {
  name: 'm9-hub-decor',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    for (const [zone, node, zoneIndex] of [['z14OSD', 34, 0xb], ['z16PYA', 36, 0xd], ['z23DIP', 47, 0x13]]) {
      const H = loadHub(ctx, { zone, node });
      const w = H.world, pe = H.pe;
      for (const rec of w.records) for (const n of rec.ctrl?.nodes ?? []) n.ctorInit?.(w, rec);
      H.ictx.fx = null; H.ictx.musicGroove = () => {};
      if (zone === 'z14OSD') { constructRoster(w, pe, (fn) => H.ictx.setup.run(fn, [])) }
      else if (zone === 'z16PYA') applyPyaSetup(H.ictx, w, H.L);
      else dipAfterSetup({ ictx: H.ictx, world: w, loaded: H.L, archive: H.archive });
      decorStore.ensureDefaults(pe);
      const t = readDecorTables(pe), g = t.groups[decorGroupOfZone(zoneIndex)];
      tick(H, 2);
      const st = decorOf(w);
      ok(st instanceof DecorState, `${zone}: the zone has a DecorState after two ticks`);
      if (!st) continue;
      // a type-1 record of the zone's group whose set has more than one variant
      let pick = -1;
      for (let i = g.first; i < g.first + g.count; i++) { const r = w.records[t.entries[i].record]; if (r && (r.variant & 0xff) === 1 && st.counts[(r.variant >>> 8) & 0xff] > 1) { pick = i; break; } }
      ok(pick >= 0, `${zone}: a swappable decor entry exists`);
      if (pick < 0) continue;
      const rec = w.records[t.entries[pick].record];
      const before = rec.variant >>> 0;
      H.pepper.x = rec.x; H.pepper.y = rec.y; H.pepper.z = rec.z + 2;
      press(H, 'Enter', 2);
      tick(H, 40);
      const after = rec.variant >>> 0;
      ok(after !== before && (after & 0xff) === 1 && ((after >>> 8) & 0xff) === ((before >>> 8) & 0xff), `${zone}: ${rec.name} variant ${before.toString(16)} -> ${after.toString(16)}`);
      ok(decorStore.mem[pick * 2] === ((after >>> 8) & 0xff) && decorStore.mem[pick * 2 + 1] === ((after >>> 16) & 0xff), `${zone}: the stored decor follows the swap`);
      notes.push(`${zone}: ${rec.name} ${before.toString(16)} -> ${after.toString(16)}`);
    }
    return { checked, failures, notes };
  },
};
