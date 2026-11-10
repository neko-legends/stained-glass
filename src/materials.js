import * as THREE from 'three';
import glassLight from './shaders/glassLight.glsl?raw';
import surfaceVert from './shaders/surface.vert?raw';
import surfaceFrag from './shaders/surface.frag?raw';
import glassVert from './shaders/glass.vert?raw';
import glassFrag from './shaders/glass.frag?raw';
import { WALLS, DIM } from './layout.js';

export const withGlassLight = (src) => src.replace('#include_glass_light', glassLight);

/** Uniforms of the light-transport model, shared (by reference) by every material and pass. */
export function createLightUniforms(textures, ppm) {
  const planes = [], O = [], U = [], V = [];
  for (const w of WALLS) {
    const nIn = w.N.clone().negate();
    planes.push(new THREE.Vector4(nIn.x, nIn.y, nIn.z, -nIn.dot(w.paneO)));
    O.push(w.paneO.clone());
    U.push(w.paneU.clone().divideScalar(w.paneU.lengthSq()));
    V.push(w.paneV.clone().divideScalar(w.paneV.lengthSq()));
  }
  const maxDim = Math.max(...textures.map((t) => Math.max(t.image.width, t.image.height)));
  return {
    uPane0: { value: textures[0] }, uPane1: { value: textures[1] },
    uPane2: { value: textures[2] }, uPane3: { value: textures[3] },
    uPanePlane: { value: planes }, uPaneO: { value: O }, uPaneU: { value: U }, uPaneV: { value: V },
    uPanePxPerM: { value: ppm },
    uPaneMaxLod: { value: Math.floor(Math.log2(maxDim)) - 2 },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uLightColor: { value: new THREE.Color(1, 1, 1) },
    uLightSpread: { value: 0.0093 },
    uSkyColor: { value: new THREE.Color(0.3, 0.5, 1) },
    uGlassScatter: { value: 0.06 },
    uGlassRipple: { value: 0.6 },
    uTime: { value: 0 },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowTexel: { value: new THREE.Vector2(1 / 4096, 1 / 4096) },
    uShadowBias: { value: 0.0004 },
    uShadowWorldTexel: { value: 0.015 },
    uShadowRange: { value: 70 },
    // room lighting
    uAmbient: { value: new THREE.Color(0.01, 0.01, 0.012) },
    uBounce: { value: new THREE.Color(0, 0, 0) },
    uGlowStrength: { value: 1.0 },
    uReflStrength: { value: 1.0 },
    uFloorPolish: { value: 0.75 },
    uCandlePos: { value: new THREE.Vector3(19, 3, 0) },
    uCandleColor: { value: new THREE.Color(0.5, 0.26, 0.08) },
    // screen-space AO and floor radiosity, filled in by the pipeline
    uAO: { value: null },
    uInvRes: { value: new THREE.Vector2(1, 1) },
    uAOStrength: { value: 1.0 },
    uBounceMap: { value: null },
    uFloorMin: { value: new THREE.Vector2(-DIM.L / 2, -DIM.W / 2) },
    uFloorSize: { value: new THREE.Vector2(DIM.L, DIM.W) },
    uBounceTexel: { value: 0.25 },
    uBounceStrength: { value: 1.0 },
    uBump: { value: 1.0 },
    uToonFill: { value: 0.2 },
  };
}

export function createMaterials(lightU, textures) {
  const surface = (color, rough, metal, pattern, extra = {}) =>
    new THREE.ShaderMaterial({
      uniforms: {
        ...lightU,
        uColor: { value: new THREE.Color(color) },
        uRough: { value: rough },
        uMetal: { value: metal },
        uPattern: { value: pattern },
        uWrap: { value: extra.wrap ?? 0 },
        uTranslucency: { value: extra.translucency ?? 0 },
        uMap: { value: extra.map ?? null },
        uNormalMap: { value: extra.normalMap ?? null },
        uNormalScale: { value: extra.normalMap ? (extra.normalScale ?? 0.7) : 0 },
        uToon: { value: extra.toon ? 1 : 0 },
        uEmissive: { value: new THREE.Color(extra.emissive ?? 0x000000) },
      },
      vertexShader: surfaceVert,
      fragmentShader: withGlassLight(surfaceFrag),
      side: extra.side ?? THREE.FrontSide,
    });

  const m = {
    stone: surface(0x9a8f80, 0.86, 0, 1),
    plain: surface(0xa69a88, 0.8, 0, 0),
    floor: surface(0x6b655d, 0.3, 0, 2),
    vault: surface(0x8d8272, 0.9, 0, 1, { side: THREE.DoubleSide }),
    gold: surface(0xd9a441, 0.34, 1, 0),
    cloth: surface(0xe9e2d2, 0.8, 0, 0),
    wood: surface(0x4a2f1b, 0.6, 0, 3),
    marble: surface(0xd9d5cf, 0.3, 0, 4, { wrap: 0.12, translucency: 0.9 }),
    dark: surface(0x1c1814, 0.9, 0, 0),
    flame: surface(0x000000, 1, 0, 0),
  };
  m.flame.uniforms.uEmissive.value.setRGB(9, 4.2, 1.1);
  m.halo = surface(0x000000, 1, 0, 0);
  m.halo.uniforms.uEmissive.value.setRGB(4.2, 3.5, 2.1);
  // anime figure (base-colour map from a generated model): flat toon shading, see surface.frag
  m.textured = (map, normalMap) => surface(0xffffff, 0.9, 0, 5, { map, normalMap, toon: true });

  m.glass = WALLS.map((w, i) =>
    new THREE.ShaderMaterial({
      uniforms: {
        ...lightU,
        uTex: { value: textures[i] },
        uNIn: { value: w.N.clone().negate() },
      },
      vertexShader: glassVert,
      fragmentShader: withGlassLight(glassFrag),
      side: THREE.DoubleSide,
    }));
  return m;
}
