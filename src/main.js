import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { WALLS, DIM } from './layout.js';
import { paintWall } from './glassArt.js';
import { createLightUniforms, createMaterials } from './materials.js';
import { buildCathedral } from './cathedral.js';
import { Pipeline } from './pipeline.js';
import { computeSky } from './sun.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && !Number.isNaN(parseFloat(q.get(k))) ? parseFloat(q.get(k)) : d);

const state = {
  time: num('t', 10.5),
  dayOfYear: num('day', 100),
  latitude: num('lat', 47),
  playing: q.get('play') === '1',
  speed: 0.5,           // hours per second
  sunIntensity: 14,
  skyIntensity: 2.5,
  moonIntensity: 0.55,
  softness: 1.0,        // multiplier on the sun's angular diameter (glass diffusion)
  haze: 0.012,
  rays: 0.8,
  glow: 1.6,
  reflections: 1.0,
  floorPolish: 0.85,
  exposure: 1.0,
  autoExposure: true,
  bloom: 0.35,
  raySteps: 48,
  candles: 1.0,
};

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, num('dpr', 1.5)));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.autoClear = false;
renderer.setClearColor(0x000000, 1);

// --- stained glass textures -------------------------------------------------
const maxTex = renderer.capabilities.maxTextureSize;
let ppm = num('ppm', 128);
const widest = Math.max(...WALLS.map((w) => w.band.w));
ppm = Math.min(ppm, Math.floor(maxTex / widest));
const textures = WALLS.map((w) => {
  const tex = new THREE.CanvasTexture(paintWall(w, ppm));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
});

const lightU = createLightUniforms(textures, ppm);
const materials = createMaterials(lightU, textures);
const scene = new THREE.Scene();
const { group } = buildCathedral(materials);
scene.add(group);

const camera = new THREE.PerspectiveCamera(num('fov', 62), window.innerWidth / window.innerHeight, 0.1, 200);
camera.layers.enable(1);
const VIEWS = {
  nave: [[-9.5, 1.8, 1.2], [16, 8.5, -0.3]],
  floor: [[-6, 9, -5.5], [6, 0, 3]],
  south: [[-4, 2.2, -6], [4, 11, 8]],
  west: [[17, 2.0, -1.5], [-24, 11, 0]],
  rose: [[8, 3, 0], [24, 19, 0]],
  low: [[-3, 0.9, -2.5], [20, 6, 1]],
};
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomSpeed = 0.6;
function setView(name) {
  const v = VIEWS[name] ?? VIEWS.nave;
  camera.position.set(...v[0]);
  controls.target.set(...v[1]);
  controls.update();
}
setView(q.get('view') ?? 'nave');

const pipeline = new Pipeline(renderer, scene, camera, lightU, { volSteps: state.raySteps });

// --- lighting state -> uniforms ----------------------------------------------
const SUN_ANGULAR_DIAMETER = 0.0093; // radians
const clockEl = document.getElementById('clock');
const phaseEl = document.getElementById('phase');
const orbEl = document.getElementById('orb');
const slider = document.getElementById('time');
const lastDir = new THREE.Vector3();

function phaseName(sky) {
  if (!sky.isSun) return sky.moonAlt > 0.02 ? 'moonlight' : 'night';
  if (sky.sunAlt < 0.12) return state.time < 12 ? 'sunrise' : 'sunset';
  if (state.time < 11) return 'morning';
  if (state.time < 14) return 'midday';
  return 'afternoon';
}

function applyLighting() {
  const sky = computeSky(state.time, state.dayOfYear, state.latitude);
  const intensity = sky.isSun ? state.sunIntensity : state.moonIntensity;
  lightU.uLightDir.value.copy(sky.dir);
  lightU.uLightColor.value.copy(sky.color).multiplyScalar(intensity);
  lightU.uLightSpread.value = SUN_ANGULAR_DIAMETER * state.softness;
  lightU.uSkyColor.value.copy(sky.sky).multiplyScalar(state.skyIntensity);
  lightU.uAmbient.value.copy(sky.sky).multiplyScalar(0.03 * state.skyIntensity).addScalar(0.0015);
  lightU.uBounce.value.copy(lightU.uLightColor.value).multiply(new THREE.Color(0.9, 0.62, 0.7)).multiplyScalar(0.012 * Math.max(sky.dir.y, 0.05));
  lightU.uGlowStrength.value = state.glow;
  lightU.uReflStrength.value = state.reflections;
  lightU.uFloorPolish.value = state.floorPolish;
  lightU.uCandleColor.value.setRGB(0.5, 0.26, 0.08).multiplyScalar(state.candles);
  materials.flame.uniforms.uEmissive.value.setRGB(9, 4.2, 1.1).multiplyScalar(Math.min(state.candles, 1));

  pipeline.volMat.uniforms.uDensity.value = state.haze;
  pipeline.compMat.uniforms.uVolStrength.value = state.rays;
  pipeline.compMat.uniforms.uFogColor.value.copy(sky.sky).multiplyScalar(0.02);
  pipeline.bloom.strength = state.bloom;

  // The eye adapts: open up the exposure as the key light fades.
  const lum = sky.day + (sky.isSun ? Math.min(sky.color.g * 1.2, 1) : 0);
  const auto = state.autoExposure ? THREE.MathUtils.lerp(7.0, 1.0, THREE.MathUtils.smoothstep(lum, 0.0, 1.6)) : 1;
  renderer.toneMappingExposure = state.exposure * auto;

  if (lastDir.distanceToSquared(sky.dir) > 1e-10) { pipeline.shadowDirty = true; lastDir.copy(sky.dir); }

  const hh = Math.floor(state.time) % 24, mm = Math.floor((state.time % 1) * 60);
  clockEl.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  phaseEl.textContent = phaseName(sky);
  const c = sky.isSun ? sky.color.clone().lerp(new THREE.Color(1, 0.93, 0.7), 0.35) : new THREE.Color(0.75, 0.82, 1);
  const css = `rgb(${[c.r, c.g, c.b].map((v) => Math.round(255 * Math.min(1, Math.sqrt(v)))).join(',')})`;
  orbEl.style.background = sky.isSun ? css : `radial-gradient(circle at 35% 35%, #f4f6ff, #9fb0d8)`;
  orbEl.style.boxShadow = `0 0 ${sky.isSun ? 18 : 10}px ${css}`;
  if (document.activeElement !== slider) slider.value = String(state.time);
}

// --- UI ----------------------------------------------------------------------
slider.value = String(state.time);
slider.addEventListener('input', () => { state.time = parseFloat(slider.value); applyLighting(); });
const playBtn = document.getElementById('play');
const syncPlay = () => { playBtn.textContent = state.playing ? 'Pause' : 'Play'; };
playBtn.addEventListener('click', () => { state.playing = !state.playing; syncPlay(); });
syncPlay();

const gui = new GUI({ title: 'Stained Glass' });
const fSun = gui.addFolder('Sun & sky');
fSun.add(state, 'dayOfYear', 1, 365, 1).name('day of year').onChange(applyLighting);
fSun.add(state, 'latitude', 0, 66, 0.5).onChange(applyLighting);
fSun.add(state, 'speed', 0.05, 4, 0.05).name('play speed (h/s)');
fSun.add(state, 'sunIntensity', 0, 40, 0.5).name('sun intensity').onChange(applyLighting);
fSun.add(state, 'skyIntensity', 0, 8, 0.1).name('sky intensity').onChange(applyLighting);
fSun.add(state, 'moonIntensity', 0, 3, 0.05).name('moon intensity').onChange(applyLighting);
const fGlass = gui.addFolder('Glass & light');
fGlass.add(state, 'softness', 0.1, 8, 0.1).name('sun size / diffusion').onChange(applyLighting);
fGlass.add(lightU.uGlassScatter, 'value', 0, 0.3, 0.005).name('glass scatter');
fGlass.add(state, 'glow', 0, 3, 0.05).name('window glow').onChange(applyLighting);
fGlass.add(state, 'reflections', 0, 3, 0.05).onChange(applyLighting);
fGlass.add(state, 'floorPolish', 0, 1, 0.01).name('floor polish').onChange(applyLighting);
fGlass.add(state, 'candles', 0, 3, 0.05).onChange(applyLighting);
const fAir = gui.addFolder('Air');
fAir.add(state, 'haze', 0, 0.06, 0.001).name('haze density').onChange(applyLighting);
fAir.add(state, 'rays', 0, 4, 0.05).name('ray strength').onChange(applyLighting);
fAir.add(pipeline.volMat.uniforms.uAniso, 'value', 0, 0.9, 0.01).name('forward scatter');
fAir.add(state, 'raySteps', [16, 32, 48, 64, 96]).name('ray steps').onChange((v) => pipeline.setVolSteps(v));
const fCam = gui.addFolder('Image');
fCam.add(state, 'exposure', 0.2, 4, 0.01).onChange(applyLighting);
fCam.add(state, 'autoExposure').name('auto exposure').onChange(applyLighting);
fCam.add(state, 'bloom', 0, 1.5, 0.01).onChange(applyLighting);
fCam.add({ view: q.get('view') ?? 'nave' }, 'view', Object.keys(VIEWS)).onChange(setView);
if (q.get('ui') === '0') { gui.hide(); document.getElementById('bar').style.display = 'none'; document.getElementById('hint').style.display = 'none'; }
else if (window.innerWidth < 700) gui.close();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  pipeline.setSize();
});

// --- loop ----------------------------------------------------------------------
let lastT = performance.now();
const lim = { x: DIM.L / 2 - 0.8, z: DIM.W / 2 - 1.3 };
let frames = 0;
function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  if (state.playing) { state.time = (state.time + dt * state.speed) % 24; applyLighting(); }
  controls.update();
  // keep the visitor inside the building
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -lim.x, lim.x);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -lim.z, lim.z);
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.5, 16.5);
  pipeline.render();
  if (++frames === 2) { document.getElementById('loading').style.display = 'none'; window.__ready = true; }
  requestAnimationFrame(frame);
}
applyLighting();
frame();

// hooks for automation / debugging
window.__sg = { state, applyLighting, setView, camera, controls, pipeline, lightU, renderer };
