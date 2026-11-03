"""Generate native launcher icons from MarmaladePlayer's orange/citrus identity.
Run after generating Android/iOS projects; requires Pillow only.
"""
from pathlib import Path
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android/app/src/main/res"
IOS = ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset"
S=1024
canvas=Image.new("RGBA",(S,S),(0,0,0,0))
d=ImageDraw.Draw(canvas)
# Match favicon.svg: orange rounded tile, golden wheel, ivory spokes.
d.rounded_rectangle((12,12,1012,1012), radius=250, fill="#ffa348")
d.ellipse((160,160,864,864), fill="#ffbd67")
d.ellipse((240,240,784,784),outline="#fff0d6",width=32)
for pts in [[(512,165),(512,859)],[(165,512),(859,512)],
            [(300,300),(724,724)],[(724,300),(300,724)]]:
    d.line(pts,fill="#fff0d6",width=43)
d.ellipse((447,447,577,577),fill="#76452a")
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
    mark=canvas.resize((276,276),Image.Resampling.LANCZOS)
    foreground.alpha_composite(mark,((432-276)//2,(432-276)//2))
    for vector in ANDROID.rglob("ic_launcher_foreground.xml"):
        vector.unlink()
    save(ANDROID/"drawable/ic_launcher_foreground.png",432,foreground)
    bg=ANDROID/"values/ic_launcher_background.xml"
    bg.parent.mkdir(parents=True,exist_ok=True)
    bg.write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#ffa348</color></resources>\n')
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
