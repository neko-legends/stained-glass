// Sun / moon ephemeris (simplified) and atmosphere colour model.
// Output frame: +X = east, +Y = up, +Z = south (compass). main.js rotates the
// result into the building's frame according to which way the altar faces.
import * as THREE from 'three';

const DEG = Math.PI / 180;

function equatorialToWorld(hourAngle, decl, lat, out) {
  const sl = Math.sin(lat), cl = Math.cos(lat);
  const sd = Math.sin(decl), cd = Math.cos(decl);
  const east = -cd * Math.sin(hourAngle);
  const north = cl * sd - sl * cd * Math.cos(hourAngle);
  const up = sl * sd + cl * cd * Math.cos(hourAngle);
  return out.set(east, up, -north).normalize();
}

// Kasten-Young relative air mass for an altitude given as sin(alt).
function airMass(sinAlt) {
  const altDeg = Math.asin(THREE.MathUtils.clamp(sinAlt, -1, 1)) / DEG;
  const a = Math.max(altDeg, -1.0);
  return 1.0 / (Math.max(sinAlt, 0.0) + 0.50572 * Math.pow(a + 6.07995, -1.6364));
}

const TAU = new THREE.Vector3(0.09, 0.16, 0.34); // per-airmass optical depth, RGB
const smooth = THREE.MathUtils.smoothstep;

const sunDir = new THREE.Vector3();
const moonDir = new THREE.Vector3();

/**
 * @param {number} hours     local solar time, 0..24
 * @param {number} dayOfYear 1..365
 * @param {number} latDeg    latitude in degrees
 */
export function computeSky(hours, dayOfYear, latDeg) {
  const lat = latDeg * DEG;
  const decl = 23.44 * DEG * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 365);
  const h = (hours - 12) * 15 * DEG;

  equatorialToWorld(h, decl, lat, sunDir);
  // A full moon sits opposite the sun: 12 h later, mirrored declination.
  equatorialToWorld(h + Math.PI, -decl, lat, moonDir);

  const sunAlt = sunDir.y;
  const moonAlt = moonDir.y;
  const isSun = sunAlt >= moonAlt;
  const dir = (isSun ? sunDir : moonDir).clone();
  const alt = dir.y;

  // Direct beam: extinction through the atmosphere reddens it near the horizon.
  const m = airMass(alt);
  const ext = new THREE.Vector3(Math.exp(-TAU.x * m), Math.exp(-TAU.y * m), Math.exp(-TAU.z * m));
  const horizonFade = smooth(alt, -0.015, 0.06);
  const color = new THREE.Color();
  if (isSun) color.setRGB(ext.x, ext.y, ext.z).multiplyScalar(horizonFade);
  // Moonlight is sunlight off grey rock: physically near-white (even slightly warm). It only looks
  // blue to a dark-adapted eye, and film exaggerates that. Keep it pale with a faint cool cast.
  else color.setRGB(0.9 * ext.x, 0.93 * ext.y, 1.0 * ext.z).multiplyScalar(horizonFade);

  // Sky radiance seen through the glass.
  const day = smooth(sunAlt, -0.12, 0.25);
  const twilight = Math.exp(-Math.pow(sunAlt / 0.16, 2));
  const moonUp = smooth(moonAlt, -0.05, 0.3) * (1 - day);
  const sky = new THREE.Color(0.30, 0.52, 1.0).multiplyScalar(0.02 + 0.98 * day);
  sky.r += 0.55 * twilight * (0.25 + 0.75 * day) + 0.004 * moonUp;
  sky.g += 0.22 * twilight * (0.25 + 0.75 * day) + 0.006 * moonUp;
  sky.b += 0.10 * twilight * (0.25 + 0.75 * day) + 0.012 * moonUp;

  return {
    dir,            // unit vector pointing TOWARD the key light
    isSun,
    color,          // key light colour (0..1), multiply by intensity
    sky,            // sky radiance colour
    day,            // 0 night .. 1 day
    sunAlt, moonAlt,
    sunDir: sunDir.clone(),
    moonDir: moonDir.clone(),
  };
}
