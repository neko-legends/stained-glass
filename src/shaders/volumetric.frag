// God rays: single scattering of the key light in dusty air, ray-marched from
// the camera to the first surface. Each sample asks the same question as a
// surface point: "is the sun visible from here, and through which glass?"
#include_glass_light
uniform sampler2D tDepth;
uniform mat4 uInvViewProj;
uniform float uDensity;   // scattering coefficient, 1/m
uniform float uAniso;     // Henyey-Greenstein g
uniform float uMaxDist;
uniform float uFrame;
uniform float uHazeVariation; // 0 = uniform air, 1 = drifting patches of thicker dust
uniform vec3 uCamPos;
varying vec2 vUv;

float h3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Slowly drifting, slightly rising curls of denser air (incense, stirred dust).
float hazeDensity(vec3 P) {
  vec3 q = P * vec3(0.16, 0.22, 0.16) + vec3(uTime * 0.012, -uTime * 0.02, uTime * 0.008);
  float n = noise3(q) * 0.65 + noise3(q * 2.7 + 5.0) * 0.35;
  return mix(1.0, 0.25 + 1.5 * n * n * 1.6, uHazeVariation);
}

#ifndef VOL_STEPS
#define VOL_STEPS 48
#endif

void main() {
  float d = texture(tDepth, vUv).r;
  vec4 w = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 ray = w.xyz / w.w - uCamPos;
  float dist = length(ray);
  vec3 dir = ray / dist;
  float len = min(dist, uMaxDist);

  float mu = dot(dir, uLightDir);
  float g = uAniso;
  float hg = (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
  float phase = mix(1.0 / (4.0 * PI), min(hg, 0.35), 0.6);

  float j = ign(gl_FragCoord.xy + uFrame * 5.588);
  float dt = len / float(VOL_STEPS);
  vec3 acc = vec3(0.0);
  if (dot(uLightColor, vec3(1.0)) > 1e-5) {
    for (int i = 0; i < VOL_STEPS; i++) {
      float t = (float(i) + j) * dt;
      vec3 P = uCamPos + dir * t;
      float sh = sunShadow(P, vec3(0.0), 0.0, 0);
      if (sh > 0.0) acc += glassTransmit(P, 0.0, 0) * (sh * exp(-uDensity * t) * hazeDensity(P));
    }
  }
  gl_FragColor = vec4(acc * dt * uDensity * phase * uLightColor * 4.0 * PI, dist);
}
