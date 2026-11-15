# Taskflow 新启动器图标 · 变更报告

日期：2026-11-16 · 来源：`D:/Users/Alfred Liu/Downloads/taskflow-icon-B-pink-hot.svg`

## 1. 源图

```svg
<svg viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#FFFFFF"/>
  <path d="M 753.5 447.3 A 250 250 0 1 1 576.7 270.5"
        fill="none" stroke="#FF3D8B" stroke-width="64" stroke-linecap="round"/>
  <line x1="512" y1="512" x2="608" y2="416" stroke="#FF3D8B"
        stroke-width="40" stroke-linecap="round"/>
  <circle cx="512" cy="512" r="40" fill="#FF3D8B"/>
</svg>
```

白底 + `#FF3D8B` 粉色计时环（右上开口、圆头描边、中心圆点与指针）。原文件已复制为
`icon-source/taskflow-icon-B-pink-hot.svg`，作为后续重建的唯一源。

## 2. 改动清单

| 文件 | 变化 |
|---|---|
| `app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png` | 5 个文件，全部替换为新图标 |
| `app/src/main/res/mipmap-*/ic_launcher_round.png` | 5 个文件，与 `ic_launcher.png` 逐字节相同（沿用旧项目约定） |
| `build-apk.sh` | `APK_NAME=taskflow-v2.6.1.apk`、`--version-code 19`、`--version-name 2.6.1` |
| `icon-source/taskflow-icon-B-pink-hot.svg` | 新增，源 SVG |
| `icon-source/generate-icons.js` | 新增，可复现的图标生成脚本 |
| `icon-source/verify-apk-icons.js` | 新增，APK 内图标逐像素校验 |
| `icon-source/legacy-icons/**` | 新增，旧图标 10 个 PNG 备份 |
| `icon-source/icon-preview-512.png` / `icon-compare.png` | 新增，大图预览与旧→新对比 |
| `icon-source/icon-generate-report.json` / `icon-apk-verify.json` | 新增，生成与校验数据 |

**未改动**：`task-timer-app.html`、`assets/index.html`、所有 Java 源码、`AndroidManifest.xml`、
`res/values*/`、`res/values-night/`、任何交互 / 布局 / 计时 / 数据 / 主题 / 材质代码。
`AndroidManifest.xml` 的 `android:icon` / `android:roundIcon` 引用名保持原样，因此通知里
`Notifications.java:57` 的 `setSmallIcon(R.mipmap.ic_launcher)` 也继续指向同一个资源，零引用改动。

## 3. 生成方式

用 Chromium 把矢量 SVG **按目标像素直接光栅化**（不是先出 1024 大图再降采样），避免 48px
下描边与 `stroke-linecap:round` 的二次插值模糊。每个密度独立渲染，白底来自 SVG 自身的
`<rect>`，不需要额外背景处理。

| 密度 | 尺寸 | 源 PNG | APK 内（aapt2 重压缩后） | 粉色像素占比 | 图形包围盒 |
|---|---|---:|---:|---:|---|
| mdpi | 48×48 | 646 B | 598 B | 8.81% | [11,11,36,36] |
| hdpi | 72×72 | 912 B | 472 B | 9.01% | [16,16,55,55] |
| xhdpi | 96×96 | 1200 B | 608 B | 9.02% | [22,22,73,73] |
| xxhdpi | 144×144 | 1702 B | 871 B | 8.89% | [33,32,111,110] |
| xxxhdpi | 192×192 | 2343 B | 1245 B | 9.07% | [43,43,148,148] |

- 所有密度 100% 不透明，四角纯白；图形包围盒中心与画布中心偏差 ≤0.5px。
- 中心像素 `[255, 61, 139, 255]` = `#FF3D8B`，与源 SVG 一致。
- 10 个源 PNG 总计 **13,606 B**（旧 136,364 B，减少约 120 KB）。

## 4. APK 校验

产物：`dist/taskflow-v2.6.1.apk`，**91,420 B**（上一版 218,396 B），v2 + v3 签名通过。

```
package: name='com.taskflow.app' versionCode='19' versionName='2.6.1'
sdkVersion:'24'   targetSdkVersion:'34'
application-label:'Taskflow'
application-icon-160/240/320/480/640 → res/mipmap-{mdpi..xxxhdpi}-v4/ic_launcher.png
```

APK 内共 10 个图标条目。aapt2 会重压缩 PNG，故**字节不同但像素完全一致**：逐像素比对
10/10 `pixelDiff=0`，尺寸、粉色占比、中心色全部一致（`icon-apk-verify.json`）。
`assets/index.html` 仍为 4178 行，与 `task-timer-app.html` 逐字节一致。

## 5. 回归

| 套件 | 结果 |
|---|---|
| `e2e-taskflow.js` | 157 passed, 0 failed |
| `test-taskflow.js` | 103 passed, 0 failed |
| `e2e-notify.js` | 18 passed, 0 failed |

应用源码未改动，回归用于确认构建链与运行环境未被破坏。

## 6. 说明与可选后续

- **通知小图标**：`Notifications.java` 仍复用 `@mipmap/ic_launcher`。Android 会把 small icon
  渲染成单色剪影，彩色资源在状态栏只显示形状；这是换图标前就存在的行为，本次未改。
  若需让状态栏显示清晰的计时环剪影，可另建一张纯白透明底的 `drawable/ic_stat_notify.png` 并改这一行。
- **未采用 adaptive icon（API 26+）**：加入 `mipmap-anydpi-v26` 会让 `R.mipmap.ic_launcher`
  在 API 26+ 解析为 `AdaptiveIconDrawable`，而 `setSmallIcon()` 不接受该类型，会带来通知回归风险。
  因此保持 legacy PNG 结构，白底方形由启动器按自身形状裁切。
- 白色背景在纯白壁纸上边界不明显；若需要更强的边界感，可在源 SVG 加一圈极浅描边或改浅灰底后
  重跑 `generate-icons.js` + `build-apk.sh`。
