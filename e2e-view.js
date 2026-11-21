/* 宽屏任务页视图验收：搜索（含中文输入法组合）、四种排序的实际顺序、三种分组的实际数量、状态筛选的实际结果
   全部用固定 6 条任务做基准，断言的是渲染出来的 ID 序列与分组计数，不是控件是否存在。 */
const { chromium } = require('playwright');
const URL = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';

let pass = 0, fail = 0;
const eq = (l, g, w) => { const ok = String(g) === String(w); ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${ok ? '' : `\n        got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`); };
const truthy = (l, v) => eq(l, !!v, true);
const includes = (l, hay, needle) => eq(l, String(hay).includes(needle), true);

/* 6 条基准任务：优先级 高2/中2/低2，剩余时间/创建时间/标题各不相同，状态含 已到期/已完成/暂停/未开始。
   刻意不用 running 状态之外的可变字段，避免测试过程中倒计时漂移导致顺序断言不稳定。 */
function fixtureTasks() {
  const t = Date.now();
  const mk = (o) => Object.assign({
    id:'v?', title:'', desc:'', priority:'medium', mode:'duration', durationMs:0, remainingMs:0,
    dueAt:null, status:'idle', startedAt:null, alertAhead:300, notify:true, firedAt:null,
    warned:false, createdAt:t, updatedAt:t, completedAt:null
  }, o);
  return [
    mk({ id:'v1', title:'阿尔法评审', desc:'季度 ALFA 评审材料', priority:'high', mode:'deadline',
         dueAt:t + 3600000, status:'idle', createdAt:t - 40000 }),
    mk({ id:'v2', title:'北京出差', desc:'订高铁票与酒店', priority:'medium',
         durationMs:1800000, remainingMs:1800000, status:'idle', createdAt:t - 120000 }),
    mk({ id:'v3', title:'测试环境重建', desc:'CI runner 重装', priority:'low',
         durationMs:2700000, remainingMs:2700000, status:'idle', createdAt:t - 1000 }),
    mk({ id:'v4', title:'第一版海报', desc:'主视觉待定', priority:'high',
         durationMs:1200000, remainingMs:600000, status:'paused', createdAt:t - 260000 }),
    mk({ id:'v5', title:'会议记录整理', desc:'归档到共享盘', priority:'medium',
         durationMs:900000, remainingMs:0, status:'done', completedAt:t - 3600000, createdAt:t - 180000 }),
    mk({ id:'v6', title:'周末值班', desc:'已超时需处理', priority:'low', mode:'deadline',
         dueAt:t - 7200000, status:'finished', firedAt:t - 7200000, createdAt:t - 90000 })
  ];
}

(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  const errs = [];
  // 全新 context：localStorage 天然为空，不需要（也不能）在每次导航前 clear，否则 reload 会把基准数据抹掉
  const ctx = await browser.newContext({ viewport:{ width:1280, height:900 }, locale:'zh-CN' });
  await ctx.addInitScript(() => localStorage.setItem('taskflow.welcome.v1', '1'));  // 回访用户起步；首访弹窗见 e2e-welcome.js
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil:'domcontentloaded' });
  await p.waitForTimeout(400);
  await p.evaluate((list) => {
    const t = Date.now();
    localStorage.setItem('taskflow.tasks.v1', JSON.stringify({ v:1, schemaVersion:1, tasks:list, sessions:[], savedAt:t }));
    localStorage.setItem('taskflow.prefs.v1', JSON.stringify({ sort:'deadline', group:'none', view:'all', running:'all', theme:'light' }));
  }, fixtureTasks());
  await p.reload({ waitUntil:'domcontentloaded' });
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('#sidebar [data-page="tasks"]').click());
  await p.waitForTimeout(500);

  const ids = () => p.evaluate(() => Array.from(document.querySelectorAll('.task')).map(el => el.dataset.id).join(','));
  const rows = () => p.evaluate(() => document.querySelectorAll('.task').length);
  const pick = async (sel) => { await p.evaluate(s => document.querySelector(s).click(), sel); await p.waitForTimeout(450); };
  const typeSearch = async (q) => {
    await p.evaluate(v => { const el = document.getElementById('searchInput'); el.value = v; el.dispatchEvent(new Event('input', { bubbles:true })); }, q);
    await p.waitForTimeout(400);
  };

  console.log('=== 0. 基准数据 ===');
  truthy('宽屏搜索框可见', await p.locator('#searchBox').isVisible());
  eq('基准任务数', await rows(), 6);
  eq('基准 ID 序列（按距截止升序：到期置顶、无截止靠后、已完成沉底）', await ids(), 'v6,v1,v4,v2,v3,v5');

  console.log('=== 1. 搜索实际结果 ===');
  await typeSearch('北京');
  eq('关键词命中标题，只剩命中项', await ids(), 'v2');
  truthy('搜索时清除按钮出现', await p.locator('#searchClear').isVisible());
  await typeSearch('alfa');
  eq('关键词大小写不敏感且命中描述', await ids(), 'v1');
  await typeSearch('评审');
  eq('中文关键词精确命中', await ids(), 'v1');
  await typeSearch('不存在的内容zzz');
  eq('无结果时列表为空', await rows(), 0);
  includes('无结果提示文案', await p.evaluate(() => (document.querySelector('.empty') || {}).textContent || ''), '没有找到匹配的任务');
  await p.evaluate(() => document.getElementById('searchClear').click());
  await p.waitForTimeout(400);
  eq('清空搜索后恢复全部', await rows(), 6);
  eq('清空后搜索框为空', await p.evaluate(() => document.getElementById('searchInput').value), '');
  truthy('清空后清除按钮隐藏', await p.evaluate(() => document.getElementById('searchClear').hidden));

  console.log('=== 2. 中文输入法组合输入 ===');
  await p.evaluate(() => {
    const el = document.getElementById('searchInput');
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles:true }));
    el.value = '周末';
    el.dispatchEvent(new Event('input', { bubbles:true }));   // 候选词未上屏时的中间态
  });
  await p.waitForTimeout(400);
  eq('组合期间不触发过滤（不闪屏、不误判无结果）', await rows(), 6);
  await p.evaluate(() => document.getElementById('searchInput').dispatchEvent(new CompositionEvent('compositionend', { bubbles:true })));
  await p.waitForTimeout(400);
  eq('组合结束后按最终文本过滤', await ids(), 'v6');
  await p.evaluate(() => { const el = document.getElementById('searchInput'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles:true })); });
  await p.waitForTimeout(400);
  eq('退出组合后清空恢复', await rows(), 6);

  console.log('=== 3. 排序实际顺序 ===');
  await pick('#sortMenu [data-sort="deadline"]');
  eq('按剩余时间（按距截止升序）', await ids(), 'v6,v1,v4,v2,v3,v5');
  await pick('#sortMenu [data-sort="priority"]');
  eq('按优先级：高→中→低，同级按剩余时间', await ids(), 'v4,v1,v5,v2,v6,v3');
  await pick('#sortMenu [data-sort="created"]');
  eq('按创建时间：新→旧', await ids(), 'v3,v1,v6,v2,v5,v4');
  await pick('#sortMenu [data-sort="title"]');
  eq('按标题：中文拼音序', await ids(), 'v1,v2,v3,v4,v5,v6');
  eq('排序按钮文案跟随选择', await p.evaluate(() => document.getElementById('sortLabel').textContent), '排序：标题');
  await pick('#sortMenu [data-sort="deadline"]');

  console.log('=== 4. 分组实际数量 ===');
  const groups = () => p.evaluate(() => Array.from(document.querySelectorAll('.group-head'))
    .map(h => h.querySelector('.group-head__label').textContent + '=' + h.querySelector('.group-head__n').textContent).join(' | '));
  await pick('#sortMenu [data-group="none"]');
  eq('不分组时无组头', await p.evaluate(() => document.querySelectorAll('.group-head').length), 0);
  eq('不分组时仍是 6 条', await rows(), 6);
  await pick('#sortMenu [data-group="priority"]');
  eq('按优先级分组：三组各 2 条', await groups(), '高优先级=2 | 中优先级=2 | 低优先级=2');
  await pick('#sortMenu [data-group="status"]');
  const stGroups = await groups();
  const stParts = stGroups.split(' | ');
  const nOf = (kw) => { const hit = stParts.find(s => s.includes(kw)); return hit ? hit.split('=')[1] : '(无' + kw + '组)'; };
  truthy('按状态分组：4 组（' + stGroups + '）', stParts.length === 4);
  eq('  已暂停组 1 条', nOf('已暂停'), '1');
  eq('  待开始组 3 条', nOf('待开始'), '3');
  eq('  已到期组 1 条', nOf('已到期'), '1');
  eq('  已完成组 1 条', nOf('已完成'), '1');
  eq('分组不改变总条数', await rows(), 6);
  await pick('#sortMenu [data-group="none"]');

  console.log('=== 5. 状态筛选实际结果 ===');
  await p.click('#btnSort');
  await p.waitForTimeout(300);
  truthy('排序菜单可展开', await p.evaluate(() => document.getElementById('sortMenu').classList.contains('open')));
  truthy('菜单展开后按钮 aria-expanded=true', await p.evaluate(() => document.getElementById('btnSort').getAttribute('aria-expanded') === 'true'));
  eq('状态筛选可选项来自当前数据', await p.evaluate(() => Array.from(document.querySelectorAll('#filterItems [data-filter]')).map(b => b.dataset.filter).join(',')), 'all,idle,paused,overdue');
  await pick('#filterItems [data-filter="overdue"]');
  eq('仅看已到期：只剩超时任务', await ids(), 'v6');
  eq('仅看已到期：条数为 1', await rows(), 1);
  eq('筛选选择写回 prefs', await p.evaluate(() => JSON.parse(localStorage.getItem('taskflow.prefs.v1')).running), 'overdue');
  await pick('#filterItems [data-filter="all"]');
  eq('恢复不限', await rows(), 6);
  await pick('#filterItems [data-filter="paused"]');
  eq('仅看已暂停', await ids(), 'v4');
  await pick('#filterItems [data-filter="all"]');

  console.log('=== 6. 搜索 × 筛选叠加 ===');
  await pick('#filterItems [data-filter="overdue"]');
  await typeSearch('北京');
  eq('叠加：已到期里没有北京出差 → 空', await rows(), 0);
  await p.evaluate(() => document.getElementById('searchClear').click());
  await p.waitForTimeout(350);
  eq('清除搜索后筛选仍生效', await ids(), 'v6');
  await pick('#filterItems [data-filter="all"]');
  await typeSearch('测试');
  eq('筛选恢复后搜索仍生效', await ids(), 'v3');
  await p.evaluate(() => document.getElementById('searchClear').click());

  console.log('=== 6b. 单条计时中任务：0 命中状态筛选不得泄漏（回归）===');
  /* 回归：只有 1 条「计时中」任务时，点「待开始 / 已到期」统计卡应得到空列表，
     而不是把这条计时中任务显示出来。旧 bug 是 paintFilterMenu 把 0 命中的筛选重置成「不限」。
     用全新 context（localStorage 为空）种 1 条，避免 beforeunload 的 syncFromStorage 只在「storage≥内存」时接管。 */
  const vctx = await browser.newContext({ viewport:{ width:1280, height:900 }, locale:'zh-CN' });
  await vctx.addInitScript(() => localStorage.setItem('taskflow.welcome.v1', '1'));  // 回访用户起步；首访弹窗见 e2e-welcome.js
  const vp = await vctx.newPage();
  vp.on('pageerror', e => errs.push(e.message));
  await vp.goto(URL, { waitUntil:'domcontentloaded' });
  await vp.waitForTimeout(300);
  await vp.evaluate(() => {
    const t = Date.now();
    const only = [{
      id:'r1', title:'完成高数作业', desc:'', priority:'high', mode:'duration',
      durationMs:7200000, accumulatedMs:21000, segStart:t, status:'running',
      dueAt:t + 86400000 + 6*3600000, alertAhead:300, notify:false, firedAt:null,
      warned:false, createdAt:t - 60000, updatedAt:t, completedAt:null
    }];
    localStorage.setItem('taskflow.tasks.v1', JSON.stringify({ v:1, schemaVersion:2, tasks:only, sessions:[], savedAt:t }));
    localStorage.setItem('taskflow.prefs.v1', JSON.stringify({ sort:'deadline', group:'none', view:'all', running:'all', theme:'light' }));
  });
  await vp.reload({ waitUntil:'domcontentloaded' });
  await vp.waitForTimeout(500);
  await vp.evaluate(() => document.querySelector('#sidebar [data-page="tasks"]').click());
  await vp.waitForTimeout(400);
  const vids = () => vp.evaluate(() => Array.from(document.querySelectorAll('.task')).map(el => el.dataset.id).join(','));
  const vrows = () => vp.evaluate(() => document.querySelectorAll('.task').length);
  const clickStat = async (k) => { await vp.evaluate(s => document.querySelector('[data-stat="' + s + '"]').click(), k); await vp.waitForTimeout(400); };
  const prefRunning = () => vp.evaluate(() => JSON.parse(localStorage.getItem('taskflow.prefs.v1') || '{}').running);

  eq('基准：仅 1 条计时中，列表显示该任务', await vids(), 'r1');
  await clickStat('idle');
  eq('点「待开始」：空列表（计时中任务不泄漏）', await vrows(), 0);
  eq('  且筛选持久化为 idle（未被重置成 all）', await prefRunning(), 'idle');
  await clickStat('idle');                       // 取消，回到不限
  await clickStat('overdue');
  eq('点「已到期」：空列表（计时中任务不泄漏）', await vrows(), 0);
  eq('  且筛选持久化为 overdue', await prefRunning(), 'overdue');
  await clickStat('overdue');
  await clickStat('running');
  eq('点「计时中」：仍显示该任务', await vids(), 'r1');
  await clickStat('running');
  eq('取消筛选后恢复全部', await vrows(), 1);
  await vctx.close();

  console.log('=== 7. 健康检查 ===');
  truthy('无页面脚本错误', errs.length === 0);
  if (errs.length) console.log('        errors: ' + errs.join(' | '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log(pass + ' passed, ' + fail + ' failed + FATAL'); process.exit(1); });
