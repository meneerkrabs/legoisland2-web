// M5 audit, front end z60FRE: the credits scroll's stage characters (FUN_00471c4c: the slots, the peek-in of the stage records, Space blinking, the end) run in the x86 interpreter next
// to the port (src/shell/credits.ts `Credits.tick` / `CreditsStage`); slots, timers, record flags / positions, animations and the return value are compared every tick.
import { loadExe, sceneOf } from '../lib/engine-load.mjs';
import { FeEmu } from '../lib/fe-emu.mjs';
import { buildRecords } from '../../src/game/zone.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import { parseBlk } from '../../src/formats/anim.ts';
import { Credits, buildCredits } from '../../src/shell/credits.ts';
import { loadMessages, CREDITS_FILES } from '../../src/ui/strings.ts';

class Lcg {
  constructor(seed) { this.s = seed >>> 0; }
  int() { this.s = (Math.imul(this.s, 214013) + 2531011) >>> 0; return (this.s >>> 16) & 0x7fff; }
}

export default {
  name: 'm5-audit-fe-credits',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    const scene = sceneOf(ctx, 'z60FRE');
    const archive = ctx.archives.find((a) => a.name === 'z60FRE');
    const mfig = parseBlk(archive.read(archive.find('anim/MFIG.blk'))), skbd = parseBlk(archive.read(archive.find('anim/SKBD.blk')));
    const msgs = loadMessages(ctx.archives.find((a) => a.name === 'messages'), CREDITS_FILES);
    const stage = () => {
      const recs = buildRecords('z60FRE', scene, archive).records;
      for (let i = 0; i <= 21; i++) { recs[i].anim = new AnimInstance(i === 1 ? skbd : mfig); recs[i].anim.start(1, 0); }
      return recs;
    };
    // the wrapped list of the credits, the measure is a plain width (the original measures with the font; the list is handed to both sides)
    const lines = buildCredits(pe, msgs, (cls, s) => s.length * 14 + cls);

    /** the step time of tick t: `dt1` / `dt05` fixed, `real` = the loops' rule (1.0 for the first five frames, then 0.5) */
    const dtOf = (mode, t) => (mode === 'dt1' ? 1 : mode === 'dt05' ? 0.5 : t < 5 ? 1 : 0.5);
    const scenario = (label, seed, pressAt, maxTicks, mode = 'dt1') => {
      const portRecs = stage(), emuRecs = stage();
      const emu = new FeEmu(pe, emuRecs.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags })), new Map(emuRecs.slice(0, 22).map((r, i) => [i, r.anim])), { rng: { range: () => 0 } });
      const mem = emu.cpu.mem;
      // DAT_05d57e88: the list (0x108 bytes per entry: font class, text, record), DAT_05d57e84: its length
      const list = emu.alloc(lines.length * 0x108 + 0x4000);
      lines.forEach((l, i) => { mem.w32(list + i * 0x108, l.cls); for (let k = 0; k < l.text.length; k++) mem.w8(list + i * 0x108 + 4 + k, l.text.charCodeAt(k)); mem.w32(list + i * 0x108 + 0x104, l.record); });
      mem.w32(0x5d57e88, list); mem.w32(0x5d57e84, lines.length);
      const credits = new Credits(lines);
      const rng = new Lcg(seed);
      let worst = 0, spawned = 0, blinks = 0, ended = -1;
      const cmp = (tick, name, a, b, tol = 0) => {
        checked++;
        const d = Math.abs(a - b);
        worst = Math.max(worst, d);
        if (!(d <= tol * Math.max(1, Math.abs(a))) && failures.length < 12) failures.push(`${label}: tick ${tick} ${name}: original ${a} port ${b}`);
      };
      let pos = -480;
      for (let t = 0; t < maxTicks && failures.length < 12; t++) {
        const pressed = pressAt(t, rng), dt = dtOf(mode, t);
        mem.w32(0x983840, pressed);
        emu.setDt(dt);
        emu.cpu.steps = 0;
        const ret = emu.cpu.call(0x471c4c, [Math.trunc(pos)], { maxSteps: 5_000_000 }) | 0;   // the loop passes ftol(local_68)
        const done = credits.tick(pressed, portRecs, dt);
        pos = Math.fround(Math.fround(1 * dt) + pos);                                        // local_68 = 1.0 * DAT_008b1718 + local_68
        cmp(t, 'result', ret, done ? 1 : 0, 0);
        for (let s = 0; s < 3; s++) {
          cmp(t, `slot${s}.timer`, mem.r32(0x5d57e8c + 4 * s), credits.stage.timer[s], 0);
          cmp(t, `slot${s}.state`, mem.r32(0x5d57e98 + 4 * s), credits.stage.state[s], 0);
        }
        for (let i = 0; i <= 21; i++) {
          cmp(t, `rec${i}.flags`, emu.flags(i), portRecs[i].flags, 0);
          if (emu.flags(i) & 2) { const om = emu.matrix(i); for (const k of [12, 13, 14]) cmp(t, `rec${i}.m${k}`, om[k], portRecs[i].m[k]); }
          cmp(t, `rec${i}.clip`, emuRecs[i].anim.clip, portRecs[i].anim.clip, 0);
          cmp(t, `rec${i}.frame`, emuRecs[i].anim.frame, portRecs[i].anim.frame, 0);
        }
        if (t > 0 && credits.stage.timer.some((x) => x === 0x4f)) spawned++;
        if (credits.stage.state.some((x) => x === 0 || x === 1)) blinks++;
        if (done) { ended = t; break; }
        if (ret !== 0) { ended = t; break; }
      }
      return { spawned, blinks, ended };
    };
    // all at tolerance 0, at dt 1, dt 0.5 and the real sequence (1.0 for five frames, then 0.5: the scroll position grows by 1.0 * dt per pass, an integer position repeats twice at 0.5)
    for (const mode of ['dt1', 'dt05', 'real']) {
      const k = mode === 'dt1' ? 1 : 2;
      const a = scenario(`${mode} no input`, 1, () => 0, 9000 * k + 40, mode);
      const b = scenario(`${mode} space presses`, 2, (t, r) => (r.int() % 25 === 0 ? 0x80 : 0), 9000 * k + 40, mode);
      const c = scenario(`${mode} space while a slot is in its window`, 3, (t, r) => (r.int() % 3 === 0 ? 0x80 : 0), 9000 * k + 40, mode);
      const d = scenario(`${mode} a key ends it`, 4, (t) => (t === 2500 * k ? 0x40 : 0), 9000 * k + 40, mode);
      notes.push(`${mode}: no input: ${a.spawned} spawn ticks, credits end at tick ${a.ended}; space: ${b.spawned} spawns ${b.blinks} blink ticks; space often: ${c.blinks} blink ticks; a key at tick ${2500 * k} ends at ${d.ended}`);
      if (a.spawned < 5) failures.push(`${mode}: too few spawns (${a.spawned})`);
      if (c.blinks < 5) failures.push(`${mode}: the Space blink was never exercised (${c.blinks})`);
      if (a.ended < 5000 * k) failures.push(`${mode}: the credits ended too early (${a.ended})`);
    }
    return { checked, failures, notes };
  },
};
