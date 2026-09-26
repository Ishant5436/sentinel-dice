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


def new_scene(size, ortho=2.2):
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
    cam_data.ortho_scale = ortho
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


def accretion_material(name, brightness, inner=1.4, outer=2.8):
    """Hot turbulent plasma: white-gold inner edge fading to deep red, with Doppler beaming.

    Emission fades to transparent at the edges. The beaming gradient uses camera-space X,
    so the approaching (left) side stays brighter while the disk spins.
    """
    mat, tree, out = new_material(name)
    coord = tree.nodes.new("ShaderNodeTexCoord")
    radius = tree.nodes.new("ShaderNodeVectorMath")
    radius.operation = "LENGTH"
    tree.links.new(coord.outputs["Object"], radius.inputs[0])
    radial = tree.nodes.new("ShaderNodeMapRange")
    radial.inputs["From Min"].default_value = inner
    radial.inputs["From Max"].default_value = outer
    radial.inputs["To Min"].default_value = 1.0
    radial.inputs["To Max"].default_value = 0.0
    tree.links.new(sock(radius, "Value", out=True), radial.inputs["Value"])

    swirl = tree.nodes.new("ShaderNodeTexWave")
    swirl.wave_type = "RINGS"
    swirl.inputs["Scale"].default_value = 2.6
    swirl.inputs["Distortion"].default_value = 7.0
    swirl.inputs["Detail"].default_value = 6.0
    tree.links.new(coord.outputs["Object"], swirl.inputs["Vector"])
    streaks = tree.nodes.new("ShaderNodeMapRange")
    streaks.inputs["To Min"].default_value = 0.45
    streaks.inputs["To Max"].default_value = 1.0
    tree.links.new(sock(swirl, "Factor", out=True), streaks.inputs["Value"])

    axes = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["Camera"], axes.inputs[0])
    doppler = tree.nodes.new("ShaderNodeMapRange")
    doppler.inputs["From Min"].default_value = -3.0
    doppler.inputs["From Max"].default_value = 3.0
    doppler.inputs["To Min"].default_value = 1.8
    doppler.inputs["To Max"].default_value = 0.5
    tree.links.new(axes.outputs["X"], doppler.inputs["Value"])

    intensity = tree.nodes.new("ShaderNodeMath")
    intensity.operation = "MULTIPLY"
    tree.links.new(radial.outputs["Result"], intensity.inputs[0])
    tree.links.new(streaks.outputs["Result"], intensity.inputs[1])
    strength = tree.nodes.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    tree.links.new(intensity.outputs[0], strength.inputs[0])
    tree.links.new(doppler.outputs["Result"], strength.inputs[1])
    scaled = tree.nodes.new("ShaderNodeMath")
    scaled.operation = "MULTIPLY"
    scaled.inputs[1].default_value = brightness
    tree.links.new(strength.outputs[0], scaled.inputs[0])

    heat = ramp(tree, [(0.0, "#5c1208"), (0.35, "#e2541b"), (0.7, "#ffb05a"), (1.0, "#fffbe8")])
    tree.links.new(radial.outputs["Result"], heat.inputs["Factor"])
    emission = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(heat.outputs["Color"], emission.inputs["Color"])
    tree.links.new(scaled.outputs[0], emission.inputs["Strength"])

    coverage = tree.nodes.new("ShaderNodeMath")
    coverage.operation = "MULTIPLY"
    coverage.use_clamp = True
    coverage.inputs[1].default_value = 1.6
    tree.links.new(intensity.outputs[0], coverage.inputs[0])
    transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(coverage.outputs[0], mix.inputs[0])
    tree.links.new(transparent.outputs[0], mix.inputs[1])
    tree.links.new(emission.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs["Surface"])
    return mat


def black_material():
    mat, tree, out = new_material("Horizon")
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (0, 0, 0, 1)
    tree.links.new(emission.outputs[0], out.inputs["Surface"])
    return mat


def add_ring(major, minor, flatten_axis, material, tilt_deg=0.0):
    bpy.ops.mesh.primitive_torus_add(major_segments=192, minor_segments=24, major_radius=major, minor_radius=minor)
    ring = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    ring.scale = (1, 1, 0.03) if flatten_axis == "Z" else (1, 1, 0.03)
    if flatten_axis == "Y":
        ring.rotation_euler = (math.radians(90), 0, 0)
    else:
        ring.rotation_euler = (math.radians(tilt_deg), 0, 0)
    ring.data.materials.append(material)
    return ring


def build_blackhole(scene):
    """Event horizon, tilted accretion disk, lensed halo over the top, and a photon ring.
    Returns the objects to spin each frame and the local axis each spins about."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=1.0)
    horizon = bpy.context.active_object
    horizon.data.materials.append(black_material())
    disk = add_ring(2.1, 0.7, "Z", accretion_material("Disk", 5.0), tilt_deg=16)
    halo = add_ring(1.2, 0.18, "Y", accretion_material("Halo", 2.4, inner=1.02, outer=1.42))
    add_ring(1.03, 0.025, "Y", accretion_material("Photon", 5.0, inner=1.0, outer=1.1))
    return [disk, halo]


# ---------------------------------------------------------------------------------------------
# Bodies added with the eight-body paytable: Comet, Neptune, Saturn, Red giant, plus the galaxy.


def op(tree, operation, a, b=None, clamp=False):
    """Math node: `a`/`b` are sockets or constants."""
    node = tree.nodes.new("ShaderNodeMath")
    node.operation = operation
    node.use_clamp = clamp
    for index, value in enumerate((a, b)):
        if value is None:
            continue
        if isinstance(value, (int, float)):
            node.inputs[index].default_value = value
        else:
            tree.links.new(value, node.inputs[index])
    return node.outputs[0]


def remap(tree, value, from_min, from_max, to_min=0.0, to_max=1.0):
    node = tree.nodes.new("ShaderNodeMapRange")
    node.clamp = True
    node.inputs["From Min"].default_value = from_min
    node.inputs["From Max"].default_value = from_max
    node.inputs["To Min"].default_value = to_min
    node.inputs["To Max"].default_value = to_max
    tree.links.new(value, node.inputs["Value"])
    return node.outputs["Result"]


def rgb(tree, color):
    node = tree.nodes.new("ShaderNodeRGB")
    node.outputs[0].default_value = hex_rgba(color)
    return node.outputs[0]


def latitude_of(tree, warped):
    axes = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(warped, axes.inputs[0])
    return remap(tree, axes.outputs["Z"], -1.0, 1.0)


def neptune_material():
    mat, tree, out = new_material("Neptune")
    coord, warped = warped_coords(tree, 0.05, 5.0)
    bands = ramp(
        tree,
        [(0.0, "#172c6e"), (0.18, "#2446b0"), (0.32, "#3a6fd8"), (0.44, "#2f5fcf"),
         (0.52, "#4b86e8"), (0.62, "#3569d6"), (0.76, "#2a52be"), (0.9, "#203f99"), (1.0, "#172c6e")],
    )
    tree.links.new(latitude_of(tree, warped), bands.inputs["Factor"])
    lat = math.radians(-20)
    spot = spot_mask(tree, warped, (0.0, -math.cos(lat), math.sin(lat)), (0.3, 0.3, 0.14))
    color = mix_color(tree, spot, bands.outputs["Color"], rgb(tree, "#0d1a4a"))
    # Bright methane-ice streaks, stretched along latitude.
    stretch = tree.nodes.new("ShaderNodeMapping")
    stretch.inputs["Scale"].default_value = (1.0, 1.0, 12.0)
    tree.links.new(warped, stretch.inputs["Vector"])
    streaks = tree.nodes.new("ShaderNodeTexNoise")
    streaks.inputs["Scale"].default_value = 2.5
    streaks.inputs["Detail"].default_value = 8.0
    tree.links.new(stretch.outputs["Vector"], streaks.inputs["Vector"])
    clouds = op(tree, "MULTIPLY", remap(tree, sock(streaks, "Factor", out=True), 0.66, 0.74), 0.8)
    color = mix_color(tree, clouds, color, rgb(tree, "#e8f1ff"))
    rim = tree.nodes.new("ShaderNodeLayerWeight")
    rim.inputs["Blend"].default_value = 0.3
    color = mix_color(tree, sock(rim, "Fresnel", out=True), color, rgb(tree, "#9cc9ff"))
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(color, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.7
    tree.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat


def saturn_material():
    mat, tree, out = new_material("Saturn")
    coord, warped = warped_coords(tree, 0.03, 5.0)
    bands = ramp(
        tree,
        [(0.0, "#7d7159"), (0.16, "#b9a47c"), (0.28, "#e3d2a6"), (0.37, "#c7a771"), (0.45, "#efe2bd"),
         (0.55, "#e8d6aa"), (0.63, "#bf9c66"), (0.72, "#e6d7b1"), (0.86, "#b9a47c"), (1.0, "#7d7159")],
    )
    tree.links.new(latitude_of(tree, warped), bands.inputs["Factor"])
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(bands.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    tree.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat


RING_INNER = 1.25
RING_OUTER = 2.35


def ring_material():
    """Saturn's rings on a flat disc: C ring, dense B ring, the Cassini gap, A ring and the Encke gap."""
    mat, tree, out = new_material("Rings")
    coord = tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    length = tree.nodes.new("ShaderNodeVectorMath")
    length.operation = "LENGTH"
    tree.links.new(coord, length.inputs[0])
    radius = sock(length, "Value", out=True)
    across = remap(tree, radius, RING_INNER, RING_OUTER)
    density = ramp(
        tree,
        [(0.0, "#000000"), (0.02, "#303030"), (0.18, "#4a4a4a"), (0.22, "#d8d8d8"), (0.52, "#f2f2f2"),
         (0.56, "#101010"), (0.62, "#101010"), (0.65, "#b0b0b0"), (0.86, "#a8a8a8"), (0.875, "#1a1a1a"),
         (0.89, "#a0a0a0"), (0.98, "#707070"), (1.0, "#000000")],
    )
    tree.links.new(across, density.inputs["Factor"])
    # Fine ringlets: a fast sine in radius modulates the opacity by +/-12%.
    ringlets = op(tree, "MULTIPLY_ADD", op(tree, "SINE", op(tree, "MULTIPLY", radius, 140.0)), 0.12)
    ringlets.node.inputs[2].default_value = 0.88
    alpha = op(tree, "MULTIPLY", density.outputs["Color"], ringlets, clamp=True)
    tint = ramp(tree, [(0.0, "#a8987a"), (0.5, "#dccca6"), (1.0, "#bfae8a")])
    tree.links.new(across, tint.inputs["Factor"])
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(tint.outputs["Color"], bsdf.inputs["Base Color"])
    tree.links.new(alpha, bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.9
    tree.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat


SATURN_ORTHO = 5.0  # frame spans 5 planet radii so the rings (2.35 r) fit


def build_saturn(scene):
    pivot = bpy.data.objects.new("Axis", None)
    scene.collection.objects.link(pivot)
    pivot.rotation_euler = (math.radians(24), 0, math.radians(-10))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=1.0)
    planet = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    planet.scale = (1.0, 1.0, 0.92)  # Saturn is visibly oblate
    planet.data.materials.append(saturn_material())
    planet.parent = pivot
    bpy.ops.mesh.primitive_circle_add(vertices=256, radius=RING_OUTER, fill_type="NGON")
    rings = bpy.context.active_object
    rings.data.materials.append(ring_material())
    rings.parent = pivot
    return [planet]


def redgiant_material():
    mat, tree, out = new_material("RedGiant")
    coord, warped = warped_coords(tree, 0.25, 3.0)
    cells = tree.nodes.new("ShaderNodeTexVoronoi")
    cells.inputs["Scale"].default_value = 9.0
    tree.links.new(warped, cells.inputs["Vector"])
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 4.0
    noise.inputs["Detail"].default_value = 8.0
    tree.links.new(warped, noise.inputs["Vector"])
    granules = op(
        tree,
        "ADD",
        op(tree, "MULTIPLY", sock(cells, "Distance", out=True), 0.6),
        op(tree, "MULTIPLY", sock(noise, "Factor", out=True), 0.5),
    )
    heat = ramp(tree, [(0.1, "#5c0f05"), (0.35, "#b3260b"), (0.6, "#f0661c"), (0.85, "#ffb35c"), (1.0, "#fff0c8")])
    tree.links.new(granules, heat.inputs["Factor"])
    # Limb darkening: Facing is 0 at the disk center and 1 at the limb.
    facing = tree.nodes.new("ShaderNodeLayerWeight")
    facing.inputs["Blend"].default_value = 0.5
    limb = op(tree, "POWER", op(tree, "SUBTRACT", 1.0, sock(facing, "Facing", out=True)), 0.6)
    strength = op(tree, "MULTIPLY_ADD", limb, 2.4)
    strength.node.inputs[2].default_value = 0.5
    emission = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(heat.outputs["Color"], emission.inputs["Color"])
    tree.links.new(strength, emission.inputs["Strength"])
    tree.links.new(emission.outputs[0], out.inputs["Surface"])
    return mat


def comet_rock_material():
    mat, tree, out = new_material("CometRock")
    coord = tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 6.0
    noise.inputs["Detail"].default_value = 10.0
    tree.links.new(coord, noise.inputs["Vector"])
    albedo = ramp(tree, [(0.3, "#221d19"), (0.7, "#5b544c")])
    tree.links.new(sock(noise, "Factor", out=True), albedo.inputs["Factor"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.8
    tree.links.new(sock(noise, "Factor", out=True), bump.inputs["Height"])
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
    tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 1.0
    tree.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat


def coma_material():
    """Soft glowing gas envelope: bright toward the middle, transparent at the edge."""
    mat, tree, out = new_material("Coma")
    facing = tree.nodes.new("ShaderNodeLayerWeight")
    facing.inputs["Blend"].default_value = 0.5
    glow = op(tree, "POWER", op(tree, "SUBTRACT", 1.0, sock(facing, "Facing", out=True)), 3.0)
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = hex_rgba("#a5f3fc")
    tree.links.new(op(tree, "MULTIPLY", glow, 0.9), emission.inputs["Strength"])
    transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
    mix = tree.nodes.new("ShaderNodeMixShader")
    # Thin gas: at most ~30% opaque, so the rocky nucleus shows through the coma.
    tree.links.new(op(tree, "MULTIPLY", glow, 0.3, clamp=True), mix.inputs[0])
    tree.links.new(transparent.outputs[0], mix.inputs[1])
    tree.links.new(emission.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs["Surface"])
    return mat


COMET_ORTHO = 3.0  # nucleus plus coma; the tails are drawn live by the canvas


def build_comet(scene):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=1.0)
    nucleus = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    nucleus.scale = (0.78, 0.58, 0.52)
    rock = bpy.data.textures.new("CometShape", type="CLOUDS")
    rock.noise_scale = 0.45
    displace = nucleus.modifiers.new("Irregular", "DISPLACE")
    displace.texture = rock
    displace.strength = 0.35
    nucleus.data.materials.append(comet_rock_material())
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1.35)
    coma = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    coma.data.materials.append(coma_material())
    coma.visible_shadow = False
    return [nucleus]


def galaxy_material():
    """Two-armed logarithmic spiral (sin(2 theta + k ln r)) with dust lanes, clusters and a warm core."""
    mat, tree, out = new_material("Galaxy")
    coord = tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    axes = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord, axes.inputs[0])
    x, y = axes.outputs["X"], axes.outputs["Y"]
    r = op(tree, "SQRT", op(tree, "ADD", op(tree, "MULTIPLY", x, x), op(tree, "MULTIPLY", y, y)))
    theta = op(tree, "ARCTAN2", y, x)
    wobble = tree.nodes.new("ShaderNodeTexNoise")
    wobble.inputs["Scale"].default_value = 3.0
    wobble.inputs["Detail"].default_value = 4.0
    tree.links.new(coord, wobble.inputs["Vector"])
    twist = op(tree, "MULTIPLY", op(tree, "LOGARITHM", op(tree, "ADD", r, 0.03), 2.718281828), 5.2)
    phase = op(
        tree,
        "ADD",
        op(tree, "ADD", op(tree, "MULTIPLY", theta, 2.0), twist),
        op(tree, "MULTIPLY", sock(wobble, "Factor", out=True), 1.2),
    )
    arms = op(tree, "POWER", remap(tree, op(tree, "SINE", phase), -0.35, 1.0), 1.15)
    lanes = remap(tree, op(tree, "SINE", op(tree, "SUBTRACT", phase, 0.7)), 0.6, 1.0)
    clumps = tree.nodes.new("ShaderNodeTexNoise")
    clumps.inputs["Scale"].default_value = 14.0
    clumps.inputs["Detail"].default_value = 10.0
    tree.links.new(coord, clumps.inputs["Vector"])
    clumped = op(tree, "MULTIPLY", arms, remap(tree, sock(clumps, "Factor", out=True), 0.3, 0.75, 0.6, 1.3))
    disk = remap(tree, r, 0.05, 0.98, 1.0, 0.0)
    core = op(tree, "POWER", remap(tree, r, 0.0, 0.3, 1.0, 0.0), 2.2)
    haze = op(tree, "MULTIPLY", op(tree, "POWER", disk, 2.0), 0.35)
    stars = tree.nodes.new("ShaderNodeTexVoronoi")
    stars.inputs["Scale"].default_value = 160.0
    tree.links.new(coord, stars.inputs["Vector"])
    sparkle = remap(tree, sock(stars, "Distance", out=True), 0.06, 0.0)
    body = op(
        tree,
        "MULTIPLY",
        op(tree, "MULTIPLY", clumped, disk),
        op(tree, "SUBTRACT", 1.0, op(tree, "MULTIPLY", lanes, 0.55)),
    )
    brightness = op(
        tree,
        "ADD",
        op(tree, "ADD", op(tree, "MULTIPLY", core, 3.2), op(tree, "MULTIPLY", body, 2.1)),
        op(
            tree,
            "ADD",
            op(tree, "MULTIPLY", op(tree, "MULTIPLY", sparkle, arms), op(tree, "MULTIPLY", disk, 2.0)),
            haze,
        ),
    )
    color = ramp(tree, [(0.0, "#fff1c9"), (0.25, "#ffd79a"), (0.45, "#c9d8ff"), (1.0, "#8fb4ff")])
    tree.links.new(r, color.inputs["Factor"])
    hii = remap(tree, sock(clumps, "Factor", out=True), 0.68, 0.8)
    tinted = mix_color(tree, op(tree, "MULTIPLY", hii, arms), color.outputs["Color"], rgb(tree, "#ff7eb6"))
    emission = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(tinted, emission.inputs["Color"])
    tree.links.new(brightness, emission.inputs["Strength"])
    transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(op(tree, "MULTIPLY", brightness, 1.3, clamp=True), mix.inputs[0])
    tree.links.new(transparent.outputs[0], mix.inputs[1])
    tree.links.new(emission.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs["Surface"])
    return mat


def render_galaxy(size=1024):
    """Single frame: an inclined spiral galaxy on a transparent background (galaxy.png)."""
    scene, _ = new_scene(size, 2.1)
    scene.cycles.samples = 96
    bpy.ops.mesh.primitive_plane_add(size=2.0)
    plane = bpy.context.active_object
    plane.rotation_euler = (math.radians(90 - 32), 0, math.radians(18))
    plane.data.materials.append(galaxy_material())
    os.makedirs(OUT, exist_ok=True)
    scene.render.filepath = os.path.join(OUT, "galaxy.png")
    bpy.ops.render.render(write_still=True)
    print(f"rendered galaxy into {scene.render.filepath}")


BLACKHOLE_ORTHO = 6.2  # frame spans 6.2 horizon radii (the disk reaches 2.8)

BODIES = {
    "moon": {"size": 192, "tilt": 6, "material": moon_material, "lit": True},
    "jupiter": {"size": 256, "tilt": 10, "material": jupiter_material, "lit": True},
    "pulsar": {"size": 128, "tilt": 30, "material": pulsar_material, "lit": False},
    "blackhole": {"size": 320, "ortho": BLACKHOLE_ORTHO, "build": build_blackhole, "lit": False},
    "comet": {"size": 192, "ortho": COMET_ORTHO, "build": build_comet, "lit": True},
    "neptune": {"size": 192, "tilt": 28, "material": neptune_material, "lit": True},
    "saturn": {"size": 320, "ortho": SATURN_ORTHO, "build": build_saturn, "lit": True},
    "redgiant": {"size": 256, "tilt": 12, "material": redgiant_material, "lit": False},
}


def render_body(name, spec):
    scene, target = new_scene(spec["size"], spec.get("ortho", 2.2))
    if spec["lit"]:
        add_sun(scene, target, (-2.5, -6, 2.5), 5.0)
        add_sun(scene, target, (5, 6, 1.5), 2.0, (0.55, 0.75, 1.0))
    if "build" in spec:
        spinners = spec["build"](scene)
    else:
        sphere = add_sphere(scene, spec["tilt"])
        sphere.data.materials.append(spec["material"]())
        spinners = [sphere]
    base = [tuple(obj.rotation_euler) for obj in spinners]
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    for frame in range(FRAMES):
        angle = 2 * math.pi * frame / FRAMES
        for obj, (rx, ry, _) in zip(spinners, base):
            obj.rotation_euler = (rx, ry, angle)
        scene.render.filepath = os.path.join(folder, f"f{frame:02d}.png")
        bpy.ops.render.render(write_still=True)
    print(f"rendered {FRAMES} frames of {name} into {folder}")


if __name__ == "__main__":
    for body_name, body_spec in BODIES.items():
        if not ONLY or body_name in ONLY:
            render_body(body_name, body_spec)
    if not ONLY or "galaxy" in ONLY:
        render_galaxy()
