"""Generate app icon for Asset Librarian."""
import os, math
from PIL import Image, ImageDraw

OUT = r"C:\Users\10908\.openclaw\workspace\skills\asset-librarian\ui\build-resources"
os.makedirs(OUT, exist_ok=True)

SIZE = 512
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

cx, cy, r = 256, 256, 230

# Gradient circle background
for y in range(SIZE):
    for x in range(SIZE):
        dx, dy = x - cx, y - cy
        dist = math.sqrt(dx*dx + dy*dy)
        if dist <= r:
            t = dist / r
            rr = int(15 + 140 * (1 - t))
            gg = int(15 + 80 * (1 - t))
            bb = int(30 + 180 * (1 - t))
            img.putpixel((x, y), (rr, gg, bb, 255))

box_color = (200, 220, 255)
# Box body
draw.rectangle([140, 160, 372, 380], outline=box_color, width=8)
# Top lid
draw.line([140, 160, 256, 220, 372, 160], fill=box_color, width=8)
# Middle fold
draw.line([140, 270, 256, 330, 372, 270], fill=box_color, width=6)
# Vertical center
draw.line([256, 220, 256, 380], fill=box_color, width=6)
# Lid shadow
draw.polygon([(140, 160), (256, 220), (372, 160), (256, 140)], fill=(100, 130, 200, 180))
draw.polygon([(140, 160), (256, 220), (372, 160), (256, 140)], outline=(180, 210, 255), width=3)

img.save(os.path.join(OUT, "icon.png"), "PNG")
img.save(os.path.join(OUT, "icon.ico"), "ICO", sizes=[(256, 256)])
# For macOS we keep the .png (electron-builder converts)
img.save(os.path.join(OUT, "icon.icns.png"), "PNG")

print("Icons generated:")
for f in ["icon.png", "icon.ico", "icon.icns.png"]:
    p = os.path.join(OUT, f)
    print(f"  {f}  ({os.path.getsize(p)} bytes)")
