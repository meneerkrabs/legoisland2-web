// z18MMP coverage test (WP-VERIFY lib, finished by WP-MINI): the original's node code in the x86 interpreter at control word 0x7f (the 24-bit x87 mode Direct3D 7 leaves), 4 ulp tolerance;
// covers the mummy-hit sound variant (FUN_004388ae(tick) % 3), the torch sound per node, the rat ground probe pass.
// (M7_CW is set for the run only: a module-level assignment would leak into the tests that run later in the same process)
const { default: inner } = await import('../lib/m7-z18MMP-cover.dev.mjs');
export default {
  name: inner.name,
  run(ctx) {
    const old = process.env.M7_CW;
    process.env.M7_CW = '127';
    try { return inner.run(ctx); } finally { if (old === undefined) delete process.env.M7_CW; else process.env.M7_CW = old; }
  },
};
