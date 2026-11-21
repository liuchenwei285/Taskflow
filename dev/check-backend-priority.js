/* 验证前端优先走服务端：本地 /health 可达且服务端无密钥时，
   必须报 #KEY（服务端缺密钥），并且页面绝不向 api.deepseek.com 直连发请求。 */
const { chromium } = require('playwright');
const URL = process.env.TF_URL || 'http://127.0.0.1:18899/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, locale: 'zh-CN' });
  const direct = [];
  await ctx.route('**://api.deepseek.com/**', (r) => { direct.push(r.request().url()); return r.abort(); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR ' + e.message));
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  await p.setInputFiles('#studyFiles', [{ name: '重要极限.md', mimeType: 'text/markdown', buffer: Buffer.from('# 重要极限\nlim sinx/x=1', 'utf8') }]);
  await p.waitForTimeout(900);
  // 故意不填任何密钥：让前端只有服务端这一条路
  await p.evaluate(() => window.__studyGen('出一套试卷', { skipConfirm: true }));
  await p.waitForTimeout(3000);
  const card = await p.evaluate(() => {
    const cs = document.querySelectorAll('.err-card');
    if (!cs.length) return null;
    const c = cs[cs.length - 1];
    const t = (s) => { const n = c.querySelector(s); return n ? n.textContent.trim() : ''; };
    return { key: c.getAttribute('data-err-key'), line: t('.err-line'), tag: t('.err-tag'), detail: t('.err-detail'), retry: !!c.closest('.msg').querySelector('.msg__retry') };
  });
  const health = await p.evaluate(async () => {
    const r = await fetch('/functions/v1/app/health');
    return r.status + ' ' + JSON.stringify(await r.json());
  });
  console.log('health(页面视角): ' + health);
  console.log('错误卡片: ' + JSON.stringify(card));
  console.log('页面直连 api.deepseek.com 的请求数: ' + direct.length);
  await browser.close();
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
