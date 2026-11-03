"""Export the same approved transparent icon as a PNG for Tauri icon bundling."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[2]
src = root / "assets/marmalade-icon.webp"
target = root / "assets/marmalade-desktop-icon.png"
icon = Image.open(src).convert("RGBA").resize((1024,1024),Image.Resampling.LANCZOS)
if icon.getpixel((0,0))[3]!=0:
    raise RuntimeError("The approved icon must have transparent outer corners")
icon.save(target,format="PNG",optimize=True)
print("Prepared Windows ICO, macOS ICNS and Linux PNG source:",target)
