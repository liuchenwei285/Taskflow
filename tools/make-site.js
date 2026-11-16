/* 生成 Qoder Sites 部署产物：把 task-timer-app.html 原样复制为 site/index.html
   源文件保持只读；生成后逐字节校验，不一致立即报错。
   用法：node tools/make-site.js
   注：不用 dist/ 是因为本机全局 gitignore 忽略 dist/，发布目录需进版本库。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'task-timer-app.html');
const OUT_DIR = path.join(ROOT, 'site');
const OUT = path.join(OUT_DIR, 'index.html');

const src = fs.readFileSync(SRC);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, src);
const out = fs.readFileSync(OUT);
if (!src.equals(out)) throw new Error('dist/index.html 与源文件不一致，部署产物已损坏');
console.log('已生成 dist/index.html（' + out.length + ' bytes，与 task-timer-app.html 逐字节一致）');
