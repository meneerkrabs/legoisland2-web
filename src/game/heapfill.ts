// The original allocates every node (and record array, command list ...) from the DEBUG heap: FUN_00433d38 -> FUN_00858d30 = __nh_malloc_dbg (Visual Studio 2003 debug CRT), which fills a fresh block
// with 0xCD ("clean land"). A byte of a node that its constructor never writes therefore holds 0xCD until some code writes it, and a save file carries it as it is (docs/re/save.md). The ports keep
// such words as plain fields that start with this fill, so a save / load round trip is byte exact and the first tick sees what the original sees.
export const CD8 = 0xcd;
/** 0xCDCDCDCD as an int32 / uint32 / float32 (-4.3e8) */
export const CD32S = 0xcdcdcdcd | 0, CD32U = 0xcdcdcdcd;
export const CD_F32: number = new Float32Array(new Uint32Array([0xcdcdcdcd]).buffer)[0];
