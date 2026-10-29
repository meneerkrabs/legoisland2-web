// M5 z40OGL, the ORACLE test: the original's code of Ogel's island next to the port's.
//  (a) the HUD: FUN_007e2a80 (set-up) and FUN_007e2ad0 (per frame) run natively in the set-up emulation (`IslandSetup.run`) on random game variables and frame lengths; the strings
//      ("x%d" / "%04d"), the interaction icon slot, the blink counter and var 0xc agree with src/zones/z40OGL/hud.ts after every call;
//  (b) the krystals (Overlay, FUN_007e31fc + FUN_007e2c9a + the framework's passes) run natively next to the port's `KrystalNode`: records' flags, node states, variables, every sound call
//      (the handle of each krystal) and every particle call, scripted pick-ups at the range boundary, random walks, krystals collected in an earlier visit;
//  (c) the zone's light set: the original loader FUN_008849c6 on the shipped `lights/lights.lgt` against `lightSetFromLgt` (why Ogel's island is dark: docs/re/m5/z40OGL.md section 4).
import { loadHub } from '../lib/hub-load.mjs';
import { makeOglDuel, f32, KST_HANDLES } from '../lib/m5-z40OGL-emu.mjs';
import { loadExe } from '../lib/engine-load.mjs';
import { Hud } from '../../src/shell/hud.ts';
import { GameVars } from '../../src/game/vars.ts';
import { hudInit, hudFrame, newHudState } from '../../src/zones/z40OGL/hud.ts';
import { KRYSTAL_RANGE2 } from '../../src/zones/z40OGL/krystal.ts';
import { parseLgt } from '../../src/formats/lights.ts';
import { lightSetFromLgt } from '../../src/render/lighting.ts';
import { createCpu } from '../../src/formats/x86emu.ts';

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** the HUD state words of the original (DrawHUD state at 0x5d4dd10) */
const A = { leftTex: 0x5d4dd14, leftTint: 0x5d4dd18, leftText: 0x5d4dd20, rightTex: 0x5d4dd38, centreText: 0x5d4dd60, colEnable: 0x5d4e13c, slot0Tex: 0x5d4e144, slot0Tint: 0x5d4e148, blink: 0x5d5f304 };
const MAXFAIL = 25;

export default {
  name: 'm5-z40OGL-emu',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c && failures.length < MAXFAIL) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);

    // ---- (a) the HUD
    {
      const H = loadHub(ctx, { zone: 'z40OGL', node: 64 });
      const emu = H.emu, mem = emu.mem;
      const cstr = (a) => { let s = ''; for (let i = 0; i < 16 && mem.r8(a + i); i++) s += String.fromCharCode(mem.r8(a + i)); return s; };
      const hud = new Hud(null), st = newHudState(), vars = new GameVars();
      // the set-up: the wrapper's FUN_0045f9d2 cleared the state (left / right icon -1, column slots -1), then FUN_007e2a80
      mem.w32(A.leftTex, 0xffffffff); mem.w32(A.rightTex, 0xffffffff); mem.w32(A.slot0Tex, 0xffffffff); mem.w32(A.blink, 0);
      const r0 = emu.run(0x7e2a80, []);
      hudInit(hud, st);
      ok(r0.eax !== undefined && mem.r32(A.leftTex) === 0 && mem.r32(A.leftTint) >>> 0 === 0xffffffff && mem.r32(A.slot0Tint) >>> 0 === 0xffffffff && mem.r32(A.colEnable) === 1, 'FUN_007e2a80: left icon 0 / white, column slot 0 white, column drawn');
      ok(hud.left.tex === 0 && hud.left.tint === 0xffffffff && hud.column[0].tint === 0xffffffff && hud.right.tex === -1 && mem.r32(A.rightTex) >>> 0 === 0xffffffff, 'hudInit: the same state');
      const rnd = lcg(40);
      const pick = (a) => a[Math.floor(rnd() * a.length)];
      let calls = 0, slotsSeen = new Set();
      for (const dt of [1, 0.5, 1.3, 1]) {
        mem.wf32(0x8b1718, dt);
        for (let i = 0; i < 700; i++) {
          // game variables: the score, the collected bits (also bits above 10), the interaction word the nodes set (one frame's worth), PEPPER_CONTROL
          const v25 = Math.floor(rnd() * (rnd() < 0.2 ? 100000 : 12000)), v31 = Math.floor(rnd() * 0x1000);
          const v0c = pick([0, 0, 1, 0x20, 0x1e, 2, 4, 8, 0x10, 0x40, 0x80, 0xc0, 0x21, 0x41, 0xe0, 0x1f]);
          const v5e = pick([1, 1, 1, 2, 4, 8, 0x20, 0x101, 0x100]);
          emu.setVar(0x25, v25); emu.setVar(0x31, v31); emu.setVar(0xc, v0c); emu.setVar(0x5e, v5e);
          vars.set(0x25, v25); vars.set(0x31, v31); vars.set(0xc, v0c); vars.set(0x5e, v5e);
          const r = emu.run(0x7e2ad0, []);
          hudFrame(hud, vars, st, dt);
          calls++;
          const tag = `dt ${dt} #${i} (v25 ${v25} v31 0x${v31.toString(16)} v0c 0x${v0c.toString(16)} v5e 0x${v5e.toString(16)})`;
          ok(cstr(A.centreText) === hud.centreText, `FUN_007e2ad0 ${tag}: centre text original "${cstr(A.centreText)}" port "${hud.centreText}"`);
          ok(cstr(A.leftText) === hud.leftText, `FUN_007e2ad0 ${tag}: left text original "${cstr(A.leftText)}" port "${hud.leftText}"`);
          const t0 = mem.r32(A.slot0Tex) | 0;
          ok(t0 === hud.column[0].tex, `FUN_007e2ad0 ${tag}: icon slot original ${t0} port ${hud.column[0].tex}`);
          slotsSeen.add(t0);
          ok(mem.f32(A.blink) === st.blink, `FUN_007e2ad0 ${tag}: blink counter original ${mem.f32(A.blink)} port ${st.blink}`);
          const w = r.varWrites.filter((x) => x.var === 0xc);
          ok(w.length === 1 && w[0].value === 0 && vars.get(0xc) === 0, `FUN_007e2ad0 ${tag}: var 0xc reset (original ${JSON.stringify(w)} port ${vars.get(0xc)})`);
          ok(r.varWrites.length === 1 && r.calls.length === 0, `FUN_007e2ad0 ${tag}: only that write, no engine calls (${r.varWrites.length} writes, ${r.calls.length} calls)`);
          // the blinking icon (0xc0) needs consecutive frames: now and then the word stays set for 20 .. 70 frames (counter 15: texture 4 -> 5, 30: restart)
          if (rnd() < 0.03) {
            const word = pick([0x40, 0x80, 0xc0]);
            for (let k = 0, n = 20 + Math.floor(rnd() * 50); k < n; k++) {
              emu.setVar(0xc, word); vars.set(0xc, word);
              emu.run(0x7e2ad0, []); hudFrame(hud, vars, st, dt); calls++;
              ok((mem.r32(A.slot0Tex) | 0) === hud.column[0].tex && mem.f32(A.blink) === st.blink, `FUN_007e2ad0 ${tag}: blink run frame ${k}: icon original ${mem.r32(A.slot0Tex) | 0} port ${hud.column[0].tex}, counter ${mem.f32(A.blink)} / ${st.blink}`);
              slotsSeen.add(mem.r32(A.slot0Tex) | 0);
            }
          }
          // the icon is held while the word is set but Pepper is not walking: a few blank frames sometimes, as the original
          if (rnd() < 0.15) { emu.setVar(0xc, 0); vars.set(0xc, 0); emu.setVar(0x5e, 1); vars.set(0x5e, 1); const r2 = emu.run(0x7e2ad0, []); hudFrame(hud, vars, st, dt); calls++; ok((mem.r32(A.slot0Tex) | 0) === hud.column[0].tex && r2.varWrites.length === 1, `FUN_007e2ad0 ${tag}: idle frame`); }
        }
      }
      ok([...slotsSeen].every((t) => t >= -1 && t <= 5) && slotsSeen.size >= 6 && slotsSeen.has(5), `icon slots exercised: ${[...slotsSeen].sort()}`);
      notes.push(`HUD: ${calls} FUN_007e2ad0 calls (dt 1 / 0.5 / 1.3), icon slots ${[...slotsSeen].sort()}`);
    }

    // ---- (b) the krystals
    {
      const stat = { ticks: 0, sessions: 0, picked: 0, collectedBefore: 0, boundary: 0 };
      const session = (label, o, scenario) => {
        const d = makeOglDuel(ctx, { ...o, label, maxFail: MAXFAIL, failures });
        stat.sessions++;
        const ksts = d.P.world.records.filter((r) => /^KST[0-9]$/.test(r.name));
        d.compare();                                            // the constructors' effects (flags, states, the particle call) before the first tick
        scenario(d, ksts);
        checked += d.checked;
        return d;
      };
      const tickN = (d, n) => { for (let i = 0; i < n; i++) { d.tick(); d.compare(); stat.ticks++; } };
      // scripted: stand next to every krystal that has the node (KST7 has none) at 3 units: collected, state 3 -> 0, the bit set after the third tick
      for (const node of [64, 66]) {
        session(`pick-ups node ${node}`, { node }, (d, ksts) => {
          for (const r of ksts) {
            d.placePepper(r.x + 2.5, r.y, r.z + 1);
            tickN(d, 6);
            if (r.name !== 'KST7') stat.picked++;
          }
          ok((d.var(0x31) & 0x1ff) === 0x1ff, `node ${node}: all nine krystals collected (var 0x31 = 0x${d.var(0x31).toString(16)})`);
          ok(d.var(0x25) === 9000 && d.var(199) === 9000, `node ${node}: 9 x 1000 points (var 0x25 ${d.var(0x25)}, var 0xc7 ${d.var(199)})`);
          d.placePepper(ksts[0].x + 0.5, ksts[0].y, ksts[0].z);
          tickN(d, 5);                                          // nothing more happens (the gates are closed, the records hidden)
        });
      }
      // the pick-up boundary: squared distance 12.96 (the controller's distSq: a float32 sum in the original)
      session('range boundary', { node: 64 }, (d, ksts) => {
        const r = ksts[0];
        const steps = [3.55, 3.59, 3.5999, 3.6, 3.6001, 3.61, 3.7];
        for (const dist of steps) {
          d.placePepper(r.x + dist, r.y, r.z);
          tickN(d, 1);
          stat.boundary++;
          if (r.flags & 2) continue;
          break;
        }
        tickN(d, 5);
        ok(Math.sqrt(KRYSTAL_RANGE2) > 3.5999 && Math.sqrt(KRYSTAL_RANGE2) < 3.6001, 'the range is 3.6 (12.96 squared)');
      });
      // krystals collected in an earlier visit: hidden at the constructor, their gates closed, never played
      for (const bits of [0x1, 0x2a, 0x155, 0x1ff, 0x3ff]) {
        session(`collected before 0x${bits.toString(16)}`, { node: 66, vars: { 0x31: bits } }, (d, ksts) => {
          stat.collectedBefore += ksts.filter((r) => !(r.flags & 2)).length;
          for (const r of ksts) { d.placePepper(r.x + 2, r.y, r.z); tickN(d, 4); }
        });
      }
      // random walks: Pepper jumps between krystals and random places, 400 ticks, dt 1 and 0.5
      for (const [seed, dt] of [[1, 1], [2, 1], [3, 0.5], [4, 1]]) {
        session(`random walk seed ${seed} dt ${dt}`, { node: seed % 2 ? 64 : 66, dt }, (d, ksts) => {
          const rnd = lcg(seed * 7919);
          for (let i = 0; i < 420; i++) {
            if (i % 5 === 0) {
              const r = ksts[Math.floor(rnd() * ksts.length)];
              const a = rnd() * 6.2832, dist = 1 + rnd() * 6;
              d.placePepper(r.x + Math.cos(a) * dist, r.y + (rnd() - 0.5) * 2, r.z + Math.sin(a) * dist);
            }
            d.tick(); d.compare(); stat.ticks++;
          }
        });
      }
      ok(stat.picked >= 18, `krystals picked up in the scripted sessions: ${stat.picked}`);
      notes.push(`krystals: ${stat.sessions} sessions, ${stat.ticks} ticks compared with the original's constructor / update / framework passes, ${stat.picked} scripted pick-ups, ${stat.collectedBefore} krystals restored as collected`);
    }

    // ---- (c) the light set of the zone: FUN_008849c6 (the loader's conversion of lights.lgt records into the runtime light set)
    {
      const arc = ctx.archives.find((a) => a.name.toLowerCase() === 'z40ogl');
      const lgt = parseLgt(arc.read(arc.find('lights/lights.lgt')));
      const port = lightSetFromLgt(lgt);
      const cpu = createCpu(pe);
      cpu.cw = 0x7f;
      const HEAP = 0x20000000;
      cpu.mem.addRegion({ lo: HEAP, hi: HEAP + 0x100000, name: 'heap' });
      const SET = HEAP, REC = HEAP + 0x1000, RT = HEAP + 0x8000;
      // the file's records: the loader reads `declaredCount` records of 0x58 bytes (FUN_008864b6: FUN_00435350(.., count, 0x58)); the file holds fewer, the rest reads as zero
      const raw = arc.read(arc.find('lights/lights.lgt'));
      const count = lgt.declaredCount;
      for (let i = 0; i < raw.length - 8; i++) cpu.mem.w8(REC + i, raw[8 + i]);
      // FUN_00433d38 (allocator) is the only engine call: hosted by a bump pointer
      let brk = RT;
      cpu.hooks.set(0x433d38, (c) => { c.eax = brk; brk += (c.arg(0) + 15) & ~15; });
      cpu.hooks.set(0x8868a0, (c) => { c.eax = 0; });
      cpu.exec = [[0x884000, 0x886500], [0x858d30, 0x873e00]];
      cpu.fallback = (addr) => (c) => { c.eax = 0; };
      cpu.regs[1] = SET;
      cpu.call(0x8849c6, [count, REC]);
      const mem = cpu.mem;
      const n = mem.r32(SET), arr = mem.r32(SET + 8);
      // the loader reads `declaredCount` records (the missing ones are zero: black point lights at the origin) and appends the ambient entry
      ok(n === count + 1, `runtime light count: original ${n}, declared ${count} + the ambient entry`);
      const L = port.list;
      ok(L.length === lgt.lights.length + 1, `the port keeps the file's ${lgt.lights.length} records + the ambient entry (${L.length})`);
      for (let i = 0; i < lgt.lights.length; i++) {
        const b = arr + i * 100, pl = L[i];
        ok(mem.r32(b) === pl.kind, `light ${i}: kind original ${mem.r32(b)} port ${pl.kind}`);
        for (let k = 0; k < 3; k++) {
          ok(mem.f32(b + 4 + 4 * k) === f32(pl.pos[k]), `light ${i}: position[${k}] original ${mem.f32(b + 4 + 4 * k)} port ${pl.pos[k]}`);
          ok(mem.f32(b + 0x10 + 4 * k) === f32(pl.dir[k]), `light ${i}: direction[${k}] original ${mem.f32(b + 0x10 + 4 * k)} port ${pl.dir[k]}`);
          ok(mem.f32(b + 0x4c + 4 * k) === f32(pl.color[k]), `light ${i}: diffuse[${k}] original ${mem.f32(b + 0x4c + 4 * k)} port ${pl.color[k]}`);
        }
        ok(mem.f32(b + 0x5c) === 1, `light ${i}: reach +0x5c is the constant 1.0 (${mem.f32(b + 0x5c)}), the file's range ${lgt.lights[i].range} is not used`);
      }
      for (let i = lgt.lights.length; i < count; i++) ok(mem.r32(arr + i * 100) === 2 && [0, 1, 2].every((k) => mem.f32(arr + i * 100 + 0x4c + 4 * k) === 0), `declared record ${i} beyond the file: a black point light`);
      const am = arr + (n - 1) * 100, amb = [0, 1, 2].map((k) => mem.f32(am + 0x4c + 4 * k));
      ok(mem.r32(am) === 0 && amb.every((v, k) => v === f32(port.ambient[k])), `ambient entry: original ${amb.map((v) => +v.toFixed(4))} port ${port.ambient.map((v) => +v.toFixed(4))}`);
      ok(amb[0] === f32(0.01709599792957306) && amb[0] < 4.4 / 255, `Ogel's island ambient is 0.0171 (4.4 / 255, the maximum over the records), got ${amb[0]}`);
      const dir = [0, 1, 2].map((k) => mem.f32(arr + 0x10 + 4 * k));
      ok(mem.r32(arr) === 1 && dir[1] > 0, `light 0 is the sun (runtime kind ${mem.r32(arr)}), its direction y negated to ${dir[1]} (file ${lgt.lights[0].direction[1]})`);
      const reach1 = L.filter((l) => l.kind === 2).length;
      notes.push(`lights: ${lgt.lights.length} records, ambient ${amb[0].toFixed(4)}, ${reach1} point lights (reach 1.0), sun (${dir.map((v) => v.toFixed(2))}) toward the light`);
    }
    return { checked, failures, notes };
  },
};
