const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox','--force-device-scale-factor=1'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8899/task-timer-app.html');
  await p.waitForTimeout(800);
  if (await p.evaluate(() => document.querySelector('#welcomeScrim')?.classList.contains('open'))) {
    await p.evaluate(() => document.querySelector('#wcSkip')?.click());
    await p.waitForTimeout(400);
  }
  const read = () => p.evaluate(() => {
    const el = document.querySelector('#btnNewChat');
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, fg: cs.color, border: cs.borderColor };
  });
  const setColor = (hex) => p.evaluate((h) => {
    const picker = document.querySelector('#accentPicker');
    picker.value = h;
    picker.dispatchEvent(new Event('input', { bubbles: true }));
  }, hex);
  const before = await read();
  await setColor('#2563EB');
  await p.waitForTimeout(300);
  const blueLight = await read();
  // 切深色后再触发一次（applyAccent 读 isDark）
  await p.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const picker = document.querySelector('#accentPicker');
    picker.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(300);
  const blueDark = await read();
  // 恢复默认
  await p.evaluate(() => document.querySelector('#accentReset')?.click());
  await p.waitForTimeout(300);
  const restored = await read();
  console.log(JSON.stringify({ before, blueLight, blueDark, restored, errs }, null, 1));
  await b.close();
})();
