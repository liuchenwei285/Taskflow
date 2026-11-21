/* 复现「AI 服务暂时不可用，请稍后重试」：对同一份资料、同一句话，
   分别注入 超时 / 网络中断 / 5xx / 4xx / 非法 JSON，记录气泡原文与请求耗时。
   只用假 Key 与桩，绝不接触真实凭据。 */
const { chromium } = require('playwright');
const TARGET = process.env.TF_URL || 'https://taskflow-app-3qo4c3iuyvd.qoder.zone/';

const CASES = [
  { name: 'A 上游 25 秒慢响应（旧构建会被 20s 硬超时误杀）', mode: 'delay' },
  { name: 'B 连接被中断（网络层失败）', mode: 'abort' },
  { name: 'C 上游 503', mode: '503' },
  { name: 'D 上游 400 模型名不存在', mode: '400' },
  { name: 'E 上游 401 密钥无效', mode: '401' },
  { name: 'F 上游 200 但内容不是合法 JSON', mode: 'badjson' },
  { name: 'G 上游 200 但输出被截断', mode: 'trunc' },
  { name: 'H 上游 200 但资料出不出题', mode: 'emptyq' },
  { name: 'I 完全没有配置（无 Key 无后端）', mode: 'nokey' },
];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, locale: 'zh-CN' });
    let t0 = 0, hits = 0;
    await ctx.route('**/chat/completions', async (r) => {
      hits++; if (!t0) t0 = Date.now();
      if (c.mode === 'delay') { await new Promise(res => setTimeout(res, 25000)); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"title":"t","questions":[]}' } }] }) }); }
      if (c.mode === 'abort') return r.abort('failed');
      if (c.mode === 'badjson') return r.fulfill({ status: 200, contentType: 'application/json', body: 'not json at all' });
      if (c.mode === 'trunc') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"title":"半截卷","questions":[{' }, finish_reason: 'length' }] }) });
      if (c.mode === 'emptyq') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: '资料太薄', warnings: ['材料只有一句话'], questions: [] }) } }] }) });
      const bodies = {
        '503': { error: { message: 'Rate Reached or Invalid Parameters' } },
        '400': { error: { message: 'The model `deepseek-flash` does not exist' } },
        '401': { error: { message: 'Authentication Fails, Your api key is invalid' } },
      };
      return r.fulfill({ status: Number(c.mode), contentType: 'application/json', body: JSON.stringify(bodies[c.mode]) });
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await p.waitForTimeout(1200);
    await p.setInputFiles('#studyFiles', [{ name: '重要极限.md', mimeType: 'text/markdown', buffer: Buffer.from('# 重要极限\nlim sinx/x=1', 'utf8') }]);
    await p.waitForTimeout(1200);
    await p.evaluate((k) => window.__aiTest.setKey(k), c.mode === 'nokey' ? '' : 'sk-stub-only');
    const before = Date.now();
    // 新构建的第二参表示「跳过确认卡片直接发送」，旧构建会忽略它
    await p.evaluate(() => window.__studyGen('根据这个笔记出一套试卷，以pdf形式交付', { skipConfirm: true }));
    await p.waitForTimeout(c.mode === 'delay' ? 30000 : 4000);
    const bubble = await p.evaluate(() => {
      const cards = document.querySelectorAll('.err-card');
      if (cards.length) {
        const c = cards[cards.length - 1];
        const t = (sel) => { const n = c.querySelector(sel); return n ? n.textContent.trim() : ''; };
        return t('.err-line') + ' || 建议: ' + t('.err-hint') + ' || ' + t('.err-tag') + ' ' + t('.err-detail');
      }
      const e = document.querySelectorAll('.msg__bubble--err');
      return e.length ? e[e.length - 1].textContent : '(无错误气泡)';
    });
    const retry = await p.evaluate(() => {
      const e = document.querySelectorAll('.msg__bubble--err');
      if (!e.length) return 0;
      const w = e[e.length - 1].closest('.msg');
      return w ? w.querySelectorAll('.msg__retry').length : 0;
    });
    const stage = await p.evaluate(() => {
      const s = document.querySelector('#chatStage');
      return s ? (s.textContent || '').trim() + '|visible=' + !s.classList.contains('hidden') : 'no-stage-node';
    });
    console.log('=== ' + c.name + ' ===');
    console.log('  请求次数=' + hits + '  客户端等待=' + (Date.now() - before) + 'ms');
    console.log('  气泡: ' + bubble);
    console.log('  重试按钮数=' + retry + '   阶段气泡: ' + stage);
    if (errs.length) console.log('  页面报错: ' + errs.join(' | '));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error('FATAL ' + e.message); process.exit(2); });
