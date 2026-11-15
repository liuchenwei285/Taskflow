# -*- coding: utf-8 -*-
"""生成与用户参考图完全一致的 Android launcher bitmap 图标。

重要设计：参考图已经是「完整成品图」且四周透明，不能再拆成 adaptive
foreground/background。Android 26+ 若存在 mipmap-anydpi-v26 XML，会把
foreground 按系统安全区再次缩放/裁切，正是此前真机出现图标偏移和局部放大的根因。

本脚本因此只生成完整 RGBA bitmap，并让 android:icon 与 android:roundIcon
在全部密度下指向同一视觉内容；构建前会移除 adaptive XML，避免系统走双层图标路径。
"""

import os
from PIL import Image

SRC = r"C:\Users\Alfred Liu\Desktop\icon_transparent.png"
RES = r"C:\Users\Alfred Liu\android-build\app\src\main\res"
ROOT = r"C:\Users\Alfred Liu\android-build"

DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def main():
    if not os.path.exists(SRC):
        raise SystemExit(f"参考图不存在: {SRC}")

    src = Image.open(SRC).convert("RGBA")
    alpha = src.getchannel("A")
    if alpha.getextrema() != (0, 255):
        raise SystemExit(f"参考图必须包含完整透明背景，当前 alpha={alpha.getextrema()}")

    bbox = alpha.getbbox()
    if bbox is None:
        raise SystemExit("参考图完全透明")

    print(f"参考图: {SRC}")
    print(f"  画布: {src.width}x{src.height}")
    print(f"  非透明 bbox: {bbox}  ({bbox[2]-bbox[0]}x{bbox[3]-bbox[1]})")
    print(f"  四周透明边: 左{bbox[0]} 上{bbox[1]} 右{src.width-bbox[2]} 下{src.height-bbox[3]}")

    # 核心：缩放整张画布，而不是裁紧 bbox。
    # 这样透明留白、圆角底板、日历/秒表相对位置全部按参考图保留。
    for folder, size in DENSITIES.items():
        out_dir = os.path.join(RES, folder)
        os.makedirs(out_dir, exist_ok=True)
        icon = src.resize((size, size), Image.Resampling.LANCZOS)
        icon.save(os.path.join(out_dir, "ic_launcher.png"), optimize=True)
        # roundIcon 也使用同一张完整图，避免桌面/应用列表选择不同资源后偏移。
        icon.save(os.path.join(out_dir, "ic_launcher_round.png"), optimize=True)
        # 清理上一版 adaptive 双层残留，避免资源目录继续携带错误素材。
        for stale in ("ic_launcher_foreground.png", "ic_launcher_background.png"):
            stale_path = os.path.join(out_dir, stale)
            if os.path.exists(stale_path):
                os.remove(stale_path)
        print(f"  {folder}: {size}x{size} ic_launcher + ic_launcher_round")

    # 自适应 XML 必须不存在，否则 Android 26+ 会优先解析它而不是 bitmap。
    adaptive_dir = os.path.join(RES, "mipmap-anydpi-v26")
    removed = []
    if os.path.isdir(adaptive_dir):
        for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
            path = os.path.join(adaptive_dir, name)
            if os.path.exists(path):
                os.remove(path)
                removed.append(path)
        # 空目录不影响构建；保留目录可避免误把其它资源删掉。
    print(f"  已移除 adaptive XML: {len(removed)} 个")

    # 生成一个可视预览：保留参考图的透明边，白底仅用于查看。
    preview = Image.new("RGBA", src.size, (255, 255, 255, 255))
    preview.alpha_composite(src)
    preview.save(os.path.join(ROOT, "app-icon-512.png"), optimize=True)

    print("完成：完整 bitmap 模式，不使用 adaptive foreground/background")


if __name__ == "__main__":
    main()
