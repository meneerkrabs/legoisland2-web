// dev loop for ONE body LOD without touching the pack:  CHARS_ONLY=pepp-3 CHARS_VERBOSE=1 node tools/lego3d/pack/chars-try.mjs
process.env.CHARS_ONLY ??= 'pepp-3';
const { build } = await import('./chars.mjs');
await build({ put() {}, use() {}, useSet() {}, log: (m) => console.log(m), lib: null });
