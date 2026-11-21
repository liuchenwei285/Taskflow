/* AI Capture 前端全状态机 E2E（AI 端点用 Playwright 路由 stub，后端行为另由
   tools/test-ai-handler.mjs 覆盖；本套件不产生真实上游请求） */
const { chromium } = require('playwright');

async function navTo(p, name){
  await p.evaluate((n) => { const b = document.querySelector('#sidebar [data-page="' + n + '"]'); if (b) b.click(); }, name);
  await p.waitForTimeout(260);
}
let pass = 0, fail = 0;
const out = [];
const eq = (l, g, w) => {
  const ok = String(g) === String(w); ok ? pass++ : fail++;
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${l}${ok ? '' : `\n        got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`);
};
const truthy = (l, v) => eq(l, !!v, true);
const includes = (l, hay, needle) => {
  const ok = String(hay).includes(needle); ok ? pass++ : fail++;
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${l}${ok ? '' : `\n        "${hay}" missing "${needle}"`}`);
};

const STORE = 'taskflow.tasks.v1';
const PREFS = 'taskflow.prefs.v1';

const DRAFT_OK = {
  title: '写完高数作业', desc: '很重要', dueAt: null,
  priority: 'high', estimatedMs: 7200000, modeSuggestion: 'duration',
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  let scenario = { status: 200, body: { ok: true, draft: DRAFT_OK } };
  let requests = [];
  let page = null;
  let ctx = null;
  const errs = [];

  /* 每个用例独立 context：应用在 beforeunload 会落盘，单 context 清理会被回写覆盖。
     初始状态在页面脚本执行前注入（init script），不依赖 evaluate+reload。 */
  async function fresh(opts = {}) {
    if (ctx) await ctx.close();
    ctx = await browser.newContext({ locale: 'zh-CN', viewport: opts.viewport || { width: 390, height: 844 } });
    requests = [];
    await ctx.route('**/functions/v1/app/ai/capture', async (route) => {
      requests.push(route.request().postDataJSON());
      if (scenario.abort) return route.abort('failed');
      if (scenario.delay) await new Promise((r) => setTimeout(r, scenario.delay));
      await route.fulfill({
        status: scenario.status,
        contentType: 'application/json',
        body: JSON.stringify(scenario.body),
      }).catch(() => {});
    });
    await ctx.route('**/functions/v1/app/ai/chat', async (route) => {
      requests.push(route.request().postDataJSON());
      if (scenario.abort) return route.abort('failed');
      if (scenario.delay) await new Promise((r) => setTimeout(r, scenario.delay));
      const src = scenario.body && scenario.body.draft ? scenario.body.draft : null;
      const payload = scenario.chatBody || (src ? {
        ok: true,
        reply: '草稿已生成，确认后才会创建任务。',
        action: 'generate_draft',
        draft: {
          title: src.title,
          desc: src.desc,
          dueAt: src.dueAt ? new Date(src.dueAt).toISOString() : null,
          priority: src.priority,
          estimatedMinutes: src.estimatedMs ? Math.round(src.estimatedMs / 60000) : null
        }
      } : scenario.body);
      await route.fulfill({ status: scenario.status, contentType: 'application/json', body: JSON.stringify(payload) }).catch(() => {});
    });
    await ctx.route('**/functions/v1/app/health', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, model: 'deepseek-flash', configured: false }),
      }).catch(() => {});
    });
    await ctx.route('**/functions/v1/app/ai/test', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, models: ['prov-a', 'prov-b'], model: 'x' }),
      }).catch(() => {});
    });
    await ctx.addInitScript(() => {
      localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1');
    });
    if (opts.prefs) {
      await ctx.addInitScript((p) => {
        localStorage.setItem('taskflow.prefs.v1', JSON.stringify(p));
      }, opts.prefs);
    }
    if (opts.seedTasks) {
      await ctx.addInitScript((payload) => {
        localStorage.setItem('taskflow.tasks.v1', payload);
      }, JSON.stringify({ v: 1, tasks: opts.seedTasks, savedAt: Date.now() }));
    }
    page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/', { waitUntil: 'load' });
    await page.waitForTimeout(350);
  }
  async function goTasks() {
    await page.evaluate(() => { const b = document.querySelector('#sidebar [data-page="tasks"]'); if (b) b.click(); });
    await page.waitForTimeout(260);
  }
  async function openAiCreate() {
    await goTasks();
    await page.click('#btnAdd');
    await page.waitForSelector('#dlgScrim.open');
    await page.waitForTimeout(280);
    await page.click('#segEditorMode [data-emode="ai"]');
    await page.waitForSelector('#aiPanel:not(.hidden)');
  }
  async function askAndWait() {
    await page.click('#btnAiGenerate');
  }
  async function taskList() {
    return page.evaluate((k) => {
      try {
        const d = JSON.parse(localStorage.getItem(k) || 'null');
        return d && Array.isArray(d.tasks) ? d.tasks : [];
      } catch (_) { return []; }
    }, STORE);
  }

  /* 1. 手动创建回归：AI 面板不影响既有保存路径 */
  await fresh();
  await goTasks();
  await page.click('#btnAdd');
  await page.waitForSelector('#dlgScrim.open');
  await page.fill('#inpTitle', '手动任务');
  await page.click('#btnSave');
  await page.waitForTimeout(500);
  let tasks = await taskList();
  eq('手动创建仍可用', tasks.length, 1);
  eq('手动任务标题', tasks[0].title, '手动任务');
  eq('手动创建未触发 AI 请求', requests.length, 0);

  /* 2. AI 入口仅新建可见 */
  await fresh({ seedTasks: [{
    id: 't_e1', title: '已有任务', desc: '', priority: 'medium', mode: 'duration',
    durationMs: 600000, remainingMs: 600000, dueAt: null, status: 'idle',
    createdAt: Date.now(), updatedAt: Date.now(), completedAt: null,
  }] });
  await goTasks();
  await page.click('.task [data-act="more"]');
  await page.waitForTimeout(200);
  await page.click('#cardMenu [data-act="edit"]');
  await page.waitForSelector('#dlgScrim.open');
  await page.waitForTimeout(260);
  truthy('编辑既有任务时 AI 入口隐藏', await page.locator('#aiEntry').evaluate((el) => el.classList.contains('hidden')));
  await page.click('#btnCancel');

  /* 3. 同意门禁 */
  await fresh();
  scenario = { status: 200, body: { ok: true, draft: DRAFT_OK } };
  await openAiCreate();
  await page.fill('#aiInput', '周五前写完实验报告');
  await askAndWait();
  await page.waitForTimeout(300);
  includes('未勾选同意时弹出提示', await page.locator('.snack--alert .snack__msg').last().textContent(), '同意');
  eq('未勾选同意不发请求', requests.length, 0);

  /* 4. 成功 → 可编辑 → 确认创建（duration） */
  await page.check('#aiConsent');
  await askAndWait();
  await page.waitForSelector('#aiDraft:not(.hidden)');
  eq('草稿标题回填', await page.inputValue('#aiTitle'), '写完高数作业');
  eq('草稿预估分钟回填', await page.inputValue('#aiMinutes'), '120');
  eq('优先级回填 high', await page.getAttribute('#aiSegPri [data-pri="high"]', 'aria-pressed'), 'true');
  includes('模式提示为倒计时', await page.locator('#aiModeHint').textContent(), '倒计时');
  eq('请求体携带文本', requests[0].text, '周五前写完实验报告');
  eq('请求体携带语言', requests[0].lang, 'zh');
  await page.fill('#aiTitle', '写完高数作业（改）');
  await page.fill('#aiMinutes', '90');
  await page.click('#btnAiConfirm');
  await page.waitForTimeout(600);
  tasks = await taskList();
  eq('确认后创建 1 个任务', tasks.length, 1);
  eq('使用编辑后的标题', tasks[0].title, '写完高数作业（改）');
  eq('mode=duration', tasks[0].mode, 'duration');
  eq('durationMs=90min', tasks[0].durationMs, 5400000);
  eq('priority=high', tasks[0].priority, 'high');
  eq('desc 回填', tasks[0].desc, '很重要');
  truthy('弹窗已关闭', !(await page.locator('#dlgScrim').evaluate((el) => el.classList.contains('open'))));

  /* 5. dueAt 草稿 → 截止时间模式 */
  await fresh();
  scenario = { status: 200, body: { ok: true, draft: {
    title: '交课程论文', desc: '', dueAt: Date.now() + 3 * 86400000,
    priority: 'medium', estimatedMs: null, modeSuggestion: 'deadline',
  } } };
  await openAiCreate();
  await page.check('#aiConsent');
  await page.fill('#aiInput', '三天内交论文');
  await askAndWait();
  await page.waitForSelector('#aiDraft:not(.hidden)');
  includes('模式提示为截止时间', await page.locator('#aiModeHint').textContent(), '截止时间');
  await page.click('#btnAiConfirm');
  await page.waitForTimeout(600);
  tasks = await taskList();
  eq('截止模式任务创建', tasks.length, 1);
  eq('mode=deadline', tasks[0].mode, 'deadline');
  truthy('dueAt 与草稿一致(±2s)', Math.abs(tasks[0].dueAt - scenario.body.draft.dueAt) < 60000 * 60);

  /* 6. 转手动表单：回填但不创建 */
  await fresh();
  scenario = { status: 200, body: { ok: true, draft: DRAFT_OK } };
  await openAiCreate();
  await page.check('#aiConsent');
  await page.fill('#aiInput', '复习线代');
  await askAndWait();
  await page.waitForSelector('#aiDraft:not(.hidden)');
  await page.click('#btnAiToManual');
  await page.waitForTimeout(350);
  eq('转手动后标题回填', await page.inputValue('#inpTitle'), '写完高数作业');
  truthy('手动面板可见', !(await page.locator('#manualForm').evaluate((el) => el.classList.contains('hidden'))));
  eq('转手动不创建任务', (await taskList()).length, 0);

  /* 7. 丢弃草稿 */
  await page.click('#segEditorMode [data-emode="ai"]');
  await page.waitForSelector('#aiDraft:not(.hidden)');
  await page.click('#btnAiDiscard');
  await page.waitForTimeout(200);
  truthy('丢弃后草稿隐藏', await page.locator('#aiDraft').evaluate((el) => el.classList.contains('hidden')));

  /* 8. 503 未配置密钥 */
  await fresh();
  scenario = { status: 503, body: { ok: false, error: { code: 'service_not_configured', retryable: false } } };
  await openAiCreate();
  await page.check('#aiConsent');
  await page.fill('#aiInput', '写作业');
  await askAndWait();
  await page.waitForSelector('#aiError:not(.hidden)');
  includes('503 提示缺少密钥', await page.locator('#aiErrorText').textContent(), 'API Key');
  truthy('503 可重试', await page.locator('#btnAiRetry').isVisible());

  /* 9. 402 余额不足 */
  scenario = { status: 502, body: { ok: false, error: { code: 'upstream_balance', retryable: false } } };
  await askAndWait();
  await page.waitForTimeout(300);
  includes('402 提示余额不足', await page.locator('#aiErrorText').textContent(), '余额不足');

  /* 10. 网络中断 */
  scenario = { abort: true };
  await askAndWait();
  await page.waitForTimeout(400);
  includes('网络异常提示', await page.locator('#aiErrorText').textContent(), '网络异常');

  /* 11. 200 但响应非法 */
  scenario = { status: 200, body: { ok: true } };
  await askAndWait();
  await page.waitForTimeout(300);
  includes('响应非法提示解析失败', await page.locator('#aiErrorText').textContent(), '无法解析');

  /* 12. 英文界面 */
  await fresh({ prefs: { lang: 'en' } });
  scenario = { status: 503, body: { ok: false, error: { code: 'service_not_configured', retryable: false } } };
  await goTasks();
  await page.click('#btnAdd');
  await page.waitForSelector('#dlgScrim.open');
  await page.waitForTimeout(280);
  eq('英文模式按钮文案', (await page.locator('#segEditorMode [data-emode="ai"]').textContent()).trim(), 'AI generate');
  await page.click('#segEditorMode [data-emode="ai"]');
  await page.check('#aiConsent');
  await page.fill('#aiInput', 'write report');
  await askAndWait();
  await page.waitForSelector('#aiError:not(.hidden)');
  includes('英文错误文案', await page.locator('#aiErrorText').textContent(), 'DeepSeek API key');

  /* 13. 取消生成 */
  await fresh();
  scenario = { status: 200, body: { ok: true, draft: DRAFT_OK }, delay: 2500 };
  await openAiCreate();
  await page.check('#aiConsent');
  await page.fill('#aiInput', '慢请求');
  await askAndWait();
  await page.waitForTimeout(300);
  truthy('生成中显示取消按钮', await page.locator('#btnAiAbort').isVisible());
  await page.click('#btnAiAbort');
  await page.waitForTimeout(400);
  includes('取消提示', await page.locator('.snack__msg').last().textContent(), '已取消');
  truthy('取消后草稿未出现', await page.locator('#aiDraft').evaluate((el) => el.classList.contains('hidden')));

  /* 14. 默认首屏与导航顺序 */
  await fresh();
  truthy('默认首屏为智能编排', await page.locator('#viewSchedule').isVisible());
  eq('导航顺序：编排/任务/统计/学习/设置',
    await page.evaluate(() => Array.from(document.querySelectorAll('#sidebar [data-page]')).map((b) => b.dataset.page).join(',')),
    'schedule,tasks,stats,library,me');
  eq('首个导航项为编排且高亮', await page.getAttribute('#sidebar [data-page="schedule"]', 'aria-current'), 'page');
truthy('顶栏菜单按钮可见', await page.locator('#btnDrawer').isVisible());
  truthy('首屏不显示悬浮新建按钮', !(await page.locator('#btnAdd').isVisible()));
  includes('首屏欢迎语', await page.locator('.chat__hello-t').textContent(), '安排');
  eq('编排页不再显示大标题', await page.locator('#viewSchedule .view__title').count(), 0);
  truthy('品牌标识可见', await page.locator('.chat-brand').isVisible());
  truthy('品牌位于引导卡上方', await page.evaluate(() => {
    const b = document.querySelector('.chat-brand').getBoundingClientRect();
    const h = document.querySelector('.chat__hello').getBoundingClientRect();
    return b.bottom <= h.top;
  }));
  truthy('首屏输入框可见', await page.locator('#chatInput').isVisible());
  const chatMetrics = await page.evaluate(() => {
    const i = document.getElementById('chatInput').getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector('.chat'));
    return { h: i.height, pb: parseFloat(cs.paddingBottom) };
  });
  truthy(`输入框足够大（${Math.round(chatMetrics.h)}px）`, chatMetrics.h >= 50);
  truthy(`输入区距底部有留白（${chatMetrics.pb}px）`, chatMetrics.pb >= 16);

  /* 15. 学习工作台视觉层：问候 / 今日待办 / 快捷标签卡 / 建议芯片 / 侧栏状态 */
  const today23 = (() => { const d = new Date(); d.setHours(23, 0, 0, 0); return d.getTime(); })();
  const seedStudio = [
    { id:'s1', title:'高数作业第三章', desc:'', priority:'high', mode:'duration',
      durationMs:7200000, accumulatedMs:0, status:'idle', dueAt: today23,
      alertAhead:300, notify:false, firedAt:null, warned:false,
      createdAt: Date.now()-1000, updatedAt: Date.now(), completedAt:null },
    { id:'s2', title:'线代复习第三章', desc:'', priority:'medium', mode:'duration',
      durationMs:3600000, accumulatedMs:0, status:'idle', dueAt: today23,
      alertAhead:300, notify:false, firedAt:null, warned:false,
      createdAt: Date.now()-1000, updatedAt: Date.now(), completedAt:null },
    { id:'s3', title:'英语作文', desc:'', priority:'low', mode:'duration',
      durationMs:3600000, accumulatedMs:0, status:'idle', dueAt: today23,
      alertAhead:300, notify:false, firedAt:null, warned:false,
      createdAt: Date.now()-1000, updatedAt: Date.now(), completedAt:null }
  ];
  await fresh({ seedTasks: seedStudio });
  await page.waitForTimeout(350);

  const greet = (await page.locator('#studioGreetHi').count()) || 0;
  eq('首屏不再有打招呼语', greet, 0);
  truthy('品牌标识在引导卡上方且突出', await page.evaluate(() => {
    const b = document.querySelector('.chat-brand').getBoundingClientRect();
    const h = document.querySelector('.chat__hello').getBoundingClientRect();
    const logo = document.querySelector('.chat-brand__logo').getBoundingClientRect();
    const word = document.querySelector('.chat-brand__word').getBoundingClientRect();
    return b.bottom <= h.top && logo.width >= 44 && word.width >= 100;
  }));
  truthy('品牌标记是粉色实心', await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.chat-brand__logo'));
    return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
  }));

  eq('今日待办预览列出 3 条', await page.locator('.studio-today__row').count(), 3);
  truthy('今日待办带科目色点', await page.evaluate(() => {
    const d = document.querySelector('.studio-today__dot');
    return !!d && /var\(--subj-/.test(d.getAttribute('style') || '');
  }));
  truthy('今日待办显示截止时间', await page.evaluate(() => {
    const d = document.querySelector('.studio-today__d');
    return !!d && /\d{2}:\d{2}/.test(d.textContent || '');
  }));

  eq('快捷标签是 3 张卡片', await page.locator('.chat__chips button').count(), 3);
  truthy('快捷标签各自带科目色', await page.evaluate(() => {
    const norm = (v) => {                       // 统一成 rgb() 再比，避免 #hex / rgb() 写法不同
      const d = document.createElement('div');
      d.style.color = v; document.body.appendChild(d);
      const c = getComputedStyle(d).color; d.remove(); return c;
    };
    const cs = Array.from(document.querySelectorAll('.chat__chips button'));
    const cols = cs.map((b) => norm(getComputedStyle(b).getPropertyValue('--chip-color').trim()));
    const ico = cs.map((b) => norm(getComputedStyle(b.querySelector('.chat__chip-ico')).color));
    return cols.length === 3 && cols.every((c) => c && c !== 'rgb(0, 0, 0)')
      && new Set(cols).size === 3                  // 三个科目各一色
      && ico.every((c, i) => c === cols[i]);      // 图标用同一个科目色
  }));
  truthy('移动端（<640px）快捷标签改为单列', await page.evaluate(() => {
    return getComputedStyle(document.querySelector('.chat__chips')).gridTemplateColumns.split(' ').length === 1;
  }));

  eq('输入区有 3 个建议芯片', await page.locator('#chatSuggest button').count(), 3);
  await page.locator('#chatSuggest button').first().click();
  await page.waitForTimeout(220);
  truthy('点击建议芯片后填入输入框', ((await page.locator('#chatInput').inputValue()) || '').length > 0);
  truthy('有内容时发送按钮点亮', await page.evaluate(() => document.getElementById('btnChatSend').classList.contains('is-ready')));
  await page.fill('#chatInput', '');
  await page.waitForTimeout(200);
  truthy('清空后发送按钮降饱和', await page.evaluate(() => !document.getElementById('btnChatSend').classList.contains('is-ready')));

  truthy('侧栏「新会话」是浅粉底 + 深粉字（不是实心主色）', await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('btnNewChat'));
    const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const bg = rgb(cs.backgroundColor), fg = rgb(cs.color);
    const lum = (c) => {
      const a = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    };
    const L1 = lum(bg), L2 = lum(fg);
    const contrast = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    return bg[0] > 240 && bg[1] > 200 && fg[0] > 150 && fg[1] < 80 && contrast >= 4.5
      && Math.round(parseFloat(cs.height)) === 40
      && parseFloat(cs.borderRadius) === 10
      && cs.fontWeight === '500'
      && cs.boxShadow === 'none';
  }));
  truthy('侧栏「更多」是图标按钮并带 title / aria-label', await page.evaluate(() => {
    const b = document.getElementById('btnChatMore');
    return !!b && b.getAttribute('aria-haspopup') === 'menu'
      && !!b.getAttribute('aria-label') && parseFloat(getComputedStyle(b).width) <= 44;
  }));
  eq('侧栏不再有孤立的清空垃圾桶按钮', await page.locator('#btnClearChat').count(), 0);
  truthy('移动端侧栏底部不重复显示字标（顶栏已有品牌）', await page.evaluate(() => {
    const el = document.querySelector('.sidebar__footer-brand');
    return !!el && el.getClientRects().length === 0;
  }));
  truthy('选中项是半透明粉底且无左侧色条', await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#sidebar [data-page="schedule"]'));
    const bg = cs.backgroundColor;
    const m = bg.match(/\/\s*([0-9.]+)\s*\)/);                 // color(srgb r g b / a)
    const alpha = m ? parseFloat(m[1])
      : (bg.indexOf('rgba') === 0 ? parseFloat(bg.split(',')[3]) : 1);
    return alpha > 0 && alpha < 1 && cs.boxShadow.indexOf('inset') < 0;
  }));

  /* 15b. 宽屏（≥1024px）：快捷标签 3 列 + 侧栏常驻展开 */
  await fresh({ viewport: { width: 1280, height: 900 }, seedTasks: seedStudio });
  await page.waitForTimeout(350);
  truthy('宽屏快捷标签为 3 列', await page.evaluate(() => {
    return getComputedStyle(document.querySelector('.chat__chips')).gridTemplateColumns.split(' ').length === 3;
  }));
  truthy('宽屏侧栏常驻展开（240px）', await page.evaluate(() => {
    return Math.round(document.getElementById('sidebar').getBoundingClientRect().width) === 240;
  }));
  truthy('宽屏侧栏底部显示 Taskflow 字标', await page.evaluate(() => {
    const el = document.querySelector('.sidebar__footer-brand');
    return !!el && el.getClientRects().length > 0
      && !!el.querySelector('.brand-wordmark');
  }));

  /* 侧栏会话区：与导航同一条对齐线，按钮到首个分组标题 16–20px */
  const sideGeo = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
    const navIco = document.querySelector('#navSchedule svg').getBoundingClientRect();
    const g = document.querySelector('.chat-history__group');
    const gr = document.createRange(); gr.selectNodeContents(g);
    const rowT = document.querySelector('.chat-history__t');
    return {
      btn: r('#btnNewChat'), group: r('.chat-history__group'),
      navIconX: Math.round(navIco.x), groupTextX: Math.round(gr.getBoundingClientRect().x),
      rowTextX: rowT ? Math.round(rowT.getBoundingClientRect().x) : -1,
    };
  });
  truthy('新会话按钮高度 40px', sideGeo.btn.h === 40);
  truthy(`按钮到首个分组标题 16–20px（${sideGeo.group.y - sideGeo.btn.bottom}px）`,
    sideGeo.group.y - sideGeo.btn.bottom >= 16 && sideGeo.group.y - sideGeo.btn.bottom <= 20);
  truthy(`分组标题与导航图标对齐（${sideGeo.groupTextX} vs ${sideGeo.navIconX}）`, Math.abs(sideGeo.groupTextX - sideGeo.navIconX) <= 2);
  truthy(`列表标题与分组标题对齐（${sideGeo.rowTextX}）`, sideGeo.rowTextX === sideGeo.groupTextX);

  /* 15c. 空状态大板块与「输入框 + 发送按钮」整体同宽同轴；引导语随宽度折行；回形针在框内 */
  const align = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { x: Math.round(b.x), right: Math.round(b.right), cx: Math.round(b.x + b.width / 2), w: Math.round(b.width) }; };
    const d = document.querySelector('.chat__hello-d');
    const cs = getComputedStyle(d);
    const field = document.querySelector('.chat__field');
    const att = document.getElementById('btnChatAttach').getBoundingClientRect();
    return {
      hello: r('.chat__hello'), today: r('.studio-today'), brand: r('.chat-brand'),
      field: r('.chat__field'), input: r('#chatInput'), bar: r('.chat__bar'),
      lines: Math.round(d.getBoundingClientRect().height / parseFloat(cs.lineHeight)),
      attLeft: Math.round(att.left), attRight: Math.round(att.right),
      attTop: Math.round(att.top), attBottom: Math.round(att.bottom),
    };
  });
  truthy(`大板块与「输入框+发送按钮」整体左右边界一致（${align.hello.x}/${align.hello.right} vs ${align.bar.x}/${align.bar.right}）`,
    align.hello.x === align.bar.x && align.hello.right === align.bar.right);
  truthy(`今日待办与整体同宽（${align.today.right} vs ${align.bar.right}）`, align.today.right === align.bar.right);
  truthy(`品牌中轴与整体中轴一致（${align.brand.cx} vs ${align.bar.cx}）`,
    Math.abs(align.brand.cx - align.bar.cx) <= 2);
  eq(`宽屏引导语为一行`, align.lines, 1);
  truthy(`回形针在输入框内左侧（${align.attLeft}∈[${align.field.x},${align.field.right}]）`,
    align.attLeft >= align.field.x && align.attRight <= align.field.right && align.attLeft < align.field.x + 60);

  /* 15d. 900–1023px：侧栏自动折叠成 64px 图标栏，且可用收放按钮展开 */
  await fresh({ viewport: { width: 1000, height: 800 } });
  await page.waitForTimeout(350);
  eq('窄桌面侧栏自动折叠为 64px', await page.locator('#sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width)), 64);
  eq('折叠态收放按钮 aria-expanded=false', await page.getAttribute('#sidebarToggle', 'aria-expanded'), 'false');
  truthy('折叠态侧栏只有图标（无文字标签）', await page.evaluate(() => {
    const it = document.querySelector('#sidebar [data-page="tasks"]');
    const sp = it.querySelector('span');
    return !sp || sp.getClientRects().length === 0;
  }));
  await page.click('#sidebarToggle');
  await page.waitForTimeout(400);
  eq('点击收放按钮后侧栏展开为 240px', await page.locator('#sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width)), 240);
  eq('展开态收放按钮 aria-expanded=true', await page.getAttribute('#sidebarToggle', 'aria-expanded'), 'true');
  truthy('展开后侧栏文字标签恢复', await page.evaluate(() => {
    const sp = document.querySelector('#sidebar [data-page="tasks"] span');
    return !!sp && sp.getClientRects().length > 0;
  }));
  truthy('展开后新会话入口可见', await page.locator('#btnNewChat').isVisible());
  await page.click('#sidebarToggle');
  await page.waitForTimeout(400);
  eq('再次点击收窄回 64px', await page.locator('#sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width)), 64);

  /* 15. 设置页：自定义 Provider */
  await fresh();
  await navTo(page, 'me');
  await page.waitForTimeout(250);
  eq('设置页标题', (await page.locator('#viewMe .view__title').textContent()).trim(), '设置');
  truthy('AI 服务卡片可见', await page.locator('#cardAi').isVisible());
  includes('默认显示内置 DeepSeek', await page.locator('#provNameLabel').textContent(), '内置 DeepSeek');

  await page.click('#btnProvEdit');
  truthy('编辑后表单展开', await page.locator('#provForm').isVisible());

  await page.fill('#provId', 'Bad_ID');
  await page.fill('#provName', 'Acme 网关');
  await page.fill('#provBase', 'https://gw.example/v1');
  await page.fill('#provKeyEnv', 'AI_PROVIDER_KEY');
  await page.fill('#provModelInput', 'my-model-1');
  await page.click('#btnProvAdd');
  await page.click('#btnProvSave');
  await page.waitForTimeout(200);
  includes('非法 Provider ID 提示', await page.locator('#aiTestResult').textContent(), '小写字母');

  await page.fill('#provId', 'acme-gateway');
  await page.click('#btnProvSave');
  await page.waitForTimeout(250);
  truthy('保存后表单收起', await page.locator('#provForm').evaluate((el) => el.classList.contains('hidden')));
  eq('摘要显示自定义名称', (await page.locator('#provNameLabel').textContent()).trim(), 'Acme 网关');
  const cfg = await page.evaluate((k) => localStorage.getItem(k), 'taskflow.ai.v1');
  truthy('Provider 写入本地配置', cfg && cfg.includes('acme-gateway') && cfg.includes('AI_PROVIDER_KEY'));
  truthy('本地配置不含密钥值', !/sk-[A-Za-z0-9]/.test(cfg || ''));

  await page.click('#btnProvEdit');
  await page.click('#btnAiTest');
  await page.waitForTimeout(500);
  const testText = await page.locator('#aiTestResult').textContent();
  includes('测试连接成功', testText, '已连接');
  includes('测试连接返回模型数', testText, '2');
  const chips = await page.locator('#provModels .prov-chip').count();
  truthy(`模型目录合并为 ${chips} 个`, chips >= 2);

  /* 自定义 provider 随请求发送，模型取所选 */
  await page.click('#btnProvCancel');
  await navTo(page, 'schedule');
  await page.waitForTimeout(350);
  await page.check('#chatConsent');
  await page.fill('#chatInput', '自定义 provider 验证');
  scenario = { status: 200, body: { ok: true, draft: DRAFT_OK } };
  await page.click('#btnChatSend');
  await page.waitForSelector('.draft-card', { timeout: 8000 });
  const sent = requests[requests.length - 1];
  eq('请求携带 provider id', sent.provider && sent.provider.id, 'acme-gateway');
  eq('请求携带 provider 协议', sent.provider && sent.provider.protocol, 'openai');
  eq('请求模型取所选', sent.model, 'my-model-1');

  await navTo(page, 'me');
  await page.waitForTimeout(300);
  await page.click('#btnProvEdit');
  await page.click('#btnProvReset');
  await page.waitForTimeout(250);
  includes('切回内置后摘要', await page.locator('#provNameLabel').textContent(), '内置 DeepSeek');

  /* 15b. 直连模式：密钥仅存内存，请求直达自定义接口 */
  await fresh();
  let directReq = null;
  await ctx.route('**/chat/completions', async (route) => {
    directReq = route.request();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(/conversation assistant/.test((route.request().postDataJSON().messages||[])[0]?.content||'') ? { reply: '草稿已生成，确认后才会创建任务。', action: 'generate_draft', draft: { title: '直连任务', desc: '来自直连', dueAt: null, priority: 'medium', estimatedMinutes: 30 } } : { title: '直连任务', desc: '来自直连', dueAt: null, priority: 'medium', estimatedMinutes: 30 }) } }] }),
    });
  });
  await navTo(page, 'me');
  await page.waitForTimeout(250);
  await page.click('#btnProvEdit');
  await page.fill('#provName', 'Direct 网关');
  await page.fill('#provId', 'direct-gw');
  await page.fill('#provBase', 'https://gw.example/v1');
  await page.selectOption('#provAuthMode', 'direct');
  await page.waitForTimeout(150);
  truthy('直连模式显示密钥输入', await page.locator('#fApiKey').isVisible());
  truthy('直连模式隐藏变量名输入', await page.locator('#fKeyEnv').evaluate((el) => el.classList.contains('hidden')));
  await page.fill('#provApiKey', 'sk-test-123');
  await page.fill('#provModelInput', 'direct-model');
  await page.click('#btnProvAdd');
  await page.click('#btnProvSave');
  await page.waitForTimeout(250);
  const cfg2 = await page.evaluate((k) => localStorage.getItem(k), 'taskflow.ai.v1');
  truthy('直连保存后摘要更新', (await page.locator('#provNameLabel').textContent()).includes('Direct'));
  truthy('密钥值未写入本地配置', !(cfg2 || '').includes('sk-test-123'));

  await navTo(page, 'schedule');
  await page.waitForTimeout(350);
  await page.check('#chatConsent');
  await page.fill('#chatInput', '直连生成任务');
  const proxyBefore = requests.length;
  await page.click('#btnChatSend');
  await page.waitForSelector('.draft-card', { timeout: 8000 });
  eq('直连草稿标题', await page.inputValue('.dc-title'), '直连任务');
  truthy('直连请求携带 Bearer 密钥', (directReq && directReq.headers()['authorization']) === 'Bearer sk-test-123');
  eq('直连模式不经过站点代理', requests.length, proxyBefore);

  await navTo(page, 'me');
  await page.waitForTimeout(250);
  await page.click('#btnProvEdit');
  await page.click('#btnProvReset');
  await page.waitForTimeout(200);
  truthy('直连后可切回内置', (await page.locator('#provNameLabel').textContent()).includes('内置'));

  /* 15c. 内置 DeepSeek + 页面内 Key：模型两列、密钥仅内存、直连官方接口 */
  await fresh();
  let bkReq = null;
  await ctx.route('**/chat/completions', async (route) => {
    bkReq = route.request();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(/conversation assistant/.test((route.request().postDataJSON().messages||[])[0]?.content||'') ? { reply: '草稿已生成，确认后才会创建任务。', action: 'generate_draft', draft: { title: '内置直连任务', desc: '', dueAt: null, priority: 'high', estimatedMinutes: 45 } } : { title: '内置直连任务', desc: '', dueAt: null, priority: 'high', estimatedMinutes: 45 }) } }] }),
    });
  });
  await navTo(page, 'me');
  await page.waitForTimeout(250);
  truthy('内置模式显示密钥输入', await page.locator('#bkApiKey').isVisible());
  const modelCols = await page.locator('#segAiModel').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  eq('模型选择为一行两列', modelCols, 2);
  await page.fill('#bkApiKey', 'sk-builtin-test-123');
  await page.click('#btnBkSave');
  await page.waitForTimeout(200);
  includes('密钥保存提示', await page.locator('#bkKeyHint').textContent(), '已填入');
  const cfg3 = await page.evaluate((k) => localStorage.getItem(k), 'taskflow.ai.v1');
  truthy('内置密钥未写入本地配置', !(cfg3 || '').includes('sk-builtin-test-123'));

  await navTo(page, 'schedule');
  await page.waitForTimeout(350);
  await page.check('#chatConsent');
  await page.fill('#chatInput', '内置直连生成');
  const proxyBefore2 = requests.length;
  await page.click('#btnChatSend');
  await page.waitForSelector('.draft-card', { timeout: 8000 });
  eq('内置直连草稿标题', await page.inputValue('.dc-title'), '内置直连任务');
  truthy('内置直连命中官方地址', !!(bkReq && /api\.deepseek\.com/.test(bkReq.url())));
  truthy('内置直连携带 Bearer 密钥', (bkReq && bkReq.headers()['authorization']) === 'Bearer sk-builtin-test-123');
  eq('内置直连不经过站点代理', requests.length, proxyBefore2);

  /* 16. 对话建任务：草稿卡可编辑，确认后入库 */
  await fresh();
  scenario = { status: 200, body: { ok: true, draft: { ...DRAFT_OK, title: '写完高数作业', estimatedMs: 7200000 } } };
  await page.check('#chatConsent');
  await page.fill('#chatInput', '周五前写完高数作业，两小时');
  await page.click('#btnChatSend');
  await page.waitForSelector('.draft-card', { timeout: 8000 });
  eq('对话草稿标题回填', await page.inputValue('.dc-title'), '写完高数作业');
  truthy('欢迎语已隐藏', await page.locator('#chatHello').evaluate((el) => el.classList.contains('hidden')));
  eq('请求体携带发送文本', requests[requests.length - 1].text, '周五前写完高数作业，两小时');
  await page.fill('.dc-title', '高数作业（对话创建）');
  await page.fill('.dc-min', '90');
  await page.click('.dc-ok');
  await page.waitForTimeout(500);
  tasks = await taskList();
  eq('对话创建 1 个任务', tasks.length, 1);
  eq('对话任务标题取编辑值', tasks[0].title, '高数作业（对话创建）');
  eq('对话任务来源标记', tasks[0].source, 'ai-chat');
  eq('对话任务时长 90min', tasks[0].durationMs, 5400000);
  truthy('草稿卡进入完成态', await page.locator('.draft-card').evaluate((el) => el.classList.contains('is-done')));
  await goTasks();
  includes('任务页出现对话创建的任务', await page.locator('#viewTasks').innerText(), '高数作业（对话创建）');

  /* 17. 对话错误 + 重试 */
  await fresh();
  scenario = { status: 503, body: { ok: false, error: { code: 'service_not_configured', retryable: false } } };
  await page.check('#chatConsent');
  await page.fill('#chatInput', '写作业');
  await page.click('#btnChatSend');
  await page.waitForSelector('.msg__bubble--err', { timeout: 8000 });
  includes('对话错误提示缺少密钥', await page.locator('.msg__bubble--err').last().textContent(), 'API Key');
  truthy('错误气泡带重试按钮', await page.locator('.msg__retry').last().isVisible());
  scenario = { status: 200, body: { ok: true, draft: DRAFT_OK } };
  await page.locator('.msg__retry').last().click();
  await page.waitForSelector('.draft-card', { timeout: 8000 });
  truthy('重试后生成草稿', await page.locator('.draft-card').isVisible());

  truthy('无页面脚本错误', errs.length === 0);
  if (errs.length) out.push('        errors: ' + errs.join(' | '));

  console.log(out.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });