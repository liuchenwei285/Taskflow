/* 论坛帖子素材采集：全部截自线上已发布站点；任务/试卷为演示数据（帖子中会注明），
   资料上传与解析走真实本地解析链路，不经过任何 mock。
   ONLY=01,07 可只重采指定编号；界面截图统一横屏视口。 */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'https://taskflow-app-3qo4c3iuyvd.qoder.zone/';
const OUT = path.resolve(__dirname, '../submission/img');
const NOTE = path.resolve(__dirname, '../submission/demo-note.md');
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = k => !ONLY.length || ONLY.includes(k);

const SEED = (withOverdue) => {
  const now = Date.now(), MIN = 60000;
  const dayKey = ts => { const d = new Date(ts), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const mk = o => Object.assign({ id: 'demo-' + Math.random().toString(36).slice(2, 8),
    title: '', desc: '', mode: 'duration', status: 'idle', priority: 'medium',
    durationMs: 25 * MIN, remainingMs: 25 * MIN, startedAt: null, segStart: null,
    createdAt: now, dueAt: null, alertAhead: 300, notify: true, firedAt: null, warned: false,
    updatedAt: now, completedAt: null }, o);
  const running = mk({ title: '高数作业 · 第三章习题', desc: '中值定理证明题 6 道 + 洛必达极限 4 道', status: 'running',
    priority: 'high', durationMs: 120 * MIN, remainingMs: 108 * MIN, startedAt: now - 12 * MIN, segStart: now - 12 * MIN, dueAt: now + 6 * 3600e3 });
  const paused = mk({ title: '线代第 3 章复习', desc: '特征值与特征向量，配合错题本', status: 'paused',
    priority: 'medium', durationMs: 60 * MIN, remainingMs: 40 * MIN });
  const words = mk({ title: '英语 Unit 12 词表', desc: '背诵 + 自测', priority: 'medium', durationMs: 25 * MIN, remainingMs: 25 * MIN, dueAt: now + 9 * 3600e3 });
  const overdue = mk({ title: '提交物理实验报告', desc: '误差分析部分还没写', mode: 'deadline', priority: 'high',
    dueAt: now - 3 * 3600e3, remainingMs: 0 });
  const done = mk({ title: '整理本周错题', desc: '拍照归档到错题本', priority: 'low', status: 'done',
    durationMs: 30 * MIN, remainingMs: 0, completedAt: now - 2 * 3600e3 });
  const tasks = withOverdue ? [running, paused, words, overdue, done] : [running, paused, words, done];
  const sessions = [
    { id: 's1', taskId: running.id, taskTitle: running.title, kind: 'focus', startAt: now - 52 * MIN, endAt: now - 27 * MIN, ms: 25 * MIN, dateKey: dayKey(now - 52 * MIN) },
    { id: 's2', taskId: paused.id, taskTitle: paused.title, kind: 'focus', startAt: now - 22 * MIN, endAt: now - 8 * MIN, ms: 14 * MIN, dateKey: dayKey(now - 22 * MIN) },
    { id: 's3', taskId: running.id, taskTitle: running.title, kind: 'focus', startAt: now - 26 * 3600e3, endAt: now - 25.5 * 3600e3, ms: 30 * MIN, dateKey: dayKey(now - 26 * 3600e3) },
    { id: 's4', taskId: done.id, taskTitle: done.title, kind: 'focus', startAt: now - 50 * 3600e3, endAt: now - 49.5 * 3600e3, ms: 30 * MIN, dateKey: dayKey(now - 50 * 3600e3) }
  ];
  localStorage.setItem('taskflow.tasks.v1', JSON.stringify({ v: 2, schemaVersion: 2, tasks, sessions, savedAt: now }));
  localStorage.setItem('taskflow.welcome.v1', '1');
};

const DEMO_SET = () => ({
  v: 1, sets: [{
    id: 'set_demo_calculus3', createdAt: Date.now() - 3600e3,
    title: '高数第三章 · 中值定理与洛必达 单元卷',
    sourceDocs: [{ documentId: 'doc_demo', fileName: '高数第三章笔记.md' }],
    warnings: [], shortfall: 0,
    estimate: { per: [], byType: { single: 2, fill: 2, judge: 1, calc: 10, proof: 12 }, total: 27, review: 5, break: 5, grand: 37 },
    questions: [
      { qid: 'q1', type: 'single', difficulty: 'easy', minutes: 2, knowledgePoints: ['罗尔定理'],
        question: '设 f(x) 在 [0,1] 连续、(0,1) 可导且 f(0)=f(1)=0，则下列结论正确的是',
        options: ['存在 ξ∈(0,1) 使 f\'(ξ)=0', '对任意 ξ∈(0,1) 有 f\'(ξ)=0', 'f(x) 恒等于 0', 'f\'(x) 在 (0,1) 内恒正'],
        answer: 'A', explanation: '罗尔定理只保证"存在"一个导数为零的点，不能加强为任意点。' },
      { qid: 'q2', type: 'fill', difficulty: 'medium', minutes: 2, knowledgePoints: ['洛必达法则', '泰勒展开'],
        question: '极限 $\\lim_{x\\to 0}\\dfrac{x-\\sin x}{x^3}$ = ______。',
        options: [], answer: '1/6', explanation: '三次洛必达或把 sin x 展开到 x^3 项：x - (x - x^3/6 + o(x^3)) = x^3/6 + o(x^3)。' },
      { qid: 'q3', type: 'judge', difficulty: 'easy', minutes: 1, knowledgePoints: ['驻点与极值点'],
        question: '判断：若 f\'(x0)=0，则 x0 一定是 f 的极值点。',
        options: [], answer: '错误', explanation: 'y=x^3 在 x=0 处导数为零但不是极值点；需看导数是否变号。' },
      { qid: 'q4', type: 'calc', difficulty: 'medium', minutes: 10, knowledgePoints: ['拉格朗日中值定理'],
        question: '设 f(x)=x^2 在 [1,3] 上满足拉格朗日中值定理，求出定理中的 ξ，并验证 $f(3)-f(1)=f\'(\\xi)(3-1)$。',
        options: [], answer: 'ξ=2', explanation: 'f(3)-f(1)=8，f\'(ξ)=2ξ，故 2ξ·2=8 → ξ=2∈(1,3)。' },
      { qid: 'q5', type: 'proof', difficulty: 'hard', minutes: 12, knowledgePoints: ['罗尔定理', '辅助函数'],
        question: '设 f 在 [0,1] 连续、(0,1) 可导，f(1)=0。证明：存在 ξ∈(0,1) 使 $f\'(\\xi)=-\\dfrac{f(\\xi)}{\\xi}$。',
        options: [], answer: '见解析', explanation: '构造 F(x)=x·f(x)，则 F(0)=F(1)=0，由罗尔定理存在 ξ 使 F\'(ξ)=f(ξ)+ξf\'(ξ)=0，整理即得。' }
    ]
  }]
});

async function open(b, opt) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' }, opt.ctx || {}));
  if (opt.seed !== false) await ctx.addInitScript(SEED, !!opt.overdue);
  if (opt.set) await ctx.addInitScript(s => localStorage.setItem('taskflow.study.sets.v1', JSON.stringify(s)), DEMO_SET());
  if (opt.chat) await ctx.addInitScript(() => {
    const t = Date.now();
    localStorage.setItem('{{SECRET_5y7h2k9p}}', JSON.stringify({
      v: 1, activeId: 'c_demo', conversations: [{
        id: 'c_demo', title: '高数第三章单元卷', createdAt: t - 600000, updatedAt: t - 300000,
        request: '用这份笔记出一套第三章单元卷', drafts: [], activeDraftId: '',
        messages: [
          { id: 'm1', role: 'user', text: '用刚上传的第三章笔记出一套单元卷：5 道题，覆盖中值定理、洛必达和泰勒，证明题要难一点。', at: t - 600000 },
          { id: 'm2', role: 'ai', text: '已生成 5 道题，预计 37 分钟（含 5 分钟回顾与 5 分钟休息）。资料只覆盖到 3.5 节，曲率部分没有出题。', at: t - 300000, setId: 'set_demo_calculus3' }
        ]
      }]
    }));
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(1000);
  return { ctx, p, errs };
}
const nav = (p, n) => p.evaluate(k => { const b = document.querySelector('#sidebar [data-page="' + k + '"]'); if (b) b.click(); }, n);
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name) });

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });

  /* 01 首访欢迎弹窗（横屏 1280x800，弹窗完整可见） */
  if (want('01')) {
    const { ctx, p } = await open(b, { seed: false, ctx: { viewport: { width: 1280, height: 800 } } });
    await p.waitForTimeout(600);
    await shot(p, 'post-01-welcome.png');
    await ctx.close();
  }

  /* 02 学习工作台首屏 + 03 真实上传解析 */
  if (want('02')) {
    const { ctx, p, errs } = await open(b, {});
    await shot(p, 'post-02-studio.png');
    await p.setInputFiles('#studyFiles', NOTE);
    await p.waitForTimeout(3000);
    await p.locator('button:has-text("预览")').last().click();
    await p.waitForTimeout(900);
    await shot(p, 'post-03-parse.png');
    console.log('studio errs:', errs.length ? errs.join('|') : 'none');
    await ctx.close();
  }

  /* 04 对话里的试卷卡片：走真实渲染链路（会话存储引用试卷 id，KaTeX 自动加载） */
  if (want('04')) {
    const { ctx, p, errs } = await open(b, { set: true, chat: true });
    await p.waitForTimeout(1500);
    await shot(p, 'post-04-conversation.png');
    await p.locator('.study-set').last().screenshot({ path: path.join(OUT, 'post-04-paper.png') });
    console.log('paper errs:', errs.length ? errs.join('|') : 'none');
    await ctx.close();
  }

  /* 05 任务页（浅） */
  if (want('05')) {
    const { ctx, p } = await open(b, { overdue: true });
    await nav(p, 'tasks'); await p.waitForTimeout(10000);
    await shot(p, 'post-05-tasks.png');
    await ctx.close();
  }

  /* 06 统计页（深） */
  if (want('06')) {
    const { ctx, p } = await open(b, { overdue: true, ctx: { colorScheme: 'dark' } });
    await nav(p, 'stats'); await p.waitForTimeout(10000);
    await shot(p, 'post-06-stats-dark.png');
    await ctx.close();
  }

  /* 07 移动布局横屏任务页（深）：899x600 保持 <900 的移动布局（顶栏标语 + 底部 dock） */
  if (want('07')) {
    const { ctx, p } = await open(b, { overdue: true, ctx: { viewport: { width: 899, height: 600 }, colorScheme: 'dark' } });
    await nav(p, 'tasks'); await p.waitForTimeout(10000);
    await shot(p, 'post-07-mobile-dark.png');
    await ctx.close();
  }

  /* 08 试卷库（演示卷） */
  if (want('08')) {
    const { ctx, p } = await open(b, { set: true });
    await nav(p, 'library'); await p.waitForTimeout(600);
    await shot(p, 'post-08-library.png');
    await ctx.close();
  }

  /* 09 设置页 */
  if (want('09')) {
    const { ctx, p } = await open(b, {});
    await nav(p, 'me'); await p.waitForTimeout(600);
    await shot(p, 'post-09-settings.png');
    await ctx.close();
  }

  await b.close();
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });