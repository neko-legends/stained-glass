import numpy as np
def raster(P, UV, I, tex, axis_u, axis_v, axis_d, rect, W, sign_d=1.0, wire=False):
    """Orthographic raster. rect = (u0, u1, v0, v1). Returns rgb image, triangle-id buffer, depth."""
    u0, u1, v0, v1 = rect; H = int(round(W * (v1 - v0) / (u1 - u0)))
    img = np.full((H, W, 3), 235, np.uint8); tid = np.full((H, W), -1, np.int32); zb = np.full((H, W), -1e9)
    X = (P @ axis_u - u0) / (u1 - u0) * W; Y = (v1 - P @ axis_v) / (v1 - v0) * H; Z = (P @ axis_d) * sign_d
    th, tw = tex.shape[:2]
    for t, (a, b, c) in enumerate(I):
        xs = X[[a, b, c]]; ys = Y[[a, b, c]]
        xa, xb = int(max(0, np.floor(xs.min()))), int(min(W - 1, np.ceil(xs.max())))
        ya, yb = int(max(0, np.floor(ys.min()))), int(min(H - 1, np.ceil(ys.max())))
        if xa > xb or ya > yb: continue
        gx, gy = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
        den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(den) < 1e-12: continue
        w0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / den
        w1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / den
        w2 = 1 - w0 - w1
        ins = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not ins.any(): continue
        z = w0 * Z[a] + w1 * Z[b] + w2 * Z[c]
        sub = zb[ya:yb + 1, xa:xb + 1]; upd = ins & (z > sub)
        if not upd.any(): continue
        uu = w0 * UV[a, 0] + w1 * UV[b, 0] + w2 * UV[c, 0]; vv = w0 * UV[a, 1] + w1 * UV[b, 1] + w2 * UV[c, 1]
        col = tex[np.clip((vv * th).astype(int), 0, th - 1), np.clip((uu * tw).astype(int), 0, tw - 1)]
        if wire:
            edge = (np.minimum(np.minimum(w0, w1), w2) < 0.04)
            col = np.where(edge[..., None], (col * 0.45).astype(np.uint8), col)
        sub[upd] = z[upd]; img[ya:yb + 1, xa:xb + 1][upd] = col[upd]; tid[ya:yb + 1, xa:xb + 1][upd] = t
    return img, tid, zb
