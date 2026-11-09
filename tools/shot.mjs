// Headless screenshots: node tools/shot.mjs <outDir> "t=9.5&view=nave" "t=13&view=floor" ...
// Needs a running dev/preview server (default http://localhost:5173, override with SG_URL)
// and a Chrome binary (override with CHROME).
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const [outDir = '.shots', ...queries] = process.argv.slice(2);
const base = process.env.SG_URL ?? 'http://localhost:5173/';
const chrome = process.env.CHROME ?? '/usr/bin/google-chrome-stable';
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome, headless: 'new',
  args: ['--no-sandbox', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 800) });
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[${m.type()}]`, m.text().slice(0, 1500)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const qs of queries.length ? queries : ['t=9.5']) {
  await page.goto(`${base}?dpr=1&${qs}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true && window.__artReady === true && window.__statueReady === true', { timeout: 60000 });
  if (process.env.SG_EVAL) await page.evaluate(process.env.SG_EVAL);
  await new Promise((r) => setTimeout(r, 400));
  const name = qs.replace(/[^a-z0-9.]+/gi, '_');
  await page.screenshot({ path: `${outDir}/${name}.png` });
  const info = await page.evaluate(() => {
    const gl = window.__sg.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('shot', name, '|', info);
}
await browser.close();
