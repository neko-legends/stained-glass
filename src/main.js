import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import GUI from 'lil-gui';
import { WALLS, DIM } from './layout.js';
import { paintWall } from './glassArt.js';
import { createLightUniforms, createMaterials } from './materials.js';
import { buildCathedral } from './cathedral.js';
import { Pipeline } from './pipeline.js';
import { computeSky } from './sun.js';
import { createDust } from './dust.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && !Number.isNaN(parseFloat(q.get(k))) ? parseFloat(q.get(k)) : d);

const state = {
  time: num('t', 10.5),
  dayOfYear: num('day', 100),
  latitude: num('lat', 47),
  altarHeading: num('heading', 180), // compass bearing the altar end faces: 180 = south
  art: q.get('art') ?? 'auto',
  playing: q.get('play') === '1',
  speed: 0.5,           // hours per second
  sunIntensity: 14,
  skyIntensity: 2.5,
  moonIntensity: 0.55,
  softness: 2.0,        // multiplier on the sun's angular diameter: 1 = bare sun; old glass diffuses more
  haze: 0.012,
  rays: 0.65,
  glow: 1.6,
  reflections: 1.0,
  floorPolish: 0.85,
  exposure: 1.0,
  autoExposure: true,
  bloom: 0.45,
  bloomRadius: 0.6,
  bloomThreshold: 1.0,
  raySteps: 48,
  candles: 1.0,
  ao: 1.0,
  bounce: 1.0,
  dust: 1.5,
  dustSize: 1.0,
  hazeVariation: 0.7,
  glassRipple: 0.6,
  relief: 1.0,
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
// slot id -> image, for windows that show a picture instead of the procedural design
const glassImages = new Map();
const textures = WALLS.map((w) => {
  const tex = new THREE.CanvasTexture(paintWall(w, ppm, glassImages));
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
const { group, statueBase } = buildCathedral(materials);
scene.add(group);

// --- generated figures ----------------------------------------------------------
// GLB models made from reference images with a local image-to-3D model. They
// are scaled to a target height, stood on a point, and lit by the same surface
// shader as the building (so they take the glass light, AO and bounce).
const gltfLoader = new GLTFLoader();
let figuresPending = 2;
const figureDone = () => { if (--figuresPending === 0) window.__statueReady = true; };
function loadFigure(url, { height, base, rotY, material }) {
  gltfLoader.load(url, (gltf) => {
    const root = gltf.scene;
    root.rotation.y = rotY;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const k = height / (box.max.y - box.min.y);
    root.scale.setScalar(k);
    root.position.set(base.x - k * (box.min.x + box.max.x) / 2, base.y - k * box.min.y, base.z - k * (box.min.z + box.max.z) / 2);
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      const twoSided = o.material.side === THREE.DoubleSide; // keep a model's own double-sided cloth
      o.material = typeof material === 'function' ? material(o.material.map ?? null) : material;
      if (twoSided && typeof material === 'function') o.material.side = THREE.DoubleSide;
    });
    scene.add(root);
    pipeline.shadowDirty = true;
    figureDone();
  }, undefined, (e) => { console.warn(url + ':', e.message ?? e); figureDone(); });
}
// marble angel on the plinth, facing down the nave
loadFigure('./models/angel.glb', { height: 5.6, base: statueBase, rotY: -Math.PI / 2, material: materials.marble });
// the praying girl kneels on the floor before the altar steps, facing the angel
const GIRL = { height: 1.3, base: new THREE.Vector3(DIM.L / 2 - 10.4, -0.012, 0) };
loadFigure('./models/girl.glb', { ...GIRL, rotY: Math.PI / 2, material: materials.textured });
{ // her halo: a thin ring of light on top of her head, tilted back with it (front edge raised) as in the reference sheet
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.19 * GIRL.height, 0.0045, 8, 128), materials.halo);
  halo.position.set(GIRL.base.x - 0.06, GIRL.height - 0.03, 0);
  halo.rotation.x = Math.PI / 2;
  halo.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), 0.42); // she faces +X: lift the +X edge
  halo.layers.set(1); // light, not a shadow caster
  halo.name = 'halo';
  scene.add(halo);
}

const camera = new THREE.PerspectiveCamera(num('fov', 62), window.innerWidth / window.innerHeight, 0.2, 120);
camera.layers.enable(1);
const VIEWS = {
  nave: [[-9.5, 1.8, 1.2], [16, 8.5, -0.3]],
  floor: [[-6, 9, -5.5], [6, 0, 3]],
  side: [[-4, 2.2, -6], [4, 11, 8]],
  entrance: [[17, 2.0, -1.5], [-24, 11, 0]],
  rose: [[8, 3, 0], [24, 19, 0]],
  low: [[-3, 0.9, -2.5], [20, 6, 1]],
};
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomSpeed = 0.6;
// Pan speed is adjustable (panel: "pan speed"); the default is twice OrbitControls' own. Shift doubles it.
const nav = { pan: num('pan', 2), walk: 5 };
controls.panSpeed = nav.pan;
const held = new Set();
let fastNow = false;
const setFast = (fast) => { fastNow = fast; controls.panSpeed = nav.pan * (fast ? 2 : 1); controls.zoomSpeed = 0.6 * (fast ? 2 : 1); };
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  held.add(e.code);
  if (e.key === 'Shift') setFast(true);
});
window.addEventListener('keyup', (e) => { held.delete(e.code); if (e.key === 'Shift') setFast(false); });
window.addEventListener('blur', () => { held.clear(); setFast(false); });
// WASD / arrows walk, Q and E go down and up; Shift walks faster. Moves the camera and its pivot together.
const walkDir = new THREE.Vector3(), walkRight = new THREE.Vector3(), walkStep = new THREE.Vector3();
function walk(dt) {
  const f = (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0);
  const r = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
  const u = (held.has('KeyE') ? 1 : 0) - (held.has('KeyQ') ? 1 : 0);
  if (!f && !r && !u) return;
  camera.getWorldDirection(walkDir); walkDir.y = 0; walkDir.normalize();
  walkRight.crossVectors(walkDir, camera.up).normalize();
  const speed = nav.walk * (held.has('ShiftLeft') || held.has('ShiftRight') ? 2.5 : 1) * dt;
  walkStep.set(0, 0, 0).addScaledVector(walkDir, f * speed).addScaledVector(walkRight, r * speed);
  walkStep.y += u * speed;
  camera.position.add(walkStep); controls.target.add(walkStep);
}
function setView(name) {
  const v = VIEWS[name] ?? VIEWS.nave;
  camera.position.set(...v[0]);
  controls.target.set(...v[1]);
  controls.update();
}
setView(q.get('view') ?? 'nave');

const pipeline = new Pipeline(renderer, scene, camera, lightU, { volSteps: state.raySteps });
const dust = createDust(lightU, Math.round(num('motes', 9000)));
scene.add(dust);
pipeline.noDepth.push(dust);

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
  // compass (east, up, south) -> building frame (+X = altar end)
  const hd = THREE.MathUtils.degToRad(state.altarHeading);
  const aE = Math.sin(hd), aS = -Math.cos(hd);
  sky.dir.set(sky.dir.x * aE + sky.dir.z * aS, sky.dir.y, -sky.dir.x * aS + sky.dir.z * aE);
  lightU.uLightDir.value.copy(sky.dir);
  lightU.uLightColor.value.copy(sky.color).multiplyScalar(intensity);
  lightU.uLightSpread.value = SUN_ANGULAR_DIAMETER * state.softness;
  lightU.uSkyColor.value.copy(sky.sky).multiplyScalar(state.skyIntensity);
  lightU.uAmbient.value.copy(sky.sky).multiplyScalar(0.03 * state.skyIntensity).addScalar(0.0015);
  // residual multi-bounce fill (the first bounce off the floor is computed, see bounce.frag)
  lightU.uBounce.value.copy(lightU.uLightColor.value).multiply(new THREE.Color(0.9, 0.62, 0.7)).multiplyScalar(0.004 * Math.max(sky.dir.y, 0.05));
  lightU.uAOStrength.value = state.ao;
  lightU.uBounceStrength.value = state.bounce;
  lightU.uGlassRipple.value = state.glassRipple;
  lightU.uBump.value = state.relief;
  dust.visible = state.dust > 0;
  dust.material.uniforms.uDustBrightness.value = state.dust;
  dust.material.uniforms.uDustSize.value = 0.011 * state.dustSize;
  pipeline.volMat.uniforms.uHazeVariation.value = state.hazeVariation;
  lightU.uGlowStrength.value = state.glow;
  lightU.uReflStrength.value = state.reflections;
  lightU.uFloorPolish.value = state.floorPolish;

  pipeline.volMat.uniforms.uDensity.value = state.haze;
  pipeline.compMat.uniforms.uVolStrength.value = state.rays;
  pipeline.compMat.uniforms.uFogColor.value.copy(sky.sky).multiplyScalar(0.02);
  pipeline.bloom.strength = state.bloom;
  pipeline.bloom.radius = state.bloomRadius;
  pipeline.bloom.threshold = state.bloomThreshold;

  // The eye adapts: open up the exposure as the key light fades.
  const lum = sky.day + (sky.isSun ? Math.min(sky.color.g * 1.2, 1) : 0);
  const auto = state.autoExposure ? THREE.MathUtils.lerp(7.0, 1.0, THREE.MathUtils.smoothstep(lum, 0.0, 1.6)) : 1;
  renderer.toneMappingExposure = state.exposure * auto;
  lightU.uToonFill.value = 0.16 / renderer.toneMappingExposure; // constant on screen whatever the exposure

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
fSun.add(state, 'time', 0, 24, 0.01).name('time of day').listen().onChange(applyLighting);
fSun.add(state, 'altarHeading', 0, 360, 1).name('altar faces (°, 180 = S)').onChange(applyLighting);
fSun.add(state, 'dayOfYear', 1, 365, 1).name('day of year').onChange(applyLighting);
fSun.add(state, 'latitude', 0, 66, 0.5).onChange(applyLighting);
fSun.add(state, 'speed', 0.05, 4, 0.05).name('play speed (h/s)');
fSun.add(state, 'sunIntensity', 0, 40, 0.5).name('sun intensity').onChange(applyLighting);
fSun.add(state, 'skyIntensity', 0, 8, 0.1).name('sky intensity').onChange(applyLighting);
fSun.add(state, 'moonIntensity', 0, 3, 0.05).name('moon intensity').onChange(applyLighting);
const fGlass = gui.addFolder('Glass & light');
fGlass.add(state, 'softness', 0.1, 12, 0.1).name('light softness').onChange(applyLighting);
fGlass.add(lightU.uGlassScatter, 'value', 0, 0.3, 0.005).name('glass scatter');
fGlass.add(state, 'glow', 0, 3, 0.05).name('window glow').onChange(applyLighting);
fGlass.add(state, 'reflections', 0, 3, 0.05).onChange(applyLighting);
fGlass.add(state, 'floorPolish', 0, 1, 0.01).name('floor polish').onChange(applyLighting);
fGlass.add(state, 'candles', 0, 3, 0.05);
fGlass.add(state, 'glassRipple', 0, 2, 0.05).name('glass ripple').onChange(applyLighting);
const fRoom = gui.addFolder('Room');
fRoom.add(state, 'ao', 0, 2.5, 0.05).name('ambient occlusion').onChange(applyLighting);
fRoom.add(state, 'bounce', 0, 4, 0.05).name('bounce light').onChange(applyLighting);
fRoom.add(state, 'relief', 0, 3, 0.05).name('stone relief').onChange(applyLighting);
fRoom.add(state, 'dust', 0, 4, 0.05).name('dust motes').onChange(applyLighting);
fRoom.add(state, 'dustSize', 0.3, 3, 0.05).name('mote size').onChange(applyLighting);
const fAir = gui.addFolder('Air');
fAir.add(state, 'haze', 0, 0.06, 0.001).name('haze density').onChange(applyLighting);
fAir.add(state, 'rays', 0, 4, 0.05).name('ray strength').onChange(applyLighting);
fAir.add(state, 'hazeVariation', 0, 1, 0.01).name('haze drift').onChange(applyLighting);
fAir.add(pipeline.volMat.uniforms.uAniso, 'value', 0, 0.9, 0.01).name('forward scatter');
fAir.add(state, 'raySteps', [16, 32, 48, 64, 96]).name('ray steps').onChange((v) => pipeline.setVolSteps(v));
const fBloom = gui.addFolder('Bloom');
fBloom.add(state, 'bloom', 0, 3, 0.01).name('strength').onChange(applyLighting);
fBloom.add(state, 'bloomRadius', 0, 1.5, 0.01).name('radius').onChange(applyLighting);
fBloom.add(state, 'bloomThreshold', 0, 4, 0.01).name('threshold').onChange(applyLighting);
const fCam = gui.addFolder('Image');
fCam.add(state, 'exposure', 0.2, 4, 0.01).onChange(applyLighting);
fCam.add(state, 'autoExposure').name('auto exposure').onChange(applyLighting);
fCam.add({ view: q.get('view') ?? 'nave' }, 'view', Object.keys(VIEWS)).onChange(setView);
const fNav = gui.addFolder('Navigation');
fNav.add(nav, 'pan', 0.25, 8, 0.05).name('pan speed').onChange(() => setFast(fastNow));
fNav.add(nav, 'walk', 1, 20, 0.5).name('walk speed (m/s)');
fAir.close(); fCam.close();
if (q.get('ui') === '0') { gui.hide(); document.getElementById('bar').style.display = 'none'; document.getElementById('hint').style.display = 'none'; }
else if (window.innerWidth < 700) gui.close();

// --- camera shots -----------------------------------------------------------------
// One click flies the camera to a composed view; a shot may also set the time of day or start the
// day running. The fly-through eases over ~1.4 s and yields to the mouse the moment it is touched.
const SHOTS = [
  { id: 'light', label: 'Light show', pos: [-17.5, 2.3, 2.6], look: [14, 7.5, -0.4], time: 7.2, play: true, tip: 'Wide view down the nave with the day running' },
  { id: 'angel', label: 'Angel', pos: [13.2, 3.4, 2.4], look: [21.7, 6.1, 0], time: 15.3, tip: 'The marble angel in afternoon light' },
  { id: 'nun', label: 'Nun', pos: [14.85, 1.4, 0.8], look: [13.62, 0.95, 0], time: 16.2, tip: 'The praying girl before the altar' },
  { id: 'windows', label: 'Windows', pos: [-3, 5.5, -5.6], look: [4, 12.5, 8], time: 9.4, tip: 'The wall of cat windows, glowing against the morning sky' },
  { id: 'rose', label: 'Rose window', pos: [5, 2.6, 0], look: [24, 17.5, 0], time: 9.3, tip: 'The altar rose and lancets with morning shafts crossing in front' },
  { id: 'floor', label: 'Floor', pos: [-6, 9.5, -5.6], look: [6, 0, 3], time: 14.4, tip: 'The coloured light on the floor, from above' },
];
let flight = null;
function flyTo(shot) {
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  flight = { p0, t0, p1: new THREE.Vector3(...shot.pos), t1: new THREE.Vector3(...shot.look), start: performance.now(), dur: q.has('instant') ? 1 : 1400 };
  if (shot.time != null) { state.time = shot.time; }
  state.playing = !!shot.play;
  if (shot.play) state.speed = Math.max(state.speed, 0.6);
  syncPlay(); applyLighting(); gui.controllersRecursive().forEach((c) => c.updateDisplay());
  for (const b of shotsEl.children) b.setAttribute('aria-pressed', String(b.dataset.id === shot.id));
}
const cancelFlight = () => { flight = null; };
canvas.addEventListener('pointerdown', cancelFlight);
canvas.addEventListener('wheel', cancelFlight, { passive: true });
const shotsEl = document.getElementById('shots');
for (const shot of SHOTS) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = shot.label; b.title = shot.tip; b.dataset.id = shot.id; b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => flyTo(shot));
  shotsEl.appendChild(b);
}
if (q.get('ui') === '0') shotsEl.style.display = 'none';
if (q.has('shot')) { const sh = SHOTS.find((x) => x.id === q.get('shot')); if (sh) flyTo(sh); }

// --- music ---------------------------------------------------------------------
// Browsers only allow audio after a user gesture, so it starts on the first
// click / key press unless the visitor has switched it off.
const music = new Audio('./audio/heavenly.mp3');
music.loop = true;
music.preload = 'none';
const musicState = { on: q.get('music') !== '0', volume: num('vol', 0.5) };
const musicBtn = document.getElementById('music');
function syncMusic() {
  music.volume = musicState.volume;
  if (musicState.on) music.play().catch(() => {}); else music.pause();
  musicBtn.textContent = musicState.on ? 'Music: on' : 'Music: off';
  musicBtn.setAttribute('aria-pressed', String(musicState.on));
}
musicBtn.addEventListener('click', (e) => { e.stopPropagation(); musicState.on = !musicState.on; syncMusic(); });
const firstGesture = () => { syncMusic(); window.removeEventListener('pointerdown', firstGesture); window.removeEventListener('keydown', firstGesture); };
window.addEventListener('pointerdown', firstGesture);
window.addEventListener('keydown', firstGesture);
musicBtn.textContent = musicState.on ? 'Music: on' : 'Music: off';
gui.add(musicState, 'volume', 0, 1, 0.01).name('music volume').onChange(syncMusic);

// --- swappable glass art ---------------------------------------------------------
// public/glass/manifest.json lists picture sets; a set maps slot ids (layout.js
// groups: right-1..6, left-1..6, altar-lancets, altar-rose, entrance-lancets,
// entrance-rose) to image files. "side" is a list cycled over the 12 side bays.
const loadImage = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('cannot load ' + src)); im.src = src; });
function repaint(walls = WALLS) {
  for (const w of walls) { const i = WALLS.indexOf(w); paintWall(w, ppm, glassImages, textures[i].image); textures[i].needsUpdate = true; }
}
let manifest = { sets: {} };
async function applyArtSet(name) {
  glassImages.clear();
  const set = manifest.sets[name];
  if (set) {
    const slots = set.slots ?? {};
    const side = slots.side ?? [];
    const jobs = [];
    for (const w of WALLS) for (const g of w.groups) {
      let file = slots[g.id];
      const m = /^(right|left)-(\d+)$/.exec(g.id);
      if (!file && m && side.length) file = side[(Number(m[2]) - 1 + (m[1] === 'left' ? Math.ceil(side.length / 2) : 0)) % side.length];
      if (file) jobs.push(loadImage('./glass/' + file).then((im) => glassImages.set(g.id, im), (e) => console.warn(e.message)));
    }
    await Promise.all(jobs);
  }
  repaint();
}
const artCtl = { set: 'procedural' };
const fArt = gui.addFolder('Glass art');
let artDropdown = fArt.add(artCtl, 'set', ['procedural']).name('art set').onChange(applyArtSet);
fArt.add({ hint() {} }, 'hint').name('tip: drop an image on a window').disable();
fetch('./glass/manifest.json').then((r) => (r.ok ? r.json() : manifest)).then((m) => {
  manifest = m?.sets ? m : { sets: {} };
  const names = Object.keys(manifest.sets);
  artDropdown = artDropdown.options(['procedural', ...names]).name('art set').onChange(applyArtSet);
  const want = state.art === 'auto' ? (m.default ?? names[0]) : state.art;
  if (want && manifest.sets[want]) { artCtl.set = want; artDropdown.updateDisplay(); return applyArtSet(want); }
}).catch((e) => console.warn('glass manifest:', e.message)).finally(() => { window.__artReady = true; });

// Which image slot (window group) is under a screen point?
const raycaster = new THREE.Raycaster();
raycaster.layers.set(1);
function slotAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = raycaster.intersectObjects(group.children.filter((m) => m.name.startsWith('glass-')), false)[0];
  if (!hit) return null;
  const wall = WALLS.find((w) => 'glass-' + w.name === hit.object.name);
  const u = wall.band.u0 + hit.uv.x * wall.band.w, v = wall.band.v0 + hit.uv.y * wall.band.h;
  let best = null, bd = Infinity;
  for (const g of wall.groups) {
    const dx = Math.max(g.rect.u0 - u, 0, u - g.rect.u1), dy = Math.max(g.rect.v0 - v, 0, v - g.rect.v1);
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = g; }
  }
  return best && { wall, group: best };
}
async function setSlotImage(slotId, src) {
  const wall = WALLS.find((w) => w.groups.some((g) => g.id === slotId));
  if (!wall) throw new Error('unknown slot ' + slotId);
  if (src) glassImages.set(slotId, await loadImage(src)); else glassImages.delete(slotId);
  repaint([wall]);
}
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
  const slot = file && slotAt(e.clientX, e.clientY);
  if (!slot) return;
  const url = URL.createObjectURL(file);
  try { await setSlotImage(slot.group.id, url); } finally { URL.revokeObjectURL(url); }
});

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
  // time-driven effects: drifting haze and dust, candle flicker
  const tsec = q.has('freeze') ? num('freeze', 0) : now / 1000;
  lightU.uTime.value = tsec;
  const fl = 0.82 + 0.1 * Math.sin(tsec * 9.1) + 0.06 * Math.sin(tsec * 23.7 + 1.3) + 0.05 * Math.sin(tsec * 4.3 + 0.4) + 0.04 * Math.sin(tsec * 51.0);
  lightU.uCandleColor.value.setRGB(0.5, 0.26, 0.08).multiplyScalar(state.candles * fl);
  materials.flame.uniforms.uEmissive.value.setRGB(9, 4.2, 1.1).multiplyScalar(Math.min(state.candles, 1) * (0.75 + 0.3 * fl));
  dust.material.uniforms.uPixelsPerRad.value = renderer.domElement.height / THREE.MathUtils.degToRad(camera.fov);
  walk(dt);
  if (flight) {
    const k = Math.min(1, (now - flight.start) / flight.dur), e = k * k * (3 - 2 * k);
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    controls.target.lerpVectors(flight.t0, flight.t1, e);
    if (k >= 1) flight = null;
  }
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
window.__sg = { state, applyLighting, setView, camera, controls, pipeline, lightU, renderer, setSlotImage, applyArtSet, slotAt, dust };
