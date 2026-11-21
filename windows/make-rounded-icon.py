from PIL import Image, ImageDraw

src = "C:/Users/Alfred Liu/Documents/Qoder/2026-11-16/700baae9/Taskflow/android/icon-source/icon-preview-512.png"
dst = "C:/Users/Alfred Liu/Documents/Qoder/2026-11-16/700baae9/Taskflow/windows/icon-source-rounded-512.png"

im = Image.open(src).convert("RGBA")
mask = Image.new("L", im.size, 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], radius=112, fill=255)
im.putalpha(mask)
im.save(dst)
print("saved:", dst, im.size)
