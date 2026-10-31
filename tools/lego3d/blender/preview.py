# Headless preview renderer of the LEGO 3D pilot:
#   Blender -b -P preview.py -- scene.json out_prefix [view ...]
# scene.json: { parts: [{ name, positions, uvs, indices, groups: [{ first, count, tex (png relative to the json) }] }] } in GAME coordinates (left-handed, +Y up, +Z forward);
# they are mapped to Blender as (x, y, z) -> (x, z, y) (a reflection, so the picture looks like the game's, triangles are re-wound).
# Views: front back side three (default: front side three). Output: <out_prefix>_<view>.png, Workbench renderer, textures as the flat colour (nearest filtering), no lighting.
import bpy, json, os, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
views = [v for a in argv[2:] for v in a.split(',')] or ['front', 'side', 'three']
base = os.path.dirname(os.path.abspath(src))
data = json.load(open(src))

bpy.ops.wm.read_factory_settings(use_empty=True)
imgs = {}
def material(tex, color=None):
    key = tex or ('c%s' % (color,) if color else '_none')
    if key in imgs: return imgs[key]
    m = bpy.data.materials.new(str(key))
    m.use_backface_culling = bool(data.get('cull'))
    m.use_nodes = False
    if color:
        m.diffuse_color = (color[0], color[1], color[2], 1)
    elif tex:
        img = bpy.data.images.load(os.path.join(base, tex))
        # workbench texture colour needs a node tree with an image texture node
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes): nt.nodes.remove(n)
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; t.interpolation = 'Closest'; t.extension = 'REPEAT'
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); outn = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color']); nt.links.new(bsdf.outputs['BSDF'], outn.inputs['Surface'])
    else:
        m.diffuse_color = (0.7, 0.7, 0.7, 1)
    imgs[key] = m
    return m

lo = [1e9] * 3; hi = [-1e9] * 3
for p in data['parts']:
    pos = p['positions']; n = len(pos) // 3
    verts = [(pos[i*3], pos[i*3+2], pos[i*3+1]) for i in range(n)]
    for v in verts:
        for c in range(3): lo[c] = min(lo[c], v[c]); hi[c] = max(hi[c], v[c])
    faces = []; mats = []; slots = {}
    idx = p['indices']
    for gi, g in enumerate(p['groups']):
        col = tuple(g['color']) if g.get('color') else None
        mi = slots.setdefault((g['tex'], col), len(slots))
        for t in range(g['first'], g['first'] + g['count'], 3):
            faces.append((idx[t], idx[t+2], idx[t+1])); mats.append(mi)
    mesh = bpy.data.meshes.new(p['name'])
    mesh.from_pydata(verts, [], faces)
    for (tex, col), mi in sorted(slots.items(), key=lambda kv: kv[1]): mesh.materials.append(material(tex, col))
    for i, poly in enumerate(mesh.polygons): poly.material_index = mats[i]
    uv = mesh.uv_layers.new(name='uv')
    uvs = p.get('uvs') or [0.0] * (2 * len(verts))
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            uv.data[li].uv = (uvs[vi*2], uvs[vi*2+1])
    mesh.update()
    ob = bpy.data.objects.new(p['name'], mesh); bpy.context.scene.collection.objects.link(ob)

centre = Vector([(lo[i] + hi[i]) / 2 for i in range(3)])
size = max(hi[i] - lo[i] for i in range(3))
if data.get('focus'):
    f = data['focus']; centre = Vector((f[0], f[2], f[1])); size = data.get('scale', size) / 1.15
cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = size * 1.15
co = bpy.data.objects.new('c', cam); bpy.context.scene.collection.objects.link(co); bpy.context.scene.camera = co
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.light = data.get('light', 'FLAT'); sh.color_type = 'TEXTURE'; sh.show_cavity = False
sh.show_object_outline = True; sh.object_outline_color = (0, 0, 0)
if data.get('light') == 'STUDIO': sh.studio_light = 'Default'
sc.render.resolution_x = int(data.get('w', 900)); sc.render.resolution_y = int(data.get('h', 900))
sc.render.film_transparent = False
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.65, 0.8)
D = {'front': (0, -1, 0.0), 'back': (0, 1, 0.0), 'side': (1, 0, 0.0), 'three': (0.8, -1, 0.5), 'top': (0, -0.001, 1)}
for v in views:
    d = Vector(D[v]).normalized()
    co.location = centre + d * size * 3
    co.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{out}_{v}.png'
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath)
