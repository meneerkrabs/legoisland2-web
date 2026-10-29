// The island's sea loop (SND_LGI_SEA, 0x125, a 3D loop loaded by FUN_004b037e into DAT_05d5812c). Pepper's mode switch (PepSwitc pre-render, FUN_004bb67d, the end of the
// function at LE2.c 78269-78368) moves it every frame with FUN_004433f0(DAT_05d5812c, &(x, DAT_009da858, z)): the water level for y and for x / z Pepper's own position, pushed out
// of the square |x|, |z| < 400 to the nearest side of it. On the sea (outside the square) the sound is on Pepper; on the island it comes from the nearest shore line of the square.
// A pile of nested compares of the decompile, reduced (the closed form is verified against a literal transcription of all branches in tools/tests/audio-sea.mjs).
export const SND_LGI_SEA = 0x125;
const SEA_HALF = 400;

/** where the sea sound sits for Pepper at (x, z); `seaY` is the sea level (DAT_009da858) */
export function lgiSeaPosition(x: number, z: number, seaY: number): [number, number, number] {
  // the branch that moves is the one with the larger |coordinate| (a tie moves z); it is pushed out to 400 when inside
  if (Math.abs(z) < Math.abs(x)) return [x >= 0 ? (SEA_HALF <= x ? x : SEA_HALF) : (x <= -SEA_HALF ? x : -SEA_HALF), seaY, z];
  return [x, seaY, z >= 0 ? (SEA_HALF <= z ? z : SEA_HALF) : (z <= -SEA_HALF ? z : -SEA_HALF)];
}
