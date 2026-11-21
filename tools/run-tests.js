/* 一键跑完全量回归：先起静态服务器，再依次执行测试脚本
   用法：npm test                       （等价于 node tools/run-tests.js）
        PORT=3000 npm test             （指定服务端口）
        TASKFLOW_URL=http://host:port/ node e2e-xxx.js   （单跑某套件时指定地址）
   默认端口 8899；若系统拒绝绑定（EACCES/EPERM），临时改用 FALLBACK_PORT（默认 18899）并告知。 */
const { spawn } = require('child_process');
const path = require('path');
const { start } = require('./serve');

const PORT = Number(process.env.PORT || 8899);
const FALLBACK_PORT = Number(process.env.FALLBACK_PORT || 18899);
const ROOT = path.resolve(__dirname, '..');
const SUITES = ['test-taskflow.js', 'e2e-taskflow.js', 'e2e-notify.js', 'e2e-i18n.js', 'e2e-motion.js', 'e2e-drawer.js', 'e2e-stats.js', 'e2e-done.js', 'e2e-conversation.js', 'e2e-ai.js', 'e2e-study.js', 'e2e-view.js', 'e2e-welcome.js', 'tools/test-ai-handler.mjs'];

function run(file, env) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [file], { cwd: ROOT, stdio: 'inherit', env });
    p.on('close', code => resolve(code === null ? 1 : code));
  });
}

/* 端口绑定失败（Windows/权限受限环境常见 EACCES）时退到临时端口，不把它写死成唯一配置 */
async function startServer(preferred) {
  try {
    const s = await start(preferred);
    return { handle: s, port: preferred, reused: !!s.reused };
  } catch (e) {
    if (!e || (e.code !== 'EACCES' && e.code !== 'EPERM')) throw e;
    console.log('端口 ' + preferred + ' 绑定被拒（' + e.code + '），本次改用临时端口 ' + FALLBACK_PORT + '；如需固定端口请用 PORT=... 指定可绑定端口。\n');
    const s = await start(FALLBACK_PORT);
    return { handle: s, port: FALLBACK_PORT, reused: !!s.reused };
  }
}

(async () => {
  const { handle: server, port, reused } = await startServer(PORT);
  console.log(reused
    ? '检测到 ' + port + ' 已在运行，复用现有静态服务器\n'
    : '静态服务器已启动：http://127.0.0.1:' + port + '/\n');
  const env = Object.assign({}, process.env, { TASKFLOW_URL: 'http://127.0.0.1:' + port + '/' });
  const results = [];
  let failed = 0;
  for (const s of SUITES) {
    console.log('===== ' + s + ' =====');
    const code = await run(path.join(ROOT, s), env);
    if (code !== 0) { failed++; console.log('  !! ' + s + ' 退出码 ' + code); }
    results.push([s, code === 0 ? 'PASS' : 'FAIL(' + code + ')']);
    console.log('');
  }
  server.close();
  console.log('===== 套件汇总 =====');
  results.forEach(r => console.log('  ' + (r[1] === 'PASS' ? '✓' : '✗') + ' ' + r[0] + '  ' + r[1]));
  console.log(failed ? '\n有 ' + failed + ' 套件失败' : '\n全部套件通过');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
