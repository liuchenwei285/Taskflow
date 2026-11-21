/* 学习工作台 阶段 1 E2E：对话内上传/解析/文件卡片/预览/下载/恢复 + 引擎解析矩阵
   DOCX/PPTX 用真实 ZIP+XML 构造；PDF/OCR 库在引擎矩阵里用 setLoader 注入替身（报告已标注）。 */
const { chromium } = require('playwright');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const URL = process.env.TASKFLOW_URL || 'http://127.0.0.1:8899/';
const FILE_URL = 'file:///' + path.join(__dirname, 'task-timer-app.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
const out = [];
const eq = (l, g, w) => { const ok = String(g) === String(w); ok ? pass++ : fail++; out.push(`${ok ? 'PASS' : 'FAIL'}  ${l}${ok ? '' : `\n        got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`); };
const truthy = (l, v) => eq(l, !!v, true);
const includes = (l, hay, needle) => { const ok = String(hay).includes(needle); ok ? pass++ : fail++; out.push(`${ok ? 'PASS' : 'FAIL'}  ${l}${ok ? '' : `\n        "${hay}" missing "${needle}"`}`); };

/* 依赖必须是应用内联资源：正常流程一次 CDN 都不该碰到（本机 CDN 被拦截时原实现会静默退回裸 LaTeX）。 */
const CDN = /cdn\.jsdelivr\.net/;
function offlineCtx(ctx){
  const hits = [];
  ctx.on('request', r => { if (CDN.test(r.url())) hits.push(r.url()); });
  ctx.route(CDN, r => r.abort());
  return hits;
}

/* 出题链路不能受「本机是否跑着后端」影响：统一把 /functions/v1/app/* 判成未部署，
   这样套件始终走直连桩，结果可复现。 */
function noBackend(ctx){
  ctx.route('**/functions/v1/app/**', r => r.fulfill({ status:404, contentType:'application/json',
    body:JSON.stringify({ ok:false, error:{ code:'not_found', retryable:false } }) }));
}

function crc32(buf){ let c=~0; for(let i=0;i<buf.length;i++){ c^=buf[i]; for(let k=0;k<8;k++) c=(c>>>1)^(0xEDB88320&-(c&1)); } return (~c)>>>0; }
function makeZip(entries){
  const locals=[], central=[]; let offset=0;
  for (const [name, contentBuf] of entries){
    const nameB=Buffer.from(name,'utf8'), crc=crc32(contentBuf);
    const lh=Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50,0); lh.writeUInt16LE(20,4); lh.writeUInt32LE(crc,14);
    lh.writeUInt32LE(contentBuf.length,18); lh.writeUInt32LE(contentBuf.length,22); lh.writeUInt16LE(nameB.length,26);
    locals.push(lh,nameB,contentBuf);
    const ch=Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50,0); ch.writeUInt16LE(20,4); ch.writeUInt16LE(20,6);
    ch.writeUInt32LE(crc,16); ch.writeUInt32LE(contentBuf.length,20); ch.writeUInt32LE(contentBuf.length,24);
    ch.writeUInt16LE(nameB.length,28); ch.writeUInt32LE(offset,42);
    central.push(ch,nameB);
    offset+=lh.length+nameB.length+contentBuf.length;
  }
  const cd=Buffer.concat(central), eo=Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50,0); eo.writeUInt16LE(entries.length,8); eo.writeUInt16LE(entries.length,10);
  eo.writeUInt32LE(cd.length,12); eo.writeUInt32LE(offset,16);
  return Buffer.concat([Buffer.concat(locals),cd,eo]);
}
const WNS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function docxFixture(){
  const doc=`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WNS}"><w:body>`+
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 函数</w:t></w:r></w:p>`+
    `<w:p><w:r><w:t>函数是一种映射关系。</w:t></w:r></w:p>`+
    `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`+
    `</w:body></w:document>`;
  return makeZip([['[Content_Types].xml',Buffer.from('<?xml version="1.0"?><Types/>')],['word/document.xml',Buffer.from(doc,'utf8')]]);
}
const ANS='http://schemas.openxmlformats.org/drawingml/2006/main';
const PNS='http://schemas.openxmlformats.org/presentationml/2006/main';
function pptxFixture(){
  const s1=`<?xml version="1.0"?><p:sld xmlns:a="${ANS}" xmlns:p="${PNS}"><p:cSld><p:spTree>`+
    `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Chapter One</a:t></a:r></a:p></p:txBody></p:sp>`+
    `<p:sp><p:txBody><a:p><a:r><a:t>Point alpha</a:t></a:r></a:p></p:txBody></p:sp>`+
    `</p:spTree></p:cSld></p:sld>`;
  return makeZip([['[Content_Types].xml',Buffer.from('<?xml version="1.0"?><Types/>')],['ppt/slides/slide1.xml',Buffer.from(s1,'utf8')]]);
}
const pngBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l6kAAAAASUVORK5CYII=';

(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  const errs = [];
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, locale:'zh-CN' });
  const mainHits = offlineCtx(ctx);
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('__st_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__st_init','1'); } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil:'domcontentloaded' });
  await p.waitForTimeout(500);

  /* 1. 合并后的导航：学习工作台 为首屏，试卷库取代学习工作室 */
  truthy('学习工作台 页面存在', await p.locator('#viewSchedule').count() === 1);
  eq('侧栏五项入口', await p.evaluate(()=>document.querySelectorAll('#sidebar [data-page]').length), 5);
  eq('导航顺序为 编排/任务/统计/试卷库/设置',
    await p.evaluate(()=>Array.from(document.querySelectorAll('#sidebar [data-page]')).map(b=>b.dataset.page).join(',')),
    'schedule,tasks,stats,library,me');
  includes('首项文案为学习工作台', await p.textContent('#sidebar [data-page="schedule"] span'), '学习工作台');
  await p.evaluate(()=>document.querySelector('#sidebar [data-page="library"]').click());
  await p.waitForTimeout(150);
  truthy('可进入试卷库占位页', await p.locator('#viewLibrary').isVisible());
  await p.evaluate(()=>document.querySelector('#sidebar [data-page="schedule"]').click());
  await p.waitForTimeout(150);

  /* 1b. 错误分类：超时必须先判别后端是否就绪，避免误报“请求超时” */
  const cls = await p.evaluate(()=>({
    abortNotReady: window.__aiClassifyError({ name:'AbortError' }, false),
    abortReady: window.__aiClassifyError({ name:'AbortError' }, true),
    codePass: window.__aiClassifyError({ code:'rate_limited' }, true)
  }));
  eq('超时+后端未就绪 → 报未连接', cls.abortNotReady, 'backend_unreachable');
  eq('超时+后端就绪 → 报超时', cls.abortReady, 'ai.err.timeout');
  eq('带错误码原样透传', cls.codePass, 'rate_limited');

  /* 2. 文件头识别（真实字节） */
  const det = await p.evaluate(() => {
    const s = window.__study; const enc = t => new TextEncoder().encode(t).buffer;
    return {
      txt: s.detect('a.txt', enc('hello')).ok, md: s.detect('a.md', enc('# hi')).ok,
      pdf: s.detect('a.pdf', enc('%PDF-1.4\n')).ok,
      docx: s.detect('a.docx', Uint8Array.from([0x50,0x4b,0x03,0x04]).buffer).ok,
      disguised: s.detect('a.png', enc('%PDF-1.4\n')),
      ole: s.detect('a.doc', Uint8Array.from([0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1]).buffer)
    };
  });
  truthy('TXT/MD/PDF/DOCX 文件头识别', det.txt && det.md && det.pdf && det.docx);
  truthy('改扩展名伪装文件被拒', !det.disguised.ok && det.disguised.reason.includes('不符'));
  truthy('旧版 DOC 提示转 DOCX', !det.ole.ok && det.ole.reason.includes('DOCX'));

  /* 3. 引擎解析矩阵 */
  const parsedTxt = await p.evaluate(() => window.__study.parseBuffer(new TextEncoder().encode('段落甲。\n\n段落乙。').buffer, 'notes.txt'));
  eq('TXT 解析成功', parsedTxt.parseStatus, 'ready'); eq('TXT 两节', parsedTxt.sections.length, 2);
  const parsedMd = await p.evaluate(() => window.__study.parseBuffer(new TextEncoder().encode('# 标题\n正文\n## 子节').buffer, 'a.md'));
  truthy('MD 标题层级', parsedMd.sections.some(s=>s.level===1 && s.title==='标题'));
  const parsedDocx = await p.evaluate(b => window.__study.parseBuffer(new Uint8Array(b), '章.docx'), Array.from(docxFixture()));
  eq('DOCX 解析成功', parsedDocx.parseStatus, 'ready');
  includes('DOCX 正文', parsedDocx.content, '函数是一种映射关系');
  includes('DOCX 表格', parsedDocx.content, 'a | b');
  const parsedPptx = await p.evaluate(b => window.__study.parseBuffer(new Uint8Array(b), 's.pptx'), Array.from(pptxFixture()));
  eq('PPTX 解析成功', parsedPptx.parseStatus, 'ready');
  includes('PPTX 标题', parsedPptx.content, 'Chapter One');
  const corrupt = await p.evaluate(() => window.__study.parseBuffer(new Uint8Array([0x50,0x4b,0x03,0x04,0,0,0,0]).buffer, 'broken.docx'));
  eq('损坏 DOCX 标记失败', corrupt.parseStatus, 'error');
  truthy('损坏文件有原因', corrupt.parseWarnings.some(w=>w.length>4));

  /* 4. PDF / OCR 引擎路径（库注入替身，报告中标注 mock） */
  await p.evaluate(() => {
    window.__study.setLoader('pdf', () => ({ getDocument: () => ({ promise: Promise.resolve({ numPages:2, getPage: async n => ({ getTextContent: async () => ({ items:[{str:'PDF page '+n}] }) }) }) }) }));
    window.__study.setLoader('ocr', () => ({ recognize: async () => ({ data:{ text:'识别出的文字' } }) }));
  });
  const parsedPdf = await p.evaluate(b => window.__study.parseBuffer(new Uint8Array(b), 'p.pdf'), Array.from(Buffer.from('%PDF-1.4\nstub','latin1')));
  eq('PDF 解析两页', parsedPdf.pageReferences.length, 2);
  const parsedImg = await p.evaluate(b => window.__study.parseBuffer(new Uint8Array(b), 'n.png'), Array.from(Buffer.from(pngBase64,'base64')));
  includes('图片 OCR 文本', parsedImg.content, '识别出的文字');

  /* 5. 对话内上传 → 文件卡片 → 预览 → 刷新恢复 */
  await p.evaluate(()=>window.__study.clearAll());
  await p.setInputFiles('#studyFiles', [
    { name:'notes.txt', mimeType:'text/plain', buffer:Buffer.from('甲章重点。\n\n乙章重点。','utf8') },
    { name:'outline.md', mimeType:'text/markdown', buffer:Buffer.from('# 大纲\n- 一\n- 二','utf8') },
    { name:'slides.pptx', mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer:pptxFixture() }
  ]);
  await p.waitForTimeout(1500);
  eq('上传后资料数', await p.evaluate(()=>window.__study.list().length), 3);
  truthy('对话内出现文件卡片', (await p.locator('#chatList .file-card').count()) >= 3);
  truthy('卡片显示文件名', (await p.locator('#chatList').textContent()).includes('notes.txt'));
  truthy('就绪卡片有预览下载', (await p.locator('#chatList .file-card [data-file-act="preview"]').count()) >= 1);

  const firstId = await p.evaluate(()=>window.__study.list()[0].documentId);
  await p.evaluate(id => document.querySelector('[data-doc-id="'+id+'"] [data-file-act="preview"]').click(), firstId);
  await p.waitForTimeout(400);
  const modalVisible = await p.evaluate(()=>{ const m=document.getElementById('fileModal'); return m && !m.hidden && document.getElementById('fileModalBody').childNodes.length>0; });
  truthy('点击卡片弹出预览且有内容', modalVisible);
  const modalHost = await p.evaluate(()=>{
    const m = document.getElementById('fileModal');
    const mask = m.querySelector('.file-modal__mask').getBoundingClientRect();
    return { parentBody: m.parentElement === document.body, maskLeft: Math.round(mask.left), maskW: Math.round(mask.width), vw: innerWidth };
  });
  truthy('预览浮层为 body 级（不在 app-shell 内，避免与侧栏错位）', modalHost.parentBody);
  truthy('预览遮罩覆盖整个视口宽度', modalHost.maskLeft === 0 && Math.abs(modalHost.maskW - modalHost.vw) <= 1);
  await p.evaluate(()=>document.getElementById('fileModalClose').click());
  await p.waitForTimeout(150);
  eq('预览可关闭', await p.evaluate(()=>document.getElementById('fileModal').hidden), true);

  /* 6. 刷新后文件卡片恢复 */
  await p.reload({ waitUntil:'domcontentloaded' });
  await p.waitForTimeout(600);
  eq('刷新后资料记录恢复', await p.evaluate(()=>window.__study.list().length), 3);
  truthy('刷新后对话文件卡片恢复', (await p.locator('#chatList .file-card').count()) >= 3);

  /* 7. 不支持格式不进入资料库，但给出错误卡片 */
  const before = await p.evaluate(()=>window.__study.list().length);
  await p.setInputFiles('#studyFiles', [{ name:'virus.exe', mimeType:'application/octet-stream', buffer:Buffer.from('MZ\x90\x00bin') }]);
  await p.waitForTimeout(500);
  eq('不支持格式未入库', await p.evaluate(()=>window.__study.list().length), before);
  truthy('错误卡片出现', (await p.locator('#chatList .file-card[data-status="error"]').count()) >= 1);

  /* 8. 删除资料（API）只移除该条 */
  const delId = await p.evaluate(()=>window.__study.list()[0].documentId);
  await p.evaluate(id => window.__study.remove(id), delId);
  await p.waitForTimeout(200);
  eq('删除单份后剩两份', await p.evaluate(()=>window.__study.list().length), 2);

  await ctx.close();

  /* 9. 桌面：学习工作台 与试卷库导航对齐 */
  const wctx = await browser.newContext({ viewport:{width:1280,height:900}, locale:'zh-CN' });
  noBackend(wctx);
  await wctx.addInitScript(() => { localStorage.clear(); localStorage.setItem('taskflow.welcome.v1', '1'); });
  const wp = await wctx.newPage();
  wp.on('pageerror', e=>errs.push(e.message));
  await wp.goto(URL, { waitUntil:'domcontentloaded' });
  await wp.waitForTimeout(400);
  const wAlign = await wp.evaluate(()=>['schedule','tasks','stats','library'].map(k=>{
    const b=document.querySelector('#sidebar [data-page="'+k+'"]');
    const i=b.querySelector('svg').getBoundingClientRect(), t=b.querySelector('span').getBoundingClientRect();
    return Math.round(b.getBoundingClientRect().left)+':'+Math.round(i.left)+':'+Math.round(t.left);
  }));
  truthy('桌面四项导航（含试卷库）对齐一致：'+JSON.stringify(wAlign), new Set(wAlign).size===1);
  await wctx.close();

  /* 10. 出题 + 公式渲染 + 去重 + 导出（桩模拟 DeepSeek 直连；真实解析/渲染/导出） */
  const gctx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN', acceptDownloads:true });
  noBackend(gctx);
  const genHits = offlineCtx(gctx);
  await gctx.addInitScript(()=>{ if (!sessionStorage.getItem('__gen_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__gen_init','1'); } });
  const genPayload = { title:'极限练习', warnings:[], questions:[
    { type:'single', question:'求极限：$$\\lim_{x\\to 0}\\frac{\\sin 2x}{\\sin 3x}$$', options:['$\\dfrac{2}{3}$','$\\dfrac{3}{2}$'], answer:'A', explanation:'等价无穷小 $\\sin 2x\\sim 2x$', difficulty:'easy' },
    { type:'single', question:'求极限：$$\\lim_{x\\to 0}\\frac{\\sin 2x}{\\sin 3x}$$', options:['$1$'], answer:'A', explanation:'重复', difficulty:'easy' }
  ] };
  let genReq = null;
  await gctx.route('**/chat/completions', async r => { genReq = r.request().postDataJSON(); await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ choices:[{ message:{ content:JSON.stringify(genPayload) } }] }) }); });
  const gp = await gctx.newPage();
  gp.on('pageerror', e => errs.push(e.message));
  await gp.goto(URL, { waitUntil:'domcontentloaded' });
  await gp.waitForTimeout(400);
  await gp.setInputFiles('#studyFiles', [{ name:'重要极限.md', mimeType:'text/markdown', buffer:Buffer.from('# 重要极限\nlim sinx/x=1','utf8') }]);
  await gp.waitForTimeout(900);
  eq('单次上传入库增量=1（无重复监听）', await gp.evaluate(()=>window.__study.list().length), 1);
  await gp.evaluate(()=>{ const k='taskflow.study.documents.v1'; const s=JSON.parse(localStorage.getItem(k)); const base=s.docs[0]; for(let i=0;i<3;i++) s.docs.push(Object.assign({}, base, { documentId: base.documentId + '_' + i })); localStorage.setItem(k, JSON.stringify(s)); });
  eq('元数据存在 4 条同名重复', await gp.evaluate(()=>window.__study.list().length), 4);
  await gp.evaluate(()=>window.__aiTest.setKey('sk-test'));
  await gp.evaluate(()=>window.__studyGen('出一套试卷', { skipConfirm:true }));
  await gp.waitForSelector('.study-set .katex', { timeout:15000 });
  eq('请求按内容去重只发 1 份', JSON.parse(genReq.messages[1].content).docs.length, 1);
  eq('重复题被去重（2→1）', await gp.evaluate(()=>JSON.parse(localStorage.getItem('taskflow.study.sets.v1')).sets[0].questions.length), 1);
  truthy('公式渲染出 KaTeX 节点', (await gp.locator('.study-set .katex').count()) > 0);
  truthy('卡片内无裸 $（已渲染）', !(await gp.evaluate(()=>document.querySelector('.study-set__qs').textContent.includes('$'))));
  eq('KaTeX 来自应用内联资源（本套件全程拦截 CDN）', await gp.evaluate(()=>window.__vendorState.katex), 'local');
  truthy('KaTeX 字体由内联 data URI 加载', await gp.evaluate(async ()=>{
    const faces = Array.from(document.fonts).filter(f => /^KaTeX_/.test(f.family));
    if (!faces.length) return false;
    const ok = await Promise.all(faces.map(f => f.load().then(() => true).catch(() => false)));
    return ok.every(Boolean);
  }));
  const genId = await gp.evaluate(()=>JSON.parse(localStorage.getItem('taskflow.study.sets.v1')).sets[0].id);
  const mdText = await gp.evaluate(id=>window.__studyMarkdown(id), genId);
  truthy('Markdown 内容含答案', String(mdText).includes('答案'));
  const [dlPdf] = await Promise.all([ gp.waitForEvent('download', { timeout:60000 }), gp.evaluate(id=>window.__studyExport(id,'pdf'), genId) ]);
  const pdfBuf = fs.readFileSync(await dlPdf.path());
  eq('导出的 PDF 文件头', pdfBuf.slice(0,5).toString(), '%PDF-');
  truthy('PDF 非空', pdfBuf.length > 2000);
  eq('html2canvas 来自应用内联资源', await gp.evaluate(()=>window.__vendorState.h2c), 'local');
  await gctx.close();

  /* 11. 内联资源与 CDN 都不可用：必须给出可见、可操作的告警，不静默降级 */
  const fctx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN' });
  noBackend(fctx);
  const failHits = offlineCtx(fctx);
  await fctx.addInitScript(()=>{ if (!sessionStorage.getItem('__fail_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__fail_init','1'); } });
  await fctx.route('**/chat/completions', r => r.fulfill({ status:200, contentType:'application/json',
    body:JSON.stringify({ choices:[{ message:{ content:JSON.stringify({ title:'降级检查', warnings:[], questions:[
      { type:'single', question:'求极限：$$\\lim_{x\\to 0}\\frac{\\sin 2x}{\\sin 3x}$$', options:['$1$'], answer:'A', explanation:'x', difficulty:'easy' } ] }) } }] }) }));
  const fp = await fctx.newPage();
  await fp.goto(URL, { waitUntil:'domcontentloaded' });
  await fp.waitForTimeout(400);
  await fp.evaluate(()=>{ const el = document.getElementById('tfVendor'); if (el) el.remove(); });
  await fp.setInputFiles('#studyFiles', [{ name:'降级.md', mimeType:'text/markdown', buffer:Buffer.from('# 降级\nlim','utf8') }]);
  await fp.waitForTimeout(700);
  await fp.evaluate(()=>window.__aiTest.setKey('sk-test'));
  await fp.evaluate(()=>window.__studyGen('出一套试卷', { skipConfirm:true }));
  await fp.waitForSelector('.study-set', { timeout:15000 });
  eq('内联块被移除后标记为失败', await fp.evaluate(()=>window.__vendorState.katex), 'failed');
  eq('降级时不产生 KaTeX 节点', await fp.locator('.study-set .katex').count(), 0);
  truthy('降级时保留原始公式文本（可核对，不丢内容）', (await fp.locator('.study-set__qs').textContent()).includes('\\lim'));
  truthy('降级时弹出可操作告警横幅', await fp.evaluate(()=>{
    const b = document.getElementById('alertBanner');
    return !!b && b.classList.contains('show') && /加载失败/.test(b.textContent);
  }));
  await fctx.close();

  /* 12. 重复上传去重：按「文件名 + 字节数 + SHA-256 内容指纹」判定，卡片不重复、反馈明确 */
  const dctx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN' });
  noBackend(dctx);
  const dupHits = offlineCtx(dctx);
  await dctx.addInitScript(()=>{ if (!sessionStorage.getItem('__dup_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__dup_init','1'); } });
  const dp = await dctx.newPage();
  dp.on('pageerror', e => errs.push(e.message));
  await dp.goto(URL, { waitUntil:'domcontentloaded' });
  await dp.waitForTimeout(500);
  const sameA = Buffer.from('内容甲甲甲甲', 'utf8'), sameB = Buffer.from('内容乙乙乙乙', 'utf8');
  eq('同名不同内容的字节数刻意相同（只能靠指纹区分）', sameB.length, sameA.length);
  const upload = async function(name, buf){
    await dp.setInputFiles('#studyFiles', [{ name:name, mimeType:'text/plain', buffer:buf }]);
    await dp.waitForTimeout(900);
  };
  const docs = () => dp.evaluate(()=>window.__study.list().length);
  const cards = () => dp.locator('#chatList .file-card').count();
  await upload('甲.txt', sameA);
  eq('首次上传：1 份资料 + 1 张卡片', `${await docs()}/${await cards()}`, '1/1');
  await upload('甲.txt', sameA);
  eq('完全相同文件重复上传：资料不增加', await docs(), 1);
  eq('完全相同文件重复上传：卡片不增加', await cards(), 1);
  truthy('重复上传给出复用提示', (await dp.locator('#chatList').textContent()).includes('已复用'));
  await upload('甲.txt', sameB);
  eq('同名同大小不同内容：视为两份资料', await docs(), 2);
  eq('同名同大小不同内容：两张卡片', await cards(), 2);
  await upload('乙.txt', sameA);
  eq('不同文件正常累加', await docs(), 3);
  truthy('每份资料都带 SHA-256 指纹', await dp.evaluate(()=>window.__study.list().every(d => /^sha256:[0-9a-f]{64}$/.test(d.sha256 || ''))));
  await dp.reload({ waitUntil:'domcontentloaded' });
  await dp.waitForTimeout(700);
  eq('刷新后卡片完整恢复', await cards(), 3);
  await upload('甲.txt', sameA);
  eq('刷新后重复上传仍被去重', await docs(), 3);
  eq('刷新后重复上传不新增卡片', await cards(), 3);
  await dctx.close();

  /* 13. 单文件离线：直接以 file:// 打开这一个 HTML，全程拦截 CDN 也能出题、渲染公式、导出 PDF */
  const octx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN', acceptDownloads:true });
  await octx.addInitScript(() => localStorage.setItem('taskflow.welcome.v1', '1'));  // 回访用户起步；首访弹窗见 e2e-welcome.js
  noBackend(octx);
  const offHits = offlineCtx(octx);
  await octx.route('**/chat/completions', r => r.fulfill({ status:200, contentType:'application/json',
    body:JSON.stringify({ choices:[{ message:{ content:JSON.stringify(genPayload) } }] }) }));
  const op = await octx.newPage();
  op.on('pageerror', e => errs.push('file:// ' + e.message));
  await op.goto(FILE_URL, { waitUntil:'domcontentloaded' });
  await op.waitForTimeout(700);
  await op.setInputFiles('#studyFiles', [{ name:'离线.md', mimeType:'text/markdown', buffer:Buffer.from('# 重要极限\nlim sinx/x=1','utf8') }]);
  await op.waitForTimeout(1000);
  await op.evaluate(()=>window.__aiTest.setKey('sk-offline'));
  await op.evaluate(()=>window.__studyGen('出一套试卷', { skipConfirm:true }));
  await op.waitForSelector('.study-set .katex', { timeout:20000 });
  eq('file:// 下 KaTeX 走内联', await op.evaluate(()=>window.__vendorState.katex), 'local');
  truthy('file:// 下公式已渲染', (await op.locator('.study-set .katex').count()) > 0);
  const offId = await op.evaluate(()=>JSON.parse(localStorage.getItem('taskflow.study.sets.v1')).sets[0].id);
  const [dlOff] = await Promise.all([ op.waitForEvent('download', { timeout:60000 }), op.evaluate(i=>window.__studyExport(i,'pdf'), offId) ]);
  const offBuf = fs.readFileSync(await dlOff.path());
  eq('file:// 导出的 PDF 文件头', offBuf.slice(0,5).toString(), '%PDF-');
  truthy('file:// 导出 PDF 非空', offBuf.length > 2000);
  eq('file:// 全程零 CDN 请求：' + JSON.stringify(offHits.slice(0, 2)), offHits.length, 0);
  await octx.close();

  /* 14. AI 出题的三条路径（全部用桩，绝不依赖真实 Key）：
         未接后端 → 明确提示且零请求；上游失败 → 错误卡片 + 可重试；重试成功 → 渲染公式并入库 */
  const mctx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN', acceptDownloads:true });
  noBackend(mctx);
  const mockHits = offlineCtx(mctx);
  await mctx.addInitScript(()=>{ if (!sessionStorage.getItem('__mock_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__mock_init','1'); } });
  let mockCalls = 0;
  await mctx.route('**/chat/completions', async r => {
    mockCalls++;
    if (mockCalls === 1) return r.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({ error:{ message:'upstream down' } }) });
    return r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ choices:[{ message:{ content:JSON.stringify(genPayload) } }] }) });
  });
  const mp = await mctx.newPage();
  mp.on('pageerror', e => errs.push('mock ' + e.message));
  const errCards = () => mp.evaluate(() => document.querySelectorAll('.msg__bubble--err').length);
  const lastErrText = () => mp.evaluate(() => { const e = document.querySelectorAll('.msg__bubble--err'); return e.length ? e[e.length - 1].textContent : ''; });
  const lastErrRetries = () => mp.evaluate(() => { const e = document.querySelectorAll('.msg__bubble--err'); if (!e.length) return -1; const w = e[e.length - 1].closest('.msg'); return w ? w.querySelectorAll('.msg__retry').length : -1; });
  const firstErrRetries = () => mp.evaluate(() => { const e = document.querySelectorAll('.msg__bubble--err'); if (!e.length) return -1; const w = e[0].closest('.msg'); return w ? w.querySelectorAll('.msg__retry').length : -1; });
  await mp.goto(URL, { waitUntil:'domcontentloaded' });
  await mp.waitForTimeout(400);
  await mp.setInputFiles('#studyFiles', [{ name:'mock.md', mimeType:'text/markdown', buffer:Buffer.from('# 极限\nlim sinx/x=1','utf8') }]);
  await mp.waitForTimeout(800);

  // 14a. 没有任何后端/密钥：必须直说「未连接」，且一个请求都不发、一份试卷都不造
  await mp.evaluate(()=>window.__studyGen('出一套试卷', { skipConfirm:true }));
  await mp.waitForTimeout(1500);
  eq('未配置时不发起 AI 请求', mockCalls, 0);
  eq('未配置时错误卡片数', await errCards(), 1);
  includes('未连接提示写明「AI 服务未连接」', await lastErrText(), 'AI 服务未连接');
  truthy('未连接提示给出可操作下一步（填 Key 或开通后端）', /API Key|Sites 后端/.test(await lastErrText()));
  eq('未连接卡片不给重试（配置才是前置条件）', await firstErrRetries(), 0);
  eq('未连接时不伪造试卷', await mp.evaluate(()=>{ try { return JSON.parse(localStorage.getItem('taskflow.study.sets.v1') || '{"sets":[]}').sets.length; } catch(_){ return -1; } }), 0);

  // 14b. 填 Key 后真请求，上游 503 → 失败卡片 + 重试入口，仍不入库
  await mp.evaluate(()=>window.__aiTest.setKey('sk-mock'));
  await mp.evaluate(()=>window.__studyGen('出一套试卷', { skipConfirm:true }));
  await mp.waitForTimeout(2500);
  eq('上游失败时发出 1 次请求', mockCalls, 1);
  includes('失败文案说明服务不可用', await lastErrText(), 'AI 服务暂时不可用');
  eq('失败卡片带 1 个重试按钮', await lastErrRetries(), 1);
  eq('失败时不产生试卷卡片', await mp.locator('.study-set').count(), 0);
  eq('失败时不写入试卷库', await mp.evaluate(()=>{ try { return JSON.parse(localStorage.getItem('taskflow.study.sets.v1') || '{"sets":[]}').sets.length; } catch(_){ return -1; } }), 0);

  // 14c. 点重试 → 桩返回成功 → 公式渲染 + 自动入库 + 试卷库出现条目
  await mp.evaluate(()=>{ const e = document.querySelectorAll('.msg__bubble--err'); e[e.length - 1].closest('.msg').querySelector('.msg__retry').click(); });
  await mp.waitForSelector('.study-set .katex', { timeout:20000 });
  eq('重试补发第二次请求', mockCalls, 2);
  truthy('重试后公式已渲染（KaTeX 节点）', (await mp.locator('.study-set .katex').count()) > 0);
  eq('重试后 KaTeX 仍来自内联资源', await mp.evaluate(()=>window.__vendorState.katex), 'local');
  const mockSets = () => mp.evaluate(()=>{ try { return JSON.parse(localStorage.getItem('taskflow.study.sets.v1')).sets.length; } catch(_){ return -1; } });
  eq('重试成功自动保存到试卷库', await mockSets(), 1);
  await mp.evaluate(()=>document.querySelector('#sidebar [data-page="library"]').click());
  await mp.waitForTimeout(400);
  eq('试卷库列表出现 1 条', await mp.locator('#libraryList .lib-row').count(), 1);
  truthy('试卷库条目带 PNG 导出入口', (await mp.locator('#libraryList .lib-row').first().textContent()).includes('PNG'));
  await mp.evaluate(()=>document.querySelector('#sidebar [data-page="schedule"]').click());
  await mp.waitForTimeout(300);

  // 14d. 同一份试卷重试不会重复入库；PNG 与 PDF 都能导出且字节签名正确
  const mockSetId = await mp.evaluate(()=>JSON.parse(localStorage.getItem('taskflow.study.sets.v1')).sets[0].id);
  const [dlPng] = await Promise.all([ mp.waitForEvent('download', { timeout:60000 }), mp.evaluate(id=>window.__studyExport(id,'png'), mockSetId) ]);
  const pngBuf = fs.readFileSync(await dlPng.path());
  eq('PNG 文件签名', pngBuf.slice(0,8).toString('hex'), '89504e470d0a1a0a');
  truthy('PNG 非空', pngBuf.length > 2000);
  const [dlPdf2] = await Promise.all([ mp.waitForEvent('download', { timeout:60000 }), mp.evaluate(id=>window.__studyExport(id,'pdf'), mockSetId) ]);
  eq('PDF 文件头', fs.readFileSync(await dlPdf2.path()).slice(0,5).toString(), '%PDF-');
  eq('导出未改变入库数量', await mockSets(), 1);
  eq('mock 上下文全程零 CDN 请求', mockHits.length, 0);
  await mctx.close();

  /* 15. 上游 4xx 必须把状态码与原始报错透出来，不能只留一句「暂时不可用」 */
  const xctx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN' });
  noBackend(xctx);
  await xctx.addInitScript(()=>{ if (!sessionStorage.getItem('__http_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__http_init','1'); } });
  await xctx.route('**/chat/completions', r => r.fulfill({ status:400, contentType:'application/json',
    body:JSON.stringify({ error:{ message:'The model `deepseek-flash` does not exist' } }) }));
  const xp = await xctx.newPage();
  xp.on('pageerror', e => errs.push('http ' + e.message));
  await xp.goto(URL, { waitUntil:'domcontentloaded' });
  await xp.waitForTimeout(400);
  await xp.setInputFiles('#studyFiles', [{ name:'http.md', mimeType:'text/markdown', buffer:Buffer.from('# 极限\nlim','utf8') }]);
  await xp.waitForTimeout(800);
  await xp.evaluate(()=>window.__aiTest.setKey('sk-http'));
  await xp.evaluate(()=>window.__studyGen('出一套试卷', { skipConfirm:true }));
  await xp.waitForTimeout(2500);
  const httpErrText = await xp.evaluate(() => { const e = document.querySelectorAll('.msg__bubble--err'); return e.length ? e[e.length-1].textContent : ''; });
  includes('失败卡片带上游状态码', httpErrText, 'HTTP 400');
  includes('失败卡片带上游原始报错', httpErrText, 'does not exist');
  eq('4xx 时不入库', await xp.evaluate(()=>{ try { return JSON.parse(localStorage.getItem('taskflow.study.sets.v1') || '{"sets":[]}').sets.length; } catch(_){ return -1; } }), 0);
  await xctx.close();

  /* 16. 流程顺序：先把试卷做出来，再给任务面板让用户决定是否创建；
         出题失败后的「继续」必须重跑出题，不能掉进任务草稿路径 */
  const flctx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN' });
  noBackend(flctx);
  const flHits = offlineCtx(flctx);
  await flctx.addInitScript(()=>{ if (!sessionStorage.getItem('__flow_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__flow_init','1'); } });
  const flCalls = { study:0, chat:0 };
  await flctx.route('**/chat/completions', async r => {
    const body = r.request().postDataJSON() || {};
    const sys = String((body.messages && body.messages[0] && body.messages[0].content) || '');
    if (/Study Studio/.test(sys)){
      flCalls.study++;
      if (flCalls.study === 1) return r.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({ error:{ message:'upstream down' } }) });
      return r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ choices:[{ message:{ content:JSON.stringify(genPayload) } }] }) });
    }
    flCalls.chat++;
    return r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ choices:[{ message:{ content:JSON.stringify({ reply:'好的', action:'no_change' }) } }] }) });
  });
  const flp = await flctx.newPage();
  flp.on('pageerror', e => errs.push('flow ' + e.message));
  await flp.goto(URL, { waitUntil:'domcontentloaded' });
  await flp.waitForTimeout(500);
  await flp.check('#chatConsent');
  await flp.setInputFiles('#studyFiles', [{ name:'流程.md', mimeType:'text/markdown', buffer:Buffer.from('# 重要极限\nlim sinx/x=1','utf8') }]);
  await flp.waitForTimeout(900);
  await flp.evaluate(()=>window.__aiTest.setKey('sk-flow'));
  const flsend = async (t) => { await flp.fill('#chatInput', t); await flp.click('#btnChatSend'); await flp.waitForTimeout(2600); };
  const flTasks = () => flp.evaluate(()=>{ try { return (JSON.parse(localStorage.getItem('taskflow.tasks.v1') || '{}').tasks || []).length; } catch(_){ return -1; } });
  const flOrder = () => flp.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('#chatList > *'));
    const idx = sel => nodes.findIndex(n => (n.matches && n.matches(sel)) || (n.querySelector && n.querySelector(sel)));
    return { set: idx('.study-set'), draft: idx('.draft-card') };
  });

  await flsend('根据这个笔记出一套试卷，导出 PDF');
  truthy('出题前先给发送确认卡片', await flp.locator('.confirm-card[data-status="pending"]').count() === 1);
  eq('确认之前零 AI 请求', flCalls.study + flCalls.chat, 0);
  await flp.click('.cc-ok');
  await flp.waitForTimeout(2600);
  eq('出卷请求走学习通道', flCalls.study, 1);
  eq('出题失败时不发任务请求', flCalls.chat, 0);
  eq('出题失败时没有任务面板', await flp.locator('.draft-card').count(), 0);
  eq('出题失败时任务库为空', await flTasks(), 0);
  truthy('确认卡片落到已发送态', await flp.locator('.confirm-card[data-status="sent"]').count() === 1);

  await flsend('继续');
  eq('「继续」重跑出题（学习通道第 2 次）', flCalls.study, 2);
  eq('「继续」不得走任务草稿路径', flCalls.chat, 0);
  await flp.waitForSelector('.study-set .katex', { timeout:20000 });
  const flOrd = await flOrder();
  truthy('试卷卡已出现', flOrd.set >= 0);
  truthy('任务面板排在试卷卡之后（got set=' + flOrd.set + ' draft=' + flOrd.draft + '）', flOrd.draft > flOrd.set);
  eq('任务面板只有一张', await flp.locator('.draft-card').count(), 1);
  eq('任务面板为待确认', await flp.locator('.dc-status').textContent(), '待确认');
  eq('出卷后任务仍未创建', await flTasks(), 0);
  const flGrand = await flp.evaluate(()=>JSON.parse(localStorage.getItem('taskflow.study.sets.v1')).sets[0].estimate.grand);
  truthy('草稿标题指向这份试卷', (await flp.inputValue('.dc-title')).includes('极限'));
  eq('草稿时长取试卷预计分钟数', await flp.inputValue('.dc-min'), String(flGrand));
  await flp.click('.dc-ok');
  await flp.waitForTimeout(700);
  eq('确认后才创建 1 个任务', await flTasks(), 1);
  eq('面板状态变为已创建', await flp.locator('.dc-status').textContent(), '已创建');
  eq('学习流程零 CDN 请求', flHits.length, 0);
  await flctx.close();

  /* 17. 有出卷意图但资料未就绪：零请求、不建任务面板，只给可操作提示 */
  const ndctx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN' });
  noBackend(ndctx);
  await ndctx.addInitScript(()=>{ if (!sessionStorage.getItem('__nodocs_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__nodocs_init','1'); } });
  let ndCalls = 0;
  await ndctx.route('**/chat/completions', async r => { ndCalls++; return r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ choices:[{ message:{ content:'{}' } }] }) }); });
  const ndp = await ndctx.newPage();
  ndp.on('pageerror', e => errs.push('nodocs ' + e.message));
  await ndp.goto(URL, { waitUntil:'domcontentloaded' });
  await ndp.waitForTimeout(500);
  await ndp.check('#chatConsent');
  await ndp.evaluate(()=>window.__aiTest.setKey('sk-nodocs'));
  await ndp.fill('#chatInput', '根据笔记出一套试卷');
  await ndp.click('#btnChatSend');
  await ndp.waitForTimeout(1500);
  eq('无资料时零 AI 请求', ndCalls, 0);
  eq('无资料时不建任务面板', await ndp.locator('.draft-card').count(), 0);
  includes('无资料时提示先上传资料', await ndp.evaluate(()=>{ const m = document.querySelectorAll('#chatList .msg'); return m.length ? m[m.length - 1].textContent : ''; }), '上传');
  await ndctx.close();

  /* 18. 错误分类卡片：九类上游故障各自给出原因 + 建议 + 短码（上游全部由路由桩模拟注入，不发真实请求） */
  const ectx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN' });
  noBackend(ectx);
  await ectx.addInitScript(()=>{ if (!sessionStorage.getItem('__err_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__err_init','1'); } });
  await ectx.route('**/functions/v1/app/health', r => r.fulfill({ status:404, contentType:'application/json', body:'{"ok":false}' }));
  let efault = 'ok';
  let eLastBody = null;
  await ectx.route('**/chat/completions', async r => {
    eLastBody = r.request().postDataJSON();
    const wrap = (content, finish) => ({ status:200, contentType:'application/json', body:JSON.stringify({ choices:[{ message:{ content:content }, finish_reason:finish || 'stop' }] }) });
    if (efault === 'slow') return new Promise(() => {});
    if (efault === 'net') return r.abort('failed');
    if (efault === 'down') return r.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({ error:{ message:'Service Unavailable' } }) });
    if (efault === 'auth') return r.fulfill({ status:401, contentType:'application/json', body:JSON.stringify({ error:{ message:'Authentication Fails, Your api key is invalid' } }) });
    if (efault === 'balance') return r.fulfill({ status:400, contentType:'application/json', body:JSON.stringify({ error:{ message:'Insufficient Balance' } }) });
    if (efault === 'badmodel') return r.fulfill({ status:400, contentType:'application/json', body:JSON.stringify({ error:{ message:'The model `deepseek-flash` does not exist' } }) });
    if (efault === 'nonjson') return r.fulfill(wrap('<html>502 Bad Gateway</html>'));
    if (efault === 'trunc') return r.fulfill(wrap('{"title":"半截卷","warnings":[],"questions":[{', 'length'));
    if (efault === 'emptyq') return r.fulfill(wrap(JSON.stringify({ title:'资料太薄', warnings:['材料只有一句话，无法出十道题'], questions:[] })));
    return r.fulfill(wrap(JSON.stringify(genPayload)));
  });
  const ep = await ectx.newPage();
  ep.on('pageerror', e => errs.push('err ' + e.message));
  await ep.goto(URL, { waitUntil:'domcontentloaded' });
  await ep.waitForTimeout(400);
  await ep.setInputFiles('#studyFiles', [{ name:'错误.md', mimeType:'text/markdown', buffer:Buffer.from('# 重要极限\nlim sinx/x=1','utf8') }]);
  await ep.waitForTimeout(800);
  await ep.evaluate(()=>window.__aiTest.setKey('sk-e2e-mock'));
  await ep.evaluate(()=>window.__aiTest.setStudyTimeout(1200));
  const errCard = () => ep.evaluate(()=>{
    const cs = document.querySelectorAll('.err-card'); if (!cs.length) return null;
    const c = cs[cs.length - 1], msg = c.closest('.msg');
    const txt = el => el ? String(el.textContent).trim() : '';
    return { key:c.getAttribute('data-err-key'), line:txt(c.querySelector('.err-line')), hint:txt(c.querySelector('.err-hint')),
      tag:txt(c.querySelector('.err-tag')), detail:txt(c.querySelector('.err-detail')),
      retry:msg ? msg.querySelectorAll('.msg__retry').length : 0, stop:txt(msg.querySelector('.err-stop')) };
  });
  const trigger = async function(fault, wait){
    efault = fault;
    // 每类错误都用新会话：连续失败计数是会话内的，避免上一类的计数影响本类重试按钮
    await ep.evaluate(()=>document.getElementById('btnNewChat').click());
    await ep.waitForTimeout(250);
    await ep.evaluate(()=>window.__studyGen('出一套试卷', { skipConfirm:true }));
    await ep.waitForTimeout(wait || 2000);
    return errCard();
  };
  const checkClass = async function(fault, key, tag, wantRetry){
    const c = await trigger(fault, fault === 'slow' ? 2600 : 2000);
    eq('错误归类 ' + fault + ' → ' + key, c && c.key, key);
    eq('短码 ' + fault, c && c.tag, '#' + tag);
    truthy('一句原因 ' + fault + '：' + (c ? c.line : ''), !!(c && c.line.length > 4));
    truthy('一句建议 ' + fault, !!(c && c.hint.length > 4));
    eq('重试按钮 ' + fault, c && c.retry, wantRetry ? 1 : 0);
    truthy('卡片不泄露密钥 ' + fault, !!(c && !/sk-e2e-mock/.test(c.line + c.hint + c.detail)));
  };
  await checkClass('net', 'ai.err.network', 'NET', true);
  await checkClass('slow', 'ai.err.timeout', 'TMO', true);
  await checkClass('down', 'ai.err.upstream', 'UP', true);
  await checkClass('auth', 'ai.err.auth', 'AUTH', false);
  await checkClass('balance', 'ai.err.balance', 'BAL', false);
  await checkClass('badmodel', 'ai.err.badmodel', 'MODEL', true);
  await checkClass('nonjson', 'ai.err.json', 'JSON', true);
  await checkClass('trunc', 'ai.err.truncated', 'TRUNC', true);
  await checkClass('emptyq', 'ai.err.insufficient', 'DATA', true);
  const beCard = await (async function(){ await ep.evaluate(()=>window.__aiTest.setKey('')); return trigger('ok'); })();
  eq('后端未部署单独成类', beCard && beCard.key, 'ai.err.backend');
  eq('后端未部署短码', beCard && beCard.tag, '#BE');
  truthy('后端未部署给出开通指引', !!(beCard && /Functions|直连/.test(beCard.hint)));
  const truncErr = await trigger('trunc');
  truthy('超时类不再误报网络异常', !/网络异常/.test(truncErr.line));
  truthy('HTTP 状态码进入详情', /HTTP/.test((beCard && beCard.detail) ? beCard.detail : truncErr.detail) || /后端|Functions/.test(beCard.hint));
  await ectx.close();

  /* 19. 发送前确认卡片：确认才发、取消零请求；思考气泡按四阶段推进并在结束时消失 */
  const cctx = await browser.newContext({ viewport:{ width:390, height:844 }, locale:'zh-CN', acceptDownloads:true });
  noBackend(cctx);
  await cctx.addInitScript(()=>{ if (!sessionStorage.getItem('__conf_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__conf_init','1'); } });
  let cCalls = 0;
  await cctx.route('**/chat/completions', async r => {
    cCalls++;
    await new Promise(res => setTimeout(res, 500));
    return r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ choices:[{ message:{ content:JSON.stringify(genPayload) }, finish_reason:'stop' }] }) });
  });
  const cp = await cctx.newPage();
  cp.on('pageerror', e => errs.push('confirm ' + e.message));
  await cp.goto(URL, { waitUntil:'domcontentloaded' });
  await cp.waitForTimeout(400);
  await cp.check('#chatConsent');
  await cp.setInputFiles('#studyFiles', [{ name:'确认卡片.md', mimeType:'text/markdown', buffer:Buffer.from('# 重要极限\nlim sinx/x=1，共两段内容','utf8') }]);
  await cp.waitForTimeout(800);
  await cp.evaluate(()=>window.__aiTest.setKey('sk-confirm'));
  const csend = async (t) => { await cp.fill('#chatInput', t); await cp.click('#btnChatSend'); await cp.waitForTimeout(600); };
  await csend('根据这份笔记出一套试卷');
  const ccInfo = await cp.evaluate(()=>{
    const c = document.querySelector('.confirm-card'); if (!c) return null;
    return { status:c.getAttribute('data-status'), text:c.textContent, rows:c.querySelectorAll('.cc-list li').length,
      ok:!!c.querySelector('.cc-ok'), no:!!c.querySelector('.cc-no') };
  });
  truthy('出现发送确认卡片', !!ccInfo);
  eq('卡片为待确认态', ccInfo.status, 'pending');
  eq('卡片列出 4 项内容', ccInfo.rows, 4);
  truthy('卡片显示文件名', ccInfo.text.includes('确认卡片.md'));
  truthy('卡片显示字数', /字/.test(ccInfo.text));
  truthy('卡片显示原话要求', ccInfo.text.includes('根据这份笔记出一套试卷'));
  eq('确认之前零 AI 请求', cCalls, 0);
  await cp.click('.cc-no');
  await cp.waitForTimeout(500);
  eq('取消后仍是零 AI 请求', cCalls, 0);
  eq('取消后卡片落终态', await cp.locator('.confirm-card').getAttribute('data-status'), 'cancelled');
  truthy('取消后给出未发送说明', (await cp.locator('.confirm-card').textContent()).includes('未发送'));
  eq('取消后没有试卷', await cp.locator('.study-set').count(), 0);
  eq('取消后没有任务面板', await cp.locator('.draft-card').count(), 0);
  await cp.evaluate(()=>{
    window.__stages = [];
    const rec = () => { const n = document.querySelector('.thinking-stage'); if (n){ const t = String(n.textContent).trim(); const a = window.__stages; if (!a.length || a[a.length-1] !== t) a.push(t); } };
    rec();
    window.__stageObs = new MutationObserver(rec);
    window.__stageObs.observe(document.getElementById('chatList'), { childList:true, subtree:true, characterData:true });
  });
  await csend('再出一份试卷');
  await cp.click('.cc-ok');
  await cp.waitForSelector('.study-set', { timeout:30000 });
  /* 试卷卡先出现，PDF 产物与其后的收尾渲染可能更慢：等「思考气泡消失」这一条件本身，
     而不是赌一个固定等待时长（断言不变，仍要求完成后气泡数为 0） */
  await cp.waitForFunction(() => document.querySelectorAll('.thinking-stage').length === 0, null, { timeout:30000 });
  eq('确认后发出 1 次请求', cCalls, 1);
  const stages = await cp.evaluate(()=>window.__stages);
  const stageIdx = k => stages.findIndex(s => s.includes(k));
  truthy('阶段按序出现：' + JSON.stringify(stages),
    ['读取资料', '生成题目', '校验', '生成 PDF'].every(k => stageIdx(k) >= 0) &&
    ['读取资料', '生成题目', '校验', '生成 PDF'].every((k, i, arr) => i === 0 || stageIdx(arr[i-1]) < stageIdx(k)));
  eq('完成后思考气泡消失', await cp.locator('.thinking-stage').count(), 0);
  truthy('阶段气泡带进度编号', /1\/4|4\/4/.test(stages.join(' ')));
  await cp.evaluate(()=>window.__stageObs.disconnect());
  /* 中途取消：点思考气泡上的「取消」，请求被中止，气泡落到明确状态且不产出试卷 */
  await cctx.unroute('**/chat/completions');
  await cctx.route('**/chat/completions', async r => { cCalls++; await new Promise(res => setTimeout(res, 20000)); return r.fulfill({ status:200, contentType:'application/json', body:'{}' }); });
  await csend('取消这一份，出题');
  await cp.click('.cc-ok');
  await cp.waitForSelector('.msg__cancel', { timeout:8000 });
  await cp.waitForTimeout(600);   // 等请求真正发出并计入桩计数，再点取消
  const callsBeforeCancel = cCalls;
  truthy('取消前请求已在途（' + callsBeforeCancel + '）', callsBeforeCancel >= 1);
  await cp.click('.msg__cancel');
  await cp.waitForTimeout(1500);
  eq('取消后思考气泡消失', await cp.locator('.thinking-stage').count(), 0);
  truthy('取消后给出明确状态', (await cp.evaluate(()=>document.getElementById('chatList').innerText)).includes('已取消出题'));
  eq('取消不产出新试卷', await cp.locator('.study-set').count(), 1);
  eq('取消后不再补发请求', cCalls, callsBeforeCancel);
  /* 失败路径：气泡必须停下，不能一直转圈 */
  await cctx.unroute('**/chat/completions');
  await cctx.route('**/chat/completions', r => r.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({ error:{ message:'upstream down' } }) }));
  await csend('失败也要有明确状态，出题');
  await cp.click('.cc-ok');
  await cp.waitForSelector('.err-card', { timeout:20000 });
  eq('失败后思考气泡消失', await cp.locator('.thinking-stage').count(), 0);
  eq('失败后试卷数量不变（仍是上一次那份）', await cp.locator('.study-set').count(), 1);
  await cctx.close();

  /* 20. 重试：保留输入与已上传文件，连续失败后停用按钮（上游用桩持续返回 503） */
  const rctx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN' });
  noBackend(rctx);
  await rctx.addInitScript(()=>{ if (!sessionStorage.getItem('__retry_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__retry_init','1'); } });
  let rCalls = 0, rBodies = [];
  await rctx.route('**/chat/completions', async r => {
    rCalls++; rBodies.push(r.request().postDataJSON());
    return r.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({ error:{ message:'Service Unavailable' } }) });
  });
  const rp = await rctx.newPage();
  rp.on('pageerror', e => errs.push('retry ' + e.message));
  await rp.goto(URL, { waitUntil:'domcontentloaded' });
  await rp.waitForTimeout(400);
  await rp.setInputFiles('#studyFiles', [{ name:'重试.md', mimeType:'text/markdown', buffer:Buffer.from('# 重要极限\nlim sinx/x=1','utf8') }]);
  await rp.waitForTimeout(800);
  await rp.evaluate(()=>window.__aiTest.setKey('sk-retry'));
  await rp.evaluate(()=>window.__studyGen('出一套试卷', { skipConfirm:true }));
  await rp.waitForSelector('.msg__retry', { timeout:15000 });
  eq('首次失败带重试按钮', await rp.locator('.msg__retry').count(), 1);
  eq('首次按钮无次数', await rp.locator('.msg__retry').last().textContent(), '重试');
  for (let i = 1; i <= 3; i++){
    await rp.locator('.msg__retry').last().click();
    await rp.waitForTimeout(1500);
  }
  eq('三次重试后共 4 次请求', rCalls, 4);
  truthy('按钮文案带次数：' + (await rp.locator('.msg__retry').nth(1).textContent()), /第 2\/3 次/.test(await rp.locator('.msg__retry').nth(1).textContent()));
  const lastMsg = rp.locator('.msg').last();
  eq('连续失败后重试按钮停用', await lastMsg.locator('.msg__retry').count(), 0);
  truthy('停用后给出提示', /已连续失败/.test(await lastMsg.textContent()));
  const keptDocs = rBodies[rBodies.length - 1];
  truthy('重试仍带原文（无需重新上传）', JSON.stringify(keptDocs).includes('lim sinx/x=1'));
  truthy('重试仍带原要求（无需重新输入）', JSON.stringify(keptDocs).includes('出一套试卷'));
  eq('重试期间资料未重复入库', await rp.evaluate(()=>window.__study.list().length), 1);
  await rctx.close();

  /* 21. PDF 交付：真实生成、对话内文件卡片、可预览可下载（下载文件即浏览器收到的字节） */
  const pctx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN', acceptDownloads:true });
  noBackend(pctx);
  await pctx.addInitScript(()=>{ if (!sessionStorage.getItem('__pdf_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__pdf_init','1'); } });
  await pctx.route('**/chat/completions', r => r.fulfill({ status:200, contentType:'application/json',
    body:JSON.stringify({ choices:[{ message:{ content:JSON.stringify(genPayload) }, finish_reason:'stop' }] }) }));
  const pp = await pctx.newPage();
  pp.on('pageerror', e => errs.push('pdf ' + e.message));
  await pp.goto(URL, { waitUntil:'domcontentloaded' });
  await pp.waitForTimeout(400);
  await pp.check('#chatConsent');
  await pp.setInputFiles('#studyFiles', [{ name:'交付.md', mimeType:'text/markdown', buffer:Buffer.from('# 重要极限\nlim sinx/x=1','utf8') }]);
  await pp.waitForTimeout(800);
  await pp.evaluate(()=>window.__aiTest.setKey('sk-pdf'));
  await pp.evaluate(()=>window.__studyGen('出一套试卷', { skipConfirm:true }));
  await pp.waitForSelector('.file-card--pdf[data-status="ready"]', { timeout:40000 });
  const pdfCard = await pp.evaluate(()=>{
    const c = document.querySelector('.file-card--pdf');
    return { sub:c.querySelector('.file-card__sub').textContent, acts:Array.from(c.querySelectorAll('button')).map(b => b.textContent.trim()) };
  });
  truthy('卡片标注页数与大小：' + pdfCard.sub, /页/.test(pdfCard.sub) && /KB|B/.test(pdfCard.sub));
  truthy('卡片提供预览与下载', pdfCard.acts.includes('预览') && /下载 PDF/.test(pdfCard.acts.join('')));
  await pp.click('.file-card--pdf .pdf-preview');
  await pp.waitForTimeout(1200);
  const pv = await pp.evaluate(()=>{
    const m = document.getElementById('fileModal');
    const imgs = Array.from(document.querySelectorAll('#fileModalBody .pdf-page'));
    return { open:!!m && !m.hidden, n:imgs.length, first:imgs[0] ? imgs[0].src.slice(0, 22) : '', title:(document.getElementById('fileModalTitle') || {}).textContent || '' };
  });
  truthy('预览浮层打开', pv.open);
  truthy('预览渲染真实页面（' + pv.n + ' 页）', pv.n >= 1);
  eq('预览页为位图数据', pv.first, 'data:image/jpeg;base64');
  await pp.evaluate(()=>{ const m = document.getElementById('fileModal'); const b = m && m.querySelector('.file-modal__head button'); if (b) b.click(); });
  const [dl] = await Promise.all([ pp.waitForEvent('download', { timeout:60000 }), pp.click('.file-card--pdf .pdf-download') ]);
  const dlBuf = fs.readFileSync(await dl.path());
  eq('下载的 PDF 文件头', dlBuf.slice(0, 5).toString(), '%PDF-');
  truthy('下载的 PDF 非空（' + dlBuf.length + ' 字节）', dlBuf.length > 2000);
  const pageCount = (dlBuf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  eq('PDF 页数与卡片一致：' + pageCount, String(pageCount), pdfCard.sub.split(' ')[0]);
  await pctx.close();

  /* 22. 英文出卷意图：同样进入「先确认再发送」的学习通道，普通任务请求不受影响 */
  const lctx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'en-US' });
  noBackend(lctx);
  await lctx.addInitScript(()=>{ if (!sessionStorage.getItem('__lang_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__lang_init','1'); } });
  let lCalls = 0;
  await lctx.route('**/chat/completions', async r => {
    lCalls++;
    const sys = String((r.request().postDataJSON().messages || [])[0].content || '');
    const body = /Study Studio/.test(sys)
      ? JSON.stringify({ title:'Limits practice', warnings:[], questions:[{ type:'single', question:'q', options:['a','b'], answer:'A', explanation:'e', difficulty:'easy' }] })
      : JSON.stringify({ reply:'ok', action:'generate_draft', draft:{ title:'Submit homework', desc:'', dueAt:null, priority:'medium', estimatedMinutes:30 } });
    return r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ choices:[{ message:{ content:body } }] }) });
  });
  const lp = await lctx.newPage();
  lp.on('pageerror', e => errs.push('en ' + e.message));
  await lp.goto(URL, { waitUntil:'domcontentloaded' });
  await lp.waitForTimeout(500);
  await lp.check('#chatConsent');
  await lp.setInputFiles('#studyFiles', [{ name:'limits.md', mimeType:'text/markdown', buffer:Buffer.from('# Limits\nlim sinx/x=1','utf8') }]);
  await lp.waitForTimeout(800);
  await lp.evaluate(()=>window.__aiTest.setKey('sk-en'));
  await lp.fill('#chatInput', 'Generate 5 questions from this note');
  await lp.click('#btnChatSend');
  await lp.waitForTimeout(800);
  eq('英文出卷请求给出确认卡片', await lp.locator('.confirm-card').count(), 1);
  eq('确认前零请求', lCalls, 0);
  includes('卡片文案为英文', await lp.locator('.confirm-card .cc-title').textContent(), 'sent to the AI');
  await lp.click('.cc-no');
  await lp.fill('#chatInput', 'Remind me to submit the homework by Friday');
  await lp.click('#btnChatSend');
  await lp.waitForTimeout(1500);
  eq('普通任务请求不误入出卷通道', await lp.locator('.confirm-card[data-status="pending"]').count(), 0);
  eq('普通任务请求走草稿路径', await lp.locator('.draft-card').count(), 1);
  await lctx.close();

  /* 23. 题量一致性：用户句子里写明的题量，必须同时体现在确认卡片和实际发出的请求里（上游用桩，只验参数） */
  const qctx = await browser.newContext({ viewport:{ width:1000, height:800 }, locale:'zh-CN' });
  noBackend(qctx);
  await qctx.addInitScript(()=>{ if (!sessionStorage.getItem('__qty_init')){ localStorage.clear();localStorage.setItem('taskflow.welcome.v1', '1'); sessionStorage.setItem('__qty_init','1'); } });
  let qUser = [];
  await qctx.route('**/chat/completions', async r => {
    const pj = r.request().postDataJSON();
    qUser.push(String((pj.messages || [])[1] && pj.messages[1].content || ''));
    return r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ choices:[{ message:{ content:JSON.stringify(genPayload) }, finish_reason:'stop' }] }) });
  });
  const qp = await qctx.newPage();
  qp.on('pageerror', e => errs.push('qty ' + e.message));
  await qp.goto(URL, { waitUntil:'domcontentloaded' });
  await qp.waitForTimeout(400);
  await qp.check('#chatConsent');
  await qp.setInputFiles('#studyFiles', [{ name:'题量.md', mimeType:'text/markdown', buffer:Buffer.from('# 重要极限\nlim sinx/x=1，另有等价无穷小替换与三个例题','utf8') }]);
  await qp.waitForTimeout(800);
  await qp.evaluate(()=>window.__aiTest.setKey('sk-qty'));
  const qtyAsk = async (t) => {
    await qp.fill('#chatInput', t); await qp.click('#btnChatSend'); await qp.waitForTimeout(700);
    eq('出卷句式命中学习通道', await qp.locator('.confirm-card[data-status="pending"]').count(), 1);
    return qp.evaluate(()=>{ const c = document.querySelector('.confirm-card[data-status="pending"]'); return c ? String(c.textContent).replace(/\s+/g, ' ') : ''; });
  };
  const c5 = await qtyAsk('根据这份笔记出一套 5 道题的试卷');
  truthy('句子里的 5 道题显示在卡片：' + (c5.match(/题量[^0-9]*\d+ ?道/) || ['未命中'])[0], /题量\D{0,2}5\D{0,2}道/.test(c5));
  await qp.click('.cc-ok');
  await qp.waitForSelector('.study-set', { timeout:25000 });
  truthy('实际请求带 count:5', /"count":5/.test(qUser[qUser.length - 1] || ''), (qUser[qUser.length - 1] || '').slice(0, 60));
  await qp.evaluate(()=>document.getElementById('btnNewChat').click());
  await qp.waitForTimeout(300);
  const c10 = await qtyAsk('根据这份笔记出一套试卷，重点看第三题');
  truthy('句中没有题量时用面板默认 10 道：' + (c10.match(/题量[^0-9]*\d+ ?道/) || ['未命中'])[0], /题量\D{0,2}10\D{0,2}道/.test(c10));
  await qp.evaluate(()=>document.getElementById('btnNewChat').click());
  await qp.waitForTimeout(300);
  const cBig = await qtyAsk('根据这份笔记出一套 50 道题的试卷');
  truthy('超出上限的题量被夹到 20 道：' + (cBig.match(/题量[^0-9]*\d+ ?道/) || ['未命中'])[0], /题量\D{0,2}20\D{0,2}道/.test(cBig));
  await qctx.close();

  const normalHits = mainHits.concat(genHits, dupHits);
  truthy('正常流程零 CDN 请求（KaTeX/html2canvas 走内联）：' + JSON.stringify(normalHits.slice(0, 2)), normalHits.length === 0);
  truthy('内联块缺失时才回落 CDN（降级上下文命中 ' + failHits.length + ' 次）', failHits.some(u => /katex[.]min[.]js/.test(u)) && failHits.some(u => /katex[.]min[.]css/.test(u)));
  truthy('无页面脚本错误', errs.length===0);
  if (errs.length) out.push('        errors: ' + errs.join(' | '));
  console.log(out.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e=>{ console.error('FATAL', e); process.exit(1); });
