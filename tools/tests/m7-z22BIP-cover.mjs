// z22BIP coverage test (WP-VERIFY lib, finished by WP-MINI): the original's node code in the x86 interpreter at control word 0x7f (24-bit x87), dt 1 and 0.5, every engine call compared.
const inner = (await import('../lib/m7-z22BIP-cover-test.dev.mjs')).default;
export default {
  name: inner.name,
  run(ctx) {
    const old = process.env.M7_CW;
    process.env.M7_CW = '127';
    try { return inner.run(ctx); } finally { if (old === undefined) delete process.env.M7_CW; else process.env.M7_CW = old; }
  },
};
