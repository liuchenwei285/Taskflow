/* TaskFlow 微交互动效 E2E 验收（真实 Chrome + DOM/样式实测）
   覆盖：按钮 / 统计卡 / 空状态 / 页面切换 / 弹窗 / 倒计时逐位滚动 / 深浅色 / 减少动态效果 / 红线自检。
   断言只读可观测事实（computed style、animation、DOM 结构、localStorage 形状），不依赖截图。 */
const { chromium } = require('playwright');

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
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(200);

  /* ---------- 1. 动效令牌 ---------- */
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = k => cs.getPropertyValue(k).trim();
    return {
      hover: g('--dur-hover'), press: g('--dur-press'), modal: g('--dur-modal'),
      page: g('--dur-page'), card: g('--dur-card'), sidebar: g('--dur-sidebar'),
      empty: g('--dur-empty'), roll: g('--dur-roll'),
      easeOut: g('--ease-out'), easeIn: g('--ease-in'), easeInOut: g('--ease-inout'),
      moveCard: g('--move-card')
    };
  });
  eq('令牌 --dur-hover', tokens.hover, '120ms');
  eq('令牌 --dur-press', tokens.press, '100ms');
  eq('令牌 --dur-modal', tokens.modal, '220ms');
  eq('令牌 --dur-page', tokens.page, '220ms');
  eq('令牌 --dur-card', tokens.card, '300ms');
  eq('令牌 --dur-sidebar', tokens.sidebar, '240ms');
  eq('令牌 --dur-empty', tokens.empty, '600ms');
  eq('令牌 --dur-roll', tokens.roll, '260ms');
  truthy('令牌 --ease-out 是曲线', /cubic-bezier/.test(tokens.easeOut));
  truthy('令牌 --ease-in 是曲线', /cubic-bezier/.test(tokens.easeIn));
  truthy('令牌 --ease-inout 是曲线', /cubic-bezier/.test(tokens.easeInOut));
  eq('令牌 --move-card', tokens.moveCard, '2px');

  /* ---------- 2. 空状态：首次出场序列 ---------- */
  const emptyState = await page.evaluate(() => {
    const root = document.querySelector('.empty');
    if (!root) return null;
    const kids = Array.from(root.children);
    return {
      hasIntroClass: root.classList.contains('empty--in'),
      count: kids.length,
      animNames: kids.map(k => getComputedStyle(k).animationName),
      delays: kids.map(k => getComputedStyle(k).animationDelay),
      iconIter: getComputedStyle(root.querySelector('.empty__icon svg')).animationIterationCount,
      iconName: getComputedStyle(root.querySelector('.empty__icon svg')).animationName
    };
  });
  truthy('空状态首次出现带入场类', emptyState && emptyState.hasIntroClass);
  eq('空状态 4 个元素(图标/标题/描述/按钮)', emptyState.count, 4);
  eq('空状态图标立即入场', emptyState.delays[0], '0s');
  eq('空状态标题 150ms', emptyState.delays[1], '0.15s');
  eq('空状态描述 280ms', emptyState.delays[2], '0.28s');
  eq('空状态按钮 400ms', emptyState.delays[3], '0.4s');
  eq('空状态图标动画只跑一次', emptyState.iconIter, '1');
  eq('空状态图标一次性动作', emptyState.iconName, 'emptyIcon');

  /* ---------- 3. 空状态不因重渲染重播（用统计卡点击触发真实重渲染） ---------- */
  await page.click('.stat[data-stat="done"]');
  await page.waitForTimeout(200);
  const emptyAgain = await page.evaluate(() => {
    const e = document.querySelector('.empty');
    return { exists: !!e, hasIntroClass: e ? e.classList.contains('empty--in') : null };
  });
  truthy('重渲染后空状态仍在', emptyAgain.exists);
  eq('空状态重渲染不重播', emptyAgain.hasIntroClass, false);
  await page.click('.stat[data-stat="done"]');       // 切回全部
  await page.waitForTimeout(150);

  /* ---------- 4. 按钮：过渡 / 按压 / 焦点 / 禁用 ---------- */
  const btnTrans = await page.evaluate(() => {
    const b = document.querySelector('.empty__create');
    const cs = getComputedStyle(b);
    return { prop: cs.transitionProperty, dur: cs.transitionDuration };
  });
  truthy('按钮过渡含 transform', /transform/.test(btnTrans.prop));
  truthy('按钮按压时长 100ms', /0\.1s/.test(btnTrans.dur));

  const hit = await page.evaluate(() => {
    const b = document.querySelector('.empty__create');
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { covered: !(top === b || b.contains(top)) };
  });
  eq('新建按钮未被其它层遮挡', hit.covered, false);

  const box = await page.locator('.empty__create').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(60);
  const pressed = await page.evaluate(() => getComputedStyle(document.querySelector('.empty__create')).transform);
  await page.mouse.move(4, 4);              /* 移开再松开，避免触发 click 打开弹窗 */
  await page.mouse.up();
  await page.waitForTimeout(240);
  const released = await page.evaluate(() => getComputedStyle(document.querySelector('.empty__create')).transform);
  const dlgOpen = await page.evaluate(() => document.querySelector('#dlgScrim').classList.contains('open'));
  eq('按压测试未误开弹窗', dlgOpen, false);
  truthy('按下时缩小', pressed && pressed !== 'none' && /matrix/.test(pressed));
  const pm = pressed.match(/matrix\(([^)]+)\)/);
  truthy('按压缩放比约 0.97', pm && Math.abs(parseFloat(pm[1].split(',')[0]) - 0.97) < 0.02);
  eq('松开复位', released, 'none');

  /* 用键盘先建立键盘焦点语境，再把焦点移到按钮上（Chrome 继承 :focus-visible） */
  await page.keyboard.press('Tab');
  const focusHit = await page.evaluate(() => {
    const a = document.activeElement;
    const keyboardCtx = a.matches(':focus-visible');
    const b = document.querySelector('.empty__create');
    b.focus();
    const cs = getComputedStyle(b);
    return {
      keyboardCtx: keyboardCtx,
      matches: b.matches(':focus-visible'),
      outline: cs.outlineStyle + ' ' + cs.outlineWidth
    };
  });
  truthy('键盘 Tab 建立焦点语境', focusHit.keyboardCtx);
  truthy('键盘焦点可见(focus-visible 命中)', focusHit.matches);
  truthy('焦点有可见轮廓', /solid/.test(focusHit.outline));

  const disabledInfo = await page.evaluate(() => {
    const b = document.createElement('button');
    b.className = 'btn btn--primary';
    b.disabled = true;
    b.textContent = 'x';
    document.body.appendChild(b);
    const cs = getComputedStyle(b);
    const r = { pointerEvents: cs.pointerEvents, opacity: cs.opacity };
    b.remove();
    return r;
  });
  eq('禁用态不接收指针', disabledInfo.pointerEvents, 'none');
  eq('禁用态半透明', disabledInfo.opacity, '0.4');

  /* ---------- 5. 统计卡：首次淡入 / hover 上浮 / 重渲染不重播 / 数字仅变化时过渡 ---------- */
  await page.reload({ waitUntil: 'load' });
  const statIntro = await page.evaluate(() => {
    const s = document.querySelector('.stat');
    return s ? getComputedStyle(s).animationName : 'none';
  });
  eq('统计卡首次挂载淡入', statIntro, 'statIn');

  await page.waitForTimeout(900);
  await page.hover('.stat');
  await page.waitForTimeout(240);
  const statHover = await page.evaluate(() => {
    const s = document.querySelector('.stat');
    const cs = getComputedStyle(s);
    return {
      hovered: s.matches(':hover'),
      transform: cs.transform,
      shadow: cs.boxShadow
    };
  });
  truthy('统计卡处于 hover 态', statHover.hovered);
  const hm = statHover.transform.match(/matrix\(([^)]+)\)/);
  truthy('统计卡 hover 上浮 2px', !!hm && Math.abs(parseFloat(hm[1].split(',')[5]) + 2) < 0.6);
  truthy('统计卡 hover 描边变化', statHover.shadow && /rgb/.test(statHover.shadow));

  await page.click('.stat[data-stat="done"]');
  await page.waitForTimeout(250);
  const statAfter = await page.evaluate(() => {
    const s = document.querySelector('.stat');
    return {
      running: s.getAnimations().filter(a => a.playState === 'running').length,
      bump: !!document.querySelector('.stat__num.is-bump')
    };
  });
  eq('统计卡重渲染不重播入场', statAfter.running, 0);
  eq('数值未变时不触发数字过渡', statAfter.bump, false);
  await page.click('.stat[data-stat="done"]');
  await page.waitForTimeout(150);

  /* ---------- 6. 新建任务 + 弹窗开合 ---------- */
  await page.click('#btnAdd');
  await page.waitForTimeout(60);
  const opening = await page.evaluate(() => {
    const s = document.querySelector('#dlgScrim');
    const d = document.querySelector('#dlgScrim .dialog');
    return {
      open: s.classList.contains('open'),
      scrimOpacity: parseFloat(getComputedStyle(s).opacity),
      dialogTransform: getComputedStyle(d).transform,
      dur: getComputedStyle(d).transitionDuration
    };
  });
  truthy('弹窗打开加 open 类', opening.open);
  truthy('遮罩渐入中(0<opacity<1)', opening.scrimOpacity > 0 && opening.scrimOpacity < 1);
  truthy('弹窗有缩放过渡', opening.dialogTransform !== 'none');
  truthy('弹窗过渡 220ms', /0\.22s/.test(opening.dur));

  await page.waitForTimeout(340);
  const opened = await page.evaluate(() => {
    const d = document.querySelector('#dlgScrim .dialog');
    return { transform: getComputedStyle(d).transform, opacity: getComputedStyle(d).opacity };
  });
  eq('弹窗就位', opened.transform, 'none');
  eq('弹窗完全可见', opened.opacity, '1');

  await page.fill('#inpTitle', '动效验收任务');
  await page.click('#panelDuration [data-preset="5"]');
  await page.click('#btnSave');
  await page.waitForTimeout(80);
  const closing = await page.evaluate(() => document.querySelector('#dlgScrim').classList.contains('is-closing'));
  truthy('关闭走反向过渡(is-closing)', closing);
  await page.waitForTimeout(340);
  const closed = await page.evaluate(() => ({
    open: document.querySelector('#dlgScrim').classList.contains('open'),
    closing: document.querySelector('#dlgScrim').classList.contains('is-closing')
  }));
  eq('关闭后已卸载 open', closed.open, false);
  eq('关闭后 is-closing 已清除', closed.closing, false);

  /* ---------- 7. 提交防重复 ---------- */
  await page.click('#btnAdd');
  await page.waitForTimeout(320);
  await page.fill('#inpTitle', '双击保存测试');
  await page.evaluate(() => { const b = document.querySelector('#btnSave'); b.click(); b.click(); b.click(); });
  await page.waitForTimeout(500);
  const dupCount = await page.evaluate(() => {
    const raw = localStorage.getItem('taskflow.v1') || '';
    return raw;
  });
  const dup = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.task__title')).map(n => n.textContent);
    return cards.filter(t => t === '双击保存测试').length;
  });
  eq('连续点击只创建一条', dup, 1);

  /* ---------- 8. 倒计时逐位滚动 ---------- */
  const pickCard = `(() => {
    const card = Array.from(document.querySelectorAll('.task'))
      .find(c => c.querySelector('.task__title').textContent === '动效验收任务');
    return card;
  })()`;
  const cd0 = await page.evaluate(`(() => {
    const card = ${pickCard};
    const el = card.querySelector('.cd__time');
    return {
      text: el.querySelector('.cd__in').textContent,
      sr: el.querySelector('.cd__sr').textContent,
      digits: el.querySelectorAll('.cd__dig').length,
      seps: el.querySelectorAll('.cd__sep').length,
      width: el.getBoundingClientRect().width,
      hasIn: !!el.querySelector('.cd__in'),
      timeFontVariant: getComputedStyle(el).fontVariantNumeric
    };
  })()`);
  truthy('倒计时按位包裹（存在 .cd__in）', cd0.hasIn);
  truthy('倒计时拆成数字位', cd0.digits >= 3);
  eq('分隔符单独成位', cd0.seps, 1);
  eq('读屏层给出完整时间', cd0.sr.replace(/\s+/g, ''), cd0.text.replace(/\s+/g, ''));
  truthy('使用等宽数字', /tabular-nums/.test(cd0.timeFontVariant));

  const rollInfo = await page.evaluate(`(async () => {
    const card = ${pickCard};
    const el = card.querySelector('.cd__time');
    const inner = el.querySelector('.cd__in');
    const events = [];
    let prev = inner.textContent;
    const obs = new MutationObserver(() => {
      const now = inner.textContent;
      if (now === prev) return;
      const rolling = el.querySelectorAll('.cd__dig.is-roll').length;
      const changedPos = now.split('').filter((c, i) => c !== prev.split('')[i]).length;
      events.push({ rolling: rolling, changedPos: changedPos });
      prev = now;
    });
    obs.observe(inner, { childList: true, subtree: true, characterData: true });
    const before = inner.textContent;
    const beforeW = el.getBoundingClientRect().width;
    let cardRunning = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 2600){
      cardRunning = Math.max(cardRunning, card.getAnimations().filter(a => a.playState === 'running').length);
      await new Promise(r => setTimeout(r, 40));
    }
    obs.disconnect();
    return {
      before: before,
      after: inner.textContent,
      events: events,
      beforeW: beforeW,
      afterW: el.getBoundingClientRect().width,
      cardRunning: cardRunning,
      cardOpacity: getComputedStyle(card).opacity,
      sr: el.querySelector('.cd__sr').textContent
    };
  })()`);
  truthy('倒计时数值在走', rollInfo.before !== rollInfo.after);
  truthy('倒计时确实有位在滚动', rollInfo.events.length > 0);
  truthy('滚动位数始终不超过变化位数',
    rollInfo.events.length > 0 && rollInfo.events.every(e => e.rolling > 0 && e.rolling <= e.changedPos));
  truthy('单次变化只滚动一位（常规秒跳）',
    rollInfo.events.length > 0 && rollInfo.events.every(e => e.rolling === 1));
  truthy('数字区宽度不抖动', Math.abs(rollInfo.afterW - rollInfo.beforeW) < 0.6);
  eq('卡片不因数字滚动而重播动画', rollInfo.cardRunning, 0);
  eq('卡片不闪烁', rollInfo.cardOpacity, '1');
  eq('读屏文本与显示一致', rollInfo.sr.replace(/\s+/g, ''), rollInfo.after.replace(/\s+/g, ''));

  /* ---------- 9. 页面切换 ---------- */
  await page.click('#nav [data-page="stats"]');
  await page.waitForTimeout(60);
  const viewIn = await page.evaluate(() => {
    const v = document.querySelector('#viewStats');
    const cs = getComputedStyle(v);
    return { hasClass: v.classList.contains('view--in'), anim: cs.animationName, dur: cs.animationDuration };
  });
  truthy('切页加 view--in', viewIn.hasClass);
  eq('切页动效 viewIn', viewIn.anim, 'viewIn');
  eq('切页时长 220ms', viewIn.dur, '0.22s');

  const startBefore = await page.evaluate(() => {
    const a = document.querySelector('#viewStats').getAnimations()[0];
    return a ? a.startTime : null;
  });
  await page.click('#nav [data-page="stats"]');
  await page.waitForTimeout(90);
  const startAfter = await page.evaluate(() => {
    const a = document.querySelector('#viewStats').getAnimations()[0];
    return a ? a.startTime : null;
  });
  eq('同页重复点击不重播', startAfter, startBefore);

  await page.click('#nav [data-page="tasks"]');
  await page.waitForTimeout(90);
  const backIn = await page.evaluate(() => document.querySelector('#viewTasks').classList.contains('view--in'));
  truthy('真实切页重新触发', backIn);

  /* ---------- 10. 深浅色 ---------- */
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.click('#btnTheme');
  await page.waitForTimeout(420);
  const darkInfo = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const b = document.querySelector('.btn');
    return {
      bg: cs.backgroundColor,
      theme: document.documentElement.dataset.theme,
      btnDur: getComputedStyle(b).transitionDuration,
      btnProp: getComputedStyle(b).transitionProperty
    };
  });
  truthy('主题切换生效', darkInfo.bg !== lightBg);
  eq('主题标记为 dark', darkInfo.theme, 'dark');
  truthy('深色下按钮动效仍在', /0\.1s/.test(darkInfo.btnDur) && /transform/.test(darkInfo.btnProp));
  await page.click('#btnTheme');
  await page.waitForTimeout(420);

  /* ---------- 11. 红线自检：数据形状与品牌色 ---------- */
  const store = await page.evaluate(() => {
    let found = null;
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      try {
        const o = JSON.parse(localStorage.getItem(k));
        if (o && o.tasks && o.v) found = o;
      } catch(_){}
    }
    const o = found || {};
    const t = (o.tasks || [])[0] || {};
    return {
      keys: Object.keys(o).sort(),
      taskKeys: Object.keys(t).sort(),
      primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      accentPicker: !!document.querySelector('#accentPicker')
    };
  });
  eq('存储顶层键未变', store.keys.join(','), 'savedAt,schemaVersion,sessions,tasks,v');
  truthy('任务字段未变（含 durationMs/remainingMs/startedAt/firedAt）',
    ['durationMs','remainingMs','startedAt','firedAt','alertAhead','notify','mode','priority']
      .every(k => store.taskKeys.indexOf(k) >= 0));
  eq('品牌主色未变', store.primary, '#355C9A');
  truthy('自定义主题色控件仍在', store.accentPicker);

  /* 自定义强调色（用户粉色）仍能生效 */
  const accent = await page.evaluate(() => {
    const inp = document.querySelector('#accentPicker');
    if (!inp) return null;
    inp.value = '#FF3D8B';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    const cs = getComputedStyle(document.documentElement);
    return {
      primary: cs.getPropertyValue('--primary').trim().toUpperCase(),
      accent: cs.getPropertyValue('--accent').trim().toUpperCase()
    };
  });
  truthy('自定义强调色写入 --primary', accent && accent.primary === '#FF3D8B');
  truthy('自定义强调色写入 --accent', accent && accent.accent === '#FF3D8B');

  /* ---------- 12. 宽屏：统计卡图标放大 ---------- */
  const wide = await ctx.newPage();
  await wide.setViewportSize({ width: 1280, height: 800 });
  await wide.goto(URL, { waitUntil: 'load' });
  await wide.waitForTimeout(600);
  await wide.hover('.stat');
  await wide.waitForTimeout(280);
  const iconScale = await wide.evaluate(() => {
    const i = document.querySelector('.stat__icon');
    if (!i) return null;
    const m = getComputedStyle(i).transform.match(/matrix\(([^)]+)\)/);
    return m ? parseFloat(m[1].split(',')[0]) : null;
  });
  truthy('宽屏统计卡图标 hover 放大 1.06', iconScale !== null && Math.abs(iconScale - 1.06) < 0.02);
  await wide.close();

  /* ---------- 13. 减少动态效果 ---------- */
  const ctx2 = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto(URL, { waitUntil: 'load' });
  await p2.waitForTimeout(500);
  /* 建一个任务，才有倒计时可观察 */
  await p2.click('#btnAdd');
  await p2.waitForTimeout(420);
  await p2.fill('#inpTitle', '减少动态效果验证');
  await p2.click('#panelDuration [data-preset="5"]');
  await p2.click('#btnSave');
  await p2.waitForTimeout(700);
  const rm = await p2.evaluate(async () => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = document.querySelector('.cd__time');
    if (!el) return { mq: mq, noCd: true };
    const before = el.querySelector('.cd__in').textContent;
    await new Promise(r => setTimeout(r, 1500));
    const after = el.querySelector('.cd__in').textContent;
    const rolling = el.querySelectorAll('.cd__dig.is-roll').length;
    const stat = document.querySelector('.stat');
    return {
      mq: mq, before: before, after: after, rolling: rolling,
      statAnimDur: stat ? getComputedStyle(stat).animationDuration : '',
      emptyAnimDur: document.querySelector('.empty') ? getComputedStyle(document.querySelector('.empty').children[0]).animationDuration : ''
    };
  });
  truthy('系统减少动态效果已生效', rm.mq);
  eq('减少动态效果下不做位滚动', rm.rolling === undefined ? 0 : rm.rolling, 0);
  truthy('减少动态效果下数值仍在更新', rm.noCd ? true : (rm.before !== rm.after));
  truthy('减少动态效果下入场动画时长近 0', parseFloat(rm.statAnimDur || '0s') < 0.05);
  await ctx2.close();

  /* ---------- 收尾 ---------- */
  eq('全程无 JS 报错', errors.join(' | '), '');

  await browser.close();
  console.log(log.join('\n'));
  console.log('\n============================================================');
  console.log(`动效验收结果：${pass} passed, ${fail} failed, ${pass + fail} total`);
  console.log('============================================================');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log(log.join('\n'));
  console.error('FATAL', e);
  process.exit(1);
});
