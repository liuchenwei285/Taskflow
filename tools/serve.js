/* 极简静态服务器：把 / 映射到仓库根的 task-timer-app.html
   供 E2E 套件与文档素材采集使用（无第三方依赖）。
   用法：node tools/serve.js        # 默认 8899 端口
        PORT=3000 node tools/serve.js */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.md': 'text/markdown; charset=utf-8'
};

function start(port) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/' || rel === '') rel = '/task-timer-app.html';
    const file = path.join(ROOT, path.normalize(rel).replace(/^[/\\]+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 ' + rel);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });
  // 端口已被占用时视为「复用已有实例」，不报错（E2E 套件固定连 8899）
  return new Promise((resolve, reject) => {
    server.once('error', err => {
      if (err && err.code === 'EADDRINUSE') {
        resolve({ reused: true, port, close() {} });
      } else reject(err);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { start, ROOT };

if (require.main === module) {
  const port = Number(process.env.PORT || 8899);
  start(port).then(() =>
    console.log('Taskflow 静态服务器已启动：http://127.0.0.1:' + port + '/  (root=' + ROOT + ')'));
}
