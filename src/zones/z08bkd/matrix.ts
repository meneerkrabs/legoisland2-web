// The zone's matrix helpers: the engine's exact ones (src/zones/common/matrix.ts) and the record versions.
import type { GameRecord } from '../../game/record.ts';
import { eulerMatrix } from '../common/matrix.ts';
export { eulerMatrix, rotateVector, transformPoint } from '../common/matrix.ts';

/** FUN_0043a5e4(rec + 0xc, rx, ry, rz, x, y, z) */
export function setEuler(rec: GameRecord, rx: number, ry: number, rz: number, x: number, y: number, z: number) { eulerMatrix(rx, ry, rz, x, y, z, rec.m); }
