// z01BPK in node (tests and bots): the zone world built from the archive + the executable, the node chain / start state of src/zones/z01bpk/setup.ts, a recording sound sink
// and a `step(held)` that runs one tick with the given button mask.
import { loadZone } from './engine-load.mjs';
import { parseBlk } from '../../src/formats/anim.ts';
import '../../src/zones/z01BPK.ts';
import { prepareBpk } from '../../src/zones/z01bpk/setup.ts';
import { finishGame } from '../../src/zones/z01bpk/run.ts';

export function loadBpk(ctx, { vars = {} } = {}) {
  const L = loadZone(ctx, 'z01BPK');
  const archive = L.archive;
  const rig = (n) => { const e = archive.find(`anim/${n}.blk`); return e ? parseBlk(archive.read(e)) : null; };
  const g = prepareBpk(L.world, L.pepper, { MFIG: rig('MFIG'), SKBD: rig('SKBD') }, L.pe);
  const w = L.world;
  w.externalInput = true;
  for (const [k, v] of Object.entries(vars)) w.vars.set(+k, v);
  g.swc.onEnd = (score) => finishGame(g.run, w.vars, score);
  /** every sound the nodes ask for: [{ op: 'play' | 'stop' | 'wheels', id, on? }] */
  const sounds = [];
  g.run.sounds = {
    play: (id) => sounds.push({ op: 'play', id, tick: w.tickCount }),
    stop: (id) => sounds.push({ op: 'stop', id, tick: w.tickCount }),
    wheels: (on, pos) => sounds.push({ op: 'wheels', on, pos: [...pos], tick: w.tickCount }),
  };
  const game = { ...g, world: w, sounds };
  /** one tick with the buttons `held` down */
  const step = (held = 0) => {
    const inp = w.input;
    inp.prevHeld = inp.held; inp.held = held; inp.pressed = (held ^ inp.prevHeld) & held;
    w.tick();
  };
  const run = (n, held = 0, each) => { for (let i = 0; i < n; i++) { step(typeof held === 'function' ? held(i) : held); each?.(i); } };
  return { L, g: game, w, P: L.pepper, step, run, sounds };
}
