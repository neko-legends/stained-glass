// Dust motes drifting through the nave; see shaders/dust.vert.
import * as THREE from 'three';
import dustVert from './shaders/dust.vert?raw';
import dustFrag from './shaders/dust.frag?raw';
import { withGlassLight } from './materials.js';
import { DIM } from './layout.js';

export function createDust(lightU, count = 9000) {
  const seed = new Float32Array(count * 4), vel = new Float32Array(count * 3), pos = new Float32Array(count * 3);
  let s = 987654321;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    // metres per second: a slow sideways wander and a very slow fall
    vel.set([(rnd() - 0.5) * 0.05, -0.004 - rnd() * 0.012, (rnd() - 0.5) * 0.05], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...lightU,
      uBoxMin: { value: new THREE.Vector3(-DIM.L / 2 + 0.5, 0.2, -DIM.W / 2 + 0.8) },
      uBoxSize: { value: new THREE.Vector3(DIM.L - 1, 19, DIM.W - 1.6) },
      uDustSize: { value: 0.011 },
      uPixelsPerRad: { value: 800 },
      uDustBrightness: { value: 1.0 },
    },
    vertexShader: withGlassLight(dustVert), fragmentShader: dustFrag,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const points = new THREE.Points(g, material);
  points.frustumCulled = false; // positions are computed in the vertex shader
  points.layers.set(1);         // never in the sun depth map
  points.name = 'dust';
  return points;
}
