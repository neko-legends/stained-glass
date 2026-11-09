// The window itself, seen from inside: glass transmittance lit from behind.
#include_glass_light
uniform sampler2D uTex;
uniform vec3 uNIn;
uniform vec3 uAmbient;
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  vec3 T = texture(uTex, vUv).rgb;
  vec3 toEye = normalize(cameraPosition - vWorldPos);
  vec3 col;
  if (dot(toEye, uNIn) > 0.0) {
    col = glassRadiance(T, toEye, uNIn);
    // lead and iron catch a little of the room light
    col += uAmbient * 0.04;
  } else {
    col = T * 0.03 + uSkyColor * 0.05; // from outside: dark, slightly reflective
  }
  col = mix(vec3(0.0), clamp(col, 0.0, 400.0), vec3(equal(col, col)));
  gl_FragColor = vec4(col, 1.0);
}
