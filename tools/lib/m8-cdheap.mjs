// WP-SAVE: the original is a debug build (its allocator fills new blocks with 0xCD), so node bytes a constructor never writes are 0xCD. The duels' emulators (IslEmu) have a zeroed heap: importing this
// file makes every IslEmu fill its still unused heap with 0xCD before its first constructor runs (the family duels then compare the ports' never-written fields against what a real run has).
import { IslEmu } from './m7-isl-veh-emu.mjs';
import { cdFillHeap } from './m8-save.mjs';
const attach0 = IslEmu.prototype.attach;
if (!IslEmu.prototype.__cdPatched) {
  IslEmu.prototype.__cdPatched = true;
  IslEmu.prototype.attach = function (...a) { if (!this.__cd) { this.__cd = true; cdFillHeap(this); } return attach0.apply(this, a); };
}
