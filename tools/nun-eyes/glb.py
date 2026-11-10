import json, struct, numpy as np, io
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
class GLB:
    def __init__(self, path):
        b = open(path, 'rb').read()
        n = struct.unpack('<I', b[12:16])[0]
        self.json = json.loads(b[20:20 + n])
        m = struct.unpack('<I', b[20 + n:24 + n])[0]
        self.bin = bytearray(b[28 + n:28 + n + m])
    def acc(self, i):
        a = self.json['accessors'][i]; bv = self.json['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); dt = CT[a['componentType']]; nc = NC[a['type']]
        assert not bv.get('byteStride') or bv['byteStride'] == np.dtype(dt).itemsize * nc
        return np.frombuffer(self.bin, dtype=dt, count=a['count'] * nc, offset=off).reshape(a['count'], nc) if nc > 1 else np.frombuffer(self.bin, dtype=dt, count=a['count'], offset=off)
    def set_acc(self, i, arr):
        a = self.json['accessors'][i]; bv = self.json['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); raw = np.ascontiguousarray(arr, dtype=CT[a['componentType']]).tobytes()
        self.bin[off:off + len(raw)] = raw
        if 'min' in a and a['type'] == 'VEC3': a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    def image_bytes(self, i):
        bv = self.json['bufferViews'][self.json['images'][i]['bufferView']]
        return bytes(self.bin[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])
    def image(self, i): return Image.open(io.BytesIO(self.image_bytes(i)))
    def save(self, path, replace_images=None):
        # rebuild the binary chunk so replaced images of a different size fit
        replace_images = replace_images or {}
        views = self.json['bufferViews']; img_view = {im['bufferView']: k for k, im in enumerate(self.json['images'])}
        out = bytearray()
        for vi, bv in enumerate(views):
            data = bytes(self.bin[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])
            if vi in img_view and img_view[vi] in replace_images:
                data, mime = replace_images[img_view[vi]]; self.json['images'][img_view[vi]]['mimeType'] = mime
            while len(out) % 4: out.append(0)
            bv['byteOffset'] = len(out); bv['byteLength'] = len(data); out += data
        while len(out) % 4: out.append(0)
        self.json['buffers'][0]['byteLength'] = len(out)
        js = json.dumps(self.json, separators=(',', ':')).encode()
        while len(js) % 4: js += b' '
        total = 12 + 8 + len(js) + 8 + len(out)
        open(path, 'wb').write(b'glTF' + struct.pack('<II', 2, total) + struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(out)) + b'BIN\x00' + bytes(out))
