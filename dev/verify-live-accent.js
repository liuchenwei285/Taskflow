const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('https://taskflow-app-3qo4c3iuyvd.qoder.zone/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  if (await p.evaluate(() => document.querySelector('#welcomeScrim')?.classList.contains('open'))) {
    await p.evaluate(() => document.querySelector('#wcSkip')?.click());
  }
  const read = () => p.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#btnNewChat'));
    return { bg: cs.backgroundColor, fg: cs.color };
  });
  const before = await read();
  await p.evaluate(() => {
    const pk = document.querySelector('#accentPicker'); pk.value = '#2563EB';
    pk.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(300);
  const blue = await read();
  console.log(JSON.stringify({ url: p.url(), before, blue, changed: before.bg !== blue.bg, errs }, null, 1));
  await b.close();
})();
