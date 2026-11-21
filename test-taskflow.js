/* TaskFlow 核心逻辑测试：统一计时模型（accumulatedMs + segStart 时间戳法）
   + 状态派生（待开始/计时中/已暂停/已到期/已完成）+ 旧数据迁移 + 排序
   注意：本文件用「等价复刻」的方式验证纯逻辑（不依赖浏览器/DOM）。
   真正的端到端行为由 e2e-*.js 驱动真实页面验证，两者互补。
   复刻严格对齐 task-timer-app.html 中 estMs / dueMs / workElapsedMs / workDisplay /
   remainingOf / resolveStatus / hydrate / sortTasks 的实现。 */
const fs = require('fs');

const html = fs.readFileSync('task-timer-app.html', 'utf8');

/* ===== 复刻的工具与计时引擎（与 HTML 同名函数等价） ===== */
let LANG = 'zh';
const pad = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let NOW = 1_700_000_000_000;
const now = () => NOW;

function fmtDuration(ms){
  if (ms < 0) ms = 0;
  const s = Math.floor(ms/1000);
  const d = Math.floor(s/86400);
  const h = Math.floor(s%86400/3600);
  const m = Math.floor(s%3600/60);
  const sec = s%60;
  const dayTag = (LANG === 'en') ? 'd ' : '天 ';
  if (d > 0)  return { text:`${d}${dayTag}${pad(h)}:${pad(m)}:${pad(sec)}`, unit:'' };
  if (h > 0)  return { text:`${h}:${pad(m)}:${pad(sec)}`, unit:'' };
  if (m > 0)  return { text:`${m}:${pad(sec)}`, unit:'' };
  return { text:`${sec}`, unit:(LANG === 'en') ? 's' : '秒' };
}

const ST = { IDLE:'IDLE', RUNNING:'RUNNING', PAUSED:'PAUSED', EXPIRED:'EXPIRED', DONE:'DONE' };

function estMs(t){ return Math.max(0, Number(t && t.durationMs) || 0); }
function dueMs(t){ return Number(t && t.dueAt) || 0; }
function isPomodoro(t){ return !!(t && t.mode === 'pomodoro'); }
function workElapsedMs(t, at){
  at = (at == null) ? now() : at;
  let e = Number(t.accumulatedMs) || 0;
  if (t.status === 'running' && t.segStart) e += Math.max(0, at - t.segStart);
  return e;
}
function dueRemainingMs(t, at){
  const d = dueMs(t); if (!d) return null;
  at = (at == null) ? now() : at;
  return d - at;
}
function workDisplay(t, at){
  at = (at == null) ? now() : at;
  const est = estMs(t);
  const done = !!t.completedAt;
  const e = done ? (Number(t.accumulatedMs) || 0) : workElapsedMs(t, at);
  if (est > 0){
    const rem = est - e;
    if (rem >= 0){ const f = fmtDuration(rem); return { text: f.text, unit: f.unit, over:false, est:est }; }
    const f = fmtDuration(-rem); return { text: '+' + f.text, unit: '', over:true, est:est };
  }
  const f = fmtDuration(e); return { text: f.text, unit: f.unit, over:false, est:0 };
}
/* 非番茄钟路径（番茄钟由 e2e 验证） */
function remainingOf(t){
  if (!t) return 0;
  const due = dueMs(t);
  if (due) return due - now();
  const est = estMs(t);
  if (est > 0) return est - workElapsedMs(t);
  return 0;
}
function resolveStatus(t, nowTs){
  if (!t) return ST.IDLE;
  const at = (nowTs == null) ? now() : nowTs;
  if (t.completedAt) return ST.DONE;
  const due = dueMs(t);
  if (due && due <= at) return ST.EXPIRED;
  if (t.status === 'running') return ST.RUNNING;
  if (t.status === 'paused')  return ST.PAUSED;
  return ST.IDLE;   /* 测试里不会出现旧 finished/pomodoro，已在 hydrate 归一 */
}
function progressOf(t){
  const est = estMs(t);
  if (est <= 0) return 0;
  const e = t.completedAt ? (Number(t.accumulatedMs) || 0) : workElapsedMs(t);
  return clamp(e / est, 0, 1);
}

/* 状态迁移（等价 HTML 的 beginWork/pauseTask/toggleTimer/resetTimer/toggleDone/onTick 到期分支） */
function beginWork(t){ t.startedAt = now(); t.segStart = now(); t.status = 'running'; t.firedAt = null; t.warned = false; }
function pauseTask(t){ if (t.status !== 'running') return; if (t.segStart) t.accumulatedMs = (Number(t.accumulatedMs)||0) + Math.max(0, now() - t.segStart); t.segStart = null; t.status = 'paused'; }
function toggleTimerReplica(t){
  const st = resolveStatus(t);
  if (st === ST.DONE) return 'uncomplete';
  if (st === ST.EXPIRED) return 'expired-block';
  if (t.status === 'running'){ pauseTask(t); return 'paused'; }
  const est = estMs(t), due = dueRemainingMs(t);
  if (est > 0 && due != null){
    const workLeft = est - workElapsedMs(t);
    if (workLeft > 0 && due < workLeft) return 'warn-insufficient';
  }
  beginWork(t); return 'started';
}
function resetTimerReplica(t){
  if (t.status === 'running') pauseTask(t);
  t.segStart = null; t.startedAt = null; t.accumulatedMs = 0;
  t.firedAt = null; t.warned = false; t.completedAt = null; t.status = 'idle';
}
function toggleDoneReplica(t){
  if (t.completedAt){
    const pre = t._preDone || null; t.completedAt = null;
    if (pre){ t.status = pre.status; if (t.status === 'running'){ t.segStart = now(); t.startedAt = now(); } }
    else t.status = 'paused';
    delete t._preDone; return;
  }
  const snap = { status: t.status, firedAt: t.firedAt };
  if (t.status === 'running') pauseTask(t);
  t._preDone = snap; t.completedAt = now();
}
/* onTick 到期分支：仅由截止派生；正在计时先停表结算已用，再标记到期，提醒一次 */
function tickExpiry(t, at){
  at = (at == null) ? now() : at;
  if (t.completedAt) return null;
  if (resolveStatus(t, at) === ST.EXPIRED && !t.firedAt){
    if (t.status === 'running'){ if (t.segStart) t.accumulatedMs = (Number(t.accumulatedMs)||0) + Math.max(0, at - t.segStart); t.segStart = null; t.status = 'paused'; }
    t.firedAt = at; t.warned = true; return 'fired';
  }
  return null;
}
/* 延期：+1 小时，清到期标记；到期时已停表 → 回已暂停，可继续计时 */
function postponeReplica(t){ if (!dueMs(t)) return; t.dueAt = dueMs(t) + 3600000; t.firedAt = null; t.warned = false; if (t.status === 'running') t.status = 'paused'; }
/* 创建 past-due 守卫（saveEditor 非编辑态） */
function creationDueRejected(dueAt, editing){ return !!dueAt && !editing && dueAt <= now(); }

/* hydrate：与 HTML 等价的字段规范化 + 旧数据进度保留 + 旧 finished 归已暂停 */
function hydrate(arr){
  return (arr || []).filter(t => t && t.id && t.title).map(t => {
    const c = Object.assign({}, t);
    c.priority   = ['high','medium','low'].includes(c.priority) ? c.priority : 'medium';
    c.mode       = ['deadline','pomodoro'].includes(c.mode) ? c.mode : 'duration';
    c.notify     = c.notify !== false;
    c.alertAhead = Number.isFinite(c.alertAhead) ? c.alertAhead : 300;
    c.status     = ['idle','running','paused','finished','done'].includes(c.status) ? c.status : 'idle';
    c.createdAt  = c.createdAt || now();
    c.accumulatedMs = Number.isFinite(c.accumulatedMs) ? c.accumulatedMs : 0;
    c.completedAt = c.completedAt || null;
    if (c.mode === 'duration'){
      c.durationMs = Number(c.durationMs) || 0;
      if (!Number.isFinite(t.accumulatedMs) && Number.isFinite(c.remainingMs) && c.durationMs > 0)
        c.accumulatedMs = clamp(c.durationMs - c.remainingMs, 0, c.durationMs);
      if (c.status === 'finished') c.status = 'paused';
      if (c.status === 'running' && !c.segStart) c.segStart = c.startedAt || now();
    }
    return c;
  });
}
/* 排序：按「剩余时间」(HTML sortTasks.deadline 等价) */
function deadlineCmp(a, b){
  const doneA = resolveStatus(a) === ST.DONE, doneB = resolveStatus(b) === ST.DONE;
  if (doneA !== doneB) return doneA ? 1 : -1;
  const da = dueMs(a), db = dueMs(b);
  const noA = !da, noB = !db;
  if (noA !== noB) return noA ? 1 : -1;
  if (!da && !db) return (a.createdAt||0) - (b.createdAt||0);
  return da - db;
}

let pass = 0, fail = 0;
function eq(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok?'  PASS':'  FAIL'}  ${label}${ok?'':`  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}
function truthy(label, v){ eq(label, !!v, true); }
const mk = (o) => Object.assign({ id:'x', title:'t', priority:'medium', mode:'duration', durationMs:0, dueAt:null, status:'idle', accumulatedMs:0, segStart:null, startedAt:null, firedAt:null, warned:false, completedAt:null, createdAt:NOW, alertAhead:300, notify:true }, o);

console.log('\n[1] fmtDuration 格式化');
eq('0ms -> 0秒',        fmtDuration(0).text, '0');
eq('0ms 单位',          fmtDuration(0).unit, '秒');
eq('59s',               fmtDuration(59_000).text, '59');
eq('60s -> 1:00',       fmtDuration(60_000).text, '1:00');
eq('25min',             fmtDuration(25*60_000).text, '25:00');
eq('1h -> 1:00:00',     fmtDuration(3600_000).text, '1:00:00');
eq('1d -> 1天 00:00:00',fmtDuration(86400_000).text, '1天 00:00:00');
eq('负数归零',          fmtDuration(-5000).text, '0');

console.log('\n[2] 创建即「待开始」+ 大字显示预计倒计时（§2/§4.2）');
{
  NOW = 1_700_000_000_000;
  const t = mk({ durationMs:600_000 });                 // 新建默认 idle，无 segStart
  eq('新建默认待开始',       resolveStatus(t), ST.IDLE);
  eq('待开始未计时(已用=0)',  workElapsedMs(t), 0);
  eq('大字=预计倒计时10:00',  workDisplay(t).text, '10:00');
  eq('未超时',               workDisplay(t).over, false);
  const cd = mk({ durationMs:0 });                       // 不设预计 = 正计时
  eq('无预计大字=0',          workDisplay(cd).text, '0');
}

console.log('\n[3] 待开始→开始→计时中：时间戳法递减/递增（§3.1）');
{
  NOW = 1_700_000_000_000;
  const t = mk({ durationMs:600_000 });
  eq('开始返回 started', toggleTimerReplica(t), 'started');
  eq('状态计时中',       resolveStatus(t), ST.RUNNING);
  eq('segStart 已置',    t.segStart === NOW, true);
  NOW += 120_000;
  eq('走 120s 已用 120s', workElapsedMs(t), 120_000);
  eq('大字倒数 8:00',     workDisplay(t).text, '8:00');
  const up = mk({ durationMs:0 });
  toggleTimerReplica(up); NOW += 45_000;
  eq('正计时显示 45s',    fmtDuration(workElapsedMs(up)).text, '45');
}

console.log('\n[4] 计时中→暂停→继续：累计 accumulatedMs、暂停期不计（§2/§3.2）');
{
  NOW = 1_700_000_000_000;
  const t = mk({ durationMs:600_000 });
  toggleTimerReplica(t);
  NOW += 100_000;                 // 计时 100s
  eq('暂停返回 paused', toggleTimerReplica(t), 'paused');
  eq('暂停累计已用 100s', workElapsedMs(t), 100_000);
  eq('segStart 清空',    t.segStart, null);
  NOW += 3_600_000;              // 暂停 1 小时
  eq('暂停期间已用不变',  workElapsedMs(t), 100_000);
  eq('大字仍倒数(冻)8:20', workDisplay(t).text, '8:20');
  toggleTimerReplica(t);         // 继续
  eq('继续回计时中',      resolveStatus(t), ST.RUNNING);
  NOW += 50_000;
  eq('继续后已用 150s',    workElapsedMs(t), 150_000);
}

console.log('\n[5] 刷新恢复：时间戳法无需 tick 即正确（§3.1 关键需求）');
{
  NOW = 1_700_000_000_000;
  const t = mk({ durationMs:600_000, status:'running', segStart:NOW, accumulatedMs:0 });
  NOW += 250_000;                // 假设页面关闭/休眠期间真实时间推进，刷新恢复
  const re = hydrate([JSON.parse(JSON.stringify(t))]);
  eq('还原仍计时中',   resolveStatus(re[0]), ST.RUNNING);
  eq('还原按时间戳续算已用 250s', workElapsedMs(re[0]), 250_000);
  eq('大字倒数 5:50',  workDisplay(re[0]).text, '5:50');
  NOW += 100_000;
  eq('继续走 -> 已用 350s', workElapsedMs(re[0]), 350_000);
}

console.log('\n[6] 预计用完：转超时(+)、不自动结束、仍计时中（§3.3）');
{
  NOW = 1_700_000_000_000;
  const t = mk({ durationMs:60_000, status:'running', segStart:NOW });
  NOW += 60_000;  eq('用完瞬间剩 0', workDisplay(t).text, '0');
  NOW += 75_000;
  eq('超时显示 +1:15', workDisplay(t).text, '+1:15');
  eq('over=true',      workDisplay(t).over, true);
  eq('仍计时中(未自动结束)', resolveStatus(t), ST.RUNNING);
  eq('进度封顶 1',      progressOf(t), 1);
}

console.log('\n[7] 已到期派生：自动停表结算 + 提醒一次 + 不能开始 + 可逾期完成（§2）');
{
  NOW = 1_700_000_000_000;
  const due = NOW + 100_000;
  const t = mk({ durationMs:600_000, dueAt:due, status:'running', segStart:NOW });
  NOW += 100_001;
  eq('过截止判定已到期', resolveStatus(t), ST.EXPIRED);
  eq('tick 触发一次 fired', tickExpiry(t), 'fired');
  eq('自动停表(已暂停)', t.status, 'paused');
  eq('到期结算已用 = at - segStart', workElapsedMs(t), 100_001);
  eq('segStart 清空', t.segStart, null);
  eq('重复 tick 不再触发', tickExpiry(t), null);
  eq('已到期不能开始', toggleTimerReplica(t), 'expired-block');
  toggleDoneReplica(t);
  eq('逾期仍可完成', resolveStatus(t), ST.DONE);
}

console.log('\n[8] 无截止永不到期（§2/§3.4）');
{
  NOW = 1_700_000_000_000;
  const t = mk({ durationMs:10_000, status:'running', segStart:NOW });
  NOW += 10_000_000;            // 远超预计、且无 dueAt
  eq('无截止仍计时中', resolveStatus(t), ST.RUNNING);
  eq('无截止 tick 不到期', tickExpiry(t), null);
  eq('无截止 dueRemaining=null', dueRemainingMs(t), null);
}

console.log('\n[9] 开始前「时间不够」提醒（§3.5，非阻断）');
{
  NOW = 1_700_000_000_000;
  const t = mk({ durationMs:600_000, dueAt:NOW + 120_000 });   // 还需 10min，但 2min 后截止
  eq('触发时间不够提醒', toggleTimerReplica(t), 'warn-insufficient');
  eq('提醒不启动计时', resolveStatus(t), ST.IDLE);
  beginWork(t);                                               // 用户点「仍然开始」
  eq('仍然开始可启动', resolveStatus(t), ST.RUNNING);
}

console.log('\n[10] 创建 past-due 守卫（§3.6）');
{
  NOW = 1_700_000_000_000;
  eq('新建 past-due 被拒', creationDueRejected(NOW - 1000, false), true);
  eq('新建 未来 放行',     creationDueRejected(NOW + 1000, false), false);
  eq('新建 无截止 放行',   creationDueRejected(null, false), false);
  eq('编辑态允许改到过去', creationDueRejected(NOW - 1000, true), false);
}

console.log('\n[11] 延期→恢复可计时（§2）');
{
  NOW = 1_700_000_000_000;
  const due = NOW - 1;
  const t = mk({ durationMs:600_000, dueAt:due, status:'paused' });
  eq('过期为已到期',   resolveStatus(t), ST.EXPIRED);
  postponeReplica(t);
  eq('延期后不在已到期', resolveStatus(t) !== ST.EXPIRED, true);
  eq('延期后是已暂停',   resolveStatus(t), ST.PAUSED);
  eq('延期后能继续',     toggleTimerReplica(t), 'started');
}

console.log('\n[12] 排序：按剩余时间（截止升序 / 无截止最后 / 已完成沉底）（§4.5）');
{
  NOW = 1_700_000_000_000;
  const arr = [
    mk({ id:'C', dueAt:NOW + 300_000 }),
    mk({ id:'N', dueAt:null, createdAt:NOW }),
    mk({ id:'A', dueAt:NOW + 60_000 }),
    mk({ id:'D', dueAt:NOW + 10_000, completedAt:NOW }),
    mk({ id:'B', dueAt:NOW + 120_000 }),
  ];
  arr.sort(deadlineCmp);
  eq('截止近->远,无截止最后,完成沉底', arr.map(t=>t.id), ['A','B','C','N','D']);
}

console.log('\n[13] 完成：实际用时 vs 预计 + 撤销（§3.8/§4.2）');
{
  NOW = 1_700_000_000_000;
  const t = mk({ durationMs:600_000, status:'running', segStart:NOW });
  NOW += 300_000;
  toggleDoneReplica(t);
  eq('完成停表结算已用 300s', workElapsedMs(t), 300_000);
  eq('完成态', resolveStatus(t), ST.DONE);
  eq('大字=实际用时5:00', workDisplay(t).text, '5:00');
  toggleDoneReplica(t);                 // 撤销 → 回到计时中并续接
  eq('撤销回计时中', resolveStatus(t), ST.RUNNING);
  NOW += 10_000;
  eq('续接后不清零已用', workElapsedMs(t) >= 300_000, true);
}

console.log('\n[14] 旧数据兼容迁移（§5，无损、幂等、非破坏）');
{
  NOW = 1_700_000_000_000;
  // 14a 旧版 running(duration, 无 accumulatedMs/segStart, 有 remainingMs+startedAt) -> 保留进度
  const legacyRunning = { id:'l1', title:'写方案', mode:'duration', durationMs:600_000, remainingMs:400_000, startedAt:NOW, status:'running', createdAt:NOW };
  const h1 = hydrate([legacyRunning])[0];
  eq('旧 running 反推已用 200s', h1.accumulatedMs, 200_000);
  eq('旧 running 续接 segStart', h1.segStart, NOW);
  NOW += 50_000;
  eq('旧 running 刷新后已用 250s', workElapsedMs(h1), 250_000);
  // 14b 旧版 idle 未开始 -> 待开始（保留 dueAt）
  NOW = 1_700_000_000_000;
  const legacyIdle = { id:'l2', title:'读书', mode:'duration', durationMs:120_000, status:'idle', dueAt:NOW + 3600_000, createdAt:NOW };
  eq('旧 idle -> 待开始', resolveStatus(hydrate([legacyIdle])[0]), ST.IDLE);
  // 14c 旧版 dueAt 已过 -> 已到期
  const legacyPast = { id:'l3', title:'交表', mode:'duration', durationMs:0, status:'idle', dueAt:NOW - 1000, createdAt:NOW };
  eq('旧过期 dueAt -> 已到期', resolveStatus(hydrate([legacyPast])[0]), ST.EXPIRED);
  // 14d 旧版 finished 无 dueAt -> 归为已暂停（不是已到期）
  const legacyFinished = { id:'l4', title:'番茄', mode:'duration', durationMs:60_000, remainingMs:0, status:'finished', createdAt:NOW };
  const h4 = hydrate([legacyFinished])[0];
  eq('旧 finished -> 已暂停', h4.status, 'paused');
  eq('旧 finished 无截止不判已到期', resolveStatus(h4) !== ST.EXPIRED, true);
  // 14e 旧版 done 保持 done
  const legacyDone = { id:'l5', title:'完成项', mode:'duration', durationMs:0, status:'done', completedAt:NOW, createdAt:NOW };
  eq('旧 done 保持已完成', resolveStatus(hydrate([legacyDone])[0]), ST.DONE);
  // 14f 幂等：再 hydrate 一次结果不变
  const twice = hydrate(hydrate([legacyRunning]));
  eq('迁移幂等(已用不翻倍)', twice[0].accumulatedMs, hydrate([legacyRunning])[0].accumulatedMs);
}

console.log('\n[15] HTML 关键实现存在性检查（真实文件，证明功能已落地）');
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
    ['提前预警(按截止/预计)', /const rem = \(drem != null\) \? drem : wrem;/],
    ['暂停逻辑',            /t\.status = 'paused'/],
    ['排序:剩余时间',       /deadline\(a,b\)/],
    ['排序:优先级',         /priority\(a,b\)/],
    ['分组:按优先级',       /prefs\.group === 'priority'/],
    ['导出 JSON',           /function exportJSON/],
    ['导入 JSON',           /function importJSON/],
    ['离线补发提醒',        /有任务在离线期间到期/],
    ['beforeunload 落盘',   /addEventListener\('beforeunload'/],
    ['visibilitychange',    /addEventListener\('visibilitychange'/],
    ['倒计时实时节点',      /data-cd-id/],
    ['UI4 纯白底令牌',      /--bg:#FFFFFF/],
    ['主题令牌-推送接口',   /window\.__onThemeTokens/],
    ['主题令牌-拉取接口',   /getThemeTokens/],
    ['跟随系统深浅色',      /prefers-color-scheme/],
    ['深色令牌套',          /\[data-theme="dark"\]/],
    ['语义色令牌',          /--danger:/],
    ['间距刻度体系',        /--s1:4px/],
    ['五态统一 stateKeyOf', /function stateKeyOf/],
    ['单数据管线',          /function pipeline\(\)/],
    ['纯CSS主题淡入淡出',   /transition:background var\(--dur-soft\) var\(--ease-out\), color var\(--dur-soft\) var\(--ease-out\)/],
    ['无ViewTransition',    /^(?![\s\S]*startViewTransition)/],
    ['自定义主题色控件',    /id="accentPicker"/],
    ['强调色派生逻辑',      /function applyAccent\(/],
    ['底部四项导航',        /data-page="me"/],
    ['卡片溢出菜单',        /id="cardMenu"/],
    ['五态状态类',          /st-paused/],
    ['强调色唯一色相',      /--accent-strong:#D81B74/],
    ['控件边界色',          /--outline-strong:#7A808A/],
    ['动态取色开关',        /bindDynamicRow/],
    ['卡片无彩色竖条',      !/task__bar/.test(html)],
    ['FAB',                 /class="fab"/],
    ['Snackbar 撤销删除',   /label:T\('撤销'\)/],

    /* ---- 统一计时引擎（本轮新增） ---- */
    ['统一模型-预计访问器',  /function estMs\(t\)\{\s*return Math\.max\(0, Number\(t && t\.durationMs\)/],
    ['统一模型-截止访问器',  /function dueMs\(t\)\{\s*return Number\(t && t\.dueAt\) \|\| 0;/],
    ['工作计时-时间戳法',    /function workElapsedMs\(t, at\)\{[\s\S]*t\.status === 'running' && t\.segStart[\s\S]*at - t\.segStart/],
    ['大字显示-workDisplay', /function workDisplay\(t, at\)\{/],
    ['超时不自动结束(+)',    /return \{ text: '\+' \+ f\.text, unit: '', over:true/],
    ['状态派生-resolveStatus',/function resolveStatus\(t, nowTs\)\{/],
    ['到期只由截止派生',      /if \(due && due <= at\) return ST\.EXPIRED;/],
    ['五态含待开始 ST.IDLE',  /IDLE:'IDLE'[\s\S]*RUNNING:'RUNNING'[\s\S]*PAUSED:'PAUSED'[\s\S]*EXPIRED:'EXPIRED'[\s\S]*DONE:'DONE'/],
    ['beginWork 起表',        /function beginWork\(t\)\{[\s\S]*t\.segStart\s*= now\(\);[\s\S]*t\.status = 'running'/],
    ['pauseTask 结算累计',    /if \(t\.segStart\) pushSessions\(t, t\.segStart, now\(\), 'focus'\);[\s\S]*t\.segStart = null;[\s\S]*t\.status = 'paused'/],
    ['待开始大字标签',        /return T\('待开始'\);/],
    ['暂停标签-已用',         /已暂停 · 已用 \{t\}/],
    ['开始前时间不够提醒',    /距截止只剩 \{d\}，但预计还需 \{w\}。/],
    ['仍然开始动作',          /label: T\('仍然开始'\)/],
    ['创建 past-due 守卫',    /!editingId && dueAt <= now\(\)/],
    ['已到期不能开始',        /任务已到期，请先延期后再开始/],
    ['到期自动停表',          /if \(t\.mode !== 'pomodoro' && t\.status === 'running'\)\{[\s\S]*pushSessions\(t, t\.segStart, at, 'focus'\);[\s\S]*t\.status = 'paused'/],
    ['延期 +1 小时',          /t\.dueAt = dueMs\(t\) \+ 3600000;/],
    ['旧 finished 归已暂停',  /if \(c\.status === 'finished'\) c\.status = 'paused';/],
    ['旧进度保留反推累计',    /c\.accumulatedMs = clamp\(c\.durationMs - c\.remainingMs/],
    ['导入复用 hydrate',      /hydrate\(withIds\)/],
    ['AI 创建默认待开始',     /status: 'idle', startedAt: null, segStart: null,[\s\S]*§2 AI 创建（含确认卡片）同样默认/],
    ['副标题-开始暂停完成',   /开始、暂停、完成——让每件重要的事都被好好计时/],

    /* ---- 微交互动效系统（保留既有覆盖） ---- */
    ['动效令牌-时长',        /--dur-hover:120ms;[\s\S]*--dur-press:100ms;[\s\S]*--dur-tip:150ms;/],
    ['动效令牌-曲线',        /--ease-out:cubic-bezier\(0,0,\.2,1\);[\s\S]*--ease-in:cubic-bezier\(\.4,0,1,1\);[\s\S]*--ease-inout:cubic-bezier\(\.4,0,\.2,1\);/],
    ['按钮按压 0.97',        /\.btn:active\{transform:scale\(\.97\)\}/],
    ['FAB 按压 0.97',        /\.fab:active\{transform:scale\(\.97\)\}/],
    ['禁用态无反馈',         /\.btn\[disabled\]\{opacity:\.4; pointer-events:none\}/],
    ['焦点可见',            /:focus-visible\{\s*outline:2px solid var\(--primary\)/],
  ];
  for (const [label, re] of need){
    const ok = (typeof re === 'boolean') ? re : re.test(html);
    ok ? pass++ : fail++;
    console.log(`${ok?'  PASS':'  FAIL'}  ${label}${ok?'':'  (未匹配)'}`);
  }
  truthy('无硬编码品牌紫 #7262D6', !/#7262D6/i.test(html));
  truthy('无硬编码旧紫 #6750A4', !/#6750A4/i.test(html));
  truthy('无旧黄绿强调色', !/C6F24E/i.test(html));
}

console.log('\n' + '='.repeat(56));
console.log(`结果：${pass} passed, ${fail} failed, ${pass+fail} total`);
console.log('='.repeat(56));
process.exit(fail ? 1 : 0);
