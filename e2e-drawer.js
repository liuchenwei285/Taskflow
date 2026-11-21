/* 移动端竖屏重构验收：顶部品牌栏 / 抽屉导航（按钮、滑动、遮罩、Esc）/ 底部固定输入栏 / 多宽度无溢出 */
const { chromium } = require('playwright');
const URL = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';

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
/* 几何断言：按像素容差判定，避免把亚像素取整当成失败 */
const near = (l, g, w, tol) => {
  const ok = Math.abs(Number(g) - Number(w)) <= tol; ok ? pass++ : fail++;
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${l}${ok ? '' : `\n        got=${g} want=${w}±${tol}`}`);
};

async function navTo(p, name){
  await p.evaluate((n) => { const b = document.querySelector('#sidebar [data-page="' + n + '"]'); if (b) b.click(); }, name);
  await p.waitForTimeout(260);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('__dr_init')) { localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__dr_init', '1'); } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(500);

  const drawerState = () => p.evaluate(() => ({
    open: document.body.classList.contains('drawer-open'),
    expanded: document.getElementById('btnDrawer').getAttribute('aria-expanded'),
    hidden: document.getElementById('sidebar').getAttribute('aria-hidden'),
    lock: document.body.classList.contains('is-locked'),
  }));

  /* 1. 默认结构 */
  let st = await drawerState();
  eq('抽屉默认关闭', st.open, false);
  eq('菜单 aria-expanded=false', st.expanded, 'false');
  eq('侧栏 aria-hidden=true', st.hidden, 'true');
  truthy('顶栏菜单按钮可见', await p.locator('#btnDrawer').isVisible());
  truthy('底部分段/导航已按新布局排布（#nav 隐藏）', !(await p.locator('#nav').isVisible()));
  truthy('品牌区可见', await p.locator('.appbar__brand').isVisible());
  truthy('主题按钮可见', await p.locator('#btnTheme').isVisible());

  const sidebarOrder = await p.evaluate(() => Array.from(document.querySelectorAll('#sidebar [data-page], #sidebar .sidebar__chats'))
    .map(e => e.dataset.page || (e.classList.contains('sidebar__chats') ? 'chats' : null)).filter(Boolean).join(','));
  truthy('会话区位于智能编排正下方（' + sidebarOrder + '）', sidebarOrder.indexOf('schedule,chats') === 0);

const navAlign = await p.evaluate(() => ['schedule', 'tasks', 'stats'].map((k) => {
    const b = document.querySelector('#sidebar [data-page="' + k + '"]');
    const i = b.querySelector('svg').getBoundingClientRect();
    const t = b.querySelector('span').getBoundingClientRect();
    return { left: Math.round(b.getBoundingClientRect().left), icon: Math.round(i.left), text: Math.round(t.left), iw: Math.round(i.width) };
  }));
  truthy('三项导航左边界统一：' + JSON.stringify(navAlign), new Set(navAlign.map((x) => x.left)).size === 1);
  truthy('三项图标左边界统一', new Set(navAlign.map((x) => x.icon)).size === 1);
  truthy('三项文字左边界统一', new Set(navAlign.map((x) => x.text)).size === 1);
  truthy('三项图标宽度统一', new Set(navAlign.map((x) => x.iw)).size === 1);

const vgaps = await p.evaluate(() => {
    const sel = ['#navSchedule', '#chatFoldBody', '#sidebar [data-page="tasks"]', '#sidebar [data-page="stats"]'];
    const r = sel.map((x) => document.querySelector(x).getBoundingClientRect());
    return [Math.round(r[1].top - r[0].bottom), Math.round(r[2].top - r[1].bottom), Math.round(r[3].top - r[2].bottom)];
  });
  truthy('导航纵向间隙统一：' + JSON.stringify(vgaps), Math.max.apply(null, vgaps) - Math.min.apply(null, vgaps) <= 1);

await p.evaluate(() => { document.getElementById('btnNewChat').click(); document.getElementById('btnNewChat').click(); });
  await p.waitForTimeout(250);
  const hgaps = await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.chat-history__item')).map((e) => e.getBoundingClientRect());
    return {
      gaps: items.slice(1).map((r, i) => Math.round(r.top - items[i].bottom)),
      heights: items.map((r) => Math.round(r.height)),
    };
  });
  truthy('历史会话纵向间隙统一：' + JSON.stringify(hgaps.gaps), hgaps.gaps.length > 0 && hgaps.gaps.every((g) => g === 8));
  truthy('历史会话行高统一为 40px：' + JSON.stringify(hgaps.heights), hgaps.heights.every((h) => h === 40));

const brandLeft = await p.evaluate(() => Math.round(document.querySelector('.brand__logo').getBoundingClientRect().left));
  truthy('顶栏品牌靠左（' + brandLeft + 'px）', brandLeft <= 64);
const listTop = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.chat__list')).paddingTop));
  truthy('会话内容顶部留白 ' + listTop + 'px', listTop >= 24);
  const dockInfo = await p.evaluate(() => {
    const d = document.querySelector('.chat__dock');
    const i = document.getElementById('chatInput').getBoundingClientRect();
    return { border: getComputedStyle(d).borderTopWidth, h: Math.round(i.height) };
  });
  eq('输入栏没有上边线', dockInfo.border, '0px');
  truthy('输入栏高度缩小到 ' + dockInfo.h + 'px', dockInfo.h >= 50 && dockInfo.h <= 54);

  /* 1a. 空状态大板块的中轴线 = 「输入框 + 发送按钮」整体的中轴线 */
  const axis = await p.evaluate(() => {
    const c = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return (r.left + r.right) / 2; };
    const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, r: r.right }; };
    const intro = box('.chat-intro'), bar = box('.chat__bar');
    return { intro: c('.chat-intro'), brand: c('.chat-brand'), bar: c('.chat__bar'),
             edgeL: Math.abs(intro.l - bar.l), edgeR: Math.abs(intro.r - bar.r) };
  });
  near('板块中轴与对话框整体中轴重合（偏差 ' + (axis.bar - axis.intro).toFixed(1) + 'px）', axis.bar - axis.intro, 0, 1);
  near('品牌标识中轴与对话框整体中轴重合', axis.bar - axis.brand, 0, 1);
  near('板块左边界与输入框左边界对齐', axis.edgeL, 0, 1);
  near('板块右边界与发送按钮右边界对齐', axis.edgeR, 0, 1);

  /* 1b. 会话区可收起 / 展开，并持久化 */
  await p.evaluate(() => document.getElementById('navSchedule').click());
  await p.waitForTimeout(400);
  eq('收起后 aria-expanded=false', await p.getAttribute('#navSchedule', 'aria-expanded'), 'false');
  const foldedH = await p.evaluate(() => Math.round(document.getElementById('chatFoldBody').getBoundingClientRect().height));
  truthy('收起后会话内容高度归零（' + foldedH + 'px）', foldedH < 3);
  const bigGaps = await p.evaluate(() => {
    const a = document.querySelector('#navSchedule').getBoundingClientRect();
    const b = document.querySelector('#sidebar [data-page="tasks"]').getBoundingClientRect();
    const c = document.querySelector('#sidebar [data-page="stats"]').getBoundingClientRect();
    return [Math.round(b.top - a.bottom), Math.round(c.top - b.bottom)];
  });
  truthy('收起后三大板块间隙一致：' + JSON.stringify(bigGaps), bigGaps[0] === 8 && bigGaps[1] === 8);
  await p.evaluate(() => document.getElementById('navSchedule').click());
  await p.waitForTimeout(400);
  eq('展开后 aria-expanded=true', await p.getAttribute('#navSchedule', 'aria-expanded'), 'true');
  const unfoldedH = await p.evaluate(() => Math.round(document.getElementById('chatFoldBody').getBoundingClientRect().height));
  truthy('展开后会话内容恢复高度（' + unfoldedH + 'px）', unfoldedH > 40);
  await p.evaluate(() => document.getElementById('navSchedule').click());
  await p.waitForTimeout(200);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(500);
  truthy('刷新后保持收起', await p.evaluate(() => document.body.classList.contains('chats-folded')));
  await p.evaluate(() => document.getElementById('navSchedule').click());
  await p.waitForTimeout(200);

  /* 2. 按钮开合 */
  await p.click('#btnDrawer');
  await p.waitForTimeout(400);
  st = await drawerState();
  eq('按钮打开抽屉', st.open, true);
  eq('打开后 aria-expanded=true', st.expanded, 'true');
  eq('打开后侧栏 aria-hidden=false', st.hidden, 'false');
  truthy('打开时锁定背景滚动', st.lock);
  const openedX = await p.locator('#sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().left));
  eq('抽屉滑入到位（left=0）', openedX, 0);
  truthy('抽屉内五项入口齐全', (await p.locator('#sidebar [data-page]').count()) === 5);

  /* 3. 遮罩关闭 */
  await p.mouse.click(370, 420);
  await p.waitForTimeout(400);
  st = await drawerState();
  eq('点击遮罩关闭', st.open, false);
  truthy('关闭后不再锁滚动', !st.lock);

  /* 4. 左缘右滑呼出 */
  await p.mouse.move(8, 420);
  await p.mouse.down();
  await p.mouse.move(200, 424, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(450);
  st = await drawerState();
  eq('左缘右滑呼出', st.open, true);

  /* 5. 抽屉内左滑关闭 */
  await p.mouse.move(240, 420);
  await p.mouse.down();
  await p.mouse.move(70, 424, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(450);
  st = await drawerState();
  eq('抽屉内左滑关闭', st.open, false);

  /* 6. Esc 关闭 + 焦点回收 */
  await p.click('#btnDrawer');
  await p.waitForTimeout(400);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  st = await drawerState();
  eq('Esc 关闭抽屉', st.open, false);
  truthy('关闭后焦点回到菜单按钮', await p.evaluate(() => document.activeElement && document.activeElement.id === 'btnDrawer'));
  truthy('首项可键盘聚焦（打开时）', await p.evaluate(async () => {
    document.getElementById('btnDrawer').click();
    await new Promise((r) => setTimeout(r, 350));
    const first = document.querySelector('#sidebar .sidebar__item');
    const ok = document.activeElement === first;
    document.getElementById('drawerMask').click();
    return ok;
  }));

  /* 6b. Android 返回键先收起抽屉 */
  await p.click('#btnDrawer');
  await p.waitForTimeout(350);
  const backHandled = await p.evaluate(() => window.__onBackPressed());
  await p.waitForTimeout(300);
  eq('返回键消费事件', backHandled, true);
  eq('返回键收起抽屉', (await drawerState()).open, false);

  /* 7. 导航：切换页面后抽屉保持打开，只有收起按钮关闭 */
  await p.click('#btnDrawer');
  await p.waitForTimeout(350);
  await p.locator('#sidebar [data-page="tasks"]').click();
  await p.waitForTimeout(400);
  truthy('抽屉导航切换到任务页', await p.locator('#viewTasks').isVisible());
  st = await drawerState();
  eq('导航操作不自动收起抽屉', st.open, true);
  await p.click('#sidebarToggle');
  await p.waitForTimeout(400);
  eq('收起按钮关闭抽屉', (await drawerState()).open, false);

  /* 8. 任务页底部仅分段，无 dock；内容不被遮挡 */
  truthy('任务页分段可见', await p.locator('#tabs').isVisible());
  const tabsGap = await p.evaluate(() => {
    const t = document.getElementById('tabs').getBoundingClientRect();
    return Math.round(innerHeight - t.bottom);
  });
  truthy(`分段贴近安全区（底部间距 ${tabsGap}px）`, tabsGap >= 4 && tabsGap <= 40);

  /* 9. 会话页：输入栏固定、内容不被遮挡 */
  await navTo(p, 'schedule');
  const chatGeo = await p.evaluate(() => {
    const bar = document.querySelector('.chat__dock');
    const chat = document.querySelector('.chat');
    const cs = getComputedStyle(bar);
    const lastVisible = document.querySelector('.chat__hello');
    return {
      fixed: cs.position === 'fixed',
      barBottom: Math.round(innerHeight - bar.getBoundingClientRect().bottom),
      padBottom: parseFloat(getComputedStyle(chat).paddingBottom),
      overlap: lastVisible ? Math.round(lastVisible.getBoundingClientRect().bottom - bar.getBoundingClientRect().top) : -1,
    };
  });
  eq('输入栏固定在底部', chatGeo.fixed, true);
  truthy(`输入栏贴安全区（间距 ${chatGeo.barBottom}px）`, chatGeo.barBottom >= 0 && chatGeo.barBottom <= 24);
  truthy(`会话区预留输入栏高度（${chatGeo.padBottom}px）`, chatGeo.padBottom >= 80);
  truthy('引导卡不被输入栏遮挡', chatGeo.overlap <= 0);

  /* 9b. 模拟线上水印：输入栏需避让右下角 */
  await p.evaluate(() => {
    const b = document.createElement('qoder-sites-badge');
    b.id = 'qoder-sites-watermark';
    b.style.cssText = 'position:fixed;right:12px;bottom:8px;width:147px;height:32px;background:#fff;z-index:130';
    document.documentElement.appendChild(b);
  });
  await p.waitForTimeout(200);
  const badgeGeo = await p.evaluate(() => {
    const bar = document.querySelector('.chat__dock').getBoundingClientRect();
    const badge = document.getElementById('qoder-sites-watermark').getBoundingClientRect();
    const chat = document.querySelector('.chat');
    return { barBottom: Math.round(bar.bottom), badgeTop: Math.round(badge.top), pad: parseFloat(getComputedStyle(chat).paddingBottom) };
  });
  truthy('水印避让：输入栏上移到徽标上方（' + badgeGeo.barBottom + '/' + badgeGeo.badgeTop + '）', badgeGeo.barBottom <= badgeGeo.badgeTop);
  truthy('水印模式会话区预留高度（' + badgeGeo.pad + 'px）', badgeGeo.pad >= 130);
  await p.evaluate(() => { const b = document.getElementById('qoder-sites-watermark'); if (b) b.remove(); });
  await p.waitForTimeout(150);

  /* 10. 多宽度无横向溢出 */
  for (const w of [360, 375, 390, 412]){
    await p.setViewportSize({ width: w, height: 844 });
    await p.waitForTimeout(300);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    truthy(`${w}px 竖屏无横向溢出（${overflow}px）`, overflow <= 1);
  }
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(250);

  /* 11. 深色模式 */
  await p.click('#btnTheme');
  await p.waitForTimeout(350);
  eq('深色模式生效', await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await p.screenshot({ path: 'runs/drawer-dark.png' });
  await p.click('#btnTheme');
  await p.waitForTimeout(300);

  await ctx.close();

  /* 12. 桌面端不回归：菜单按钮隐藏、侧栏常驻、无遮罩交互 */
  const wctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  /* 首访欢迎弹窗是新增默认行为：本套件以「回访用户」起步，弹窗本身的验证在 e2e-welcome.js */
  await wctx.addInitScript(() => { localStorage.clear(); localStorage.setItem('taskflow.welcome.v1', '1'); });
  const wp = await wctx.newPage();
  wp.on('pageerror', (e) => errs.push(e.message));
  await wp.goto(URL, { waitUntil: 'load' });
  await wp.waitForTimeout(500);
  truthy('桌面：菜单按钮隐藏', !(await wp.locator('#btnDrawer').isVisible()));
  truthy('桌面：侧栏常驻', await wp.locator('#sidebar').isVisible());
  eq('桌面：侧栏宽度 240', await wp.locator('#sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width)), 240);
  truthy('桌面：无抽屉遮罩', !(await wp.evaluate(() => document.body.classList.contains('drawer-open'))));
  const foldVisible = await wp.locator('#navSchedule').isVisible();
  truthy('桌面：会话折叠开关可见', foldVisible);
  await wp.click('#navSchedule');
  await wp.waitForTimeout(400);
  const wFoldedH = await wp.evaluate(() => Math.round(document.getElementById('chatFoldBody').getBoundingClientRect().height));
  truthy('桌面：会话可收起（高度 ' + wFoldedH + 'px）', wFoldedH < 3);
  await wp.click('#navSchedule');
  await wp.waitForTimeout(400);
const wAlign = await wp.evaluate(() => ['schedule', 'tasks', 'stats'].map((k) => {
    const b = document.querySelector('#sidebar [data-page="' + k + '"]');
    const i = b.querySelector('svg').getBoundingClientRect();
    const t = b.querySelector('span').getBoundingClientRect();
    return { left: Math.round(b.getBoundingClientRect().left), icon: Math.round(i.left), text: Math.round(t.left) };
  }));
  truthy('桌面：三项图标与文字基准统一', new Set(wAlign.map((x) => x.icon + ':' + x.text + ':' + x.left)).size === 1);
  const wOrder = await wp.evaluate(() => Array.from(document.querySelectorAll('#sidebar [data-page], #sidebar .sidebar__chats'))
    .map(e => e.dataset.page || (e.classList.contains('sidebar__chats') ? 'chats' : null)).filter(Boolean).join(','));
  truthy('桌面：会话区位于智能编排正下方（' + wOrder + '）', wOrder.indexOf('schedule,chats') === 0);
const dBottomGap = await wp.evaluate(() => Math.round(innerHeight - document.getElementById('chatInput').getBoundingClientRect().bottom));
  truthy('桌面输入栏下移到接近底部（' + dBottomGap + 'px）', dBottomGap >= 20 && dBottomGap <= 80);
  truthy('桌面：侧栏有新会话入口', await wp.locator('#btnNewChat').isVisible());
  truthy('桌面：侧栏有会话「更多」入口', await wp.locator('#btnChatMore').isVisible());
  truthy('桌面：侧栏有历史会话区', await wp.locator('#chatHistoryList').isVisible());
  await wp.evaluate(() => document.getElementById('btnNewChat').click());
  await wp.waitForTimeout(300);
  eq('桌面新会话无草稿', await wp.locator('#viewSchedule .draft-card').count(), 0);
  await wctx.close();

  /* 短窗口：侧栏会话区必须可滚动，不能被裁剪且无法查看 */
  const sctx = await browser.newContext({ viewport:{ width:1280, height:420 }, locale:'zh-CN' });
  await sctx.addInitScript(() => localStorage.setItem('taskflow.welcome.v1', '1'));  // 回访用户起步；首访弹窗见 e2e-welcome.js
  await sctx.addInitScript(() => {
    try{
      const cs = [];
      /* 第 0 条用长标题：nowrap 的标题会把会话列撑宽，导致右侧按钮/标题被裁掉 */
      for (let i=0;i<8;i++) cs.push({ id:'s'+i, title: i === 0 ? '完成高数作业，大概要两小时，很重要' : '会话 '+i, createdAt:Date.now()-i*1000, updatedAt:Date.now()-i*1000, request:'', messages:[], drafts:[], activeDraftId:'' });
      localStorage.setItem('{{SECRET_5y7h2k9p}}', JSON.stringify({ v:1, activeId:'s0', conversations:cs }));
    }catch(_){}
  });
  const sp = await sctx.newPage();
  sp.on('pageerror', (e) => errs.push(e.message));
  await sp.goto(URL, { waitUntil:'domcontentloaded' });
  await sp.waitForTimeout(400);
  const scInfo = await sp.evaluate(() => {
    const e = document.querySelector('.sidebar__scroll');
    return e ? { sh:e.scrollHeight, ch:e.clientHeight, ov:getComputedStyle(e).overflowY } : null;
  });
  truthy('短窗口存在侧栏滚动容器：' + JSON.stringify(scInfo), !!scInfo && scInfo.ov === 'auto' && scInfo.sh > scInfo.ch + 2);
  await sp.evaluate(() => { const e = document.querySelector('.sidebar__scroll'); if (e) e.scrollTop = 99999; });
  await sp.waitForTimeout(100);
  const sTop = await sp.evaluate(() => { const e = document.querySelector('.sidebar__scroll'); return e ? e.scrollTop : -1; });
  truthy('会话内容可滚动查看（scrollTop=' + sTop + '）', sTop > 0);
  const histH = await sp.evaluate(() => document.getElementById('chatHistoryList').getBoundingClientRect().height);
  truthy('滚动后历史会话区可见', histH > 0);

  /* 长标题不得撑破会话列：侧栏右侧不被吞掉 */
  const clip = await sp.evaluate(() => {
    const sb = document.getElementById('sidebar');
    const sbBox = sb.getBoundingClientRect();
    const innerRight = sbBox.width - parseFloat(getComputedStyle(sb).paddingRight);
    const fold = document.getElementById('chatFoldBody');
    const clear = document.getElementById('btnChatMore');
    const t = document.querySelector('.chat-history__t');
    return {
      foldOverflow: fold ? fold.scrollWidth - fold.clientWidth : 999,
      clearRight: clear ? Math.round(clear.getBoundingClientRect().right - sbBox.left) : -1,
      innerRight: Math.round(innerRight),
      titleW: t ? Math.round(t.getBoundingClientRect().width) : -1,
      titleScroll: t ? t.scrollWidth : -1,
      titleEllipsis: t ? getComputedStyle(t).textOverflow : ''
    };
  });
  truthy('长标题不撑破会话列（溢出 ' + clip.foldOverflow + 'px）', clip.foldOverflow <= 1);
  truthy('「更多」按钮完整落在侧栏内（' + clip.clearRight + ' ≤ ' + clip.innerRight + '）', clip.clearRight <= clip.innerRight);
  truthy('长标题单行省略（ellipsis + 内容被裁）', clip.titleEllipsis === 'ellipsis' && clip.titleScroll > clip.titleW);
  await sctx.close();

  truthy('无页面脚本错误', errs.length === 0);
  if (errs.length) out.push('        errors: ' + errs.join(' | '));
  console.log(out.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });