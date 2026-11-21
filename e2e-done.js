/* 完成任务不再继续计时：截止/倒计时两种模式的冻结与撤销恢复 */
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

const seed = (tasks) => JSON.stringify({ v: 1, tasks, sessions: [], savedAt: Date.now() });
const base = (over) => Object.assign({
  desc: '', priority: 'medium', notify: false, alertAhead: 0,
  pomo: null, phaseIndex: 0, phaseStartedAt: 0, accumulatedMs: 0,
  dueAt: null, status: 'idle', startedAt: null,
  firedAt: null, warned: true, createdAt: Date.now(), updatedAt: Date.now(), completedAt: null,
}, over);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errs = [];

  async function open(seedTasks) {
    const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((payload) => {
      localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1');
      localStorage.setItem('taskflow.tasks.v1', payload);
    }, seed(seedTasks));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(450);
    await navTo(page, 'tasks');
    await page.waitForTimeout(350);
    return { ctx, page };
  }
  const timeText = (page) => page.locator('.task .cd__time').first().textContent();

  /* 1. 截止模式：完成后时间冻结 */
  {
    const { ctx, page } = await open([base({
      id: 'd1', title: '截止任务', mode: 'deadline',
      dueAt: Date.now() + 3 * 3600000,
    })]);
    await page.click('.task .check');
    await page.waitForTimeout(500);
    const t1 = await timeText(page);
    await page.waitForTimeout(1300);
    const t2 = await timeText(page);
    eq('截止任务完成后时间冻结', t1, t2);
    eq('截止任务显示已完成', await page.locator('.task .cd__label').textContent(), '已完成');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('taskflow.tasks.v1')).tasks[0]);
    truthy('完成时间已落库', stored.completedAt > 0);
    await ctx.close();
  }

  /* 2. 倒计时模式：完成即停表，撤销后继续走 */
  {
    const { ctx, page } = await open([base({
      id: 'd2', title: '倒计时任务', mode: 'duration',
      durationMs: 600000, status: 'running', startedAt: Date.now() - 60000,
    })]);
    await page.click('.task .check');
    await page.waitForTimeout(500);
    const a1 = await timeText(page);
    await page.waitForTimeout(1300);
    const a2 = await timeText(page);
    eq('倒计时完成后时间冻结', a1, a2);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('taskflow.tasks.v1')).tasks[0]);
    truthy('完成后实际用时被保留（accumulatedMs 不归零）', stored.accumulatedMs > 0 && stored.accumulatedMs < 600000);
    truthy('完成后停表（segStart 清空）', stored.segStart == null);

    await page.locator('.snack__act').first().click();
    await page.waitForTimeout(1600);
    const b1 = await timeText(page);
    await page.waitForTimeout(1300);
    const b2 = await timeText(page);
    truthy('撤销后恢复计时（时间在减少）', b1 !== b2);
    await ctx.close();
  }

  truthy('无页面脚本错误', errs.length === 0);
  if (errs.length) out.push('        errors: ' + errs.join(' | '));
  console.log(out.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });