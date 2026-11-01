// Content hash of a member (the LEGO 3D generators key on the CONTENT of the member they replace, docs/re/lego3d.md section 8). Own code, sync, isomorphic: two 32-bit FNV-1a
// variants (different seeds / primes) + the length -> 16 hex digits. Not cryptographic: it only has to tell the game's meshes from a mod's.
export function hashBytes(b: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) ^ (h2 >>> 13);
  }
  h1 = (h1 ^ b.length) >>> 0; h2 = (h2 + b.length) >>> 0;
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
