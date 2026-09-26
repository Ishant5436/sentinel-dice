"""Render the 1200x630 gallery cover (og:image) for Gravity Slingshot: Grand Tour.

Run headless (Blender 5.x):
  blender -b --python scripts/blender/render_cover.py -- <out.png> [scale-percent]
Then scripts/blender/finish_cover.sh <out.png> adds bloom and the title into public/og-image.png.

Reuses the procedural body materials from render_bodies.py.
"""

import math
import os
import sys

import bpy

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import render_bodies as rb  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = ARGV[0] if ARGV else "/tmp/grand-tour-cover.png"
SCALE = int(ARGV[1]) if len(ARGV) > 1 else 100  # 200 renders the 2400x1260 title-screen backdrop


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    rb.use_gpu_if_available(scene)
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 630
    scene.render.resolution_percentage = SCALE
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Standard"

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -14, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam
    return scene


def starfield_world(scene):
    """Near-black violet sky with sparse point stars from a Voronoi pattern on the view direction."""
    world = bpy.data.worlds.new("Stars")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    tree = world.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    out = tree.nodes.new("ShaderNodeOutputWorld")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    cells = tree.nodes.new("ShaderNodeTexVoronoi")
    cells.inputs["Scale"].default_value = 180.0
    tree.links.new(coord.outputs["Generated"], cells.inputs["Vector"])
    core = tree.nodes.new("ShaderNodeMapRange")
    core.inputs["From Min"].default_value = 0.0
    core.inputs["From Max"].default_value = 0.05
    core.inputs["To Min"].default_value = 1.0
    core.inputs["To Max"].default_value = 0.0
    tree.links.new(rb.sock(cells, "Distance", out=True), core.inputs["Value"])
    pick = tree.nodes.new("ShaderNodeSeparateColor")
    tree.links.new(rb.sock(cells, "Color", out=True), pick.inputs[0])
    gate = tree.nodes.new("ShaderNodeMapRange")
    gate.inputs["From Min"].default_value = 0.6
    gate.inputs["From Max"].default_value = 1.0
    tree.links.new(pick.outputs[0], gate.inputs["Value"])
    star = tree.nodes.new("ShaderNodeMath")
    star.operation = "MULTIPLY"
    tree.links.new(core.outputs["Result"], star.inputs[0])
    tree.links.new(gate.outputs["Result"], star.inputs[1])
    sky = tree.nodes.new("ShaderNodeMath")
    sky.operation = "ADD"
    sky.inputs[1].default_value = 0.006
    bright = tree.nodes.new("ShaderNodeMath")
    bright.operation = "MULTIPLY"
    bright.inputs[1].default_value = 5.0
    tree.links.new(star.outputs[0], bright.inputs[0])
    tree.links.new(bright.outputs[0], sky.inputs[0])
    background = tree.nodes.new("ShaderNodeBackground")
    background.inputs["Color"].default_value = rb.hex_rgba("#c9c2ff")
    tree.links.new(sky.outputs[0], background.inputs["Strength"])
    tree.links.new(background.outputs[0], out.inputs["Surface"])


def add_body(material, location, radius, tilt_deg, spin_deg):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=160, ring_count=80, radius=radius, location=location)
    sphere = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    sphere.rotation_euler = (math.radians(tilt_deg), 0, math.radians(spin_deg))
    sphere.data.materials.append(material)
    return sphere


def add_blackhole(location, radius):
    """Same construction as the sprite: horizon, tilted disk, lensed halo, photon ring."""
    pivot = bpy.data.objects.new("BlackHole", None)
    bpy.context.scene.collection.objects.link(pivot)
    rb.build_blackhole(bpy.context.scene)
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj.parent is None and obj.name.startswith(("Sphere", "Torus")):
            obj.parent = pivot
            obj.visible_shadow = False  # it emits; its shadow would bite into Jupiter
    pivot.location = location
    pivot.scale = (radius, radius, radius)
    return pivot


def emission_material(name, color, strength):
    mat, tree, out = rb.new_material(name)
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = rb.hex_rgba(color)
    emission.inputs["Strength"].default_value = strength
    tree.links.new(emission.outputs[0], out.inputs["Surface"])
    return mat


def beam_material():
    """Emission that fades out along the cone, mixed with transparency."""
    mat, tree, out = rb.new_material("Beam")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    axes = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["Generated"], axes.inputs[0])
    fade = tree.nodes.new("ShaderNodeMapRange")
    fade.inputs["To Min"].default_value = 0.55
    fade.inputs["To Max"].default_value = 0.0
    tree.links.new(axes.outputs["Z"], fade.inputs["Value"])
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = rb.hex_rgba("#7dd3fc")
    emission.inputs["Strength"].default_value = 1.6
    transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(fade.outputs["Result"], mix.inputs[0])
    tree.links.new(transparent.outputs[0], mix.inputs[1])
    tree.links.new(emission.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs["Surface"])
    return mat


def add_beams(center, direction_deg, length):
    material = beam_material()
    for flip in (0, 180):
        bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.015, radius2=0.2, depth=length, end_fill_type="NOTHING")
        cone = bpy.context.active_object
        cone.visible_shadow = False
        cone.data.materials.append(material)
        angle = math.radians(direction_deg + flip)
        # Local +Z points along the beam; the narrow end (radius1, at -Z) sits on the pulsar.
        cone.rotation_euler = (0, angle, 0)
        cone.location = (
            center[0] + math.sin(angle) * length / 2,
            center[1],
            center[2] + math.cos(angle) * length / 2,
        )


def add_route(points, material):
    curve = bpy.data.curves.new("Route", type="CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.011
    curve.bevel_resolution = 4
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, location in zip(spline.bezier_points, points):
        point.co = location
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new("Route", curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.visible_shadow = False
    return obj


def main():
    scene = setup_scene()
    starfield_world(scene)
    target = bpy.data.objects.new("Target", None)
    scene.collection.objects.link(target)
    rb.add_sun(scene, target, (-6, -8, 5), 4.0)
    rb.add_sun(scene, target, (6, 6, 1), 1.6, (0.55, 0.75, 1.0))

    add_blackhole((0.35, 0.0, -0.15), 0.62)
    # Spin -17 deg turns the Great Red Spot toward the camera (Jupiter sits 17 deg off-axis).
    add_body(rb.jupiter_material(), (5.2, 3.0, -1.6), 2.35, 10, -17)
    add_body(rb.moon_material(), (-3.35, -1.0, -1.45), 0.42, 6, 40)
    pulsar_at = (4.3, 2.0, 1.95)
    add_body(rb.pulsar_material(), pulsar_at, 0.2, 30, 0)
    add_beams(pulsar_at, 55, 2.6)

    route = [
        (-6.5, -1.0, -3.3),
        (-4.0, -1.0, -2.35),
        (-2.72, -1.0, -1.75),
        (-2.45, -0.8, -0.6),
        (-1.2, -0.2, 0.45),
        (0.35, 0.3, 1.2),
        (1.8, 0.4, 0.25),
        (3.3, 1.6, 0.95),
        (4.95, 2.0, 1.5),
        (5.3, 2.0, 2.6),
        (7.2, 1.5, 3.9),
    ]
    add_route(route, emission_material("Trail", "#9d5cff", 1.8))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.06, location=(2.3, 0.6, 0.45))
    probe = bpy.context.active_object
    probe.data.materials.append(emission_material("Probe", "#ffffff", 14.0))
    probe.visible_shadow = False

    scene.render.filepath = OUT
    bpy.ops.render.render(write_still=True)
    print(f"cover rendered to {OUT}")


if __name__ == "__main__":
    main()
