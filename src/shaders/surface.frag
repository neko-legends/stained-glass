// Lit surface (stone, floor, wood, gilding) receiving stained-glass light.
#include_glass_light

uniform vec3 uColor;
uniform float uRough;
uniform float uMetal;
uniform int uPattern;      // 0 plain, 1 ashlar masonry, 2 floor slabs, 3 wood, 4 marble
uniform float uWrap;       // 0 = Lambert; > 0 lets light bleed past the terminator (marble)
uniform float uFloorPolish;
uniform vec3 uAmbient;
uniform vec3 uBounce;
uniform float uGlowStrength;
uniform float uReflStrength;
uniform vec3 uCandlePos;
uniform vec3 uCandleColor;
uniform vec3 uEmissive;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

// Brick-bond block pattern. Returns (edge distance, block id).
vec2 blocks(vec2 p, vec2 size) {
  float row = floor(p.y / size.y);
  p.x += mod(row, 2.0) * size.x * 0.5 + hash21(vec2(row, 7.0)) * size.x * 0.3;
  vec2 cell = floor(p / size);
  vec2 f = fract(p / size);
  vec2 e = min(f, 1.0 - f) * size;
  return vec2(min(e.x, e.y), hash21(cell + 0.5));
}

void main() {
  vec3 P = vWorldPos;
  // degenerate triangles can carry a zero normal; normalize() would give NaN
  vec3 N = dot(vWorldNormal, vWorldNormal) > 1e-12 ? normalize(vWorldNormal) : vec3(0.0, 1.0, 0.0);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - P);

  vec3 albedo = uColor;
  float rough = uRough;
  float specOcc = 1.0;

  if (uPattern == 1) {
    vec3 an = abs(N);
    vec2 q = an.y > 0.75 ? P.xz : (an.x > an.z ? P.zy : P.xy);
    vec2 b = blocks(q, vec2(0.92, 0.46));
    float mortar = smoothstep(0.0, 0.014, b.x);
    float grain = fbm(q * 3.0) * 0.5 + fbm(q * 19.0) * 0.25;
    albedo *= (0.78 + 0.34 * b.y) * (0.82 + 0.36 * grain) * mix(0.55, 1.0, mortar);
    // old stone darkens toward the floor and in the vault
    albedo *= mix(0.86, 1.0, smoothstep(0.0, 3.0, P.y));
  } else if (uPattern == 2) {
    vec2 b = blocks(P.xz, vec2(1.7, 1.25));
    float joint = smoothstep(0.0, 0.018, b.x);
    float wear = fbm(P.xz * 0.35);
    float grain = fbm(P.xz * 2.5) * 0.6 + fbm(P.xz * 14.0) * 0.3;
    albedo *= (0.72 + 0.4 * b.y) * (0.75 + 0.4 * grain) * mix(0.45, 1.0, joint);
    rough = mix(0.5, 0.05, uFloorPolish) + 0.04 * grain + 0.03 * b.y;
    rough = mix(0.8, rough * mix(1.25, 0.8, wear), joint);
    specOcc = mix(0.3, 1.0, joint);
    // slabs are not perfectly flat: tilt the normal a little per slab
    vec2 tilt = (vec2(hash21(vec2(b.y, 1.7)), hash21(vec2(b.y, 9.2))) - 0.5) * 0.012;
    N = normalize(N + vec3(tilt.x, 0.0, tilt.y));
  } else if (uPattern == 3) {
    vec3 an = abs(N);
    vec2 q = an.y > 0.75 ? P.xz : (an.x > an.z ? P.zy : P.xy);
    float g = fbm(vec2(q.x * 14.0, q.y * 0.8));
    albedo *= 0.7 + 0.5 * g;
  } else if (uPattern == 4) {
    // polished white marble: soft grey veins warped by noise
    vec2 q = P.xy * 1.6 + vec2(P.z * 1.3, -P.z * 0.9);
    float warp = fbm(q * 1.4 + 3.7);
    float v = abs(sin((q.x * 0.9 + q.y * 1.7 + warp * 5.5) * 1.8));
    float vein = smoothstep(0.12, 0.0, v) * (0.35 + 0.65 * fbm(q * 3.0));
    float cloud = fbm(q * 0.8 + 11.0);
    albedo *= (0.9 + 0.14 * cloud) * (1.0 - 0.26 * vein);
    albedo = mix(albedo, albedo * vec3(0.93, 0.95, 1.0), vein);
    rough = clamp(uRough + 0.12 * vein, 0.05, 1.0);
  } else {
    albedo *= 0.88 + 0.24 * fbm(P.xy * 4.0 + P.z * 3.1);
  }
  rough = clamp(rough, 0.05, 1.0);

  float rot = ign(gl_FragCoord.xy) * 6.2831853;

  // --- key light through the glass ---------------------------------------
  vec3 L = uLightDir;
  float ndl = dot(N, L);
  float ndlW = max((ndl + uWrap) / (1.0 + uWrap), 0.0);
  vec3 sunE = vec3(0.0);
  if (ndlW > 0.0 && dot(uLightColor, vec3(1.0)) > 1e-5) {
    float sh = sunShadow(P, N, rot, 1);
    if (sh > 0.0) sunE = uLightColor * sh * glassTransmit(P, 0.7, 1);
  }

  // --- soft light ---------------------------------------------------------
  vec3 glow = glassGlow(P, N) * uGlowStrength;
  vec3 amb = uAmbient * (0.7 + 0.3 * N.y) + uBounce * (0.6 - 0.4 * N.y);
  vec3 Lc = uCandlePos - P;
  float d2 = dot(Lc, Lc);
  vec3 candle = uCandleColor * max(dot(N, Lc * inversesqrt(d2)), 0.0) / (1.0 + 0.06 * d2);

  vec3 diffuse = albedo * (1.0 - uMetal) * (sunE * ndlW + glow + amb + candle);

  // --- specular -----------------------------------------------------------
  vec3 F0 = mix(vec3(0.04), albedo, uMetal);
  float nv = clamp(dot(N, V), 1e-3, 1.0); // > 1 by rounding would make pow() below return NaN
  vec3 F = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - nv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 env = glassReflection(P, R, rough, 0.3) * uReflStrength;
  env += (amb + glow) * mix(0.25, 0.6, uMetal);      // the dim stone around the windows
  vec3 spec = F * env * specOcc;

  // sun glint (GGX)
  vec3 Hh = L + V;
  Hh = dot(Hh, Hh) > 1e-12 ? normalize(Hh) : N;
  float nh = clamp(dot(N, Hh), 0.0, 1.0);
  float a2 = rough * rough; a2 *= a2;
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / max(PI * dd * dd, 1e-7);
  spec += sunE * max(ndl, 0.0) * F * min(D * 0.25, 4.0) * specOcc;

  vec3 col = diffuse + spec + uEmissive;
  // one NaN pixel would be smeared over the whole frame by the bloom blur
  col = mix(vec3(0.0), clamp(col, 0.0, 400.0), vec3(equal(col, col)));
  gl_FragColor = vec4(col, 1.0);
}
