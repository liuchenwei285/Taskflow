/* 采集中英文对照截图：docs/app-en.png + docs/lang-switch.png */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const APP = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';
const VP = { width: 412, height: 915 };

const SEED = ({ lang }) => {
  const now = Date.now(), M = 60000, d = new Date(now), p = n => String(n).padStart(2, '0');
  const key = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  const mk = (o) => Object.assign({ id: 'x' + Math.random().toString(36).slice(2, 7), title: '', desc: '',
    mode: 'duration', status: 'idle', priority: 'medium', durationMs: 25 * M, remainingMs: 25 * M,
    startedAt: null, segStart: null, createdAt: now, dueAt: null }, o);
  const tasks = lang => lang === 'en'
    ? [mk({ title: 'Finish weekly report', desc: 'Summarise progress and next steps', status: 'running', priority: 'high', startedAt: now - 7 * M, segStart: now - 7 * M }),
       mk({ title: 'Review vocabulary', desc: 'Unit 12 word list', status: 'paused', remainingMs: 15 * M, durationMs: 15 * M }),
       mk({ title: 'Send the report', desc: 'To the project group', mode: 'deadline', priority: 'high', dueAt: now + 5 * 3600e3, remainingMs: 5 * 3600e3 }),
       mk({ title: 'Tidy up photos', priority: 'low', status: 'done', durationMs: 10 * M })]
    : [mk({ title: '写完项目周报', desc: '梳理本周进展与下周计划', status: 'running', priority: 'high', startedAt: now - 7 * M, segStart: now - 7 * M }),
       mk({ title: '复习英语单词', desc: '背诵 Unit 12 词表', status: 'paused', remainingMs: 15 * M, durationMs: 15 * M }),
       mk({ title: '提交周报邮件', desc: '发给项目组', mode: 'deadline', priority: 'high', dueAt: now + 5 * 3600e3, remainingMs: 5 * 3600e3 }),
       mk({ title: '整理相册照片', priority: 'low', status: 'done', durationMs: 10 * M })];
  try {
    const list = tasks(lang);
    localStorage.setItem('taskflow.tasks.v1', JSON.stringify({ v: 2, schemaVersion: 2, tasks: list, savedAt: now,
      sessions: [{ id: 's1', taskId: list[0].id, taskTitle: list[0].title, kind: 'focus',
        startAt: now - 52 * M, endAt: now - 27 * M, ms: 25 * M, dateKey: key }] }));
    localStorage.setItem('taskflow.prefs.v1', JSON.stringify({ sort: 'deadline', group: 'none', view: 'all', running: 'all', theme: 'light', lang: lang }));
  } catch (e) {}
};

async function launch() {
  try { return await chromium.launch(); } catch (e) { return await chromium.launch({ channel: 'chrome' }); }
}

(async () => {
  const browser = await launch();
  const shots = {};
  for (const lang of ['zh', 'en']) {
    const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2, locale: lang === 'zh' ? 'zh-CN' : 'en-US' });
    await ctx.addInitScript(SEED, { lang });
    const p = await ctx.newPage();
    await p.goto(APP, { waitUntil: 'load' });
    await p.waitForTimeout(800);
    await p.waitForTimeout(900);
    await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await p.waitForTimeout(350);
    await p.screenshot({ path: path.join(DOCS, `app-${lang}.png`) });
    shots[lang] = `docs/app-${lang}.png`;
    if (lang === 'en') {
      await p.click('#nav button[data-page="me"]');
      await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(DOCS, 'app-en-me.png') });
    }
    await ctx.close();
    console.log('  ' + shots[lang]);
  }

  /* 中英对照拼图 */
  const img = f => 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, f)).toString('base64');
  const ctx = await browser.newContext({ viewport: { width: 980, height: 780 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;padding:28px 30px;background:#0B0E13;color:#E6EAF0;
      font:14px/1.65 -apple-system,"Segoe UI",sans-serif;width:980px}
    h1{font-size:21px;margin:0 0 4px} .sub{color:#8B94A3;font-size:13px;margin:0 0 22px}
    .row{display:flex;gap:18px;justify-content:center}
    figure{margin:0;width:300px} .shot{border-radius:14px;overflow:hidden;border:1px solid #232A36;
      box-shadow:0 12px 34px rgba(0,0,0,.45)} .shot img{display:block;width:100%}
    figcaption{text-align:center;margin-top:10px;font-size:12px;color:#9AA4B2}
    code{background:#1A2029;padding:2px 6px;border-radius:4px;color:#FF6FAE}
  </style></head><body>
    <h1>Interface language · 界面语言</h1>
    <p class="sub">Switch in <b>Me → Language</b> · 在「我的 → 语言」切换，立即生效并记住选择；默认跟随系统语言。</p>
    <div class="row">
      <figure><div class="shot"><img src="${img('docs/app-zh.png')}"></div><figcaption>中文（默认跟随系统）</figcaption></figure>
      <figure><div class="shot"><img src="${img('docs/app-en.png')}"></div><figcaption>English</figcaption></figure>
    </div>
  </body></html>`);
  await p.evaluate(async () => { await Promise.all([...document.images].map(i => i.decode())); });
  await p.screenshot({ path: path.join(DOCS, 'lang-switch.png'), fullPage: true });
  await browser.close();
  console.log('  docs/lang-switch.png', fs.statSync(path.join(DOCS, 'lang-switch.png')).size, 'B');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
