from PIL import Image
import os

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, "icon-source-rounded-512.png")
dst = os.path.join(here, "taskflow.ico")

Image.open(src).convert("RGBA").save(
    dst, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
)
print("ICO written:", dst, os.path.getsize(dst), "bytes")
