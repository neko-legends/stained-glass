// Lit surface (stone, floor, wood, gilding, marble) receiving stained-glass light.
#include_glass_light

uniform vec3 uColor;
uniform float uRough;
uniform float uMetal;
uniform int uPattern;      // 0 plain, 1 ashlar masonry, 2 floor slabs, 3 wood, 4 marble, 5 textured (uMap)
uniform sampler2D uMap;
uniform float uWrap;       // 0 = Lambert; > 0 lets light bleed past the terminator (marble)
uniform float uTranslucency; // light passing through thin parts (marble wings, fingers)
uniform float uToon;         // 1 = anime shading: flat fill, two-tone key light, no speculars
uniform float uToonFill;     // flat fill level for toon surfaces (set per frame to stay constant on screen)
uniform float uFloorPolish;
uniform float uBump;
uniform vec3 uAmbient;
uniform vec3 uBounce;
uniform float uGlowStrength;
uniform float uReflStrength;
uniform vec3 uCandlePos;
uniform vec3 uCandleColor;
uniform vec3 uEmissive;

uniform sampler2D uAO;          // screen-space ambient occlusion
uniform vec2 uInvRes;
uniform float uAOStrength;
uniform sampler2D uBounceMap;   // floor radiosity (see bounce.frag)
uniform vec2 uFloorMin;
uniform vec2 uFloorSize;
uniform float uBounceTexel;     // floor metres per texel
uniform float uBounceStrength;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

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

// Joint line that stays stable when it gets thinner than a pixel: widen the
// edge by the pixel footprint and fade its contrast by the same amount, so
// distant joints dim smoothly instead of shimmering as the camera moves.
float jointMask(float edge, float width, vec2 q) {
  float fw = max(length(dFdx(q)), length(dFdy(q)));
  float m = smoothstep(0.0, width + fw, edge);
  return mix(1.0, m, clamp(width / (width + fw * 1.5), 0.0, 1.0));
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

// Perturb the normal from a height field (metres) using screen derivatives.
vec3 bumpNormal(vec3 P, vec3 N, float h) {
  vec3 dpx = dFdx(P), dpy = dFdy(P);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (hx * r1 + hy * r2);
  float foot = max(length(dpx), length(dpy));
  vec3 n = abs(det) * N - g * uBump * clamp(0.03 / (foot + 1e-5), 0.0, 1.0);
  return dot(n, n) > 1e-16 ? normalize(n) : N;
}

// One-bounce light from the sunlit floor. A patch of floor seen from height h
// subtends a footprint ~2h wide, so a mip of that size is the right average.
vec3 floorBounce(vec3 P, vec3 N) {
  float h = max(P.y, 0.05);
  vec2 q = P.xz + N.xz * h * 0.8;
  vec2 uv = clamp((q - uFloorMin) / uFloorSize, 0.0, 1.0);
  float lod = log2(max(h * 1.8 / uBounceTexel, 1.0));
  return textureLod(uBounceMap, uv, lod).rgb * (0.5 - 0.5 * N.y);
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
  float height = 0.0; // relief in metres, turned into a normal below

  if (uPattern == 1) {
    vec3 an = abs(N);
    vec2 q = an.y > 0.75 ? P.xz : (an.x > an.z ? P.zy : P.xy);
    vec2 b = blocks(q, vec2(0.92, 0.46));
    // weathered arrises: some edges have lost chips
    float chip = max(fbm(q * 5.0) - 0.56, 0.0) * 0.09;
    float edge = b.x - chip;
    float mortar = jointMask(edge, 0.014, q);
    float grain = fbm(q * 3.0) * 0.5 + fbm(q * 19.0) * 0.25;
    float grime = fbm(q * 0.22 + 4.0);
    albedo *= (0.78 + 0.34 * b.y) * (0.82 + 0.36 * grain) * mix(0.5, 1.0, mortar);
    albedo *= mix(0.72, 1.06, grime);
    // old stone darkens toward the floor
    albedo *= mix(0.82, 1.0, smoothstep(0.0, 3.0, P.y));
    rough = clamp(uRough - 0.12 * b.y + 0.1 * grime, 0.3, 1.0);
    height = smoothstep(0.0, 0.035, edge) * (0.014 + 0.008 * b.y) + 0.006 * fbm(q * 7.0);
  } else if (uPattern == 2) {
    vec2 b = blocks(P.xz, vec2(1.7, 1.25));
    float chip = max(fbm(P.xz * 4.0) - 0.6, 0.0) * 0.07;
    float edge = b.x - chip;
    float joint = jointMask(edge, 0.018, P.xz);
    float wear = fbm(P.xz * 0.35);
    float path = exp(-P.z * P.z / 7.0);           // centuries of feet down the middle
    float grain = fbm(P.xz * 2.5) * 0.6 + fbm(P.xz * 14.0) * 0.3;
    albedo *= (0.72 + 0.4 * b.y) * (0.75 + 0.4 * grain) * mix(0.45, 1.0, joint) * (1.0 + 0.1 * path);
    rough = mix(0.5, 0.05, uFloorPolish) + 0.04 * grain + 0.03 * b.y;
    rough = mix(0.8, rough * mix(1.25, 0.8, wear) * mix(1.1, 0.8, path), joint);
    specOcc = mix(0.3, 1.0, joint);
    // slabs dip toward their joints and are gently dished by wear
    height = smoothstep(0.0, 0.05, edge) * 0.006 + 0.012 * fbm(P.xz * 0.8);
  } else if (uPattern == 3) {
    vec3 an = abs(N);
    vec2 q = an.y > 0.75 ? P.xz : (an.x > an.z ? P.zy : P.xy);
    float g = fbm(vec2(q.x * 14.0, q.y * 0.8));
    albedo *= 0.7 + 0.5 * g;
    height = 0.004 * g + 0.004 * smoothstep(0.0, 0.02, abs(fract(q.x * 2.2) - 0.5));
  } else if (uPattern == 4) {
    // polished white marble: soft grey veins warped by noise
    vec2 q = P.xy * 0.7 + vec2(P.z * 0.6, -P.z * 0.4);
    float warp = fbm(q * 1.4 + 3.7);
    float v = abs(sin((q.x * 0.9 + q.y * 1.7 + warp * 5.5) * 1.8));
    float vein = smoothstep(0.3, 0.0, v) * (0.25 + 0.75 * fbm(q * 2.0));
    float cloud = fbm(q * 0.8 + 11.0);
    albedo *= (0.92 + 0.12 * cloud) * (1.0 - 0.13 * vein);
    albedo = mix(albedo, albedo * vec3(0.93, 0.95, 1.0), vein);
    rough = clamp(uRough + 0.12 * vein, 0.05, 1.0);
  } else if (uPattern == 5) {
    albedo *= texture(uMap, vUv).rgb;
  } else {
    float g = fbm(P.xy * 4.0 + P.z * 3.1);
    albedo *= 0.88 + 0.24 * g;
    height = 0.003 * g;
  }
  rough = clamp(rough, 0.05, 1.0);
  if (uBump > 0.0 && height != 0.0) N = bumpNormal(P, N, height);

  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float ao = pow(texture(uAO, gl_FragCoord.xy * uInvRes).r, uAOStrength);

  // --- key light through the glass ---------------------------------------
  vec3 L = uLightDir;
  float ndl = dot(N, L);
  float ndlW = max((ndl + uWrap) / (1.0 + uWrap), 0.0);
  bool lightOn = dot(uLightColor, vec3(1.0)) > 1e-5;
  vec3 sunE = vec3(0.0);
  if ((ndlW > 0.0 || uToon > 0.5) && lightOn) {
    float sh = sunShadow(P, N, rot, 1);
    if (sh > 0.0) sunE = uLightColor * sh * glassTransmit(P, 0.7, 1);
  }

  // Translucency: light that entered the far side and crossed a thin part.
  // The sun depth map tells us how much solid lies between this point and
  // the light, which is exactly the thickness the light had to cross.
  vec3 through = vec3(0.0);
  if (uTranslucency > 0.0 && lightOn) {
    vec4 sc = uShadowMatrix * vec4(P - N * 0.02, 1.0);
    float thick = max(sc.z - texture(uShadowMap, sc.xy).r, 0.0) * uShadowRange;
    float tr = exp(-thick / 0.16) * smoothstep(0.25, -0.35, ndl);
    if (tr > 0.003) through = uLightColor * glassTransmit(P, 0.7, 0) * tr * uTranslucency * vec3(1.0, 0.84, 0.68);
  }

  // --- soft light ---------------------------------------------------------
  vec3 glow = glassGlow(P, N) * uGlowStrength;
  vec3 amb = uAmbient * (0.7 + 0.3 * N.y) + uBounce * (0.6 - 0.4 * N.y);
  vec3 bounce = floorBounce(P, N) * uBounceStrength;
  vec3 Lc = uCandlePos - P;
  float d2 = dot(Lc, Lc);
  vec3 candle = uCandleColor * max(dot(N, Lc * inversesqrt(d2)), 0.0) / (1.0 + 0.06 * d2);
  vec3 indirect = (glow + amb + bounce) * ao + candle * mix(1.0, ao, 0.6);

  vec3 diffuse = albedo * (1.0 - uMetal) * (sunE * ndlW + through + indirect);

  // --- specular -----------------------------------------------------------
  vec3 F0 = mix(vec3(0.04), albedo, uMetal);
  float nv = clamp(dot(N, V), 1e-3, 1.0); // > 1 by rounding would make pow() below return NaN
  vec3 F = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - nv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 env = glassReflection(P, R, rough, 0.3) * uReflStrength;
  env += (amb + glow + bounce) * mix(0.25, 0.6, uMetal);      // the dim stone around the windows
  vec3 spec = F * env * specOcc * mix(1.0, ao, 0.8);

  // sun glint (GGX)
  vec3 Hh = L + V;
  Hh = dot(Hh, Hh) > 1e-12 ? normalize(Hh) : N;
  float nh = clamp(dot(N, Hh), 0.0, 1.0);
  float a2 = rough * rough; a2 *= a2;
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / max(PI * dd * dd, 1e-7);
  spec += sunE * max(ndl, 0.0) * F * min(D * 0.25, 4.0) * specOcc;

  vec3 col = diffuse + spec + uEmissive;
  if (uToon > 0.5) {
    // Anime figure: the drawing's own colors carry the form, so light it almost flat. The key light
    // gives a soft two-tone step, tinted only partly by the glass; indirect light is desaturated and
    // barely occluded; a constant fill keeps her readable at any time of day.
    const vec3 LUMA = vec3(0.3, 0.55, 0.15);
    float band = smoothstep(-0.3, 0.3, ndl);
    vec3 key = mix(vec3(dot(sunE, LUMA)), sunE, 0.5) * (0.45 + 0.55 * band) * 0.42;
    // indirect light must not depend on the surface normal, or a tilted face goes grey under its
    // own chin: light every point as if it faced the viewer and slightly up
    vec3 Nt = normalize(V + vec3(0.0, 0.6, 0.0));
    vec3 ind = glassGlow(P, Nt) * uGlowStrength + uAmbient + floorBounce(P, vec3(0.0)) * uBounceStrength;
    ind = ind * mix(1.0, ao, 0.2) + candle * 0.6;
    ind = mix(vec3(dot(ind, LUMA)), ind, 0.55);
    col = albedo * (key + ind + uToonFill) + uEmissive;
  }
  // one NaN pixel would be smeared over the whole frame by the bloom blur
  col = mix(vec3(0.0), clamp(col, 0.0, 400.0), vec3(equal(col, col)));
  gl_FragColor = vec4(col, 1.0);
}
