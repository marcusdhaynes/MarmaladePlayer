"""Create native launchers from the approved transparent MarmaladePlayer artwork."""
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
MASTER=ROOT/"assets/marmalade-transparent.png"
if not MASTER.exists():
    from runpy import run_path
    run_path(str(ROOT/"scripts/build_icon_assets.py"))
canvas=Image.open(MASTER).convert("RGBA").resize((1024,1024),Image.Resampling.LANCZOS)
for point in ((0,0),(1023,0),(0,1023),(1023,1023)):
    if canvas.getpixel(point)[3]>8:
        raise RuntimeError("Launcher PNG must have transparent outer corners.")
PURPLE=(62,24,127,255)
ANDROID=ROOT/"mobile/android/app/src/main/res"
IOS=ROOT/"mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset"
def save(path,size,source=canvas):
    path.parent.mkdir(parents=True,exist_ok=True)
    source.resize((size,size),Image.Resampling.LANCZOS).save(path,"PNG",optimize=True)
if ANDROID.exists():
    for density,size in {"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}.items():
        for name in ("ic_launcher.png","ic_launcher_round.png"):
            save(ANDROID/("mipmap-"+density)/name,size)
    foreground=Image.new("RGBA",(432,432),(0,0,0,0))
    mark=canvas.resize((288,288),Image.Resampling.LANCZOS)
    foreground.alpha_composite(mark,(72,72))
    for file in ANDROID.rglob("ic_launcher_foreground.xml"):
        file.unlink()
    save(ANDROID/"drawable/ic_launcher_foreground.png",432,foreground)
    bg=ANDROID/"values/ic_launcher_background.xml"
    bg.parent.mkdir(parents=True,exist_ok=True)
    bg.write_text('<?xml version="1.0" encoding="utf-8"?>\n'
                  '<resources><color name="ic_launcher_background">#3E187F</color></resources>\n',
                  encoding="utf-8")
    print("Android alpha launcher + cosmic-purple adaptive background generated.")
if IOS.exists():
    ios=Image.new("RGBA",(1024,1024),PURPLE)
    ios.alpha_composite(canvas)
    opaque=ios.convert("RGB")
    for path in (list(IOS.glob("*.png")) or [IOS/"AppIcon-512@2x.png"]):
        try:
            with Image.open(path) as previous:size=previous.width
        except Exception:size=1024
        save(path,size,opaque)
    print("iOS opaque purple launcher generated without black corners.")
