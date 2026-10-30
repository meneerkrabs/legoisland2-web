// WP-SAVE browser check: the front end writes SaveDef.lgo into the save storage at its start (FUN_0041ad71 -> FUN_00418ec7(-2)).
//   sh tools/m5-botslot.sh env NOPRESS=1 node tools/browse.mjs "http://localhost:5599/?start=frontend&mute=1" tools/steps/m8-savedef.mjs --size 640x480
export default async ({ page, wait, evaluate }) => {
  await page.waitForFunction(() => window.__shell && window.__feWorld, null, { timeout: 240000 });
  await wait(1500);
  const r = await evaluate(async () => {
    const sh = window.__shell, b = await sh.saves.backend.get('SaveDef.lgo');
    if (!b) return { found: false };
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const len = dv.getUint32(0, true), ver = dv.getUint32(4, true);
    let x = 0; for (let i = 8; i < len - 8 - 4; i += 4) x ^= dv.getUint32(i, true);
    return { found: true, size: b.length, used: len, version: ver, endMarker: dv.getUint32(len - 4, true).toString(16), checksumOk: (x >>> 0) === dv.getUint32(len - 8, true), vars: dv.getUint32(0x8, true) };
  });
  console.log('SaveDef.lgo', JSON.stringify(r));
  console.log(r.found && r.size === 0x51c8c && r.version === 0xd && r.endMarker === 'c0cc00c' && r.checksumOk ? 'RESULT ok: SaveDef.lgo written' : 'RESULT DIFFERENT: SaveDef.lgo');
};
