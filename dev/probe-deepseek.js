/* 排查探针：在真实浏览器里从线上页面发起 DeepSeek 直连请求，区分「网络/CORS 被拦」与「拿到 HTTP 响应」
   只用假 Key，目的是看错误类型；不打印任何真实凭据。 */
const { chromium } = require('playwright');
const SITE = 'https://taskflow-app-3qo4c3iuyvd.qoder.zone';
const LOCAL = 'http://127.0.0.1:8899/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const origin of [SITE, LOCAL]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const reqLog = [];
    page.on('requestfailed', r => reqLog.push('FAILED ' + r.url().slice(0, 60) + ' :: ' + (r.failure() && r.failure().errorText)));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log(origin + ' → 页面打不开: ' + e.message.split('\n')[0]);
      await ctx.close(); continue;
    }
    const r = await page.evaluate(async () => {
      const out = {};
      const t0 = Date.now();
      try {
        const res = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer sk-dummy-probe', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 })
        });
        out.status = res.status;
        out.body = String(await res.text()).slice(0, 220);
      } catch (e) { out.err = String(e && e.name) + ': ' + String(e && e.message).slice(0, 200); }
      out.ms = Date.now() - t0;
      // 顺带看本站后端代理是否可用
      try {
        const b = await fetch('/functions/v1/app/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"ping"}' });
        out.backend = b.status + ' ' + String(await b.text()).slice(0, 120);
      } catch (e) { out.backend = 'ERR ' + String(e && e.message).slice(0, 120); }
      return out;
    });
    console.log('=== ' + origin + ' ===');
    console.log('  直连 DeepSeek: ' + (r.err ? '浏览器层抛错 → ' + r.err : 'HTTP ' + r.status + ' · ' + r.body) + ' (' + r.ms + 'ms)');
    console.log('  本站后端代理 : ' + r.backend);
    if (reqLog.length) console.log('  失败请求: ' + reqLog.join(' | '));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error('FATAL ' + e.message); process.exit(2); });
