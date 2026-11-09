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
uniform vec3 uCamPos;
varying vec2 vUv;

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
      if (sh > 0.0) acc += glassTransmit(P, 0.0, 0) * (sh * exp(-uDensity * t));
    }
  }
  gl_FragColor = vec4(acc * dt * uDensity * phase * uLightColor * 4.0 * PI, dist);
}
