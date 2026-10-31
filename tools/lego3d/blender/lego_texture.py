# Blender -b -P lego_texture.py -- spec.json
# Renders a seamlessly tiling LEGO surface texture from LDraw geometry: orthographic, soft ambient light + one sun, Cycles with real ambient occlusion in the stud gaps.
# spec: { mesh: { positions[3n], normals[3n], indices[3m] } in LDU with LDraw axes (right-handed, -Y up), camera: 'top' | 'front', centre: [x,y,z], tile: [wLdu, hLdu],
#         px: [W, H] (render size), out: [W, H] (written size, the render is scaled to it: a brick wall that the game draws square), color: [r,g,b] (0..255, the surface colour the render is
#         normalised to: the median pixel), file: out.tga | .png, normal: optional normal-map path (made from ray casts of the same view), samples }
import bpy, json, sys, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

spec = json.load(open(sys.argv[sys.argv.index('--') + 1]))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
m = spec['mesh']
P = m['positions']; N = m['normals']; I = m['indices']
# LDraw (x, y, z) -> Blender (x, z, -y): a proper rotation (right-handed -> right-handed), -Y up becomes +Z up
verts = [(P[i], P[i + 2], -P[i + 1]) for i in range(0, len(P), 3)]
mesh = bpy.data.meshes.new('wall')
mesh.from_pydata(verts, [], [tuple(I[i:i + 3]) for i in range(0, len(I), 3)])
mesh.update()
mesh.normals_split_custom_set_from_vertices([(N[i], N[i + 2], -N[i + 1]) for i in range(0, len(N), 3)])
ob = bpy.data.objects.new('wall', mesh); sc.collection.objects.link(ob)
col = [c / 255 for c in spec['color']]
lin = [((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in col]
mat = bpy.data.materials.new('plastic'); mat.use_nodes = True
b = mat.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (*lin, 1); b.inputs['Roughness'].default_value = 0.28
ob.data.materials.append(mat)

cx, cy, cz = spec['centre']
bc = Vector((cx, cz, -cy))
cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'
W, H = spec['px']; tw, th = spec['tile']
cam.ortho_scale = max(tw, th)
co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
if spec['camera'] == 'top':
    co.location = bc + Vector((0, 0, 400)); co.rotation_euler = (0, 0, 0)
    sunrot = (math.radians(0), 0, 0)   # straight down: the baked relief must not depend on the way a mesh maps the tile (a sun from one side reads as pits on a rotated plate)
else:
    co.location = bc + Vector((0, -400, 0)); co.rotation_euler = (math.radians(90), 0, 0)
    sunrot = (math.radians(55), math.radians(-30), math.radians(-20))
cam.clip_start = 1; cam.clip_end = 2000
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.resolution_percentage = 100
sc.render.engine = 'CYCLES'; sc.cycles.samples = spec.get('samples', 64); sc.cycles.use_denoising = False
sc.cycles.device = 'CPU'
sc.render.film_transparent = False
w = bpy.data.worlds.new('w'); w.use_nodes = True
bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.9, 0.92, 1.0, 1); bg.inputs['Strength'].default_value = spec.get('ambient', 0.5)
sc.world = w
sun = bpy.data.lights.new('s', 'SUN'); sun.energy = spec.get('sun', 3.0); sun.angle = math.radians(35)
so = bpy.data.objects.new('s', sun); so.rotation_euler = sunrot; sc.collection.objects.link(so)
sc.view_settings.view_transform = 'Standard'
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'
tmp = spec['file'] + '.render.png'
sc.render.filepath = tmp
bpy.ops.render.render(write_still=True)


def height_map(NW, NH):
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    h = np.zeros((NH, NW), dtype=np.float32)
    for j in range(NH):
        for i in range(NW):
            u = ((i + 0.5) / NW - 0.5) * tw; v = (0.5 - (j + 0.5) / NH) * th
            if spec['camera'] == 'top': o = bc + Vector((u, v, 300)); d = Vector((0, 0, -1))
            else: o = bc + Vector((u, -300, v)); d = Vector((0, 1, 0))
            hit = bvh.ray_cast(o, d)
            h[j, i] = (300 - (hit[0] - o).length) if hit[0] is not None else 0.0
    return h

def blur(a, r):
    # separable box blur, wrapped (the tile repeats)
    out = a.copy()
    for _ in range(2):
        acc = np.zeros_like(out)
        for k in range(-r, r + 1): acc += np.roll(out, k, axis=1)
        out = acc / (2 * r + 1)
        acc = np.zeros_like(out)
        for k in range(-r, r + 1): acc += np.roll(out, k, axis=0)
        out = acc / (2 * r + 1)
    return out

img = bpy.data.images.load(tmp)
a = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[:, :, :3]
# normalise: the median pixel becomes the target colour (the surface's own colour); done in display (sRGB) space
med = np.median(a.reshape(-1, 3), axis=0)
a = a * (np.array(col, dtype=np.float32) / np.maximum(med, 1e-4))
# the game lights its meshes per vertex (flat on a plate), so the relief has to live in the picture: deviations from the surface colour are amplified (spec.contrast)
colv = np.array(col, dtype=np.float32)
a = np.clip(colv + (a - colv) * spec.get('contrast', 1.8), 0, 1)
if spec.get('relief'):
    # direction-free relief from the height field: dark at the foot of a raised edge, light on its rim, a little lift on the tops (the game's own pictures are shaded like this: rings, no sun)
    hh = height_map(OW if False else W, H)
    h = blur(hh, max(1, W // 80))
    lap = np.roll(h, -1, 1) + np.roll(h, 1, 1) + np.roll(h, -1, 0) + np.roll(h, 1, 0) - 4 * h
    ln = lap / (np.abs(lap).max() + 1e-6)
    top = np.clip(h / (h.max() + 1e-6), 0, 1)
    k = spec['relief']
    shade = 1 - k * np.clip(ln * 2.5, 0, 1) * 0.9 + k * np.clip(-ln * 2.5, 0, 1) * 0.9 * 0.7 + 0.06 * top
    a = np.clip(colv[None, None, :] * shade[:, :, None] + (1 - colv[None, None, :]) * np.clip(shade - 1, 0, 1)[:, :, None] * 0.8, 0, 1)
OW, OH = spec['out']
if (OW, OH) != (W, H):
    ys = (np.arange(OH) * H / OH).astype(int); xs = (np.arange(OW) * W / OW).astype(int)
    a = a[ys][:, xs]
out = bpy.data.images.new('out', width=OW, height=OH, alpha=False)
rgba = np.ones((OH, OW, 4), dtype=np.float32); rgba[:, :, :3] = a
out.pixels = rgba.ravel()
f = spec['file']
out.filepath_raw = f
out.file_format = 'TARGA' if f.lower().endswith('.tga') else 'PNG'
out.save()

if spec.get('normal'):
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    NW, NH = spec.get('normal_px', [OW, OH])
    hgt = np.zeros((NH, NW), dtype=np.float32)
    s = max(tw, th)
    for j in range(NH):
        for i in range(NW):
            # pixel centre in the view plane (image row 0 = top)
            u = ((i + 0.5) / NW - 0.5) * tw; v = (0.5 - (j + 0.5) / NH) * th
            if spec['camera'] == 'top': o = bc + Vector((u, v, 300)); d = Vector((0, 0, -1))
            else: o = bc + Vector((u, -300, v)); d = Vector((0, 1, 0))
            hit = bvh.ray_cast(o, d)
            hgt[j, i] = (300 - (hit[0] - o).length) if hit[0] is not None else 0.0
    # tile-wrapped central differences -> tangent-space normal (strength in LDU per LDU of height)
    k = spec.get('normal_strength', 2.0)
    dx = (np.roll(hgt, -1, axis=1) - np.roll(hgt, 1, axis=1)) * 0.5 * (NW / tw)
    dy = (np.roll(hgt, -1, axis=0) - np.roll(hgt, 1, axis=0)) * 0.5 * (NH / th)
    nx, ny, nz = -dx * k * 0.1, dy * k * 0.1, np.ones_like(hgt)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    nm = np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, nz / l * 0.5 + 0.5, np.ones_like(hgt)], axis=2)
    ni = bpy.data.images.new('n', width=NW, height=NH, alpha=False)
    ni.pixels = np.ascontiguousarray(nm[::-1]).ravel()
    ni.filepath_raw = spec['normal']; ni.file_format = 'PNG'; ni.save()
import os
os.remove(tmp)
print('wrote', f)
