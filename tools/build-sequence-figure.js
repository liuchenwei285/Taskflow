/* 把主题切换的 5 帧拼成一张分解图：docs/theme-switch-sequence.png
   用法：node tools/build-sequence-figure.js */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const FRAMES = path.join(DOCS, 'frames');
const APP = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';
const STEPS = [[0, '0ms'], [125, '125ms'], [250, '250ms'], [375, '375ms'], [500, '500ms']];

async function launch() {
  try { return await chromium.launch(); }
  catch (e) { return await chromium.launch({ channel: 'chrome' }); }
}

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForTimeout(700);
  const btn = await p.evaluate(() => {
    const r = document.getElementById('btnTheme').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await ctx.close();

  const img = f => 'data:image/png;base64,' +
    fs.readFileSync(path.join(FRAMES, f)).toString('base64');

  const cols = STEPS.map(([t, label]) => `
    <figure>
      <div class="shot"><img src="${img(`frame-${String(t).padStart(3, '0')}.png`)}">
        <span class="dot" style="left:${(btn.x / 412 * 100).toFixed(2)}%;top:${(btn.y / 915 * 100).toFixed(2)}%"></span>
      </div>
      <figcaption>${label}</figcaption>
    </figure>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;padding:34px 38px 30px;width:1240px;
      background:#0B0E13;color:#E6EAF0;
      font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
    h1{font-size:23px;margin:0 0 6px;letter-spacing:.2px}
    .sub{color:#8B94A3;margin:0 0 24px;font-size:13px}
    .row{display:flex;gap:16px}
    figure{margin:0;flex:1}
    .shot{position:relative;border-radius:12px;overflow:hidden;
      border:1px solid #232A36;background:#000;box-shadow:0 10px 30px rgba(0,0,0,.45)}
    .shot img{display:block;width:100%}
    .dot{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;
      border:2px solid #FF3D8B;box-shadow:0 0 0 3px rgba(255,61,139,.25)}
    figcaption{margin-top:10px;text-align:center;color:#9AA4B2;font-size:12px;
      font-variant-numeric:tabular-nums;letter-spacing:.4px}
    .foot{margin-top:22px;padding-top:16px;border-top:1px solid #1E242E;
      color:#7C8697;font-size:12px;line-height:1.8}
    code{background:#1A2029;padding:2px 6px;border-radius:4px;color:#C8D2E0}
    .hl{color:#FF6FAE}
  </style></head><body>
    <h1>主题切换 · 圆形扩散揭示</h1>
    <p class="sub">View Transitions API · <code>::view-transition-new(root)</code> 的 clip-path 圆裁剪 ·
       500ms · <code>cubic-bezier(0.32, 0.72, 0, 1)</code> · 圆心 = 主题按钮中心</p>
    <div class="row">${cols}</div>
    <div class="foot">
      换色在转场开始的一帧内<span class="hl">一次性完成</span>，动画只负责「揭开」新主题；
      圆外仍是旧主题快照，圆内已是最终画面，因此揭开后不会出现二次变色。<br>
      粉色标记 = 圆形裁剪的圆心（主题切换按钮）。深色主题从圆心向外推开浅色主题。
    </div>
  </body></html>`;

  const ctx2 = await browser.newContext({ viewport: { width: 1240, height: 800 }, deviceScaleFactor: 2 });
  const p2 = await ctx2.newPage();
  await p2.setContent(html);
  await p2.evaluate(async () => { await Promise.all([...document.images].map(i => i.decode())); });
  await p2.screenshot({ path: path.join(DOCS, 'theme-switch-sequence.png'), fullPage: true });
  await browser.close();
  console.log('docs/theme-switch-sequence.png',
    fs.statSync(path.join(DOCS, 'theme-switch-sequence.png')).size, 'B');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
