/* =============================================================
 * Taskflow 启动器图标生成器
 *
 * 输入 : icon-source/taskflow-icon-B-pink-hot.svg (1024x1024, 白底 + 粉色计时环)
 * 输出 : app/src/main/res/mipmap-{mdpi..xxxhdpi}/ic_launcher{,_round}.png
 *        icon-source/icon-preview-512.png        (大图预览)
 *        icon-source/icon-compare.png           (旧/新并排对比)
 *
 * 用 Chromium 把矢量 SVG 直接按目标像素光栅化（而非先出大图再降采样），
 * 保证 48px 这类小尺寸下描边与圆头依然锐利、无二次插值模糊。
 * 保持 ic_launcher / ic_launcher_round 完全一致，与旧资源结构相同。
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/Alfred Liu/WorkBuddy/2026-11-14-23-23-25/ui2/e2e-env/node_modules/playwright');

const ROOT = 'C:/Users/Alfred Liu/android-build';
const SRC_DIR = path.join(ROOT, 'icon-source');
const SRC = path.join(SRC_DIR, 'taskflow-icon-B-pink-hot.svg');
const RES = path.join(ROOT, 'app/src/main/res');

const DENSITIES = [
  ['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]
];

const svg = fs.readFileSync(SRC, 'utf8');
if (!/viewBox="0 0 1024 1024"/.test(svg)) throw new Error('SVG viewBox 不是 1024x1024');
const svgUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
const pngUrl = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

async function render(page, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;width:' + size + 'px;height:' + size + 'px;' +
    'background:#fff;overflow:hidden}' +
    'img{display:block;width:' + size + 'px;height:' + size + 'px}' +
    '</style></head><body><img id="i" src="' + svgUrl + '"></body></html>'
  );
  await page.evaluate(() => document.getElementById('i').decode());
  await page.screenshot({ path: out, type: 'png', animations: 'disabled' });
  return fs.statSync(out).size;
}

/* 像素校验：白底、粉色图形存在且居中、四角不透明 */
async function verify(page, file) {
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = b64; await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let pink = 0, opaque = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let p = 0; p < d.length; p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2], a = d[p + 3];
      if (a > 250) opaque++;
      if (r > 200 && g < 140 && b > 90 && b < 200) {
        pink++;
        const i = (p / 4), px = i % c.width, py = Math.floor(i / c.width);
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
    }
    const corner = [0, 0], cornerIdx = 0;
    return {
      size: c.width + 'x' + c.height,
      pinkPct: +(pink / (c.width * c.height) * 100).toFixed(2),
      opaquePct: +(opaque / (c.width * c.height) * 100).toFixed(2),
      cornerRGBA: Array.from(d.slice(cornerIdx, cornerIdx + 4)),
      bbox: pink ? [minX, minY, maxX, maxY] : null,
      centerOffset: pink ? +(((minX + maxX) / 2 - c.width / 2) ** 2 +
                             ((minY + maxY) / 2 - c.height / 2) ** 2).toFixed(2) : null
    };
  }, b64(file));
}
const b64 = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

(async () => {
  // 本机 Playwright 缓存的 headless_shell 版本与包不一致，复用系统 Chrome
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const report = { source: path.basename(SRC), generated: [], verification: [] };

  for (const [d, s] of DENSITIES) {
    const dir = path.join(RES, 'mipmap-' + d);
    const a = path.join(dir, 'ic_launcher.png');
    const b = path.join(dir, 'ic_launcher_round.png');
    const bytes = await render(page, s, a);
    fs.copyFileSync(a, b);
    const v = await verify(page, a);
    report.generated.push({ density: d, px: s, bytes, files: ['ic_launcher.png', 'ic_launcher_round.png'] });
    report.verification.push({ density: d, ...v });
    console.log(`  mipmap-${d.padEnd(7)} ${String(s).padStart(3)}px  ${String(bytes).padStart(6)}B  pink=${v.pinkPct}%  opaque=${v.opaquePct}%  bbox=${JSON.stringify(v.bbox)}`);
  }

  const preview = path.join(SRC_DIR, 'icon-preview-512.png');
  await render(page, 512, preview);
  console.log('  preview   512px  ' + fs.statSync(preview).size + 'B');

  /* 旧 / 新并排对比：上排 256px 放大，下排 48dp 真实尺寸 */
  const oldPng = pngUrl(path.join(SRC_DIR, 'legacy-icons/xxxhdpi/ic_launcher.png'));
  const newPng = pngUrl(preview);
  await page.setViewportSize({ width: 900, height: 520 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;padding:28px 32px;background:#F4F6FA;
      font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1A1C1F}
    h1{font-size:20px;margin:0 0 4px} .sub{color:#5B6068;margin:0 0 24px;font-size:13px}
    .row{display:flex;gap:20px}
    .card{flex:1;background:#fff;border:1px solid #E1E4EA;border-radius:14px;padding:20px;
      box-shadow:0 6px 20px rgba(15,23,42,.06)}
    .tag{display:inline-block;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;margin-bottom:14px}
    .old .tag{background:#EFE7DC;color:#7A5A3A} .new .tag{background:#FFE4EF;color:#B02A63}
    .big{display:flex;align-items:center;justify-content:center;gap:22px;height:270px}
    .big img{width:240px;height:240px;image-rendering:auto}
    .small{display:flex;align-items:center;justify-content:center;gap:14px;border-top:1px solid #EEF1F6;padding-top:16px}
    .small img{width:48px;height:48px} .small span{font-size:12px;color:#5B6068}
    .foot{margin-top:22px;font-size:12px;color:#5B6068}
    code{background:#EEF1F6;padding:2px 6px;border-radius:4px;font-size:12px}
  </style></head><body>
    <h1>Taskflow 启动器图标 · 旧 → 新</h1>
    <p class="sub">源图 <code>taskflow-icon-B-pink-hot.svg</code> · 白底 + #FF3D8B 计时环 · 5 个密度矢量直出</p>
    <div class="row">
      <div class="card old"><span class="tag">旧 · 米色日历 / 秒表</span>
        <div class="big"><img src="${oldPng}"></div>
        <div class="small"><img src="${oldPng}"><span>48dp (mdpi) 实际显示</span></div></div>
      <div class="card new"><span class="tag">新 · 粉色计时环</span>
        <div class="big"><img src="${newPng}"></div>
        <div class="small"><img src="${newPng}"><span>48dp (mdpi) 实际显示</span></div></div>
    </div>
    <div class="foot">ic_launcher / ic_launcher_round 均按同尺寸生成；通知小图标仍复用 @mipmap/ic_launcher，引用结构未变。</div>
  </body></html>`);
  await page.evaluate(async () => {
    await Promise.all([...document.images].map(i => i.decode()));
  });
  const compare = path.join(SRC_DIR, 'icon-compare.png');
  await page.screenshot({ path: compare, type: 'png', fullPage: true });
  console.log('  compare   ' + fs.statSync(compare).size + 'B');

  fs.writeFileSync(path.join(SRC_DIR, 'icon-generate-report.json'),
    JSON.stringify(report, null, 2));
  await browser.close();
  console.log('OK: 5 densities x 2 PNG + preview + compare');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
