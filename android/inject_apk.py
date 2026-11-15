# -*- coding: utf-8 -*-
"""把 assets/ 与 classes.dex 注入已链接的 base.apk，产出未签名的 merged.apk。

为什么要自己写：Git for Windows 环境常缺 zip.exe，而 APK 本质就是 zip，
用 Python zipfile 可控且彻底避免依赖。dex 必须 STORED（不压缩）或 DEFLATED 均可，
这里沿用 DEFLATED 以减小体积。
"""
import os
import shutil
import sys
import zipfile

BUILD = r"C:\Users\Alfred Liu\android-build\build"
APP = r"C:\Users\Alfred Liu\android-build\app"

base_apk = os.path.join(BUILD, "base.apk")
merged = os.path.join(BUILD, "merged.apk")
dex = os.path.join(BUILD, "dex", "classes.dex")
assets_dir = os.path.join(APP, "src", "main", "assets")

if not os.path.exists(dex):
    print("ERROR: classes.dex 不存在:", dex)
    sys.exit(1)
if not os.path.exists(base_apk):
    print("ERROR: base.apk 不存在:", base_apk)
    sys.exit(1)

# 先复制 base.apk，再以追加模式写入新条目
shutil.copyfile(base_apk, merged)

with zipfile.ZipFile(merged, "a", zipfile.ZIP_DEFLATED) as z:
    existing = set(z.namelist())

    def add(arcname, payload):
        if arcname in existing:
            return False
        z.writestr(arcname, payload, compress_type=zipfile.ZIP_DEFLATED)
        return True

    n_assets = 0
    for root, _dirs, files in os.walk(assets_dir):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, assets_dir).replace("\\", "/")
            with open(full, "rb") as fh:
                if add("assets/" + rel, fh.read()):
                    n_assets += 1
                    print("  + assets/" + rel)

    with open(dex, "rb") as fh:
        if add("classes.dex", fh.read()):
            print("  + classes.dex")

print(f"注入完成：{n_assets} 个 asset，APK {os.path.getsize(merged)/1024:.0f} KB")

# 校验必需条目齐全
with zipfile.ZipFile(merged) as z:
    names = z.namelist()
    need = ["AndroidManifest.xml", "resources.arsc", "classes.dex", "assets/index.html"]
    missing = [n for n in need if n not in names]
    icons = [n for n in names if n.startswith("res/")]
    print("  必需条目:", "全部存在" if not missing else ("缺失 " + str(missing)))
    print("  资源条目:", len(icons), "个")
    if missing:
        sys.exit(1)
