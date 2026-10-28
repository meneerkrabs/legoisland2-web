// The Direct3D 7 render-state model of the game: 30 pre-built state blocks ("presets", Material2.cpp FUN_004092fd / FUN_004090a7),
// decoded from the table at VA 0x89b020 of the executable (11 stage-0 texture-stage / render-state entries per preset).
// Everything the presets do not list is global and identical for all draws (docs/re/rendering.md section 4):
//   alpha test ON (ALPHAREF 1, ALPHAFUNC GREATEREQUAL), CULLMODE CCW (clockwise triangles are front faces), ZFUNC LEQUAL,
//   bilinear MAG/MIN filter with MIPFILTER POINT on a single-level texture (the game creates textures without mip chains),
//   texture address mode per texture (text.txl), gouraud shading, D3D lighting OFF (vertices are lit on the CPU), linear fog.

/** stage 0 COLOROP: SELECTARG1 (texture only) / MODULATE (texture * vertex colour) / SELECTARG2 (vertex colour only) */
export type ColorOp = 'tex' | 'mod' | 'diffuse';
/** stage 0 ALPHAOP: DISABLE (alpha = 1) / SELECTARG1 (texture alpha) / MODULATE (texture alpha * vertex alpha) / SELECTARG2 (vertex alpha) / MODULATE4X */
export type AlphaOp = 'one' | 'tex' | 'mod' | 'diffuse' | 'mod4x';
/** off; alpha = SRCALPHA/INVSRCALPHA; add = SRCALPHA/ONE; alphaAlpha = SRCALPHA/SRCALPHA */
export type Blend = 'off' | 'alpha' | 'add' | 'alphaAlpha';

export interface Preset {
  colorOp: ColorOp;
  alphaOp: AlphaOp;
  blend: Blend;
  /** ZENABLE and ZWRITEENABLE (the presets always set both the same) */
  z: boolean;
  /** SPECULARENABLE (set by FUN_004090a7 for presets 4, 5, 0x13, 0x14) */
  specular: boolean;
}

export const PRESETS: readonly Preset[] = [
  /*  0 */ { colorOp: 'tex', alphaOp: 'one', blend: 'off', z: true, specular: false },
  /*  1 */ { colorOp: 'tex', alphaOp: 'tex', blend: 'alpha', z: true, specular: false },
  /*  2 */ { colorOp: 'mod', alphaOp: 'one', blend: 'off', z: true, specular: false },
  /*  3 */ { colorOp: 'mod', alphaOp: 'tex', blend: 'alpha', z: true, specular: false },
  /*  4 */ { colorOp: 'mod', alphaOp: 'one', blend: 'off', z: true, specular: true },
  /*  5 */ { colorOp: 'mod', alphaOp: 'tex', blend: 'alpha', z: true, specular: true },
  /*  6 */ { colorOp: 'mod', alphaOp: 'mod', blend: 'alpha', z: true, specular: false },
  /*  7 */ { colorOp: 'diffuse', alphaOp: 'mod', blend: 'add', z: true, specular: false },
  /*  8 */ { colorOp: 'diffuse', alphaOp: 'mod', blend: 'alphaAlpha', z: true, specular: false },
  /*  9 */ { colorOp: 'diffuse', alphaOp: 'tex', blend: 'add', z: true, specular: false },
  /* 10 */ { colorOp: 'diffuse', alphaOp: 'mod', blend: 'alpha', z: true, specular: false },
  /* 11 */ { colorOp: 'diffuse', alphaOp: 'mod', blend: 'alpha', z: true, specular: false },
  /* 12 */ { colorOp: 'diffuse', alphaOp: 'mod', blend: 'alpha', z: true, specular: false },
  /* 13 */ { colorOp: 'tex', alphaOp: 'mod', blend: 'alpha', z: true, specular: false },
  /* 14 */ { colorOp: 'diffuse', alphaOp: 'diffuse', blend: 'alpha', z: true, specular: false },
  /* 15 */ { colorOp: 'tex', alphaOp: 'one', blend: 'off', z: false, specular: false },
  /* 16 */ { colorOp: 'tex', alphaOp: 'mod', blend: 'alpha', z: false, specular: false },
  /* 17 */ { colorOp: 'mod', alphaOp: 'one', blend: 'off', z: false, specular: false },
  /* 18 */ { colorOp: 'mod', alphaOp: 'tex', blend: 'alpha', z: false, specular: false },
  /* 19 */ { colorOp: 'mod', alphaOp: 'one', blend: 'off', z: false, specular: true },
  /* 20 */ { colorOp: 'mod', alphaOp: 'tex', blend: 'alpha', z: false, specular: true },
  /* 21 */ { colorOp: 'diffuse', alphaOp: 'mod', blend: 'alpha', z: false, specular: false },
  /* 22 */ { colorOp: 'diffuse', alphaOp: 'mod4x', blend: 'alpha', z: false, specular: false },
  /* 23 */ { colorOp: 'diffuse', alphaOp: 'mod', blend: 'alpha', z: false, specular: false },
  /* 24 */ { colorOp: 'diffuse', alphaOp: 'mod4x', blend: 'alpha', z: false, specular: false },
  /* 25 */ { colorOp: 'diffuse', alphaOp: 'mod', blend: 'alpha', z: false, specular: false },
  /* 26 */ { colorOp: 'mod', alphaOp: 'mod', blend: 'alpha', z: false, specular: false },
  /* 27 */ { colorOp: 'diffuse', alphaOp: 'mod', blend: 'alpha', z: false, specular: false },
  /* 28 */ { colorOp: 'diffuse', alphaOp: 'mod4x', blend: 'alpha', z: false, specular: false },
  /* 29 */ { colorOp: 'diffuse', alphaOp: 'diffuse', blend: 'alpha', z: false, specular: false },
];

/** Named presets that other systems select directly with FUN_004092fd(n) */
export const PRESET = {
  /** textured, opaque, no lighting term (mesh mode 6) */
  TEX_OPAQUE: 0,
  /** texture colour + texture alpha, z on (sky, mesh mode 2) */
  TEX_ALPHA: 1,
  /** the default mesh state: texture * vertex colour, texture alpha, blended, z on (mesh modes 0 and 1) */
  LIT: 3,
  /** untextured flat colour with vertex alpha (debug lines, FUN_0087da0b) */
  FLAT_ALPHA: 14,
  /** 2D overlay: texture colour, texture alpha * vertex alpha, no z (sea plane and seabed too) */
  TEX_ALPHA_NOZ: 16,
} as const;

/**
 * Mesh draw `mode` (the third argument of FUN_0087d9a7 = the `mode` field of a model part, set with FUN_00444550) -> preset (FUN_0088aca2 switch).
 * Modes 0, 1 and 4 also light the vertices on the CPU (FUN_0088abcc); mode 0 only the first time, modes 1 and 4... see docs/re/rendering.md 4.3.
 */
export function modePreset(mode: number): number {
  switch (mode) {
    case 0: return 3;
    case 1: return 3;
    case 2: return 1;
    case 3: return 0x10;
    case 4: return 0x12;
    case 5: return 0xd;
    case 6: return 0;
    case 7: return 0x1a;
    default: return 3;
  }
}
