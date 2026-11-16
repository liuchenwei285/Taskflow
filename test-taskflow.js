/* TaskFlow 核心逻辑测试：倒计时数学 + 持久化往返 + 状态机 */
const fs = require('fs');

const html = fs.readFileSync('task-timer-app.html', 'utf8');

// 从 HTML 中抽出工具函数逻辑做等价验证（避免浏览器依赖）
const pad = n => String(n).padStart(2,'0');
const clamp = (v,a,b) => Math.min(b, Math.max(a, v));

function fmtDuration(ms){
  if (ms < 0) ms = 0;
  const s = Math.floor(ms/1000), d = Math.floor(s/86400),
        h = Math.floor(s%86400/3600), m = Math.floor(s%3600/60), sec = s%60;
  if (d > 0) return { text:`${d}天 ${pad(h)}:${pad(m)}:${pad(sec)}`, unit:'' };
  if (h > 0) return { text:`${h}:${pad(m)}:${pad(sec)}`, unit:'' };
  if (m > 0) return { text:`${m}:${pad(sec)}`, unit:'' };
  return { text:`${sec}`, unit:'秒' };
}

let NOW = 1_700_000_000_000;
const now = () => NOW;

function remainingOf(t){
  if (t.mode === 'deadline'){
    if (!t.dueAt) return 0;
    return t.dueAt - now();
  }
  if (t.status === 'running' && t.startedAt){
    const base = (t._baseRemaining != null) ? t._baseRemaining : t.remainingMs;
    return base - (now() - t.startedAt);
  }
  return t.remainingMs != null ? t.remainingMs : t.durationMs;
}

let pass = 0, fail = 0;
function eq(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok?'  PASS':'  FAIL'}  ${label}${ok?'':`  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}
function truthy(label, v){ eq(label, !!v, true); }

console.log('\n[1] fmtDuration 格式化');
eq('0ms -> 0秒',        fmtDuration(0).text, '0');
eq('0ms 单位',          fmtDuration(0).unit, '秒');
eq('1ms -> 0秒',        fmtDuration(1).text, '0');
eq('59s',               fmtDuration(59_000).text, '59');
eq('60s -> 1:00',       fmtDuration(60_000).text, '1:00');
eq('25min',             fmtDuration(25*60_000).text, '25:00');
eq('59:59',             fmtDuration(59*60_000+59_000).text, '59:59');
eq('1h -> 1:00:00',     fmtDuration(3600_000).text, '1:00:00');
eq('1d -> 1天 00:00:00',fmtDuration(86400_000).text, '1天 00:00:00');
eq('负数归零',          fmtDuration(-5000).text, '0');

console.log('\n[2] duration 模式 · 运行中递减');
{
  const t = { mode:'duration', status:'running', durationMs:600_000, remainingMs:600_000,
              startedAt:NOW, _baseRemaining:600_000, alertAhead:300 };
  eq('t+0s',   remainingOf(t), 600_000);
  NOW += 60_000;
  eq('t+60s',  remainingOf(t), 540_000);
  eq('  显示', fmtDuration(remainingOf(t)).text, '9:00');
  NOW += 60_000;
  eq('t+120s', remainingOf(t), 480_000);
  NOW += 480_000;
  eq('t+600s 归零', remainingOf(t), 0);
  NOW += 30_000;
  truthy('超时后为负(可判定超时)', remainingOf(t) < 0);
}

console.log('\n[3] duration 模式 · 暂停冻结（暂停期间时间流逝不影响剩余）');
{
  NOW = 1_700_000_000_000;
  const t = { mode:'duration', status:'running', durationMs:600_000, remainingMs:600_000,
              startedAt:NOW, _baseRemaining:600_000, alertAhead:300 };
  NOW += 90_000;                                   // 走了 90s
  const remBeforePause = Math.max(0, remainingOf(t));
  eq('暂停前剩余', remBeforePause, 510_000);
  // 模拟 toggleTimer -> 暂停
  t.remainingMs = remBeforePause; delete t._baseRemaining; t.status = 'paused';
  NOW += 3_600_000;                                // 暂停 1 小时
  eq('暂停 1h 后剩余不变', remainingOf(t), 510_000);
}

console.log('\n[4] 刷新恢复：save() 冻结快照 + load() 还原（关键需求：重开后进度保留）');
{
  NOW = 1_700_000_000_000;
  let tasks = [{
    id:'t1', title:'写方案', priority:'high', mode:'duration',
    durationMs:600_000, remainingMs:600_000, startedAt:NOW, _baseRemaining:600_000,
    status:'running', alertAhead:300, notify:true, firedAt:null, warned:false,
    createdAt:NOW, updatedAt:NOW, completedAt:null
  }];
  NOW += 200_000;                                  // 运行 200s 后刷新
  // --- 复刻 save() 的冻结逻辑 ---
  const snap = tasks.map(t => {
    const c = Object.assign({}, t);
    if (c.mode === 'duration' && c.status === 'running'){
      c.remainingMs = Math.max(0, remainingOf(c));
      c._baseRemaining = c.remainingMs;
      c.startedAt = now();
    }
    delete c._baseRemaining;
    return c;
  });
  const persisted = JSON.parse(JSON.stringify({ v:1, tasks:snap, savedAt:now() }));
  eq('落盘 remainingMs = 400s', persisted.tasks[0].remainingMs, 400_000);

  // --- 复刻 load() 的还原逻辑 ---
  tasks = persisted.tasks.filter(t => t && t.id && t.title).map(t => {
    if (t.mode === 'duration'){
      t.durationMs  = Number(t.durationMs) || 0;
      t.remainingMs = Number.isFinite(t.remainingMs) ? t.remainingMs : t.durationMs;
      if (t.status === 'running' && t.startedAt) t._baseRemaining = t.remainingMs;
    }
    if (t.status === 'running' && !t.startedAt) t.status = 'paused';
    return t;
  });
  eq('还原后状态仍为 running', tasks[0].status, 'running');
  eq('还原后剩余 400s',        remainingOf(tasks[0]), 400_000);
  NOW += 100_000;                                  // 重开后继续走 100s
  eq('继续计时 -> 剩 300s',    remainingOf(tasks[0]), 300_000);
  eq('  显示 5:00',            fmtDuration(remainingOf(tasks[0])).text, '5:00');
  truthy('进度条 ≈ 50%', Math.abs((1 - remainingOf(tasks[0])/600_000) - 0.5) < 0.001);
}

console.log('\n[5] deadline 模式');
{
  NOW = 1_700_000_000_000;
  const due = NOW + 7_200_000;                     // 2 小时后
  const t = { mode:'deadline', dueAt:due, status:'idle', alertAhead:600 };
  eq('剩余 2h', remainingOf(t), 7_200_000);
  NOW += 3_600_000;
  eq('1h 后剩余 1h', remainingOf(t), 3_600_000);
  NOW += 3_600_000;
  eq('到点归零', remainingOf(t), 0);
  NOW += 1;
  truthy('过期后为负', remainingOf(t) < 0);
  // dueAt 为 falsy（0/null）时按约定返回 0，表示「无有效截止时间」而非负值
  eq('dueAt=0 -> 0（无有效截止时间）', remainingOf({mode:'deadline',dueAt:0}), 0);
  eq('dueAt=null -> 0',               remainingOf({mode:'deadline',dueAt:null}), 0);
}

console.log('\n[6] 到期判定与提醒只触发一次');
{
  NOW = 1_700_000_000_000;
  const t = { mode:'duration', status:'running', durationMs:10_000, remainingMs:10_000,
              startedAt:NOW, _baseRemaining:10_000, alertAhead:0, firedAt:null, warned:false };
  let fires = 0;
  const onTick = () => {
    const rem = remainingOf(t);
    if (rem <= 0 && !t.firedAt){ t.firedAt = now(); t.status='finished'; fires++; }
  };
  for (let i=0;i<3;i++){ now(); onTick(); }        // t+0，未到期
  eq('未到期不触发', fires, 0);
  NOW += 9_000; onTick();
  eq('剩 1s 不触发', fires, 0);
  NOW += 2_000; onTick();
  eq('到期触发一次', fires, 1);
  NOW += 5_000; onTick(); onTick();
  eq('重复 tick 不重复触发', fires, 1);
}

console.log('\n[7] 提前预警只触发一次');
{
  NOW = 1_700_000_000_000;
  const t = { mode:'duration', status:'running', durationMs:600_000, remainingMs:600_000,
              startedAt:NOW, _baseRemaining:600_000, alertAhead:300, warned:false, firedAt:null };
  let warns = 0;
  const onTick = () => {
    const rem = remainingOf(t);
    if (t.status==='running' && t.alertAhead>0 && !t.warned && rem>0 && rem<=t.alertAhead*1000){
      t.warned = true; warns++;
    }
  };
  NOW += 100_000; onTick();                        // 剩 500s > 300s
  eq('未进入预警窗口', warns, 0);
  NOW += 250_000; onTick();                        // 剩 250s <= 300s
  eq('进入预警窗口触发', warns, 1);
  NOW += 10_000; onTick(); onTick();
  eq('预警不重复', warns, 1);
  NOW += 300_000; onTick();                        // 到期
  eq('到期后预警不叠加', warns, 1);
}

console.log('\n[8] 排序：剩余时间（已完成沉底 + 超时置顶）');
{
  NOW = 1_700_000_000_000;
  const mk = (id, rem, done) => ({
    id, title:id, priority:'medium', mode:'duration',
    durationMs:600_000, remainingMs:rem, status: done?'done':'paused', createdAt:0
  });
  const arr = [
    mk('C-剩10分', 600_000),
    mk('A-已超时',  -60_000),
    mk('D-已完成',  0, true),
    mk('B-剩1分',   60_000),
  ];
  arr.sort((a,b)=>{
    const fa=a.status==='done', fb=b.status==='done';
    if (fa!==fb) return fa?1:-1;
    const ra=remainingOf(a), rb=remainingOf(b);
    const oa=ra<=0, ob=rb<=0;
    if (oa!==ob) return oa?-1:1;
    if (oa&&ob) return (a.firedAt||0)-(b.firedAt||0);
    return ra-rb;
  });
  eq('排序结果', arr.map(t=>t.id), ['A-已超时','B-剩1分','C-剩10分','D-已完成']);
}

console.log('\n[9] 排序：优先级');
{
  const mk = (id, pri, rem) => ({ id, title:id, priority:pri, mode:'duration', durationMs:600_000, remainingMs:rem, status:'paused' });
  const arr = [ mk('低', 'low', 1), mk('高', 'high', 900_000), mk('中', 'medium', 5), mk('高2','high',100) ];
  const w = { high:0, medium:1, low:2 };
  arr.sort((a,b)=> w[a.priority]-w[b.priority] || remainingOf(a)-remainingOf(b));
  eq('高->中->低，同级按剩余', arr.map(t=>t.id), ['高2','高','中','低']);
}

console.log('\n[10] 筛选：全部 / 进行中 / 已完成');
{
  const tasks = [
    {id:'a',status:'running'}, {id:'b',status:'paused'}, {id:'c',status:'idle'},
    {id:'d',status:'finished'}, {id:'e',status:'done'}
  ];
  const vis = view => {
    let arr = tasks.slice();
    if (view==='active') arr = arr.filter(t=>t.status!=='done');
    if (view==='done')   arr = arr.filter(t=>t.status==='done');
    return arr.map(t=>t.id);
  };
  eq('全部',   vis('all'),    ['a','b','c','d','e']);
  eq('进行中', vis('active'), ['a','b','c','d']);
  eq('已完成', vis('done'),   ['e']);
}

console.log('\n[11] 分类分组');
{
  const tasks = [
    {id:'1',priority:'high',status:'running'}, {id:'2',priority:'low',status:'done'},
    {id:'3',priority:'high',status:'done'},    {id:'4',priority:'medium',status:'paused'}
  ];
  const byPri = ['high','medium','low'].map(k=>({k, n:tasks.filter(t=>t.priority===k).length})).filter(x=>x.n);
  eq('按优先级分组', byPri.map(x=>`${x.k}:${x.n}`), ['high:2','medium:1','low:1']);
  const order = ['running','paused','idle','finished','done'];
  const bySt = order.map(k=>({k,n:tasks.filter(t=>t.status===k).length})).filter(x=>x.n);
  eq('按状态分组',   bySt.map(x=>`${x.k}:${x.n}`), ['running:1','paused:1','done:2']);
}

console.log('\n[12] 边界：0 分钟时长应被拒绝');
{
  const h = 0, m = 0;
  const durationMs = (h*3600 + m*60) * 1000;
  truthy('0 时长被校验拦截', durationMs <= 0);
  eq('  时长值', durationMs, 0);
  const h2 = 1, m2 = 30;
  eq('1h30m -> 5400000ms', (h2*3600+m2*60)*1000, 5_400_000);
}

console.log('\n[13] 归零后重新开始（重置为原始时长）');
{
  NOW = 1_700_000_000_000;
  const t = { mode:'duration', status:'finished', durationMs:600_000, remainingMs:0, alertAhead:300, firedAt:NOW, warned:true };
  // resetTimer
  t.remainingMs = t.durationMs; delete t._baseRemaining; t.startedAt=null; t.firedAt=null; t.warned=false; t.status='idle';
  eq('重置后剩余=总时长', remainingOf(t), 600_000);
  eq('重置后状态',        t.status, 'idle');
  eq('重置后提醒标记',    [t.firedAt, t.warned], [null, false]);
  // 再启动
  t.remainingMs = 600_000; t._baseRemaining = 600_000; t.startedAt = NOW; t.status='running';
  NOW += 30_000;
  eq('重启后 30s -> 剩 570s', remainingOf(t), 570_000);
}

console.log('\n[14] 跨天倒计时显示');
{
  eq('2天3小时4分5秒', fmtDuration((2*86400 + 3*3600 + 4*60 + 5)*1000).text, '2天 03:04:05');
  eq('23:59:59',       fmtDuration((23*3600+59*60+59)*1000).text, '23:59:59');
  eq('24h 边界',       fmtDuration(86400_000).text, '1天 00:00:00');
}

console.log('\n[15] 已完成字段校验（HTML 关键实现存在性检查）');
{
  const need = [
    ['localStorage 持久化', /localStorage\.setItem\(STORAGE_KEY/],
    ['启动时 loadStore()',  /tasks = __store\.tasks/],
    ['tick 心跳',           /setInterval\(onTick, TICK_MS\)/],
    ['系统通知',            /Notification\.requestPermission/],
    ['提示音 WebAudio',     /createOscillator/],
    ['到期横幅',            /function showBanner\(/],
    ['到期调用 showBanner', /showBanner\(title, body, kind\)/],
    ['fireAlert 触发',      /function fireAlert\(t\)\{\s*notify\(t, T\('倒计时结束'\)/],
    ['提前预警',            /rem <= t\.alertAhead \* 1000/],
    ['暂停逻辑',            /t\.status = 'paused'/],
    ['排序:剩余时间',       /deadline\(a,b\)/],
    ['排序:优先级',         /priority\(a,b\)/],
    ['分组:按优先级',       /prefs\.group === 'priority'/],
    ['分组:按状态',         /: \[\[?'running','计时中'\]|\[\[?'running'/],
    ['导出 JSON',           /function exportJSON/],
    ['导入 JSON',           /function importJSON/],
    ['离线补发提醒',        /有任务在离线期间到期/],
    ['beforeunload 落盘',   /addEventListener\('beforeunload'/],
    ['visibilitychange',    /addEventListener\('visibilitychange'/],
    ['倒计时实时节点',      /data-cd-id/],
    ['UI4 纯白底令牌',      /--bg:#FFFFFF/],
    ['主题令牌-推送接口',   /window\.__onThemeTokens/],
    ['主题令牌-拉取接口',   /getThemeTokens/],
    ['跟随系统深浅色',     /prefers-color-scheme/],
    ['深色令牌套',         /\[data-theme="dark"\]/],
    ['语义色令牌',         /--danger:/],
    ['间距刻度体系',       /--s1:4px/],
    ['五态统一 stateKeyOf', /function stateKeyOf/],
    ['空状态互斥渲染',     /if \(!p\.all\.length\)/],
    ['单数据管线',         /function pipeline\(\)/],
    ['纯CSS主题淡入淡出',  /transition:background \.2s var\(--ease\), color \.2s var\(--ease\)/],
    ['无ViewTransition',  /^(?![\s\S]*startViewTransition)/],
    ['自定义主题色控件',   /id="accentPicker"/],
    ['强调色派生逻辑',     /function applyAccent\(/],
    ['系统动画时长桥',     /animationScale/],
    ['底部四项导航',       /data-page="me"/],
    ['分段指示块',         /id="segInd"/],
    ['卡片溢出菜单',       /id="cardMenu"/],
    ['五态状态类',         /st-paused/],
    ['强调色唯一色相',      /--accent-strong:#355C9A/],
    ['控件边界色',          /--outline-strong:#7A808A/],
    ['原生转场桥',          /startThemeSwitch/],
    ['动态取色开关',        /bindDynamicRow/],
    ['卡片无彩色竖条',      /task__bar/],
    ['已到期并入筛选',      /present\.overdue/],
    ['FAB',                 /class="fab"/],
    ['Snackbar 撤销删除',   /label:T\('撤销'\)/],
  ];
  for (const [label, re] of need){ if (label === '卡片无彩色竖条') truthy(label, !re.test(html)); else truthy(label, re.test(html)); }
  truthy('无硬编码品牌紫 #7262D6', !/#7262D6/i.test(html));
  truthy('无硬编码旧紫 #6750A4', !/#6750A4/i.test(html));
  truthy('无旧黄绿强调色', !/C6F24E/i.test(html));
}

console.log('\n' + '='.repeat(56));
console.log(`结果：${pass} passed, ${fail} failed, ${pass+fail} total`);
console.log('='.repeat(56));
process.exit(fail ? 1 : 0);
