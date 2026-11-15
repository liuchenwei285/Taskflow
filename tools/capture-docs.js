/* =============================================================
 * Taskflow 文档素材采集
 *
 * 产出（写入仓库 docs/）：
 *   app-light.png / app-dark.png   主界面（移动端尺寸，浅 / 深）
 *   theme-switch-sequence.png      主题切换动画逐帧分解（浅 → 深）
 *   theme-switch.webm              主题切换录屏
 *
 * 用法：node tools/capture-docs.js
 * 依赖：npm i -D playwright && npx playwright install chromium
 * ============================================================= */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const FRAMES = path.join(DOCS, 'frames');
const TMPV = path.join(DOCS, '.video-tmp');
const APP = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';

const VP = { width: 412, height: 915 };

/* 演示数据：与真实存储结构一致（schemaVersion 2） */
const SEED = () => {
  const now = Date.now(), MIN = 60000;
  const dayKey = ts => {
    const d = new Date(ts), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  const mk = (o) => Object.assign({
    id: 'demo-' + Math.random().toString(36).slice(2, 8),
    title: '', desc: '', mode: 'duration', status: 'idle', priority: 'medium',
    durationMs: 25 * MIN, remainingMs: 25 * MIN,
    startedAt: null, segStart: null, createdAt: now, dueAt: null
  }, o);
  const tasks = [
    mk({ title: '写完项目周报', desc: '梳理本周进展与下周计划', status: 'running',
         priority: 'high', startedAt: now - 7 * MIN, segStart: now - 7 * MIN }),
    mk({ title: '复习英语单词', desc: '背诵 Unit 12 词表', status: 'paused',
         priority: 'medium', remainingMs: 15 * MIN, durationMs: 15 * MIN }),
    mk({ title: '提交周报邮件', desc: '发给项目组', mode: 'deadline',
         priority: 'high', dueAt: now + 5 * 3600e3, remainingMs: 5 * 3600e3 }),
    mk({ title: '整理相册照片', desc: '', priority: 'low', status: 'done', durationMs: 10 * MIN })
  ];
  const sessions = [
    { id: 's1', taskId: tasks[0].id, taskTitle: tasks[0].title, kind: 'focus',
      startAt: now - 52 * MIN, endAt: now - 27 * MIN, ms: 25 * MIN, dateKey: dayKey(now - 52 * MIN) },
    { id: 's2', taskId: tasks[1].id, taskTitle: tasks[1].title, kind: 'focus',
      startAt: now - 22 * MIN, endAt: now - 8 * MIN, ms: 14 * MIN, dateKey: dayKey(now - 22 * MIN) },
    { id: 's3', taskId: tasks[0].id, taskTitle: tasks[0].title, kind: 'focus',
      startAt: now - 95 * MIN, endAt: now - 65 * MIN, ms: 30 * MIN, dateKey: dayKey(now - 95 * MIN) }
  ];
  try {
    localStorage.setItem('taskflow.tasks.v1', JSON.stringify({
      v: 2, schemaVersion: 2, tasks, sessions, savedAt: now
    }));
    localStorage.setItem('taskflow.prefs.v1', JSON.stringify({
      sort: 'deadline', group: 'none', view: 'all', running: 'all', theme: 'light'
    }));
  } catch (e) {}
};

async function launch() {
  try { return await chromium.launch(); }
  catch (e) { return await chromium.launch({ channel: 'chrome' }); }
}

async function openApp(browser, theme) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });
  await ctx.addInitScript(SEED);
  const p = await ctx.newPage();
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForTimeout(700);
  await p.evaluate(t => {
    document.documentElement.dataset.theme = t;
    const btn = document.getElementById('btnTheme');
    if (btn) btn.setAttribute('aria-pressed', String(t === 'dark'));
  }, theme);
  await p.waitForTimeout(400);
  return { ctx, p };
}

(async () => {
  fs.mkdirSync(FRAMES, { recursive: true });
  fs.mkdirSync(TMPV, { recursive: true });
  const browser = await launch();

  /* ---------- 1. 浅 / 深主界面 + 统计页 ---------- */
  for (const theme of ['light', 'dark']) {
    const { ctx, p } = await openApp(browser, theme);
    await p.screenshot({ path: path.join(DOCS, `app-${theme}.png`) });
    if (theme === 'light') {
      await p.click('#nav button[data-page="stats"]');
      await p.waitForTimeout(600);
      await p.screenshot({ path: path.join(DOCS, 'stats.png') });
      console.log('  stats.png');
    }
    await ctx.close();
    console.log('  app-' + theme + '.png');
  }

  /* ---------- 2. 主题切换逐帧 ---------- */
  {
    const { ctx, p } = await openApp(browser, 'light');
    await p.click('#btnTheme');
    await p.waitForTimeout(60);
    const n = await p.evaluate(() => {
      const as = document.getAnimations().filter(a =>
        a.effect && a.effect.pseudoElement && /view-transition/.test(a.effect.pseudoElement));
      as.forEach(a => a.pause());
      return as.length;
    });
    console.log('  view-transition 动画数:', n);
    const STEPS = [0, 125, 250, 375, 500];
    for (const t of STEPS) {
      await p.evaluate(ms => {
        document.getAnimations()
          .filter(a => a.effect && a.effect.pseudoElement && /view-transition/.test(a.effect.pseudoElement))
          .forEach(a => { a.currentTime = ms; });
      }, t);
      await p.waitForTimeout(90);
      await p.screenshot({ path: path.join(FRAMES, `frame-${String(t).padStart(3, '0')}.png`) });
    }
    console.log('  帧序列:', STEPS.map(t => String(t).padStart(3, '0') + 'ms').join(' / '));
    await ctx.close();
  }

  /* ---------- 3. 录屏 ---------- */
  {
    const ctx = await browser.newContext({
      viewport: VP, deviceScaleFactor: 2,
      recordVideo: { dir: TMPV, size: { width: VP.width, height: VP.height } }
    });
    await ctx.addInitScript(SEED);
    const p = await ctx.newPage();
    await p.goto(APP, { waitUntil: 'load' });
    await p.waitForTimeout(900);
    await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await p.waitForTimeout(700);
    await p.click('#btnTheme');
    await p.waitForTimeout(1600);
    await ctx.close();
    const vids = fs.readdirSync(TMPV).filter(f => f.endsWith('.webm'));
    if (vids.length) {
      fs.copyFileSync(path.join(TMPV, vids[0]), path.join(DOCS, 'theme-switch.webm'));
      console.log('  theme-switch.webm', fs.statSync(path.join(DOCS, 'theme-switch.webm')).size, 'B');
    }
    fs.rmSync(TMPV, { recursive: true, force: true });
  }

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
