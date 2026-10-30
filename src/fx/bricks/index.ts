// FX_Bricks (ms\FX_Bricks: Bricks.c, TBrick.c, TBrickModel.c, BrickRead.c, BrickFX_Manager.c; docs/re/m4/wp9-bricks.md): brick-built buildings,
// vehicles and animals that fly apart, fall into place or morph between models. Data: src/formats/bricks.ts.
export * from './sim.ts';
export * from './manager.ts';
export * from './island.ts';
export { drawBrickFx, BRICK_PRESET } from './draw.ts';
// the save game sections (registers the `bricks` part of src/shell/saveparts.ts when this module loads)
export { captureBricks, applyBricks, slotImage, decodeSlotImage, SLOT_IMAGE_BYTES } from './save.ts';
