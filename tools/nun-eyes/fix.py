# Repair the eyes of nunHQ.glb: flatten the protruding lash slabs onto the face, repaint a clean
# closed-eye lash line over smooth skin, and flatten the normal map there.
import sys, io, numpy as np
sys.path.insert(0, sys.argv[1]); from glb import GLB; from rast import raster
from PIL import Image
from scipy.interpolate import RBFInterpolator
SRC, OUT, DBG = sys.argv[2], sys.argv[3], sys.argv[1]
g = GLB(SRC)
pr = g.json['meshes'][0]['primitives'][0]
P = g.acc(pr['attributes']['POSITION']).astype(np.float64).copy(); UV = g.acc(pr['attributes']['TEXCOORD_0']).astype(np.float64); I = g.acc(pr['indices']).reshape(-1, 3)
mat = g.json['materials'][0]; img_of = lambda t: g.json['textures'][t['index']]['source']
ci, ni = img_of(mat['pbrMetallicRoughness']['baseColorTexture']), img_of(mat['normalTexture'])
tex = np.asarray(g.image(ci).convert('RGB')).copy(); nrm = np.asarray(g.image(ni).convert('RGB')).copy()
TH, TW = tex.shape[:2]; NH, NW = nrm.shape[:2]
print('color', tex.shape, 'normal', nrm.shape)

# ---- face frame from the skin between the eyes and on the cheeks ----
tri = P[I]; cen = tri.mean(1); nor = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
face = (np.abs(cen[:, 0]) < 0.12) & (cen[:, 1] > 1.26) & (cen[:, 1] < 1.33) & (cen[:, 2] > 0.2)
d = nor[face].sum(0); d /= np.linalg.norm(d)
u = np.array([1.0, 0, 0]); u -= u.dot(d) * d; u /= np.linalg.norm(u); v = np.cross(d, u)
if v[1] < 0: v = -v
print('face normal', d.round(3))
pu, pv, ph = P @ u, P @ v, P @ d
vcol = tex[np.clip((UV[:, 1] * TH).astype(int), 0, TH - 1), np.clip((UV[:, 0] * TW).astype(int), 0, TW - 1)].astype(np.float64)

moved = np.zeros(len(P), bool); eyes = []
for side, cx in (('L', -0.098), ('R', 0.098)):
    # locate the lash slab: brownish vertices near the expected spot on the front of the face
    near = (np.abs(P[:, 0] - cx) < 0.075) & (np.abs(P[:, 1] - 1.357) < 0.045) & (P[:, 2] > 0.2)
    brown = near & (vcol[:, 0] - vcol[:, 2] > 25) & (vcol.sum(1) < 600)
    cu, cv = np.median(pu[brown]), np.median(pv[brown])
    a, b = 0.066, 0.031  # half-axes of the repair ellipse on the face (m)
    r = np.hypot((pu - cu) / a, (pv - cv) / b)
    front = ph > np.median(ph[brown]) - 0.035
    skin = (vcol[:, 0] > 215) & (vcol[:, 1] > 185) & (vcol[:, 2] > 165) & (vcol[:, 0] - vcol[:, 2] < 60)  # not hair, not lash
    ring = front & (r > 1.2) & (r < 2.3) & skin
    inside = front & (r < 1.25)
    # the skin under the slab: smooth surface through the ring
    surf = RBFInterpolator(np.c_[pu[ring], pv[ring]], ph[ring], kernel='thin_plate_spline', smoothing=1e-5)
    hs = surf(np.c_[pu[inside], pv[inside]])
    w = np.clip((1.25 - r[inside]) / 0.3, 0, 1); w = w * w * (3 - 2 * w)
    newh = ph[inside] * (1 - w) + (hs + 0.0006) * w   # 0.6 mm proud of the skin so it never z-fights anything below
    P[inside] += np.outer(newh - ph[inside], d)
    moved |= inside
    skincol = RBFInterpolator(np.c_[pu[ring], pv[ring]], vcol[ring], kernel='thin_plate_spline', smoothing=30.0)
    eyes.append(dict(side=side, cu=cu, cv=cv, a=a, b=b, skincol=skincol, sgn=-1.0 if side == 'L' else 1.0))
    print(side, 'lash verts', int(brown.sum()), 'flattened', int(inside.sum()), 'ring', int(ring.sum()), 'max lift removed %.1f mm' % (1000 * (ph[inside] - hs).max()))

# ---- repaint: every texel of a triangle touching the repaired area ----
def lash(s, t):
    """Closed-eye lash in eye coords: s = -1 inner corner .. +1 outer corner, t up; both in units of the ellipse axes.
    Returns (ink 0..1, lid-line 0..1)."""
    s2 = s / 0.80
    # tilted: the outer corner sits lower, with a gentle upward bow in the middle
    c = 0.10 - 0.20 * s + 0.16 * (1 - np.clip(s2, -1, 1) ** 2)
    thick = (0.05 + 0.075 * np.clip((s + 0.8) / 1.6, 0, 1)) * np.sqrt(np.clip(1 - s2 ** 2, 0, 1))
    ink = np.clip((thick - np.abs(t - c)) / 0.035 + 0.5, 0, 1) * (np.abs(s2) < 1)
    for k, (s0, ang, ln) in enumerate(((0.6, -0.75, 0.17), (0.74, -0.4, 0.19))):  # three lashes at the outer end
        c0 = 0.10 - 0.20 * s0 + 0.16 * (1 - (s0 / 0.8) ** 2)
        ds, dt = s - s0, (t - c0) * (0.031 / 0.066)  # isotropic distances (in units of a)
        ax, ay = np.cos(ang), np.sin(ang)
        along = np.clip(ds * ax + dt * ay, 0, ln); dist = np.hypot(ds - along * ax, dt - along * ay)
        ink = np.maximum(ink, np.clip((0.022 * (1 - along / ln) + 0.004 - dist) / 0.016 + 0.5, 0, 1))
    lid = np.clip((0.022 - np.abs(t - (c + thick + 0.26 - 0.10 * s2 ** 2))) / 0.03 + 0.5, 0, 1) * (np.abs(s2) < 0.85)
    return ink, lid * 0.35

INK = np.array([78.0, 44.0, 34.0]); LID = np.array([196.0, 132.0, 112.0])
touch = moved[I].any(1)
print('triangles to repaint', int(touch.sum()))
tex_f = tex.astype(np.float64); nrm_f = nrm.astype(np.float64); flat = np.array([128.0, 128.0, 255.0])
for (a_, b_, c_) in I[touch]:
    uvs = UV[[a_, b_, c_]]
    for img, W_, H_, mode in ((tex_f, TW, TH, 'color'), (nrm_f, NW, NH, 'normal')):
        xs, ys = uvs[:, 0] * W_, uvs[:, 1] * H_
        xa, xb = int(max(0, np.floor(xs.min()) - 2)), int(min(W_ - 1, np.ceil(xs.max()) + 2)); ya, yb = int(max(0, np.floor(ys.min()) - 2)), int(min(H_ - 1, np.ceil(ys.max()) + 2))
        gx, gy = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
        den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(den) < 1e-9: continue
        w0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / den
        w1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / den
        w2 = 1 - w0 - w1
        pad = 2.0 / max(1.0, np.sqrt(abs(den)))   # ~2 texels of bleed past the triangle edge, against seams
        ins = (w0 >= -pad) & (w1 >= -pad) & (w2 >= -pad)
        if not ins.any(): continue
        q = np.stack([w0[ins], w1[ins], w2[ins]], 1) @ P[[a_, b_, c_]]
        qu, qv = q @ u, q @ v
        out = img[ya:yb + 1, xa:xb + 1][ins]
        for e in eyes:
            r = np.hypot((qu - e['cu']) / e['a'], (qv - e['cv']) / e['b'])
            wt = np.clip((1.22 - r) / 0.28, 0, 1); wt = wt * wt * (3 - 2 * wt)
            sel = wt > 0
            if not sel.any(): continue
            if mode == 'normal':
                out[sel] = out[sel] * (1 - wt[sel, None]) + flat * wt[sel, None]
            else:
                s = e['sgn'] * (qu[sel] - e['cu']) / e['a']; t = (qv[sel] - e['cv']) / e['b']
                base = e['skincol'](np.c_[qu[sel], qv[sel]])
                ink, lid = lash(s, t)
                col = base * (1 - lid[:, None]) + LID * lid[:, None]
                col = col * (1 - ink[:, None]) + INK * ink[:, None]
                out[sel] = out[sel] * (1 - wt[sel, None]) + col * wt[sel, None]
        img[ya:yb + 1, xa:xb + 1][ins] = out

tex = np.clip(tex_f, 0, 255).astype(np.uint8); nrm = np.clip(nrm_f, 0, 255).astype(np.uint8)
g.set_acc(pr['attributes']['POSITION'], P.astype(np.float32))
# normals of the moved vertices: recompute area-weighted, shared across coincident (UV-split) copies
tri = P[I]; fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
key = np.round(P * 1e5).astype(np.int64); _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
acc = np.zeros((inv.max() + 1, 3)); 
for k in range(3): np.add.at(acc, inv[I[:, k]], fn)
N = g.acc(pr['attributes']['NORMAL']).astype(np.float64).copy()
nn = acc[inv[moved]]; nn /= np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-12); N[moved] = nn
g.set_acc(pr['attributes']['NORMAL'], N.astype(np.float32))
cb, nb = io.BytesIO(), io.BytesIO()
Image.fromarray(tex).save(cb, 'JPEG', quality=95, subsampling=0); Image.fromarray(nrm).save(nb, 'PNG', optimize=False, compress_level=6)
g.save(OUT, {ci: (cb.getvalue(), 'image/jpeg'), ni: (nb.getvalue(), 'image/png')})
print('wrote', OUT, 'color', len(cb.getvalue()) // 1024, 'KB normal', len(nb.getvalue()) // 1024, 'KB')
# preview
X, Y, Z = np.eye(3); cen = P[I].mean(1)
head = I[(cen[:, 1] > 1.1) & (cen[:, 1] < 1.5) & (np.abs(cen[:, 0]) < 0.3) & (cen[:, 2] > 0.0)]
small = np.asarray(Image.fromarray(tex).resize((4096, 4096), Image.LANCZOS))
for name, au, ad, rect in (('front', X, Z, (-0.22, 0.22, 1.2, 1.44)), ('left', -Z, X, (-0.42, -0.06, 1.2, 1.44))):
    Image.fromarray(raster(P, UV, head, small, au, Y, ad, rect, 1400)[0]).save(f'{DBG}/fixed_{name}.png')
