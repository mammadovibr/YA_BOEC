"""Builds the boxing gym in Blender and exports it as glTF.

Run with the Blender Python module (pip install bpy):
    python tools/build_gym.py <textures_dir> <out.glb>

All layout coordinates below are written in three.js space (Y up, +Z towards
the spawn point) and converted to Blender's Z-up space by T()/S().
Node naming contract used by the game (js/world.js):
    BagPivot_<n>   pivot at the ceiling mount; children swing with it
    BagBody_<n>    the leather bag (hit target)
    DiscoBall      parked under the ceiling, lowered while dancing
    Neon           emissive sign, flickers
    LAMP_<n>       empties where point/spot lights go
    COL_<name>     empties whose position/scale describe a collision box
    Spawn          player start
"""
import sys, math, os
import bpy, bmesh
from mathutils import Matrix, Vector, Euler

TEX, OUT = sys.argv[-2], sys.argv[-1]


def T(x, y, z):
    return Vector((x, -z, y))


def S(sx, sy, sz):
    return Vector((sx, sz, sy))


# ---------------------------------------------------------------- reset
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves):
    for b in list(coll):
        coll.remove(b)
scene = bpy.context.scene

# ---------------------------------------------------------------- materials
_images = {}


def img(name):
    if name not in _images:
        im = bpy.data.images.load(os.path.join(TEX, name))
        _images[name] = im
    return _images[name]


def mat(name, color=(0.8, 0.8, 0.8), metal=0.0, rough=0.6, tex=None, normal=None,
        emit=None, emit_strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    out = nt.nodes.get("Material Output")
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = out or nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img(tex)
        if color != (1, 1, 1) and color != (0.8, 0.8, 0.8):
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs[0].default_value = 1.0
            nt.links.new(t.outputs["Color"], mix.inputs[6])
            mix.inputs[7].default_value = (*color, 1)
            nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        else:
            nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if normal:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img(normal)
        t.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    return m


M = {
    "wood": mat("Wood", (1, 1, 1), rough=0.5, tex="wood.jpg", normal="wood_n.jpg"),
    "rubber": mat("Rubber", (1, 1, 1), rough=0.92, tex="rubber.jpg"),
    "brick": mat("Brick", (1, 1, 1), rough=0.88, tex="brick.jpg", normal="brick_n.jpg"),
    "concrete": mat("Concrete", (1, 1, 1), rough=0.95, tex="concrete.jpg"),
    "steel": mat("SteelDark", (0.045, 0.045, 0.05), metal=0.85, rough=0.38),
    "chrome": mat("Chrome", (0.85, 0.85, 0.88), metal=1.0, rough=0.12),
    "chain": mat("Chain", (0.6, 0.6, 0.62), metal=1.0, rough=0.28),
    "bag_red": mat("LeatherRed", (1, 1, 1), rough=0.42, tex="leather_red.jpg", normal="leather_n.jpg"),
    "bag_black": mat("LeatherBlack", (1, 1, 1), rough=0.38, tex="leather_black.jpg", normal="leather_n.jpg"),
    "bag_blue": mat("LeatherBlue", (1, 1, 1), rough=0.42, tex="leather_blue.jpg", normal="leather_n.jpg"),
    "cap": mat("BagCap", (0.03, 0.03, 0.03), rough=0.5),
    "strap": mat("Strap", (0.02, 0.02, 0.02), rough=0.55),
    "canvas": mat("Canvas", (1, 1, 1), rough=0.85, tex="canvas.jpg"),
    "apron": mat("Apron", (1, 1, 1), rough=0.8, tex="apron.jpg"),
    "rope_red": mat("RopeRed", (0.7, 0.04, 0.04), rough=0.55),
    "rope_white": mat("RopeWhite", (0.85, 0.85, 0.85), rough=0.55),
    "rope_blue": mat("RopeBlue", (0.04, 0.12, 0.6), rough=0.55),
    "pad_red": mat("PadRed", (0.6, 0.03, 0.03), rough=0.4),
    "pad_blue": mat("PadBlue", (0.03, 0.1, 0.55), rough=0.4),
    "pad_white": mat("PadWhite", (0.85, 0.85, 0.85), rough=0.4),
    "neon": mat("NeonRed", (1.0, 0.1, 0.12), rough=0.3, emit=(1.0, 0.06, 0.08), emit_strength=8.0),
    "neon_board": mat("NeonBoard", (0.015, 0.015, 0.02), rough=0.6),
    "bulb": mat("Bulb", (1, 0.9, 0.7), emit=(1.0, 0.8, 0.55), emit_strength=12.0),
    "shade": mat("LampShade", (0.04, 0.09, 0.07), metal=0.7, rough=0.35),
    "mirror": mat("Mirror", (0.92, 0.93, 0.96), metal=1.0, rough=0.02),
    "night": mat("NightWindow", (1, 1, 1), rough=0.1, tex="night.jpg", emit=(0.35, 0.4, 0.55), emit_strength=0.0),
    "locker": mat("Locker", (0.12, 0.22, 0.32), metal=0.4, rough=0.45),
    "locker_dark": mat("LockerDark", (0.03, 0.05, 0.07), metal=0.4, rough=0.5),
    "black_rubber": mat("BlackRubber", (0.025, 0.025, 0.028), rough=0.75),
    "bench_pad": mat("BenchPad", (0.03, 0.03, 0.035), rough=0.45),
    "gold": mat("Gold", (1.0, 0.72, 0.25), metal=1.0, rough=0.22),
    "disco": mat("Disco", (0.95, 0.95, 1.0), metal=1.0, rough=0.06),
    "plate_red": mat("PlateRed", (0.55, 0.04, 0.04), rough=0.5),
    "plate_blue": mat("PlateBlue", (0.04, 0.1, 0.5), rough=0.5),
    "poster1": mat("Poster1", (1, 1, 1), rough=0.7, tex="poster1.jpg"),
    "poster2": mat("Poster2", (1, 1, 1), rough=0.7, tex="poster2.jpg"),
    "poster3": mat("Poster3", (1, 1, 1), rough=0.7, tex="poster3.jpg"),
    "wood_dark": mat("WoodDark", (0.35, 0.22, 0.14), rough=0.5),
}
# the night window should glow with its own texture
_nw = M["night"].node_tree
for n in _nw.nodes:
    if n.type == "TEX_IMAGE":
        _nw.links.new(n.outputs["Color"], _nw.nodes["Principled BSDF"].inputs["Emission Color"])
_nw.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.0


# ---------------------------------------------------------------- mesh builder
class Builder:
    """Accumulates many primitives into one mesh (one draw call per material)."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = []

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _finish_new(self, n0, m, uv="box", tile=1.0, smooth=False, uvinfo=None):
        self.bm.faces.ensure_lookup_table()
        new = self.bm.faces[n0:]
        mi = self._mi(m)
        for f in new:
            f.material_index = mi
            f.smooth = smooth
            if uv == "box":
                n = f.normal
                ax = max(range(3), key=lambda i: abs(n[i]))
                a, b = [(1, 2), (0, 2), (0, 1)][ax]
                # flip u on the far side so text/patterns read correctly from outside
                su = (1 if n[ax] > 0 else -1) if ax == 0 else (-1 if n[ax] > 0 else 1) if ax == 1 else 1
                tu, tv = tile if isinstance(tile, tuple) else (tile, tile)
                for l in f.loops:
                    co = l.vert.co
                    l[self.uv].uv = (su * co[a] / tu, co[b] / tv)
            elif uv == "cyl":
                cx, cy, z0, h, rep = uvinfo
                us = []
                for l in f.loops:
                    co = l.vert.co
                    u = (math.atan2(co.y - cy, co.x - cx) / (2 * math.pi) + 0.5) * rep
                    us.append(u)
                if max(us) - min(us) > rep * 0.5:
                    us = [u + rep if u < rep * 0.5 else u for u in us]
                for l, u in zip(f.loops, us):
                    l[self.uv].uv = (u, (l.vert.co.z - z0) / h)
        return new

    def box(self, c, s, m, rot=(0, 0, 0), tile=1.0, bevel=0.0):
        """c, s in three.js space; rot is three.js euler (radians)."""
        n0 = len(self.bm.faces)
        mat_ = Matrix.Translation(T(*c)) @ Euler((rot[0], -rot[2], rot[1]), "XZY").to_matrix().to_4x4() \
            @ Matrix.Diagonal((*S(*s), 1))
        bmesh.ops.create_cube(self.bm, size=1.0, matrix=mat_)
        self._finish_new(n0, m, tile=tile)

    def cyl(self, c, r, h, m, segs=24, axis="y", r2=None, smooth=True, caps=True, uv="box", tile=1.0, rep=1.0):
        """Cylinder/cone centred at c (three.js space) along a three.js axis."""
        n0 = len(self.bm.faces)
        rot = {"y": Matrix.Identity(4), "x": Matrix.Rotation(math.pi / 2, 4, "Y"),
               "z": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
        mat_ = Matrix.Translation(T(*c)) @ rot
        bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=segs,
                              radius1=r, radius2=r if r2 is None else r2, depth=h, matrix=mat_)
        p = T(*c)
        self._finish_new(n0, m, uv=uv, tile=tile, smooth=smooth,
                         uvinfo=(p.x, p.y, p.z - h / 2, h, rep))

    def sphere(self, c, r, m, segs=24, rings=12, smooth=True, scale=(1, 1, 1)):
        n0 = len(self.bm.faces)
        mat_ = Matrix.Translation(T(*c)) @ Matrix.Diagonal((*S(*scale), 1))
        bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=r, matrix=mat_)
        self._finish_new(n0, m, smooth=smooth, tile=r * 2)

    def torus(self, c, R, r, m, segs=24, tsegs=8, axis="y", rot=None):
        """Torus in three.js space; ring lies in the plane perpendicular to axis."""
        n0 = len(self.bm.faces)
        verts = []
        base = {"y": Matrix.Identity(3), "x": Matrix.Rotation(math.pi / 2, 3, "Y"),
                "z": Matrix.Rotation(math.pi / 2, 3, "X")}[axis]
        if rot is not None:
            base = rot @ base
        center = T(*c)
        for i in range(segs):
            a = 2 * math.pi * i / segs
            row = []
            for j in range(tsegs):
                b = 2 * math.pi * j / tsegs
                p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
                row.append(self.bm.verts.new(center + base @ p))
            verts.append(row)
        for i in range(segs):
            for j in range(tsegs):
                a, b = verts[i][j], verts[(i + 1) % segs][j]
                cc, d = verts[(i + 1) % segs][(j + 1) % tsegs], verts[i][(j + 1) % tsegs]
                self.bm.faces.new((a, b, cc, d))
        self._finish_new(n0, m, smooth=True, tile=0.2)

    def quad(self, c, w, h, m, facing="+z"):
        """Textured rectangle mapped 0..1 (posters, windows, signs)."""
        n0 = len(self.bm.faces)
        cx, cy, cz = c
        if facing == "+z":
            pts = [(cx - w / 2, cy - h / 2, cz), (cx + w / 2, cy - h / 2, cz), (cx + w / 2, cy + h / 2, cz), (cx - w / 2, cy + h / 2, cz)]
        elif facing == "+x":
            pts = [(cx, cy - h / 2, cz + w / 2), (cx, cy - h / 2, cz - w / 2), (cx, cy + h / 2, cz - w / 2), (cx, cy + h / 2, cz + w / 2)]
        elif facing == "-x":
            pts = [(cx, cy - h / 2, cz - w / 2), (cx, cy - h / 2, cz + w / 2), (cx, cy + h / 2, cz + w / 2), (cx, cy + h / 2, cz - w / 2)]
        elif facing == "-z":
            pts = [(cx + w / 2, cy - h / 2, cz), (cx - w / 2, cy - h / 2, cz), (cx - w / 2, cy + h / 2, cz), (cx + w / 2, cy + h / 2, cz)]
        vs = [self.bm.verts.new(T(*p)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self._mi(m)
        for l, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            l[self.uv].uv = uv
        self.bm.faces.ensure_lookup_table()

    def build(self, parent=None, origin=None):
        me = bpy.data.meshes.new(self.name)
        if origin is not None:
            self.bm.transform(Matrix.Translation(-T(*origin)))
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        scene.collection.objects.link(ob)
        if origin is not None:
            ob.location = T(*origin)
        if parent is not None:
            ob.parent = parent
            ob.location = ob.location - parent.location
        return ob


def empty(name, c, scale=(1, 1, 1), parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.3
    e.location = T(*c)
    e.scale = S(*scale)
    scene.collection.objects.link(e)
    if parent:
        e.parent = parent
        e.location = e.location - parent.location
    return e


def collider(name, c, size):
    # scale stores half extents (three.js axes)
    empty("COL_" + name, c, (size[0] / 2, size[1] / 2, size[2] / 2))


# ---------------------------------------------------------------- room
W, D, H = 18.0, 16.0, 4.6  # x, z, height
X0, X1, Z0, Z1 = -W / 2, W / 2, -D / 2, D / 2

room = Builder("Room")
room.box((0, -0.05, 0), (W, 0.1, D), M["wood"], tile=3.0)
room.box((2.5, 0.006, -1.5), (9.0, 0.012, 7.0), M["rubber"], tile=2.0)  # training mats
room.box((0, H + 0.05, 0), (W, 0.1, D), M["concrete"], tile=4.0)
# walls (inside faces get the bricks)
room.box((0, H / 2, Z0 - 0.15), (W + 0.6, H, 0.3), M["brick"], tile=3.0)
room.box((0, H / 2, Z1 + 0.15), (W + 0.6, H, 0.3), M["brick"], tile=3.0)
room.box((X0 - 0.15, H / 2, 0), (0.3, H, D), M["brick"], tile=3.0)
room.box((X1 + 0.15, H / 2, 0), (0.3, H, D), M["brick"], tile=3.0)
# skirting boards
for z in (Z0 + 0.02, Z1 - 0.02):
    room.box((0, 0.08, z), (W, 0.16, 0.04), M["steel"])
for x in (X0 + 0.02, X1 - 0.02):
    room.box((x, 0.08, 0), (0.04, 0.16, D), M["steel"])
# ceiling beams + bag rails
for x in (-6, -2, 2, 6):
    room.box((x, H - 0.2, 0), (0.25, 0.4, D), M["steel"])
for z in (-3.0, -1.0):
    room.box((2.5, 3.72, z), (11.0, 0.22, 0.14), M["steel"])
    room.box((2.5, 3.83, z), (11.0, 0.02, 0.3), M["steel"])
    room.box((2.5, 3.61, z), (11.0, 0.02, 0.3), M["steel"])
    for x in (-2.5, 7.5):
        room.box((x, 4.15, z), (0.12, 0.7, 0.12), M["steel"])
room.build()

# windows on the left wall with a night city behind them
win = Builder("Windows")
for z in (-1.5, 2.5, 6.0):
    win.quad((X0 + 0.02, 2.5, z), 2.2, 2.0, M["night"], facing="+x")
    win.box((X0 + 0.05, 1.47, z), (0.1, 0.06, 2.4), M["steel"])
    win.box((X0 + 0.05, 3.53, z), (0.1, 0.06, 2.4), M["steel"])
    for dz in (-1.13, 0, 1.13):
        win.box((X0 + 0.05, 2.5, z + dz), (0.1, 2.1, 0.06), M["steel"])
    win.box((X0 + 0.05, 2.5, z), (0.1, 0.05, 2.3), M["steel"])
win.build()

# ---------------------------------------------------------------- neon sign
board = Builder("NeonBoard")
board.box((0, 3.25, Z0 + 0.04), (5.2, 1.3, 0.06), M["neon_board"])
board.build()

font = bpy.data.fonts.load("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
cu = bpy.data.curves.new("NeonText", "FONT")
cu.body = "Я БОЕЦ"
cu.font = font
cu.size = 0.95
cu.align_x = "CENTER"
cu.align_y = "CENTER"
cu.extrude = 0.025
cu.bevel_depth = 0.008
cu.offset = -0.035  # outline-ish thin letters read as neon tubes
tob = bpy.data.objects.new("NeonTextTmp", cu)
scene.collection.objects.link(tob)
tob.location = T(0, 3.25, Z0 + 0.12)
tob.rotation_euler = (math.pi / 2, 0, 0)
dg = bpy.context.evaluated_depsgraph_get()
me = bpy.data.meshes.new_from_object(tob.evaluated_get(dg))
neon = bpy.data.objects.new("Neon", me)
neon.matrix_world = tob.matrix_world
me.materials.clear()
me.materials.append(M["neon"])
scene.collection.objects.link(neon)
bpy.data.objects.remove(tob, do_unlink=True)
# neon frame tube
nf = Builder("NeonFrame")
for (x, y, w, h) in ((0, 2.68, 4.9, 0.03), (0, 3.82, 4.9, 0.03), (-2.45, 3.25, 0.03, 1.17), (2.45, 3.25, 0.03, 1.17)):
    nf.box((x, y, Z0 + 0.1), (w, h, 0.03), M["neon"])
nf.build()

# ---------------------------------------------------------------- posters & mirror
deco = Builder("WallDeco")
deco.quad((X0 + 0.02, 2.4, -5.0), 1.0, 1.5, M["poster1"], facing="+x")
deco.quad((X0 + 0.02, 2.4, 4.3), 1.0, 1.5, M["poster2"], facing="+x")
deco.quad((-4.0, 2.2, Z1 - 0.02), 1.0, 1.5, M["poster3"], facing="-z")
deco.quad((5.6, 2.3, Z0 + 0.02), 1.0, 1.5, M["poster2"], facing="+z")
deco.quad((-5.6, 2.9, Z0 + 0.02), 1.0, 1.5, M["poster3"], facing="+z")
# mirror wall
deco.quad((X1 - 0.03, 2.0, 1.5), 6.0, 2.2, M["mirror"], facing="-x")
deco.box((X1 - 0.02, 0.86, 1.5), (0.06, 0.06, 6.1), M["chrome"])
deco.box((X1 - 0.02, 3.14, 1.5), (0.06, 0.06, 6.1), M["chrome"])
deco.build()

# ---------------------------------------------------------------- boxing ring
RX, RZ, RS, RH = -5.0, -4.6, 5.0, 0.75
ring = Builder("Ring")
ring.box((RX, RH - 0.06, RZ), (RS, 0.12, RS), M["canvas"], tile=RS)
ring.box((RX, (RH - 0.01) / 2, RZ), (RS + 0.4, RH - 0.01, RS + 0.4), M["apron"], tile=(4.0, RH))
ring.build()
# canvas top uses a 0..1 mapping: do it as a quad on top for the logo
logo = Builder("RingCanvas")
n0 = 0
logo.quad((RX, RH + 0.001, RZ), RS, RS, M["canvas"], facing="+z")
logo_ob = logo.build()
logo_ob.rotation_euler = (0, 0, 0)
# rotate the quad to lie flat: build it directly flat instead
bpy.data.objects.remove(logo_ob, do_unlink=True)
flat = Builder("RingCanvas")
vs = [flat.bm.verts.new(T(RX + dx * RS / 2, RH + 0.002, RZ + dz * RS / 2)) for dx, dz in ((-1, 1), (1, 1), (1, -1), (-1, -1))]
f = flat.bm.faces.new(vs)
f.material_index = flat._mi(M["canvas"])
for l, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
    l[flat.uv].uv = uv
flat.build()

posts = Builder("RingPosts")
corners = [(-1, -1, "pad_red"), (1, -1, "pad_white"), (1, 1, "pad_blue"), (-1, 1, "pad_white")]
half = RS / 2 - 0.12
for sx, sz, pad in corners:
    px, pz = RX + sx * half, RZ + sz * half
    posts.cyl((px, RH + 0.75, pz), 0.06, 1.5, M["chrome"], segs=12)
    posts.box((px, RH + 0.75, pz), (0.2, 1.1, 0.2), M[pad], bevel=0.02)
for i, (y, rope) in enumerate(((RH + 0.4, "rope_red"), (RH + 0.8, "rope_white"), (RH + 1.2, "rope_blue"))):
    for sx in (-1, 1):
        posts.cyl((RX + sx * half, y, RZ), 0.025, RS - 0.24, M[rope], segs=8, axis="z")
    for sz in (-1, 1):
        posts.cyl((RX, y, RZ + sz * half), 0.025, RS - 0.24, M[rope], segs=8, axis="x")
# steps
for i in range(3):
    posts.box((RX + RS / 2 + 0.45, 0.12 + i * 0.22, RZ + 1.5), (0.5, 0.24, 0.9 - i * 0.0), M["steel"])
posts.build()
collider("ring", (RX, 0.5, RZ), (RS + 0.5, 1.0, RS + 0.5))

# ---------------------------------------------------------------- punching bags
BAGS = [  # x, z, material, body height
    (0.0, -1.0, "bag_red", 1.15),
    (4.0, -1.0, "bag_black", 1.15),
    (2.0, -3.0, "bag_blue", 1.0),
]
PIVOT_Y = 3.6
for i, (bx, bz, bm_, bh) in enumerate(BAGS):
    pivot = empty(f"BagPivot_{i}", (bx, PIVOT_Y, bz))
    bottom = 0.55
    top = bottom + bh
    body = Builder(f"BagBody_{i}")
    body.cyl((bx, bottom + bh / 2, bz), 0.19, bh, M[bm_], segs=28, uv="cyl", rep=2.0, caps=False)
    body.cyl((bx, top + 0.02, bz), 0.19, 0.04, M["cap"], segs=28, r2=0.16)
    body.cyl((bx, bottom - 0.02, bz), 0.16, 0.04, M["cap"], segs=28, r2=0.19)
    body.cyl((bx, top - 0.18, bz), 0.193, 0.05, M["cap"], segs=28)   # band
    body.cyl((bx, bottom + 0.22, bz), 0.193, 0.05, M["cap"], segs=28)
    body.build(parent=pivot, origin=(bx, bottom + bh / 2, bz))

    hw = Builder(f"BagHardware_{i}")
    ring_y = top + 0.42
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        sx, sz = math.cos(a) * 0.15, math.sin(a) * 0.15
        p0 = Vector((bx + sx, top + 0.03, bz + sz))
        p1 = Vector((bx, ring_y - 0.04, bz))
        mid = (p0 + p1) / 2
        d = p1 - p0
        L = d.length
        # orient a thin box from p0 to p1
        yaw = math.atan2(d.x, d.z)
        pitch = math.acos(max(-1, min(1, d.y / L)))
        hw.box(tuple(mid), (0.025, L, 0.006), M["strap"], rot=(pitch * math.cos(yaw), 0, -pitch * math.sin(yaw)))
    hw.torus((bx, ring_y, bz), 0.045, 0.01, M["chain"], axis="z")
    # chain links up to the rail
    y = ring_y + 0.07
    k = 0
    while y < PIVOT_Y - 0.06:
        hw.torus((bx, y, bz), 0.035, 0.008, M["chain"], segs=12, tsegs=6, axis="z" if k % 2 else "x",
                 rot=None)
        y += 0.075
        k += 1
    hw.box((bx, PIVOT_Y - 0.02, bz), (0.12, 0.05, 0.12), M["steel"])  # swivel clamp
    hw.build(parent=pivot, origin=(bx, PIVOT_Y, bz))
    collider(f"bag{i}", (bx, 1.0, bz), (0.5, 2.0, 0.5))

# ---------------------------------------------------------------- dumbbell rack (right wall)
rack = Builder("DumbbellRack")
RXW = X1 - 0.55
for z in (-5.5, -2.0):
    pass
for zc in (-4.6,):
    L = 4.4
    for y, depth_off in ((0.45, 0.0), (0.85, -0.12)):
        rack.box((RXW + depth_off, y, zc), (0.42, 0.04, L), M["steel"])
    for dz in (-L / 2, 0, L / 2):
        rack.box((RXW, 0.45, zc + dz), (0.5, 0.9, 0.06), M["steel"])
    for tier, (y, xo) in enumerate(((0.52, 0.0), (0.92, -0.12))):
        n = 8
        for k in range(n):
            z = zc - L / 2 + 0.3 + k * (L - 0.6) / (n - 1)
            size = 0.07 + (k + tier * n) * 0.004
            rack.cyl((RXW + xo, y + size, z), 0.016, 0.28, M["chrome"], segs=8, axis="x")
            for s in (-1, 1):
                rack.cyl((RXW + xo + s * 0.14, y + size, z), size, 0.08, M["black_rubber"], segs=6, axis="x", smooth=False)
rack.build()
collider("rack", (RXW, 0.5, -4.6), (0.9, 1.0, 4.6))

# ---------------------------------------------------------------- bench press
bp = Builder("BenchPress")
BX, BZ = 6.6, 4.4
bp.box((BX, 0.42, BZ), (0.32, 0.1, 1.25), M["bench_pad"])
bp.box((BX, 0.2, BZ - 0.45), (0.1, 0.4, 0.1), M["steel"])
bp.box((BX, 0.2, BZ + 0.45), (0.1, 0.4, 0.1), M["steel"])
bp.box((BX, 0.03, BZ), (0.5, 0.06, 1.3), M["steel"])
for s in (-1, 1):
    bp.box((BX + s * 0.55, 0.6, BZ - 0.5), (0.06, 1.2, 0.06), M["steel"])
    bp.box((BX + s * 0.55, 0.03, BZ - 0.5), (0.1, 0.06, 0.5), M["steel"])
bp.cyl((BX, 1.12, BZ - 0.52), 0.016, 2.0, M["chrome"], segs=10, axis="x")
for s in (-1, 1):
    bp.cyl((BX + s * 0.8, 1.12, BZ - 0.52), 0.22, 0.05, M["plate_red"], segs=24, axis="x")
    bp.cyl((BX + s * 0.86, 1.12, BZ - 0.52), 0.17, 0.04, M["plate_blue"], segs=24, axis="x")
bp.build()
collider("bench", (BX, 0.5, BZ - 0.1), (1.9, 1.0, 1.6))

# ---------------------------------------------------------------- tractor tire + kettlebells
tire = Builder("Tire")
tire.torus((-6.4, 0.22, 4.2), 0.62, 0.22, M["black_rubber"], segs=32, tsegs=12, axis="y")
for k, (x, z) in enumerate(((-7.6, 1.2), (-7.2, 1.2), (-6.8, 1.2), (-7.4, 0.7))):
    s = 0.12 + k * 0.015
    tire.sphere((x, s, z), s, M["black_rubber"], segs=16, rings=8)
    tire.torus((x, s * 2 + 0.03, z), s * 0.55, 0.018, M["black_rubber"], segs=16, tsegs=6, axis="z")
tire.build()
collider("tire", (-6.4, 0.3, 4.2), (1.7, 0.6, 1.7))
collider("kettle", (-7.2, 0.3, 1.0), (1.2, 0.6, 0.9))

# ---------------------------------------------------------------- lockers (front wall) + trophies
lk = Builder("Lockers")
for k in range(8):
    x = 1.0 + k * 0.62
    lk.box((x, 1.0, Z1 - 0.3), (0.6, 2.0, 0.5), M["locker"])
    for v in range(3):
        lk.box((x, 1.7 + v * 0.06, Z1 - 0.551), (0.3, 0.02, 0.01), M["locker_dark"])
    lk.box((x + 0.2, 1.1, Z1 - 0.56), (0.03, 0.15, 0.03), M["chrome"])
lk.box((1.0 + 3.5 * 0.62, 2.03, Z1 - 0.3), (8 * 0.62, 0.06, 0.52), M["steel"])
for k, x in enumerate((2.0, 3.4, 4.6)):
    s = 1.0 - k * 0.15
    lk.cyl((x, 2.12, Z1 - 0.3), 0.08 * s, 0.12, M["wood_dark"], segs=12)
    lk.cyl((x, 2.3 * 1 + 0.02, Z1 - 0.3), 0.025 * s, 0.24 * s, M["gold"], segs=10)
    lk.cyl((x, 2.42 + 0.06 * s, Z1 - 0.3), 0.1 * s, 0.2 * s, M["gold"], segs=16, r2=0.05 * s, caps=True)
    lk.torus((x - 0.12 * s, 2.5, Z1 - 0.3), 0.05 * s, 0.01, M["gold"], segs=12, tsegs=6, axis="z")
    lk.torus((x + 0.12 * s, 2.5, Z1 - 0.3), 0.05 * s, 0.01, M["gold"], segs=12, tsegs=6, axis="z")
# wooden bench in front of lockers
lk.box((3.2, 0.45, Z1 - 1.0), (3.0, 0.06, 0.38), M["wood_dark"], tile=1.0)
for x in (2.0, 4.4):
    lk.box((x, 0.21, Z1 - 1.0), (0.08, 0.42, 0.3), M["steel"])
lk.build()
collider("lockers", (3.2, 1.0, Z1 - 0.6), (5.2, 2.0, 1.4))

# ---------------------------------------------------------------- lamps
lamps = Builder("Lamps")
LAMPS = [(0.0, -1.0), (4.0, -1.0), (2.0, -3.0), (RX, RZ), (-3.0, 3.5), (3.0, 4.0), (6.5, 1.5), (-6.5, -0.5)]
for i, (x, z) in enumerate(LAMPS):
    y = 3.2 if i < 3 else 3.5
    if i < 3:
        z = z + 0.8  # beside the chain so the bag stays lit from the front
    lamps.cyl((x, (y + H) / 2 + 0.15, z), 0.008, H - y - 0.3, M["steel"], segs=6)
    lamps.cyl((x, y + 0.12, z), 0.06, 0.12, M["shade"], segs=16)
    lamps.cyl((x, y - 0.02, z), 0.32, 0.22, M["shade"], segs=24, r2=0.06, caps=False)
    lamps.sphere((x, y - 0.08, z), 0.07, M["bulb"], segs=12, rings=6)
    empty(f"LAMP_{i}", (x, y - 0.12, z))
lamps.build()

# ---------------------------------------------------------------- disco ball (parked at the ceiling)
disco = Builder("DiscoBall")
disco.sphere((0, 4.0, 1.5), 0.32, M["disco"], segs=24, rings=14, smooth=False)
disco.cyl((0, 4.4, 1.5), 0.006, 0.5, M["chain"], segs=6)
disco.build(origin=(0, 4.0, 1.5))

empty("Spawn", (0.0, 0.0, 1.6))
# room bounds (inner)
collider("bounds", (0, H / 2, 0), (W - 0.6, H, D - 0.6))

# ---------------------------------------------------------------- export
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_image_format="JPEG",
    export_extras=False,
    export_lights=False,
    export_cameras=False,
    use_selection=False,
)
print("EXPORTED", OUT, os.path.getsize(OUT))
