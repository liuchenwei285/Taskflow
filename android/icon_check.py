# -*- coding: utf-8 -*-
"""精确 bitmap launcher icon 校验。

当前图标故意不使用 adaptive foreground/background：用户提供的是完整 RGBA
成品图，必须整张等比例缩放。此脚本逐密度验证：
  1. ic_launcher 与参考图缩放结果逐像素一致
  2. ic_launcher_round 与 ic_launcher 完全一致
  3. alpha 透明边比例与参考图保持一致（不偏移、不裁剪、不放大）
  4. adaptive XML / foreground / background 均不存在
"""

import os
from PIL import Image, ImageChops

SRC = r"C:\Users\Alfred Liu\Desktop\icon_transparent.png"
RES = r"C:\Users\Alfred Liu\android-build\app\src\main\res"
OUT = r"C:\Users\Alfred Liu\android-build\icon-check-exact.png"

DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  — {detail}" if detail else ""))


def alpha_bbox(im):
    # 缩小插值会在透明边生成极低 alpha 的抗锯齿像素；
    # 以 alpha>128 测量有效主体，避免把 1~2 级边缘 halo 算成内容。
    return im.getchannel("A").point(lambda a: 255 if a > 128 else 0).getbbox()


def bbox_scaled(box, src_size, dst_size):
    w, h = src_size
    L, T, R, B = box
    return (round(L * dst_size / w), round(T * dst_size / h),
            round(R * dst_size / w), round(B * dst_size / h))


def main():
    print("=" * 64)
    print(" 精确 bitmap 图标校验")
    print("=" * 64)

    src = Image.open(SRC).convert("RGBA")
    src_bb = alpha_bbox(src)
    print(f"参考图: {src.size}, alpha bbox={src_bb}")

    for folder, size in DENSITIES.items():
        expected = src.resize((size, size), Image.Resampling.LANCZOS)
        path = os.path.join(RES, folder, "ic_launcher.png")
        round_path = os.path.join(RES, folder, "ic_launcher_round.png")
        icon = Image.open(path).convert("RGBA")
        icon_round = Image.open(round_path).convert("RGBA")

        check(f"{folder} ic_launcher 尺寸 {size}x{size}",
              icon.size == (size, size), str(icon.size))
        check(f"{folder} 与参考图缩放结果一致",
              ImageChops.difference(icon, expected).getbbox() is None,
              "整张画布逐像素一致")
        check(f"{folder} roundIcon 与 icon 一致",
              ImageChops.difference(icon, icon_round).getbbox() is None,
              "避免系统位置切换资源后偏移")

        got_bb = alpha_bbox(icon)
        want_bb = bbox_scaled(src_bb, src.size, size)
        check(f"{folder} 透明边比例保持",
              got_bb == want_bb,
              f"got={got_bb}, want={want_bb}")

    # 任何 adaptive 资源都会让 API 26+ 走另一条渲染路径，必须不存在。
    stale = []
    for root, _, files in os.walk(RES):
        for name in files:
            if (name.endswith(".xml") and "mipmap-anydpi-v26" in root) or \
               name in ("ic_launcher_foreground.png", "ic_launcher_background.png"):
                stale.append(os.path.join(root, name))
    check("不存在 adaptive XML/双层残留", not stale, ", ".join(stale))

    # 生成对比预览：参考图、最高密度 icon、roundIcon
    canvas = Image.new("RGBA", (720, 240), (238, 238, 240, 255))
    for i, (label, im) in enumerate((
        ("参考图", src),
        ("xxxhdpi icon", Image.open(os.path.join(RES, "mipmap-xxxhdpi", "ic_launcher.png")).convert("RGBA")),
        ("xxxhdpi roundIcon", Image.open(os.path.join(RES, "mipmap-xxxhdpi", "ic_launcher_round.png")).convert("RGBA")),
    )):
        tile = im.resize((200, 200), Image.Resampling.LANCZOS)
        canvas.alpha_composite(tile, (20 + i * 240, 12))
    canvas.convert("RGB").save(OUT, quality=95)
    print(f"预览: {OUT}")

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print("\n" + "=" * 64)
    print(f"结果：{passed} passed, {total - passed} failed, {total} total")
    print("=" * 64)
    if passed != total:
        for name, ok, detail in results:
            if not ok:
                print(f"  - {name}: {detail}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
