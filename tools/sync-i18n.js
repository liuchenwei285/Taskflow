/* 把 i18n/en.json 注入 task-timer-app.html 的 I18N_EN 常量（字典单一来源）
   用法：node tools/sync-i18n.js */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'task-timer-app.html');
const JSONF = path.join(ROOT, 'i18n/en.json');

const dict = JSON.parse(fs.readFileSync(JSONF, 'utf8'));
delete dict._note;

let s = fs.readFileSync(HTML, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';           // 保持文件原有换行风格
const body = JSON.stringify(dict, null, 2).replace(/\r?\n/g, nl + '  ');

const head = 'const I18N_EN = ';
const endMark = nl + '  };' + nl + nl + 'let LANG';
const i = s.indexOf(head + '{');
const j = s.indexOf(endMark, i);
if (i < 0 || j < 0) throw new Error('I18N_EN 块定位失败 (i=' + i + ', j=' + j + ', nl=' + JSON.stringify(nl) + ')');

s = s.slice(0, i) + head + body + ';' + s.slice(j + nl.length + 4);
fs.writeFileSync(HTML, s);
console.log('已注入 ' + Object.keys(dict).length + ' 条词条 → task-timer-app.html');
