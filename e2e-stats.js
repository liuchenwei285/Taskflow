/* 统计页专注热力图验收（GitHub 风格，过去一年）：格数、分档、今日、月份/星期标签、滚动、图例、英文 */
const { chromium } = require('playwright');

async function navTo(p, name){
  await p.evaluate((n) => { const b = document.querySelector('#sidebar [data-page="' + n + '"]'); if (b) b.click(); }, name);
  await p.waitForTimeout(260);
}
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

function dayKey(ts){
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const now = Date.now();
  const mk = (offsetDays, ms, kind) => {
    const start = now - offsetDays * 86400000;
    return {
      id: 's' + offsetDays + kind, taskId: 't_hm', taskTitle: '热力图任务', kind: kind || 'focus',
      startAt: start, endAt: start + ms, ms: ms, dateKey: dayKey(start),
    };
  };
  const sessions = [mk(0, 2 * 3600000), mk(1, 45 * 60000), mk(40, 10 * 60000), mk(2, 30 * 60000, 'short')];
  const seed = JSON.stringify({ v: 1, tasks: [], sessions: sessions, savedAt: now });

  let ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((payload) => {
    localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1');
    localStorage.setItem('taskflow.tasks.v1', payload);
  }, seed);
  let page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await navTo(page, 'stats');
  await page.waitForTimeout(450);

  truthy('热力图卡片存在', await page.locator('.hm-card').isVisible());
  eq('53 周 × 7 行 = 371 格', await page.locator('.hm .hm-cell').count(), 371);
  const future = await page.locator('.hm .hm-cell[data-l="-1"]').count();
  truthy(`未来格 ${future} 个（0–13）`, future >= 0 && future <= 13);
  eq('今日 2h → 最高档', await page.locator('.hm-cell[data-today]').getAttribute('data-l'), '4');
  eq('最高档 1 格', await page.locator('.hm .hm-cell[data-l="4"]').count(), 1);
  eq('次高档 1 格（45m）', await page.locator('.hm .hm-cell[data-l="2"]').count(), 1);
  eq('低档 1 格（10m）', await page.locator('.hm .hm-cell[data-l="1"]').count(), 1);
  eq('休息 session 不计入', await page.locator('.hm .hm-cell[data-l="3"]').count(), 0);

  const months = await page.locator('.hm-months span').count();
  truthy(`月份标签数量 ${months}（≥12）`, months >= 12);
  const weekdays = await page.locator('.hm-days').textContent();
  includes('星期标签含周一', weekdays, '周一');
  includes('星期标签含周三', weekdays, '周三');
  includes('星期标签含周五', weekdays, '周五');

  const total = await page.locator('.hm-total').textContent();
  includes('标题含过去一年', total, '过去一年');
  includes('标题含次数', total, '次专注');
  includes('统计口径说明', await page.locator('.hm-foot').textContent(), '专注会话');
  includes('图例更少', await page.locator('.hm-legend').textContent(), '更少');
  includes('图例更多', await page.locator('.hm-legend').textContent(), '更多');
  truthy('初始滚动到最近日期', await page.locator('.hm-scroll').evaluate((el) => el.scrollLeft > 0));

  const title = await page.locator('.hm-cell[data-today]').getAttribute('title');
  includes('今日 tooltip 含日期与时长', title, dayKey(now));
  await page.screenshot({ path: 'runs/v4-stats-heatmap.png' });
  await navTo(page, 'me');
  await page.waitForTimeout(250);
  await page.click('#btnTheme');
  await page.waitForTimeout(400);
  await navTo(page, 'stats');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'runs/v4-stats-heatmap-dark.png' });
  await ctx.close();

  /* 宽屏：热力图铺满卡片、无横向溢出，输入框加大 */
  const wctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  await wctx.addInitScript((payload) => {
    localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1');
    localStorage.setItem('taskflow.tasks.v1', payload);
  }, seed);
  const wp = await wctx.newPage();
  wp.on('pageerror', (e) => errs.push(e.message));
  await wp.goto(URL, { waitUntil: 'load' });
  await wp.waitForTimeout(450);
  await wp.locator('#sidebar [data-page="stats"]').click();
  await wp.waitForTimeout(550);
  const wideHm = await wp.evaluate(() => {
    const sc = document.querySelector('.hm-scroll');
    const cell = document.querySelector('.hm .hm-cell');
    const months = document.querySelector('.hm-months');
    return {
      scrollW: sc.scrollWidth, clientW: sc.clientWidth,
      cellW: cell.getBoundingClientRect().width,
      monthsDisplay: getComputedStyle(months).display,
    };
  });
  truthy(`宽屏热力图无横向溢出（${wideHm.scrollW}/${wideHm.clientW}）`, wideHm.scrollW <= wideHm.clientW + 1);
  truthy(`宽屏格子随宽度放大（${Math.round(wideHm.cellW * 10) / 10}px）`, wideHm.cellW > 12);
  eq('宽屏月份标签与网格对齐（grid）', wideHm.monthsDisplay, 'grid');
  await wctx.close();
  ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((payload) => {
    localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1');
    localStorage.setItem('taskflow.tasks.v1', payload);
    localStorage.setItem('taskflow.prefs.v1', JSON.stringify({ lang: 'en' }));
  }, seed);
  page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await navTo(page, 'stats');
  await page.waitForTimeout(450);
  eq('英文卡片标题', (await page.locator('.hm-card .card__t').textContent()).trim(), 'Focus heatmap');
  includes('英文图例', await page.locator('.hm-legend').textContent(), 'Less');
  includes('英文总计', await page.locator('.hm-total').textContent(), 'Past year');
  const cn = await page.locator('.hm-card').evaluate((el) => /[\u4e00-\u9fff]/.test(el.innerText));
  eq('英文热力图无中文残留', cn, false);
  await ctx.close();

  /* 轨道对比度红线：统计卡片本身就是 surface-variant，浅色下轨道若同色会整条消失 */
  const tctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1100, height: 1000 } });
  await tctx.addInitScript((payload) => {
    localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1');
    localStorage.setItem('taskflow.tasks.v1', payload);
  }, seed);
  const tp = await tctx.newPage();
  tp.on('pageerror', (e) => errs.push('track ' + e.message));
  await tp.goto(URL, { waitUntil: 'load' });
  await tp.waitForTimeout(400);
  await navTo(tp, 'stats');
  await tp.waitForTimeout(450);
  const measure = () => tp.evaluate(() => {
    const nums = (s) => { const m = String(s).match(/[\d.]+/g); return m ? m.map(Number) : null; };
    const over = (fg, bg) => { const a = fg.length > 3 ? fg[3] : 1; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)); };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const one = (sel) => {
      const el = document.querySelector(sel);
      const card = el.closest('.stat-card') || el.parentElement;
      const cs = getComputedStyle(el);
      let eff = over(nums(cs.backgroundColor), nums(getComputedStyle(card).backgroundColor));
      const m = cs.backgroundImage.match(/rgba?\([^)]+\)/);
      if (m) eff = over(nums(m[0]), eff);
      return Math.abs(lum(eff) - lum(nums(getComputedStyle(card).backgroundColor)));
    };
    return { lg: Math.round(one('.progress--lg') * 1000) / 1000, dist: Math.round(one('.dist__bar') * 1000) / 1000 };
  });
  const lightTrack = await measure();
  truthy(`浅色完成率轨道与卡片可辨（亮度差 ${lightTrack.lg}）`, lightTrack.lg >= 0.02);
  truthy(`浅色优先级轨道与卡片可辨（亮度差 ${lightTrack.dist}）`, lightTrack.dist >= 0.02);
  await tp.evaluate(() => { const side = document.getElementById('btnThemeSide'); (side && side.offsetParent ? side : document.getElementById('btnTheme')).click(); });
  await tp.waitForTimeout(400);
  const darkTrack = await measure();
  truthy(`深色完成率轨道与卡片可辨（亮度差 ${darkTrack.lg}）`, darkTrack.lg >= 0.02);
  truthy(`深色优先级轨道与卡片可辨（亮度差 ${darkTrack.dist}）`, darkTrack.dist >= 0.02);
  await tctx.close();

  truthy('无页面脚本错误', errs.length === 0);
  if (errs.length) out.push('        errors: ' + errs.join(' | '));

  console.log(out.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });