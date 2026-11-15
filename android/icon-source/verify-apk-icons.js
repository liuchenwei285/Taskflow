/* 校验 APK 内图标与源 PNG 像素一致（aapt2 会重压缩 PNG，字节不同属正常） */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('C:/Users/Alfred Liu/WorkBuddy/2026-11-14-23-23-25/ui2/e2e-env/node_modules/playwright');

const ROOT = 'C:/Users/Alfred Liu/android-build';
const APK = path.join(ROOT, 'dist/taskflow-v2.6.1.apk');
const RES = path.join(ROOT, 'app/src/main/res');
const DENS = [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]];

/* 极简 zip 读取：只取 stored/deflate 的本地文件条目 */
function readZip(file) {
  const b = fs.readFileSync(file), out = {};
  for (let i = 0; i < b.length - 4; i++) {
    if (b.readUInt32LE(i) !== 0x04034b50) continue;
    const method = b.readUInt16LE(i + 8);
    const csize = b.readUInt32LE(i + 18);
    const nlen = b.readUInt16LE(i + 26), elen = b.readUInt16LE(i + 28);
    const name = b.toString('utf8', i + 30, i + 30 + nlen);
    const start = i + 30 + nlen + elen;
    if (/ic_launcher.*\.png$/.test(name)) {
      const raw = b.slice(start, start + csize);
      out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    }
  }
  return out;
}
const url = buf => 'data:image/png;base64,' + buf.toString('base64');

(async () => {
  const entries = readZip(APK);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  let allOk = true;
  const rows = [];
  for (const [d, size] of DENS) {
    for (const base of ['ic_launcher.png', 'ic_launcher_round.png']) {
      const key = `res/mipmap-${d}-v4/${base}`;
      const src = fs.readFileSync(path.join(RES, `mipmap-${d}`, base));
      const inApk = entries[key];
      if (!inApk) { rows.push({ d, base, err: 'APK 缺条目' }); allOk = false; continue; }
      const r = await page.evaluate(async ({ a, b }) => {
        const load = async u => { const im = new Image(); im.src = u; await im.decode();
          const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
          const x = c.getContext('2d'); x.drawImage(im, 0, 0);
          return { w: c.width, h: c.height, d: x.getImageData(0,0,c.width,c.height).data }; };
        const A = await load(a), B = await load(b);
        if (A.w !== B.w || A.h !== B.h) return { ok:false, why:'尺寸不同' };
        let diff = 0, maxDelta = 0, pink = 0, center = null;
        for (let p = 0; p < A.d.length; p += 4) {
          const dl = Math.max(Math.abs(A.d[p]-B.d[p]), Math.abs(A.d[p+1]-B.d[p+1]),
                              Math.abs(A.d[p+2]-B.d[p+2]), Math.abs(A.d[p+3]-B.d[p+3]));
          if (dl) { diff++; maxDelta = Math.max(maxDelta, dl); }
          const R=A.d[p], G=A.d[p+1], Bl=A.d[p+2];
          if (R>200 && G<140 && Bl>90 && Bl<200) pink++;
          const idx = p/4, px = idx % A.w, py = Math.floor(idx / A.w);
          if (px === Math.floor(A.w/2) && py === Math.floor(A.h/2)) center = [R,G,Bl,A.d[p+3]];
        }
        return { ok: diff===0, diff, maxDelta, w:A.w, h:A.h,
                 pinkPct:+(pink/(A.w*A.h)*100).toFixed(2), center };
      }, { a: url(src), b: url(inApk) });
      allOk = allOk && r.ok;
      rows.push({ d, base, srcBytes: src.length, apkBytes: inApk.length, ...r });
      console.log(`  mipmap-${d.padEnd(7)} ${base.padEnd(22)} ${r.w}x${r.h}  ` +
        `src=${String(src.length).padStart(4)}B apk=${String(inApk.length).padStart(4)}B  ` +
        `pixelDiff=${r.diff}  pink=${r.pinkPct}%  center=${JSON.stringify(r.center)}  ${r.ok ? 'OK' : 'MISMATCH'}`);
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'icon-source/icon-apk-verify.json'), JSON.stringify({
    apk: path.basename(APK), entries: Object.keys(entries).length, allPixelMatch: allOk, rows
  }, null, 2));
  console.log(allOk ? 'ALL PIXELS MATCH: YES' : 'ALL PIXELS MATCH: NO');
  if (!allOk) process.exit(1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
