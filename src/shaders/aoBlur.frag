// Depth-aware 4x4 blur that removes the AO sampling noise without bleeding
// across silhouettes.
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;

float linZ(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }

void main() {
  float z0 = linZ(texture(tDepth, vUv).r);
  float acc = 0.0, ws = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 uv = vUv + (vec2(float(x), float(y)) - 1.5) / uRes;
      float z = linZ(texture(tDepth, uv).r);
      float w = 1.0 / (1.0 + abs(z - z0) / (0.02 * z0 + 0.01) * 4.0);
      acc += texture(tAO, uv).r * w;
      ws += w;
    }
  }
  gl_FragColor = vec4(vec3(acc / ws), 1.0);
}
