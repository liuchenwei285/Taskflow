/* AI 多轮会话验收：草稿状态机、上下文修改、重新生成、幂等创建、会话持久化与隔离 */
const { chromium } = require('playwright');
const URL = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';
const CHAT_KEY = '{{SECRET_5y7h2k9p}}';
const TASK_KEY = 'taskflow.tasks.v1';

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

const baseDraft = {
  title: '写完高数作业', desc: '很重要', dueAt: '2026-11-20T20:00:00+08:00',
  priority: 'high', estimatedMinutes: 120,
};
const sat = '2026-11-21T20:00:00+08:00';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('__tf_init')) { localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__tf_init', '1'); } });
  const requests = [];
  let failNext = false;
  await ctx.route('**/functions/v1/app/ai/chat', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (failNext){ failNext = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok:false, error:{ code:'service_not_configured', retryable:false } }) }); }
    let payload;
    if (body.intent === 'regenerate_draft'){
      payload = { ok:true, reply:'已根据原始需求重新生成，保留你手动修改的标题。', action:'generate_draft',
        draft: Object.assign({}, baseDraft, { dueAt: sat, priority: 'medium', estimatedMinutes: 180 }) };
    } else if (body.text.includes('改成周六')){
      payload = { ok:true, reply:'已把截止日期改到周六。', action:'edit_draft', patch:{ dueAt: sat } };
    } else if (body.text.includes('优先级改成中')){
      payload = { ok:true, reply:'已把优先级改为中。', action:'edit_draft', patch:{ priority:'medium' } };
    } else if (body.text.includes('预计时间改成三个小时')){
      payload = { ok:true, reply:'已把预计时长改为三小时。', action:'edit_draft', patch:{ estimatedMinutes:180 } };
    } else {
      payload = { ok:true, reply:'草稿已生成，确认后才会创建任务。', action:'generate_draft', draft: baseDraft };
    }
    await route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(payload) });
  });

  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL, { waitUntil:'load' });
  await p.waitForTimeout(500);
  await p.check('#chatConsent');

  const send = async (text) => {
    await p.fill('#chatInput', text);
    await p.click('#btnChatSend');
    await p.waitForTimeout(900);
  };
  const store = () => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), CHAT_KEY);
  const tasks = () => p.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k) || '{}');
    return d.tasks || [];
  }, TASK_KEY);
  const activeConv = async () => { const s = await store(); return s.conversations.find(c => c.id === s.activeId); };

  /* 1. 初始草稿 */
  await send('周五晚上八点前写完高数作业，大概两小时，很重要');
  await p.waitForSelector('.draft-card', { timeout: 8000 });
  eq('首条草稿标题', await p.inputValue('.dc-title'), '写完高数作业');
  eq('草稿状态待确认', await p.locator('.dc-status').textContent(), '待确认');
  eq('任务库仍为空', (await tasks()).length, 0);
  truthy('请求携带 conversation 上下文', !!requests[0].history && Array.isArray(requests[0].history));

  /* 2. 多轮修改 */
  await send('改成周六');
  eq('截止日期改到周六', (await p.inputValue('.dc-date')), '2026-11-21');
  eq('标题未被修改', await p.inputValue('.dc-title'), '写完高数作业');
  await send('优先级改成中');
  eq('优先级改为中', await p.getAttribute('.dc-pri [data-pri="medium"]', 'aria-pressed'), 'true');
  await send('预计时间改成三个小时');
  eq('预估时长改为 180 分钟', await p.inputValue('.dc-min'), '180');
  truthy('上下文发送历史消息', requests[requests.length - 1].history.length >= 4);
  truthy('上下文携带当前草稿', !!(requests[requests.length - 1].draft && requests[requests.length - 1].draft.title));

  /* 3. 手动编辑 + 重新生成 */
  await p.fill('.dc-title', '高数作业（手动改）');
  await p.locator('.dc-title').dispatchEvent('change');
  const beforeMsg = await p.locator('.msg').count();
  await p.click('.dc-regen');
  await p.waitForTimeout(700);
  eq('重新生成后仍只有一张草稿', await p.locator('.draft-card').count(), 1);
  eq('重新生成后标题保留手动修改', await p.inputValue('.dc-title'), '高数作业（手动改）');
  eq('重新生成后优先级来自上下文', await p.getAttribute('.dc-pri [data-pri="medium"]', 'aria-pressed'), 'true');
  eq('重新生成后时长 180', await p.inputValue('.dc-min'), '180');
  eq('重新生成不产生「重新创建」用户消息',
    await p.locator('.msg--user').filter({ hasText: '重新生成' }).count(), 0);
  truthy(`重新生成走结构化 intent（消息 ${beforeMsg}→${await p.locator('.msg').count()}）`,
    requests[requests.length - 1].intent === 'regenerate_draft');
  const conv1 = await activeConv();
  truthy('手动修改被记录', conv1.drafts.some(d => d.edits.some(e => e.source === 'manual' && e.field === 'title')));
  const draftId = conv1.activeDraftId;

  /* 4. 确认创建幂等 + 状态关联 */
  await p.click('.dc-ok');
  await p.waitForTimeout(600);
  const afterTasks = await tasks();
  eq('确认后创建 1 个任务', afterTasks.length, 1);
  eq('任务标题取编辑值', afterTasks[0].title, '高数作业（手动改）');
  eq('任务关联草稿 ID', afterTasks[0].chatDraftId, draftId);
  eq('任务关联会话 ID', afterTasks[0].conversationId, conv1.id);
  eq('草稿状态变为 created', await p.locator('.draft-card').getAttribute('data-status'), 'created');
  includes('草稿卡显示创建成功', await p.locator('.dc-status').textContent(), '已创建');
  if (await p.locator('.dc-ok').count()) await p.click('.dc-ok');
  await p.waitForTimeout(300);
  eq('重复确认不重复创建', (await tasks()).length, 1);

  /* 5. 刷新恢复 */
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(700);
  eq('刷新后草稿仍为 created', await p.locator('.draft-card').getAttribute('data-status'), 'created');
  eq('刷新后历史消息恢复', await p.locator('.msg--user').count() >= 1, true);
  eq('刷新后未重复创建任务', (await tasks()).length, 1);

  /* 6. 新会话隔离 + 历史切换 */
  await p.evaluate(() => document.getElementById('btnNewChat').click());
  await p.waitForTimeout(350);
  eq('新会话无草稿', await p.locator('.draft-card').count(), 0);
  eq('新会话已清空消息', await p.locator('.msg--user').count(), 0);
  await send('新会话的第一个任务');
  await p.waitForSelector('.draft-card', { timeout: 8000 });
  const conv2 = await activeConv();
  truthy('新会话草稿 ID 独立', conv2.activeDraftId !== draftId);
  truthy('历史会话列表可见', (await p.locator('.chat-history__item').count()) >= 2);
  await p.evaluate((id) => {
    const s = JSON.parse(localStorage.getItem('{{SECRET_5y7h2k9p}}'));
    s.activeId = id;
    localStorage.setItem('{{SECRET_5y7h2k9p}}', JSON.stringify(s));
  }, conv1.id);
  await p.reload({ waitUntil:'load' });
  await p.waitForTimeout(600);
  eq('切回旧会话恢复已创建草稿', await p.locator('.draft-card').getAttribute('data-status'), 'created');
  eq('切回后任务不重复', (await tasks()).length, 1);

  /* 6b. 右键历史会话：删除选项 */
  await p.evaluate(() => document.getElementById('btnDrawer').click());
  await p.waitForTimeout(450);
  const histBefore = await p.locator('.chat-history__item').count();
  await p.locator('.chat-history__item').last().click({ button: 'right' });
  await p.waitForTimeout(250);
  truthy('右键弹出会话菜单', await p.locator('#chatMenu.open').isVisible());
  await p.locator('#chatMenu [data-act="delete-conversation"]').click();
  await p.waitForTimeout(350);
  eq('删除后历史会话减少一条', await p.locator('.chat-history__item').count(), histBefore - 1);
  eq('删除会话不删除已创建任务', (await tasks()).length, 1);
  await p.evaluate(() => document.getElementById('btnDrawer').click());
  await p.waitForTimeout(350);

  /* 7. 「更多 → 清空全部」：二次确认；取消不清、确认清空，任务不删 */
  await p.evaluate(() => document.getElementById('btnDrawer').click());
  await p.waitForTimeout(450);
  await p.evaluate(() => document.getElementById('btnChatMore').click());
  await p.waitForTimeout(250);
  truthy('「更多」菜单打开', await p.locator('#chatMoreMenu.open').isVisible());
  await p.locator('#chatMoreMenu [data-act="clear-all"]').click();
  await p.waitForTimeout(400);
  truthy('清空全部弹出二次确认', await p.locator('#confirmScrim.open').isVisible());
  includes('确认文案说明任务不受影响', await p.locator('#cfSub').textContent(), '任务');
  await p.click('#cfNo');
  await p.waitForTimeout(400);
  truthy('取消后消息仍在', (await p.locator('.msg--user').count()) >= 1);
  await p.evaluate(() => document.getElementById('btnChatMore').click());
  await p.waitForTimeout(250);
  await p.locator('#chatMoreMenu [data-act="clear-all"]').click();
  await p.waitForTimeout(400);
  await p.click('#cfYes');
  await p.waitForTimeout(600);
  eq('清空全部后无消息', await p.locator('.msg--user').count(), 0);
  eq('清空全部后只剩一个空白会话', await p.locator('.chat-history__item').count(), 1);
  eq('清空全部后已创建任务仍存在', (await tasks()).length, 1);
  await p.evaluate(() => document.getElementById('btnDrawer').click());
  await p.waitForTimeout(400);

  /* 8. 错误 + 重试 */
  failNext = true;
  await send('再建一个任务');
  await p.waitForTimeout(500);
  truthy('错误提示出现', (await p.locator('.msg__bubble--err').count()) > 0);
  truthy('错误消息带重试', (await p.locator('.msg__retry').count()) > 0);
  await p.locator('.msg__retry').last().click();
  await p.waitForSelector('.draft-card', { timeout: 8000 });
  eq('重试后草稿生成', await p.locator('.draft-card').getAttribute('data-status'), 'draft');

  /* 9. 侧栏会话列表改版：时间分组 / 行样式 / 选中竖条 / hover 操作 / 重命名 / 键盘 */
  const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  await sctx.addInitScript(() => {
    localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1');
    /* 分组按日历日切，种数据必须锚定到「N 天前的正午」，否则凌晨跑会用例假失败 */
    const at = (daysAgo) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - daysAgo); return d.getTime(); };
    const cs = [
      { id:'r0', title:'完成高数作业，大概要两小时，很重要', createdAt:at(0) + 60000, updatedAt:at(0) + 60000, request:'', messages:[], drafts:[], activeDraftId:'' },
      { id:'r1', title:'线代第 3 章复习计划', createdAt:at(0), updatedAt:at(0), request:'', messages:[], drafts:[], activeDraftId:'' },
      { id:'r2', title:'英语作文提纲', createdAt:at(1), updatedAt:at(1), request:'', messages:[], drafts:[], activeDraftId:'' },
      { id:'r3', title:'上周的物理实验', createdAt:at(4), updatedAt:at(4), request:'', messages:[], drafts:[], activeDraftId:'' },
      { id:'r4', title:'很久以前的会话', createdAt:at(20), updatedAt:at(20), request:'', messages:[], drafts:[], activeDraftId:'' },
    ];
    localStorage.setItem('{{SECRET_5y7h2k9p}}', JSON.stringify({ v:1, activeId:'r0', conversations:cs }));
  });
  const sp = await sctx.newPage();
  sp.on('pageerror', (e) => errs.push('sidebar ' + e.message));
  await sp.goto(URL, { waitUntil:'load' });
  await sp.waitForTimeout(700);

  eq('会话分组只有时间维度（今天/昨天/过去 7 天/更早）',
    await sp.evaluate(() => Array.from(document.querySelectorAll('.chat-history__group')).map((e) => e.textContent).join(',')),
    '今天,昨天,过去 7 天,更早');
  eq('不再有「历史会话」这一层标题', await sp.locator('.sidebar__chats .section-label').count(), 0);
  const gStyle = await sp.evaluate(() => { const c = getComputedStyle(document.querySelector('.chat-history__group')); return { fs: c.fontSize, fw: c.fontWeight }; });
  eq('分组标题字号 12px', gStyle.fs, '12px');
  eq('分组标题不加粗', gStyle.fw, '400');
  const rowMetric = await sp.evaluate(() => { const b = document.querySelector('.chat-history__item').getBoundingClientRect(); const c = getComputedStyle(document.querySelector('.chat-history__item')); return { h: Math.round(b.height), r: c.borderRadius }; });
  eq('列表项高度 40px', rowMetric.h, 40);
  eq('列表项圆角 8px', rowMetric.r, '8px');
  eq('列表项不再有灰色圆点', await sp.locator('.chat-history__dot').count(), 0);
  const sel = await sp.evaluate(() => {
    const row = document.querySelector('.chat-history__item.is-active');
    const bar = getComputedStyle(row, '::before');
    const bg = getComputedStyle(row).backgroundColor;
    const m = bg.match(/\/\s*([0-9.]+)\s*\)/);
    const alpha = m ? parseFloat(m[1]) : (bg.indexOf('rgba') === 0 ? parseFloat(bg.split(',')[3]) : 1);
    return { barW: bar.width, barBg: bar.backgroundColor, alpha };
  });
  eq('选中项左侧 3px 主色竖条', sel.barW, '3px');
  truthy('竖条是主色（非透明）', sel.barBg !== 'rgba(0, 0, 0, 0)');
  truthy('选中项为浅粉底（半透明）', sel.alpha > 0 && sel.alpha < 1);

  const row2 = sp.locator('.chat-history__item').nth(1);
  const metaBefore = await row2.locator('.chat-history__meta').evaluate((e) => getComputedStyle(e).opacity);
  eq('未悬停时不显示行内操作', metaBefore, '0');
  await row2.hover();
  await sp.waitForTimeout(350);
  const meta = await row2.locator('.chat-history__meta').evaluate((e) => ({ op: getComputedStyle(e).opacity, txt: e.textContent }));
  eq('悬停显示行内操作', meta.op, '1');
  truthy('悬停同时显示最后更新时间（' + meta.txt + '）', /\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}/.test(meta.txt));
  eq('行内提供重命名', await row2.locator('[data-act="rename"]').count(), 1);
  eq('行内提供删除', await row2.locator('[data-act="delete"]').count(), 1);

  await row2.locator('[data-act="rename"]').click();
  await sp.waitForTimeout(250);
  truthy('重命名进入编辑态并聚焦', await sp.evaluate(() => { const i = document.querySelector('.chat-history__rename'); return !!i && document.activeElement === i; }));
  await sp.fill('.chat-history__rename', '线代复习（重命名）');
  await sp.keyboard.press('Enter');
  await sp.waitForTimeout(350);
  eq('重命名后列表标题更新', await sp.evaluate(() => document.querySelectorAll('.chat-history__t')[1].textContent), '线代复习（重命名）');
  eq('重命名已落库', await sp.evaluate(() => JSON.parse(localStorage.getItem('{{SECRET_5y7h2k9p}}')).conversations[1].title), '线代复习（重命名）');

  await sp.locator('.chat-history__main').first().focus();
  await sp.keyboard.press('ArrowDown');
  eq('方向键下移焦点', await sp.evaluate(() => document.activeElement.classList.contains('chat-history__main') && document.activeElement.dataset.convId), 'r1');
  await sp.keyboard.press('ArrowUp');
  eq('方向键上移焦点', await sp.evaluate(() => document.activeElement.dataset.convId), 'r0');

  await sp.click('#btnChatMore');
  await sp.waitForTimeout(250);
  truthy('「更多」菜单在按钮下方展开', await sp.evaluate(() => { const m = document.getElementById('chatMoreMenu'), b = document.getElementById('btnChatMore'); return m.classList.contains('open') && Math.round(m.getBoundingClientRect().top) >= Math.round(b.getBoundingClientRect().bottom); }));
  await sp.locator('#chatMoreMenu [data-act="clear-all"]').click();
  await sp.waitForTimeout(350);
  truthy('清空全部需要二次确认', await sp.locator('#confirmScrim.open').isVisible());
  await sp.click('#cfNo');
  await sp.waitForTimeout(350);
  eq('取消确认不清空', await sp.locator('.chat-history__item').count(), 5);
  await sp.click('#btnChatMore');
  await sp.waitForTimeout(200);
  await sp.locator('#chatMoreMenu [data-act="clear-all"]').click();
  await sp.waitForTimeout(300);
  await sp.click('#cfYes');
  await sp.waitForTimeout(500);
  eq('确认后清空全部会话', await sp.locator('.chat-history__item').count(), 1);

  /* 首条消息自动命名：取前 15 个字（不需要后端返回，用户消息入库即命名） */
  await sp.check('#chatConsent');
  await sp.evaluate(() => document.getElementById('btnNewChat').click());
  await sp.waitForTimeout(300);
  const longMsg = '一二三四五六七八九十十一十二十三十四十五十六十七';
  await sp.fill('#chatInput', longMsg);
  await sp.click('#btnChatSend');
  await sp.waitForTimeout(500);
  const autoTitle = await sp.evaluate(() => {
    const row = document.querySelector('.chat-history__item.is-active');
    return row ? row.querySelector('.chat-history__t').textContent : '';
  });
  eq('首条消息标题长度截到 15 个字', autoTitle.length, 15);
  truthy('标题是原话前缀（' + autoTitle + '）', longMsg.startsWith(autoTitle));
  await sctx.close();

  truthy('无页面脚本错误', errs.length === 0);
  if (errs.length) out.push('        errors: ' + errs.join(' | '));
  console.log(out.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });