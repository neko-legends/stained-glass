# Pull the hand-painted face texture out of the running Blender and put it into the scene's model.
# Blender must be open with the "MCP for Blender" add-on's server running and the nun imported
# (object "Nun"). Geometry and the other maps are taken unchanged from the current model.
#   python tools/nun-eyes/from_blender.py tools/nun-eyes public/models/girl.glb
import sys, io, os, tempfile
sys.path.insert(0, sys.argv[1]); from glb import GLB; from blender_socket import call
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
out = sys.argv[2]
tmp = os.path.join(tempfile.mkdtemp(prefix='nun-paint-'), 'basecolor.png')
code = f"""
import bpy
# the image wired into the Base Color of the object named "Nun" (its name gets a numeric suffix on re-import)
nun = bpy.data.objects['Nun']
tree = nun.data.materials[0].node_tree
im = next(l.from_node.image for l in tree.links if l.to_socket.name == 'Base Color' and l.from_node.type == 'TEX_IMAGE')
dirty = im.is_dirty
im.save(filepath={tmp!r}, quality=100)
print('saved', im.name, tuple(im.size), 'had unsaved paint' if dirty else 'no unsaved paint')
"""
r = call('execute_code', {'code': code}, timeout=300)
print(r.get('result', r))
img = Image.open(tmp).convert('RGB')
g = GLB(out)
ci = g.json['textures'][g.json['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
assert img.size == g.image(ci).size, f'size changed: {img.size}'
b = io.BytesIO(); img.save(b, 'JPEG', quality=95, subsampling=0)
g.save(out, {ci: (b.getvalue(), 'image/jpeg')})
print('wrote', out, len(b.getvalue()) // 1024, 'KB colour texture')
