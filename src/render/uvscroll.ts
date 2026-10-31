// The in-place texture coordinate scroll of the original's vertex buffers: FUN_0088350d mode 0 (the engine behind FUN_0043ebe0(model, 0, &du, &dv), the flowing-water draw hook FUN_00426e9a of
// constructor 0x426f55). For every vertex of the buffer, in the buffer's order: u = u + du, then v = v + dv, each a float32 add stored back into the vertex (x87 fld / fadd / fstp dword,
// no scaling by the frame time, no wrapping: the coordinates simply grow). A `Float32Array` store rounds the double sum to float32 exactly like the fstp does.
/** add (du, dv) to the (u, v) pairs of `uvs` in place (float32 per vertex); `count` = number of vertices (default: all) */
export function scrollUvs(uvs: Float32Array, du: number, dv: number, count = uvs.length >> 1): void {
  const dU = Math.fround(du), dV = Math.fround(dv);
  for (let i = 0; i < count; i++) {
    uvs[i * 2] = uvs[i * 2] + dU;
    uvs[i * 2 + 1] = uvs[i * 2 + 1] + dV;
  }
}
