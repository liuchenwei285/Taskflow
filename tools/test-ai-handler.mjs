/* AI Capture 后端 handler 集成测试（真实 handler + 注入的 mock 上游，不发真请求） */
import assert from 'node:assert';
import { createHandler } from '../functions/handler.ts';

let pass = 0, fail = 0;
const out = [];
function ok(label, cond, detail) {
  if (cond) { pass++; out.push('PASS  ' + label); }
  else { fail++; out.push('FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want),
  'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));

const KEY = 'sk-test-secret-value';
const silence = () => {};

function fakeResponse(status, body) {
  return { status, json: async () => body };
}
function okContent(content) {
  return fakeResponse(200, {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 120, completion_tokens: 60 },
  });
}
function scriptedFetch(steps) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const i = Math.min(calls.length - 1, steps.length - 1);
    const step = steps[i];
    if (typeof step === 'function') return step(url, init);
    return step;
  };
  fn.calls = calls;
  return fn;
}
function neverFetch(url, init) {
  return new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
    });
  });
}
const validDraft = JSON.stringify({
  title: '写完高数作业', desc: '很重要',
  dueAt: '2026-11-20T20:00:00+08:00', priority: 'high', estimatedMinutes: 120,
});
const ip = (n) => ({ 'x-forwarded-for': '10.9.0.' + n });

function makeHandler(fetchImpl, opts = {}) {
  return createHandler({
    fetch: fetchImpl,
    env: opts.noKey ? () => undefined : () => KEY,
    timeoutMs: opts.timeoutMs ?? 1000,
    studyTimeoutMs: opts.studyTimeoutMs,
    retryDelayMs: 0,
    log: silence,
  });
}
function captureRequest(body, n = 1, method = 'POST') {
  return new Request('https://site.test/functions/v1/app/ai/capture', {
    method,
    headers: { 'content-type': 'application/json', ...ip(n) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}
const goodBody = { text: '周五晚八点前写完高数作业，大概两小时，很重要', lang: 'zh', tz: -480, now: Date.parse('2026-11-17T02:00:00Z') };

/* ---------- 路由 ---------- */
{
  const h = makeHandler(scriptedFetch([okContent(validDraft)]));
  const r = await h(new Request('https://site.test/functions/v1/app/health'));
  const j = await r.json();
  eq('health 200', r.status, 200);
  eq('health configured=true', j.configured, true);
  ok('health 不回显密钥', !JSON.stringify(j).includes(KEY));

  const h2 = makeHandler(scriptedFetch([okContent(validDraft)]), { noKey: true });
  const j2 = await (await h2(new Request('https://site.test/functions/v1/app/health'))).json();
  eq('无密钥时 health configured=false', j2.configured, false);

  const r405 = await h(captureRequest(goodBody, 1, 'GET'));
  eq('capture 非 POST → 405', r405.status, 405);
  ok('405 带 Allow 头', r405.headers.get('allow') === 'POST');

  const r404 = await h(new Request('https://site.test/functions/v1/app/ai/nope'));
  eq('未知子路径 → 404', r404.status, 404);
  eq('404 code', (await r404.json()).error.code, 'not_found');
}

/* ---------- 入参校验 ---------- */
{
  const h = makeHandler(scriptedFetch([okContent(validDraft)]));
  const bad = await h(new Request('https://site.test/functions/v1/app/ai/capture', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(2) }, body: '{not json',
  }));
  eq('非法 JSON → 400', bad.status, 400);
  eq('非法 JSON code', (await bad.json()).error.code, 'invalid_request');

  const empty = await h(captureRequest({ text: '   ' }, 3));
  eq('空文本 → 400', empty.status, 400);

  const long = await h(captureRequest({ text: 'x'.repeat(2001) }, 4));
  eq('超长文本 → 400', long.status, 400);

  const huge = await h(new Request('https://site.test/functions/v1/app/ai/capture', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(5) },
    body: JSON.stringify({ text: 'x'.repeat(70000) }),
  }));
  eq('超大 body → 413', huge.status, 413);
  eq('超大 body code', (await huge.json()).error.code, 'payload_too_large');
}

/* ---------- 密钥缺失 ---------- */
{
  const f = scriptedFetch([okContent(validDraft)]);
  const h = makeHandler(f, { noKey: true });
  const r = await h(captureRequest(goodBody, 6));
  eq('无密钥 → 503', r.status, 503);
  eq('无密钥 code', (await r.json()).error.code, 'service_not_configured');
  eq('无密钥时未调用上游', f.calls.length, 0);
}

/* ---------- 成功路径 ---------- */
{
  const f = scriptedFetch([okContent(validDraft)]);
  const h = makeHandler(f);
  const r = await h(captureRequest(goodBody, 7));
  const j = await r.json();
  eq('成功 200', r.status, 200);
  eq('草稿 title', j.draft.title, '写完高数作业');
  eq('dueAt 转毫秒', j.draft.dueAt, Date.parse('2026-11-20T20:00:00+08:00'));
  eq('estimatedMs', j.draft.estimatedMs, 7200000);
  eq('modeSuggestion=deadline', j.draft.modeSuggestion, 'deadline');
  eq('priority', j.draft.priority, 'high');
  eq('usage 透传', j.usage, { promptTokens: 120, completionTokens: 60 });
  ok('响应不含密钥', !JSON.stringify(j).includes(KEY));
  const sent = f.calls[0];
  eq('上游 URL', sent.url, 'https://api.deepseek.com/chat/completions');
  eq('上游模型', sent.body.model, 'deepseek-flash');
  eq('关闭思考模式', sent.body.thinking, { type: 'disabled' });
  eq('JSON 输出契约', sent.body.response_format, { type: 'json_object' });
  ok('系统提示包含 json 关键词', /json/i.test(sent.body.messages[0].content));
  ok('鉴权头用服务端密钥', sent.init.headers.Authorization === 'Bearer ' + KEY);
  ok('请求体不含密钥', !JSON.stringify(sent.body).includes(KEY));

  const f2 = scriptedFetch([okContent(JSON.stringify({ title: '复习线代', desc: '', dueAt: null, priority: 'medium', estimatedMinutes: null }))]);
  const j2 = await (await makeHandler(f2)(captureRequest(goodBody, 8))).json();
  eq('无截止 → duration', j2.draft.modeSuggestion, 'duration');
  eq('无预估 → estimatedMs null', j2.draft.estimatedMs, null);

  const f3 = scriptedFetch([okContent(validDraft)]);
  const j3 = await (await makeHandler(f3)(captureRequest({ ...goodBody, model: 'deepseek-v4-pro' }, 21))).json();
  eq('指定白名单模型生效', f3.calls[0].body.model, 'deepseek-v4-pro');
  eq('响应回显所选模型', j3.model, 'deepseek-v4-pro');
  const badModel = await makeHandler(f3)(captureRequest({ ...goodBody, model: 'gpt-4o' }, 22));
  eq('非白名单模型 → 400', badModel.status, 400);
  eq('非白名单模型 code', (await badModel.json()).error.code, 'invalid_request');
}

/* ---------- 自定义 Provider ---------- */
{
  const provOpen = { id: 'acme-gateway', name: 'Acme', baseUrl: 'https://gw.example/v1', protocol: 'openai', keyEnv: 'AI_PROVIDER_KEY' };
  const provAnth = { id: 'acme-anth', name: 'Acme Anth', baseUrl: 'https://gw.example/anth/v1', protocol: 'anthropic', keyEnv: 'AI_PROVIDER_KEY' };
  const envFn = (k) => k === 'AI_PROVIDER_KEY' ? 'sk-custom' : (k === 'DEEPSEEK_API_KEY' ? 'sk-builtin' : undefined);
  const makeProv = (fetchImpl) => createHandler({ fetch: fetchImpl, env: envFn, timeoutMs: 1000, retryDelayMs: 0, log: () => {} });

  const f = scriptedFetch([okContent(validDraft)]);
  const r = await makeProv(f)(captureRequest({ ...goodBody, model: 'my-model-1', provider: provOpen }, 23));
  const j = await r.json();
  eq('OpenAI 兼容 provider 成功', r.status, 200);
  eq('自定义上游 URL', f.calls[0].url, 'https://gw.example/v1/chat/completions');
  eq('自定义模型透传', f.calls[0].body.model, 'my-model-1');
  eq('自定义密钥来自环境变量', f.calls[0].init.headers.Authorization, 'Bearer sk-custom');
  eq('响应回显 provider', j.provider, 'acme-gateway');

  const fA = scriptedFetch([fakeResponse(200, {
    content: [{ type: 'text', text: validDraft }],
    usage: { input_tokens: 11, output_tokens: 7 },
  })]);
  const jA = await (await makeProv(fA)(captureRequest({ ...goodBody, model: 'claude-x', provider: provAnth }, 24))).json();
  eq('Anthropic provider 成功', jA.draft.title, '写完高数作业');
  eq('Anthropic URL', fA.calls[0].url, 'https://gw.example/anth/v1/messages');
  eq('Anthropic 头 x-api-key', fA.calls[0].init.headers['x-api-key'], 'sk-custom');
  eq('Anthropic 头版本', fA.calls[0].init.headers['anthropic-version'], '2023-06-01');
  ok('Anthropic system 独立字段', typeof fA.calls[0].body.system === 'string' && fA.calls[0].body.system.includes('json'));
  eq('Anthropic 用户消息独立', fA.calls[0].body.messages.length, 1);
  eq('Anthropic 用量映射', jA.usage, { promptTokens: 11, completionTokens: 7 });

  const httpProv = { ...provOpen, id: 'pub-http', baseUrl: 'http://public.example/v1' };
  eq('公网 http 地址 → 400', (await makeProv(scriptedFetch([okContent(validDraft)]))(captureRequest({ ...goodBody, model: 'm', provider: httpProv }, 25))).status, 400);
  const privProv = { ...provOpen, id: 'priv-ip', baseUrl: 'https://10.0.0.5/v1' };
  eq('私网地址 → 400', (await makeProv(scriptedFetch([okContent(validDraft)]))(captureRequest({ ...goodBody, model: 'm', provider: privProv }, 26))).status, 400);
  const badId = { ...provOpen, id: 'Bad_ID' };
  eq('非法 Provider ID → 400', (await makeProv(scriptedFetch([okContent(validDraft)]))(captureRequest({ ...goodBody, model: 'm', provider: badId }, 27))).status, 400);

  const noKey = { ...provOpen, keyEnv: 'MISSING_KEY' };
  const rNoKey = await makeProv(scriptedFetch([okContent(validDraft)]))(captureRequest({ ...goodBody, model: 'm', provider: noKey }, 28));
  eq('自定义密钥变量缺失 → 503', rNoKey.status, 503);

  const fModels = scriptedFetch([fakeResponse(200, { data: [{ id: 'm1' }, { id: 'm2' }, { id: 3 }] })]);
  const rModels = await makeProv(fModels)(new Request('https://site.test/functions/v1/app/ai/test', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(29) },
    body: JSON.stringify({ provider: provOpen, model: 'm1' }),
  }));
  const jModels = await rModels.json();
  eq('/ai/test 获取模型列表', JSON.stringify(jModels.models), JSON.stringify(['m1', 'm2']));
  eq('/ai/test 使用 GET /models', fModels.calls[0].url, 'https://gw.example/v1/models');
  eq('/ai/test 方法', fModels.calls[0].init.method, 'GET');

  const rAnthTest = await makeProv(scriptedFetch([]))(new Request('https://site.test/functions/v1/app/ai/test', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(30) },
    body: JSON.stringify({ provider: provAnth, model: 'claude-x' }),
  }));
  const jAnthTest = await rAnthTest.json();
  eq('Anthropic 测试连接通过', jAnthTest.ok, true);
  eq('Anthropic 提示手动添加模型', jAnthTest.note, 'manual');

  const rBuiltinTest = await makeHandler(scriptedFetch([]))(new Request('https://site.test/functions/v1/app/ai/test', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(31) },
    body: JSON.stringify({ model: 'deepseek-flash' }),
  }));
  const jBuiltinTest = await rBuiltinTest.json();
  eq('内置 provider 测试连接返回模型清单', JSON.stringify(jBuiltinTest.models), JSON.stringify(['deepseek-flash', 'deepseek-v4-pro']));
}

/* ---------- JSON 异常与修复重试 ---------- */
{
  const f = scriptedFetch([okContent('not json at all'), okContent(validDraft)]);
  const r = await makeHandler(f)(captureRequest(goodBody, 9));
  eq('首次非法 JSON → 修复后成功', r.status, 200);
  eq('共调用上游 2 次', f.calls.length, 2);
  ok('修复轮追加 json 约束提示', /json/i.test(f.calls[1].body.messages[f.calls[1].body.messages.length - 1].content));

  const empty = scriptedFetch([okContent('   '), okContent('')]);
  const r2 = await makeHandler(empty)(captureRequest(goodBody, 10));
  eq('持续空内容 → 502', r2.status, 502);
  eq('持续空内容 code', (await r2.json()).error.code, 'upstream_invalid_json');

  const noTitle = scriptedFetch([okContent(JSON.stringify({ title: '', desc: '', dueAt: null, priority: 'low', estimatedMinutes: 30 }))]);
  const r3 = await makeHandler(noTitle)(captureRequest(goodBody, 11));
  eq('空标题两轮后 → 502', r3.status, 502);
}

/* ---------- 上游错误映射与重试 ---------- */
{
  const auth = scriptedFetch([fakeResponse(401, {})]);
  const r = await makeHandler(auth)(captureRequest(goodBody, 12));
  eq('401 → 502 upstream_auth', r.status, 502);
  eq('401 code', (await r.json()).error.code, 'upstream_auth');
  eq('401 不重试', auth.calls.length, 1);

  const bal = scriptedFetch([fakeResponse(402, {})]);
  const j = await (await makeHandler(bal)(captureRequest(goodBody, 13))).json();
  eq('402 → upstream_balance', j.error.code, 'upstream_balance');

  const bad = scriptedFetch([fakeResponse(422, {})]);
  eq('422 → upstream_invalid_request', (await (await makeHandler(bad)(captureRequest(goodBody, 14))).json()).error.code, 'upstream_invalid_request');

  const five = scriptedFetch([fakeResponse(500, {}), okContent(validDraft)]);
  const okr = await makeHandler(five)(captureRequest(goodBody, 15));
  eq('500 后重试成功', okr.status, 200);
  eq('500 重试次数', five.calls.length, 2);

  const limited = scriptedFetch([fakeResponse(429, {})]);
  const lr = await makeHandler(limited)(captureRequest(goodBody, 16));
  eq('持续 429 → 429 upstream_rate_limited', lr.status, 429);
  eq('429 code', (await lr.json()).error.code, 'upstream_rate_limited');

  const timeout = makeHandler(neverFetch, { timeoutMs: 25 });
  const tr = await timeout(captureRequest(goodBody, 17));
  eq('上游超时 → 504', tr.status, 504);
  eq('超时 code', (await tr.json()).error.code, 'upstream_timeout');
}

/* ---------- 本地限流 ---------- */
{
  const f = scriptedFetch([okContent(validDraft)]);
  const h = makeHandler(f);
  let last = null;
  for (let i = 0; i < 11; i++) last = await h(captureRequest(goodBody, 18));
  eq('同 IP 第 11 次 → 429', last.status, 429);
  eq('本地限流 code', (await last.json()).error.code, 'rate_limited');
  eq('限流期间上游只被调用 10 次', f.calls.length, 10);
}

/* ---------- /ai/chat 多轮对话契约 ---------- */
{
  const chatResult = {
    reply: '已把截止日期改到周六。',
    action: 'edit_draft',
    patch: { dueAt: '2026-11-21T20:00:00+08:00', estimatedMinutes: 180 },
  };
  const f = scriptedFetch([okContent(JSON.stringify(chatResult))]);
  const body = {
    text: '改成周六', intent: 'natural', lang: 'zh', tz: -480, now: Date.now(),
    request: '周五写完高数作业，两小时',
    history: [{ role: 'user', text: '周五写完高数作业，两小时', at: 1 }, { role: 'ai', text: '草稿已生成', at: 2 }],
    draft: { title: '写完高数作业', desc: '很重要', dueAt: Date.now() + 86400000, priority: 'high', estimatedMinutes: 120 },
    edits: [{ field: 'priority', from: 'medium', to: 'high', at: 3, source: 'manual' }],
    model: 'deepseek-flash',
  };
  const req = () => new Request('https://site.test/functions/v1/app/ai/chat', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(40) }, body: JSON.stringify(body),
  });
  const r = await makeHandler(f)(req());
  const j = await r.json();
  eq('/ai/chat 成功', r.status, 200);
  eq('结构化 reply', j.reply, chatResult.reply);
  eq('结构化 action', j.action, 'edit_draft');
  eq('patch dueAt 解析为毫秒', j.patch.dueAt, Date.parse(chatResult.patch.dueAt));
  eq('estimatedMinutes→estimatedMs', j.patch.estimatedMs, 180 * 60000);
  const sent = JSON.parse(f.calls[0].body.messages[1].content);
  eq('上下文传递历史消息', sent.recentMessages.length, 2);
  eq('上下文传递当前草稿', sent.currentDraft.title, '写完高数作业');
  eq('上下文传递原始需求', sent.originalRequest, body.request);
  eq('上下文传递修改记录', sent.recentEdits.length, 1);
  eq('模型提示词声明对话助手', /conversation assistant/i.test(f.calls[0].body.messages[0].content), true);
  ok('不上传任务列表（payload 无 tasks 字段）', !('tasks' in sent));

  const regen = scriptedFetch([okContent(JSON.stringify({
    reply: '已重新生成', action: 'generate_draft',
    draft: { title: '写完高数作业', desc: '', dueAt: null, priority: 'medium', estimatedMinutes: 180 },
  }))]);
  const rj = await (await makeHandler(regen)(new Request('https://site.test/functions/v1/app/ai/chat', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(41) },
    body: JSON.stringify(Object.assign({}, body, { text: '请基于原始需求重新生成草稿，保留手动修改', intent: 'regenerate_draft' })),
  }))).json();
  eq('重新生成返回完整草稿', rj.draft.title, '写完高数作业');
  eq('重新生成 action', rj.action, 'generate_draft');
  eq('重新生成 intent 透传', JSON.parse(regen.calls[0].body.messages[1].content).intent, 'regenerate_draft');

  const bad = scriptedFetch([okContent('not json'), okContent(JSON.stringify(chatResult))]);
  const br = await makeHandler(bad)(new Request('https://site.test/functions/v1/app/ai/chat', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(42) }, body: JSON.stringify(body),
  }));
  eq('非法 JSON 修复重试后成功', br.status, 200);
  eq('修复重试调用两次', bad.calls.length, 2);

  const method = await makeHandler(scriptedFetch([]))(new Request('https://site.test/functions/v1/app/ai/chat', {
    method: 'GET', headers: ip(43),
  }));
  eq('/ai/chat 非 POST → 405', method.status, 405);
}

/* ---------- 学习范围限制（服务端意图判定 + 不调上游） ---------- */
{
  const fRef = scriptedFetch([okContent(JSON.stringify({ reply: 'x', action: 'no_change' }))]);
  const rr = await makeHandler(fRef)(new Request('https://site.test/functions/v1/app/ai/chat', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(44) },
    body: JSON.stringify({ text: '给我讲个笑话', intent: 'natural', lang: 'zh', tz: -480, now: Date.now(), model: 'deepseek-flash' }),
  }));
  const rj = await rr.json();
  eq('非学习请求被服务端拒绝', rj.refused, true);
  eq('拒绝时不调用上游', fRef.calls.length, 0);
  ok('拒绝回复含学习引导', /学习/.test(String(rj.reply)));

  const fOk = scriptedFetch([okContent(JSON.stringify({ reply: '好的', action: 'no_change' }))]);
  const or = await makeHandler(fOk)(new Request('https://site.test/functions/v1/app/ai/chat', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(45) },
    body: JSON.stringify({ text: '明天复习高数第二章', intent: 'natural', lang: 'zh', tz: -480, now: Date.now(), model: 'deepseek-flash' }),
  }));
  const oj = await or.json();
  eq('学习请求未被拒绝', !!oj.refused, false);
  ok('学习请求正常调用上游', fOk.calls.length >= 1);
}

/* ---------- /ai/study 出题契约（密钥留在服务端，响应只回题目） ---------- */
{
  const studySet = {
    title: '重要极限练习卷',
    warnings: [],
    questions: [
      { type: 'single', question: 'lim(x→0) sin x / x 的值是？', options: ['0', '1', '∞', '不存在'], answer: 'B', explanation: '重要极限之一。', difficulty: 'easy', knowledgePoints: ['重要极限'] },
      { type: 'fill', question: 'lim(x→∞) (1 + 1/x)^x = ____', answer: 'e', explanation: '第二个重要极限。', difficulty: 'medium' },
    ],
  };
  const studyBody = {
    request: '根据这份笔记出一套 10 道题的试卷',
    config: { count: 10, difficulty: 'mixed', types: [] },
    docs: [{ fileName: '重要极限.md', text: '两个重要极限：lim sinx/x=1，lim(1+1/x)^x=e。' }],
    model: 'deepseek-flash',
  };
  const studyReq = (body, n = 60) => new Request('https://site.test/functions/v1/app/ai/study', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(n) }, body: JSON.stringify(body || studyBody),
  });

  const f = scriptedFetch([okContent(JSON.stringify(studySet))]);
  const r = await makeHandler(f)(studyReq());
  const j = await r.json();
  eq('/ai/study 成功 200', r.status, 200);
  eq('返回题目数组', j.result.questions.length, 2);
  eq('未截断', j.truncated, false);
  eq('题量缺口按配置计算', j.result.shortfall, 8);
  ok('响应不含密钥', !JSON.stringify(j).includes(KEY));
  ok('上游提示词声明 Study Studio', /Study Studio/.test(f.calls[0].body.messages[0].content));
  eq('按题量放大 max_tokens', f.calls[0].body.max_tokens, 600 + 10 * 260);
  ok('资料正文透传给上游', /重要极限/.test(f.calls[0].body.messages[1].content));

  const noDocs = await makeHandler(scriptedFetch([]))(studyReq({ request: '出题', config: { count: 5 }, docs: [] }, 61));
  eq('无资料 → 400', noDocs.status, 400);

  const bigDocs = scriptedFetch([okContent(JSON.stringify(studySet))]);
  const bigRes = await makeHandler(bigDocs)(studyReq({
    request: '出题', docs: Array.from({ length: 12 }, () => ({ fileName: 'a.md', text: 'x'.repeat(9000) })),
  }, 62));
  eq('超长文档数组只截取前 8 份 → 仍成功', bigRes.status, 200);
  const sentDocs = JSON.parse(bigDocs.calls[0].body.messages[1].content).docs;
  eq('文档份数上限 8', sentDocs.length, 8);
  ok('单份正文上限 6000 字', sentDocs.every((d) => d.text.length <= 6000));

  const noKey = makeHandler(scriptedFetch([]), { noKey: true });
  const nk = await noKey(studyReq(null, 63));
  eq('/ai/study 无密钥 → 503', nk.status, 503);
  eq('无密钥 code', (await nk.json()).error.code, 'service_not_configured');

  const huge = await makeHandler(scriptedFetch([]))(new Request('https://site.test/functions/v1/app/ai/study', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(64) },
    body: JSON.stringify({ request: 'x'.repeat(600000), docs: [{ fileName: 'a', text: 'y'.repeat(600000) }] }),
  }));
  eq('/ai/study 超大 body → 413', huge.status, 413);

  const method = await makeHandler(scriptedFetch([]))(new Request('https://site.test/functions/v1/app/ai/study', { method: 'GET', headers: ip(65) }));
  eq('/ai/study 非 POST → 405', method.status, 405);
}

/* ---------- /ai/study 截断、非法输出与错误映射 ---------- */
{
  const studyBody = { request: '出题', config: { count: 5 }, docs: [{ fileName: 'a.md', text: '内容' }] };
  const studyReq = (body, n) => new Request('https://site.test/functions/v1/app/ai/study', {
    method: 'POST', headers: { 'content-type': 'application/json', ...ip(n) }, body: JSON.stringify(body || studyBody),
  });
  const truncatedContent = '{"title":"练习卷","questions":[' +
    '{"type":"single","question":"第一题？","options":["A","B"],"answer":"A","explanation":"解析一","difficulty":"easy"},' +
    '{"type":"single","question":"第二题？","options":["A","B"],"answer":"B","expl';
  const fSalv = scriptedFetch([{ status: 200, json: async () => ({
    choices: [{ message: { content: truncatedContent }, finish_reason: 'length' }],
    usage: { prompt_tokens: 900, completion_tokens: 2000 },
  }) }]);
  const rs = await makeHandler(fSalv)(studyReq(null, 70));
  const js = await rs.json();
  eq('截断输出仍抢救出完整题', js.result.questions.length, 1);
  eq('截断标记为 true', js.truncated, true);
  eq('抢救后少出的题量计入 shortfall', js.result.shortfall, 4);

  const fGarbage = scriptedFetch([okContent('这不是 JSON'), okContent('也不是')]);
  const rg = await makeHandler(fGarbage)(studyReq(null, 71));
  eq('非 JSON 输出 → 502', rg.status, 502);
  eq('非 JSON code', (await rg.json()).error.code, 'upstream_invalid_json');
  eq('非 JSON 不反复重打上游', fGarbage.calls.length, 2);

  const fAuth = scriptedFetch([fakeResponse(401, { error: { message: 'Authentication Fails, Your api key: *** is invalid' } })]);
  const ra = await makeHandler(fAuth)(studyReq(null, 72));
  const ja = await ra.json();
  eq('401 → upstream_auth', ja.error.code, 'upstream_auth');
  ok('错误体带上游原文', /Authentication/.test(String(ja.error.message)));
  ok('错误体脱敏密钥', !/sk-[A-Za-z0-9_-]{6,}/.test(JSON.stringify(ja)));

  const fBal = scriptedFetch([fakeResponse(400, { error: { message: 'Insufficient Balance' } })]);
  const jb = await (await makeHandler(fBal)(studyReq(null, 73))).json();
  eq('400 余额不足带上原文', jb.error.code, 'upstream_invalid_request');
  ok('余额原文可被前端识别', /Insufficient Balance/.test(String(jb.error.message)));

  const fh = makeHandler(neverFetch, { timeoutMs: 1000, studyTimeoutMs: 25 });
  const rt = await fh(studyReq(null, 74));
  eq('/ai/study 上游超时 → 504', rt.status, 504);
  eq('超时 code', (await rt.json()).error.code, 'upstream_timeout');
}

console.log(out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);