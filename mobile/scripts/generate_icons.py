"""Generate native launcher icons from MarmaladePlayer's marmalade-jar identity.
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
# High-contrast marmalade jar + play triangle, aligned to the PWA SVG identity.
d.rounded_rectangle((0,0,1023,1023),radius=232,fill="#25151a")
d.ellipse((135,660,455,905),fill="#73361e")
d.ellipse((570,660,890,905),fill="#73361e")
d.rounded_rectangle((274,290,750,895),radius=134,fill="#bc431e",outline="#ffd483",width=21)
d.rounded_rectangle((306,353,719,850),radius=105,fill="#f38b26")
d.rounded_rectangle((323,372,368,765),radius=22,fill="#ffd67a")
d.rounded_rectangle((292,206,733,337),radius=45,fill="#dfa44f",outline="#fff0ba",width=14)
d.line((339,253,689,253),fill="#fff2c7",width=15)
d.polygon([(438,456),(438,720),(674,588)],fill="#fff8e8")
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
