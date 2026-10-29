// The castle island's terrain, scanned once for the horse tests: land points (height above 0), cliffs (the ground drops 8 or more over 3.2 units: facing the drop), the land / void edge.
// (`W` = any castle world of the port: the terrain is the same in every stage.)
let cache = null;
export function castleSpots(W) {
  if (cache) return cache;
  const land = [], cliffs = [];
  for (let x = -330; x <= 330; x += 3) for (let z = -330; z <= 330; z += 3) {
    const h0 = W.col.terrainHeight(x, 200, z, 0);
    if (h0 > 3) land.push([x, z]);
    if (!(h0 > 3)) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const h1 = W.col.terrainHeight(x + dx * 3.2, 200, z + dz * 3.2, 0);
      if (h1 > -1e30 && h1 < h0 - 8) cliffs.push([x, z, Math.atan2(dx, dz)]);
    }
  }
  cache = { land, cliffs };
  return cache;
}
