/* =============================================================
 * 语言（中文 / English）验收
 *   1. 默认跟随系统语言（zh-CN → 中文，en-US → English）
 *   2. 手动切换「我的 → Language」立即生效，且持久化
 *   3. 英文模式下界面不残留中文（语言按钮本身除外）
 *   4. 双向切换可逆；英文模式下无横向溢出
 * 用法：node e2e-i18n.js            （需先起静态服务器，npm test 会自动起）
 * ============================================================= */
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/';

let pass = 0, fail = 0;
const log = [];
function ok(name, cond, extra) {
  if (cond) { pass++; log.push('  PASS  ' + name + (extra ? ' (' + extra + ')' : '')); }
  else { fail++; log.push('  FAIL  ' + name + (extra ? ' (' + extra + ')' : '')); }
}
function eq(name, got, want) { ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }

/* 统计可见文本中的中文片段（排除允许保留的「中文」按钮） */
const CJK_SCAN = () => {
  const txt = document.body.innerText || '';
  const hits = (txt.match(/[\u4e00-\u9fff][^\s]*/g) || []).filter(s => s !== '中文');
  const attrs = [...document.querySelectorAll('[aria-label],[placeholder],[title]')]
    .flatMap(el => ['aria-label', 'placeholder', 'title'].map(a => el.getAttribute(a)))
    .filter(v => v && /[\u4e00-\u9fff]/.test(v));
  return { text: [...new Set(hits)], attrs: [...new Set(attrs)] };
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  /* ---------- 1. 系统中文 → 默认中文 ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'zh-CN' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL, { waitUntil: 'load' });
    await p.waitForTimeout(700);
    eq('zh-CN 系统：html lang', await p.getAttribute('html', 'lang'), 'zh-CN');
    eq('zh-CN 系统：标题', await p.title(), 'Taskflow · 任务倒计时管理');
    ok('zh-CN 系统：导航为中文',
      (await p.textContent('#nav button[data-page="tasks"]')).trim() === '任务');
    await p.click('#nav button[data-page="me"]');
    await p.waitForTimeout(400);
    ok('语言控件存在', await p.locator('#langSeg').count() === 1);

    /* ---------- 2. 切到英文 ---------- */
    await p.click('#langSeg button[data-lang="en"]');
    await p.waitForTimeout(650);
    eq('切换后 html lang', await p.getAttribute('html', 'lang'), 'en');
    eq('切换后标题', await p.title(), 'Taskflow · Countdown Task Manager');
    eq('导航 Tasks', (await p.textContent('#nav button[data-page="tasks"]')).trim(), 'Tasks');
    eq('导航 Stats', (await p.textContent('#nav button[data-page="stats"]')).trim(), 'Stats');
    eq('导航 Settings', (await p.textContent('#nav button[data-page="me"]')).trim(), 'Settings');
    eq('页标题 Me', (await p.textContent('#viewMe .view__title')).trim(), 'Me');

    const scan = await p.evaluate(CJK_SCAN);
    ok('英文模式无中文文本残留', scan.text.length === 0, scan.text.slice(0, 6).join('|'));
    ok('英文模式无中文属性残留', scan.attrs.length === 0, scan.attrs.slice(0, 4).join('|'));
    ok('语言按钮状态', await p.getAttribute('#langSeg button[data-lang="en"]', 'aria-pressed') === 'true');

    /* ---------- 3. 其余页面同样无残留 ---------- */
    const pages = [
      ['tasks', async () => { await p.click('#nav button[data-page="tasks"]'); }],
      ['stats', async () => { await p.click('#nav button[data-page="stats"]'); }],
      ['editor', async () => { await p.click('#nav button[data-page="tasks"]'); await p.waitForTimeout(250); await p.click('#btnAdd'); }],
    ];
    for (const [name, go] of pages) {
      await go();
      await p.waitForTimeout(550);
      const s2 = await p.evaluate(CJK_SCAN);
      ok(name + ' 页英文模式无残留', s2.text.length === 0 && s2.attrs.length === 0,
        s2.text.slice(0, 5).concat(s2.attrs.slice(0, 3)).join('|'));
    }
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);

    /* ---------- 4. 持久化 ---------- */
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(800);
    eq('刷新后仍为英文', await p.getAttribute('html', 'lang'), 'en');

    /* ---------- 5. 切回中文 ---------- */
    await p.click('#nav button[data-page="me"]');
    await p.waitForTimeout(350);
    await p.click('#langSeg button[data-lang="zh"]');
    await p.waitForTimeout(650);
    eq('切回中文 html lang', await p.getAttribute('html', 'lang'), 'zh-CN');
    eq('切回中文导航', (await p.textContent('#nav button[data-page="tasks"]')).trim(), '任务');

    /* ---------- 6. 英文下无横向溢出 ---------- */
    await p.click('#langSeg button[data-lang="en"]');
    await p.waitForTimeout(500);
    await p.setViewportSize({ width: 360, height: 800 });
    await p.waitForTimeout(450);
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok('英文 360px 无横向溢出', ov <= 0, 'overflow=' + ov + 'px');
    ok('页内无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ---------- 7. 系统英文 → 默认英文 ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'en-US' });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'load' });
    await p.waitForTimeout(700);
    eq('en-US 系统：默认英文', await p.getAttribute('html', 'lang'), 'en');
    eq('en-US 系统：导航 Tasks', (await p.textContent('#nav button[data-page="tasks"]')).trim(), 'Tasks');
    await ctx.close();
  }

  await browser.close();
  console.log(log.join('\n'));
  console.log('\n' + '='.repeat(60));
  console.log('语言验收结果：' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total');
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
