"""Render the Grand Tour celestial bodies as spinning sprite sheets.

Run headless (Blender 5.x):
  blender -b --python scripts/blender/render_bodies.py -- <out_dir> [frames] [body ...]
Then scripts/blender/build_sheets.sh packs the frames into public/sprites/*.webp.

Everything is procedural (no texture files), so the assets are reproducible from source.
"""

import math
import os
import sys

import bpy

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = ARGV[0] if ARGV else "/tmp/grand-tour-render"
FRAMES = int(ARGV[1]) if len(ARGV) > 1 else 36
ONLY = set(ARGV[2:])
SAMPLES = 48


def hex_rgba(value):
    value = value.lstrip("#")
    srgb = [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*linear, 1.0)


def sock(node, name, kind=None, out=False):
    for s in node.outputs if out else node.inputs:
        if s.name == name and (kind is None or s.type == kind):
            return s
    raise KeyError(f"{node.bl_idname} has no socket {name} {kind or ''}")


def use_gpu_if_available(scene):
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for device in prefs.devices:
            device.use = True
        scene.cycles.device = "GPU"
    except (KeyError, TypeError, ValueError) as err:
        print(f"GPU unavailable, rendering on CPU: {err}")
        scene.cycles.device = "CPU"


def new_scene(size):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    use_gpu_if_available(scene)
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"

    world = bpy.data.worlds.new("Space")
    world.color = (0, 0, 0)
    scene.world = world
    if world.node_tree:
        for node in world.node_tree.nodes:
            if node.type == "BACKGROUND":
                node.inputs["Strength"].default_value = 0.0

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.2
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -10, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam

    target = bpy.data.objects.new("Target", None)
    scene.collection.objects.link(target)
    return scene, target


def add_sun(scene, target, location, energy, color=(1, 1, 1)):
    data = bpy.data.lights.new("Sun", "SUN")
    data.energy = energy
    data.color = color
    obj = bpy.data.objects.new("Sun", data)
    scene.collection.objects.link(obj)
    obj.location = location
    track = obj.constraints.new("TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"


def add_sphere(scene, tilt_deg):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=1.0)
    sphere = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    pivot = bpy.data.objects.new("Axis", None)
    scene.collection.objects.link(pivot)
    pivot.rotation_euler = (math.radians(tilt_deg), 0, math.radians(-8))
    sphere.parent = pivot
    return sphere


def new_material(name):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    tree = mat.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    return mat, tree, tree.nodes.new("ShaderNodeOutputMaterial")


def ramp(tree, stops):
    node = tree.nodes.new("ShaderNodeValToRGB")
    elements = node.color_ramp.elements
    while len(elements) < len(stops):
        elements.new(0.5)
    for element, (position, color) in zip(elements, stops):
        element.position = position
        element.color = hex_rgba(color)
    return node


def mix_color(tree, factor, a, b):
    node = tree.nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    tree.links.new(factor, sock(node, "Factor", "VALUE"))
    tree.links.new(a, sock(node, "A", "RGBA"))
    tree.links.new(b, sock(node, "B", "RGBA"))
    return sock(node, "Result", "RGBA", out=True)


def spot_mask(tree, coord, center, radii):
    """Soft ellipsoid mask around `center` in object space (1 inside, 0 outside)."""
    mapping = tree.nodes.new("ShaderNodeMapping")
    scale = [1 / r for r in radii]
    mapping.inputs["Scale"].default_value = scale
    mapping.inputs["Location"].default_value = [-c * s for c, s in zip(center, scale)]
    tree.links.new(coord, mapping.inputs["Vector"])
    length = tree.nodes.new("ShaderNodeVectorMath")
    length.operation = "LENGTH"
    tree.links.new(mapping.outputs["Vector"], length.inputs[0])
    remap = tree.nodes.new("ShaderNodeMapRange")
    remap.inputs["From Min"].default_value = 0.55
    remap.inputs["From Max"].default_value = 1.0
    remap.inputs["To Min"].default_value = 1.0
    remap.inputs["To Max"].default_value = 0.0
    tree.links.new(sock(length, "Value", out=True), remap.inputs["Value"])
    return remap.outputs["Result"]


def warped_coords(tree, amount, scale):
    coord = tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 6.0
    tree.links.new(coord, noise.inputs["Vector"])
    centered = tree.nodes.new("ShaderNodeVectorMath")
    centered.operation = "SUBTRACT"
    centered.inputs[1].default_value = (0.5, 0.5, 0.5)
    tree.links.new(sock(noise, "Color", out=True), centered.inputs[0])
    scaled = tree.nodes.new("ShaderNodeVectorMath")
    scaled.operation = "SCALE"
    sock(scaled, "Scale").default_value = amount
    tree.links.new(centered.outputs[0], scaled.inputs[0])
    warped = tree.nodes.new("ShaderNodeVectorMath")
    warped.operation = "ADD"
    tree.links.new(coord, warped.inputs[0])
    tree.links.new(scaled.outputs[0], warped.inputs[1])
    return coord, warped.outputs[0]


def jupiter_material():
    mat, tree, out = new_material("Jupiter")
    coord, warped = warped_coords(tree, 0.07, 6.0)
    # Belts and zones follow latitude (object Z), south pole to north pole.
    axes = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(warped, axes.inputs[0])
    latitude = tree.nodes.new("ShaderNodeMapRange")
    latitude.inputs["From Min"].default_value = -1.0
    latitude.inputs["From Max"].default_value = 1.0
    tree.links.new(axes.outputs["Z"], latitude.inputs["Value"])
    bands = ramp(
        tree,
        [(0.0, "#8d8474"), (0.12, "#a08f78"), (0.2, "#cdb998"), (0.27, "#b88a5e"),
         (0.32, "#e8d8ba"), (0.38, "#a4633a"), (0.44, "#c98a52"), (0.5, "#f2e4c8"),
         (0.56, "#e6c79c"), (0.61, "#9a5830"), (0.67, "#d7b287"), (0.73, "#f0e2c5"),
         (0.8, "#b58c63"), (0.88, "#c8b396"), (1.0, "#8a8070")],
    )
    tree.links.new(latitude.outputs["Result"], bands.inputs["Factor"])
    lat = math.radians(-22)
    spot = spot_mask(tree, warped, (0.0, -math.cos(lat), math.sin(lat)), (0.34, 0.34, 0.17))
    spot_color = tree.nodes.new("ShaderNodeRGB")
    spot_color.outputs[0].default_value = hex_rgba("#b8442a")
    base = mix_color(tree, spot, bands.outputs["Color"], spot_color.outputs[0])
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(base, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    tree.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat


def moon_material():
    mat, tree, out = new_material("Moon")
    coord = tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    maria = tree.nodes.new("ShaderNodeTexNoise")
    maria.inputs["Scale"].default_value = 1.6
    maria.inputs["Detail"].default_value = 8.0
    tree.links.new(coord, maria.inputs["Vector"])
    albedo = ramp(tree, [(0.38, "#565a61"), (0.62, "#c8cbd0")])
    tree.links.new(sock(maria, "Factor", out=True), albedo.inputs["Factor"])

    bump_in = None
    for scale, depth in ((5.0, 1.0), (14.0, 0.5)):
        cells = tree.nodes.new("ShaderNodeTexVoronoi")
        cells.inputs["Scale"].default_value = scale
        tree.links.new(coord, cells.inputs["Vector"])
        bowl = tree.nodes.new("ShaderNodeMapRange")
        bowl.inputs["From Min"].default_value = 0.0
        bowl.inputs["From Max"].default_value = 0.42
        bowl.inputs["To Min"].default_value = 0.0
        bowl.inputs["To Max"].default_value = depth
        tree.links.new(sock(cells, "Distance", out=True), bowl.inputs["Value"])
        if bump_in is None:
            bump_in = bowl.outputs["Result"]
        else:
            add = tree.nodes.new("ShaderNodeMath")
            add.operation = "ADD"
            tree.links.new(bump_in, add.inputs[0])
            tree.links.new(bowl.outputs["Result"], add.inputs[1])
            bump_in = add.outputs[0]
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.55
    bump.inputs["Distance"].default_value = 0.08
    tree.links.new(bump_in, bump.inputs["Height"])

    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
    tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 1.0
    tree.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat


def pulsar_material():
    mat, tree, out = new_material("Pulsar")
    coord, warped = warped_coords(tree, 0.35, 6.0)
    turbulence = tree.nodes.new("ShaderNodeTexNoise")
    turbulence.inputs["Scale"].default_value = 7.0
    turbulence.inputs["Detail"].default_value = 10.0
    tree.links.new(warped, turbulence.inputs["Vector"])
    surface = ramp(tree, [(0.35, "#38bdf8"), (0.6, "#e0f2fe"), (0.8, "#ffffff")])
    tree.links.new(sock(turbulence, "Factor", out=True), surface.inputs["Factor"])
    north = spot_mask(tree, coord, (0.0, 0.0, 1.0), (0.45, 0.45, 0.45))
    south = spot_mask(tree, coord, (0.0, 0.0, -1.0), (0.45, 0.45, 0.45))
    poles = tree.nodes.new("ShaderNodeMath")
    poles.operation = "MAXIMUM"
    tree.links.new(north, poles.inputs[0])
    tree.links.new(south, poles.inputs[1])
    white = tree.nodes.new("ShaderNodeRGB")
    white.outputs[0].default_value = (1, 1, 1, 1)
    color = mix_color(tree, poles.outputs[0], surface.outputs["Color"], white.outputs[0])
    rim = tree.nodes.new("ShaderNodeLayerWeight")
    rim.inputs["Blend"].default_value = 0.35
    edge_blue = tree.nodes.new("ShaderNodeRGB")
    edge_blue.outputs[0].default_value = hex_rgba("#0ea5e9")
    color = mix_color(tree, sock(rim, "Fresnel", out=True), color, edge_blue.outputs[0])
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.6
    tree.links.new(color, emission.inputs["Color"])
    tree.links.new(emission.outputs[0], out.inputs["Surface"])
    return mat


BODIES = {
    "moon": {"size": 192, "tilt": 6, "material": moon_material, "lit": True},
    "jupiter": {"size": 256, "tilt": 10, "material": jupiter_material, "lit": True},
    "pulsar": {"size": 128, "tilt": 30, "material": pulsar_material, "lit": False},
}


def render_body(name, spec):
    scene, target = new_scene(spec["size"])
    if spec["lit"]:
        add_sun(scene, target, (-2.5, -6, 2.5), 5.0)
        add_sun(scene, target, (5, 6, 1.5), 2.0, (0.55, 0.75, 1.0))
    sphere = add_sphere(scene, spec["tilt"])
    sphere.data.materials.append(spec["material"]())
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    for frame in range(FRAMES):
        sphere.rotation_euler = (0, 0, 2 * math.pi * frame / FRAMES)
        scene.render.filepath = os.path.join(folder, f"f{frame:02d}.png")
        bpy.ops.render.render(write_still=True)
    print(f"rendered {FRAMES} frames of {name} into {folder}")


for body_name, body_spec in BODIES.items():
    if not ONLY or body_name in ONLY:
        render_body(body_name, body_spec)
