// Radiosity of the floor: how much coloured sunlight each patch of floor
// throws back into the room. Rendered into a tiny mip-mapped texture whenever
// the light moves; surfaces look it up for one-bounce indirect light.
#include_glass_light
uniform vec2 uFloorMin;
uniform vec2 uFloorSize;
uniform vec2 uTexel; // floor metres per texel
uniform float uFloorAlbedo;
varying vec2 vUv;

void main() {
  vec3 acc = vec3(0.0);
  if (uLightDir.y > 0.0 && dot(uLightColor, vec3(1.0)) > 1e-5) {
    for (int i = 0; i < 4; i++) {
      vec2 o = (vec2(float(i & 1), float(i >> 1)) - 0.5) * 0.5 * uTexel;
      vec3 P = vec3(uFloorMin.x + vUv.x * uFloorSize.x + o.x, 0.03, uFloorMin.y + vUv.y * uFloorSize.y + o.y);
      float sh = sunShadow(P, vec3(0.0, 1.0, 0.0), 0.0, 0);
      if (sh > 0.0) acc += glassTransmit(P, 0.0, 0) * sh;
    }
  }
  gl_FragColor = vec4(uLightColor * uLightDir.y * uFloorAlbedo * acc * 0.25, 1.0);
}
