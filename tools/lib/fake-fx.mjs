// A recording stand-in for ZoneParticles (src/fx/particles/zone.ts) for the island node tests: the island nodes start / gate / move their emitters through
// `IslandCtx.fx` exactly like the original's FUN_00442960 / FUN_00442a20 / FUN_00442a00 / FUN_0044ebd0 calls; this keeps the calls, hands out the original's handle
// numbers (sources 0.., swirls 0x1000 + i) and answers "is this emitter emitting now" (a gate (var, mask, value) is open when (var-value & mask) == value, var 1
// always reads 0, var 2 always 1; any other variable from `vars`).
//   const fx = new FakeFx(world); ictx.fx = fx;
//   fx.log        [{ op: 'start' | 'swirl' | 'gate' | 'matrix' | 'param' | 'stop' | 'coll' | 'finish', h, name, ..., tick }]
//   fx.emitters   handle -> { name, matrix, pos, rot, gate, stopped }
//   fx.find(name) the emitters called `name` (case-insensitive, with or without .par)
//   fx.isOn(h)    gate open (the emitter would emit this tick)
export class FakeFx {
  constructor(world) { this.world = world; this.log = []; this.emitters = new Map(); this.n = 0; this.nSwirl = 0; this.ticks = 0; }
  tick() { return this.world.tickCount; }
  start(name, matrix, pos, rot, gate = [1, 1, 1]) {
    const h = this.n++;
    this.emitters.set(h, { h, name, matrix, pos: [...pos], rot: [...rot], gate: [...gate], stopped: false, params: new Map() });
    this.log.push({ op: 'start', h, name, pos: [...pos], rot: [...rot], gate: [...gate], tick: this.tick() });
    return h;
  }
  startSwirl(name, pos, rot, gate = [1, 1, 1]) {
    const h = 0x1000 + this.nSwirl++;
    this.emitters.set(h, { h, name, matrix: null, pos: [...pos], rot: [...rot], gate: [...gate], stopped: false, params: new Map(), swirl: true });
    this.log.push({ op: 'swirl', h, name, pos: [...pos], rot: [...rot], gate: [...gate], tick: this.tick() });
    return h;
  }
  setMatrix(h, m) { const e = this.emitters.get(h); if (e) e.matrix = m; this.log.push({ op: 'matrix', h, name: e?.name, tick: this.tick() }); }
  setGate(h, gate) { const e = this.emitters.get(h); if (e) e.gate = [...gate]; this.log.push({ op: 'gate', h, name: e?.name, gate: [...gate], tick: this.tick() }); }
  on(h) { this.setGate(h, [2, 1, 1]); }
  off(h) { this.setGate(h, [1, 1, 1]); }
  stop(h) { const e = this.emitters.get(h); if (e) e.stopped = true; this.log.push({ op: 'stop', h, name: e?.name, tick: this.tick() }); }
  setParam(h, type, value) { const e = this.emitters.get(h); if (e) e.params.set(type, value); this.log.push({ op: 'param', h, name: e?.name, type, value, tick: this.tick() }); }
  collideWith(h, rec) { this.log.push({ op: 'coll', h, rec: rec?.name, tick: this.tick() }); }
  finish() { this.log.push({ op: 'finish', tick: this.tick() }); }
  setLod() {}
  find(name) {
    const k = name.toLowerCase().replace(/\.(par|swl)$/, '');
    return [...this.emitters.values()].filter((e) => e.name.toLowerCase().replace(/\.(par|swl)$/, '') === k);
  }
  isOn(h) {
    const e = this.emitters.get(h);
    if (!e || e.stopped) return false;
    const [v, mask, value] = e.gate;
    const val = v === 1 ? 0 : v === 2 ? 1 : this.world.vars.get(v);
    return ((val & mask) === value);
  }
  /** the matrix of an emitter as the engine would read it now */
  matrixOf(h) { const m = this.emitters.get(h)?.matrix; return typeof m === 'function' ? m() : m; }
  clear() { this.log.length = 0; }
}
