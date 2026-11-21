/* 真实连通验收（不发任何模拟请求、不打桩）：
     1) 你自己终端里：DEEPSEEK_API_KEY=... node dev/function-local.ts   # 密钥只在进程环境，不写入任何文件
     2) node tools/serve.js                                              # 8899，代理 /functions/v1/app → 8000
     3) node dev/live-study-run.mjs                                       # 本脚本
   验证链路：上传真实笔记 → 确认卡片 → 后端 /ai/study → 真实 DeepSeek 出题 → 结构化校验 → 真实 PDF → 预览/下载。
   只打印状态码、题量与题目摘要，绝不打印密钥。 */
import pw from 'playwright';
const { chromium } = pw;

const URL = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';
const BASE = 'http://127.0.0.1:8000';
const NOTE = `# 重要极限与等价无穷小

## 一、两个重要极限
1. $\lim_{x\to 0}\dfrac{\sin x}{x}=1$，其中 $x$ 用弧度，且 $x\neq 0$。几何证明：当 $0<x<\frac{\pi}{2}$ 时 $\sin x<x<\tan x$，同除以 $\sin x$ 得 $\cos x<\frac{\sin x}{x}<1$，由夹逼定理取极限即得。
推广形式为 $\lim_{\square\to 0}\frac{\sin \square}{\square}=1$，方框代表同一个趋于零的整体。例如 $\lim_{x\to 0}\frac{\sin 3x}{x}=3$，$\lim_{x\to\infty}x\sin\frac{1}{x}=1$。
2. $\lim_{x\to\infty}\left(1+\frac{1}{x}\right)^{x}=e$，等价形式 $\lim_{t\to 0}(1+t)^{1/t}=e$，其中 $e\approx 2.71828$。
用它求 $1^{\infty}$ 型极限：$\lim_{x\to 0}(1+2x)^{1/x}=e^{2}$；通用做法是把 $u^{v}$ 改写成 $e^{v\ln u}$。

## 二、等价无穷小替换（$x\to 0$）
$\sin x\sim x$，$\tan x\sim x$，$\arcsin x\sim x$，$1-\cos x\sim\frac{x^{2}}{2}$，$\ln(1+x)\sim x$，$e^{x}-1\sim x$，$(1+x)^{\alpha}-1\sim\alpha x$，$a^{x}-1\sim x\ln a$。
替换原则：乘除因子可整体替换，加减项一般不可直接替换。例如 $\lim_{x\to 0}\frac{\tan x-\sin x}{x^{3}}=\lim_{x\to 0}\frac{\sin x(1-\cos x)}{x^{3}\cos x}=\frac{1}{2}$；若把 $\tan x$ 与 $\sin x$ 各自换成 $x$ 会错误地得到 $0$。

## 三、例题
例 1 $\lim_{x\to 0}\dfrac{\sqrt{1+\tan x}-\sqrt{1+\sin x}}{x^{3}}=\dfrac{1}{2}$，方法是有理化后化为 $\frac{\tan x-\sin x}{x^{3}(\sqrt{1+\tan x}+\sqrt{1+\sin x})}$。
例 2 $\lim_{x\to 0}\left(\dfrac{1}{x}-\dfrac{1}{e^{x}-1}\right)=\dfrac{1}{2}$，通分后用泰勒展开 $e^{x}-1=x+\frac{x^{2}}{2}+o(x^{2})$。
例 3 $\lim_{n\to\infty}\left(1+\dfrac{2}{n}\right)^{3n}=e^{6}$。

## 四、易错点
- $\lim_{x\to\infty}\frac{\sin x}{x}=0$（有界量乘无穷小）与 $\lim_{x\to 0}\frac{x}{\sin x}=1$ 不可混淆。
- $1^{\infty}$ 型必须先取对数或凑 $e$，不能直接代入。
- 夹逼定理要求上下函数与下函数的极限相等。
`;

const out = [];
let pass = 0, fail = 0;
function check(name, cond, extra) {
  const ok = !!cond;
  if (ok) pass++; else fail++;
  const line = (ok ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : '  → ' + extra);
  out.push(line); console.log(line);
}

/* 0) 后端确实读到了密钥（只看 configured 布尔值，不看密钥） */
const health = await fetch(BASE + '/health').then(r => r.json()).catch(() => null);
check('本地函数后端 /health 可达', health && health.ok === true, JSON.stringify(health));
check('后端 configured=true（密钥存在于服务端环境）', health && health.configured === true, 'configured=' + (health && health.configured));
if (!health || health.configured !== true) {
  console.log('未连通：函数服务进程里没有 DEEPSEEK_API_KEY，请在自己的 shell 里设置后重启 dev/function-local.ts。');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1050, height: 860 }, locale: 'zh-CN', acceptDownloads: true });
const p = await ctx.newPage();

/* 全链路真实：不 route 任何桩。只统计页面是否绕过后端直连 DeepSeek。 */
let directHits = 0, backendHits = [], backendStatus = [];
p.on('request', r => { if (/api\.deepseek\.com/.test(r.url())) directHits++; });
p.on('response', async r => {
  if (/\/functions\/v1\/app\/ai\/study/.test(r.url())) {
    backendHits.push(r.request().method());
    backendStatus.push(r.status());
  }
});
p.on('pageerror', e => { out.push('PAGEERROR ' + e.message); console.log('PAGEERROR ' + e.message); fail++; });

const t0 = Date.now();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
await p.waitForTimeout(800);
await p.check('#chatConsent');

/* 阶段气泡记录（真实调用需要一段时间，边跑边采） */
await p.evaluate(() => {
  window.__stages = [];
  const rec = () => {
    const n = document.querySelector('.thinking-stage');
    if (n) { const t = String(n.textContent).trim(); const a = window.__stages; if (t && a[a.length - 1] !== t) a.push(t); }
  };
  window.__stageTimer = setInterval(rec, 60);
});

/* 1) 上传真实笔记 */
await p.setInputFiles('#studyFiles', [{ name: '重要极限与等价无穷小.md', mimeType: 'text/markdown', buffer: Buffer.from(NOTE, 'utf8') }]);
await p.waitForFunction(() => { const d = (window.__study.list() || [])[0]; return d && d.parseStatus === 'ready' && d.content; }, null, { timeout: 40000 })
  .catch(() => {});
const doc = await p.evaluate(() => window.__study.list()[0]);
check('资料解析就绪', doc && doc.parseStatus === 'ready', doc && (doc.parseStatus + ' / ' + String(doc.content || '').length + ' 字'));

/* 2) 确认卡片（真实流程：不发 skipConfirm）；不注入任何前端密钥，证明走后端 */
await p.evaluate(() => window.__aiTest.setKey(''));
await p.fill('#chatInput', '根据这份笔记出一套 5 题的试卷，并导出 PDF');
await p.click('#btnChatSend');
await p.waitForSelector('.confirm-card[data-status="pending"]', { timeout: 8000 });
const card = await p.evaluate(() => document.querySelector('.confirm-card').textContent);
check('出现发送前确认卡片', /重要极限与等价无穷小\.md/.test(card), card.replace(/\s+/g, ' ').slice(0, 120));
check('卡片题量与句子里写的题量一致（5 道）', /题量\s*5\s*道/.test(card.replace(/\s+/g, ' ')), (card.match(/题量\s*\d+\s*道/) || [''])[0]);
check('确认之前零上游请求', directHits === 0 && backendHits.length === 0, 'backend=' + backendHits.length + ' direct=' + directHits);
const tSend = Date.now();
await p.click('.cc-ok');

/* 3) 真实出题 + 试卷卡 */
await p.waitForSelector('.study-set', { timeout: 120000 });
const set = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('taskflow.study.sets.v1') || '[]');
  const cur = Array.isArray(s) ? s[s.length - 1] : (s.sets ? s.sets[s.sets.length - 1] : null);
  return cur;
});
check('真实题目产出', set && Array.isArray(set.questions) && set.questions.length >= 3, set && (set.title + ' / ' + (set.questions || []).length + ' 题'));
const bad = await p.evaluate(() => {
  const card = document.querySelector('.study-set');
  return { qs: card.querySelectorAll('.study-q').length, katex: card.querySelectorAll('.katex').length,
    dollar: (card.innerText.match(/\$/g) || []).length, empty: Array.from(card.querySelectorAll('.study-q')).filter(li => !String(li.querySelector('.study-q__text').textContent).trim()).length };
});
check('题量与卡片一致', bad.qs === (set.questions || []).length, bad.qs + ' 条');
check('公式由 KaTeX 渲染（' + bad.katex + ' 个节点）且无裸 $', bad.katex > 0 && bad.dollar === 0, 'katex=' + bad.katex + ' 裸$=' + bad.dollar + ' 空题=' + bad.empty);
console.log('  真实试卷：' + set.title + ' · ' + (set.questions || []).length + ' 题 · 预计 ' + (set.estimate && set.estimate.grand) + ' 分钟 · 用时 ' + ((Date.now() - tSend) / 1000).toFixed(1) + 's');
(set.questions || []).forEach((q, i) => {
  console.log('    ' + (i + 1) + '. [' + q.type + '/' + q.difficulty + '] ' + String(q.question).replace(/\s+/g, ' ').slice(0, 80));
  if (q.options && q.options.length) console.log('        选项 ' + q.options.map(o => String(o).replace(/\s+/g, ' ').slice(0, 18)).join(' | '));
  console.log('        答案 ' + String(q.answer || '').replace(/\s+/g, ' ').slice(0, 40) + ' · 解析 ' + String(q.explanation || '').replace(/\s+/g, ' ').slice(0, 40));
});

/* 4) 真实 PDF 文件卡片 + 预览 + 下载 */
await p.waitForSelector('.file-card--pdf[data-status="ready"]', { timeout: 120000 });
const sub = await p.evaluate(() => document.querySelector('.file-card--pdf .file-card__sub').textContent);
check('对话内出现 PDF 文件卡片：' + sub, /页/.test(sub) && /KB|B/.test(sub), sub);
const dl = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('.file-card--pdf .pdf-download')]).then(a => a[0]);
const fpath = await dl.path();
const fs = await import('node:fs');
const buf = fs.readFileSync(fpath);
const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
check('下载文件是真实 PDF（%' + 'PDF- 开头）', buf.slice(0, 5).toString() === '%PDF-', buf.slice(0, 5).toString() + ' / ' + (buf.length / 1024).toFixed(1) + ' KB');
check('页数与卡片标注一致', /1 页/.test(sub) ? pages === 1 : pages >= 1, pages + ' 页');
fs.copyFileSync(fpath, 'dev/live-paper.pdf');
out.push('  已保存样本：dev/live-paper.pdf');

/* 5) 阶段气泡 + 通道与密钥位置 */
const stages = await p.evaluate(() => { clearInterval(window.__stageTimer); return window.__stages; });
console.log('  阶段气泡序列：' + stages.join(' → '));
check('四阶段按序推进到 4/4', stages.some(s => /1\/4/.test(s)) && stages.some(s => /2\/4/.test(s)) && stages.some(s => /3\/4/.test(s)) && stages.some(s => /4\/4/.test(s)), stages.length + ' 次更新');
check('出题结束后思考气泡消失', await p.evaluate(() => !document.querySelector('.thinking-stage')));
check('页面直连 DeepSeek 请求数 = 0（密钥只在服务端）', directHits === 0, 'direct=' + directHits);
check('出题走后端 /ai/study 且返回 200', backendHits.length >= 1 && backendStatus.every(s => s === 200), 'calls=' + backendHits.length + ' status=' + backendStatus.join(','));

/* 6) 试卷库落库 */
const lib = await p.evaluate(() => JSON.parse(localStorage.getItem('taskflow.study.sets.v1') || '[]'));
check('试卷已存入试卷库', Array.isArray(lib) ? lib.length >= 1 : true, Array.isArray(lib) ? lib.length + ' 份' : 'n/a');

console.log('\n总耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('真实连通验收：PASS ' + pass + ' / FAIL ' + fail);
await p.screenshot({ path: 'dev/shots/live-study-real.png', fullPage: false });
await browser.close();
process.exit(fail ? 1 : 0);
