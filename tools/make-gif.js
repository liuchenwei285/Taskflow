/* =============================================================
 * 把主题切换动画编码成 GIF（GitHub README 原生支持，<video> 会被清洗掉）
 *
 * 做法：Chromium 里点击主题按钮 → 暂停 View Transition 动画 →
 *       按固定步长推进 currentTime 逐帧截图 → pngjs 解码 → gifenc 编码
 * 产物：docs/theme-switch.gif
 * 用法：node tools/make-gif.js
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const APP = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';

const W = 320;          // 输出宽
const STEPS = 32;       // 帧数（覆盖 0–500ms）
const FPS = 12;         // GIF 播放帧率（低于实际速度，便于看清）

async function launch() {
  try { return await chromium.launch(); }
  catch (e) { return await chromium.launch({ channel: 'chrome' }); }
}

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForTimeout(800);
  await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await p.waitForTimeout(500);

  await p.click('#btnTheme');
  await p.waitForTimeout(60);
  const n = await p.evaluate(() => {
    const as = document.getAnimations().filter(a =>
      a.effect && a.effect.pseudoElement && /view-transition/.test(a.effect.pseudoElement));
    as.forEach(a => a.pause());
    return as.length;
  });
  if (!n) throw new Error('未捕获到 View Transition 动画');

  const frames = [];
  for (let i = 0; i < STEPS; i++) {
    const t = Math.round(500 * i / (STEPS - 1));
    await p.evaluate(ms => {
      document.getAnimations()
        .filter(a => a.effect && a.effect.pseudoElement && /view-transition/.test(a.effect.pseudoElement))
        .forEach(a => { a.currentTime = ms; });
    }, t);
    await p.waitForTimeout(45);
    const buf = await p.screenshot({ type: 'png' });
    frames.push(buf);
    if (i % 8 === 0) process.stdout.write('  帧 ' + i + '/' + STEPS + '\n');
  }
  await ctx.close();
  await browser.close();

  /* PNG → RGBA → 量化 → GIF */
  const enc = GIFEncoder();
  const delay = Math.round(1000 / FPS);
  for (const buf of frames) {
    const png = PNG.sync.read(buf);
    const rgba = new Uint8Array(png.width * png.height * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = png.data[i];
    const palette = quantize(rgba, 128);
    const index = applyPalette(rgba, palette);
    enc.writeFrame(index, png.width, png.height, { palette, delay });
  }
  enc.finish();
  const gif = Buffer.from(enc.bytes());
  fs.writeFileSync(path.join(DOCS, 'theme-switch.gif'), gif);
  console.log('docs/theme-switch.gif', gif.length, 'B ·',
    STEPS + ' 帧 @' + FPS + 'fps ·', gif.length > 10 * 1024 * 1024 ? '⚠ 超过 10MB' : '大小 OK');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
