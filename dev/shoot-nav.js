/* 改名后的导航标签验收：宽窄两种布局 × 中英文，检查是否溢出/截断，并截图留证。
   用法：node tools/serve.js 之后 node dev/shoot-nav.js */
const { chromium } = require('playwright');
const URL = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';

const CASES = [
  { name: 'wide-zh', width: 1280, height: 860, locale: 'zh-CN' },
  { name: 'wide-en', width: 1280, height: 860, locale: 'en-US' },
  { name: 'narrow-zh', width: 390, height: 844, locale: 'zh-CN' },
  { name: 'narrow-en', width: 390, height: 844, locale: 'en-US' }
];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let bad = 0;
  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, locale: c.locale });
    await ctx.addInitScript(() => { if (window.top !== window) return; if (!sessionStorage.getItem('__nav_init')) { localStorage.clear(); sessionStorage.setItem('__nav_init', '1'); } });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(900);
    const info = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('#sidebar [data-page], .dock [data-page], nav [data-page]').forEach(a => {
        const s = a.querySelector('span');
        if (!s) return;
        const r = s.getBoundingClientRect();
        out.push({ page: a.dataset.page, text: s.textContent.trim(), clipped: s.scrollWidth > Math.ceil(r.width) + 1, w: Math.round(r.width) });
      });
      const lib = document.querySelector('.study__notice');
      return { items: out, notice: lib ? lib.textContent.trim() : '', visible: out.filter(x => x.w > 0).length };
    });
    const labels = info.items.filter(i => i.w > 0).map(i => i.page + '=' + i.text).join(' | ');
    const clip = info.items.filter(i => i.w > 0 && i.clipped).map(i => i.page);
    console.log('=== ' + c.name + ' ===');
    console.log('  导航：' + labels);
    console.log('  截断：' + (clip.length ? clip.join(',') : '无'));
    console.log('  试卷库提示：' + info.notice.slice(0, 60));
    if (clip.length) bad++;
    await p.screenshot({ path: 'dev/shots/nav-' + c.name + '.png' });
    await ctx.close();
  }
  await browser.close();
  console.log(bad ? '有标签被截断：' + bad + ' 个视图' : '全部标签完整显示');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FATAL ' + e.message); process.exit(2); });
