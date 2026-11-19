# Converts the Sketchfab FBX to a GLB for the browser (run with Blender):
#   Blender -b --python convert.py
# Nissan 4x4 by Gabee, CC BY 4.0: https://sketchfab.com/3d-models/9d39d85373e14f54a02b95f0e2852546
import bpy, os
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, 'textures')
WEB = os.path.join(HERE, 'web')
BUILD = os.path.join(HERE, 'build')  # resized intermediate images
os.makedirs(BUILD, exist_ok=True)
LENGTH = 4.95  # metres, bumper to bumper
WHEELS = ['UVset3_Volant_low', 'UVset5_Airbag_low', 'UVset6_Frein_low', 'UVset7_Airbag_low']  # the four wheels (odd names in the source)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(HERE, 'source', 'NissanRender.fbx'))
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
# Bake parent transforms into the meshes.
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in list(bpy.data.objects):
    if o.type == 'EMPTY': bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def bbox(o):
    pts = [v.co for v in o.data.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx

body = bpy.data.objects['UVset4_PlastiqueTemoin_low']
mn, mx = bbox(body)
s = LENGTH / (mx.y - mn.y)
cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
for o in meshes:
    for v in o.data.vertices:
        v.co = Vector(((v.co.x - cx) * s, (v.co.y - cy) * s, (v.co.z) * s))
    o.data.update()
# Ground at z = 0 (lowest point of the tyres).
low = min(bbox(o)[0].z for o in meshes)
for o in meshes:
    for v in o.data.vertices: v.co.z -= low
    o.data.update()

# Name the wheels by corner. In Blender +Y is the nose (it becomes -Z in glTF).
body.name = 'Body'
for n in WHEELS:
    o = bpy.data.objects[n]
    # The source poses the front wheels already steered (and the axles may not be
    # exactly square). Find each wheel's real axle: a wheel is a disc, so the
    # axle is the direction in which its vertices spread the least.
    pts = np.array([v.co[:] for v in o.data.vertices])
    mean = pts.mean(axis=0)
    w, vecs = np.linalg.eigh(np.cov((pts - mean).T))
    axle = Vector(vecs[:, 0]).normalized()
    if axle.x < 0: axle = -axle
    # Rotate so the axle lies along +X (the outer face stays outward).
    rot = axle.rotation_difference(Vector((1, 0, 0))).to_matrix()
    for v in o.data.vertices: v.co = rot @ (v.co - Vector(mean))
    a, b = bbox(o)
    mid = (a + b) / 2  # centre of the straightened wheel, relative to `mean`
    for v in o.data.vertices: v.co -= mid
    c = Vector(mean) + rot.transposed() @ mid
    c.z = (b.z - a.z) / 2  # sits on the ground
    o.name = 'Wheel_' + ('F' if c.y > 0 else 'R') + ('L' if c.x < 0 else 'R')
    o.location = c
    o.data.update()
    import math
    print('WHEEL', o.name, tuple(round(x, 3) for x in c), 'diameter', round(b.z - a.z, 3), 'width', round(b.x - a.x, 3),
          'axle was off by', round(math.degrees(axle.angle(Vector((1, 0, 0)))), 2), 'deg')

# Steering the wheel swung its centre around the kingpin: put each pair back
# square across the truck, mirrored about the centre line.
for f in ('F', 'R'):
    l, r = bpy.data.objects['Wheel_' + f + 'L'], bpy.data.objects['Wheel_' + f + 'R']
    x = (r.location.x - l.location.x) / 2
    y = (r.location.y + l.location.y) / 2
    mid = (r.location.x + l.location.x) / 2
    l.location.x, r.location.x = mid - x, mid + x
    l.location.y = r.location.y = y
    print('AXLE', f, 'y', round(y, 3), 'half track', round(x, 3))

# --- textures: resized copies in web/ ----------------------------------------
def load(name):
    return bpy.data.images.load(os.path.join(TEX, name))

def save(img, name, size, fmt='JPEG'):
    img.scale(size, size)
    img.filepath_raw = os.path.join(BUILD, name)
    img.file_format = fmt
    if fmt == 'JPEG':
        bpy.context.scene.render.image_settings.quality = 88
    img.save()
    out = bpy.data.images.load(img.filepath_raw)
    return out

def material(name, base, metal, rough, normal, size):
    m = bpy.data.materials[name]
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    def tex(img, noncolor=False):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        if noncolor: img.colorspace_settings.name = 'Non-Color'
        return t
    nt.links.new(tex(base).outputs['Color'], bsdf.inputs['Base Color'])
    # Metallic and roughness packed into one image the glTF way (G = rough, B = metal).
    nt.links.new(tex(metal, True).outputs['Color'], bsdf.inputs['Metallic'])
    nt.links.new(tex(rough, True).outputs['Color'], bsdf.inputs['Roughness'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tex(normal, True).outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m, bsdf, nt

for name, size in (('lambert1', 2048), ('plastic', 1024)):
    p = f'Nissan1LOWfix_{name}_'
    material(name,
             save(load(p + 'BaseColor.png'), f'{name}_color.jpg', size),
             save(load(p + 'Metallic.png'), f'{name}_metal.jpg', size),
             save(load(p + 'Roughness.png'), f'{name}_rough.jpg', size),
             save(load(p + 'Normal.png'), f'{name}_normal.jpg', size), size)

# Glass: colour from RGB.png, alpha from OpacityMask.png, in one RGBA PNG.
rgb, mask = load('RGB.png'), load('OpacityMask.png')
rgb.scale(1024, 1024); mask.scale(1024, 1024)
px = np.array(rgb.pixels[:]).reshape(-1, 4)
alpha = np.array(mask.pixels[:]).reshape(-1, 4)[:, 0]
px[:, 3] = np.clip(0.28 + alpha * 0.72, 0, 1)
glass = bpy.data.images.new('glass_color', 1024, 1024, alpha=True)
glass.pixels[:] = px.ravel()
glass.filepath_raw = os.path.join(BUILD, 'glass_color.png')
glass.file_format = 'PNG'
glass.save()
m, bsdf, nt = material('GLASS', glass,
                       save(load('Nissan1LOWfix_GLASS_Metallic.png'), 'glass_metal.jpg', 1024),
                       save(load('Nissan1LOWfix_GLASS_Roughness.png'), 'glass_rough.jpg', 1024),
                       save(load('Nissan1LOWfix_GLASS_Normal.png'), 'glass_normal.jpg', 1024), 1024)
base_tex = [l.from_node for l in nt.links if l.to_socket == bsdf.inputs['Base Color']][0]
nt.links.new(base_tex.outputs['Alpha'], bsdf.inputs['Alpha'])
m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None

bpy.ops.export_scene.gltf(filepath=os.path.join(WEB, 'nissan.glb'), export_format='GLB', export_yup=True,
                          export_image_format='WEBP', export_image_quality=82, export_apply=True)
print('EXPORTED')
