/* 视觉验收截图：确认卡片 / 阶段气泡 / 错误卡片 / PDF 卡片与预览，深浅主题 + 中英文 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const URL = process.env.TASKFLOW_URL || 'http://127.0.0.1:18899/';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const SETS = {
  net: (r) => r.abort('failed'),
  ok: (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ title: '重要极限练习卷', warnings: [], questions: [
      { type: 'single', question: '求极限：$$\\lim_{x\\to 0}\\frac{\\sin 2x}{\\sin 3x}$$', options: ['$\\dfrac{2}{3}$', '$\\dfrac{3}{2}$'], answer: 'A', explanation: '等价无穷小 $\\sin 2x\\sim 2x$', difficulty: 'easy' },
      { type: 'fill', question: '$$\\lim_{x\\to\\infty}\\left(1+\\frac{1}{x}\\right)^x=$ ____', answer: 'e', explanation: '第二个重要极限', difficulty: 'medium' },
    ] }) }, finish_reason: 'stop' }] }) }),
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const theme of ['light', 'dark']) {
    for (const lang of ['zh', 'en']) {
      const tag = theme + '-' + lang;
      const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, locale: lang === 'zh' ? 'zh-CN' : 'en-US', acceptDownloads: true });
      await ctx.addInitScript(() => {
        if (window.top !== window) return;   // 子帧不能清库：html2canvas 的克隆帧与主帧共用 localStorage
        localStorage.clear();
      });
      let mode = 'ok';
      await ctx.route('**/chat/completions', async (r) => {
        if (mode === 'net') return SETS.net(r);
        if (mode === 'slow') await new Promise((res) => setTimeout(res, 4000));
        return SETS.ok(r);
      });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('PAGEERROR ' + tag + ': ' + e.message));
      p.on('framenavigated', (f) => { if (f === p.mainFrame()) console.log('NAV ' + tag + ' ' + f.url()); });
      await p.goto(URL, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(600);
      if (theme === 'dark') {
        await p.click('#btnTheme');
        await p.waitForTimeout(400);
      }
      const themeNow = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (themeNow !== theme) console.log('THEME-MISMATCH ' + tag + ' -> ' + themeNow);
      if (lang === 'en') {
        // locale=en-US 时自动解析为英文；只有仍是中文时才点语言开关
        const enBtn = p.locator('#langSeg button[data-lang="en"]').first();
        if (await enBtn.isVisible().catch(() => false)) { await enBtn.click(); await p.waitForTimeout(500); }
      }
      await p.check('#chatConsent');
      await p.setInputFiles('#studyFiles', [{ name: '重要极限.md', mimeType: 'text/markdown', buffer: Buffer.from('# 重要极限\nlim sinx/x=1，第二个重要极限 (1+1/x)^x=e', 'utf8') }]);
      await p.waitForTimeout(900);
      await p.evaluate(() => window.__aiTest.setKey('sk-shoot-mock'));

      const shoot = async (name) => {
        const docs = await p.evaluate(() => (JSON.parse(localStorage.getItem('taskflow.study.documents.v1') || '{}').docs || []).length);
        console.log('docs@' + name + '=' + docs);
        await p.screenshot({ path: path.join(OUT, tag + '-' + name + '.png'), fullPage: false }); console.log('shot ' + tag + '-' + name);
      };

      // 1) 确认卡片
      await p.fill('#chatInput', lang === 'zh' ? '根据这份笔记出一套试卷' : 'Make a test paper from this note');
      await p.click('#btnChatSend');
      await p.waitForSelector('.confirm-card', { timeout: 15000 });
      await p.locator('.confirm-card').scrollIntoViewIfNeeded();
      await shoot('1-confirm');

      // 2) 取消路径
      await p.click('.cc-no');
      await p.waitForTimeout(400);
      await p.locator('.confirm-card').scrollIntoViewIfNeeded();
      await shoot('2-cancelled');

      // 3) 阶段气泡（发送后立刻截图，桩延迟 4 秒停在生成题目）
      mode = 'slow';
      await p.fill('#chatInput', lang === 'zh' ? '再出一套试卷' : 'Generate 5 questions from this note');
      await p.click('#btnChatSend');
      await p.waitForSelector('.cc-ok', { timeout: 15000 });
      await p.click('.cc-ok');
      await p.waitForSelector('.thinking-stage', { timeout: 8000 });
      await p.waitForTimeout(1500);
      await p.locator('.thinking-stage').scrollIntoViewIfNeeded();
      const stageText = await p.locator('.thinking-stage').last().textContent();
      await shoot('3-stage');

      // 4) PDF 卡片 + 预览
      await p.waitForSelector('.file-card--pdf[data-status="ready"]', { timeout: 60000 });
      await p.locator('.file-card--pdf').scrollIntoViewIfNeeded();
      await p.waitForTimeout(300);
      await shoot('4-pdf-card');
      await p.click('.file-card--pdf .pdf-preview');
      await p.waitForTimeout(1500);
      await shoot('5-pdf-preview');
      await p.evaluate(() => { const b = document.querySelector('#fileModal .file-modal__head button'); if (b) b.click(); });

      // 6) 错误卡片（网络类）
      mode = 'net';
      console.log('DOCS ' + tag + ' :: ' + JSON.stringify(await p.evaluate(() => window.__study.list().map(d => ({ n: d.fileName, s: d.parseStatus, c: (d.content || '').length })))));
      await p.fill('#chatInput', lang === 'zh' ? '出一套试卷' : 'Make another quiz');
      await p.click('#btnChatSend');
      try {
        await p.waitForSelector('.cc-ok', { timeout: 15000 });
      } catch (e) {
        console.log('NO-CONFIRM ' + tag + ' :: ' + (await p.evaluate(() => {
          const m = document.querySelectorAll('#chatList .msg');
          return Array.from(m).slice(-3).map(x => x.className + ' | ' + x.innerText.replace(/\s+/g, ' ').slice(0, 120)).join('\n  ');
        })));
        throw e;
      }
      await p.click('.cc-ok');
      await p.waitForSelector('.err-card', { timeout: 20000 });
      await p.locator('.err-card').last().scrollIntoViewIfNeeded();
      await p.waitForTimeout(200);
      await shoot('6-error-card');
      const errText = await p.locator('.err-card').last().innerText();
      console.log('--- ' + tag + ' stage=' + JSON.stringify(stageText) + '\n' + errText + '\n');
      await ctx.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
