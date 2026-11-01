# Blender -b -P lego_design.py -- spec.json
# Renders a COLOUR-NEUTRAL, seamlessly tiling LEGO surface design (docs/re/lego3d.md, textures generator): a signed shading field f in [-1, 1] stored as an 8-bit grey PNG
# (value = round(128 + 127 f)). The run-time assembler (src/mods/lego3d/gen/textures.ts) tints it with three numbers measured from the player's own texture (median colour = f 0,
# a dark percentile colour = f -1, a light percentile colour = f +1), so the pack holds only our own render and no colour or pixel of the game.
#
# Geometry comes from the LDraw library (the node side flattens the parts and passes them in LDU, LDraw axes, right-handed, -Y up). Lighting: Cycles with a uniform white world and
# NO sun: real ambient occlusion (dark feet of the studs, dark brick joints), nothing directional; the game lights the surface itself. A direction-free relief term (laplacian of the
# blurred height field: light on a raised rim, dark at the foot) gives the picture the definition the game's own pictures have.
#
# spec: { kind: 'studs' | 'wall', file: out.png, samples,
#   studs: { style: 'plain' | 'ring' | 'cross', mesh: {positions, normals, indices} (a stud plate, studs at odd multiples of 10 LDU), cell: 20 (LDU per stud), centre: [x, y, z] of one stud (plate top y = 0),
#            px: render px per stud cell, out: px per stud cell written, relief, ... }
#   wall:  { mesh, bx, rows, bw, bh, px: [W, H] written, ss: supersampling, relief } }
import bpy, json, sys, math, os
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

spec = json.load(open(sys.argv[sys.argv.index('--') + 1]))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def build(mesh_spec, name):
    P = mesh_spec['positions']; N = mesh_spec['normals']; I = mesh_spec['indices']
    # LDraw (x, y, z) -> Blender (x, z, -y): a proper rotation, -Y up becomes +Z up
    verts = [(P[i], P[i + 2], -P[i + 1]) for i in range(0, len(P), 3)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [tuple(I[i:i + 3]) for i in range(0, len(I), 3)])
    me.update()
    me.normals_split_custom_set_from_vertices([(N[i], N[i + 2], -N[i + 1]) for i in range(0, len(N), 3)])
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    mat = bpy.data.materials.new('m'); mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1); b.inputs['Roughness'].default_value = 1.0
    try: b.inputs['Specular IOR Level'].default_value = 0.0
    except Exception: pass
    ob.data.materials.append(mat)
    return ob


def setup_render(W, H, samples):
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.render.engine = 'CYCLES'; sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.device = 'CPU'
    sc.render.film_transparent = False
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (1, 1, 1, 1); bg.inputs['Strength'].default_value = 1.0
    sc.world = w
    sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
    sc.display_settings.display_device = 'sRGB'
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'; sc.render.image_settings.color_depth = '16'


def camera(kind, centre, scale):
    cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = scale
    co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
    cam.clip_start = 1; cam.clip_end = 3000
    if kind == 'top':
        co.location = centre + Vector((0, 0, 400)); co.rotation_euler = (0, 0, 0)
    else:
        co.location = centre + Vector((0, -400, 0)); co.rotation_euler = (math.radians(90), 0, 0)
    return co


def render(path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    H, W = img.size[1], img.size[0]
    a = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[:, :, :3]
    bpy.data.images.remove(img)
    os.remove(path)
    return a[::-1].copy()   # row 0 = top of the picture


def heights(ob, kind, centre, tw, th, W, H):
    # depth of the first surface under / in front of every pixel centre (view plane, row 0 = top)
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    h = np.zeros((H, W), dtype=np.float32)
    for j in range(H):
        v = (0.5 - (j + 0.5) / H) * th
        for i in range(W):
            u = ((i + 0.5) / W - 0.5) * tw
            if kind == 'top': o = centre + Vector((u, v, 300)); d = Vector((0, 0, -1))
            else: o = centre + Vector((u, -300, v)); d = Vector((0, 1, 0))
            hit = bvh.ray_cast(o, d)
            h[j, i] = (300 - (hit[0] - o).length) if hit[0] is not None else 0.0
    return h


def blur(a, r, axes=(0, 1)):
    out = a.copy()
    for _ in range(2):
        for ax in axes:
            acc = np.zeros_like(out)
            for k in range(-r, r + 1): acc += np.roll(out, k, axis=ax)
            out = acc / (2 * r + 1)
    return out


def box(a, f):
    if f == 1: return a
    H, W = a.shape[:2]
    return a.reshape(H // f, f, W // f, f, *a.shape[2:]).mean(axis=(1, 3))


def save_field(f, path, preview=None):
    f = np.clip(f, -1, 1)
    v = np.round(128 + 127 * f) / 255.0
    H, W = v.shape
    im = bpy.data.images.new('field', width=W, height=H, alpha=False)
    im.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((H, W, 4), dtype=np.float32); rgba[:, :, 0] = rgba[:, :, 1] = rgba[:, :, 2] = v[::-1]
    im.pixels = rgba.ravel()
    im.filepath_raw = path; im.file_format = 'PNG'
    im.save()
    # the same field as raw bytes (row 0 = top) for the node side: <path>.bin, size in the file name's JSON twin
    (np.round(128 + 127 * f)).astype(np.uint8).tofile(path[:-4] + '.bin')
    json.dump({'w': W, 'h': H}, open(path[:-4] + '.json', 'w'))


def studs_design(S):
    span = S.get('span', 1)                    # studs per design side (1: one stud cell, 2: a 2 x 2 stud tile)
    cell = S['cell'] * span; px = S['px']; ss = S.get('ss', 2)
    cx, cy, cz = S['centre']
    bc = Vector((cx, cz, -cy))
    R = px * ss
    ob = build(S['mesh'], 'plate')
    setup_render(R, R, S.get('samples', 96))
    camera('top', bc, cell)
    a = render('/tmp/lego_design_render.png')[:, :, 0]
    # AO-lit plate top = the flat value (median of the picture is the plate between the studs)
    flat = np.percentile(a, 60)
    ao = a / max(flat, 1e-4) - 1.0            # <= 0: feet of the studs darker
    h = heights(ob, 'top', bc, cell, cell, R, R)
    hmax = h.max()
    top = h > hmax - 0.5                       # the flat stud top
    # direction-free relief: laplacian of the blurred height (raised rim light, foot dark)
    hb = blur(h, max(1, R // 36))
    lap = np.roll(hb, -1, 1) + np.roll(hb, 1, 1) + np.roll(hb, -1, 0) + np.roll(hb, 1, 0) - 4 * hb
    ln = lap / (np.abs(lap).max() + 1e-6)
    k = S.get('relief', 0.6)
    rim = np.clip(-ln * 2.5, 0, 1)             # convex: light
    foot = np.clip(ln * 4.0, 0, 1)             # concave: dark
    f = np.clip(np.clip(ao * S.get('ao_gain', 4.0), -0.45, 0) - k * foot, -1, 1)
    f = np.where(top, S.get('top', 1.0), f)
    sh = S.get('shift', 0.0)                    # whole-tile designs of span 2 are rendered around the middle of four studs: fine as is
    # stud top: a constant (so the 3D stud that samples its centre gets one flat colour); soften its edge a little
    # style overlays (analytic, in cell units 0..1 of the stud cell, centre 0.5)
    yy, xx = np.mgrid[0:R, 0:R]
    u = (xx + 0.5) / R - 0.5; v = (yy + 0.5) / R - 0.5      # -0.5 .. 0.5, stud centre at 0
    u *= span; v *= span                        # in stud pitches from the design centre
    r = np.hypot(u, v)
    style = S.get('style', 'plain')
    if style == 'ring':
        # outline ring around every stud (r = 0.39 pitch, 0.045 thick), links to the neighbours left and right, the small circle of the underside tube at the cell corner
        ring = np.clip((0.07 - np.abs(r - 0.375)) / 0.025, 0, 1)
        link = (np.clip(1 - np.abs(v) / 0.04, 0, 1)) * (np.abs(u) > 0.40)
        tube = np.zeros_like(r)
        for sx in (-0.5, 0.5):
            for sy in (-0.5, 0.5):
                rc = np.hypot(u - sx, v - sy)
                tube = np.maximum(tube, np.clip(1 - np.abs(rc - 0.17) / 0.03, 0, 1))
        f = np.where(ring > 0, f * (1 - ring) + 0.95 * ring, f)
        f = np.where(link > 0, f * (1 - link) + 0.4 * link, f)
        f = np.where(tube > 0, f * (1 - tube) - 0.45 * tube, f)
    elif style == 'shaded':
        # the game's own "3D look" plates (z04IFC / z05WAB / z36CNT / z15SSH): a crescent of light on one rim of the stud and of shadow on the other, as if lit from the upper left; the stud top
        # itself stays the plate colour. Ours is derived from the real stud's height field (the same geometry as every other design), not painted, and the sign is chosen per texture by the
        # table (bump lit from the upper left, or the "pit" look of the blue / red WAB plates = inverted)
        hs = blur(h, max(1, R // 26))
        gy, gx = np.gradient(hs)
        gm = np.abs(gx + gy).max() + 1e-6
        lit = (gx + gy) / gm
        f = np.clip(lit * 1.6, -1, 1) * np.where(top, 0.0, 1.0)
        f = np.where(top, 0.0, f)
    elif style == 'cross':
        # a plus-shaped dark hole in the middle of four studs (span 2: the tile's centre only)
        arm = 0.17; ln_ = 0.5
        du = np.abs(u); dv = np.abs(v)
        m = ((du < ln_ * 0.5) & (dv < arm * 0.5)) | ((du < arm * 0.5) & (dv < ln_ * 0.5))
        f = np.where(m, -1.0, f)
    f = box(f, ss)
    # symmetry: the stud cell is mirror symmetric (and, plain / cross, also 4-fold): averaging removes the render noise and any lopsidedness
    if style != 'shaded':
        f = (f + f[::-1] + f[:, ::-1] + f[::-1, ::-1]) / 4
        if style in ('plain', 'cross'): f = (f + f.T) / 2
    o = S['out']
    if f.shape[0] != o:
        f = box(f, f.shape[0] // o) if f.shape[0] % o == 0 else f
    save_field(f, spec['file'])
    print('wrote', spec['file'], f.shape, 'f range', float(f.min()), float(f.max()))


def wall_design(S):
    bx = S['bx']; rows = S['rows']; bw = S['bw']; bh = S['bh']
    W, H = S['px']; ss = S.get('ss', 2)
    tw, th = bx * bw, rows * bh
    ob = build(S['mesh'], 'wall')
    RW, RH = W * ss, H * ss
    setup_render(RW, RH, S.get('samples', 128))
    bc = Vector((S['centre'][0], S['centre'][2], -S['centre'][1]))
    cam = camera('front', bc, max(tw, th))
    cam.data.ortho_scale = max(tw, th)
    cam.data.sensor_fit = 'AUTO'
    a = render('/tmp/lego_design_render.png')[:, :, 0]
    flat = np.percentile(a, 70)
    ao = a / max(flat, 1e-4) - 1.0
    h = heights(ob, 'front', bc, tw, th, RW, RH)
    # brick face = the nearest depth; the joints are deeper. The joint's value is the design's choice (the game's dark wall has light joint lines, its white wall dark ones: S.joint),
    # the face edges next to a joint take the real ambient occlusion (dark)
    face = h > h.max() - 0.6
    gap = ~face
    f = np.clip(ao * S.get('ao_gain', 5.0), -0.7, 0)
    f = np.where(face, f, S.get('joint', -0.8))
    f = box(f, ss)
    save_field(f, spec['file'])
    print('wrote', spec['file'], f.shape, 'f range', float(f.min()), float(f.max()))


if spec['kind'] == 'studs': studs_design(spec['studs'])
else: wall_design(spec['wall'])
