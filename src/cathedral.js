// Procedural gothic hall built from layout.js. Everything is merged into a
// handful of meshes (one per material).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIM, WALLS, archHeight, archOffset } from './layout.js';

const { L, W, wallT, wallH, bays, bayLen, spring: S, apex } = DIM;
const RISE = apex - S;

function lancetHole(o) {
  const p = new THREE.Path();
  p.moveTo(o.u, o.v0);
  p.lineTo(o.u + o.w, o.v0);
  p.lineTo(o.u + o.w, o.vs);
  p.absarc(o.u, o.vs, o.w, 0, Math.PI / 3, false);
  p.absarc(o.u + o.w, o.vs, o.w, (2 * Math.PI) / 3, Math.PI, false);
  p.closePath();
  return p;
}
function circleHole(o) {
  const p = new THREE.Path();
  p.absarc(o.cu, o.cv, o.r, 0, Math.PI * 2, false);
  return p;
}

// Extruded slab with holes, placed in the wall's (U, V, N) frame.
function wallGeometry(origin, U, V, N, width, height, thickness, openings, u0 = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(u0, 0); shape.lineTo(u0 + width, 0); shape.lineTo(u0 + width, height); shape.lineTo(u0, height); shape.closePath();
  for (const o of openings) shape.holes.push(o.type === 'lancet' ? lancetHole(o) : circleHole(o));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 20 });
  const m = new THREE.Matrix4().makeBasis(U, V, N).setPosition(origin);
  g.applyMatrix4(m);
  return g;
}

function box(sx, sy, sz, x, y, z) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}
function cyl(rt, rb, h, x, y, z, seg = 16) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
}
function tube(points, r, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.TubeGeometry(curve, points.length * 2, r, radial, false);
}

export function buildCathedral(materials) {
  const bins = { stone: [], plain: [], floor: [], vault: [], gold: [], cloth: [], wood: [], flame: [], dark: [] };
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

  // ---- outer walls with window openings ---------------------------------
  for (const w of WALLS) {
    bins.stone.push(wallGeometry(w.origin, w.U, w.V, w.N, w.width, w.height, wallT, w.openings));
  }

  // ---- floor, roof --------------------------------------------------------
  bins.floor.push(box(L + 2 * wallT, 1, W + 2 * wallT, 0, -0.5, 0));
  bins.dark.push(box(L + 4 * wallT, 0.6, W + 4 * wallT, 0, wallH + 0.3, 0));

  // ---- side walls: blind arcade, ledge, wall shafts -----------------------
  for (const w of WALLS.slice(0, 2)) {
    const inward = w.N.clone().negate();
    // arcade screen
    const arches = [];
    for (let b = 0; b < bays; b++) {
      const c = b * bayLen + bayLen / 2;
      for (let k = 0; k < 3; k++) arches.push({ type: 'lancet', u: c - 3.15 + k * 2.25, w: 1.8, v0: 0.55, vs: 3.4 });
    }
    const so = w.origin.clone().addScaledVector(w.U, wallT).addScaledVector(inward, 0.6);
    bins.stone.push(wallGeometry(so, w.U, w.V, w.N, L, 6.0, 0.32, arches));
    // helper to place boxes/cylinders in wall coordinates (u along wall, d = distance inside the wall face)
    const at = (u, y, d) => w.origin.clone().addScaledVector(w.U, wallT + u).addScaledVector(inward, d).setY(y);
    const alongX = Math.abs(w.U.x) > 0.5;
    const wbox = (lu, sy, sd, u, y, d) => {
      const p = at(u, y, d);
      return alongX ? box(lu, sy, sd, p.x, p.y, p.z) : box(sd, sy, lu, p.x, p.y, p.z);
    };
    bins.plain.push(wbox(L, 0.35, 0.85, L / 2, 6.17, 0.42));  // string course
    bins.plain.push(wbox(L, 0.55, 0.95, L / 2, 0.275, 0.47)); // bench
    bins.plain.push(wbox(L, 0.25, 0.5, L / 2, 7.25, 0.2));    // window sill ledge
    for (let b = 0; b < bays; b++) {
      const c = b * bayLen + bayLen / 2;
      for (let k = 0; k < 4; k++) {
        const u = c - 3.15 + k * 2.25 - 0.225;
        const p = at(u, 0.55, 0.72);
        bins.plain.push(cyl(0.12, 0.12, 2.85, p.x, p.y, p.z, 10));
        bins.plain.push(box(0.36, 0.2, 0.36, p.x, 3.4, p.z));
        bins.plain.push(box(0.34, 0.16, 0.34, p.x, 0.63, p.z));
      }
    }
    // wall shafts carrying the vault
    for (let i = 0; i <= bays; i++) {
      const u = i * bayLen;
      const p = at(u, 0, 0.75);
      bins.plain.push(cyl(0.72, 0.8, 1.1, p.x, 0, p.z, 8));
      bins.plain.push(cyl(0.5, 0.5, S - 1.1, p.x, 1.1, p.z, 18));
      bins.plain.push(cyl(0.95, 0.5, 0.75, p.x, S - 0.75, p.z, 18));
      bins.plain.push(box(1.7, 0.22, 1.7, p.x, S + 0.05, p.z));
      for (const s of [-1, 1]) {
        const q = at(u + s * 0.62, 0, 0.42);
        bins.plain.push(cyl(0.17, 0.17, S - 1.1, q.x, 1.1, q.z, 10));
      }
    }
  }

  // ---- rib vault ----------------------------------------------------------
  {
    const nx = bays * 20, nz = 48;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = -L / 2 + (L * i) / nx;
        const z = -W / 2 + (W * j) / nz;
        const lx = ((x + L / 2) % bayLen) - bayLen / 2;
        const y = S + Math.max(archHeight(z, W / 2, RISE), archHeight(lx, bayLen / 2, RISE));
        pos.push(x, y, z); uv.push(i / nx, j / nz);
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    bins.vault.push(g);

    const dN = (RISE * RISE - (W / 2) ** 2) / W, RN = W / 2 + dN;
    const thMax = Math.acos(dN / RN);
    const dB = (RISE * RISE - (bayLen / 2) ** 2) / bayLen, RB = bayLen / 2 + dB;
    const phMax = Math.acos(dB / RB);
    const n = 22;
    for (let i = 0; i <= bays; i++) {
      const x = -L / 2 + i * bayLen;
      for (const s of [-1, 1]) { // transverse arches
        const pts = [];
        for (let k = 0; k <= n; k++) { const th = (thMax * k) / n; pts.push(new THREE.Vector3(x, S + RN * Math.sin(th), s * (-dN + RN * Math.cos(th)))); }
        bins.plain.push(tube(pts, 0.24));
      }
      if (i === bays) break;
      const xc = x + bayLen / 2;
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) { // diagonal ribs along the groins
        const pts = [];
        for (let k = 0; k <= n; k++) {
          const th = (thMax * k) / n; const h = RN * Math.sin(th);
          pts.push(new THREE.Vector3(xc + sx * archOffset(h, bayLen / 2, RISE), S + h - 0.03, sz * (-dN + RN * Math.cos(th))));
        }
        bins.plain.push(tube(pts, 0.17));
      }
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) { // wall ribs
        const pts = [];
        for (let k = 0; k <= n; k++) { const ph = (phMax * k) / n; pts.push(new THREE.Vector3(xc + sx * (-dB + RB * Math.cos(ph)), S + RB * Math.sin(ph), sz * (W / 2 - 0.05))); }
        bins.plain.push(tube(pts, 0.15, 6));
      }
      const boss = new THREE.SphereGeometry(0.42, 16, 12); boss.translate(xc, apex - 0.12, 0);
      bins.gold.push(boss);
    }
  }

  // ---- sanctuary: steps, altar, reredos, candles ---------------------------
  const ex = L / 2;
  for (let i = 0; i < 3; i++) {
    const x0 = ex - 8.6 + i * 0.75, hw = 6.6 - i * 0.35;
    bins.plain.push(box(ex - x0, 0.22, hw * 2, (x0 + ex) / 2, 0.11 + i * 0.22, 0));
  }
  const dais = 0.66;
  bins.gold.push(box(1.25, 1.1, 3.3, ex - 4.6, dais + 0.55, 0));
  bins.cloth.push(box(1.45, 0.07, 3.6, ex - 4.6, dais + 1.135, 0));
  bins.cloth.push(box(0.04, 0.5, 3.6, ex - 5.33, dais + 0.92, 0));
  // reredos
  const rx = ex - 1.9;
  bins.gold.push(box(0.8, 2.4, 6.4, rx, dais + 1.2, 0));
  bins.gold.push(box(1.0, 0.18, 6.7, rx, dais + 2.45, 0));
  for (let k = -2; k <= 2; k++) {
    const h = 2.0 + (2 - Math.abs(k)) * 0.9;
    const z = k * 1.24;
    bins.gold.push(box(0.6, h, 0.98, rx, dais + 2.5 + h / 2, z));
    bins.dark.push(box(0.1, h * 0.62, 0.6, rx - 0.3, dais + 2.6 + h * 0.36, z));
    const cone = new THREE.ConeGeometry(0.72, 1.5, 4); cone.rotateY(Math.PI / 4); cone.translate(rx, dais + 2.5 + h + 0.75, z);
    bins.gold.push(cone);
    for (const s of [-1, 1]) {
      const pin = new THREE.ConeGeometry(0.12, 0.9, 4); pin.translate(rx, dais + 2.5 + h + 0.45, z + s * 0.56);
      bins.gold.push(pin);
    }
  }
  bins.gold.push(box(0.36, 1.6, 0.36, rx, dais + 2.5 + 3.8 + 1.5 + 0.3, 0));
  { const sp = new THREE.ConeGeometry(0.3, 2.6, 4); sp.rotateY(Math.PI / 4); sp.translate(rx, dais + 2.5 + 3.8 + 1.5 + 1.1 + 1.3, 0); bins.gold.push(sp); }

  const flames = [];
  const candle = (x, y, z, standH) => {
    bins.gold.push(cyl(0.035, 0.05, standH, x, y, z, 8));
    bins.gold.push(cyl(0.05, 0.16, 0.12, x, y, z, 8));
    bins.gold.push(cyl(0.09, 0.03, 0.05, x, y + standH, z, 8));
    bins.cloth.push(cyl(0.028, 0.028, 0.34, x, y + standH + 0.05, z, 8));
    const f = new THREE.SphereGeometry(0.03, 8, 6); f.scale(1, 2.1, 1); f.translate(x, y + standH + 0.45, z);
    bins.flame.push(f);
    flames.push(new THREE.Vector3(x, y + standH + 0.45, z));
  };
  for (const z of [-1.35, -0.8, 0.8, 1.35]) candle(ex - 4.6, dais + 1.17, z, 0.45);
  for (const z of [-4.6, 4.6]) { candle(ex - 6.4, dais, z, 1.7); candle(ex - 9.6, 0, z * 1.2, 1.7); }

  // ---- west door -----------------------------------------------------------
  bins.wood.push(box(0.3, 5.2, 3.4, -ex + 0.1, 2.6, 0));
  bins.plain.push(box(0.5, 5.6, 0.45, -ex + 0.2, 2.8, 1.95));
  bins.plain.push(box(0.5, 5.6, 0.45, -ex + 0.2, 2.8, -1.95));
  bins.plain.push(box(0.5, 0.5, 4.5, -ex + 0.2, 5.6, 0));
  bins.gold.push(box(0.08, 0.1, 3.4, -ex + 0.27, 1.6, 0));
  bins.gold.push(box(0.08, 0.1, 3.4, -ex + 0.27, 3.8, 0));

  // ---- merge ---------------------------------------------------------------
  const group = new THREE.Group();
  for (const [key, list] of Object.entries(bins)) {
    if (!list.length) continue;
    const clean = list.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name);
      n.clearGroups();
      return n;
    });
    const mesh = new THREE.Mesh(mergeGeometries(clean, false), materials[key]);
    mesh.name = key;
    if (key === 'flame') mesh.layers.set(1); // does not cast shadows
    group.add(mesh);
  }

  // ---- glass ---------------------------------------------------------------
  WALLS.forEach((w, i) => {
    const o = w.paneO, a = o.clone().add(w.paneU), b = a.clone().add(w.paneV), c = o.clone().add(w.paneV);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([o.x, o.y, o.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new THREE.Mesh(g, materials.glass[i]);
    mesh.name = 'glass-' + w.name;
    mesh.layers.set(1); // glass filters light analytically; it must not block the sun in the depth map
    group.add(mesh);
  });

  return { group, flames };
}
