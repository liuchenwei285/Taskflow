from PIL import Image, ImageDraw

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

pink = (255, 61, 139, 255)
white = (255, 255, 255, 255)

# 圆角方块底
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=112, fill=pink)

# 时钟环（右侧留缺口，与原 SVG 一致）
d.arc([131, 131, 381, 381], start=-15, end=285, fill=white, width=32)
# 圆头端点
for cx, cy in [(376.75, 223.65), (288.35, 135.25)]:
    d.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], fill=white)

# 指针 + 中心圆点
d.line([(256, 256), (304, 208)], fill=white, width=20)
d.ellipse([236, 236, 276, 276], fill=white)

img.save("C:/Users/Alfred Liu/Documents/Qoder/2026-11-16/700baae9/Taskflow/windows/icon-source-rounded-512.png")
print("saved rounded icon 512x512")
