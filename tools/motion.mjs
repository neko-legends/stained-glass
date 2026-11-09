// Drives real mouse drags / wheel zooms and checks every rendered frame for
// sudden darkening (black flicker). Needs the dev server.
import puppeteer from 'puppeteer-core';
const base = process.env.SG_URL ?? 'http://localhost:5173/';
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome-stable', headless: 'new',
  args: ['--no-sandbox', ...(process.env.ANGLE === 'gl' ? ['--use-angle=gl', '--enable-gpu'] : ['--use-angle=vulkan', '--enable-features=Vulkan']), '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 1100, height: 700, deviceScaleFactor: Number(process.env.DSF ?? 1) });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`${base}?ui=0&${process.argv[2] ?? 't=10.5'}`); await p.waitForFunction('window.__ready===true');
await p.evaluate(() => {
  const { pipeline, renderer, camera } = window.__sg;
  const gl = renderer.getContext();
  const orig = pipeline.render.bind(pipeline);
  window.__log = [];
  pipeline.render = () => {
    orig();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0, black = 0, n = 0;
    const G = 12, tiles = new Float32Array(G * G), cnt = new Float32Array(G * G);
    for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
      const k = (y * w + x) * 4; const v = buf[k] + buf[k + 1] + buf[k + 2];
      sum += v; if (v === 0) black++; n++;
      const t = Math.min(G - 1, (y * G / h) | 0) * G + Math.min(G - 1, (x * G / w) | 0); tiles[t] += v; cnt[t]++;
    }
    for (let t = 0; t < G * G; t++) tiles[t] /= cnt[t];
    let extra = null;
    if (black / n > 0.9) {
      const rt = pipeline.sceneRT; const px = new Uint16Array(4 * rt.width * rt.height);
      renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, px);
      let sn = 0, sz = 0, where = null; for (let k = 0; k < px.length; k++) { if ((px[k] & 0x7c00) === 0x7c00) { sn++; where ??= [((k >> 2) % rt.width), ((k >> 2) / rt.width) | 0, k & 3, px[k]]; } if (px[k] === 0) sz++; }
      const vt = pipeline.volRT; const vp = new Uint16Array(4 * vt.width * vt.height);
      renderer.readRenderTargetPixels(vt, 0, 0, vt.width, vt.height, vp);
      let vn = 0; for (let k = 0; k < vp.length; k++) if ((vp[k] & 0x7c00) === 0x7c00) vn++;
      extra = { where, quat: camera.quaternion.toArray(), fullPos: camera.position.toArray(), sceneNaN: sn, sceneZero: sz, volNaN: vn, volTotal: vp.length, camFinite: camera.matrixWorld.elements.every(Number.isFinite), inv: pipeline.invViewProj.elements.every(Number.isFinite) };
    }
    window.__log.push({ extra, tiles: Array.from(tiles), lum: sum / n, black: black / n, pos: camera.position.toArray().map((v) => +v.toFixed(2)) });
  };
});
let s = 777; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
for (let g = 0; g < 24; g++) {
  const x0 = 200 + rnd() * 700, y0 = 150 + rnd() * 400;
  await p.mouse.move(x0, y0);
  if (g % 3 === 2) { for (let k = 0; k < 12; k++) { await p.mouse.wheel({ deltaY: (rnd() < 0.5 ? -1 : 1) * 240 }); await new Promise((r) => setTimeout(r, 30)); } continue; }
  await p.mouse.down({ button: g % 4 === 1 ? 'right' : 'left' });
  const dx = (rnd() - 0.5) * 900, dy = (rnd() - 0.5) * 500;
  for (let k = 1; k <= 25; k++) { await p.mouse.move(x0 + (dx * k) / 25, y0 + (dy * k) / 25); await new Promise((r) => setTimeout(r, 16)); }
  await p.mouse.up({ button: g % 4 === 1 ? 'right' : 'left' });
  await new Promise((r) => setTimeout(r, 250));
}
const log = await p.evaluate(() => window.__log);
const dips = [];
for (let i = 1; i < log.length - 1; i++) {
  const a = log[i - 1].lum, c = log[i].lum, d = log[i + 1].lum;
  let tileDip = 0;
  for (let t = 0; t < log[i].tiles.length; t++) { const m = Math.min(log[i - 1].tiles[t], log[i + 1].tiles[t]); if (m > 30 && log[i].tiles[t] < 0.45 * m) tileDip++; }
  if (c < 0.6 * Math.min(a, d) || log[i].black > 0.05 || tileDip > 0) dips.push({ extra: log[i].extra, tileDip, i, prev: +a.toFixed(1), lum: +c.toFixed(1), next: +d.toFixed(1), black: +log[i].black.toFixed(3), pos: log[i].pos });
}
console.log(JSON.stringify({ maxBlack: Math.max(...log.map((l) => l.black)).toFixed(4), frames: log.length, dips: dips.length, sample: dips.slice(0, 10) }));
await b.close();
