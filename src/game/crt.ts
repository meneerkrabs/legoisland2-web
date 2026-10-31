// The C runtime of the original as the game uses it (T2 in docs/re/gaps.md): ONE global rand() / srand() (MSVC LCG), time() and GetTickCount().
//   FUN_0085daf0 (rand):  seed = seed * 0x343fd + 0x269ec3;  return (seed >> 16) & 0x7fff        (seed DAT_00964aa4)
//   FUN_0043895b (srand): seed = x
//   FUN_004388ae (x):     x <= 0 ? 0 : (float)rand() / 32767.0f * x     (every operation a float32 at the x87's 24-bit precision; can equal x; 272 call sites)
// srand(time()) runs at start-up (FUN_00402bac: `seedFromTime()` in the shell's boot), again at the start of z05WAB (FUN_00569ca6), z17WAS (FUN_00699dc7) and
// z42BRP (FUN_008212a3), and srand(1) at z22BIP (FUN_0070b7b2). All game code draws from this one generator, in the order of the original's call sites.
// Tests inject a scripted source with `setRandSource` (a function returning rand()'s 0..32767); `srand` still moves the LCG underneath, so a test that does not
// inject sees exactly the original's sequence for a given seed.

/** the generator behind rand(): the original's LCG */
let seed = 1;
let injected: (() => number) | null = null;

/** FUN_0043895b: srand(x) */
export function srand(x: number): void { seed = x >>> 0; }

/** srand(time(NULL)): the start-up and zone-start seeding of the original */
export function seedFromTime(): void { srand(time()); }

/** FUN_0085daf0: rand(), 0 .. 32767 */
export function rand(): number {
  if (injected) return injected() & 0x7fff;
  seed = (Math.imul(seed, 0x343fd) + 0x269ec3) >>> 0;
  return (seed >>> 16) & 0x7fff;
}

/** tests: replace rand() by a scripted source (returns 0 .. 32767); null restores the LCG */
export function setRandSource(f: (() => number) | null): void { injected = f; }
export const getRandSource = (): (() => number) | null => injected;

const fr = Math.fround;
/** FUN_004388ae(x): `(float)rand() / 32767.0f * x`, float32 operations; x <= 0 gives 0 without a draw */
export function randF(x: number): number { return x <= 0 ? 0 : fr(fr(rand() / 32767) * fr(x)); }
/** the same in the x87's wider intermediate, for call sites whose result is not stored before the next operation (`rand() / 32767 * x` in double, e.g. `ftol(rand(x))`) */
export function randD(x: number): number { return x <= 0 ? 0 : (rand() / 32767) * x; }

/** time(NULL): seconds since the epoch (injectable for tests) */
let timeSrc: () => number = () => Math.floor(Date.now() / 1000);
export function time(): number { return timeSrc(); }
export function setTimeSource(f: (() => number) | null): void { timeSrc = f ?? (() => Math.floor(Date.now() / 1000)); }

/** GetTickCount(): milliseconds since the machine's start (here: since the page's start; only differences matter) (injectable for tests) */
let tickSrc: () => number = () => Math.floor(performance.now());
export function getTickCount(): number { return tickSrc() >>> 0; }
export function setTickCountSource(f: (() => number) | null): void { tickSrc = f ?? (() => Math.floor(performance.now())); }

// the generator starts out seeded with the clock like the original's start-up (the shell seeds again at boot)
seedFromTime();
