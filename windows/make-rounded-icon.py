from PIL import Image, ImageDraw

src = "C:/Users/Alfred Liu/Documents/Qoder/2026-11-16/700baae9/Taskflow/android/icon-source/icon-preview-512.png"
dst = "C:/Users/Alfred Liu/Documents/Qoder/2026-11-16/700baae9/Taskflow/windows/icon-source-rounded-512.png"

orig = Image.open(src).convert("RGBA")
# 原图是透明底粉时钟；铺到白底上，再裁成圆角（白色圆角方块 + 粉色时钟）
base = Image.new("RGBA", orig.size, (255, 255, 255, 255))
base.alpha_composite(orig)
mask = Image.new("L", orig.size, 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, orig.width - 1, orig.height - 1], radius=112, fill=255)
base.putalpha(mask)
base.save(dst)
print("saved white rounded:", dst, base.size)
