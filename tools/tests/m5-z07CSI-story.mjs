// M5 z07CSI: the castle's story handler FUN_00574e40 (src/zones/z07CSI/story.ts) against the ORIGINAL code run in the x86 emulation (`IslandSetup.run`, src/formats/emusetup.ts,
// the same machine the castle's own set-up left). Like tools/tests/m4-wp8-story.mjs does for the island's FUN_004b7040: for every story node 0..40 (the bands 15..29 and the
// neighbours) and the three values of `*prev` the handler can see (uninitialised = the set-up's own call, node - 1 = "just advanced", any other) the port must make the same
// engine calls in the same order (text-file frees / loads with the string address, objective setters with record index / PATH node / radius, PATH placements, animation starts),
// leave the same record state (flag word, translation, Euler angle, matrix block, bit for bit) and write the same game variables. The four stage sets (nodes 15 / 19 / 24 / 27 build
// different record sets) each run the whole node list, the port world and the emulated machine staying in step (the port's records are compared after every call).
import { RECORDS_BASE } from '../../src/formats/emusetup.ts';
import { csiStory, liveCsiServices, TEXT } from '../../src/zones/z07CSI/story.ts';
import { messagePath } from '../../src/zones/z02LGI/ctx.ts';
import { loadHub } from '../lib/hub-load.mjs';

const REC = 0x68;
const f32 = (u) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, u >>> 0, true); return b.getFloat32(0, true); };
const bits = (x) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, x, true); return b.getUint32(0, true); };
const recOfPtr = (p) => (p === 0 ? -1 : Math.floor(((p >>> 0) - RECORDS_BASE) / REC));
/** records the handler can touch (flags / matrix / translation / yaw are compared for these after every call) */
const WATCH = [4, 7, 24, 46, 48, 50, 51, 52, 53, 165, 202, 203];

/** the emulated engine calls in the port's vocabulary */
function emuCalls(run) {
  const out = [];
  for (const c of run.calls) {
    const a = c.args;
    switch (c.fn) {
      case 0x423ff6: out.push('free1'); break;
      case 0x88d296: out.push('free2'); break;
      case 0x424270: out.push(`record(${recOfPtr(a[0])},${f32(a[1])})`); break;
      case 0x424230: out.push(`pair(${recOfPtr(a[0])},${recOfPtr(a[1])},${f32(a[2])})`); break;
      case 0x42419f: out.push(`four(${a.slice(0, 4).map(recOfPtr)})`); break;
      case 0x4242b9: out.push(`node(${a[0]},${f32(a[1])})`); break;
      case 0x423fe0: out.push(`npc(${a[0].toString(16)})`); break;
      case 0x88d280: out.push(`hol(${a[0].toString(16)})`); break;
      case 0x462be9: out.push(`place(${recOfPtr(a[2])},${a[1]},${a[0]})`); break;
      case 0x43b6a3: out.push(`anim(${a[1]})`); break;
      default: out.push(`?${c.name}`);
    }
  }
  return out;
}

export default {
  name: 'm5-z07CSI-story',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const eq = (msg, a, b) => { checked++; const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) failures.push(`${msg}: port ${x} != original ${y}`); };
    let cases = 0, justBands = 0;
    const files = new Set();
    for (const stage of [15, 19, 24, 27]) {
      const H = loadHub(ctx, { zone: 'z07CSI', node: stage, vars: { 0xa3: 7 } });
      const s = H.emu, mem = s.mem;
      const world = H.world;
      const pNext = s.alloc(8), pPrev = s.alloc(8);
      /** the emulated record state: flags, translation, yaw (+0x50), the 16 matrix words (+0x0c) */
      const emuRec = (i) => ({ flags: mem.r16(RECORDS_BASE + i * REC + 0x60), pos: [0x3c, 0x40, 0x44].map((o) => mem.u32(RECORDS_BASE + i * REC + o)), yaw: mem.u32(RECORDS_BASE + i * REC + 0x50), m: Array.from({ length: 16 }, (_, k) => mem.u32(RECORDS_BASE + i * REC + 0xc + 4 * k)) });
      const portRec = (i) => { const r = world.records[i]; return { flags: r.flags & 0xffff, pos: [r.m[12], r.m[13], r.m[14]].map(bits), yaw: bits(r.ry), m: Array.from(r.m, bits) }; };
      // the port's records start as the set-up left them: the emulation and the world agree on the watched records (the first check of the test)
      for (const i of WATCH) {
        const e = emuRec(i), p = portRec(i);
        eq(`stage ${stage} record ${i} (${world.records[i].name}) flags after the set-up`, p.flags & 0x7fff & ~0x51, e.flags & 0x7fff & ~0x51);
      }
      for (let node = 0; node <= 40; node++) {
        for (const prevKind of ['uninit', 'just', 'other']) {
          const prev = prevKind === 'uninit' ? 0xcccccccc : prevKind === 'just' ? node - 1 : 0;
          if (prevKind === 'just' && node === 0) continue;
          // the port world takes the emulated machine's records as the state this call starts from (the earlier calls changed both)
          for (const i of WATCH) {
            const r = world.records[i], e = emuRec(i);
            r.flags = (r.flags & ~0xffff) | e.flags;
            r.m[12] = f32(e.pos[0]); r.m[13] = f32(e.pos[1]); r.m[14] = f32(e.pos[2]);
            for (let k = 0; k < 16; k++) if (k < 12 || k > 14) r.m[k] = f32(e.m[k]);
            r.ry = f32(e.yaw);
            r.rx = f32(mem.u32(RECORDS_BASE + i * REC + 0x4c)); r.rz = f32(mem.u32(RECORDS_BASE + i * REC + 0x54));
          }
          mem.w32(pPrev, prev); mem.w32(pNext, 0x77777777);
          s.setVar(0x58, node);
          const vars0 = Array.from({ length: 0x130 }, (_, i) => mem.u32(0x8a2d2c + 4 * i));
          const run = s.run(0x574e40, [pNext, pPrev, node]);
          const want = emuCalls(run);
          const wantPrev = mem.u32(pPrev) | 0;
          // ---- the port
          const calls = [], vw = [];
          const g = { vars: new Map() };
          const env = {
            setupCall: false, ictx: H.ictx,
            cutsceneActive: () => false,
            vars: {
              get: (i) => (g.vars.has(i) ? g.vars.get(i) : vars0[i]),
              set: (i, v) => { g.vars.set(i, v | 0); vw.push(`${i.toString(16)} set ${v | 0}`); },
              or: (i, v) => { vw.push(`${i.toString(16)} or ${v}`); }, andNot: (i, v) => { vw.push(`${i.toString(16)} andnot ${v}`); },
            },
            flags: (r) => world.records[r].flags & 0xffff,
            setFlags: (r, v) => { world.records[r].flags = (world.records[r].flags & ~0xffff) | (v & 0xffff); },
            freeTexts: () => { calls.push('free1'); calls.push('free2'); },
            npcText: (a) => calls.push(`npc(${a.toString(16)})`),
            holText: (a) => calls.push(`hol(${a.toString(16)})`),
            objRecord: (r, rad) => calls.push(`record(${r},${rad})`),
            objPair: (a, b, rad) => calls.push(`pair(${a},${b},${rad})`),
            objFour: (a, b, c, d) => calls.push(`four(${[a, b, c, d]})`),
            objNode: (n, rad) => calls.push(`node(${n},${rad})`),
            holoAlert: () => calls.push('holo'),
          };
          const live = liveCsiServices(env);
          const svc = {
            ...live,
            placeOnPath: (r, n) => { calls.push(`place(${r},${n},1)`); live.placeOnPath(r, n); },
            animStart: (r, c) => { calls.push(`anim(${c})`); live.animStart(r, c); },
          };
          const ref = { prev: prev | 0, next: -10 };
          const ret = csiStory(env, ref, node, svc);
          const tag = `stage ${stage} node ${node} prev ${prevKind}`;
          cases++;
          eq(`${tag}: calls`, calls, want);
          eq(`${tag}: return`, ret, run.eax);
          eq(`${tag}: prev`, ref.prev, wantPrev);
          // game variables written by the handler: the emulated array diff
          const wantVw = run.varWrites.map((w) => `${w.var.toString(16)} ${w.op}${w.op === 'set' ? ` ${w.value | 0}` : ''}`);
          eq(`${tag}: var writes`, vw.map((x) => x.replace(/ (or|andnot) \d+$/, ' $1')), wantVw.map((x) => x.replace(/ (or|andnot)$/, ' $1')));
          // the watched records, bit for bit
          for (const i of WATCH) {
            const e = emuRec(i), p = portRec(i);
            eq(`${tag}: record ${i} flags`, p.flags, e.flags);
            eq(`${tag}: record ${i} translation`, p.pos, e.pos);
            eq(`${tag}: record ${i} yaw`, p.yaw, e.yaw);
            eq(`${tag}: record ${i} matrix`, p.m, e.m);
          }
          if (prevKind === 'just' && JSON.stringify(calls) !== JSON.stringify(emuCalls(run)) === false && (run.varWrites.length > 0 || want.some((c) => c.startsWith('place')))) justBands++;
          for (const c of calls) { const mm = /^(npc|hol)\((\w+)\)$/.exec(c); if (mm) files.add(parseInt(mm[2], 16)); }
        }
      }
    }
    notes.push(`4 stage sets x nodes 0..40 x 3 values of *prev = ${cases} calls of the original's FUN_00574e40 compared (calls, return, *prev, variable writes, flags / translation / yaw / matrix bits of 12 records)`);
    notes.push(`${justBands} "just advanced" cases made one-shot writes (variables / placements)`);
    // the message files the bands select exist in the messages archive
    const pe = H0(ctx);
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    for (const va of files) {
      const p = messagePath(pe.cstr(va));
      checked++;
      if (!messages?.find(p)) failures.push(`message file ${p} (0x${va.toString(16)}) not in the messages archive`);
    }
    // every string address of TEXT is one of the addresses the original used
    const used = [...files].sort((a, b) => a - b);
    const declared = Object.values(TEXT).flat().filter((x) => x).sort((a, b) => a - b);
    eq('TEXT table = the addresses the original called', declared, used);
    notes.push(`${files.size} message files referenced, all present`);
    // a running cutscene: nothing, prev unchanged (retried next frame)
    { const ref = { prev: 3, next: -10 }; const calls = []; csiStory({ cutsceneActive: () => true, freeTexts: () => calls.push('x') }, ref, 17, {}); eq('cutscene running: no call, prev kept', [calls.length, ref.prev], [0, 3]); }
    return { checked, failures, notes };
  },
};
import { loadExe } from '../lib/engine-load.mjs';
function H0(ctx) { return loadExe(ctx.dataRoot); }
