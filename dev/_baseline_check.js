/* 无 AI 密钥基础功能真实验收：全程真实 UI 操作，不注入任何演示数据。
   覆盖：手动建任务（双时间语义）→ 待开始 → 开始/暂停/继续/完成 → 搜索过滤 → 统计落账。
   顺带采集横屏截图 post-10-manual-editor.png 供论坛帖使用。 */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'https://taskflow-app-3qo4c3iuyvd.qoder.zone/';
const OUT = path.resolve(__dirname, '../submission/img');
const TITLE = '高数作业 · 第三章习题（手动创建）';

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const results = [];
  const check = (name, ok, extra) => results.push({ name, ok: !!ok, extra: extra === undefined ? '' : extra });

  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  check('无预置 AI 密钥', await p.evaluate(() => {
    const raw = localStorage.getItem('taskflow.ai.v1');
    if (!raw) return true;
    try { return !JSON.parse(raw).apiKey; } catch (_) { return true; }
  }));
  check('无预置任务', await p.evaluate(() => !localStorage.getItem('taskflow.tasks.v1')));

  await p.locator('button:has-text("暂时跳过")').click();
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#sidebar [data-page="tasks"]').click());
  await p.waitForTimeout(900);

  await p.locator('#btnAddTop').click();
  await p.waitForTimeout(500);
  check('编辑器默认手动模式', await p.locator('#segEditorMode [data-emode="manual"]').getAttribute('aria-pressed') === 'true');
  await p.fill('#inpTitle', TITLE);
  await p.fill('#inpDesc', '中值定理证明 6 道 + 洛必达极限 4 道');
  await p.locator('#segPriority [data-pri="high"]').click();
  await p.locator('#panelDuration [data-preset="45"]').click();
  await p.locator('#panelDeadline [data-ddl="today_eod"]').click();
  check('截止面板可见（任务模式双语义）', await p.locator('#panelDeadline').isVisible());
  check('番茄钟面板隐藏（任务模式）', !(await p.locator('#panelPomodoro').isVisible()));
  await p.screenshot({ path: path.join(OUT, 'post-10-manual-editor.png') });
  await p.locator('#btnSave').click();
  await p.waitForTimeout(700);

  const card = p.locator('article.task', { hasText: TITLE });
  check('保存后卡片存在', await card.count() === 1);
  check('默认待开始（有开始按钮）', await card.locator('[data-act="toggle-timer"]').first().isVisible());
  check('保存后为待开始态（st-idle）', /st-idle/.test(await card.getAttribute('class')));

  await card.locator('.task__actions [data-act="toggle-timer"]').click();
  await p.waitForTimeout(2300);
  const t1 = await card.locator('.cd__time').innerText();
  await p.waitForTimeout(2100);
  const t2 = await card.locator('.cd__time').innerText();
  check('倒计时真实走动', t1 !== t2, t1 + ' -> ' + t2);
  check('运行态有暂停按钮', await card.locator('.task__actions [data-act="toggle-timer"]:has-text("暂停")').count() === 1);

  await card.locator('.task__actions [data-act="toggle-timer"]').click();
  await p.waitForTimeout(500);
  check('暂停后可继续', await card.locator('.task__actions [data-act="toggle-timer"]:has-text("继续")').count() === 1);
  const paused1 = await card.locator('.cd__time').innerText();
  await p.waitForTimeout(2000);
  const paused2 = await card.locator('.cd__time').innerText();
  check('暂停期间数字冻结', paused1 === paused2);

  await card.locator('.task__actions [data-act="toggle-timer"]').click();
  await p.waitForTimeout(1500);
  await card.locator('.task__actions [data-act="toggle-done"]').click();
  await p.waitForTimeout(700);
  check('完成后勾选态', await card.locator('.check').getAttribute('aria-checked') === 'true');
  const sessions = await p.evaluate(() => JSON.parse(localStorage.getItem('taskflow.tasks.v1')).sessions.length);
  check('专注记录落账', sessions >= 1, 'sessions=' + sessions);

  await p.fill('#searchInput', '高数');
  await p.waitForTimeout(500);
  check('搜索命中 1 条', await p.locator('article.task:visible').count() === 1);
  await p.fill('#searchInput', '不存在的任务zzz');
  await p.waitForTimeout(500);
  check('搜索无结果清空列表', await p.locator('article.task:visible').count() === 0);
  await p.fill('#searchInput', '');
  await p.waitForTimeout(400);

  await p.evaluate(() => document.querySelector('#sidebar [data-page="stats"]').click());
  await p.waitForTimeout(900);
  const statsText = await p.evaluate(() => document.querySelector('#viewStats').innerText);
  check('统计页渲染今日专注块', /今日专注/.test(statsText));

  console.log(JSON.stringify({ results, pass: results.filter(r => r.ok).length, total: results.length, errs }, null, 1));
  await b.close();
  if (results.some(r => !r.ok) || errs.length) process.exit(2);
})().catch(e => { console.error('FATAL', e); process.exit(1); });