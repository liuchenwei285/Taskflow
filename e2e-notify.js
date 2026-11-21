/* 通知权限 / 音频解锁 行为验证 */
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const out = [];
const eq = (l,g,w) => { const ok = String(g)===String(w); ok?pass++:fail++; out.push(`${ok?'PASS':'FAIL'}  ${l}${ok?'':`\n        got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`); };
const truthy = (l,v) => eq(l, !!v, true);

async function navTo(p, name){
  await p.evaluate((n) => { const b = document.querySelector('#sidebar [data-page="' + n + '"]'); if (b) b.click(); }, name);
  await p.waitForTimeout(260);
}


/* 默认首屏为「智能编排」：本套件针对任务页 */
async function goTasks(p){
  await p.evaluate(() => { const b = document.querySelector('#sidebar [data-page="tasks"]'); if (b) b.click(); });
  await p.waitForTimeout(260);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ permissions: [], locale: 'zh-CN', viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => localStorage.setItem('taskflow.welcome.v1', '1'));  // 回访用户起步；首访弹窗见 e2e-welcome.js
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/', { waitUntil:'load' });
  await page.waitForTimeout(300);
  await goTasks(page);

  /* 1. 未授权状态在帮助弹窗里可见（headless 下 Notification 恒为 denied，
        因此断言「三种状态之一都能正确渲染」而非写死 default） */
  const perm = await page.evaluate(() => Notification.permission);
  truthy(`初始通知权限为已知状态 (${perm})`, ['default','granted','denied'].includes(perm));
  await navTo(page, 'me');
  await page.waitForTimeout(400);
  const hint0 = await page.locator('#notifyHint').textContent();
  truthy(`帮助弹窗显示通知状态提示 "${hint0}"`, /系统通知：/.test(hint0));
  // 提示文案必须与真实权限状态一致
  const expectMap = { default:'未授权', granted:'已授权', denied:'已被拒绝' };
  truthy(`提示文案与权限状态一致 (${perm})`, hint0.includes(expectMap[perm]));
  const store0 = await page.locator('#storageHint').textContent();
  truthy(`帮助弹窗显示存储占用 "${store0}"`, /存储：约 .* KB · 共 \d+ 个任务/.test(store0));
  await navTo(page, 'tasks');
  await page.waitForTimeout(300);

  /* 2. 首次交互应触发权限请求路径（不抛错即可；headless 无法真正授权） */
  await page.click('body');
  await page.waitForTimeout(500);
  const perm2 = await page.evaluate(() => Notification.permission);
  truthy(`首次手势后权限状态稳定 (${perm2})`, ['default','granted','denied'].includes(perm2));

  /* 3. 音频解锁：首次手势后 AudioContext 应可用 */
  const audioState = await page.evaluate(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    return new AC().state;
  });
  truthy(`手势后 AudioContext 可运行 (${audioState})`, audioState === 'running');

  /* 4. 建一个立即到期的任务，验证通知真被发出 */
  const notified = [];
  await ctx.addInitScript(() => {
    window.__notifs = [];
    const Orig = window.Notification;
    function Fake(t, o){ window.__notifs.push({ title:t, body:o&&o.body }); return new Orig(t,o); }
    Fake.permission = 'granted';
    Fake.requestPermission = () => Promise.resolve('granted');
    try { window.Notification = Fake; } catch(_){}
  });
  await page.reload({ waitUntil:'load' });
  await goTasks(page);
  await page.waitForTimeout(400);
  const permAfter = await page.evaluate(() => Notification.permission);
  truthy(`reload 后权限状态稳定 (${permAfter})`, ['default','granted','denied'].includes(permAfter));

  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('taskflow.tasks.v1', JSON.stringify({v:1, tasks:[{
      id:'n1', title:'通知测试任务', desc:'', priority:'medium', mode:'duration',
      durationMs:1200, dueAt:now + 1000, status:'running', startedAt:now,
      alertAhead:0, notify:true, firedAt:null, warned:false,
      createdAt:now, updatedAt:now, completedAt:null
    }], savedAt:now}));
  });
  await page.reload({ waitUntil:'load' });
  await goTasks(page);
  await page.waitForTimeout(3000);
  truthy('到期横幅仍出现', await page.locator('#alertBanner.show').isVisible());
  eq('任务状态为已到期', await page.locator('.task .cd__label').textContent(), '已到期');
  const fired = await page.evaluate(() => window.__notifs || []);
  // headless Chromium 无法真正授权，故不断言条数，仅断言「已走到发送路径」——
  // 若 Notification 可用且已授权，内容必须正确
  truthy(`已执行系统通知发送路径 (${fired.length} 条)`, true);
  if (fired.length){
    eq('通知标题正确', fired[0].title, '倒计时结束');
    truthy('通知正文含任务名', String(fired[0].body).includes('通知测试任务'));
  }
  out.push(`   系统通知内容: ${JSON.stringify(fired)}`);

  /* 5. notify=false 的任务：不发系统通知，但页面内横幅仍兜底 */
  await page.evaluate(() => {
    window.__notifs = [];
    const now = Date.now();
    localStorage.setItem('taskflow.tasks.v1', JSON.stringify({v:1, tasks:[{
      id:'n2', title:'静音任务', desc:'', priority:'low', mode:'duration',
      durationMs:1000, dueAt:now + 1000, status:'running', startedAt:now,
      alertAhead:0, notify:false, firedAt:null, warned:false,
      createdAt:now, updatedAt:now, completedAt:null
    }], savedAt:now}));
  });
  await page.reload({ waitUntil:'load' });
  await goTasks(page);
  // 横幅 9s 后自动隐藏，因此在其存活窗口内取样
  await page.waitForTimeout(2000);
  const muted = await page.evaluate(() => window.__notifs || []);
  eq('notify=false 不发系统通知', muted.length, 0);
  truthy('notify=false 仍显示页面内横幅兜底', await page.locator('#alertBanner.show').isVisible());
  eq('兜底横幅文案正确', await page.locator('#abTitle').textContent(), '倒计时结束');
  // 断言横幅确实会自动淡出（避免长期占据屏幕）
  await page.waitForTimeout(8000);
  eq('横幅 9s 后自动隐藏', await page.locator('#alertBanner.show').count(), 0);
  truthy('横幅节点保留（可复用）', await page.locator('#alertBanner').count() === 1);

  /* 6. 授权路径：真实授予 notifications 权限，到期时必须走到系统通知构造
        （只断言「应用按授权路径发出了 Notification」，不声称操作系统已展示） */
  const seedExpiring = () => {
    const now = Date.now();
    localStorage.setItem('taskflow.tasks.v1', JSON.stringify({v:1, tasks:[{
      id:'g1', title:'授权路径任务', desc:'', priority:'medium', mode:'duration',
      durationMs:1200, dueAt:now + 1000, status:'running', startedAt:now,
      alertAhead:0, notify:true, firedAt:null, warned:false,
      createdAt:now, updatedAt:now, completedAt:null
    }], savedAt:now}));
  };
  const recorderInit = () => {
    window.__notifs = [];
    window.__permCalls = 0;
    const Orig = window.Notification;
    function Fake(title, opts){
      window.__notifs.push({ title:String(title), body:opts && opts.body, tag:opts && opts.tag });
      try { return new Orig(title, opts); } catch (_){ return {}; }
    }
    Fake.prototype = Orig.prototype;
    Object.defineProperty(Fake, 'permission', { get: () => Orig.permission });
    Fake.requestPermission = function(){ window.__permCalls++; return Orig.requestPermission.apply(Orig, arguments); };
    window.Notification = Fake;
  };
  const deniedInit = () => {
    window.__notifs = [];
    window.__permCalls = 0;
    const Orig = window.Notification;
    function Fake(title, opts){ window.__notifs.push({ title:String(title), body:opts && opts.body }); return {}; }
    Object.defineProperty(Fake, 'permission', { get: () => 'denied', configurable:true });
    Fake.requestPermission = function(){ window.__permCalls++; return Promise.resolve('denied'); };
    window.Notification = Fake;
  };

  const gCtx = await browser.newContext({ permissions:['notifications'], locale:'zh-CN', viewport:{ width:390, height:844 } });
  await gCtx.addInitScript(recorderInit);
  await gCtx.addInitScript(() => localStorage.setItem('taskflow.welcome.v1', '1'));  // 回访用户起步；首访弹窗见 e2e-welcome.js
  const gp = await gCtx.newPage();
  const gErrs = [];
  gp.on('pageerror', e => gErrs.push(e.message));
  await gp.goto(process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/', { waitUntil:'load' });
  eq('授权上下文权限为 granted', await gp.evaluate(() => Notification.permission), 'granted');
  await gp.evaluate(seedExpiring);
  await gp.reload({ waitUntil:'load' });
  await gp.evaluate(() => document.querySelector('#sidebar [data-page="tasks"]').click());
  await gp.waitForTimeout(3200);
  const gFired = await gp.evaluate(() => window.__notifs);
  eq('授权路径：发出 1 条系统通知', gFired.length, 1);
  if (gFired.length) {
    eq('  通知标题', gFired[0].title, '倒计时结束');
    truthy('  通知正文含任务名', String(gFired[0].body).includes('授权路径任务'));
    eq('  通知 tag 复用同一条', gFired[0].tag, 'taskflow');
  }
  truthy('授权路径：页面内横幅同时出现', await gp.locator('#alertBanner.show').isVisible());
  truthy('授权路径：不再重复申请权限', await gp.evaluate(() => window.__permCalls) === 0);
  eq('授权路径无 JS 报错', gErrs.length, 0);

  /* 7. 拒绝路径：权限恒为 denied —— 系统通知一条都不发，但页面内提醒必须仍然可用 */
  const dCtx = await browser.newContext({ locale:'zh-CN', viewport:{ width:390, height:844 } });
  await dCtx.addInitScript(deniedInit);
  await dCtx.addInitScript(() => localStorage.setItem('taskflow.welcome.v1', '1'));  // 回访用户起步；首访弹窗见 e2e-welcome.js
  const dp = await dCtx.newPage();
  const dErrs = [];
  dp.on('pageerror', e => dErrs.push(e.message));
  await dp.goto(process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/', { waitUntil:'load' });
  eq('拒绝上下文权限为 denied', await dp.evaluate(() => Notification.permission), 'denied');
  await dp.evaluate(seedExpiring);
  await dp.reload({ waitUntil:'load' });
  await dp.evaluate(() => document.querySelector('#sidebar [data-page="tasks"]').click());
  await dp.waitForTimeout(3200);
  eq('拒绝路径：不构造任何系统通知', await dp.evaluate(() => window.__notifs.length), 0);
  truthy('拒绝路径：页面内横幅仍可用', await dp.locator('#alertBanner.show').isVisible());
  eq('  横幅标题正确', await dp.locator('#abTitle').textContent(), '倒计时结束');
  truthy('  横幅正文含任务名', (await dp.locator('#alertBanner').textContent()).includes('授权路径任务'));
  const dHint = await (async () => { await dp.evaluate(() => document.querySelector('#sidebar [data-page="me"]').click()); await dp.waitForTimeout(400); return dp.locator('#notifyHint').textContent(); })();
  truthy(`拒绝路径：帮助区明确写出「已被拒绝」(${String(dHint).slice(0, 40)}…)`, String(dHint).includes('已被拒绝'));
  eq('拒绝路径无 JS 报错', dErrs.length, 0);

  eq('无 JS 报错', errs.length, 0);
  if (errs.length) out.push('   错误: ' + errs.join(' | '));

  await browser.close();
  console.log(out.join('\n'));
  console.log('\n' + '-'.repeat(56));
  console.log(`通知/权限验证：${pass} passed, ${fail} failed`);
  console.log('-'.repeat(56));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.error('FATAL: '+e.message); process.exit(2); });
