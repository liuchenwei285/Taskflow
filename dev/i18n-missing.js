const fs = require('fs');
const html = fs.readFileSync('task-timer-app.html', 'utf8');
const en = JSON.parse(fs.readFileSync('i18n/en.json', 'utf8'));
const keys = new Set(Object.keys(en));
const rx = /(?:^|[^A-Za-z0-9_$.])(T|Tn)\(\s*'((?:[^'\\]|\\.)*)'/g;
let m;
const miss = new Set();
while ((m = rx.exec(html))) {
  const s = m[2].replace(/\\'/g, "'");
  if (!/[一-鿿]/.test(s)) continue;
  if (!keys.has(s)) miss.add(s);
}
console.log('missing=' + miss.size);
[...miss].forEach((k) => console.log('  ' + k));
