// Regression check for black frames: renders many camera poses and reports any
// frame with a large share of pure-black pixels. Needs the dev server.
import puppeteer from 'puppeteer-core';
const base = process.env.SG_URL ?? 'http://localhost:5173/';
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome-stable', headless: 'new',
  args: ['--no-sandbox', ...(process.env.ANGLE === 'gl' ? ['--use-angle=gl', '--enable-gpu'] : ['--use-angle=vulkan', '--enable-features=Vulkan']), '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 960, height: 600 });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`${base}?dpr=1&ui=0&${process.argv[2] ?? 't=10.5'}`); await p.waitForFunction('window.__ready===true');
const res = await p.evaluate((N) => {
  const { camera, controls, pipeline, renderer } = window.__sg;
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bad = []; let worst = 0; let nanFrames = 0, nanPixels = 0;
  const rt = pipeline.sceneRT; const hb = new Uint16Array(rt.width * rt.height * 4);
  for (let i = 0; i < N; i++) {
    camera.position.set(-22 + 44 * rnd(), 0.6 + 14 * rnd(), -6.5 + 13 * rnd());
    controls.target.set(-24 + 48 * rnd(), 26 * rnd(), -8 + 16 * rnd());
    if (i % 2) { const d = [[1,0,0],[-1,0,0],[0,1,0.0001],[0,-1,0.0001],[0,0,1],[0,0,-1]][(i >> 1) % 6]; controls.target.copy(camera.position).add({ x: d[0] * 5, y: d[1] * 5, z: d[2] * 5 }); }
    camera.lookAt(controls.target); camera.updateMatrixWorld(true);
    pipeline.render();
    renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, hb);
    let nn = 0; for (let k = 0; k < hb.length; k++) if ((hb[k] & 0x7c00) === 0x7c00) nn++;
    if (nn) { nanFrames++; nanPixels += nn; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let black = 0;
    for (let k = 0; k < buf.length; k += 16) if (buf[k] + buf[k + 1] + buf[k + 2] === 0) black++;
    const f = black / (buf.length / 16);
    worst = Math.max(worst, f);
    if (f > 0.002) bad.push({ i, f: +f.toFixed(3), pos: camera.position.toArray().map((v) => +v.toFixed(2)), tgt: controls.target.toArray().map((v) => +v.toFixed(2)) });
  }
  return { N, nanFrames, nanPixels, worst: +worst.toFixed(4), badCount: bad.length, bad: bad.slice(0, 8) };
}, Number(process.argv[3] ?? 400));
console.log(JSON.stringify(res));
await b.close();
