// Procedural stained-glass art, painted with Canvas 2D in wall metres.
// One canvas per wall "band". RGB is the spectral transmittance of the glass
// (what fraction of red/green/blue light gets through); lead cames, saddle
// bars and stone tracery are black = opaque.

const C = {
  ruby: '#d9121d', crimson: '#b00d24', scarlet: '#ee3a22',
  cobalt: '#1238d0', navy: '#0f249c', sky: '#2c82ea', azure: '#4aa8f2',
  emerald: '#17a044', leaf: '#59c22e',
  gold: '#ffc61c', amber: '#ff9212', lemon: '#ffe45a',
  violet: '#8d2ad6', rose: '#ea3a94', teal: '#10aaa2',
  white: '#f6ecd2', flesh: '#f4cfa4', brown: '#84501f', umber: '#4e2e12',
};
const BLUES = [C.cobalt, C.cobalt, C.navy, C.sky, C.azure];
const REDS = [C.ruby, C.ruby, C.crimson, C.scarlet, C.rose];
const GREENS = [C.emerald, C.emerald, C.leaf, C.teal];
const VIOLETS = [C.violet, C.violet, C.rose, C.cobalt];
const ROBES = [C.ruby, C.cobalt, C.emerald, C.violet, C.amber, C.teal, C.white, C.rose, C.gold];

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Per-piece variation: hand-blown glass is never one flat colour.
function tint(hex, rng, amt = 0.16) {
  const [r, g, b] = hexToRgb(hex);
  const k = 1 + (rng() - 0.5) * 2 * amt;
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];

const LEAD = 0.02; // came width in metres

class Painter {
  constructor(ctx, rng) { this.ctx = ctx; this.rng = rng; }

  // Fill the current path as one piece of glass with a lead came around it.
  piece(color, lead = LEAD, vary = 0.14) {
    const c = this.ctx;
    c.fillStyle = tint(color, this.rng, vary);
    c.fill();
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.28)'; // grime that collects along the cames
    c.lineWidth = lead * 3.2;
    c.stroke();
    c.strokeStyle = '#000';
    c.lineWidth = lead;
    c.stroke();
  }

  circle(x, y, r) { const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }
  poly(pts) {
    const c = this.ctx; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
  }
  line(x0, y0, x1, y1, w = LEAD, style = '#000') {
    const c = this.ctx; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
    c.strokeStyle = style; c.lineWidth = w; c.stroke();
  }

  // Background of small irregular quarries in one colour family.
  mosaic(x0, y0, x1, y1, cell, colors) {
    const c = this.ctx, rng = this.rng;
    const nx = Math.max(1, Math.round((x1 - x0) / cell));
    const ny = Math.max(1, Math.round((y1 - y0) / cell));
    const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
    const P = [];
    for (let j = 0; j <= ny; j++) {
      const row = [];
      for (let i = 0; i <= nx; i++) {
        const jx = i === 0 || i === nx ? 0 : (rng() - 0.5) * dx * 0.55;
        const jy = j === 0 || j === ny ? 0 : (rng() - 0.5) * dy * 0.55;
        row.push([x0 + i * dx + jx, y0 + j * dy + jy]);
      }
      P.push(row);
    }
    c.lineJoin = 'round';
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        c.beginPath();
        c.moveTo(P[j][i][0], P[j][i][1]);
        c.lineTo(P[j][i + 1][0], P[j][i + 1][1]);
        c.lineTo(P[j + 1][i + 1][0], P[j + 1][i + 1][1]);
        c.lineTo(P[j + 1][i][0], P[j + 1][i][1]);
        c.closePath();
        c.fillStyle = tint(pick(colors, rng), rng, 0.22);
        c.fill();
        c.strokeStyle = '#000';
        c.lineWidth = LEAD * 0.8;
        c.stroke();
      }
    }
  }

  // Border of alternating blocks that follows the current path (inside it).
  border(pathFn, bw, colA, colB, bead) {
    const c = this.ctx;
    const d = bw * 1.6;
    c.save();
    pathFn(); c.clip();
    c.lineCap = 'butt';
    pathFn(); c.lineWidth = bw * 2; c.strokeStyle = colA; c.setLineDash([]); c.stroke();
    pathFn(); c.strokeStyle = colB; c.setLineDash([d, d]); c.stroke();
    if (bead) { pathFn(); c.strokeStyle = bead; c.setLineDash([d * 0.3, d * 1.7]); c.lineDashOffset = -d * 0.35; c.stroke(); }
    c.lineDashOffset = 0;
    pathFn(); c.strokeStyle = '#000'; c.setLineDash([LEAD, d - LEAD]); c.stroke();
    c.setLineDash([]);
    pathFn(); c.lineWidth = LEAD * 2.2; c.strokeStyle = '#000'; c.stroke();
    c.restore();
  }

  rosette(cx, cy, R, n, bgColors, petalA, petalB) {
    const c = this.ctx;
    c.save();
    this.circle(cx, cy, R); c.clip();
    this.mosaic(cx - R, cy - R, cx + R, cy + R, R * 0.3, bgColors);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.PI / 2;
      c.beginPath();
      c.ellipse(cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.5, R * 0.36, R * 0.19, a, 0, Math.PI * 2);
      this.piece(k % 2 ? petalA : petalB);
    }
    this.circle(cx, cy, R * 0.2); this.piece(C.gold);
    this.circle(cx, cy, R * 0.09); this.piece(C.ruby);
    c.restore();
    this.border(() => this.circle(cx, cy, R), R * 0.13, C.gold, C.white, null);
  }

  medallion(cx, y0, w, h, warm) {
    const c = this.ctx;
    const cy = y0 + h / 2;
    const r = Math.min(w, h) * 0.44;
    // corner leaves
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      c.beginPath();
      c.ellipse(cx + sx * w * 0.36, cy + sy * h * 0.38, w * 0.13, w * 0.07, Math.atan2(sy, sx), 0, Math.PI * 2);
      this.piece(pick(GREENS, this.rng));
    }
    // quatrefoil frame
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      this.circle(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.52);
      this.piece(k % 2 ? C.gold : C.amber);
    }
    c.save();
    this.circle(cx, cy, r * 0.78); c.clip();
    this.mosaic(cx - r, cy - r, cx + r, cy + r, r * 0.26, warm ? BLUES : REDS);
    c.restore();
    this.circle(cx, cy, r * 0.78); c.strokeStyle = '#000'; c.lineWidth = LEAD * 1.6; c.stroke();
    // eight-pointed star
    const pts = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const rr = k % 2 ? r * 0.28 : r * 0.62;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    this.poly(pts); this.piece(C.white);
    this.circle(cx, cy, r * 0.2); this.piece(warm ? C.ruby : C.cobalt);
  }

  // A standing robed figure under a canopy.
  figure(cx, y0, w, h, nicheColors, big = false) {
    const c = this.ctx, rng = this.rng;
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const pedH = h * 0.085;
    const ySp = y0 + h * 0.7, yA = y0 + h * 0.93;
    const archPath = () => {
      c.beginPath();
      c.moveTo(x0 + w * 0.06, y0 + pedH);
      c.lineTo(x0 + w * 0.06, ySp);
      c.quadraticCurveTo(x0 + w * 0.1, yA - h * 0.05, cx, yA);
      c.quadraticCurveTo(x1 - w * 0.1, yA - h * 0.05, x1 - w * 0.06, ySp);
      c.lineTo(x1 - w * 0.06, y0 + pedH);
      c.closePath();
    };
    // canopy architecture (everything outside the niche)
    c.save();
    c.beginPath(); c.rect(x0, y0, w, h); c.clip();
    this.mosaic(x0, y0 + pedH, x1, y0 + h, w * 0.2, [C.gold, C.lemon, C.white, C.amber]);
    // pinnacle jewels in the spandrels
    this.circle(x0 + w * 0.16, y0 + h * 0.9, w * 0.07); this.piece(pick(REDS, rng));
    this.circle(x1 - w * 0.16, y0 + h * 0.9, w * 0.07); this.piece(pick(REDS, rng));
    c.restore();
    // niche
    c.save();
    archPath(); c.clip();
    this.mosaic(x0, y0, x1, y0 + h, w * 0.17, nicheColors);
    // ---- figure ----
    const yb = y0 + pedH;
    const s = Math.min(h * 0.74, w * 2.6); // figure height
    const side = rng() < 0.5 ? -1 : 1;
    const robeA = pick(ROBES, rng);
    let robeB = pick(ROBES, rng);
    if (robeB === robeA) robeB = C.white;
    const fx = (k) => cx + k * s;
    const fy = (k) => yb + k * s;
    // halo
    this.circle(fx(0), fy(0.865), s * 0.125); this.piece(C.gold, LEAD, 0.05);
    // mantle, in two pieces (lead line at the waist)
    this.poly([[fx(-0.075), fy(0.79)], [fx(0.075), fy(0.79)], [fx(0.2), fy(0.72)], [fx(0.25), fy(0.42)], [fx(-0.25), fy(0.42)], [fx(-0.2), fy(0.72)]]);
    this.piece(robeB);
    this.poly([[fx(-0.25), fy(0.42)], [fx(0.25), fy(0.42)], [fx(0.24), fy(0.02)], [fx(-0.24), fy(0.02)]]);
    this.piece(robeB);
    // tunic showing down the front
    this.poly([[fx(-0.05), fy(0.79)], [fx(0.05), fy(0.79)], [fx(0.07 + 0.05 * side), fy(0.42)], [fx(0.1 + 0.06 * side), fy(0.02)], [fx(-0.1 + 0.06 * side), fy(0.02)], [fx(-0.07 + 0.05 * side), fy(0.42)]]);
    this.piece(robeA);
    // drapery trace lines (vitreous paint)
    for (let k = 0; k < 7; k++) {
      const t = (k + 0.5) / 7 - 0.5;
      c.beginPath();
      c.moveTo(fx(t * 0.3), fy(0.7 - Math.abs(t) * 0.2));
      c.quadraticCurveTo(fx(t * 0.5 + 0.03 * side), fy(0.38), fx(t * 0.46), fy(0.04));
      c.strokeStyle = 'rgba(30,14,4,0.55)'; c.lineWidth = LEAD * 0.7; c.stroke();
    }
    // feet
    c.beginPath(); c.ellipse(fx(-0.07), fy(0.015), s * 0.05, s * 0.022, 0, 0, Math.PI * 2); this.piece(C.brown);
    c.beginPath(); c.ellipse(fx(0.07), fy(0.015), s * 0.05, s * 0.022, 0, 0, Math.PI * 2); this.piece(C.brown);
    // head: hair, face
    this.circle(fx(0), fy(0.875), s * 0.075); this.piece(rng() < 0.5 ? C.brown : C.umber, LEAD, 0.1);
    c.beginPath(); c.ellipse(fx(0), fy(0.858), s * 0.052, s * 0.064, 0, 0, Math.PI * 2); this.piece(C.flesh, LEAD * 0.8, 0.04);
    c.fillStyle = 'rgba(40,18,6,0.85)';
    for (const ex of [-0.02, 0.02]) { c.beginPath(); c.arc(fx(ex), fy(0.868), s * 0.007, 0, Math.PI * 2); c.fill(); }
    this.line(fx(0), fy(0.862), fx(0.004), fy(0.842), LEAD * 0.5, 'rgba(40,18,6,0.7)');
    this.line(fx(-0.015), fy(0.828), fx(0.015), fy(0.828), LEAD * 0.5, 'rgba(40,18,6,0.7)');
    // hands + attribute
    const hx = fx(0.17 * side), hy = fy(0.52);
    if (rng() < 0.5) {
      // staff / crozier
      this.line(fx(0.21 * side), fy(0.03), fx(0.21 * side), fy(0.98), s * 0.022, '#000');
      this.line(fx(0.21 * side), fy(0.03), fx(0.21 * side), fy(0.98), s * 0.012, C.gold);
      this.circle(fx(0.21 * side), fy(0.99), s * 0.035); this.piece(C.gold);
    } else {
      // book
      c.beginPath(); c.rect(hx - s * 0.06, hy - s * 0.02, s * 0.12, s * 0.15);
      this.piece(pick([C.ruby, C.emerald, C.cobalt], rng));
      this.circle(hx, hy + s * 0.055, s * 0.02); this.piece(C.gold);
    }
    this.circle(hx, hy, s * 0.034); this.piece(C.flesh, LEAD * 0.8, 0.04);
    this.circle(fx(-0.13 * side), fy(0.6), s * 0.034); this.piece(C.flesh, LEAD * 0.8, 0.04);
    if (big) {
      // a second small haloed figure held in front (the centre light)
      this.circle(fx(-0.06 * side), fy(0.62), s * 0.075); this.piece(C.gold, LEAD, 0.05);
      this.poly([[fx(-0.12 * side), fy(0.56)], [fx(0.0), fy(0.56)], [fx(0.02 * side), fy(0.36)], [fx(-0.14 * side), fy(0.36)]]);
      this.piece(C.white);
      this.circle(fx(-0.06 * side), fy(0.62), s * 0.042); this.piece(C.flesh, LEAD * 0.8, 0.04);
    }
    c.restore();
    archPath(); c.strokeStyle = '#000'; c.lineWidth = LEAD * 2; c.stroke();
    // pedestal
    const n = 3;
    for (let i = 0; i < n; i++) {
      c.beginPath(); c.rect(x0 + (w * i) / n, y0, w / n, pedH);
      this.piece(i % 2 ? C.white : C.lemon);
    }
  }
}

function lancetPath(ctx, u, v0, w, vs) {
  ctx.beginPath();
  ctx.moveTo(u, v0);
  ctx.lineTo(u + w, v0);
  ctx.lineTo(u + w, vs);
  ctx.arc(u, vs, w, 0, Math.PI / 3, false);
  ctx.arc(u + w, vs, w, (2 * Math.PI) / 3, Math.PI, false);
  ctx.closePath();
}

function drawLancet(p, o, index) {
  const c = p.ctx, rng = p.rng;
  const { u, w, v0, vs } = o;
  const warm = index % 2 === 1; // alternate blue-ground and red-ground lights
  const bg = warm ? REDS : BLUES;
  const niche = warm ? BLUES : REDS;
  c.save();
  lancetPath(c, u, v0, w, vs); c.clip();
  c.fillStyle = '#000'; c.fillRect(u - 1, v0 - 1, w + 2, vs - v0 + w + 2);

  const bw = w * 0.085;
  p.border(() => lancetPath(c, u, v0, w, vs), bw, warm ? C.cobalt : C.ruby, C.gold, C.white);

  // inner field
  const ui = u + bw, wi = w - 2 * bw, vi = v0 + bw, vsi = vs - bw * 0.3;
  c.save();
  lancetPath(c, ui, vi, wi, vsi); c.clip();
  p.mosaic(ui, vi, ui + wi, vsi + wi, wi * 0.14, bg);
  const Hs = vsi - vi;
  const n = Math.max(1, Math.round(Hs / (wi * 1.6)));
  const ph = Hs / n;
  const cx = ui + wi / 2;
  for (let k = 0; k < n; k++) {
    const y0 = vi + k * ph;
    const isFigure = o.major ? true : (k + index) % 3 !== 2;
    const pw = wi * 0.86, phh = ph * 0.94;
    if (isFigure) p.figure(cx, y0 + ph * 0.03, pw, phh, niche, o.major && o.slot === 2 && k === n - 1);
    else p.medallion(cx, y0 + ph * 0.03, pw, phh, warm);
  }
  // head of the light
  p.rosette(cx, vsi + wi * 0.3, wi * 0.27, 6, niche, C.white, C.gold);
  // saddle bars (iron ferramenta) across the light
  const bars = n * 2;
  for (let k = 1; k <= bars; k++) p.line(ui, vi + (Hs * k) / bars, ui + wi, vi + (Hs * k) / bars, LEAD * 1.5);
  c.restore();
  lancetPath(c, ui, vi, wi, vsi); c.strokeStyle = '#000'; c.lineWidth = LEAD * 2; c.stroke();
  c.restore();
}

function drawOculus(p, o) {
  const c = p.ctx;
  c.save();
  p.circle(o.cu, o.cv, o.r); c.clip();
  c.fillStyle = '#000'; c.fillRect(o.cu - o.r, o.cv - o.r, o.r * 2, o.r * 2);
  p.rosette(o.cu, o.cv, o.r, 6, o.bay % 2 ? BLUES : REDS, C.gold, o.bay % 2 ? C.ruby : C.sky);
  c.restore();
}

function drawRose(p, o, variant) {
  const c = p.ctx, rng = p.rng;
  const { cu, cv, r: R } = o;
  const N = variant === 0 ? 12 : 16;
  const P = (r, a) => [cu + Math.cos(a) * r * R, cv + Math.sin(a) * r * R];
  c.save();
  p.circle(cu, cv, R); c.clip();
  c.fillStyle = '#000'; c.fillRect(cu - R, cv - R, 2 * R, 2 * R); // stone tracery

  // petals
  const step = (Math.PI * 2) / N;
  const delta = step / 2 - 0.045;
  const r1 = 0.27, r2 = 0.68;
  const rs = r2 / (Math.cos(delta) + Math.sin(delta));
  for (let k = 0; k < N; k++) {
    const a = k * step + Math.PI / 2;
    const warm = k % 2 === 0;
    const petal = () => {
      c.beginPath();
      c.moveTo(...P(r1, a - delta));
      c.lineTo(...P(rs, a - delta));
      const cc = P(rs * Math.cos(delta), a);
      c.arc(cc[0], cc[1], rs * Math.sin(delta) * R, a - Math.PI / 2, a + Math.PI / 2, false);
      c.lineTo(...P(r1, a + delta));
      c.arc(cu, cv, r1 * R, a + delta, a - delta, true);
      c.closePath();
    };
    c.save();
    petal(); c.clip();
    const bb = R * 0.75;
    p.mosaic(cu - bb, cv - bb, cu + bb, cv + bb, R * 0.055, warm ? REDS : BLUES);
    // figure-ish medallion in the wide end, jewel in the narrow end
    const m = P(rs * Math.cos(delta) + 0.005, a);
    p.circle(m[0], m[1], rs * Math.sin(delta) * R * 0.74); p.piece(C.gold);
    p.circle(m[0], m[1], rs * Math.sin(delta) * R * 0.52); p.piece(warm ? C.cobalt : C.ruby);
    p.circle(m[0], m[1], rs * Math.sin(delta) * R * 0.2); p.piece(C.white);
    const j = P(r1 + 0.1, a);
    c.beginPath(); c.ellipse(j[0], j[1], R * 0.05, R * 0.026, a, 0, Math.PI * 2); p.piece(pick([C.emerald, C.violet, C.amber], rng));
    c.restore();
    p.border(petal, R * 0.016, warm ? C.gold : C.white, warm ? C.emerald : C.gold, null);
  }

  // outer ring of roundels + small lights
  for (let k = 0; k < N; k++) {
    const a = k * step + Math.PI / 2;
    const rr = variant === 0 ? 0.118 : 0.09;
    const q = P(0.815, a + step / 2);
    p.rosette(q[0], q[1], rr * R, 6, k % 2 ? VIOLETS : GREENS, C.gold, C.white);
    const t = P(0.765, a);
    p.circle(t[0], t[1], (variant === 0 ? 0.052 : 0.04) * R); p.piece(pick([C.amber, C.rose, C.teal], rng));
    const e = P(0.935, a);
    p.circle(e[0], e[1], (variant === 0 ? 0.042 : 0.034) * R); p.piece(pick([C.ruby, C.sky, C.gold], rng));
  }

  // centre
  c.save();
  p.circle(cu, cv, 0.225 * R); c.clip();
  p.mosaic(cu - R * 0.23, cv - R * 0.23, cu + R * 0.23, cv + R * 0.23, R * 0.05, variant === 0 ? BLUES : REDS);
  if (variant === 0) {
    // enthroned figure
    p.circle(cu, cv + 0.06 * R, 0.085 * R); p.piece(C.gold, LEAD, 0.05);
    p.poly([[cu - 0.05 * R, cv + 0.02 * R], [cu + 0.05 * R, cv + 0.02 * R], [cu + 0.13 * R, cv - 0.2 * R], [cu - 0.13 * R, cv - 0.2 * R]]);
    p.piece(C.ruby);
    p.poly([[cu - 0.025 * R, cv + 0.02 * R], [cu + 0.025 * R, cv + 0.02 * R], [cu + 0.05 * R, cv - 0.2 * R], [cu - 0.05 * R, cv - 0.2 * R]]);
    p.piece(C.white);
    p.circle(cu, cv + 0.065 * R, 0.042 * R); p.piece(C.flesh, LEAD * 0.8, 0.04);
  } else {
    const pts = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      pts.push(P(k % 2 ? 0.08 : 0.19, a));
    }
    p.poly(pts); p.piece(C.gold);
    p.circle(cu, cv, 0.07 * R); p.piece(C.white);
  }
  c.restore();
  p.border(() => p.circle(cu, cv, 0.225 * R), R * 0.022, C.gold, C.white, null);
  c.restore();
}

// Streaks, seeds and mottling of mouth-blown glass, multiplied over the art.
function glassGrain(ctx, W, H, rng) {
  const n = 256;
  const nc = document.createElement('canvas');
  nc.width = nc.height = n;
  const nx = nc.getContext('2d');
  const id = nx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = 150 + Math.floor(rng() * 105);
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = 255;
  }
  nx.putImageData(id, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const [sx, sy, alpha] of [[9, 9, 0.75], [3, 14, 0.5]]) {
    ctx.globalAlpha = alpha;
    for (let y = 0; y < H; y += n * sy) for (let x = 0; x < W; x += n * sx) ctx.drawImage(nc, x, y, n * sx, n * sy);
  }
  ctx.restore();
}

/** Paint one wall's glass band. Returns a canvas of band.w*ppm x band.h*ppm px. */
export function paintWall(wall, ppm) {
  const { band } = wall;
  const W = Math.round(band.w * ppm), H = Math.round(band.h * ppm);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  // draw in wall metres, v up; canvas top row = band.v1 (texture flipY keeps v up)
  ctx.setTransform(W / band.w, 0, 0, -H / band.h, 0, H);
  ctx.translate(-band.u0, -band.v0);

  const rng = mulberry32(wall.seed * 7919 + 13);
  const p = new Painter(ctx, rng);
  let li = 0, ri = 0;
  for (const o of wall.openings) {
    if (o.type === 'lancet') drawLancet(p, o, li++);
    else if (o.rose) drawRose(p, o, wall.name === 'east' ? 0 : 1 + ri++ * 0);
    else drawOculus(p, o);
  }
  glassGrain(ctx, W, H, rng);
  return canvas;
}
