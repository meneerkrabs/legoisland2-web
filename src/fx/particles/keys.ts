// The key / command word table of the particle files (DAT_008b6fb0) and the prefix lookup of FUN_004545f0.
import { strnicmpEq } from './text.ts';

/** the key / command word table at DAT_008b6fb0 (48 entries of 0x54 bytes: name, id at +0x50): index -> [name, id] (empty entries have id 0) */
export const KEY_TABLE: readonly (readonly [string, number])[] = [
  ['', 0], ['fSSize', 5], ['fESize', 6], ['fVSSize', 13], ['fVESize', 14], ['fSCTIndex', 1], ['fSCTIndexInc', 2], ['iSSprite', 3], ['iESprite', 4],
  ['rgbaSColour', 7], ['rgbaEColour', 8], ['fVSColour', 9], ['fVEColour', 10], ['fVSAlpha', 11], ['fVEAlpha', 12], ['iUseModel', 15], ['iMaterial', 16],
  ['fAir', 18], ['fDAir', 19], ['fBounce', 20], ['fDBounce', 21], ['fGround', 22], ['fDForce', 33], ['vGravity', 24], ['vDGravity', 25],
  ['bRandInitRot', 26], ['bRandBounceRot', 27], ['bRandBounceAngle', 28], ['fDensity', 30], ['fDDensity', 31], ['fForce', 32], ['fDGround', 23],
  ['fIncAngle', 34], ['fExcAngle', 35], ['fSpeedScale', 36], ['fLifespan', 37], ['fDLifespan', 38], ['iMaxParticles', 39],
  ['SetEmiPrimitive', 41], ['SetEmissionParticle', 42], ['ForNew', 43], ['ForAll', 44], ['ResetScript', 45], ['EndSource', 46], ['ExecuteScript', 47],
  ['', 0], ['', 0], ['\x01', 0],
];
/** key ids */
export const K = {
  SCT: 1, SCTINC: 2, SSPRITE: 3, ESPRITE: 4, SSIZE: 5, ESIZE: 6, SCOLOUR: 7, ECOLOUR: 8, VSCOLOUR: 9, VECOLOUR: 10, VSALPHA: 11, VEALPHA: 12, VSSIZE: 13, VESIZE: 14,
  USEMODEL: 15, MATERIAL: 16, AIR: 18, DAIR: 19, BOUNCE: 20, DBOUNCE: 21, GROUND: 22, DGROUND: 23, GRAV: 24, DGRAV: 25, INITROT: 26, BOUNCEROT: 27, BOUNCEANGLE: 28,
  DENS: 30, DDENS: 31, FORCE: 32, DFORCE: 33, INC: 34, EXC: 35, SPEEDSCALE: 36, LIFE: 37, DLIFE: 38, MAX: 39,
  SETEMIPRIMITIVE: 41, SETEMISSIONPARTICLE: 42, FORNEW: 43, FORALL: 44, RESETSCRIPT: 45, ENDSOURCE: 46, EXECUTESCRIPT: 47,
} as const;

/** FUN_004545f0(table, token): the id of the first table entry that starts with `token` (case-insensitive), 0 when none */
export function keyId(token: string): number {
  for (const [name, id] of KEY_TABLE) if (strnicmpEq(token, name, token.length)) return id;
  return 0;
}

