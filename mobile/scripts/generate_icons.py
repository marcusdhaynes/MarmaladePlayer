"""Generate launcher icons from the approved cosmic MarmaladePlayer artwork.

The source WebP retains alpha in the corners (no white rectangle).
Android's adaptive foreground is scaled into its safe zone and centered.
iOS gets an opaque full-bleed dark composite because Apple app icons must be opaque.
"""
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets/marmalade-icon.webp"
ANDROID = ROOT / "mobile/android/app/src/main/res"
IOS = ROOT / "mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset"

if not SOURCE.is_file():
    raise RuntimeError("Missing approved MarmaladePlayer icon: " + str(SOURCE))
canvas = Image.open(SOURCE).convert("RGBA").resize((1024,1024), Image.Resampling.LANCZOS)
if canvas.getpixel((0,0))[3] != 0 or canvas.getpixel((1023,0))[3] != 0:
    raise RuntimeError("Icon corners must be transparent")
dark = Image.new("RGBA",canvas.size, (13,7,34,255))
dark.alpha_composite(canvas)
opaque = dark.convert("RGB")

def save(path,size,source=canvas):
    path.parent.mkdir(parents=True,exist_ok=True)
    source.resize((size,size),Image.Resampling.LANCZOS).save(path,format="PNG",optimize=True)

if ANDROID.exists():
    sizes={"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}
    for density, size in sizes.items():
        for name in ("ic_launcher.png","ic_launcher_round.png"):
            save(ANDROID / ("mipmap-"+density) / name,size)
    # Adaptive icon 432x432 foreground uses a centered 288px safe-zone tile.
    foreground=Image.new("RGBA",(432,432),(0,0,0,0))
    mark=canvas.resize((288,288),Image.Resampling.LANCZOS)
    foreground.alpha_composite(mark,((432-288)//2,(432-288)//2))
    for vector in ANDROID.rglob("ic_launcher_foreground.xml"):
        vector.unlink()
    save(ANDROID/"drawable/ic_launcher_foreground.png",432,foreground)
    bg=ANDROID/"values/ic_launcher_background.xml"
    bg.parent.mkdir(parents=True,exist_ok=True)
    bg.write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#0D0722</color></resources>\n',encoding="utf-8")
    print("Android launcher assets created (alpha preserved, adaptive centered).")

if IOS.exists():
    icons=list(IOS.glob("*.png")) or [IOS/"AppIcon-512@2x.png"]
    for icon in icons:
        try:
            with Image.open(icon) as prev: size=prev.width
        except Exception:
            size=1024
        save(icon,size,opaque)
    print("iOS opaque launcher assets created (dark, never white).")
