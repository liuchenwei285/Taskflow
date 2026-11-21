/* 英文界面残留中文审计：逐个视图切换后收集可见文本节点里仍含汉字的字符串。
   用法：node tools/serve.js 之后 node dev/i18n-audit-views.js */
const { chromium } = require('playwright');
const URL = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';
const PAGES = ['schedule', 'tasks', 'stats', 'library', 'me'];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US' });
  await ctx.addInitScript(() => {
    if (window.top !== window) return;
    if (!sessionStorage.getItem('__audit_init')) { localStorage.clear(); sessionStorage.setItem('__audit_init', '1'); }
  });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1000);
  let total = 0;
  for (const pg of PAGES) {
    await p.click('#sidebar [data-page=' + pg + ']');
    await p.waitForTimeout(500);
    const cn = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('p,span,h1,h2,h3,h4,button,label,li,div').forEach(n => {
        if (n.children.length) return;
        // 语言切换按钮上的「中文 / English」是选项本身，不算未翻译
        if (n.closest('#langSeg')) return;
        const t = (n.textContent || '').trim();
        if (t.length > 1 && /[\u4e00-\u9fa5]/.test(t) && n.offsetParent !== null) out.push(t.slice(0, 60));
      });
      return Array.from(new Set(out));
    });
    total += cn.length;
    console.log('=== ' + pg + ' === 残留 ' + cn.length + ' 条');
    cn.forEach(s => console.log('   ' + s));
  }
  console.log(total ? '\n合计 ' + total + ' 条英文界面残留中文' : '\n英文界面零残留');
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('FATAL ' + e.message); process.exit(2); });
