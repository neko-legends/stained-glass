// Frame pipeline:
//   1. sun depth map (opaque geometry only; glass is handled analytically)
//      + floor radiosity map for bounce light        [only when the light moves]
//   2. depth pre-pass -> screen-space ambient occlusion
//   3. scene -> HDR target with depth (surfaces read the AO and bounce maps)
//   4. half-res volumetric ray-march (god rays through the glass)
//   5. composite, bloom, tone map
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import fsVert from './shaders/fullscreen.vert?raw';
import volFrag from './shaders/volumetric.frag?raw';
import compFrag from './shaders/composite.frag?raw';
import aoFrag from './shaders/ao.frag?raw';
import aoBlurFrag from './shaders/aoBlur.frag?raw';
import bounceFrag from './shaders/bounce.frag?raw';
import { withGlassLight } from './materials.js';
import { DIM } from './layout.js';

const SHADOW_SIZE = 4096;
const BOUNCE_TEXEL = 0.25; // floor metres per texel of the radiosity map

class ScenePass extends Pass {
  constructor(pipe) { super(); this.pipe = pipe; this.needsSwap = true; }
  render(renderer, writeBuffer) {
    const p = this.pipe;
    const cam = p.camera;

    // depth pre-pass (no transparent / additive objects)
    const prevOverride = p.scene.overrideMaterial;
    for (const o of p.noDepth) o.visible = false;
    p.scene.overrideMaterial = p.depthMat;
    renderer.setRenderTarget(p.preRT);
    renderer.clear();
    renderer.render(p.scene, cam);
    p.scene.overrideMaterial = prevOverride;
    for (const o of p.noDepth) o.visible = true;

    // ambient occlusion
    p.aoMat.uniforms.uProj.value.copy(cam.projectionMatrix);
    p.aoMat.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    renderer.setRenderTarget(p.aoRT);
    p.aoQuad.render(renderer);
    p.aoBlurMat.uniforms.uNear.value = cam.near;
    p.aoBlurMat.uniforms.uFar.value = cam.far;
    renderer.setRenderTarget(p.aoBlurRT);
    p.aoBlurQuad.render(renderer);

    // scene
    renderer.setRenderTarget(p.sceneRT);
    renderer.clear();
    renderer.render(p.scene, cam);

    // god rays
    p.invViewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
    p.volMat.uniforms.uCamPos.value.copy(cam.position);
    p.volMat.uniforms.uFrame.value = (p.volMat.uniforms.uFrame.value + 1) % 64;
    renderer.setRenderTarget(p.volRT);
    p.volQuad.render(renderer);

    p.compMat.uniforms.uCamPos.value.copy(cam.position);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    p.compQuad.render(renderer);
  }
}

export class Pipeline {
  constructor(renderer, scene, camera, lightU, opts = {}) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.lightU = lightU;
    this.invViewProj = new THREE.Matrix4();
    this.shadowDirty = true;
    this.noDepth = []; // objects skipped by the depth pre-pass (dust)

    // --- sun depth map ---
    this.shadowRT = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
      depthTexture: new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE, THREE.UnsignedIntType),
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.shadowRT.depthTexture.minFilter = this.shadowRT.depthTexture.magFilter = THREE.NearestFilter;
    this.shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.shadowCam.layers.set(0);
    this.shadowCam.layers.enable(2); // shadow-only geometry (the thin wall copy, see cathedral.js)
    this.depthMat = new THREE.MeshBasicMaterial({
      colorWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2,
    });
    lightU.uShadowMap.value = this.shadowRT.depthTexture;
    lightU.uShadowTexel.value.set(1 / SHADOW_SIZE, 1 / SHADOW_SIZE);

    // --- floor radiosity (one-bounce light) ---
    this.bounceRT = new THREE.WebGLRenderTarget(Math.round(DIM.L / BOUNCE_TEXEL), Math.round(DIM.W / BOUNCE_TEXEL), {
      type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.bounceMat = new THREE.ShaderMaterial({
      uniforms: { ...lightU, uTexel: { value: new THREE.Vector2(BOUNCE_TEXEL, BOUNCE_TEXEL) }, uFloorAlbedo: { value: 0.34 } },
      vertexShader: fsVert, fragmentShader: withGlassLight(bounceFrag), depthTest: false, depthWrite: false,
    });
    this.bounceQuad = new FullScreenQuad(this.bounceMat);
    lightU.uBounceMap.value = this.bounceRT.texture;
    lightU.uBounceTexel.value = BOUNCE_TEXEL;

    // --- depth pre-pass + AO ---
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.preRT = new THREE.WebGLRenderTarget(size.x, size.y, { depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType) });
    this.preRT.depthTexture.minFilter = this.preRT.depthTexture.magFilter = THREE.NearestFilter;
    const aoOpts = { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.aoRT = new THREE.WebGLRenderTarget(size.x, size.y, aoOpts);
    this.aoBlurRT = new THREE.WebGLRenderTarget(size.x, size.y, aoOpts);
    this.aoMat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: this.preRT.depthTexture }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
        uRes: { value: new THREE.Vector2(size.x, size.y) }, uRadius: { value: 1.1 },
      },
      vertexShader: fsVert, fragmentShader: aoFrag, depthTest: false, depthWrite: false,
    });
    this.aoQuad = new FullScreenQuad(this.aoMat);
    this.aoBlurMat = new THREE.ShaderMaterial({
      uniforms: {
        tAO: { value: this.aoRT.texture }, tDepth: { value: this.preRT.depthTexture },
        uRes: { value: new THREE.Vector2(size.x, size.y) }, uNear: { value: 0.2 }, uFar: { value: 120 },
      },
      vertexShader: fsVert, fragmentShader: aoBlurFrag, depthTest: false, depthWrite: false,
    });
    this.aoBlurQuad = new FullScreenQuad(this.aoBlurMat);
    lightU.uAO.value = this.aoBlurRT.texture;

    // --- scene target ---
    this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType, samples: opts.samples ?? 4,
      depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType),
    });
    this.volRT = new THREE.WebGLRenderTarget(size.x >> 1, size.y >> 1, { type: THREE.HalfFloatType, depthBuffer: false });

    this.volMat = new THREE.ShaderMaterial({
      uniforms: {
        ...lightU,
        tDepth: { value: this.sceneRT.depthTexture },
        uInvViewProj: { value: this.invViewProj },
        uCamPos: { value: new THREE.Vector3() },
        uDensity: { value: 0.012 },
        uAniso: { value: 0.45 },
        uMaxDist: { value: 70 },
        uFrame: { value: 0 },
        uHazeVariation: { value: 0.7 },
      },
      defines: { VOL_STEPS: opts.volSteps ?? 48 },
      vertexShader: fsVert, fragmentShader: withGlassLight(volFrag),
      depthTest: false, depthWrite: false,
    });
    this.volQuad = new FullScreenQuad(this.volMat);

    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tDepth: { value: this.sceneRT.depthTexture },
        tVol: { value: this.volRT.texture },
        uVolTexel: { value: new THREE.Vector2() },
        uInvViewProj: { value: this.invViewProj },
        uCamPos: { value: new THREE.Vector3() },
        uDensity: this.volMat.uniforms.uDensity,
        uFogColor: { value: new THREE.Color(0, 0, 0) },
        uVolStrength: { value: 1.0 },
      },
      vertexShader: fsVert, fragmentShader: compFrag,
      depthTest: false, depthWrite: false,
    });
    this.compQuad = new FullScreenQuad(this.compMat);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new ScenePass(this));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.6, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.setSize();
  }

  setSize() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT.setSize(size.x, size.y);
    this.preRT.setSize(size.x, size.y);
    this.aoRT.setSize(size.x, size.y);
    this.aoBlurRT.setSize(size.x, size.y);
    this.aoMat.uniforms.uRes.value.set(size.x, size.y);
    this.aoBlurMat.uniforms.uRes.value.set(size.x, size.y);
    this.lightU.uInvRes.value.set(1 / size.x, 1 / size.y);
    const vw = Math.max(1, size.x >> 1), vh = Math.max(1, size.y >> 1);
    this.volRT.setSize(vw, vh);
    this.compMat.uniforms.uVolTexel.value.set(1 / vw, 1 / vh);
    const css = r.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(css.x, css.y);
  }

  setVolSteps(n) { this.volMat.defines.VOL_STEPS = n; this.volMat.needsUpdate = true; }

  // Fit an orthographic camera around the building as seen from the light.
  updateShadow() {
    const dir = this.lightU.uLightDir.value;
    const cam = this.shadowCam;
    const hx = DIM.L / 2 + DIM.wallT * 2 + 0.5, hz = DIM.W / 2 + DIM.wallT * 2 + 0.5, top = DIM.wallH + 1;
    const center = new THREE.Vector3(0, top / 2, 0);
    cam.position.copy(center).addScaledVector(dir, 100);
    cam.up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.99) cam.up.set(1, 0, 0);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    const b = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const x of [-hx, hx]) for (const y of [-0.5, top]) for (const z of [-hz, hz]) b.expandByPoint(v.set(x, y, z).applyMatrix4(inv));
    cam.left = b.min.x; cam.right = b.max.x; cam.bottom = b.min.y; cam.top = b.max.y;
    cam.near = -b.max.z - 1; cam.far = -b.min.z + 1;
    cam.updateProjectionMatrix();

    const m = this.lightU.uShadowMatrix.value;
    m.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    m.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    this.lightU.uShadowBias.value = 0.03 / (cam.far - cam.near);
    this.lightU.uShadowRange.value = cam.far - cam.near;
    this.lightU.uShadowWorldTexel.value = Math.max(cam.right - cam.left, cam.top - cam.bottom) / SHADOW_SIZE;

    const r = this.renderer;
    const prev = this.scene.overrideMaterial;
    this.scene.overrideMaterial = this.depthMat;
    r.setRenderTarget(this.shadowRT);
    r.clear();
    r.render(this.scene, cam);
    this.scene.overrideMaterial = prev;

    // the floor's share of that light, for bounce
    r.setRenderTarget(this.bounceRT);
    this.bounceQuad.render(r);
    r.setRenderTarget(null);
    this.shadowDirty = false;
  }

  render() {
    if (this.shadowDirty) this.updateShadow();
    this.composer.render();
  }
}
