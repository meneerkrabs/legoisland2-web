import islandTest from './m7-walk-island.mjs';

// M7 / WP-VERIFY: the same island scenarios as m7-walk-island at the frame step the port will use after the move to a fixed 60 Hz simulation (dt = 0.5 in the game's unit): the original
// reads DAT_008b1718 (written 0.5 here), the port's world.dt = 0.5; every walk / collision / camera value must again be identical (tolerance 0).
export default {
  name: 'm7-walk-dt',
  async run(ctx) {
    process.env.M7_DT = '0.5';
    try { return await islandTest.run(ctx); } finally { delete process.env.M7_DT; }
  },
};
