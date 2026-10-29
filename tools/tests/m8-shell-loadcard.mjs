// WP-SHELL, U1: the loading card. The original's FUN_0040d1be (and FUN_0043ec80, the fade setter) run in the x86 interpreter (tools/lib/loadcard-emu.mjs) next to the port's
// `LoadingCard` (src/ui/loadingcard.ts) and the Ui2D integration: the vertices of the disc (x, y, u, v, colour), which face (texture) is drawn, the fade quad's colour, the state blocks,
// the text call (font, wrap, colour, position) and the card's state after the call (angles, last tick, draw count) are compared for the first call (the init branch) and for hundreds
// of calls with fades from -0.3 to 1.5 and clock steps from 0 to a wrapping 32 bit tick.
import { loadExe } from '../lib/engine-load.mjs';
import { LoadCardEmu, TEX } from '../lib/loadcard-emu.mjs';
import { LoadingCard } from '../../src/ui/loadingcard.ts';

const bits = (x) => new Uint32Array(new Float32Array([x]).buffer)[0];

export default {
  name: 'm8-shell-loadcard',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    const bad = (m) => { if (failures.length < 30) failures.push(m); };
    const eq = (what, a, b) => { checked++; if (a !== b) bad(`${what}: original ${a} port ${b}`); };
    const stats = { calls: 0, cd: 0, pizza: 0, inactive: 0 };

    const run = (label, seed, n, W, H) => {
      const emu = new LoadCardEmu(pe);
      emu.setViewport(W, H);
      emu.construct();
      const card = new LoadingCard();
      let s = seed >>> 0;
      const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
      let tick = 1000 + Math.floor(rnd() * 5000);
      for (let i = 0; i < n; i++) {
        const fade = i === 0 ? 0.5 : [0, 0.0625, 0.5, 0.9375, 1, 1.5, -0.3, rnd(), rnd() * 1.2 - 0.1][Math.floor(rnd() * 9)];
        // FUN_0043ec80 before every present (the first present of the process has not seen it: the init branch overrides)
        if (i > 0) { emu.setFade(fade); card.setFade(fade); }
        const step = [0, 1, 16, 33, 50, 1000, 70000][Math.floor(rnd() * 7)];
        tick = (tick + step) >>> 0;
        if (i === 3) tick = 0xfffffff0;          // the clock wraps: the difference is an int32
        if (i === 4) tick = 5;
        if (i === 0) emu.mem.w32(0x987770, 0);
        emu.setTextures();
        const calls = emu.draw(tick);
        const mine = card.frame(W, H, tick);
        stats.calls++;
        const t = `${label} call ${i} fade ${fade} tick ${tick}`;
        const orig = emu.state();
        if (i === 0) eq(`${t}: init branch cleared`, orig.first, 0);
        const draws = calls.filter((c) => c.k === 'draw');
        if (!mine) {
          stats.inactive++;
          eq(`${t}: no draw when inactive`, draws.length, 0);
          eq(`${t}: inactive text`, calls.filter((c) => c.k === 'text').length, 0);
          eq(`${t}: angleZ unchanged`, bits(orig.angleZ), bits(card.angleZ));
          continue;
        }
        eq(`${t}: draws (fade quad + disc)`, draws.length, 2);
        if (draws.length !== 2) continue;
        const [quad, disc] = draws;
        eq(`${t}: fade quad colour`, quad.verts[0].colour, mine.colour);
        for (let k = 0; k < 4; k++) eq(`${t}: fade quad colour ${k}`, quad.verts[k].colour, mine.colour);
        eq(`${t}: fade quad corners`, JSON.stringify(quad.verts.map((v) => [v.x, v.y])), JSON.stringify([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]]));
        eq(`${t}: disc primitive`, `${disc.prim} ${disc.fvf} ${disc.count}`, '6 324 4');
        for (let k = 0; k < 4; k++) {
          const o = disc.verts[k], p = mine.verts[k];
          eq(`${t}: disc ${k} x`, bits(o.x), bits(p.x)); eq(`${t}: disc ${k} y`, bits(o.y), bits(p.y));
          eq(`${t}: disc ${k} uv`, `${o.u} ${o.v}`, `${p.u} ${p.v}`);
          eq(`${t}: disc ${k} colour`, o.colour, mine.colour);
          eq(`${t}: disc ${k} z / rhw`, `${bits(o.z)} ${bits(o.rhw)}`, `${bits(0x38d1b717 === 0 ? 0 : new Float32Array(new Uint32Array([0x38d1b717]).buffer)[0])} ${bits(new Float32Array(new Uint32Array([0x38d1b717]).buffer)[0])}`);
        }
        const tex = calls.filter((c) => c.k === 'texture').map((c) => c.tex);
        eq(`${t}: textures (backdrop, then the face)`, `${tex[0]} ${tex[1]}`, `${TEX.loading} ${mine.face === 1 ? TEX.cd : TEX.pizza}`);
        mine.face === 1 ? stats.cd++ : stats.pizza++;
        eq(`${t}: state blocks`, calls.filter((c) => c.k === 'block').map((c) => c.block).join(','), '16,16');
        const txt = calls.find((c) => c.k === 'text');
        eq(`${t}: text`, `${txt.table} ${txt.font} ${txt.text} ${txt.flag} ${txt.colour} ${txt.x} ${txt.y} ${txt.maxChars}`, `0 1 LOADING 1 0 ${mine.textX} ${mine.textY} 30`);
        const st = emu.state();
        eq(`${t}: angleZ`, bits(st.angleZ), bits(card.angleZ));
        eq(`${t}: angleX`, bits(st.angleX), bits(card.angleX));
        eq(`${t}: last tick`, st.lastTick, card.lastTick | 0);
        eq(`${t}: draws`, st.draws, card.draws);
      }
      eq(`${label}: unhooked calls`, emu.unhooked.size, 0);
    };
    for (const [w, h] of [[640, 480], [800, 600], [1024, 768]]) for (const seed of [1, 2, 3]) run(`${w}x${h} seed ${seed}`, seed, 120, w, h);
    notes.push(`${stats.calls} calls: pizza face ${stats.pizza}, CD face ${stats.cd}, inactive (fade >= 1) ${stats.inactive}`);
    return { checked, failures, notes };
  },
};
