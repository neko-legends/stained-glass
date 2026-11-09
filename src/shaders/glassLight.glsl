// ---------------------------------------------------------------------------
// Stained-glass light transport — shared by the surface shader, the glass
// shader and the volumetric pass. This is the part that ports to Unity/HLSL.
//
// Every window wall is a "pane": a world-space rectangle with a texture that
// stores the RGB transmittance of the glass (lead / stone = 0).
//
//   light reaching P  =  E_sun * shadow(P) * PROD_panes T_pane(hit(P, L))
//
// The hit point is found analytically (ray-plane), so the projected image is
// exact at any distance — no projector or shadow-map resolution involved. The
// sun is a disc, not a point: its angular diameter turns every point of glass
// into a cone, so the image is blurred by  t * spread  (t = distance from the
// glass). We get that blur for free from the mip chain + a small disc kernel.
// ---------------------------------------------------------------------------
#define PANE_COUNT 4

uniform sampler2D uPane0;
uniform sampler2D uPane1;
uniform sampler2D uPane2;
uniform sampler2D uPane3;
uniform vec4 uPanePlane[PANE_COUNT]; // xyz = normal pointing INTO the room, w: dot(n,p)+w = 0
uniform vec3 uPaneO[PANE_COUNT];     // lower-left corner
uniform vec3 uPaneU[PANE_COUNT];     // U / |U|^2  (so dot(p-O, U) = 0..1)
uniform vec3 uPaneV[PANE_COUNT];     // V / |V|^2
uniform float uPanePxPerM;           // texel density of the pane textures
uniform float uPaneMaxLod;

uniform vec3 uLightDir;      // unit, toward the sun / moon
uniform vec3 uLightColor;    // irradiance of the key light
uniform float uLightSpread;  // angular diameter of the light (radians) + glass diffusion
uniform vec3 uSkyColor;      // sky radiance behind the glass
uniform float uGlassScatter; // how much direct sun the glass scatters toward the viewer
uniform float uGlassRipple;  // strength of the mottling hand-blown glass puts in its projection
uniform float uTime;

uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;  // world -> shadow uv/depth (0..1)
uniform vec2 uShadowTexel;   // 1 / shadow map size
uniform float uShadowBias;
uniform float uShadowWorldTexel; // metres covered by one shadow texel
uniform float uShadowRange;      // metres between the shadow camera's near and far planes

const float PI = 3.14159265;

float ign(vec2 p) { // interleaved gradient noise
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float glHash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
float glNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(glHash(i), glHash(i + vec2(1.0, 0.0)), f.x),
             mix(glHash(i + vec2(0.0, 1.0)), glHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Intersect the ray P + t*D with pane i. Returns t (<0 = miss) and uv.
float paneHit(int i, vec3 P, vec3 D, out vec2 uv) {
  vec4 pl = uPanePlane[i];
  float nd = dot(pl.xyz, D);
  float dist = dot(pl.xyz, P) + pl.w; // > 0 on the room side
  uv = vec2(0.0);
  if (nd > -1e-4 || dist <= 0.0) return -1.0;
  float t = dist / -nd;
  vec3 H = P + D * t - uPaneO[i];
  uv = vec2(dot(H, uPaneU[i]), dot(H, uPaneV[i]));
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return -1.0;
  return t;
}

// Blurred transmittance lookup: `width` is the blur diameter in metres.
vec3 paneBlur(sampler2D tex, int i, vec2 uv, float width, float rot, const int quality) {
  float px = max(width * uPanePxPerM, 1.0);
  if (quality == 0) return textureLod(tex, uv, min(log2(px), uPaneMaxLod)).rgb;
  // 5 taps: centre + rotated square at ~1/3 of the diameter, each one a
  // lower-mip lookup. Much rounder than a single trilinear tap.
  float lod = min(max(log2(px) - 1.3, 0.0), uPaneMaxLod);
  float r = 0.33 * width * step(1.5, px);
  vec2 su = vec2(length(uPaneU[i]), length(uPaneV[i])) * r; // metres -> uv
  float c = cos(rot), s = sin(rot);
  vec2 a = vec2(c, s) * su, b = vec2(-s, c) * su;
  vec3 acc = textureLod(tex, uv, lod).rgb * 2.0;
  acc += textureLod(tex, uv + a, lod).rgb;
  acc += textureLod(tex, uv - a, lod).rgb;
  acc += textureLod(tex, uv + b, lod).rgb;
  acc += textureLod(tex, uv - b, lod).rgb;
  return acc / 6.0;
}

vec3 paneTransmit1(sampler2D tex, int i, vec3 P, vec3 D, float rot, const int quality) {
  vec2 uv;
  float t = paneHit(i, P, D, uv);
  if (t < 0.0) return vec3(1.0);
  float width = t * uLightSpread;
  vec3 T = paneBlur(tex, i, uv, width, rot, quality);
  if (quality == 1 && uGlassRipple > 0.0) {
    // Mouth-blown glass is never flat: ripples, reams and seeds act as weak
    // lenses, so the projected colour is mottled and streaked. The mottling
    // is blurred by the same cone as the picture, so it fades with distance.
    vec2 m = uv / vec2(length(uPaneU[i]), length(uPaneV[i])); // metres on the pane
    float blotch = glNoise(m * 9.0) + 0.5 * glNoise(m * 23.0);
    float ream = glNoise(vec2(m.x * 34.0 + 3.0 * glNoise(m * 2.0), m.y * 2.5));
    float fade = clamp(0.09 / (width + 0.03), 0.0, 1.0);
    T *= 1.0 + uGlassRipple * fade * (0.9 * (blotch - 0.75) + 0.8 * (ream - 0.5));
  }
  return T;
}

// Colour filter applied to the key light on its way to P.
vec3 glassTransmit(vec3 P, float rot, const int quality) {
  vec3 T = paneTransmit1(uPane0, 0, P, uLightDir, rot, quality);
  T *= paneTransmit1(uPane1, 1, P, uLightDir, rot, quality);
  T *= paneTransmit1(uPane2, 2, P, uLightDir, rot, quality);
  T *= paneTransmit1(uPane3, 3, P, uLightDir, rot, quality);
  return T;
}

// Opaque occlusion (walls, piers, vault, furniture) from the sun depth map.
float shadowTap(vec2 uv, float z) {
  return step(z - uShadowBias, texture(uShadowMap, uv).r);
}
// Soft shadows with a physically sized penumbra (PCSS): the edge of a shadow
// is as wide as  (distance from the occluding edge) * (angular size of the
// light), so the outline of a window is crisp on the sill and soft far away —
// the same rule that blurs the glass image itself.
float sunShadow(vec3 P, vec3 N, float rot, const int quality) {
  vec4 sc = uShadowMatrix * vec4(P + N * 0.035, 1.0);
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  if (quality == 0) return shadowTap(sc.xy, sc.z);
  float c = cos(rot), s = sin(rot);
  mat2 R = mat2(c, s, -s, c);
  // 1. blocker search: how far in front of us is whatever blocks the light?
  float searchR = clamp(18.0 * uLightSpread / uShadowWorldTexel, 2.0, 48.0);
  float zsum = 0.0, zn = 0.0;
  for (int k = 0; k < 10; k++) {
    float fk = float(k) + 0.5;
    float a = fk * 2.39996323;
    vec2 o = R * (vec2(cos(a), sin(a)) * sqrt(fk / 10.0) * searchR) * uShadowTexel;
    float d = texture(uShadowMap, sc.xy + o).r;
    if (d < sc.z - uShadowBias) { zsum += d; zn += 1.0; }
  }
  if (zn < 0.5) return 1.0;
  // 2. penumbra radius in texels
  float dist = (sc.z - zsum / zn) * uShadowRange;
  float r = clamp(0.5 * dist * uLightSpread / uShadowWorldTexel, 1.5, 64.0);
  // 3. filter
  float acc = 0.0;
  for (int k = 0; k < 20; k++) {
    float fk = float(k) + 0.5;
    float a = fk * 2.39996323;
    acc += shadowTap(sc.xy + R * (vec2(cos(a), sin(a)) * sqrt(fk / 20.0) * r) * uShadowTexel, sc.z);
  }
  return acc / 20.0;
}

// Radiance leaving the room side of the glass toward direction `toEye`
// (unit, pointing from the glass into the room), for glass transmittance T.
vec3 glassRadiance(vec3 T, vec3 toEye, vec3 nIn) {
  float lit = smoothstep(0.0, 0.12, -dot(nIn, uLightDir)); // sun on the outer face?
  float mu = clamp(dot(-toEye, uLightDir), 0.0, 1.0);            // looking toward the sun
  float lobe = 0.35 + 1.5 * pow(mu, 6.0) + 6.0 * pow(mu, 90.0);
  float up = clamp(-toEye.y * 0.5 + 0.5, 0.0, 1.0);        // horizon is paler than zenith
  vec3 sky = uSkyColor * mix(1.15, 0.8, up);
  return T * (sky + uLightColor * uGlassScatter * lit * lobe);
}

// Glossy reflection of the glowing windows along R (analytic, no extra pass).
vec3 paneReflect1(sampler2D tex, int i, vec3 P, vec3 R, float rough, float rot) {
  vec2 uv;
  float t = paneHit(i, P, R, uv);
  if (t < 0.0) return vec3(0.0);
  vec3 T = paneBlur(tex, i, uv, t * (0.02 + rough * rough * 1.6), rot, 1);
  // fade at the border of the pane rectangle
  vec2 e = smoothstep(vec2(0.0), vec2(0.01), uv) * smoothstep(vec2(0.0), vec2(0.01), 1.0 - uv);
  return glassRadiance(T, -R, uPanePlane[i].xyz) * e.x * e.y;
}
vec3 glassReflection(vec3 P, vec3 R, float rough, float rot) {
  return paneReflect1(uPane0, 0, P, R, rough, rot)
       + paneReflect1(uPane1, 1, P, R, rough, rot)
       + paneReflect1(uPane2, 2, P, R, rough, rot)
       + paneReflect1(uPane3, 3, P, R, rough, rot);
}

// Soft coloured skylight from the windows (they act as big area lights).
// A wide mip lookup at the point of the pane "in front of" P approximates the
// cosine-weighted average of the glass seen from P.
vec3 paneGlow1(sampler2D tex, int i, vec3 P, vec3 N) {
  vec4 pl = uPanePlane[i];
  float h = dot(pl.xyz, P) + pl.w;
  if (h <= 0.0) return vec3(0.0);
  // aim: mostly straight at the wall, bent toward where the normal looks
  vec3 D = normalize(-pl.xyz + N * 0.85);
  float nd = dot(pl.xyz, D);
  float t = h / max(-nd, 0.15);
  vec3 H = P + D * t - uPaneO[i];
  vec2 uv = vec2(dot(H, uPaneU[i]), dot(H, uPaneV[i]));
  vec2 cuv = clamp(uv, 0.0, 1.0);
  vec2 off = (uv - cuv) / vec2(length(uPaneU[i]), length(uPaneV[i])); // metres outside the pane
  float fall = 1.0 / (1.0 + dot(off, off) / (h * h + 4.0));
  float lod = min(log2(max(h * 1.2 * uPanePxPerM, 1.0)), uPaneMaxLod);
  vec3 T = textureLod(tex, cuv, lod).rgb;
  float wrap = clamp(dot(N, -pl.xyz) * 0.5 + 0.5, 0.0, 1.0);
  return glassRadiance(T, -D, pl.xyz) * fall * wrap * wrap;
}
vec3 glassGlow(vec3 P, vec3 N) {
  return paneGlow1(uPane0, 0, P, N) + paneGlow1(uPane1, 1, P, N)
       + paneGlow1(uPane2, 2, P, N) + paneGlow1(uPane3, 3, P, N);
}
