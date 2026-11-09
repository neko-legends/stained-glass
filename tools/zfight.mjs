// Z-fighting detector: renders each view twice with the camera nudged 2 mm and
// reports pixels that change violently (coplanar faces swap, honest shading
// barely moves). Needs the dev server. Writes a marked screenshot per view.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.SG_URL ?? 'http://localhost:5173/';
const out = process.argv[2] ?? '.shots';
mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome-stable', headless: 'new',
  args: ['--no-sandbox', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 800 });
await p.goto(`${base}?dpr=1&ui=0&music=0&t=11`); await p.waitForFunction('window.__ready===true && window.__statueReady===true && window.__artReady===true');
const views = [
  [[-9.5, 1.8, 1.2], [16, 8.5, -0.3]], [[-6, 9, -5.5], [6, 0, 3]], [[17, 2, -1.5], [-24, 3, 0]], [[-3, 0.9, -2.5], [20, 6, 1]],
  [[12, 2.5, 2], [21, 2, -1]], [[0, 1.6, 0], [6, 2.5, 8]], [[0, 1.6, 0], [-6, 2.5, -8]], [[-14, 3, 3], [-24, 3, -2]],
  [[5, 12, 0], [12, 19, 8]], [[5, 14, 0], [-3, 27, 0]], [[14, 6, 4], [22, 3, 0]], [[-2, 4, 5], [4, 1, 8]],
];
for (let i = 0; i < views.length; i++) {
  const r = await p.evaluate(([pos, tgt]) => {
    const { camera, controls, pipeline, renderer } = window.__sg;
    const gl = renderer.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    pipeline.volMat.uniforms.uFrame.value = 0; pipeline.compMat.uniforms.uVolStrength.value = 0; pipeline.bloom.strength = 0;
    const grab = (dx) => {
      camera.position.set(pos[0] + dx, pos[1] + dx, pos[2] + dx); controls.target.set(...tgt); camera.lookAt(controls.target); camera.updateMatrixWorld(true);
      pipeline.volMat.uniforms.uFrame.value = 0;
      pipeline.render(); const buf = new Uint8Array(w * h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf;
    };
    const a = grab(0), c = grab(0.002);
    let n = 0; const G = 16, tiles = new Array(G * G).fill(0);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d'); const im = cx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = (y * w + x) * 4, d = ((h - 1 - y) * w + x) * 4; im.data[d] = a[k] >> 1; im.data[d + 1] = a[k + 1] >> 1; im.data[d + 2] = a[k + 2] >> 1; im.data[d + 3] = 255; }
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const k = (y * w + x) * 4;
      // compare against the 3x3 neighbourhood of the other frame so real edges that shift by a pixel don't count
      let best = 1e9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const q = k + (oy * w + ox) * 4; best = Math.min(best, Math.abs(a[k] - c[q]) + Math.abs(a[k + 1] - c[q + 1]) + Math.abs(a[k + 2] - c[q + 2])); }
      if (best > 45) { const d = ((h - 1 - y) * w + x) * 4; im.data[d] = 255; im.data[d + 1] = 0; im.data[d + 2] = 255; n++; tiles[Math.floor(((h - 1 - y) * G) / h) * G + Math.floor((x * G) / w)]++; }
    }
    const hot = tiles.map((v, t) => [v, t % G, Math.floor(t / G)]).filter((t) => t[0] > 25).sort((x, y) => y[0] - x[0]).slice(0, 5);
    cx.putImageData(im, 0, 0);
    return { n, hot, png: cv.toDataURL('image/png') };
  }, views[i]);
  writeFileSync(`${out}/zf_${i}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(i, JSON.stringify(views[i][0]), 'flipping px:', r.n, 'hot tiles [count,col,row of 16]:', JSON.stringify(r.hot));
}
await b.close();
