const acorn = require('acorn');
const fs = require('fs');
const s = fs.readFileSync('task-timer-app.html', 'utf8');
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m, i = 0, bad = 0;
while ((m = re.exec(s))) {
  const attrs = m[1] || '';
  if (/\bsrc=/.test(attrs)) continue;                                  // 外链脚本不在本文件里
  if (/type=/i.test(attrs) && !/text\/javascript|module/i.test(attrs)) continue;  // JSON 数据块（内联依赖）不是 JS
  i++;
  const code = m[2];
  const line = s.slice(0, m.index).split('\n').length;
  try {
    acorn.parse(code, { ecmaVersion: 2023 });
    console.log('block', i, 'line', line, 'OK', code.length, 'chars');
  } catch (e) {
    bad++;
    console.log('block', i, 'line', line, 'FAIL', e.message);
  }
}
process.exit(bad ? 1 : 0);
