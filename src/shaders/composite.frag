// Scene + god rays. The half-res ray-march is noisy by design (one jittered
// sample set per pixel); a depth-aware 4x4 bilinear filter resolves it.
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tVol;
uniform vec2 uVolTexel;
uniform mat4 uInvViewProj;
uniform float uDensity;
uniform vec3 uFogColor;
uniform float uVolStrength;
uniform vec3 uCamPos;
varying vec2 vUv;

void main() {
  vec3 scene = texture(tScene, vUv).rgb;
  float d = texture(tDepth, vUv).r;
  vec4 w = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  float dist = length(w.xyz / w.w - uCamPos);

  vec3 vol = vec3(0.0);
  float ws = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 o = vec2(float(x), float(y)) - 1.5;
      vec4 v = texture(tVol, vUv + o * uVolTexel);
      float wgt = exp(-dot(o, o) * 0.22) / (0.02 + abs(v.a - dist) / max(dist, 0.1));
      vol += v.rgb * wgt;
      ws += wgt;
    }
  }
  vol /= ws;

  float ext = exp(-uDensity * 0.6 * min(dist, 120.0));
  vec3 col = scene * ext + uFogColor * (1.0 - ext) + vol * uVolStrength;
  gl_FragColor = vec4(col, 1.0);
}
