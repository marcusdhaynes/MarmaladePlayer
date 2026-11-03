"""Generate native launcher icons from MarmaladePlayer's marmalade-jar identity.
Run after generating Android/iOS projects; requires Pillow only.
"""
from pathlib import Path
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android/app/src/main/res"
IOS = ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset"
# Decode the exact approved cosmic app artwork from the shared favicon.
import base64
import io
import re
source = (ROOT.parent / "favicon.svg").read_text(encoding="utf-8")
match = re.search(r'data:image/webp;base64,([A-Za-z0-9+/=]+)', source)
if not match:
    raise RuntimeError("Approved cosmic icon missing from favicon.svg")
canvas = Image.open(io.BytesIO(base64.b64decode(match.group(1)))).convert("RGBA")
canvas = canvas.resize((1024, 1024), Image.Resampling.LANCZOS)
def save(path, size, content=canvas):
    path.parent.mkdir(parents=True,exist_ok=True)
    content.resize((size,size),Image.Resampling.LANCZOS).save(path,format="PNG",optimize=True)
if ANDROID.exists():
    sizes={"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}
    for density,sz in sizes.items():
        for name in ["ic_launcher.png","ic_launcher_round.png"]:
            save(ANDROID/("mipmap-"+density)/name,sz)
    # Adaptive Android icon has its own transparent foreground on the
    # orange themed background; remove the default Capacitor foreground.
    foreground=Image.new("RGBA",(432,432),(0,0,0,0))
    mark=canvas.resize((320,320),Image.Resampling.LANCZOS)
    foreground.alpha_composite(mark,((432-276)//2,(432-276)//2))
    for vector in ANDROID.rglob("ic_launcher_foreground.xml"):
        vector.unlink()
    save(ANDROID/"drawable/ic_launcher_foreground.png",432,foreground)
    bg=ANDROID/"values/ic_launcher_background.xml"
    bg.parent.mkdir(parents=True,exist_ok=True)
    bg.write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#25151a</color></resources>\n')
    print("Android launcher icons updated.")
if IOS.exists():
    icon_files=list(IOS.glob("*.png"))
    if not icon_files:
        icon_files=[IOS/"AppIcon-512@2x.png"]
    for icon in icon_files:
        width=1024
        try:
            with Image.open(icon) as sample:
                width=sample.size[0]
        except Exception:
            pass
        save(icon,width)
    print("iOS launcher icons updated.")
