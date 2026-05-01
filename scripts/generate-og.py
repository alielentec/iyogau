#!/usr/bin/env python3
# Generates the iYogaU OG image (1200x630) and a favicon set from
# theme tokens. Run once when the brand changes; output committed to
# assets/img/. Reads no external data.

from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "img"
OUT.mkdir(parents=True, exist_ok=True)

# Amethyst tokens (matches CSS --surface, --primary, --gold, --ink).
SURFACE = (250, 246, 251)
SURFACE_2 = (243, 236, 246)
PRIMARY = (124, 78, 168)         # #7c4ea8
PRIMARY_SOFT = (200, 168, 224)   # #c8a8e0
GOLD = (133, 98, 43)             # #85622b
INK = (42, 29, 52)               # #2a1d34
INK_MUTED = (90, 74, 104)        # #5a4a68

# ---------- Font discovery ----------
def find_font(candidates, size):
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()

SERIF_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    "/System/Library/Fonts/Times.ttc",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
]
SANS_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Avenir Next.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
SANS_BOLD_CANDIDATES = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

# ---------- OG image (1200x630) ----------
def build_og():
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), SURFACE)
    draw = ImageDraw.Draw(img, "RGBA")

    # Soft radial halos in primary-soft and gold-soft, blurred.
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    hd.ellipse([-200, -300, 800, 600], fill=(*PRIMARY_SOFT, 110))
    hd.ellipse([800, 200, 1500, 900], fill=(218, 188, 130, 90))
    halo = halo.filter(ImageFilter.GaussianBlur(80))
    img.paste(halo, (0, 0), halo)

    # Wordmark "iYogaU" with italic accent on i and U.
    serif_big = find_font(SERIF_CANDIDATES, 140)
    serif_med = find_font(SERIF_CANDIDATES, 36)
    sans_med = find_font(SANS_CANDIDATES, 28)
    sans_bold = find_font(SANS_BOLD_CANDIDATES, 22)

    # Lay out "iYogaU" centered. We render each glyph individually to
    # color the i and U accents.
    glyphs = [("i", GOLD), ("Y", INK), ("o", INK), ("g", INK), ("a", INK), ("U", PRIMARY)]
    widths = []
    for ch, _ in glyphs:
        bbox = draw.textbbox((0, 0), ch, font=serif_big)
        widths.append(bbox[2] - bbox[0])
    total_w = sum(widths) + 12 * (len(glyphs) - 1)
    cur_x = (W - total_w) // 2
    base_y = 200
    for (ch, color), w in zip(glyphs, widths):
        draw.text((cur_x, base_y), ch, fill=color, font=serif_big)
        cur_x += w + 12

    # Tagline under the wordmark
    tagline = "Inner Transformation Yoga"
    tw = draw.textbbox((0, 0), tagline, font=serif_med)[2]
    draw.text(((W - tw) // 2, 380), tagline, fill=INK_MUTED, font=serif_med)

    # Eyebrow above
    eyebrow = "ANCIENT WISDOM  ·  MODERN PRECISION"
    ew = draw.textbbox((0, 0), eyebrow, font=sans_bold)[2]
    draw.text(((W - ew) // 2, 160), eyebrow, fill=GOLD, font=sans_bold)

    # Footer cities
    cities = "Seoul  ·  Shanghai  ·  California Bay Area"
    cw = draw.textbbox((0, 0), cities, font=sans_med)[2]
    draw.text(((W - cw) // 2, 520), cities, fill=INK_MUTED, font=sans_med)

    # Thin top accent bar
    draw.rectangle([0, 0, W, 4], fill=PRIMARY)

    out = OUT / "og.png"
    img.save(out, "PNG", optimize=True)
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")

# ---------- Favicon (multi-size) ----------
def build_favicon():
    # Render at 256 then downscale to common sizes.
    src = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(src)
    # Filled circle in amethyst primary.
    d.ellipse([8, 8, 248, 248], fill=PRIMARY)
    # Italic gold "i" — approximated with serif font.
    f = find_font(SERIF_CANDIDATES, 200)
    txt = "i"
    bbox = d.textbbox((0, 0), txt, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((256 - tw) // 2 - bbox[0], (256 - th) // 2 - bbox[1] - 10), txt,
           fill=(245, 224, 168, 255), font=f)

    # SVG-equivalent PNG at common sizes
    sizes = [(180, "apple-touch-icon.png"), (32, "favicon-32.png"), (16, "favicon-16.png")]
    for s, name in sizes:
        scaled = src.resize((s, s), Image.LANCZOS)
        scaled.save(OUT / name, "PNG", optimize=True)
        print(f"wrote {(OUT / name).relative_to(ROOT)}")

    # Multi-resolution .ico
    ico_path = ROOT / "favicon.ico"
    src.resize((48, 48), Image.LANCZOS).save(ico_path, format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"wrote {ico_path.relative_to(ROOT)}")

if __name__ == "__main__":
    build_og()
    build_favicon()
