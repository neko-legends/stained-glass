// Dust motes. They are only visible where the key light actually reaches
// them: each mote runs the same "shadow x glass" lookup as a surface point, so
// it sparkles in the colour of the glass it is drifting under.
#include_glass_light
attribute vec4 aSeed; // xyz: home position (0..1 in the box), w: per-mote random
attribute vec3 aVel;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform float uDustSize;     // metres (exaggerated; real dust is far smaller)
uniform float uPixelsPerRad; // viewport height / fov
uniform float uDustBrightness;
varying vec3 vCol;

void main() {
  float s = aSeed.w;
  vec3 home = fract(aSeed.xyz + aVel * uTime / uBoxSize);
  vec3 P = uBoxMin + home * uBoxSize;
  // lazy eddies
  P += 0.35 * vec3(sin(uTime * 0.11 + s * 51.0), 0.6 * sin(uTime * 0.07 + s * 23.0), cos(uTime * 0.09 + s * 37.0));

  vec3 col = vec3(0.0);
  if (dot(uLightColor, vec3(1.0)) > 1e-5) {
    float sh = sunShadow(P, vec3(0.0), 0.0, 0);
    if (sh > 0.0) col = uLightColor * sh * glassTransmit(P, 0.0, 0);
  }
  vec3 toP = P - cameraPosition;
  float dist = length(toP);
  float mu = clamp(dot(toP / dist, uLightDir), -1.0, 1.0);
  float phase = 0.55 + 2.2 * pow(max(mu, 0.0), 3.0);                  // flakes glint looking toward the light
  float twinkle = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * (1.2 + 3.0 * s) + s * 311.0), 4.0); // tumbling
  float ideal = uDustSize * (0.5 + s) * uPixelsPerRad / max(dist, 0.3);
  float size = clamp(ideal, 1.0, 7.0);
  float energy = min(1.0, (ideal * ideal) / (size * size));           // sub-pixel motes dim instead of vanishing
  float nearFade = smoothstep(0.3, 1.2, dist);
  vCol = col * phase * twinkle * energy * nearFade * uDustBrightness;
  gl_PointSize = size;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
