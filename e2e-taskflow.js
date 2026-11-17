/* TaskFlow 浏览器端 E2E 测试（真实 Chromium + DOM 交互 + localStorage 持久化验证）
   UI15：#tabs button 改为 pointer-events:none，点击由轨道委托；点击分段按钮时跳过
   Playwright 命中检查（force:true），仍按按钮中心坐标派发真实鼠标事件。断言与用例数不变。 */
const { chromium } = require('playwright');
const path = require('path');

const URL = 'http://127.0.0.1:8899/';
let pass = 0, fail = 0;
const log = [];
function eq(label, got, want){
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  log.push(`${ok?'PASS':'FAIL'}  ${label}${ok?'':`\n        got  = ${JSON.stringify(got)}\n        want = ${JSON.stringify(want)}`}`);
}
function truthy(label, v){ eq(label, !!v, true); }

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  // 固定中文环境：应用默认跟随系统语言，测试断言以中文文案为准
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text()); });
  // 屏蔽系统通知弹窗干扰
  await ctx.grantPermissions([]);

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  /* ---------- 1. 初始渲染 ---------- */
  eq('空状态渲染', await page.locator('.empty h3').textContent(), '还没有任务');
  eq('统计-计时中', await page.locator('.stat').nth(0).locator('.stat__num').textContent(), '0');
  eq('标签页数量', await page.locator('#tabs button').count(), 3);
  truthy('FAB 存在', await page.locator('#btnAdd').isVisible());

  /* ---------- 2. 新建任务（倒计时 5 分钟） ---------- */
  await page.click('#btnAdd');
  await page.waitForTimeout(320);
  truthy('编辑器打开', await page.locator('#dlgScrim.open').isVisible());
  eq('对话框标题', await page.locator('#dlgTitle').textContent(), '新建任务');

  await page.fill('#inpTitle', '完成季度报告');
  await page.fill('#inpDesc', '整理 Q3 数据并输出 PPT');
  await page.click('#segPriority [data-pri="high"]');
  await page.click('#panelDuration [data-preset="5"]');
  eq('预设 5 分钟 -> H', await page.inputValue('#inpH'), '0');
  eq('预设 5 分钟 -> M', await page.inputValue('#inpM'), '5');
  await page.click('#btnSave');
  await page.waitForTimeout(320);

  truthy('编辑器已关闭', !(await page.locator('#dlgScrim').evaluate(e => e.classList.contains('open'))));
  eq('任务卡片数量', await page.locator('.task').count(), 1);
  eq('任务标题', await page.locator('.task__title').textContent(), '完成季度报告');
  eq('说明文字', await page.locator('.task__desc').textContent(), '整理 Q3 数据并输出 PPT');
  truthy('高优先级样式', await page.locator('.task').evaluate(e => e.classList.contains('pri-high')));
  truthy('自动开始计时', await page.locator('.task').evaluate(e => e.classList.contains('is-running')));
  truthy('Snackbar 提示', await page.locator('.snack').count() > 0);

  /* ---------- 3. 倒计时实时递减 ---------- */
  const readCd = () => page.locator('.task .cd__time .cd__in').textContent();
  const t1 = await readCd();
  truthy(`倒计时初值 "${t1}" 匹配 m:ss`, /^\d+:\d{2}$/.test(t1.trim()));
  await page.waitForTimeout(2400);
  const t2 = await readCd();
  truthy(`2.4s 后倒计时变化 "${t1}" -> "${t2}"`, t1 !== t2);

  /* ---------- 4. 暂停（剩余时间冻结） ---------- */
  await page.click('.task [data-act="toggle-timer"]');
  await page.waitForTimeout(200);
  truthy('暂停后状态文案', (await page.locator('.task .cd__label').textContent()).startsWith('已暂停'));
  const p1 = await readCd();
  await page.waitForTimeout(2200);
  const p2 = await readCd();
  eq('暂停期间倒计时冻结', p1, p2);

  /* ---------- 5. 恢复计时 ---------- */
  await page.click('.task [data-act="toggle-timer"]');
  await page.waitForTimeout(2400);
  const r2 = await readCd();
  truthy(`恢复后继续递减 (${p2} -> ${r2})`, p2 !== r2);
  eq('恢复后状态文案', await page.locator('.task .cd__label').textContent(), '倒计时中');

  /* ---------- 6. localStorage 持久化 ---------- */
  const stored = await page.evaluate(() => localStorage.getItem('taskflow.tasks.v1'));
  truthy('数据已写入 localStorage', stored && stored.length > 0);
  const parsed = JSON.parse(stored || '{}');
  eq('存储任务数', parsed.tasks.length, 1);
  eq('存储标题', parsed.tasks[0].title, '完成季度报告');
  eq('存储优先级', parsed.tasks[0].priority, 'high');
  eq('存储模式', parsed.tasks[0].mode, 'duration');
  eq('存储时长 5min', parsed.tasks[0].durationMs, 300000);
  truthy('存储了剩余时间', Number.isFinite(parsed.tasks[0].remainingMs));

  /* ---------- 7. 刷新后恢复（核心需求） ---------- */
  const beforeReload = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('taskflow.tasks.v1')).tasks[0];
    return { rem: t.remainingMs, status: t.status, title: t.title };
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  eq('刷新后任务仍在', await page.locator('.task').count(), 1);
  eq('刷新后标题正确', await page.locator('.task__title').textContent(), '完成季度报告');
  const afterReload = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('taskflow.tasks.v1')).tasks[0];
    return { rem: t.remainingMs, status: t.status };
  });
  truthy(`刷新前后剩余时间衔接 (${beforeReload.rem}ms -> ${afterReload.rem}ms)`,
    Math.abs(afterReload.rem - beforeReload.rem) < 6000);
  eq('刷新后仍为运行中', afterReload.status, 'running');
  truthy('刷新后继续走时', await page.evaluate(async () => {
    const a = document.querySelector('.task .cd__time .cd__in').textContent;
    await new Promise(r => setTimeout(r, 2200));
    return document.querySelector('.task .cd__time .cd__in').textContent !== a;
  }));

  /* ---------- 8. 再建两个任务（测试排序/分组/筛选） ---------- */
  const addTask = async (title, pri, preset, mode) => {
    await page.click('#btnAdd');
    await page.waitForTimeout(320);
    await page.fill('#inpTitle', title);
    await page.click(`#segPriority [data-pri="${pri}"]`);
    if (mode === 'deadline'){
      await page.click('#typeOpts [data-mode="deadline"]');
      await page.click('#panelDeadline [data-ddl="+1h"]');
    } else {
      await page.click(`#panelDuration [data-preset="${preset}"]`);
    }
    await page.click('#btnSave');
    await page.waitForTimeout(320);
  };
  await addTask('回复客户邮件', 'medium', '45');
  await addTask('低优先级归档', 'low', '60');
  await addTask('提交投标文件（截止）', 'high', null, 'deadline');
  eq('共 4 个任务', await page.locator('.task').count(), 4);

  /* ---------- 9. 排序：剩余时间（超时置顶 / 已完成沉底） ---------- */
  await page.click('#btnSort');
  await page.waitForTimeout(200);
  await page.click('#sortMenu [data-sort="deadline"]');
  await page.waitForTimeout(250);
  eq('排序标签', await page.locator('#sortLabel').textContent(), '排序：剩余时间');
  const byDeadline = await page.locator('.task__title').allTextContents();
  // 剩余时间升序：每张卡片的剩余量应单调不减
  const remSeq = await page.locator('.task').evaluateAll(els => els.map(e => {
    const txt = e.querySelector('.cd__time .cd__in').textContent.trim();
    const p = txt.split(':').map(Number);
    return p.length === 3 ? p[0]*3600+p[1]*60+p[2] : p[0]*60+p[1];
  }));
  const sorted = remSeq.every((v,i) => i === 0 || remSeq[i-1] <= v);
  truthy(`按剩余时间升序 (${remSeq.join(' ≤ ')})`, sorted);
  eq('剩余最长的排末位', byDeadline[byDeadline.length-1], '低优先级归档');

  /* ---------- 10. 排序：优先级 ---------- */
  await page.click('#btnSort');
  await page.waitForTimeout(200);
  await page.click('#sortMenu [data-sort="priority"]');
  await page.waitForTimeout(250);
  const byPri = await page.locator('.task').evaluateAll(els => els.map(e =>
    e.classList.contains('pri-high') ? 'high' : e.classList.contains('pri-medium') ? 'medium' : 'low'));
  eq('优先级降序', byPri.join(','), 'high,high,medium,low');

  /* ---------- 11. 分组：按优先级 ---------- */
  await page.click('#btnSort');
  await page.waitForTimeout(200);
  await page.click('#sortMenu [data-group="priority"]');
  await page.waitForTimeout(250);
  const gHeads = await page.locator('.group-head__label').allTextContents();
  eq('优先级分组标题', gHeads.join(','), '高优先级,中优先级,低优先级');
  eq('分组计数', await page.locator('.group-head__n').allTextContents(), '2,1,1');

  /* ---------- 12. 分组：按状态 ---------- */
  await page.click('#btnSort');
  await page.waitForTimeout(200);
  await page.click('#sortMenu [data-group="status"]');
  await page.waitForTimeout(250);
  const sHeads = await page.locator('.group-head__label').allTextContents();
  truthy('状态分组包含「计时中」', sHeads.includes('计时中'));
  truthy('状态分组包含「未开始」', sHeads.includes('未开始'));

  /* ---------- 13. 标记完成 ---------- */
  await page.click('#btnSort'); await page.waitForTimeout(150);
  await page.click('#sortMenu [data-group="none"]'); await page.waitForTimeout(250);
  const firstCard = page.locator('.task').filter({ hasText: '完成季度报告' }).first();
  // 计时中的任务复选框禁用（语义：先停止再完成）—— 走溢出菜单重置为未开始
  eq('计时中复选框不再禁用', await firstCard.locator('.check').isDisabled(), false);
  await firstCard.locator('[data-act="more"]').click();
  await page.waitForTimeout(250);
  await page.click('#cardMenu [data-act="reset"]');
  await page.waitForTimeout(300);
  await firstCard.locator('[data-act="toggle-done"]').click();
  await page.waitForTimeout(300);
  truthy('已完成样式', await firstCard.evaluate(e => e.classList.contains('is-done')));
  eq('勾选框 aria-checked', await firstCard.locator('.check').getAttribute('aria-checked'), 'true');
  eq('状态文案', await firstCard.locator('.cd__label').textContent(), '已完成');
  const doneStats = await page.locator('.stat').nth(2).locator('.stat__num').textContent();
  truthy('统计已完成 +1', doneStats.startsWith('1'));

  /* ---------- 14. 标签页筛选：已完成 ---------- */
  await page.click('#tabs [data-view="done"]', { force:true });
  await page.waitForTimeout(250);
  eq('已完成页任务数', await page.locator('.task').count(), 1);
  eq('已完成页内容', await page.locator('.task__title').textContent(), '完成季度报告');

  /* ---------- 15. 标签页筛选：进行中 ---------- */
  await page.click('#tabs [data-view="active"]', { force:true });
  await page.waitForTimeout(250);
  eq('进行中页任务数', await page.locator('.task').count(), 3);
  await page.click('#tabs [data-view="all"]', { force:true });
  await page.waitForTimeout(250);

  /* ---------- 16. 编辑任务 ---------- */
  const editCard = page.locator('.task').filter({ hasText: '回复客户邮件' }).first();
  await editCard.locator('[data-act="more"]').click();
  await page.waitForTimeout(220);
  await page.click('#cardMenu [data-act="edit"]');
  await page.waitForTimeout(320);
  eq('编辑对话框标题', await page.locator('#dlgTitle').textContent(), '编辑任务');
  eq('预填标题', await page.inputValue('#inpTitle'), '回复客户邮件');
  eq('预填优先级', await page.locator('#segPriority [aria-pressed="true"]').getAttribute('data-pri'), 'medium');
  eq('预填时长 H', await page.inputValue('#inpH'), '0');
  // 任务已运行约 10s，编辑时预填的是「当前剩余」（44:xx）而非原始 45:00，此处只校验在合理区间
  const editM = parseInt(await page.inputValue('#inpM'), 10);
  truthy(`预填时长 M 反映剩余时间 (${editM} 分)`, editM >= 43 && editM <= 45);
  await page.fill('#inpTitle', '回复客户邮件（已修改）');
  await page.click('#segPriority [data-pri="low"]');
  await page.click('#btnSave');
  await page.waitForTimeout(320);
  truthy('标题已更新', await page.locator('.task__title').allTextContents().then(a => a.some(t => t.includes('已修改'))));
  truthy('优先级已更新', await page.locator('.task').filter({ hasText: '已修改' }).first().evaluate(e => e.classList.contains('pri-low')));
  eq('编辑未新增任务', await page.locator('.task').count(), 4);

  /* ---------- 17. 重置计时 ---------- */
  const resetCard = page.locator('.task').filter({ hasText: '低优先级归档' }).first();
  await resetCard.locator('[data-act="more"]').click();
  await page.waitForTimeout(220);
  await page.click('#cardMenu [data-act="reset"]');
  await page.waitForTimeout(300);
  eq('重置后状态', await resetCard.locator('.cd__label').textContent(), '未开始');
  // 60 分钟按 fmtDuration 规则显示为 h:mm:ss
  eq('重置后倒计时恢复满值', (await resetCard.locator('.cd__time .cd__in').textContent()).trim(), '1:00:00');
  truthy('重置后进度条归零', await resetCard.locator('.mini-progress > i').evaluate(e => { const m=/scaleX(([0-9.]+))/.exec(e.style.transform||''); return m ? parseFloat(m[1]) < 0.01 : true; }));

  /* ---------- 18. 删除（即时移除 + 撤销） ---------- */
  const delCard = page.locator('.task').filter({ hasText: '低优先级归档' }).first();
  const beforeDel = await page.locator('.task').count();
  await delCard.locator('[data-act="more"]').click();
  await page.waitForTimeout(220);
  await page.click('#cardMenu [data-act="delete"]');
  await page.waitForTimeout(350);
  eq('删除后立即移出列表', await page.locator('.task').count(), beforeDel - 1);
  truthy('出现撤销 Snackbar', await page.locator('.snack__act').count() > 0);
  await page.locator('.snack__act').last().click();
  await page.waitForTimeout(350);
  eq('撤销后任务恢复', await page.locator('.task').count(), beforeDel);

  /* ---------- 19. 截止时间模式 ---------- */
  const ddlCard = page.locator('.task').filter({ hasText: '提交投标文件' }).first();
  eq('截止模式状态文案', await ddlCard.locator('.cd__label').textContent(), '距截止');
  truthy('截止时间 chip 存在', await ddlCard.locator('.chip').allTextContents().then(a => a.some(t => t.includes('截止'))));
  const ddlTime = (await ddlCard.locator('.cd__time .cd__in').textContent()).trim();
  // 1 小时以内 -> m:ss；超过 1 小时 -> h:mm:ss。两种都合法
  truthy(`截止倒计时格式 "${ddlTime}"`, /^\d{1,2}:\d{2}(:\d{2})?$/.test(ddlTime));
  await page.waitForTimeout(2200);
  truthy('截止倒计时递减', (await ddlCard.locator('.cd__time .cd__in').textContent()).trim() !== ddlTime);
  eq('截止模式不显示进度条', await ddlCard.locator('.mini-progress').count(), 0);

  /* ---------- 20. 状态筛选（合并入筛选与排序菜单）：计时中 ---------- */
  await page.click('#btnSort');
  await page.click('#sortMenu [data-filter="running"]');
  await page.waitForTimeout(250);
  const runningCount = await page.locator('.task').count();
  truthy(`计时中筛选生效 (${runningCount} 项)`, runningCount >= 1 && runningCount < 4);
  await page.click('#btnSort');
  await page.click('#sortMenu [data-filter="all"]');
  await page.waitForTimeout(250);

  /* ---------- 21. 到期提醒（注入一个 1.2 秒后到期的任务） ---------- */
  // 先暂停所有正在计时的任务（避免它们抢先触发横幅干扰断言），
  // 暂停会触发 save()，因此必须先暂停、后注入，否则注入会被覆盖。
  await page.evaluate(() => { document.querySelectorAll('.task [data-act="toggle-timer"]').forEach(b => {
    if (b.getAttribute('aria-label') === '暂停计时') b.click();
  }); });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('taskflow.tasks.v1'));
    raw.tasks.push({
      id: 'test_expire', title: '会议提醒', desc: '', priority: 'medium', mode: 'duration',
      durationMs: 1200, remainingMs: 1200, dueAt: null, status: 'running',
      startedAt: Date.now(), alertAhead: 0, notify: true, firedAt: null, warned: false,
      createdAt: Date.now(), updatedAt: Date.now(), completedAt: null
    });
    localStorage.setItem('taskflow.tasks.v1', JSON.stringify(raw));
  });
  const injected = await page.evaluate(() => JSON.parse(localStorage.getItem('taskflow.tasks.v1')).tasks.length);
  eq('注入成功（存储层）', injected, 5);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  eq('注入的到期任务存在（渲染层）', await page.locator('.task').count(), 5);
  const expCard = page.locator('.task').filter({ hasText: '会议提醒' }).first();
  await page.waitForTimeout(2600);
  eq('到期后状态文案', await expCard.locator('.cd__label').textContent(), '已到期');
  truthy('到期横幅已弹出', await page.locator('#alertBanner.show').isVisible());
  eq('横幅标题', await page.locator('#abTitle').textContent(), '倒计时结束');
  truthy('横幅含任务名', (await page.locator('#abSub').textContent()).includes('会议提醒'));
  eq('横幅 aria-live', await page.locator('#alertBanner').getAttribute('aria-live'), 'assertive');
  // 告警抖动动画只持续约 1.1s，此处验证其可观测的终态：卡片处于超时态
  truthy('到期卡片处于到期样式', await expCard.evaluate(e => e.className.includes('st-over')));

  /* ---------- 22. 离线期间到期的补发提醒 ---------- */
  await page.evaluate(() => {
    // 模拟：任务在页面关闭期间已到期但未提醒
    const raw = JSON.parse(localStorage.getItem('taskflow.tasks.v1'));
    const t = raw.tasks.find(x => x.id === 'test_expire');
    t.firedAt = null; t.status = 'running';
    t.startedAt = Date.now() - 60000; t.remainingMs = 1000; t.warned = false;
    localStorage.setItem('taskflow.tasks.v1', JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  truthy('离线到期补发横幅', await page.locator('#alertBanner.show').isVisible());
  truthy('补发文案正确', (await page.locator('#abTitle').textContent()).includes('离线期间到期'));

  /* ---------- 23. 导出 / 导入 ---------- */
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.click('#nav [data-page="me"]');
  await page.waitForTimeout(320);
  await page.click('#btnExport');
  const download = await dl;
  truthy('导出触发下载', download && /taskflow-backup-.*\.json/.test(download.suggestedFilename()));
  await page.click('#nav [data-page="tasks"]');
  await page.waitForTimeout(250);

  /* ---------- 24. 键盘快捷键 ---------- */
  await page.keyboard.press('n');
  await page.waitForTimeout(320);
  truthy('按 N 打开编辑器', await page.locator('#dlgScrim.open').isVisible());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  truthy('Esc 关闭编辑器', !(await page.locator('#dlgScrim').evaluate(e => e.classList.contains('open'))));

  /* ---------- 25. 校验：空标题被拒绝 ---------- */
  await page.click('#btnAdd');
  await page.waitForTimeout(320);
  await page.fill('#inpTitle', '   ');
  await page.click('#btnSave');
  await page.waitForTimeout(320);
  truthy('空标题不关闭弹窗', await page.locator('#dlgScrim.open').isVisible());
  truthy('标题字段标记错误', await page.locator('#fTitle.err').count() > 0);

  /* ---------- 26. 校验：0 时长被拒绝 ---------- */
  await page.fill('#inpTitle', '测试零时长');
  await page.fill('#inpH', '0');
  await page.fill('#inpM', '0');
  await page.click('#btnSave');
  await page.waitForTimeout(320);
  truthy('0 时长不关闭弹窗', await page.locator('#dlgScrim.open').isVisible());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  /* ---------- 27. 无 JS 运行时错误 ---------- */
  eq('页面无 JS 报错', errors.length, 0);
  if (errors.length) log.push('  错误明细:\n' + errors.map(e => '   - ' + e).join('\n'));

  /* ---------- 28. 无横向溢出 / 响应式 ---------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflowMobile = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  truthy(`移动端(390px)无横向溢出 (溢出 ${overflowMobile}px)`, overflowMobile <= 1);
  truthy('移动端 FAB 可见', await page.locator('#btnAdd').isVisible());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  const overflowDesk = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  truthy(`桌面端(1280px)无横向溢出 (溢出 ${overflowDesk}px)`, overflowDesk <= 1);

  /* ---------- 29. Material Design 令牌生效 ---------- */
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      primary: s.getPropertyValue('--accent').trim(),
      bg: s.getPropertyValue('--bg').trim(),
      fabRadius: getComputedStyle(document.getElementById('btnAdd')).borderRadius,
      appbarH: getComputedStyle(document.getElementById('appbar')).height,
      font: getComputedStyle(document.body).fontFamily
    };
  });
  eq('强调色令牌（静态靛蓝）', tokens.primary.toUpperCase(), '#355C9A');
  eq('纯白底令牌', tokens.bg.toUpperCase(), '#FFFFFF');
  truthy('FAB 圆角 (>=16px)', parseFloat(tokens.fabRadius) >= 16);
  eq('AppBar 高度 56px', tokens.appbarH, '56px');
  truthy('Roboto 字体栈', /Roboto/.test(tokens.font));

  /* ---------- 30. 编辑弹窗在手机宽度下的布局回归 ----------
     背景：真机（412px）截图曾出现三处显示异常，这里加断言防止回归。
       a) 小时/分钟被媒体查询压成单列 -> 右侧大片空白
       b) 分段控件胶囊圆角被换行后的按钮直角戳穿，行尾分隔线外露
       c) 开关行说明文字被截断
  */
  for (const vw of [390, 412, 360]) {
    await page.setViewportSize({ width: vw, height: 900 });
    await page.waitForTimeout(250);
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(250);
    await page.click('#btnAdd');
    await page.waitForTimeout(350);

    const L = await page.evaluate(() => {
      const out = {};
      const seg = document.querySelector('#panelDuration .seg-line.wrap');
      const box = seg.getBoundingClientRect();
      // a) 时长输入是否两列并排
      const g = document.querySelector('#panelDuration .grid2');
      out.gridCols = getComputedStyle(g).gridTemplateColumns.split(' ').length;
      // b) 分段控件：容器不得画边框/圆角；按钮不得越出容器右边界
      const segCs = getComputedStyle(seg);
      out.segBorder = segCs.borderTopWidth;
      out.segRadius = segCs.borderRadius;
      const btns = [...seg.querySelectorAll('button')].map(b => b.getBoundingClientRect());
      out.bleed = btns.filter(r => r.right > box.right + 0.5).length;
      // 每个按钮自身应有圆角（避免直角戳穿）
      out.btnRadii = [...seg.querySelectorAll('button')]
        .map(b => parseFloat(getComputedStyle(b).borderRadius) || 0);
      // 行内最后一个按钮不应有右侧分隔线露在外面（用圆角+独立边框后天然满足）
      // c) 开关行文字是否被截断（滚动宽 > 可视宽 即为截断）
      out.truncated = [...document.querySelectorAll('#dlgScrim .switch-row__d')]
        .filter(d => d.scrollWidth > d.clientWidth + 1).length;
      // 文字块不得横向压到开关。
      // 注意：纵向重叠是正常的 —— switch-row 是 align-items:center，
      // 说明文字换行后比开关高，底部自然会低过开关底边。
      // 真正要防的是「横向侵入」，即文字右边界越过开关左边界。
      out.textHitsSwitch = [...document.querySelectorAll('#dlgScrim .switch-row')]
        .filter(sr => {
          const d = sr.querySelector('.switch-row__d').getBoundingClientRect();
          const w = sr.querySelector('.switch').getBoundingClientRect();
          return d.right > w.left + 0.5;
        }).length;
      // 弹窗整体不得横向溢出
      out.overflow = document.documentElement.scrollWidth - window.innerWidth;
      return out;
    });

    eq(`${vw}px 时长输入为两列`, L.gridCols, 2);
    eq(`${vw}px 分段容器不画边框`, L.segBorder, '0px');
    eq(`${vw}px 分段容器无胶囊圆角`, L.segRadius, '0px');
    eq(`${vw}px 分段按钮不越界`, L.bleed, 0);
    truthy(`${vw}px 分段按钮各自有圆角`, L.btnRadii.every(r => r >= 10));
    eq(`${vw}px 开关说明无截断`, L.truncated, 0);
    eq(`${vw}px 开关文字不横向压开关`, L.textHitsSwitch, 0);
    truthy(`${vw}px 弹窗无横向溢出 (溢出 ${L.overflow}px)`, L.overflow <= 1);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);

  /* ---------- 31. 截图 ---------- */
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const now = Date.now();
    const mk = (o) => Object.assign({
      id: 'd_' + Math.random().toString(36).slice(2), desc:'', priority:'medium', mode:'duration',
      durationMs: 0, remainingMs: 0, dueAt: null, status:'idle', startedAt: null,
      alertAhead: 300, notify: true, firedAt: null, warned: false,
      createdAt: now, updatedAt: now, completedAt: null
    }, o);
    const list = [
      mk({ id:'d1', title:'完成季度报告', desc:'整理 Q3 数据并输出 PPT', priority:'high',
           durationMs: 25*60000, remainingMs: 24*60000+39000, startedAt: now-81000, _baseRemaining:25*60000, status:'running' }),
      mk({ id:'d2', title:'提交投标文件', desc:'截至今日 18:00 前上传至采购平台', priority:'high',
           mode:'deadline', dueAt: now + 2*3600000 + 14*60000, status:'idle' }),
      mk({ id:'d3', title:'回复客户邮件', desc:'确认下周演示时间与参会人', priority:'medium',
           durationMs: 45*60000, remainingMs: 45*60000, status:'idle' }),
      mk({ id:'d4', title:'整理竞品资料', desc:'', priority:'low',
           durationMs: 60*60000, remainingMs: 41*60000+12000, startedAt: now-1130000, _baseRemaining:60*60000, status:'paused' }),
      mk({ id:'d5', title:'周会纪要归档', desc:'', priority:'low',
           durationMs: 20*60000, remainingMs: 0, status:'done', completedAt: now-5400000 }),
      mk({ id:'d6', title:'续订服务器证书', desc:'已超时 2 小时，尽快处理', priority:'high',
           mode:'deadline', dueAt: now - 2*3600000, status:'finished', firedAt: now-2*3600000 })
    ];
    localStorage.setItem('taskflow.tasks.v1', JSON.stringify({ v:1, tasks:list, savedAt: now }));
    localStorage.setItem('taskflow.prefs.v1', JSON.stringify({ sort:'deadline', group:'none', view:'all', running:'all' }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, 'taskflow-preview.png'), fullPage: true });
  log.push('   截图: taskflow-preview.png');
  await page.click('#btnAdd');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(__dirname, 'taskflow-editor.png') });
  log.push('   截图: taskflow-editor.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.click('#btnSort');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, 'taskflow-sortmenu.png') });
  log.push('   截图: taskflow-sortmenu.png');

  /* ---------- 31. 深色模式（无桥降级路径跟随系统） ---------- */
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  eq('深色模式主题标记', await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  const darkTok = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { surf: s.getPropertyValue('--bg').trim().toUpperCase(),
             pri: s.getPropertyValue('--accent').trim().toUpperCase() };
  });
  eq('深色模式底色', darkTok.surf, '#111317');
  eq('深色模式强调色（浅靛蓝）', darkTok.pri, '#A9C1F5');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(200);
  eq('恢复浅色模式', await page.evaluate(() => document.documentElement.dataset.theme), 'light');

  /* ---------- 32. 主题令牌下发（模拟原生读取 colors.xml / values-night） ---------- */
  await page.evaluate(() => {
    window.__onThemeTokens({
      light: { '--bg': '#FFFDF5', '--surface': '#FFFFFF', '--accent': '#88CC22', '--text': '#111111' },
      dark:  { '--bg': '#101010', '--surface': '#1A1A1A', '--accent': '#88CC22', '--text': '#EEEEEE' },
      darkActive: false
    });
  });
  const tk = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      bg: s.getPropertyValue('--bg').trim().toUpperCase(),
      accent: s.getPropertyValue('--accent').trim().toUpperCase(),
      meta: document.querySelector('meta[name="theme-color"]').getAttribute('content').toUpperCase()
    };
  });
  eq('令牌下发后底色更新', tk.bg, '#FFFDF5');
  eq('令牌下发后强调色更新', tk.accent, '#88CC22');
  eq('状态栏着色随底色更新', tk.meta, '#FFFDF5');

  /* ---------- 33. 空状态互斥 + 统计一致性（固定种子） ---------- */
  // 说明：syncFromStorage 只接受「数量不少于内存」的存储，故种子数量需大于既有集合
  await page.evaluate(() => {
    const now = Date.now();
    const mk = (o) => Object.assign({ id:'s'+Math.random().toString(36).slice(2), desc:'', priority:'medium', mode:'duration', durationMs:0, remainingMs:0, dueAt:null, status:'idle', startedAt:null, alertAhead:300, notify:true, firedAt:null, warned:false, createdAt:now, updatedAt:now, completedAt:null }, o);
    const list = [];
    for (let i = 1; i <= 9; i++) list.push(mk({ id:'s'+i, title:'种子任务' + i, durationMs:30*60000, remainingMs:30*60000, status:'idle' }));
    for (let i = 10; i <= 12; i++) list.push(mk({ id:'s'+i, title:'计时任务' + i, durationMs:30*60000, remainingMs:20*60000, startedAt:now-600000, _baseRemaining:30*60000, status:'running' }));
    localStorage.setItem('taskflow.tasks.v1', JSON.stringify({ v:1, savedAt:now, tasks:list }));
    localStorage.setItem('taskflow.prefs.v1', JSON.stringify({ sort:'deadline', group:'none', view:'all', running:'all', theme:'light' }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  eq('种子任务数', await page.locator('.task').count(), 12);
  await page.click('#tabs [data-view="done"]', { force:true });
  await page.waitForTimeout(350);
  eq('互斥-筛选空集时不渲染任务卡', await page.locator('.task').count(), 0);
  eq('互斥-空状态唯一', await page.locator('.empty').count(), 1);
  eq('互斥-筛选空态文案', await page.locator('.empty h3').textContent(), '没有符合筛选的任务');
  truthy('统计不受筛选影响（分母为全集）',
    /^0$/.test((await page.locator('.stat').nth(2).locator('.stat__num').textContent()).replace(/\s+/g, ' ').trim()));

  /* 缺陷 A 回归：完成一条任务 -> 统计 1/12，已完成标签 1 项 */
  await page.click('#tabs [data-view="all"]', { force:true });
  await page.waitForTimeout(300);
  await page.locator('.task').filter({ hasText: '种子任务1' }).first().locator('[data-act="toggle-done"]').click();
  await page.waitForTimeout(400);
  eq('统计显示已完成 1',
    (await page.locator('.stat').nth(2).locator('.stat__num').textContent()).replace(/\s+/g, ' ').trim(), '1');
  await page.click('#tabs [data-view="done"]', { force:true });
  await page.waitForTimeout(350);
  eq('已完成标签下列表数量与统计一致', await page.locator('.task').count(), 1);
  eq('互斥-有任务时空状态隐藏', await page.locator('.empty').count(), 0);
  await page.click('#tabs [data-view="all"]', { force:true });
  await page.waitForTimeout(300);

  /* ---------- 34. 底部导航 / 触控区 / 指示块 / 菜单锚点 ---------- */
  eq('底栏导航四项', await page.locator('#nav button').count(), 4);
  eq('底栏含智能排程', await page.locator('#nav [data-page="schedule"]').count(), 1);
  eq('右上角仅主题按钮', await page.locator('.appbar button').count(), 1);
  eq('问号入口已移入我的', await page.locator('#nav [data-page="me"]').count(), 1);
  await page.click('#nav [data-page="me"]');
  await page.waitForTimeout(300);
  truthy('我的页可见', await page.locator('#viewMe').isVisible());
  truthy('我的页含通知状态', (await page.locator('#notifyHint').textContent()).length > 0);
  await page.click('#nav [data-page="tasks"]');
  await page.waitForTimeout(300);

  const geo = await page.evaluate(() => {
    const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      card: r('.task'), stats: r('.stats'), appbar: r('.appbar'),
      check: r('.task .check'), more: r('.task .more'), theme: r('#btnTheme'),
      segBtn: r('#tabs button'), navBtn: r('#nav button'),
      trackL: Math.round(document.querySelector('.appbar').getBoundingClientRect().left),
      fab: r('.fab')
    };
  });
  eq('卡片左边界落在内容轨道', geo.card.l, geo.trackL + 20);
  eq('卡片右边界落在内容轨道', geo.card.l + geo.card.w, geo.appbar.w - 20);
  truthy('复选框触控区 >= 48dp', geo.check.w >= 48 && geo.check.h >= 48);
  truthy('更多按钮触控区 >= 48dp', geo.more.w >= 48 && geo.more.h >= 48);
  truthy('主题按钮触控区 >= 48dp', geo.theme.w >= 48 && geo.theme.h >= 48);
  truthy('分段按钮视觉高度 >= 40dp', geo.segBtn.h >= 40);
  truthy('分段容器高度 48dp', (await page.evaluate(() => document.querySelector('.seg').getBoundingClientRect().height)) >= 48);
  truthy('导航项高度 >= 48dp', geo.navBtn.h >= 48);
  truthy('FAB 右边距落在轨道', Math.abs((geo.fab.l + geo.fab.w) - (geo.appbar.w - 20)) <= 1);

  // 分段指示块落在 1/3、2/3
  await page.click('#tabs [data-view="active"]', { force:true });
  await page.waitForTimeout(420);
  const ind2 = await page.evaluate(() => {
    const i = document.getElementById('segInd').getBoundingClientRect();
    const b = document.querySelectorAll('#tabs button')[1].getBoundingClientRect();
    return { indC: i.left + i.width / 2, btnC: b.left + b.width / 2, indW: i.width };
  });
  truthy('第 2 段：滑块中心与文字中心重合 (≤1dp)', Math.abs(ind2.indC - ind2.btnC) <= 1);
  const segGeo = await page.evaluate(() => {
    const s = document.querySelector('.seg').getBoundingClientRect();
    const i = document.getElementById('segInd').getBoundingClientRect();
    return { w: s.width, indW: i.width };
  });
  truthy('滑块宽 = 总宽/3 - 8', Math.abs(segGeo.indW - (segGeo.w / 3 - 8)) <= 1);
  await page.click('#tabs [data-view="done"]', { force:true });
  await page.waitForTimeout(420);
  const ind3 = await page.evaluate(() => {
    const i = document.getElementById('segInd').getBoundingClientRect();
    const b = document.querySelectorAll('#tabs button')[2].getBoundingClientRect();
    return { indC: i.left + i.width / 2, btnC: b.left + b.width / 2 };
  });
  truthy('第 3 段：滑块中心与文字中心重合 (≤1dp)', Math.abs(ind3.indC - ind3.btnC) <= 1);

  // 排序菜单锚点
  await page.click('#tabs [data-view="all"]', { force:true });
  await page.waitForTimeout(250);
  await page.click('#btnSort');
  await page.waitForTimeout(300);
  const menuGeo = await page.evaluate(() => {
    const b = document.getElementById('btnSort').getBoundingClientRect();
    const m = document.getElementById('sortMenu').getBoundingClientRect();
    const it = document.querySelector('#sortMenu .menu__item').getBoundingClientRect();
    return { bl: Math.round(b.left), ml: Math.round(m.left), mw: Math.round(m.width), ih: Math.round(it.height) };
  });
  eq('菜单左边缘落在 20dp 轨道', menuGeo.ml, 20);
  truthy('菜单最小宽度 >= 240dp', menuGeo.mw >= 240);
  truthy('菜单项高度 >= 48dp', menuGeo.ih >= 48);

  // 主题切换：图标/主题标记翻转，且结束后解除滚动锁
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#btnTheme');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    locked: document.body.classList.contains('is-locked')
  }));
  truthy('主题切换生效', after.theme !== before);
  truthy('扩散结束后解除滚动锁', after.locked === false);

  // 无 emoji 图标
  const emoji = await page.evaluate(() => {
    const txt = document.body.innerText;
    return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(txt);
  });
  eq('界面无 emoji 字形', emoji, false);

  /* ---------- 31. 宽屏侧栏骨架（≥900px，仅非 APK） ---------- */
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(350);
  // 31a. 1280 下侧栏可见、底部导航隐藏
  truthy('1280 宽：侧栏可见', await page.locator('#sidebar').isVisible());
  truthy('1280 宽：底部导航隐藏', !(await page.locator('#nav').isVisible()));
  truthy('1280 宽：分段控件隐藏', !(await page.locator('#tabs').isVisible()));
  truthy('1280 宽：desktop-layout 生效',
    await page.evaluate(() => document.body.classList.contains('desktop-layout')));

  // 31b. 点击侧栏各入口切换页面、当前页高亮正确
  for (const pg of ['stats', 'schedule', 'me', 'tasks']){
    await page.click(`#sidebar [data-page="${pg}"]`);
    await page.waitForTimeout(120);
    const state = await page.evaluate(() => ({
      view: [...document.querySelectorAll('.view')].filter(v => !v.classList.contains('hidden')).map(v => v.id),
      current: [...document.querySelectorAll('#sidebar button[aria-current="page"]')].map(b => b.dataset.page)
    }));
    eq(`侧栏 ${pg}：视图唯一切换`, state.view.length === 1 && state.view[0] === 'view' + pg.charAt(0).toUpperCase() + pg.slice(1), true);
    eq(`侧栏 ${pg}：高亮唯一且正确`, state.current.length === 1 && state.current[0] === pg, true);
  }

  // 31d. 侧栏收放 + 底部品牌/主题/设置 + 双主题按钮同步
  const sideW = () => page.evaluate(() => Math.round(document.getElementById('sidebar').getBoundingClientRect().width));
  const wideW = await sideW();
  truthy('侧栏展开宽度 240px', wideW === 240);
  await page.click('#sidebarToggle');
  await page.waitForTimeout(320);   /* 等收放过渡走完再量宽度 */
  eq('收起后宽度 64px', await sideW(), 64);
  eq('收起后 aria-expanded=false', await page.getAttribute('#sidebarToggle', 'aria-expanded'), 'false');
  truthy('收起后品牌文字隐藏', !(await page.locator('.sidebar__footer-brand').isVisible()));
  truthy('收起后主题按钮仍可见', await page.locator('#btnThemeSide').isVisible());
  truthy('收起后设置按钮仍可见', await page.locator('#sidebar [data-page="me"]').isVisible());
  await page.click('#sidebarToggle');
  await page.waitForTimeout(320);   /* 等展开过渡走完再量宽度 */
  eq('再展开宽度 240px', await sideW(), 240);
  // 底部顺序：主题按钮在设置按钮左边
  const footOrder = await page.evaluate(() => {
    const t = document.getElementById('btnThemeSide').getBoundingClientRect();
    const s = document.querySelector('#sidebar [data-page="me"]').getBoundingClientRect();
    return t.x < s.x;
  });
  truthy('底部：设置在主题右边', footOrder);
  // 双主题按钮 aria 同步
  const beforeTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#btnThemeSide');
  await page.waitForTimeout(120);
  const sync = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    app: document.getElementById('btnTheme').getAttribute('aria-pressed'),
    side: document.getElementById('btnThemeSide').getAttribute('aria-pressed')
  }));
  truthy('侧栏主题按钮切换生效', sync.theme !== beforeTheme);
  eq('双主题按钮 aria 同步', sync.app, sync.side);

  // 31c. 390 宽：侧栏不可见，底部分段/导航可见（布局与改版前一致）
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  truthy('390 宽：侧栏不可见', !(await page.locator('#sidebar').isVisible()));
  truthy('390 宽：底部导航可见', await page.locator('#nav').isVisible());
  truthy('390 宽：desktop-layout 未生效',
    !(await page.evaluate(() => document.body.classList.contains('desktop-layout'))));

  await browser.close();

  console.log(log.join('\n'));
  console.log('\n' + '='.repeat(60));
  console.log(`浏览器 E2E 结果：${pass} passed, ${fail} failed, ${pass+fail} total`);
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log(log.join('\n'));
  console.error('\nFATAL: ' + e.message + '\n' + e.stack);
  process.exit(2);
});
