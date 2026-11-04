"""Build all MarmaladePlayer icons from the approved full-bleed artwork.

Do not round, erase or make outer corners transparent. Browsers and operating
systems apply their own mask shapes; artwork must extend beneath the cutout.
"""
from base64 import b64encode
from hashlib import sha256
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "approved-fullbleed-icon.webp"
EXPECTED_SHA256 = "da82db3a4f6f5525eb8ad947af8df1ee03f0905a6a9b7c4a12704ef5f67d649b"
if not SOURCE.is_file():
    raise SystemExit(f"Missing approved icon source: {SOURCE}")
actual_sha = sha256(SOURCE.read_bytes()).hexdigest()
if actual_sha != EXPECTED_SHA256:
    raise SystemExit(f"Approved artwork checksum mismatch: {actual_sha}")
with Image.open(SOURCE) as source:
    if source.width != source.height:
        raise SystemExit("Approved icon must be square")
    image = source.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)

for point in [(0,0),(1023,0),(0,1023),(1023,1023)]:
    rgb = image.getpixel(point)
    if sum(rgb) < 85 or rgb[2] < 60:
        raise SystemExit(f"Black or empty corner {point}: {rgb}")

image.save(ASSETS / "marmalade-icon.webp", "WEBP", quality=91, method=6)
# Keep filenames for compatibility; transparency is intentionally removed.
image.save(ASSETS / "marmalade-transparent.png", "PNG", optimize=True)
image.save(ASSETS / "marmalade-maskable.png", "PNG", optimize=True)
image.resize((180, 180), Image.Resampling.LANCZOS).save(
    ASSETS / "apple-touch-icon.png", "PNG", optimize=True)
image.resize((32,32), Image.Resampling.LANCZOS).save(
    ROOT / "favicon-32.png", "PNG", optimize=True)
image.save(ROOT / "favicon.ico", format="ICO",
           sizes=[(16,16),(32,32),(48,48),(64,64)])
b64 = b64encode(SOURCE.read_bytes()).decode("ascii")
(ROOT / "favicon.svg").write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">'
    '<title>Marmalade Player</title>'
    '<image width="256" height="256" href="data:image/webp;base64,'+b64+'"/>'
    '</svg>\n', encoding="utf-8")
for path in [ASSETS/"marmalade-icon.webp", ASSETS/"marmalade-transparent.png",
             ASSETS/"marmalade-maskable.png", ASSETS/"apple-touch-icon.png",
             ROOT/"favicon-32.png", ROOT/"favicon.ico"]:
    with Image.open(path) as check:
        edge = check.convert("RGBA")
        for x,y in [(0,0),(edge.width-1,0),(0,edge.height-1),
                    (edge.width-1,edge.height-1)]:
            if edge.getpixel((x,y))[3] != 255:
                raise SystemExit(f"Icon has a transparent corner: {path.name}")
print("Verified full-bleed icons for web, PWA, mobile and desktop")
