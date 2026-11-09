// Screen-space ambient occlusion from the depth pre-pass. Normals are rebuilt
// from depth, so no extra geometry buffer is needed. Output: R = visibility.
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform vec2 uRes;
uniform float uRadius;
varying vec2 vUv;

#define AO_SAMPLES 16

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

vec3 viewPos(vec2 uv) {
  float d = texture(tDepth, uv).r;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

void main() {
  vec3 p = viewPos(vUv);
  vec2 t = 1.0 / uRes;
  vec3 pl = viewPos(vUv - vec2(t.x, 0.0)), pr = viewPos(vUv + vec2(t.x, 0.0));
  vec3 pd = viewPos(vUv - vec2(0.0, t.y)), pu = viewPos(vUv + vec2(0.0, t.y));
  // use whichever neighbour is on the same surface (smaller depth step)
  vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
  vec3 n = normalize(cross(dx, dy));

  vec3 up = abs(n.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 tx = normalize(cross(up, n));
  vec3 ty = cross(n, tx);
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float jit = ign(gl_FragCoord.yx + 17.0);

  float occ = 0.0;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float fi = (float(i) + 0.5) / float(AO_SAMPLES);
    float phi = float(i) * 2.39996323 + rot;
    float r = sqrt(fi);
    vec3 dir = tx * (r * cos(phi)) + ty * (r * sin(phi)) + n * sqrt(1.0 - fi); // cosine-weighted
    float k = fract(fi * 7.31 + jit);
    float scale = uRadius * mix(0.08, 1.0, k * k);          // more samples close in: fine creases
    vec3 sp = p + dir * scale + n * 0.02;
    vec4 c = uProj * vec4(sp, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    float sd = viewPos(suv).z;
    float range = smoothstep(0.0, 1.0, uRadius / max(abs(p.z - sd), 1e-4));
    occ += step(sp.z + 0.02, sd) * range;
  }
  gl_FragColor = vec4(vec3(1.0 - occ / float(AO_SAMPLES)), 1.0);
}
