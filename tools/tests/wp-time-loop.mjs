// WP-TIME: the fixed 60 Hz loop's pieces. nextDt (FUN_00443e40), World.advanceDt (dt, pass log, particle tickers), the shared C runtime (src/game/crt.ts: LCG, FUN_004388ae, injection,
// time / tick sources) and the renderer's per-pass state (.wib textures FUN_00410ff8, the sky / sea steps, the pass replay of GameRenderer).
import { World, FrameClock, nextDt, TICK_HZ, TICK_MS, STEP_ELAPSED, PASS_LOG } from '../../src/game/world.ts';
import { addParticleTicker } from '../../src/fx/particles/ticker.ts';
import { srand, rand, randF, randD, setRandSource, getRandSource, time, setTimeSource, getTickCount, setTickCountSource, seedFromTime } from '../../src/game/crt.ts';
import { Renderer } from '../../src/render/renderer.ts';
import { SkyState, SeaState, SKY_SPIN, SEA_PHASE_A, SEA_PHASE_B } from '../../src/render/environment.ts';
import { GameRenderer } from '../../src/game/render.ts';
import { guarded } from '../lib/inject-guard.mjs';

const fr = Math.fround;

const __test = {
  name: 'wp-time-loop',
  run() {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const same = (a, b, msg) => ok(Object.is(a, b), `${msg}: ${a} !== ${b}`);

    // ---------------------------------------------------------------- constants
    ok(TICK_HZ === 60 && Math.abs(TICK_MS - 1000 / 60) < 1e-12 && STEP_ELAPSED === 0.5, 'fixed 60 Hz step, measured frame time 0.5 game ticks');

    // ---------------------------------------------------------------- nextDt (FUN_00443e40)
    {
      // the first five frames (frame counter < 5) run at 1.0 whatever the frame time is, then the measured 0.5
      let d = 1; const seq = [];
      for (let f = 0; f < 10; f++) { d = nextDt(f, d); seq.push(d); }
      ok(seq.join() === '1,1,1,1,1,0.5,0.5,0.5,0.5,0.5', `dt sequence ${seq}`);
      // also with a bogus elapsed in the first frames
      same(nextDt(0, 1, 7), 1, 'frame 0 ignores the elapsed time');
      same(nextDt(4, 0.5, 0.01), 1, 'frame 4 still 1.0');
      // a stall: elapsed over 15 counts as 1.0 (from frame 5 on)
      same(nextDt(7, 0.5, 20), 1, 'stall (elapsed 20) -> 1.0');
      same(nextDt(7, 1, 15), 15 / 1 >= 3 ? fr(3 * 1) : 15, 'elapsed exactly 15 is not a stall, then the 3x cap');
      // growth is capped at 3x of the previous step
      same(nextDt(7, 0.5, 2), 1.5, 'prev 0.5, elapsed 2 -> 1.5 (3x cap)');
      same(nextDt(7, 0.5, 1.5), 1.5, 'prev 0.5, elapsed 1.5 -> 1.5 (the cap condition 3 <= 3 holds)');
      same(nextDt(7, 0.5, 1.4), fr(1.4), 'prev 0.5, elapsed 1.4 -> 1.4 as a float32');
      same(nextDt(5, 0.1, 0.5), fr(3 * fr(0.1)), 'prev 0.1 (a float32), elapsed 0.5: 3 * prev rounded to a float32');
      ok(nextDt(7, 0.5, 0.3) === fr(0.3), 'a shorter frame time is taken as it is (float32)');
      // a very long run at 60 Hz stays at 0.5
      let e = 1; for (let f = 0; f < 5000; f++) e = nextDt(f, e);
      same(e, 0.5, 'dt after 5000 frames');
      // every result is a float32
      for (const [fn, p, el] of [[9, 0.3, 0.7], [9, 0.7, 0.0123], [9, 1.3, 2.2], [9, 0.25, 0.9]]) { const r = nextDt(fn, p, el); ok(r === fr(r), `nextDt(${fn}, ${p}, ${el}) is a float32`); }
    }

    // ---------------------------------------------------------------- World.advanceDt, the pass log and the particle tickers
    {
      const w = new World();
      ok(w.dt === 1 && w.invDt === 1 && w.frame === 0 && w.passes === 0, 'fresh world');
      const order = [];
      const rm = addParticleTicker(w, () => order.push(`tick@dt${w.dt}`));
      const seq = [], inv = [];
      for (let i = 0; i < 8; i++) {
        w.camera.c[0] = i; w.camera.c[1] = 2 * i; w.camera.c[2] = 3 * i;
        w.tick();           // World.tick does not touch the step time; the pre-render pass advances the frame counter
        w.advanceDt();
        seq.push(w.dt); inv.push(w.invDt);
      }
      // tick i runs at frame i (the counter the pre-render pass advanced is already i + 1 when advanceDt asks nextDt): frames 0..3 -> after the 5th step the step is 0.5
      ok(seq.join() === '1,1,1,1,0.5,0.5,0.5,0.5', `advanceDt sequence ${seq}`);
      ok(inv.every((x, i) => x === fr(1 / seq[i])), 'invDt = float32 1 / dt');
      ok(w.frame === 8 && w.tickCount === 8 && w.passes === 8, `counters frame ${w.frame} tick ${w.tickCount} passes ${w.passes}`);
      // the particle tickers run once per pass, BEFORE the dt changes (they see the pass's own dt)
      ok(order.length === 8 && order.slice(0, 5).every((s) => s === 'tick@dt1') && order[5] === 'tick@dt0.5', `ticker order ${order.join()}`);
      // the pass log holds each pass's own dt and the camera position its draw saw
      ok(w.passDt[0] === 1 && w.passDt[4] === 1 && w.passDt[5] === 0.5 && w.passDt[7] === 0.5, 'pass log: dt of the pass');
      ok(w.passEye[3 * 5] === 5 && w.passEye[3 * 5 + 1] === 10 && w.passEye[3 * 5 + 2] === 15, 'pass log: camera of the pass');
      rm();
      w.advanceDt();
      ok(order.length === 8, 'a removed ticker no longer runs');
      // the ring wraps
      for (let i = 0; i < PASS_LOG + 3; i++) { w.camera.c[0] = 1000 + i; w.advanceDt(); }
      ok(w.passes === 9 + PASS_LOG + 3 && w.passEye[(w.passes - 1 & (PASS_LOG - 1)) * 3] === 1000 + PASS_LOG + 2, 'the pass ring wraps');
      // a stall rule through the world: the node tests set dt by hand, the loop never feeds a stall (fixed step)
      const w2 = new World(); w2.frame = 9; w2.dt = 0.5; w2.advanceDt(); same(w2.dt, 0.5, 'steady 60 Hz keeps 0.5');
    }

    // ---------------------------------------------------------------- the C runtime (src/game/crt.ts)
    {
      setRandSource(null);
      srand(1);
      const first = [rand(), rand(), rand(), rand(), rand()];
      ok(first.join() === '41,18467,6334,26500,19169', `srand(1): ${first}`);
      srand(1); ok(rand() === 41, 'srand reseeds');
      srand(0); const z = [rand(), rand()]; srand(0); ok(rand() === z[0] && rand() === z[1], 'srand(0) is repeatable');
      // the LCG itself: seed * 0x343fd + 0x269ec3 (32 bit), (seed >> 16) & 0x7fff
      { let s = 12345; srand(12345); let good = true; for (let i = 0; i < 1000; i++) { s = (Math.imul(s, 0x343fd) + 0x269ec3) >>> 0; if (rand() !== ((s >>> 16) & 0x7fff)) good = false; } ok(good, 'LCG formula over 1000 draws'); }
      // FUN_004388ae: x <= 0 gives 0 without drawing; (float)rand() / 32767 * x in float32; the maximum rand gives exactly x
      srand(1); same(randF(0), 0, 'randF(0)'); same(randF(-3), 0, 'randF(-3)'); same(rand(), 41, 'randF(<=0) draws nothing');
      srand(1); same(randF(10), fr(fr(41 / 32767) * 10), 'randF(10) = float32(41 / 32767) * 10');
      srand(1); same(randF(0.1), fr(fr(41 / 32767) * fr(0.1)), 'randF(0.1): the argument is a float');
      setRandSource(() => 32767); same(randF(7.5), 7.5, 'randF can equal x'); same(randD(7.5), 7.5, 'randD can equal x');
      setRandSource(() => 0); same(randF(7.5), 0, 'randF(x) with rand 0');
      // randD keeps the wider intermediate: rand / 32767 * x in double
      setRandSource(() => 41); same(randD(10), (41 / 32767) * 10, 'randD(10) double intermediate'); same(randD(0), 0, 'randD(0)');
      // injection: a scripted source (masked to 15 bits), srand moves the LCG underneath, null restores it
      const script = [5, 100, 40000]; let k = 0;
      setRandSource(() => script[k++]);
      ok(getRandSource() !== null, 'getRandSource');
      ok(rand() === 5 && rand() === 100 && rand() === (40000 & 0x7fff), 'a scripted source is read in order, masked to 0..32767');
      srand(1);
      setRandSource(null);
      ok(getRandSource() === null && rand() === 41, 'null restores the LCG at the seed srand set (srand works underneath an injected source)');
      // time / GetTickCount sources
      setTimeSource(() => 1234); same(time(), 1234, 'time source'); seedFromTime(); same(rand(), (() => { let s = 1234; s = (Math.imul(s, 0x343fd) + 0x269ec3) >>> 0; return (s >>> 16) & 0x7fff; })(), 'seedFromTime = srand(time())');
      setTimeSource(null); ok(Math.abs(time() - Math.floor(Date.now() / 1000)) <= 1, 'time() defaults to the clock');
      setTickCountSource(() => 0xfffffff0 + 32); same(getTickCount(), 16, 'GetTickCount wraps to 32 bit');
      setTickCountSource(null); ok(getTickCount() >= 0, 'GetTickCount default');
      setRandSource(null); seedFromTime();
    }

    // ---------------------------------------------------------------- animated textures (FUN_00410ff8 / FUN_004111a3)
    {
      const uploads = [];
      const gl = { TEXTURE_2D: 1, UNPACK_ALIGNMENT: 2, RGBA: 3, UNSIGNED_BYTE: 4, bindTexture() {}, pixelStorei() {}, texSubImage2D(_t, _l, _x, _y, _w, _h, _f, _ty, data) { uploads.push(data[0]); }, generateMipmap() {} };
      const R = Object.create(Renderer.prototype);
      R.gl = gl; R.animated = new Set(); R.loadDt = 0.5;
      const frames = [0, 1, 2, 3].map((i) => new Uint8Array([i, 0, 0, 255]));
      const mk = (seq, mode, timer) => ({ tex: {}, w: 1, h: 1, mips: false, anim: { frames, sequence: Uint32Array.from(seq), timer, current: seq[0], mode, last: mode === 2 ? -1 : 0, want: seq[0] } });
      const shown = (t, n, dt) => { const out = []; for (let i = 0; i < n; i++) { R.stepTextures(dt); out.push(t.anim.want); } return out; };
      // a looping sheet at dt 0.5: every entry is shown for two passes; the timer is a float32 and restarts at 0 (not modulo)
      { const t = mk([0, 1, 2, 3], 0, fr(0.5)); R.animated = new Set([t]); const s = shown(t, 10, 0.5); ok(s.join() === '0,1,1,2,2,3,3,0,0,1', `loop dt 0.5 (the load pass already added 0.5): ${s}`); }
      { const t = mk([0, 1, 2, 3], 0, fr(0.5)); R.animated = new Set([t]); const s = shown(t, 6, 1); ok(s.join() === '0,1,2,3,0,1', `loop dt 1: ${s}`); }
      // the timer restarts at exactly 0 (overshoot is dropped)
      { const t = mk([0, 1, 2, 3], 0, 3.75); R.animated = new Set([t]); R.stepTextures(0.5); same(t.anim.timer, 0, 'mode 0: the timer is set to 0 when it reaches the length'); }
      // mode 1 plays once, holds `length - 1.0` and turns into mode 2
      { const t = mk([0, 1, 2, 3], 1, 3.5); R.animated = new Set([t]); R.stepTextures(0.5); ok(t.anim.mode === 2 && t.anim.timer === 3, `mode 1 -> 2 at the end (timer ${t.anim.timer})`); const w0 = t.anim.want; R.stepTextures(0.5); R.stepTextures(0.5); ok(t.anim.want === w0 && t.anim.timer === 3, 'mode 2 holds the last entry'); }
      // mode 2 on an entry already shown does nothing: no timer step
      { const t = mk([0, 1, 2, 3], 2, 2); t.anim.last = 2; R.animated = new Set([t]); R.stepTextures(0.5); same(t.anim.timer, 2, 'mode 2: the timer stays'); }
      // the timer add is a float32 add of dt (1.0 * dt first)
      { const t = mk([0, 1, 2, 3], 0, fr(0.1)); R.animated = new Set([t]); R.stepTextures(fr(0.1)); same(t.anim.timer, fr(fr(0.1) + fr(0.1)), 'float32 timer step'); }
      // the upload happens once per frame however many passes were stepped
      { uploads.length = 0; const t = mk([0, 1, 2, 3], 0, fr(0.5)); R.animated = new Set([t]); R.stepTextures(1); R.stepTextures(1); R.stepTextures(1); R.flushTextures(); ok(uploads.length === 1, 'one upload for three stepped passes'); ok(t.anim.current === t.anim.want, 'the GPU copy shows the last entry'); R.flushTextures(); ok(uploads.length === 1, 'nothing to upload twice'); }
      // setTextureFrame semantics: mode 0..2 stored, a valid frame sets the timer and the entry; an invalid frame leaves the timer
      { const t = mk([0, 1, 2, 3], 2, 0); R.animated = new Set([t]); R.texture = () => t; R.setTextureFrame({}, 0, 2, 3); ok(t.anim.timer === 3 && t.anim.mode === 2 && t.anim.current === 3, 'setTextureFrame(2, 3)'); R.setTextureFrame({}, 0, 0, 9); ok(t.anim.mode === 0 && t.anim.timer === 3, 'a frame out of range leaves the timer, the mode is still set'); R.setTextureFrame({}, 0, 7, -1); ok(t.anim.mode === 0, 'a mode out of range is ignored'); }
      // updateTextures (the viewer's loop) = one pass + its upload
      { uploads.length = 0; const t = mk([0, 1, 2, 3], 0, fr(0.5)); R.animated = new Set([t]); R.updateTextures(1); ok(t.anim.timer === 1.5 && t.anim.current === 0, 'updateTextures = stepTextures + flushTextures'); }
    }

    // ---------------------------------------------------------------- sky / sea state steps are per pass, in the game's unit (no wall time, no 30 Hz factor)
    {
      const sky = new SkyState(true); sky.update(1); sky.update(0.5);
      ok(Math.abs(sky.angle - SKY_SPIN * 1.5) < 1e-15, 'sky angle steps SKY_SPIN * dt per pass');
      const sea = new SeaState(); sea.update(1); sea.update(0.5); sea.update(0.5);
      ok(Math.abs(sea.phaseA - SEA_PHASE_A * 2) < 1e-15 && Math.abs(sea.phaseB - SEA_PHASE_B * 2) < 1e-15, 'sea phases step per pass by dt');
    }

    // ---------------------------------------------------------------- GameRenderer replays the passes it has not drawn yet
    {
      const w = new World();
      const G = Object.create(GameRenderer.prototype);
      G.loaded = { world: w }; G.seenPass = 0; G.stepSetups = new Array(PASS_LOG);
      const take = () => G.takePasses();
      ok(take().length === 0, 'no pass, nothing to replay (a rAF between two steps draws the last frame again)');
      w.camera.c[0] = 7; w.advanceDt();
      let p = take(); ok(p.length === 1 && p[0].dt === 1 && p[0].eye[0] === 7, 'one pass');
      ok(take().length === 0, 'a pass is replayed once');
      w.frame = 20; w.dt = 0.5; for (let i = 0; i < 3; i++) { w.camera.c[0] = 10 + i; w.advanceDt(); }
      p = take(); ok(p.length === 3 && p.every((q) => q.dt === 0.5) && p.map((q) => q.eye[0]).join() === '10,11,12', 'three passes in order with their own dt / camera');
      for (let i = 0; i < PASS_LOG + 10; i++) w.advanceDt();
      ok(take().length === PASS_LOG, 'a long stall replays at most the ring');
    }


    // ---------------------------------------------------------------- FrameClock: one pass per drawn frame at most, the measured frame time when the browser is late
    {
      // a steady 60 Hz display (with microsecond jitter): every frame one pass with the nominal frame time 0.5, never a skipped pass
      { const c = new FrameClock(0); let t = 0, n = 0, bad = 0;
        for (let i = 0; i < 600; i++) { t += TICK_MS + (i % 2 ? 0.05 : -0.05); const e = c.frame(t); if (e === null) bad++; else { n++; if (e !== STEP_ELAPSED) bad++; } }
        ok(n === 600 && bad === 0, `steady 60 Hz: ${n} passes, ${bad} irregular`); }
      // a 120 Hz display: every second frame a pass, still 0.5; 144 Hz: about 60 passes per second
      { const c = new FrameClock(0); let t = 0, n = 0, bad = 0;
        for (let i = 0; i < 240; i++) { t += 1000 / 120; const e = c.frame(t); if (e !== null) { n++; if (e !== STEP_ELAPSED) bad++; } }
        ok(n === 120 && bad === 0, `120 Hz: ${n} passes in 2 s, ${bad} with another frame time`); }
      { const c = new FrameClock(0); let t = 0, n = 0;
        for (let i = 0; i < 1440; i++) { t += 1000 / 144; if (c.frame(t) !== null) n++; }
        ok(Math.abs(n - 600) <= 2, `144 Hz: ${n} passes in 10 s`); }
      // a slow frame (>= 1.5 ticks) is ONE pass with the measured frame time in the game's unit (ms / (1000 / 30)); the accumulator restarts
      { const c = new FrameClock(0); let t = 0;
        t += TICK_MS; c.frame(t);
        t += 100; same(c.frame(t), 3, 'a 100 ms frame measures 3.0 game ticks');
        t += TICK_MS; same(c.frame(t), STEP_ELAPSED, 'back at 60 Hz: nominal again (no catch-up passes)');
        t += 50; same(c.frame(t), 50 * 0.03, 'a 50 ms frame');
        t += 24; ok(c.frame(t) === STEP_ELAPSED, 'under 1.5 ticks stays nominal');
        t += 5000; same(c.frame(t), 150, 'a 5 s stall measures 150 (nextDt turns it into 1.0)'); }
      // the 30 Hz limiter of z03PPH: nominal frame time 1 every 1000 / 30 ms, a late frame measured
      { const c = new FrameClock(0, 1000 / 30, 1); let t = 0, n = 0;
        for (let i = 0; i < 120; i++) { t += TICK_MS; const e = c.frame(t); if (e !== null) { n++; same(e, 1, '30 Hz pass frame time'); } }
        ok(n === 60, `30 Hz limiter: ${n} passes in 2 s`);
        t += 80; ok(Math.abs(c.frame(t) - 2.4) < 1e-9, 'a late 30 Hz frame is measured'); }
      // the deterministic harness mode (WebDriver / ?det=1): fixed nominal passes, as many as the time owes (the old catch-up, at most 10); a normal clock never does that
      { const d = new FrameClock(0, TICK_MS, STEP_ELAPSED, true); let t = 0;
        t += 101; const a = d.take(t);
        ok(a.length === 6 && a.every((e) => e === STEP_ELAPSED), `det mode after a 101 ms frame: ${a.length} nominal passes`);
        t += 5000; ok(d.take(t).length === 10, 'det mode caps the catch-up at 10 passes');
        t += TICK_MS; ok(d.take(t).length === 1, 'det mode at 60 Hz: one pass per frame');
        const n = new FrameClock(0, TICK_MS, STEP_ELAPSED, false); const b = n.take(100);
        ok(b.length === 1 && Math.abs(b[0] - 3) < 1e-9, 'normal mode after a 100 ms frame: ONE pass with the measured 3.0'); }
      // through advanceDt: a slow rAF is ONE pass with a larger dt, capped at 3x of the previous one; a stall counts as 1.0
      { const w = new World(); w.frame = 20; w.dt = 0.5; w.invDt = 2;
        const c = new FrameClock(0); let t = 0; const log = [];
        const step = (ms) => { t += ms; const e = c.frame(t); if (e !== null) { w.advanceDt(e); log.push(w.dt); } };
        step(TICK_MS); step(TICK_MS);                 // steady: 0.5
        step(66);                                     // 66 ms = 1.98: the pass ran with 0.5, the NEXT step is min(1.98, 3 * 0.5) = 1.5
        step(66);                                     // again 1.98: 3 * 1.5 is not reached, 1.98 as float32
        step(TICK_MS);                                // back to 0.5
        step(2000);                                   // a stall (60 > 15): 1.0
        step(TICK_MS);
        ok(log.join() === [0.5, 0.5, 1.5, fr(1.98), 0.5, 1, 0.5].join(), `dt through slow frames: ${log}`);
        ok(w.passes === 7, 'one logged pass per advanceDt (never several in a frame)'); }
    }

    // ---------------------------------------------------------------- the pass log carries the pass's own far / fog set-up
    {
      const w = new World();
      const G = Object.create(GameRenderer.prototype);
      G.loaded = { world: w }; G.seenPass = 0; G.stepSetups = new Array(PASS_LOG);
      // stepView writes the set-up of the pass about to be logged: stub the view set-up it reads
      let far = 500;
      G.viewSetup = () => ({ viewProj: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]), setup: { far, fog: { enabled: far > 600, end: far - 50 } } });
      G.planes = null;
      w.camera.c[0] = 1; G.stepView(); w.advanceDt();
      far = 900; w.camera.c[0] = 2; G.stepView(); w.advanceDt();
      far = 300; w.camera.c[0] = 3; G.stepView(); w.advanceDt();
      const p = G.takePasses();
      ok(p.length === 3 && p.map((q) => q.setup && q.setup.far).join() === '500,900,300', `each pass has its own far: ${p.map((q) => q.setup && q.setup.far)}`);
      ok(p[1].setup.fogOn === true && p[0].setup.fogOn === false && p[2].setup.fogEnd === 250, 'fog state and end of the pass');
      ok(p.map((q) => q.eye[0]).join() === '1,2,3', 'camera of each pass');
      // a pass nobody logged a set-up for uses the current one (null)
      w.advanceDt();
      ok(G.takePasses()[0].setup === null, 'a pass without a logged set-up: null');
    }

    return { checked, failures, notes };
  },
};
export default guarded(__test);
