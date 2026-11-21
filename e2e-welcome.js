/* 首次进入欢迎讲解弹窗 E2E：
   首访自动弹出 / 两条关闭路径 / 已读标记 / 刷新不重复 / 设置页重看 /
   深浅色 / 中英文 / 桌面与手机竖屏 / 减少动态效果 / 遮罩与 Esc / 任务数据红线 */
const { chromium } = require('playwright');
const URL = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';
const WKEY = 'taskflow.welcome.v1';

let pass = 0, fail = 0;
const out = [];
const eq = (l, g, w) => { const ok = String(g) === String(w); ok ? pass++ : fail++; out.push(`${ok ? 'PASS' : 'FAIL'}  ${l}${ok ? '' : `\n        got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`); };
const truthy = (l, v) => eq(l, !!v, true);
const near = (l, g, w, tol) => { const ok = Math.abs(Number(g) - Number(w)) <= tol; ok ? pass++ : fail++; out.push(`${ok ? 'PASS' : 'FAIL'}  ${l}${ok ? '' : `\n        got=${g} want=${w}±${tol}`}`); };

/* 首访 = 全新 context（localStorage 天然为空）；需要「有任务但没看过介绍」时再种任务 */
async function fresh(browser, opts){
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, locale: opts.locale || 'zh-CN',
    reducedMotion: opts.reducedMotion, colorScheme: opts.colorScheme });
  const errs = [];
  if (opts.tasks){
    await ctx.addInitScript((list) => {
      localStorage.setItem('taskflow.tasks.v1', JSON.stringify({ v: 1, tasks: list, savedAt: Date.now() }));
    }, opts.tasks);
  }
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load' });
  return { ctx, p, errs };
}

const isOpen = (p) => p.evaluate(() => document.getElementById('welcomeScrim').classList.contains('open'));
const flag = (p) => p.evaluate((k) => localStorage.getItem(k), WKEY);
const tasksRaw = (p) => p.evaluate(() => localStorage.getItem('taskflow.tasks.v1'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  /* ---------- 1. 首访自动弹出（手机竖屏） ---------- */
  {
    const { ctx, p, errs } = await fresh(browser, {});
    await p.waitForTimeout(900);
    truthy('首访自动弹出', await isOpen(p));
    eq('弹窗角色 aria-modal', await p.getAttribute('#welcomeScrim .dialog', 'aria-modal'), 'true');
    eq('标题文案', (await p.textContent('.welcome__title')).trim(), '让计划，真正发生。');
    eq('副标题文案', (await p.textContent('.welcome__sub')).trim(), '不只是管理任务，更是把学习目标一步步变成现实。');
    eq('三个特色模块', await p.locator('.welcome__feat').count(), 3);
    eq('底部主按钮', (await p.textContent('#wcStart')).trim(), '开始体验 Taskflow');
    eq('底部次按钮', (await p.textContent('#wcSkip')).trim(), '暂时跳过');
    truthy('弹窗打开时锁定背景滚动', await p.evaluate(() => document.body.classList.contains('is-locked')));

    /* 分层入场：遮罩渐显 + 弹窗上浮淡入 + 标题/模块/按钮依次 */
    const anim = await p.evaluate(() => {
      const cs = (s) => getComputedStyle(document.querySelector(s));
      return {
        scrim: cs('#welcomeScrim').transitionDuration,
        head: cs('.welcome__head').animationName,
        feat1: cs('.welcome__feats .welcome__feat:nth-child(1)').animationDelay,
        feat3: cs('.welcome__feats .welcome__feat:nth-child(3)').animationDelay,
        foot: cs('.welcome__foot').animationDelay,
      };
    });
    eq('遮罩有过渡', anim.scrim !== '0s', true);
    eq('标题入场动画', anim.head, 'welcomeIn');
    truthy('特色模块依次淡入（' + anim.feat1 + ' → ' + anim.feat3 + '）', parseFloat(anim.feat1) > 0 && parseFloat(anim.feat3) > parseFloat(anim.feat1));
    truthy('按钮区最后出现（延迟 ' + anim.foot + ' > 最后一个模块）', parseFloat(anim.foot) > parseFloat(anim.feat3));

    /* 焦点落到主按钮，键盘可直接回车 */
    eq('打开后焦点在主按钮', await p.evaluate(() => document.activeElement.id), 'wcStart');

    /* 底部按钮区只靠纯色托底，不画分隔线（用户反馈：中间那条线是多余痕迹） */
    eq('底部按钮区无上边线', await p.evaluate(() => getComputedStyle(document.querySelector('.welcome__foot')).borderTopWidth), '0px');
    eq('底部按钮区与弹窗同色', await p.evaluate(() => getComputedStyle(document.querySelector('.welcome__foot')).backgroundColor),
      await p.evaluate(() => getComputedStyle(document.querySelector('.welcome__dialog')).backgroundColor));

    /* 品牌标识：用户要的是「方块内部的白色图案变大」，方块尺寸与字标字号保持原样 */
    const brandGeo = await p.evaluate(() => {
      const logo = document.querySelector('.welcome__logo').getBoundingClientRect();
      const svg = document.querySelector('.welcome__logo svg').getBoundingClientRect();
      const name = document.querySelector('.welcome__name').getBoundingClientRect();
      return { logo: Math.round(logo.width), svg: Math.round(svg.width),
               nameSize: parseFloat(getComputedStyle(document.querySelector('.welcome__name')).fontSize),
               logoMid: Math.round((logo.top + logo.bottom) / 2), nameMid: Math.round((name.top + name.bottom) / 2) };
    });
    truthy('品牌方块保持原始 ' + brandGeo.logo + 'px（未整体放大）', brandGeo.logo >= 33 && brandGeo.logo <= 35);
    truthy('方块内白色图标放大到 ' + brandGeo.svg + 'px', brandGeo.svg >= 23 && brandGeo.svg <= 25);
    truthy('字标字号保持 ' + brandGeo.nameSize + 'px', brandGeo.nameSize >= 15.5 && brandGeo.nameSize <= 16.5);
    truthy('图标与字标垂直居中（' + brandGeo.logoMid + ' vs ' + brandGeo.nameMid + '）', Math.abs(brandGeo.logoMid - brandGeo.nameMid) <= 2);

    /* 手机竖屏：完整在视口内、无横向溢出 */
    const geo = await p.evaluate(() => {
      const r = document.querySelector('.welcome__dialog').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right,
               vw: window.innerWidth, vh: window.innerHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    truthy('弹窗在视口内', geo.top >= 0 && geo.bottom <= geo.vh + 0.5 && geo.left >= 0 && geo.right <= geo.vw + 0.5);
    eq('竖屏无横向溢出', geo.sw <= geo.cw + 1, true);

    /* 点击「开始体验」关闭 */
    await p.click('#wcStart');
    await p.waitForTimeout(400);
    truthy('点开始体验后关闭', !(await isOpen(p)));
    eq('已读标记写入', await flag(p), '1');
    truthy('关闭后解除滚动锁', !(await p.evaluate(() => document.body.classList.contains('is-locked'))));

    /* 刷新不再弹 */
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(900);
    truthy('刷新后不再弹出', !(await isOpen(p)));
    eq('无页面脚本错误', errs.length ? errs.join(' | ') : 'none', 'none');
    await ctx.close();
  }

  /* ---------- 2. 「暂时跳过」路径 ---------- */
  {
    const { ctx, p, errs } = await fresh(browser, {});
    await p.waitForTimeout(900);
    truthy('首访弹出', await isOpen(p));
    await p.click('#wcSkip');
    await p.waitForTimeout(400);
    truthy('点暂时跳过后关闭', !(await isOpen(p)));
    eq('跳过同样记为已读', await flag(p), '1');
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(900);
    truthy('跳过后刷新不再弹', !(await isOpen(p)));
    eq('无页面脚本错误', errs.length ? errs.join(' | ') : 'none', 'none');
    await ctx.close();
  }

  /* ---------- 3. 红线：开弹窗不动任务数据 ---------- */
  {
    const now = Date.now();
    const list = [
      { id: 'w1', title: '完成高数作业', desc: '', priority: 'high', mode: 'duration', durationMs: 7200000, remainingMs: 7000000, dueAt: now + 3600000, status: 'idle', startedAt: null, alertAhead: 300, notify: true, firedAt: null, warned: false, createdAt: now, updatedAt: now, completedAt: null },
      { id: 'w2', title: '复习线代第 3 章', desc: '第三章', priority: 'medium', mode: 'duration', durationMs: 3600000, remainingMs: 3600000, dueAt: null, status: 'paused', startedAt: null, alertAhead: 300, notify: true, firedAt: null, warned: false, createdAt: now, updatedAt: now, completedAt: null }
    ];
    const { ctx, p, errs } = await fresh(browser, { tasks: list });
    await p.waitForTimeout(900);
    truthy('有历史任务时照样弹出介绍', await isOpen(p));
    const before = await tasksRaw(p);
    eq('任务条数不变', await p.evaluate(() => JSON.parse(localStorage.getItem('taskflow.tasks.v1')).tasks.length), 2);
    await p.click('#wcStart');
    await p.waitForTimeout(500);
    const after = await tasksRaw(p);
    eq('开闭弹窗后任务存储逐字节一致', after === before, true);
    truthy('已读标记不写进任务存储', !/taskflow.welcome/.test(after));
    eq('已读标记也不写进偏好', await p.evaluate(() => (localStorage.getItem('taskflow.prefs.v1') || '').includes('welcome')), false);
    await p.evaluate(() => document.querySelector('#sidebar [data-page="tasks"]').click());
    await p.waitForTimeout(400);
    eq('任务列表仍渲染出 2 张卡片', await p.locator('#viewTasks .task').count(), 2);
    eq('无页面脚本错误', errs.length ? errs.join(' | ') : 'none', 'none');
    await ctx.close();
  }

  /* ---------- 4. 设置页「重新查看产品介绍」 ---------- */
  {
    const { ctx, p, errs } = await fresh(browser, { viewport: { width: 1280, height: 900 } });
    await p.waitForTimeout(900);
    await p.click('#wcSkip');
    await p.waitForTimeout(400);
    await p.evaluate(() => document.querySelector('#sidebar [data-page="me"]').click());
    await p.waitForTimeout(300);
    truthy('设置页有帮助入口', await p.locator('#btnWelcomeReplay').isVisible());
    await p.click('#btnWelcomeReplay');
    await p.waitForTimeout(500);
    truthy('入口可重新打开弹窗', await isOpen(p));
    /* 桌面居中：左右留空相等 */
    const g = await p.evaluate(() => {
      const r = document.querySelector('.welcome__dialog').getBoundingClientRect();
      return { l: r.left, r: window.innerWidth - r.right, w: r.width };
    });
    near('桌面端弹窗水平居中', Math.abs(g.l - g.r), 0, 2);
    /* Esc 关闭 */
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    truthy('Esc 关闭弹窗', !(await isOpen(p)));
    /* 遮罩点击关闭 */
    await p.click('#btnWelcomeReplay');
    await p.waitForTimeout(400);
    truthy('再次打开成功', await isOpen(p));
    await p.mouse.click(8, 8);                       // 点遮罩空白处
    await p.waitForTimeout(400);
    truthy('点遮罩关闭弹窗', !(await isOpen(p)));
    eq('重看不影响已读标记', await flag(p), '1');
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(900);
    truthy('重看后刷新仍不自动弹', !(await isOpen(p)));
    eq('无页面脚本错误', errs.length ? errs.join(' | ') : 'none', 'none');
    await ctx.close();
  }

  /* ---------- 5. 深色主题 ---------- */
  {
    const { ctx, p } = await fresh(browser, { colorScheme: 'dark' });
    await p.waitForTimeout(900);
    truthy('深色下弹出', await isOpen(p));
    const c = await p.evaluate(() => {
      const cs = getComputedStyle;
      return { theme: document.documentElement.dataset.theme,
               surface: cs(document.querySelector('.welcome__dialog')).backgroundColor,
               title: cs(document.querySelector('.welcome__title')).color,
               btn: cs(document.querySelector('#wcStart')).backgroundColor,
               primary: cs(document.documentElement).getPropertyValue('--primary').trim() };
    });
    truthy('深色主题已生效（' + c.theme + '）', c.theme === 'dark');
    truthy('弹窗底色取自表面令牌（' + c.surface + '）', c.surface !== 'rgba(0, 0, 0, 0)');
    truthy('标题与按钮配色不同（文字可读）', c.title !== c.btn);
    truthy('主按钮跟随主题色', c.btn !== 'rgba(0, 0, 0, 0)');
    await ctx.close();
  }

  /* ---------- 6. 英文界面 ---------- */
  {
    const { ctx, p, errs } = await fresh(browser, { locale: 'en-US' });
    await p.waitForTimeout(1000);
    truthy('英文首访弹出', await isOpen(p));
    eq('标题已翻译', (await p.textContent('.welcome__title')).trim(), 'Make your plans actually happen.');
    eq('主按钮已翻译', (await p.textContent('#wcStart')).trim(), 'Try Taskflow');
    eq('次按钮已翻译', (await p.textContent('#wcSkip')).trim(), 'Skip for now');
    const still = await p.evaluate(() => {
      const t = document.querySelector('.welcome__body').innerText;
      return /[\u4e00-\u9fff]/.test(t);
    });
    eq('正文无漏翻译（含 AI 说明行）', still, false);
    /* 切回中文即时生效 */
    await p.click('#wcSkip');
    await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('#sidebar [data-page="me"]').click());
    await p.waitForTimeout(200);
    await p.click('#langSeg [data-lang="zh"]');
    await p.waitForTimeout(300);
    await p.click('#btnWelcomeReplay');
    await p.waitForTimeout(400);
    eq('切中文后标题为中文', (await p.textContent('.welcome__title')).trim(), '让计划，真正发生。');
    eq('无页面脚本错误', errs.length ? errs.join(' | ') : 'none', 'none');
    await ctx.close();
  }

  /* ---------- 7. 减少动态效果 ---------- */
  {
    const { ctx, p } = await fresh(browser, { reducedMotion: 'reduce' });
    await p.waitForTimeout(700);
    truthy('减少动态下仍然弹出', await isOpen(p));
    const a = await p.evaluate(() => {
      const cs = getComputedStyle;
      return { head: cs(document.querySelector('.welcome__head')).animationName,
               feat: cs(document.querySelector('.welcome__feat')).animationName,
               foot: cs(document.querySelector('.welcome__foot')).animationName,
               headOpacity: cs(document.querySelector('.welcome__head')).opacity,
               footOpacity: cs(document.querySelector('.welcome__foot')).opacity };
    });
    eq('标题无入场动画', a.head, 'none');
    eq('特色模块无入场动画', a.feat, 'none');
    eq('按钮区无入场动画', a.foot, 'none');
    eq('内容直接可见（标题）', a.headOpacity, '1');
    eq('内容直接可见（按钮区）', a.footOpacity, '1');
    await ctx.close();
  }

  /* ---------- 8. 窄屏 320px 与小平板 ---------- */
  {
    for (const vp of [{ width: 320, height: 640 }, { width: 768, height: 1024 }]){
      const { ctx, p } = await fresh(browser, { viewport: vp });
      await p.waitForTimeout(900);
      const r = await p.evaluate(() => {
        const d = document.querySelector('.welcome__dialog').getBoundingClientRect();
        return { fits: d.top >= 0 && d.bottom <= window.innerHeight + 0.5 && d.left >= 0 && d.right <= window.innerWidth + 0.5,
                 sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
                 btnVisible: document.querySelector('#wcStart').getBoundingClientRect().width > 0 };
      });
      truthy(`${vp.width}×${vp.height} 弹窗完整可见`, r.fits);
      truthy(`${vp.width}×${vp.height} 无横向溢出`, r.sw <= r.cw + 1);
      truthy(`${vp.width}×${vp.height} 主按钮可点`, r.btnVisible);
      await ctx.close();
    }
  }

  console.log(out.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
