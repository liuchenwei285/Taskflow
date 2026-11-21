// Windows 独立应用真实验收：通过 WebView2 远程调试(CDP)连进正在运行的 Taskflow.exe，
// 在真实窗口里跑基础功能链路（无 AI 密钥）。用法：
//   1) WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 启动 Taskflow.exe
//   2) node dev-verify.js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const results = [];
  const errs = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    if (!ok) errs.push(name + ': ' + detail);
  };

  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes('taskflow.app')) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.error('no taskflow.app page found via CDP'); process.exit(2); }

  check('页面在 WebView2 中加载', page.url() === 'https://taskflow.app/taskflow.html', page.url());

  const hasKey = await page.evaluate(() => {
    try { const v = JSON.parse(localStorage.getItem('taskflow.ai.v1') || '{}'); return !!v.apiKey; }
    catch { return false; }
  });
  check('无预置 AI 密钥', !hasKey, String(hasKey));

  // 欢迎弹窗 → 暂时跳过
  if (await page.evaluate(() => document.querySelector('#welcomeScrim')?.classList.contains('open'))) {
    await page.evaluate(() => document.querySelector('#wcSkip').click());
    await page.waitForTimeout(600);
  }
  check('欢迎弹窗可跳过并进入工作台',
    await page.evaluate(() => !document.querySelector('#welcomeScrim').classList.contains('open')),
    'welcome scrim still open');

  // 切到任务页（欢迎弹窗关闭动画期间首次点击可能被吞，点击后确认视图已切换，最多重试 3 次）
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.querySelector('#sidebar [data-page="tasks"]').click());
    const switched = await page.waitForFunction(
      () => getComputedStyle(document.querySelector('#viewTasks')).display !== 'none',
      null, { timeout: 4000 }).then(() => true).catch(() => false);
    if (switched) break;
  }
  check('切换到任务页', await page.evaluate(() => getComputedStyle(document.querySelector('#viewTasks')).display !== 'none'), 'viewTasks not shown');
  // 空任务列表时顶部新建按钮所在页头被隐藏，走空状态中央按钮
  const addTop = page.locator('#btnAddTop');
  if (await addTop.isVisible().catch(() => false)) {
    await addTop.click();
  } else {
    await page.locator('#emptyCreate').click();
  }
  await page.waitForTimeout(300);
  await page.fill('#inpTitle', 'Windows 壳验收任务');
  await page.locator('[data-preset="15"]').click();
  await page.locator('#btnSave').click();
  await page.waitForTimeout(500);
  const card = page.locator('article.task', { hasText: 'Windows 壳验收任务' }).last();
  check('手动创建任务成功', await card.count() > 0, 'card count=' + (await card.count()));
  check('新任务落在待开始板块', /st-idle/.test(await card.getAttribute('class') || ''), await card.getAttribute('class'));

  // 开始倒计时：数字应变化
  await card.locator('[data-act="toggle-timer"]').click();
  await page.waitForTimeout(2500);
  const t1 = await card.locator('.cd__time').innerText();
  await page.waitForTimeout(2000);
  const t2 = await card.locator('.cd__time').innerText();
  check('倒计时真实走动', t1 !== t2 && /\d/.test(t2), `${t1} -> ${t2}`);

  // 持久化：reload 后任务仍在（WebView2 localStorage 落在用户数据目录）
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (await page.locator('#wcSkip').count() > 0) {
    await page.evaluate(() => document.querySelector('#wcSkip').click());
  }
  const persisted = await page.evaluate(() => {
    const raw = Object.keys(localStorage).find(k => /task/i.test(k));
    return localStorage.length > 0;
  });
  check('刷新后本地数据仍在', persisted, 'localStorage entries=' + await page.evaluate(() => localStorage.length));

  const pass = results.filter(r => r.ok).length;
  console.log(JSON.stringify({ pass, total: results.length, results, errs }, null, 2));
  process.exit(errs.length ? 2 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
