// Section 4 "Camera en tekenen", part 3: the permanently-off level-of-detail switches of the original (docs/re/unused.md 6.7), pure logic.
//
//   Adaptive detail  DAT_009e56b8 (never written, 0 in the file; 1 = adaptive, 2 = adaptive with the fade table 0x8b576c)
//     FUN_00443e40(frame) (once per frame, called by every zone loop after the frame): the frame time since the last call is compared with the frame period (DAT_009e07f8 / 07fc =
//       ftol(QueryPerformanceFrequency * the double _DAT_00892260 = 1/30 s)): longer than the period: FUN_00443d10(+1, frame); shorter than the period minus 10000 counter ticks: FUN_00443d10(-1, frame).
//     FUN_00443d10(p1, frame) (LE2.c:37184): only with DAT_009e56b8 != 0: DAT_009e56c0 = frame; when `frame` is not the frame after the last call DAT_009e56c4 = 0 and return; DAT_009e56c4++;
//       with the OLD count > 9 (11 calls in a row): p1 < 0 (time to spare): level 4: the far clip DAT_0089df34 < _DAT_00892258 (390) -> += _DAT_00892254 (50), else level = 3; level 1..3: level += p1;
//       p1 > 0 (too slow): level < 4: level += p1, else the far clip > _DAT_00892250 (240) -> -= 50. Level DAT_009e56bc is 0 .. 4.
//     FUN_00443f90(model, record) (the part / LOD choice, LE2.c:37319): the flag bits 0x100 / 0x200 / 0x400 force part 0 / 1 / 2; the record named PEPP (strncmp of DAT_008b5890 = "PEPP") starts at part 0
//       with the plain thresholds; every other record: mode 1: parts below `level + 1` are skipped (the result is at least `level`), mode 2: starts at part 1 and the thresholds are scaled by the fade
//       table entry of the level (1.0, 0.8, 0.6, 0.4, 0.2); the last part k with (scale * lod_k)^2 < zoom * distance^2 wins.
//   Debug LOD  DAT_05d37024 (never written): FUN_0044d420 (the skeleton skin, LE2.c:42517) uses LOD DAT_008b6c54 (= 2) for every skinned entity instead of the two squared-distance thresholds
//     _DAT_008922c8 (1280: below = LOD 0) and _DAT_008922c4 (7200: below = LOD 1, else 2).
// What the port reproduces: the part choice of FUN_00443f90 (exact function, tested against the executable in the emulator), the level / far clip logic of FUN_00443d10 (exact function, tested), the
// frame-time decision of FUN_00443e40 (driven by `performance.now()` per DRAWN frame, with an assumed counter frequency: bij benadering). The skeleton skin LOD of FUN_0044d420 has no counterpart: the port
// skins with its model parts, so the debug LOD forces the PART (mesh LOD) of skinned records to DAT_008b6c54 (the same index, an equivalence that is UNCERTAIN) and, as an extension, optionally of all records.
const fr = Math.fround;
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
const F64 = new Float64Array(1), U64 = new Uint32Array(F64.buffer);
export interface ExeWords { u32(va: number): number }
const rf = (pe: ExeWords, va: number): number => { U32[0] = pe.u32(va); return F32[0]; };
const rd = (pe: ExeWords, va: number): number => { U64[0] = pe.u32(va); U64[1] = pe.u32(va + 4); return F64[0]; };

export const LOD_VA = {
  FAR_MIN: 0x892250, FAR_STEP: 0x892254, FAR_MAX: 0x892258, PERIOD: 0x892260, FADE_TABLE: 0x8b576c, DEBUG_LOD: 0x8b6c54, SKIN_FAR: 0x8922c4, SKIN_NEAR: 0x8922c8,
  /** DAT_009e56b8 / bc / c0 / c4 */ MODE: 0x9e56b8, LEVEL: 0x9e56bc, LAST: 0x9e56c0, RUN: 0x9e56c4,
  /** DAT_0089df34: the far clip (400.0 in the file), DAT_0089df2c: the zoom (1.0) */ FAR: 0x89df34, ZOOM: 0x89df2c,
  /** DAT_05d37024: the debug LOD flag */ DEBUG_FLAG: 0x5d37024,
  /** "PEPP" (DAT_008b5890) */ PEPP: 0x8b5890,
} as const;

export interface LodConsts { farMin: number; farStep: number; farMax: number; period: number; fade: number[]; debugLod: number; skinNear: number; skinFar: number; far0: number }
export function readLodConsts(pe: ExeWords): LodConsts {
  return {
    farMin: rf(pe, LOD_VA.FAR_MIN), farStep: rf(pe, LOD_VA.FAR_STEP), farMax: rf(pe, LOD_VA.FAR_MAX), period: rd(pe, LOD_VA.PERIOD),
    fade: [0, 1, 2, 3, 4].map((i) => rf(pe, LOD_VA.FADE_TABLE + 4 * i)), debugLod: pe.u32(LOD_VA.DEBUG_LOD) & 0xff,
    skinNear: rf(pe, LOD_VA.SKIN_NEAR), skinFar: rf(pe, LOD_VA.SKIN_FAR), far0: rf(pe, LOD_VA.FAR),
  };
}

export class AdaptiveDetail {
  /** DAT_009e56b8: 0 off, 1 adaptive, 2 adaptive with the fade table */
  mode = 0;
  /** DAT_009e56bc */ level = 0;
  /** DAT_009e56c0 */ last = 0;
  /** DAT_009e56c4 */ run = 0;
  /** DAT_0089df34 */ far: number;
  readonly k: LodConsts;
  constructor(k: LodConsts) { this.k = k; this.far = k.far0; }

  /** FUN_00443cf0(far) */
  resetFar(far: number) { this.level = 0; this.far = far; this.run = 0; }

  /** FUN_00443d10(p1, frame) */
  step(p1: number, frame: number) {
    if (this.mode === 0) return;
    const prev = this.last, old = this.run;
    this.last = frame;
    if (frame - prev !== 1) { this.run = 0; return; }
    this.run = old + 1;
    if (9 < old) {
      if (p1 < 0) {
        if (this.level === 4) {
          if (this.far < this.k.farMax) { this.far = fr(this.far + this.k.farStep); return; }
          this.level = p1 + 4;
          return;
        }
        if (this.level !== 0) { this.level += p1; return; }
      } else {
        if (this.level < 4) { this.level += p1; return; }
        if (this.k.farMin < this.far) this.far = fr(this.far - this.k.farStep);
      }
    }
  }

  /**
   * FUN_00443e40's decision for one frame: `elapsed` and `period` / `margin` in the same unit (counter ticks). The original's counter has the elapsed time as a 64 bit value `since the last call`.
   * Returns the p1 passed on (+1, -1) or 0 when FUN_00443d10 is not called.
   */
  frameTime(elapsed: number, period: number, margin: number, frame: number): number {
    let p1 = 0;
    if (elapsed > period) p1 = 1; else if (elapsed < period - margin) p1 = -1;
    if (p1 !== 0) this.step(p1, frame);
    return p1;
  }

  /**
   * FUN_00443f90(model, record): the part index for a record whose flags do not force one. `lods` = the squared-distance switch-in values of the model's parts (+4 of each 0x14 entry),
   * `name4` = the record's name, `distSq` = FUN_0040c796 (squared distance to the eye), `zoom` = DAT_0089df2c. Every product is a float32 (compiled x87 in 24 bit mode).
   */
  choose(lods: readonly number[], flags: number, name4: string, distSq: number, zoom: number): number {
    const n = lods.length;
    if (n < 2) return 0;
    if (flags & 0x100) return 0;
    if (flags & 0x200) return 1;
    if ((flags & 0x400) && n > 1) return 2;
    const isPepp = name4.slice(0, 4).toLowerCase() === 'pepp';
    let u4: number, u6: number, scale = 1;
    if (isPepp) { u6 = 0; u4 = 0; }
    else {
      if (this.mode === 2) { u4 = 1; scale = this.k.fade[Math.max(0, Math.min(4, this.level))]; }
      else u4 = this.level + 1;
      if (n <= u4) return n - 1;
      u6 = u4 - 1;
      if (u6 < 0) u6 = 0;
    }
    const lhs = fr(zoom * distSq);
    for (let k = u4; k < n; k++) {
      const t = fr(fr(fr(scale * lods[k]) * scale) * lods[k]);
      if (t < lhs) u6 = k;
    }
    return u6;
  }
}

/** FUN_0044d420's skeleton LOD by squared distance (for the UI: which LOD the original's skin would use for an entity at this distance) */
export function skinLod(k: LodConsts, distSq: number, forced = false): number {
  if (forced) return k.debugLod;
  return distSq >= k.skinNear ? (distSq >= k.skinFar ? 2 : 1) : 0;
}
