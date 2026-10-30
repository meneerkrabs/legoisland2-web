// WP-SAVE (Pepper's chain: SGwalk 0x42f470, sgswim 0x88cf13, SwimSplash 0x88d1f6, island PepSwitc 0x4bbef8, SGVehic 0x4333c2, skateboard 0x43310c) in every zone that has them: the five island eras and
// the hubs z07CSI z14OSD z16PYA z23DIP z40OGL (z13CAI has SGVehic only). The ORIGINAL's constructors build the nodes natively (tools/lib/m8-save.mjs); per node:
//   * the +8 word and the block right after the set-up: the original's serializer vs the port's `saveBlock` (nodes matched by constructor inside the record: z16PYA's list differs by a port-only node);
//   * the LOADER on random bytes: the original's loader (vtable +0x10, natively) and `loadBlock` get the same bytes; the blocks the two serializers then give must be equal, and the process globals the
//     walk block carries (the mailbox, DAT_009da9b8, DAT_009da9b4, the surface, DAT_008ae330, the vehicle kind words, DAT_009daa80, the focus record's matrix, the accessory's flags) must agree;
//   * the state is put back after every round.
// The oracle's emulator heap is pre-filled with 0xCD like the original's debug heap (tools/lib/m8-save-pepper.mjs `withCdHeap`: bytes a constructor never writes are 0xCD in a real save, src/game/heapfill.ts).
// The zone's own after-set-up work (z07CSI: `applyCsiSetup`, which the shipped game runs and tools/lib/hub-load.mjs does not) is applied first.
import { buildIslandOracle, buildHubOracle, nativeNodes, portNodes, origBlock, origLoad, hex, firstDiff, RECORDS_BASE, REC } from '../lib/m8-save.mjs';
import { lcg } from '../lib/m7-isl-veh-emu.mjs';
import { withCdHeap } from '../lib/m8-save-pepper.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { applyCsiSetup } from '../../src/zones/z07CSI/index.ts';
import { looksOf } from '../../src/island/vehicles/looks.ts';

const MY = [0x42f470, 0x88cf13, 0x88d1f6, 0x4bbef8, 0x4333c2, 0x43310c];
const ZONES = process.env.M8_ZONES ? process.env.M8_ZONES.split(',') : ['isl2', 'isl16', 'isl37', 'isl56', 'isl61', 'z07CSI', 'z13CAI', 'z14OSD', 'z16PYA', 'z23DIP', 'z40OGL'];
const ROUNDS = +(process.env.M8_FUZZ ?? 60);
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
const bits = (v) => { F32[0] = v; return U32[0]; };

export default {
  name: 'm8-save-pepper-zones',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0, fuzz = 0, nodes = 0;
    const bad = (m) => { if (failures.length < 60) failures.push(m); };
    const finite = (b, offs) => { for (const o of offs) if ((b[o + 3] & 0x7f) === 0x7f && (b[o + 2] & 0x80)) b[o + 3] &= 0x3f; };
    for (const z of ZONES) {
      const o = { extraExec: [[0x419000, 0x41a000]] };
      let B;
      try { B = withCdHeap(() => (z.startsWith('isl') ? buildIslandOracle(ctx, Number(z.slice(3)), o) : buildHubOracle(ctx, z, o))); } catch (e) { bad(`${z}: oracle build failed: ${e.message}`); continue; }
      const W = B.P.world, emu = B.emu, mem = emu.cpu.mem;
      if (z === 'z07CSI') applyCsiSetup(B.P.ictx, W, { pepper: B.P.pepper });
      for (let ri = 0; ri < W.records.length; ri++) {
        const rec = W.records[ri], on = nativeNodes(emu, ri), pn = portNodes(rec);
        for (const ctor of MY) {
          const n = on.find((x) => x.ctor === ctor), p = pn.find((x) => x.ctor === ctor);
          if (!n && !p) continue;
          if (!n || !p) { bad(`${z} rec ${ri} ${rec.name} ctor 0x${ctor.toString(16)}: original ${!!n} port ${!!p}`); continue; }
          nodes++;
          const tag = `${z} rec ${ri} ${rec.name} 0x${ctor.toString(16)}`;
          const cmpBlocks = (what, ob, pb) => {
            checked++;
            const d = ob.length !== pb.length ? 0 : firstDiff(ob, pb);
            if (d >= 0) bad(`${tag} ${what}: byte ${d}: original ${hex(ob.subarray(Math.max(0, d - 4), d + 8))} port ${hex(pb.subarray(Math.max(0, d - 4), d + 8))} (sizes ${ob.length} / ${pb.length})`);
          };
          checked++; if ((p.stamp >>> 0) !== (n.state >>> 0)) bad(`${tag}: +8 word original ${n.state >>> 0} port ${p.stamp >>> 0}`);
          const ob0 = Uint8Array.from(origBlock(emu, n)), pb0 = p.saveBlock(W, rec, rec.ctrl);
          cmpBlocks('after the set-up', ob0, pb0);
          // ---- the loader on random bytes
          const rnd = lcg(0x5eed + ri * 31 + ctor);
          const size = ob0.length;
          const pep = ctor === 0x42f470;
          const v = vehicles(W), focus = W.focus ?? rec, acc = p.accessory ?? null;
          const keepFocusM = Float32Array.from(focus.m), keepAccFlags = acc?.flags, keepG = { mailbox: W.pep.mailbox, flagB8: W.pep.flagB8, onObjectByte: W.pep.onObjectByte, surfaceAtFeet: W.pep.surfaceAtFeet };
          const emuFocus = RECORDS_BASE + focus.index * REC;
          for (let k = 0; k < ROUNDS; k++) {
            const bytes = new Uint8Array(size);
            for (let i = 0; i < size; i++) bytes[i] = Math.floor(rnd() * 256);
            if (pep) {
              finite(bytes, [0xc, 0x14, 0x1c, 0x24, 0x28, 0x2c, 0x38, 0x3c, 0x40, 0x44, 0x48, 0x4c, 0x50, 0x54, 0x58, 0x5d, ...Array.from({ length: 16 }, (_, q) => 0x70 + 4 * q)]);
              if (rnd() < 0.5) { const r2 = W.records[Math.floor(rnd() * W.records.length)]; for (let q = 0; q < 4; q++) bytes[0x63 + q] = q < r2.name.length ? r2.name.charCodeAt(q) : 0; }
              if (!acc) { bytes[0xb0] = 0; bytes[0xb1] = 0; }
              if (rnd() < 0.4) bytes[0x5c] = bytes[0x61];
            } else if (ctor === 0x88cf13) finite(bytes, [4]);
            else if (ctor === 0x43310c) finite(bytes, [0x38 - 0x18, 0x3c - 0x18, 0x40 - 0x18, 0x44 - 0x18, 0x48 - 0x18, 0x4c - 0x18, 0x54 - 0x18, 0x5c - 0x18, 0x60 - 0x18, 0x64 - 0x18, 0x68 - 0x18, 0x6c - 0x18, 0x70 - 0x18, 0x74 - 0x18, 0x78 - 0x18, 0x7c - 0x18, 0x8c - 0x18, 0x90 - 0x18, 0x94 - 0x18, 0x9c - 0x18, 0xa0 - 0x18, 0xa4 - 0x18, 0xa8 - 0x18, 0xac - 0x18, 0xb0 - 0x18]);
            else if (ctor === 0x4bbef8) finite(bytes, [0, 4, 8]);
            origLoad(emu, n, bytes);
            p.loadBlock(W, rec, rec.ctrl, bytes);
            fuzz++;
            cmpBlocks(`fuzz ${k} (the serializers after the loaders)`, origBlock(emu, n), p.saveBlock(W, rec, rec.ctrl));
            if (ctor !== 0x4bbef8 && ctor !== 0x42f470) cmpBlocks(`fuzz ${k} (the block back)`, origBlock(emu, n), bytes);
            if (ctor === 0x4bbef8) { const L = looksOf(W); for (let q = 0; q < 8; q++) { checked++; const ov = mem.r32(0x9da590 + 4 * q) | 0; if (ov !== -1 || (L && L.busy[q] !== -1)) bad(`${tag} fuzz ${k}: busy slot ${q}: original ${ov} port ${L?.busy[q]}`); } }
            if (pep) {
              const cmpv = (nme, a, b) => { checked++; if (a !== b) bad(`${tag} fuzz ${k}: ${nme}: original ${a} port ${b}`); };
              const g = W.pep;
              cmpv('mailbox', mem.r8(0x8ae088), g.mailbox & 0xff); cmpv('flagB8', mem.r8(0x9da9b8), g.flagB8); cmpv('onObject byte', mem.r8(0x9da9b4), g.onObjectByte); cmpv('surface', mem.r32(0x9da9ac) | 0, g.surfaceAtFeet | 0);
              cmpv('range bits', mem.r32(0x8ae330) >>> 0, bits(v.range)); cmpv('kind', mem.r16(0x9da9fa) << 16 >> 16, v.kind); cmpv('kind2', mem.r16(0x8ae1e0) << 16 >> 16, v.kind2);
              const op = mem.r32(0x9daa80); cmpv('current', op ? (op - RECORDS_BASE) / REC : -1, v.current ? v.current.index : -1);
              for (let q = 0; q < 16; q++) cmpv(`focus matrix[${q}]`, mem.r32(emuFocus + 0xc + 4 * q) >>> 0, bits(focus.m[q]));
              if (acc) cmpv('accessory flags', mem.r16(RECORDS_BASE + acc.index * REC + 0x60), acc.flags & 0xffff);
            }
          }
          // ---- put the set-up state back in both machines
          origLoad(emu, n, ob0); p.loadBlock(W, rec, rec.ctrl, ob0);
          if (pep) { focus.m.set(keepFocusM); if (acc) acc.flags = keepAccFlags; Object.assign(W.pep, keepG); }
        }
      }
    }
    notes.push(`nodes ${nodes}, loader rounds on random bytes ${fuzz}, comparisons ${checked}`);
    return { checked, failures, notes };
  },
};
