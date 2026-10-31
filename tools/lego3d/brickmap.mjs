// Brick name of the game (Bricks/brickset.txt) -> LDraw part number, by the naming rules of the game's library plus a few manual entries; verified by measurement in bricks.mjs.
// "fatWxD" = brick (W studs along x, D along z), "thinWxD" = plate, "flatWxD" = tile, "..._45slope" etc. = slopes. LDraw numbers: bricks 3005 1x1, 3004 1x2, 3622 1x3, 3010 1x4, 3009 1x6, 3008 1x8, 6111 1x10, 6112 1x12,
// 3003 2x2, 3002 2x3, 3001 2x4, 2456 2x6, 3007 2x8, 3006 2x10, 2356 4x6, 6212 .. (only the verified ones are used).
const brick = { '1x1': '3005', '2x1': '3004', '3x1': '3622', '4x1': '3010', '6x1': '3009', '8x1': '3008', '10x1': '6111', '12x1': '6112', '2x2': '3003', '3x2': '3002', '4x2': '3001', '6x2': '2456', '8x2': '3007', '10x2': '3006', '4x4': '', '6x4': '2356' };
const plate = { '1x1': '3024', '2x1': '3023', '3x1': '3623', '4x1': '3710', '6x1': '3666', '8x1': '3460', '10x1': '4477', '12x1': '60479', '2x2': '3022', '3x2': '3021', '4x2': '3020', '6x2': '3795', '8x2': '3034', '10x2': '3832', '12x2': '2445', '4x4': '3031', '6x4': '3032', '8x4': '3035', '10x4': '3030', '12x4': '3029', '6x6': '3958', '8x6': '3036', '10x6': '3033', '12x6': '3028', '8x8': '41539', '10x10': '4X10', '12x12': '' };
const tile = { '1x1': '3070b', '2x1': '3069b', '4x1': '2431', '6x1': '6636', '8x1': '4162', '2x2': '3068b' };
export const BRICK_MAP = {};
for (const [k, v] of Object.entries(brick)) if (v) BRICK_MAP[`fat${k}`] = v;
for (const [k, v] of Object.entries(plate)) if (v && !v.includes('X')) BRICK_MAP[`thin${k}`] = v;
for (const [k, v] of Object.entries(tile)) BRICK_MAP[`flat${k}`] = v;
Object.assign(BRICK_MAP, {
  'fat2x2_45slope': '3039', 'fat1x2_45slope': '3040', 'fat2x2_45slopeinvert': '3660', 'fat1x2_45slopeinvert': '3665', 'fat4x3_33slope': '3297', 'fat1x3_33slope': '4286', 'fat3x2_33slope': '3298',
  'fat3x1_6h': '', 'fat1x1_round': '3062b', 'thin1x1_round': '4073', 'cone1x1': '4589', 'fat2x2_pin': '', 'thin1x2_handle2': '', 'thin1x1_clip': '4081b',
  'thin1x1_cliplight': '4081b', 'fat1x1_headlight': '4070', 'tap1x1': '4599b', 'grill2x1': '2412b', 'wheel01': '', 'wheel02': '', 'hemisphere4x4': '', 'dish2x2': '4740', 'dish6x6_webbed': '',
  'roof2x2': '3003', 'roof4x2_sloped': '', 'wedge6x4': '32083',
});
for (const k of Object.keys(BRICK_MAP)) if (!BRICK_MAP[k]) delete BRICK_MAP[k];
