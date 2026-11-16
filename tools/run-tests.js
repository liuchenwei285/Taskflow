/* 一键跑完三套回归：先起静态服务器，再依次执行测试脚本
   用法：npm test   （等价于 node tools/run-tests.js） */
const { spawn } = require('child_process');
const path = require('path');
const { start } = require('./serve');

const PORT = Number(process.env.PORT || 8899);
const ROOT = path.resolve(__dirname, '..');
const SUITES = ['test-taskflow.js', 'e2e-taskflow.js', 'e2e-notify.js', 'e2e-i18n.js'];

function run(file) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' });
    p.on('close', code => resolve(code === null ? 1 : code));
  });
}

(async () => {
  const server = await start(PORT);
  console.log(server.reused
    ? '检测到 8899 已在运行，复用现有静态服务器\n'
    : '静态服务器已启动：http://127.0.0.1:' + PORT + '/\n');
  let failed = 0;
  for (const s of SUITES) {
    console.log('===== ' + s + ' =====');
    const code = await run(path.join(ROOT, s));
    if (code !== 0) { failed++; console.log('  !! ' + s + ' 退出码 ' + code); }
    console.log('');
  }
  server.close();
  console.log(failed ? '有 ' + failed + ' 套件失败' : '全部套件通过');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
