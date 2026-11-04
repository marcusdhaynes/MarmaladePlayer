"""Normalize MarmaladePlayer launcher assets without changing approved artwork.

The master WebP already carries alpha. The problem is that some launchers
were composing it against nearly-black (#0D0722) backgrounds.
Produce a purple-matched, safe-zone maskable icon and iOS touch icon.
"""
from pathlib import Path
from PIL import Image
from PIL import ImageDraw
ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/"assets"
MASTER=ASSETS/"marmalade-icon.webp"
PURPLE=(62,24,127,255)
image=Image.open(MASTER).convert("RGBA")
if image.size!=(1024,1024):
    image=image.resize((1024,1024),Image.Resampling.LANCZOS)
# Keep every original pixel of the approved logo; only guarantee corners have
# no black opaque fill if an uploaded version accidentally lost its alpha.
corners=[image.getpixel(p) for p in [(0,0),(1023,0),(0,1023),(1023,1023)]]
if any(p[3]>8 for p in corners):
    # A rounded-square alpha mask only removes the OUTSIDE corner fill.
    from PIL import ImageChops, ImageFilter
    mask=Image.new("L",(1024,1024),0)
    ImageDraw.Draw(mask).rounded_rectangle((14,14,1009,1009),radius=240,fill=255)
    mask=mask.filter(ImageFilter.GaussianBlur(1.2))
    original_alpha=image.getchannel("A")
    image.putalpha(ImageChops.darker(original_alpha,mask))
    image.save(MASTER,"WEBP",lossless=True,method=6)
    print("Removed opaque corner fill from master icon")
else:
    print("Master icon corners already transparent; keeping artwork pixel-perfect")

def assert_transparency(picture):
    pts=[(0,0),(1023,0),(0,1023),(1023,1023)]
    if any(picture.getpixel(point)[3]>8 for point in pts):
        raise SystemExit("ERROR: an outer icon corner is not transparent")
assert_transparency(image)

# Android/Chromium maskable artwork must have an opaque background within its
# system-shaped silhouette. Use matching GALACTIC PURPLE, never black.
maskable=Image.new("RGBA",(1024,1024),PURPLE)
mark=image.resize((824,824),Image.Resampling.LANCZOS)
maskable.alpha_composite(mark,(100,100))
maskable.convert("RGB").save(ASSETS/"marmalade-maskable.png",optimize=True)

# iOS always masks to its own rounded system shape and requires opaque icons.
ios=Image.new("RGBA",(1024,1024),PURPLE)
ios.alpha_composite(image)
ios.convert("RGB").resize((180,180),Image.Resampling.LANCZOS).save(
    ASSETS/"apple-touch-icon.png",optimize=True)

# Verify an actual high-res RGBA PNG is available to desktop launchers.
image.save(ASSETS/"marmalade-transparent.png",optimize=True)
print("Verified alpha-corner PNG, purple maskable icon, and iOS touch icon")
