/* 把 vendor/ 里的 KaTeX 与 html2canvas 打成 base64 块，写进 task-timer-app.html 的 VENDOR 标记区。
   目的：公式渲染与试卷 PDF 导出不依赖外部 CDN（断网、CDN 被拦截、file:// 打开时仍可用）。
   用法：node tools/build-vendor-payload.js    改过 vendor/ 必须重跑，随后 node tools/make-site.js 同步三份副本。
   体积策略：JS/CSS 走 gzip+base64（运行时用 DecompressionStream 还原，与应用内已有的 DOCX 解压同一条路径）；
            woff2 字体本身已是压缩格式，直接 base64，运行时以 data: URI 注入 @font-face。 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const KATEX = path.join(ROOT, 'vendor', 'katex');
const FONTS = path.join(KATEX, 'fonts');
const H2C = path.join(ROOT, 'vendor', 'html2canvas', 'html2canvas.min.js');
const HTML = path.join(ROOT, 'task-timer-app.html');
const BEGIN = '<!-- VENDOR:BEGIN';
const END_MARK = '<!-- VENDOR:END -->';
const gzB64 = b => zlib.gzipSync(b, { level: 9 }).toString('base64');

/* @font-face 的字体地址换成 @@font:文件名@@ 占位符，并丢掉 woff/ttf 兜底（本地只带 woff2）。 */
let css = fs.readFileSync(path.join(KATEX, 'katex.min.css'), 'utf8');
const referenced = [];
css = css.replace(/src:url\(fonts\/([A-Za-z0-9_.-]+\.woff2)\) format\("woff2"\)((?:,url\([^)]*\) format\("[a-z]+"\))*)/g,
  function (_m, name) { referenced.push(name); return 'src:url(@@font:' + name + '@@) format("woff2")'; });
if (/url\(fonts\//.test(css)) throw new Error('katex.min.css 里还有未替换的 fonts/ 引用');
const fontFiles = fs.readdirSync(FONTS).filter(f => f.endsWith('.woff2'));
referenced.forEach(function (n) { if (!fontFiles.includes(n)) throw new Error('缺少字体文件 vendor/katex/fonts/' + n); });

const fonts = {};
fontFiles.forEach(function (n) { fonts[n] = fs.readFileSync(path.join(FONTS, n)).toString('base64'); });

const manifest = {
  v: 1,
  katex: '0.16.11',
  html2canvas: '1.4.1',
  katexJs: gzB64(fs.readFileSync(path.join(KATEX, 'katex.min.js'))),
  katexCss: gzB64(Buffer.from(css, 'utf8')),
  h2cJs: gzB64(fs.readFileSync(H2C)),
  fonts: fonts
};
/* 内容只含 base64 与固定键名，不会出现 </script>，可安全内联在 JSON 脚本块里。 */
const json = JSON.stringify(manifest);
if (/<\/script/i.test(json)) throw new Error('内联载荷中出现 </script>，需改用其他编码');
const block = '<script type="application/json" id="tfVendor">' + json + '</script>';

let html = fs.readFileSync(HTML, 'utf8');
const b = html.indexOf(BEGIN), e = html.indexOf(END_MARK);
if (b < 0 || e < 0 || e < b) throw new Error('HTML 中缺少 VENDOR 标记区（' + BEGIN + ' … ' + END_MARK + '）');
const headEnd = html.indexOf('\n', b) + 1;
html = html.slice(0, headEnd) + block + html.slice(e);
fs.writeFileSync(HTML, html);

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log('字体：' + fontFiles.length + ' 个 woff2，被 @font-face 引用 ' + referenced.length + ' 个');
console.log('内联载荷：' + kb(json.length) + '（katexJs ' + kb(manifest.katexJs.length) +
  ' / katexCss ' + kb(manifest.katexCss.length) + ' / h2cJs ' + kb(manifest.h2cJs.length) + ' / fonts ' +
  kb(Object.keys(fonts).reduce((a, k) => a + fonts[k].length, 0)) + '）');
console.log('task-timer-app.html：' + kb(fs.statSync(HTML).size));
