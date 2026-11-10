// Single source of truth for the building: dimensions, walls and window
// openings. The wall geometry (holes), the stained-glass art (canvas) and the
// light-transport shader (pane planes) are all derived from this file, which
// is why the projected light lines up with the windows exactly.
import * as THREE from 'three';

export const DIM = {
  L: 48,          // inner length (x: -24 .. 24), entrance -> altar
  W: 16,          // inner width  (z: -8 .. 8),  left wall -> right wall (facing the altar)
  wallT: 1.2,     // wall thickness
  wallH: 28.5,
  bays: 6,
  bayLen: 8,
  spring: 18,     // vault springing height
  apex: 27,       // vault apex height
  glassDepth: 0.3 // glass plane distance from the inner wall face (shallow, so the opening's own edge shadows little of the light)
};

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const { L, W, wallT } = DIM;

// Each wall: origin = inner-face lower-left corner, U along the wall, V up,
// N = U x V pointing OUT of the building. (u, v) are metres on the wall.
// Cat-head outline as a polygon (wall metres, counter-clockwise).
function catHead(cu, cv, r) {
  const pts = [];
  const P = (deg, k = 1) => [cu + Math.cos((deg * Math.PI) / 180) * r * 1.08 * k, cv + Math.sin((deg * Math.PI) / 180) * r * 0.92 * k];
  for (let a = 78; a <= 102; a += 6) pts.push(P(a));  // crown between the ears
  pts.push(P(122, 1.62));                              // left ear tip
  for (let a = 146; a <= 394; a += 8) pts.push(P(a)); // cheek, chin, cheek
  pts.push(P(58, 1.62));                               // right ear tip
  return pts;
}

function sideOpenings() {
  const ops = [];
  for (let b = 0; b < DIM.bays; b++) {
    const c = wallT + b * DIM.bayLen + DIM.bayLen / 2; // bay centre in wall-u
    const lw = 2.4, gap = 0.5, sill = 7.6, spring = 16.6;
    ops.push({ type: 'lancet', u: c - gap / 2 - lw, w: lw, v0: sill, vs: spring, bay: b, slot: 0 });
    ops.push({ type: 'lancet', u: c + gap / 2, w: lw, v0: sill, vs: spring, bay: b, slot: 1 });
    // free-form opening: any closed polygon works (here, a cat's head)
    ops.push({ type: 'poly', pts: catHead(c, 19.7, 1.0), cu: c, cv: 19.7, r: 1.0, bay: b });
  }
  return ops;
}

function eastOpenings() {
  const ops = [];
  const n = 5, lw = 1.6, gap = 0.45;
  const total = n * lw + (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    ops.push({ type: 'lancet', u: W / 2 - total / 2 + i * (lw + gap), w: lw, v0: 8.2, vs: 15.9, slot: i, major: true });
  }
  ops.push({ type: 'circle', cu: W / 2, cv: 22.0, r: 3.7, rose: true });
  return ops;
}

function westOpenings() {
  const ops = [];
  const n = 4, lw = 1.5, gap = 0.5;
  const total = n * lw + (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    ops.push({ type: 'lancet', u: W / 2 - total / 2 + i * (lw + gap), w: lw, v0: 8.0, vs: 12.2, slot: i });
  }
  ops.push({ type: 'circle', cu: W / 2, cv: 20.2, r: 4.4, rose: true });
  return ops;
}

export const WALLS = [
  {
    name: 'right', seed: 11,
    origin: new THREE.Vector3(-L / 2 - wallT, 0, W / 2), U: X.clone(), V: Y.clone(),
    width: L + 2 * wallT, height: DIM.wallH,
    openings: sideOpenings(),
  },
  {
    name: 'left', seed: 23,
    origin: new THREE.Vector3(L / 2 + wallT, 0, -W / 2), U: X.clone().negate(), V: Y.clone(),
    width: L + 2 * wallT, height: DIM.wallH,
    openings: sideOpenings(),
  },
  {
    name: 'altar', seed: 37,
    origin: new THREE.Vector3(L / 2, 0, W / 2), U: Z.clone().negate(), V: Y.clone(),
    width: W, height: DIM.wallH,
    openings: eastOpenings(),
  },
  {
    name: 'entrance', seed: 53,
    origin: new THREE.Vector3(-L / 2, 0, -W / 2), U: Z.clone(), V: Y.clone(),
    width: W, height: DIM.wallH,
    openings: westOpenings(),
  },
];

function bounds(openings) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const o of openings) {
    if (o.type === 'lancet') {
      u0 = Math.min(u0, o.u); u1 = Math.max(u1, o.u + o.w);
      v0 = Math.min(v0, o.v0); v1 = Math.max(v1, o.vs + o.w * 0.8661);
    } else if (o.type === 'poly') {
      for (const [u, v] of o.pts) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    } else {
      u0 = Math.min(u0, o.cu - o.r); u1 = Math.max(u1, o.cu + o.r);
      v0 = Math.min(v0, o.cv - o.r); v1 = Math.max(v1, o.cv + o.r);
    }
  }
  return { u0, u1, v0, v1 };
}

for (const w of WALLS) {
  w.N = new THREE.Vector3().crossVectors(w.U, w.V); // outward
  // Image slots: groups of openings that one picture can be stretched across
  // (a side bay = two lancets + oculus; the lancet row; the rose).
  const sets = new Map();
  for (const o of w.openings) {
    const id = o.bay !== undefined ? `${w.name}-${o.bay + 1}` : `${w.name}-${o.rose ? 'rose' : 'lancets'}`;
    if (!sets.has(id)) sets.set(id, []);
    sets.get(id).push(o);
  }
  w.groups = [...sets].map(([id, openings]) => ({ id, openings, rect: bounds(openings) }));
  // Glass band: the sub-rectangle of the wall that one texture covers.
  const { u0, u1, v0, v1 } = bounds(w.openings);
  const pad = 0.25;
  w.band = { u0: u0 - pad, u1: u1 + pad, v0: v0 - pad, v1: v1 + pad };
  w.band.w = w.band.u1 - w.band.u0;
  w.band.h = w.band.v1 - w.band.v0;
  // World-space pane rectangle (lower-left corner + full edge vectors).
  w.paneO = w.origin.clone()
    .addScaledVector(w.U, w.band.u0)
    .addScaledVector(w.V, w.band.v0)
    .addScaledVector(w.N, DIM.glassDepth);
  w.paneU = w.U.clone().multiplyScalar(w.band.w);
  w.paneV = w.V.clone().multiplyScalar(w.band.h);
}

// Pointed (two-centred) arch profile used by the vault: height above the
// springing line at horizontal offset x for half-span a and rise r.
export function archHeight(x, a, r) {
  const d = (r * r - a * a) / (2 * a);
  const R = a + d;
  const q = R * R - (Math.abs(x) + d) * (Math.abs(x) + d);
  return q > 0 ? Math.sqrt(q) : 0;
}
// Inverse: |x| at which the arch has height h.
export function archOffset(h, a, r) {
  const d = (r * r - a * a) / (2 * a);
  const R = a + d;
  return Math.max(0, Math.sqrt(Math.max(R * R - h * h, 0)) - d);
}
