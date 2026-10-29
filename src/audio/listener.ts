// Where the original's 3D listener (FUN_004434d0(pos, front, up), once per frame in each zone's camera update) is: the camera block DAT_009da5e8 = `World.camera.c`
// (c[0..2] eye, c[3..5] target, c[12..14] up, c[15..17] front). 28 call sites (asm scan of `call 0x4434d0`; the function that holds a site sits right before the loop of its zone).
/** zones that pass the camera's target instead of its eye as the listener position (`&DAT_009da5f4`: the player): z38PAR 0x465c9b, z08BKD 0x5b8319, z27TRX 0x765682 */
export const LISTENER_AT_TARGET: ReadonlySet<string> = new Set(['z38PAR', 'z08BKD', 'z27TRX']);
/**
 * Zones whose code never sets the listener: it keeps the pose the previous zone left (the SoundClass listener is not reset by the zone switch). The port's
 * z01BPK / z17WAS code sets its own; the generic per-frame update skips these zones.
 */
export const LISTENER_NOT_SET: ReadonlySet<string> = new Set(['z01BPK', 'z03PPH', 'z04IFC', 'z17WAS', 'z21FSH']);
