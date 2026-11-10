# Give the praying girl the face of references/girlface.webp.
#   1. flatten the protruding eyelash slabs onto the surrounding skin (as fix.py does);
#   2. project a front view of the reference face (generated from girlface.webp) onto the face skin,
#      registered on both eyes and the mouth, colour-matched to the model's skin, feathered at the edge;
#   3. flatten the normal map over the eyes.
# usage: face.py <helpers dir> <src.glb> <front_face.png> <out.glb>
import sys, io, numpy as np
sys.path.insert(0, sys.argv[1]); from glb import GLB; from rast import raster
from PIL import Image, ImageFilter
from scipy.interpolate import RBFInterpolator
from scipy import ndimage as ndi
DBG, SRC, FACE, OUT = sys.argv[1:5]
# landmarks in the front-face image, as fractions of its size: left eye, right eye (image left/right), mouth
LM_IMG = np.array([[0.258, 0.4375], [0.742, 0.433], [0.5, 0.722]])

g = GLB(SRC)
pr = g.json['meshes'][0]['primitives'][0]
P = g.acc(pr['attributes']['POSITION']).astype(np.float64).copy(); UV = g.acc(pr['attributes']['TEXCOORD_0']).astype(np.float64); I = g.acc(pr['indices']).reshape(-1, 3)
mat = g.json['materials'][0]; img_of = lambda t: g.json['textures'][t['index']]['source']
ci, ni = img_of(mat['pbrMetallicRoughness']['baseColorTexture']), img_of(mat['normalTexture'])
tex = np.asarray(g.image(ci).convert('RGB')).copy(); nrm = np.asarray(g.image(ni).convert('RGB')).copy()
TH, TW = tex.shape[:2]; NH, NW = nrm.shape[:2]
src = Image.open(FACE).convert('RGB').resize((1024, 1024)) if Image.open(FACE).size != (1024, 1024) else Image.open(FACE).convert('RGB'); FW, FH = src.size; face = np.asarray(src).astype(np.float64)

# ---- face frame ----
tri = P[I]; cen = tri.mean(1); nor = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
sel = (np.abs(cen[:, 0]) < 0.12) & (cen[:, 1] > 1.26) & (cen[:, 1] < 1.33) & (cen[:, 2] > 0.2)
d = nor[sel].sum(0); d /= np.linalg.norm(d)
u = np.array([1.0, 0, 0]); u -= u.dot(d) * d; u /= np.linalg.norm(u); v = np.cross(d, u)
if v[1] < 0: v = -v
pu, pv, ph = P @ u, P @ v, P @ d
samp = lambda uv: tex[np.clip((uv[:, 1] * TH).astype(int), 0, TH - 1), np.clip((uv[:, 0] * TW).astype(int), 0, TW - 1)].astype(np.float64)
vcol = samp(UV)

# ---- 1. flatten the lash slabs ----
moved = np.zeros(len(P), bool); eyes = []
for side, cx in (('L', -0.098), ('R', 0.098)):
    near = (np.abs(P[:, 0] - cx) < 0.075) & (np.abs(P[:, 1] - 1.357) < 0.045) & (P[:, 2] > 0.2)
    brown = near & (vcol[:, 0] - vcol[:, 2] > 25) & (vcol.sum(1) < 600)
    cu, cv = np.median(pu[brown]), np.median(pv[brown]); a, b = 0.066, 0.034
    r = np.hypot((pu - cu) / a, (pv - cv) / b)
    front = ph > np.median(ph[brown]) - 0.035
    skin = (vcol[:, 0] > 215) & (vcol[:, 1] > 185) & (vcol[:, 2] > 165) & (vcol[:, 0] - vcol[:, 2] < 60)
    ring = front & (r > 1.2) & (r < 2.3) & skin; inside = front & (r < 1.25)
    surf = RBFInterpolator(np.c_[pu[ring], pv[ring]], ph[ring], kernel='thin_plate_spline', smoothing=1e-5)
    hs = surf(np.c_[pu[inside], pv[inside]])
    w = np.clip((1.25 - r[inside]) / 0.3, 0, 1); w = w * w * (3 - 2 * w)
    P[inside] += np.outer((ph[inside] * (1 - w) + (hs + 0.0006) * w) - ph[inside], d)
    # plain skin tone around this eye (a median: an interpolating surface overshoots toward the hair colour at its rim)
    _sk = np.median(vcol[ring], 0); skincol = lambda q, _sk=_sk: np.tile(_sk, (len(q), 1))
    moved |= inside; eyes.append((cu, cv, a, b, skincol))
    print(side, 'eye at face (u,v) = (%.4f, %.4f); flattened %d vertices' % (cu, cv, inside.sum()))
pu, pv, ph = P @ u, P @ v, P @ d

# ---- face triangles: front-facing, on the face, not blond hair ----
tri = P[I]; cen = tri.mean(1); fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
cu_, cv_, ch_ = cen @ u, cen @ v, cen @ d
tcol = np.median(np.stack([vcol[I[:, 0]], vcol[I[:, 1]], vcol[I[:, 2]], samp(UV[I].mean(1))]), 0)
hair = (tcol[:, 1] - tcol[:, 2] > 36) & (tcol[:, 0] > 170)
eye_mid = np.array([(eyes[0][0] + eyes[1][0]) / 2, (eyes[0][1] + eyes[1][1]) / 2]); span = abs(eyes[1][0] - eyes[0][0])
zone = (np.abs(cu_ - eye_mid[0]) < span * 1.25) & (cv_ > eye_mid[1] - span * 1.6) & (cv_ < eye_mid[1] + span * 0.75)
front_h = np.median(ph[moved])
cand = zone & (((fn @ d > 0.25) & (ch_ > front_h - 0.09) & ~hair) | moved[I].any(1))
print('face triangles', int(cand.sum()))

# ---- mouth landmark on the model: the dark line below the nose ----
ms = []
for t in np.where(cand & (np.abs(cu_ - eye_mid[0]) < span * 0.45) & (cv_ < eye_mid[1] - span * 0.35) & (cv_ > eye_mid[1] - span * 1.1))[0]:
    w = np.random.default_rng(t).dirichlet([1, 1, 1], 60)
    c = samp(w @ UV[I[t]]); q = w @ P[I[t]]
    dark = (c[:, 1] < 150) & (c[:, 0] - c[:, 1] > 30)
    if dark.any(): ms.append(np.c_[q[dark] @ u, q[dark] @ v])
ms = np.concatenate(ms)
# the face is symmetric: the mouth sits on the line midway between the eyes; only its height is measured
mouth = np.array([eye_mid[0], np.median(ms[np.abs(ms[:, 0] - eye_mid[0]) < span * 0.2, 1])])
print('mouth at face (u,v) = (%.4f, %.4f) from %d dark samples; eye span %.4f, eye-to-mouth %.4f' % (mouth[0], mouth[1], len(ms), span, eye_mid[1] - mouth[1]))

# ---- affine: face (u,v) -> image pixels, exact on the three landmarks ----
# Horizontal: one scale, centred, set by the distance between the eye centres, so the gap between the
# eyes and everything else on the face keeps the drawing's proportions. The one exception is the OUTER
# end of each eye: the drawn eyes are wider than the model's, and their outer ends would wrap round the
# side of the face toward the hair, so the outer half of each eye is compressed to end where the
# model's own eye ended. Inner corners are not moved. Vertical: linear through the eyes and mouth.
EYE_X = np.array([0.109, 0.414, 0.586, 0.890]) # lash extents in the image: left outer, left inner, right inner, right outer
OUTER = 0.041                                  # how far the model's own eye reached outward from its centre (m)
us = (LM_IMG[1, 0] - LM_IMG[0, 0]) * FW / (eyes[1][0] - eyes[0][0]); u_mid = (eyes[0][0] + eyes[1][0]) / 2
to_u = lambda fx: u_mid + (fx - 0.5) * FW / us     # where an image x lands under the plain scale
cL, cR = (EYE_X[0] + EYE_X[1]) / 2, (EYE_X[2] + EYE_X[3]) / 2
# control points (model u -> image x): outer end pulled in, eye centre and inner corner where the plain scale puts them
ctrl_u = np.array([eyes[0][0] - OUTER, to_u(cL), to_u(EYE_X[1]), to_u(EYE_X[2]), to_u(cR), eyes[1][0] + OUTER])
ctrl_x = np.array([EYE_X[0], cL, EYE_X[1], EYE_X[2], cR, EYE_X[3]]) * FW
eye_v = (eyes[0][1] + eyes[1][1]) / 2; eye_y = (LM_IMG[0, 1] + LM_IMG[1, 1]) / 2 * FH
vs = (LM_IMG[2, 1] * FH - eye_y) / (mouth[1] - eye_v)
def to_img(qu, qv):
    plain = 0.5 * FW + (qu - u_mid) * us
    x = np.interp(qu, ctrl_u, ctrl_x)
    # beyond the outer ends: continue at the plain scale from there, so the temple skin is not stretched
    x = np.where(qu < ctrl_u[0], ctrl_x[0] + (qu - ctrl_u[0]) * us, x)
    x = np.where(qu > ctrl_u[-1], ctrl_x[-1] + (qu - ctrl_u[-1]) * us, x)
    g = np.exp(-((qv - eye_v) / 0.028) ** 2)       # the outer-end fit applies only in the band of the eyes
    return np.c_[x * g + plain * (1 - g), eye_y + (qv - eye_v) * vs]

# ---- image-side mask: the skin of the generated face, feathered ----
hsvish = (face[..., 1] - face[..., 2] < 34) & (face[..., 0] > 150)             # skin, lashes, lips: anything not blond hair
lab, n = ndi.label(ndi.binary_opening(hsvish, iterations=6))
core = lab == lab[int(FH * 0.6), int(FW * 0.5)]
core = ndi.binary_fill_holes(ndi.binary_closing(core, iterations=10))
yy = np.arange(FH)[:, None] / FH
xx = np.arange(FW)[None, :] / FW
# only the heart of the face: brows to just under the lips, cheek to cheek. The chin, jaw line and
# ears stay the model's own, so nothing of the picture's outline or hair lands on the model's skin.
core &= (((xx - 0.5) / 0.43) ** 2 + ((yy - 0.55) / 0.31) ** 2) < 1
soft = ndi.gaussian_filter(ndi.binary_erosion(core, iterations=int(FW * 0.035)).astype(np.float64), FW * 0.02)
Image.fromarray((soft * 255).astype(np.uint8)).save(DBG + '/face_mask.png')
def bil(img, xy):
    x = np.clip(xy[:, 0] - 0.5, 0, img.shape[1] - 1.001); y = np.clip(xy[:, 1] - 0.5, 0, img.shape[0] - 1.001)
    x0, y0 = x.astype(int), y.astype(int); fx, fy = (x - x0)[:, None] if img.ndim == 3 else x - x0, (y - y0)[:, None] if img.ndim == 3 else y - y0
    return (img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx) * (1 - fy) + (img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx) * fy

# ---- colour match: plain skin of the image vs plain skin of the model, over the face ----
mo, io_ = [], []
for t in np.where(cand)[0][::2]:
    w = np.random.default_rng(t).dirichlet([1, 1, 1], 24); q = w @ P[I[t]]
    xy = to_img(q @ u, q @ v); inb = (xy[:, 0] > 2) & (xy[:, 1] > 2) & (xy[:, 0] < FW - 3) & (xy[:, 1] < FH - 3)
    if not inb.any(): continue
    wt = bil(soft, xy[inb]); ic = bil(face, xy[inb]); mc = samp((w @ UV[I[t]])[inb])
    plain = (wt > 0.6) & (ic.min(1) > 190) & (mc.min(1) > 170) & (mc[:, 1] - mc[:, 2] < 36)
    mo.append(mc[plain]); io_.append(ic[plain])
mo, io_ = np.concatenate(mo), np.concatenate(io_)
gain = np.median(mo, 0) / np.median(io_, 0)
print('skin: model', np.median(mo, 0).round(1), 'image', np.median(io_, 0).round(1), 'gain', gain.round(3))

# ---- 2. paint ----
tex_f = tex.astype(np.float64); nrm_f = nrm.astype(np.float64); flat = np.array([128.0, 128.0, 255.0]); painted = 0
# smooth per-vertex facing of the face (shared across UV-split copies), so the paint fades out where
# the cheek turns away instead of smearing round the side of the head
_key = np.round(P * 1e5).astype(np.int64); _, _inv = np.unique(_key, axis=0, return_inverse=True); _inv = _inv.ravel()
_acc = np.zeros((_inv.max() + 1, 3)); _fnA = np.cross(P[I][:, 1] - P[I][:, 0], P[I][:, 2] - P[I][:, 0])
for k in range(3): np.add.at(_acc, _inv[I[:, k]], _fnA)
VN = _acc[_inv]; VN /= np.maximum(np.linalg.norm(VN, axis=1, keepdims=True), 1e-12); vfacing = VN @ d
for t in np.where(cand)[0]:
    a_, b_, c_ = I[t]; uvs = UV[[a_, b_, c_]]
    for img, W_, H_, mode in ((tex_f, TW, TH, 'color'), (nrm_f, NW, NH, 'normal')):
        xs, ys = uvs[:, 0] * W_, uvs[:, 1] * H_
        xa, xb = int(max(0, np.floor(xs.min()) - 2)), int(min(W_ - 1, np.ceil(xs.max()) + 2)); ya, yb = int(max(0, np.floor(ys.min()) - 2)), int(min(H_ - 1, np.ceil(ys.max()) + 2))
        den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(den) < 1e-9: continue
        gx, gy = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
        w0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / den
        w1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / den
        w2 = 1 - w0 - w1; pad = 2.0 / max(1.0, np.sqrt(abs(den)))
        ins = (w0 >= -pad) & (w1 >= -pad) & (w2 >= -pad)
        if not ins.any(): continue
        q = np.stack([w0[ins], w1[ins], w2[ins]], 1) @ P[[a_, b_, c_]]; qu, qv = q @ u, q @ v
        out = img[ya:yb + 1, xa:xb + 1][ins]
        if mode == 'color':
            xy = to_img(qu, qv); inb = (xy[:, 0] > 2) & (xy[:, 1] > 2) & (xy[:, 0] < FW - 3) & (xy[:, 1] < FH - 3)
            wt = np.where(inb, bil(soft, xy), 0.0)
            fc = np.stack([w0[ins], w1[ins], w2[ins]], 1) @ vfacing[[a_, b_, c_]]
            wt = wt * np.clip((fc - 0.5) / 0.25, 0, 1)
            # where the old lash slab was, first lay down clean skin (interpolated from around the eye),
            # so nothing of the old brown texture survives where the picture does not reach
            for (cu, cv, a, b, skincol) in eyes:
                r = np.hypot((qu - cu) / (a * 1.18), (qv - cv) / b); we = np.clip((1.25 - r) / 0.3, 0, 1); we = we * we * (3 - 2 * we)
                selq = we > 0
                if selq.any(): out[selq] = out[selq] * (1 - we[selq, None]) + skincol(np.c_[qu[selq], qv[selq]]) * we[selq, None]
                # stray dark specks of the old lash texture just outside that ellipse
                far = (np.hypot((qu - cu) / (a * 2.1), (qv - cv) / (b * 1.6)) < 1.25) & (out[:, 0] - out[:, 2] > 25) & (out[:, 1] < 185)
                if far.any(): out[far] = skincol(np.c_[qu[far], qv[far]])
            col = np.clip(bil(face, xy) * gain, 0, 255)
            out = out * (1 - wt[:, None]) + col * wt[:, None]; painted += int((wt > 0.5).sum())
        else:
            for (cu, cv, a, b, _sk) in eyes:
                r = np.hypot((qu - cu) / a, (qv - cv) / b); wt = np.clip((1.3 - r) / 0.3, 0, 1); wt = wt * wt * (3 - 2 * wt)
                out = out * (1 - wt[:, None]) + flat * wt[:, None]
        img[ya:yb + 1, xa:xb + 1][ins] = out
print('texels repainted', painted)
tex = np.clip(tex_f, 0, 255).astype(np.uint8); nrm = np.clip(nrm_f, 0, 255).astype(np.uint8)

# ---- write ----
g.set_acc(pr['attributes']['POSITION'], P.astype(np.float32))
tri = P[I]; fnn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
key = np.round(P * 1e5).astype(np.int64); _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
acc = np.zeros((inv.max() + 1, 3))
for k in range(3): np.add.at(acc, inv[I[:, k]], fnn)
N = g.acc(pr['attributes']['NORMAL']).astype(np.float64).copy()
nn = acc[inv[moved]]; nn /= np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-12); N[moved] = nn
g.set_acc(pr['attributes']['NORMAL'], N.astype(np.float32))
cb, nb = io.BytesIO(), io.BytesIO()
Image.fromarray(tex).save(cb, 'JPEG', quality=95, subsampling=0); Image.fromarray(nrm).save(nb, 'PNG', compress_level=6)
g.save(OUT, {ci: (cb.getvalue(), 'image/jpeg'), ni: (nb.getvalue(), 'image/png')})
print('wrote', OUT, (len(cb.getvalue()) + len(nb.getvalue())) // 1024, 'KB of images')
X, Y, Z = np.eye(3); cen = P[I].mean(1)
head = I[(cen[:, 1] > 1.1) & (cen[:, 1] < 1.5) & (np.abs(cen[:, 0]) < 0.3) & (cen[:, 2] > 0.0)]
small = np.asarray(Image.fromarray(tex).resize((4096, 4096), Image.LANCZOS))
for name, au, ad, rect in (('front', X, Z, (-0.22, 0.22, 1.2, 1.44)), ('left', -Z, X, (-0.42, -0.06, 1.2, 1.44))):
    Image.fromarray(raster(P, UV, head, small, au, Y, ad, rect, 1400)[0]).save(f'{DBG}/face_{name}.png')
