// The vegetation / rock records the environment QA shoots (docs/re/lego3d.md section 19): zone -> [name, record list index in the developer corner, length, height of the LOD 0 mesh, views]
// (5th entry: the views to take instead of the default five: 'qt' = 3/4 and top). Sizes from tools/lego3d/env-inventory.mjs.
export const ENV = {
  z02LGI: [['pine', 83, 9.0, 18.6], ['oak', 252, 12.9, 19.1], ['palm', 180, 16.4, 15.2], ['palm1', 372, 21.2, 23.1], ['bush', 305, 5.0, 5.3], ['cactus-fn', 309, 4.4, 9.0], ['cactus', 310, 5.2, 7.9], ['crystal', 311, 2.6, 3.9],
    ['flower', 312, 2.1, 1.6], ['leaf', 313, 3.5, 1.8], ['fatflow', 314, 0.8, 1.0], ['flowleave', 315, 3.5, 2.3], ['flower1', 81, 3.5, 2.3], ['rocks', 74, 7.7, 3.2], ['rocks15', 132, 7.7, 4.3]],
  z14OSD: [['pine', 125, 9.0, 18.6, 'qt'], ['oak', 126, 12.9, 19.1, 'qt'], ['rock', 90, 11.3, 2.9], ['bullrush', 81, 3.3, 5.5], ['tumble', 104, 3.6, 3.6], ['cactus-fn', 79, 4.4, 9.1], ['cactus', 80, 4.2, 8.0], ['palm', 95, 16.4, 15.2]],
  z28HAT: [['mushroom', 89, 2.9, 2.3], ['rock', 90, 6.7, 2.9]],
  z50LTC: [['cave', 1, 114, 94, 'qt'], ['crystals', 42, 4.4, 5.0], ['crystals2', 44, 6.9, 5.6, 'qt'], ['rocks', 47, 7.7, 3.2, 'qt'], ['vine', 54, 18.9, 42.4, 'qt']],
  z07CSI: [['haystack', 73, 6.9, 7.3, 'qt'], ['pine', 72, 9.0, 18.6, 'qt'], ['oak', 152, 12.9, 19.1, 'qt']],
  z09JST: [['pine', 43, 9.0, 18.6, 'qt'], ['oak', 108, 12.9, 19.1, 'qt']],
  z08BKD: [['weet', 26, 21.3, 15.9, 'qt'], ['weed', 17, 8.7, 5.9, 'qt'], ['bolder4', 44, 9.5, 4.5, 'qt'], ['bolder8', 48, 15, 9.2, 'qt']],
  z15SSH: [['bolder3', 45, 27.1, 17.4, 'qt'], ['hrpalm', 51, 16.4, 15.2, 'qt'], ['cactus', 53, 5.2, 7.9, 'qt'], ['fncactus', 54, 4.4, 9.1, 'qt']],
  z20DSP: [['cd', 39, 4.4, 9.1, 'qt'], ['cl', 40, 5.2, 7.9, 'qt'], ['palm2', 41, 12.8, 15.2, 'qt'], ['bush2', 48, 4.1, 4.1, 'qt'], ['bush38', 165, 6, 6, 'qt'], ['bol40', 219, 12.8, 6.7, 'qt'], ['smashedcac', 123, 10.4, 1.6, 'qt']],
  z21FSH: [['hrpalm', 23, 16.4, 15.2, 'qt'], ['rocks6', 46, 7.5, 3.5, 'qt'], ['bullrush', 52, 5.4, 12.3, 'qt'], ['littlebush', 72, 6.9, 7.5, 'qt'], ['lily', 82, 5, 0.3, 'qt']],
  z22BIP: [['rock', 4, 5.6, 3.5, 'qt'], ['palm-lego', 51, 29, 34, 'qt'], ['palm-single', 160, 22.6, 49.4, 'qt'], ['bamboo', 94, 7.2, 10.9, 'qt'], ['boulder', 188, 3.5, 2.6, 'qt'], ['banana', 79, 3.2, 6.4, 'qt']],
  z23DIP: [['palm-trunk', 86, 1.8, 12.5, 'qt']],
  z27TRX: [['volcano', 47, 15.6, 11.1, 'qt'], ['stump', 48, 9.8, 7.2, 'qt'], ['logs', 49, 48, 4.4, 'qt'], ['boulder', 54, 7.4, 7.4, 'qt'], ['rock1', 116, 14.2, 6.4, 'qt']],
  z38PAR: [['palm-large', 4, 24.5, 31, 'qt'], ['palm23', 14, 17, 19, 'qt']],
  z40aPO: [['rock-large', 80, 48, 66, 'qt'], ['rock-small', 86, 55, 57, 'qt'], ['rock-rock', 7, 5.2, 5.6, 'qt']],
  z40OGL: [['crystal-blue', 135, 3.9, 8.2, 'qt'], ['crystal', 88, 2.6, 3.9, 'qt']],
  z41MAP: [['crystals', 35, 3.2, 4.4, 'qt']],
  z13CAI: [['palm', 42, 31.8, 35.4, 'qt']],
};
