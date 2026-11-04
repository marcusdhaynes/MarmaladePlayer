"""Export approved opaque full-bleed artwork for Windows/macOS/Linux packaging."""
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
src=ROOT/"assets/marmalade-transparent.png"
if not src.exists():
    from runpy import run_path
    run_path(str(ROOT/"scripts/build_icon_assets.py"))
image=Image.open(src).convert("RGBA")
for p in ((0,0),(image.width-1,0),(0,image.height-1),(image.width-1,image.height-1)):
    if image.getpixel(p)[3]!=255:raise RuntimeError("Transparent corner in full-bleed app icon")
dest=ROOT/"assets/marmalade-desktop-icon.png"
image.resize((1024,1024),Image.Resampling.LANCZOS).save(dest,"PNG",optimize=True)
print("Desktop full-bleed icon ready:",dest)
