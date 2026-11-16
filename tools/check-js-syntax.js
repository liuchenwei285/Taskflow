const acorn = require('acorn');
const fs = require('fs');
const s = fs.readFileSync('task-timer-app.html', 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0, bad = 0;
while ((m = re.exec(s))) {
  i++;
  const code = m[1];
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
