"""Generate the OCD app icon: black glass tile with a bevelled chrome "OC".

Renders at 4x and downsamples, so the 16px variant stays readable.

    python scripts/make-icon.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PNG = ROOT / "resources" / "icon.png"
ICO = ROOT / "resources" / "icon.ico"
PNG_UPDATE = ROOT / "resources" / "icon-update.png"
ICO_UPDATE = ROOT / "resources" / "icon-update.ico"

SS = 4  # supersampling factor
SIZE = 512
S = SIZE * SS

# Whole-tile rotation before saving, clockwise in degrees; 0 disables it.
# The tile is square with symmetric corners, so rotating the finished image is
# equivalent to rotating the artwork and keeps the code simple.
#
# 90, clockwise: the mark reads with "C" above "O". It stood at 0 because a
# quarter turn turns the two letters into something that no longer reads as
# letters at 16-24px, and a taskbar entry is mostly 16px. The owner asked for
# it that way, so that is what it is - and the supersampled render below is what
# keeps the rotated glyphs from turning to mush at those sizes.
ROTATE_CW = 90

# PIL rotates counter-clockwise, so a clockwise quarter turn is ROTATE_270.
CLOCKWISE = {
    1: Image.Transpose.ROTATE_270,
    2: Image.Transpose.ROTATE_180,
    3: Image.Transpose.ROTATE_90,
}

FONT_PATH = r"C:\Windows\Fonts\seguibl.ttf"  # Segoe UI Black

# Chrome banding: light at the very top, a dark valley, then a bright mid band.
METAL_STOPS = [
    (0.00, (250, 252, 255)),
    (0.16, (198, 206, 215)),
    (0.38, (108, 117, 128)),
    (0.52, (196, 205, 214)),
    (0.68, (232, 238, 244)),
    (0.84, (92, 100, 110)),
    (1.00, (176, 185, 195)),
]

BG_STOPS = [
    (0.00, (38, 41, 45)),
    (0.30, (14, 15, 17)),
    (0.72, (6, 6, 8)),
    (1.00, (17, 18, 21)),
]


def ramp(stops, height):
    """Vertical gradient as a float array of shape (height, 3)."""
    ys = np.linspace(0.0, 1.0, height)
    out = np.zeros((height, 3), dtype=np.float64)
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        span = max(p1 - p0, 1e-6)
        m = (ys >= p0) & (ys <= p1)
        if not m.any():
            continue
        t = ((ys[m] - p0) / span)[:, None]
        out[m] = np.array(c0, dtype=np.float64) * (1 - t) + np.array(c1, dtype=np.float64) * t
    return out


def fill_gradient(width, height, stops):
    """RGB image of the given size painted with a vertical gradient."""
    arr = np.repeat(ramp(stops, height)[:, None, :], width, axis=1)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def text_mask(text, font):
    """Antialiased white text on black, cropped to the glyphs."""
    pad = S // 4
    canvas = Image.new("L", (S + pad * 2, S + pad * 2), 0)
    draw = ImageDraw.Draw(canvas)
    draw.text((pad, pad), text, font=font, fill=255)
    return canvas.getbbox(), canvas


def fit_font(text, max_w_ratio=0.70, max_h_ratio=0.44):
    """Largest size that keeps the mark inside the safe area."""
    lo, hi = 10, int(S)
    best = lo
    while lo <= hi:
        mid = (lo + hi) // 2
        f = ImageFont.truetype(FONT_PATH, mid)
        box = ImageDraw.Draw(Image.new("L", (1, 1))).textbbox((0, 0), text, font=f)
        w = box[2] - box[0]
        h = box[3] - box[1]
        if w <= S * max_w_ratio and h <= S * max_h_ratio:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return ImageFont.truetype(FONT_PATH, best)


ICO_SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]

# Badge shown while an update is waiting. Pale disc with a blue arrow, which
# is how OpenCode marks the same state in its own header - and on the dark tile
# a pale disc reads as "something changed" where a saturated one just looks
# like a different app. The dark rim keeps it off the chrome "C" underneath.
BADGE_RGB = (214, 226, 255)
BADGE_ARROW = (37, 99, 235)


def add_update_badge(tile):
    """Stamp a downward-arrow badge onto the bottom-right of a finished tile.

    Drawn at supersampled resolution like everything else here, and kept large
    enough to survive the 16px frame - a badge sized for a 256px icon disappears
    completely at the sizes the taskbar actually uses.
    """
    img = tile.copy()
    d = ImageDraw.Draw(img)

    cx = int(S * 0.735)
    cy = int(S * 0.735)
    r = int(S * 0.205)

    # Dark rim first: it separates the badge from the chrome "C" underneath,
    # which is bright silver and would otherwise swallow the blue.
    d.ellipse([cx - r - int(S * 0.012), cy - r - int(S * 0.012), cx + r + int(S * 0.012), cy + r + int(S * 0.012)], fill=(8, 9, 11, 255))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BADGE_RGB + (255,))

    # Arrow: a thick stem and a wide head, both oversized so the 16px frame
    # still shows an arrow rather than a dot.
    stem = int(r * 0.26)
    top = cy - int(r * 0.52)
    knee = cy + int(r * 0.08)
    d.rectangle([cx - stem, top, cx + stem, knee], fill=BADGE_ARROW + (255,))
    d.polygon(
        [
            (cx - int(r * 0.62), knee),
            (cx + int(r * 0.62), knee),
            (cx, cy + int(r * 0.66)),
        ],
        fill=BADGE_ARROW + (255,),
    )
    return img


def main() -> None:
    # ---------- background: rounded black tile ----------
    radius = int(S * 0.225)
    body = fill_gradient(S, S, BG_STOPS).convert("RGBA")

    # Broad diagonal gloss across the glass instead of a hard hotspot.
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float64)
    band = np.clip(1.0 - np.abs((xx / S * 0.72 + yy / S * 0.68) - 0.34) / 0.34, 0.0, 1.0) ** 1.6
    band = band * np.clip(1.0 - (yy / S) * 0.85, 0.0, 1.0)
    sheen_rgb = np.dstack([np.full((S, S), 236.0), np.full((S, S), 242.0), np.full((S, S), 252.0), band * 40])
    body = Image.alpha_composite(body, Image.fromarray(np.clip(sheen_rgb, 0, 255).astype(np.uint8), "RGBA"))

    # Vignette at the bottom edge.
    vig = np.clip((yy / S - 0.52) / 0.48, 0.0, 1.0) ** 2
    vig_rgb = np.dstack([np.zeros_like(vig), np.zeros_like(vig), np.zeros_like(vig), vig * 130])
    body = Image.alpha_composite(body, Image.fromarray(np.clip(vig_rgb, 0, 255).astype(np.uint8), "RGBA"))

    tile_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(tile_mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
    body.putalpha(tile_mask)

    # ---------- "OC" as chrome with a bevel ----------
    font = fit_font("OC")
    bbox, glyphs = text_mask("OC", font)

    # Crop the padded canvas down to the glyphs plus room for the bevel.
    margin = int(S * 0.07)
    left = max(bbox[0] - margin, 0)
    top = max(bbox[1] - margin, 0)
    right = min(bbox[2] + margin, glyphs.width)
    bottom = min(bbox[3] + margin, glyphs.height)
    glyphs = glyphs.crop((left, top, right, bottom))
    gw, gh = glyphs.size

    def layer(offset):
        img = Image.new("L", (gw, gh), 0)
        img.paste(glyphs, (-offset, -offset))
        return img

    # Outer bevel ring: the glyph grown by a few pixels.
    ring = Image.new("L", (gw, gh), 0)
    ring.paste(glyphs.filter(ImageFilter.MaxFilter(9)), (0, 0))
    ring = ImageChops_subtract(ring, glyphs)

    def tint(mask, rgb, alpha):
        solid = Image.new("RGBA", (gw, gh), rgb + (0,))
        solid.putalpha(mask.point(lambda v: int(v * alpha)))
        return solid

    # Ring shading: bright on the top-left lip, dark on the bottom-right.
    ry, rx = np.mgrid[0:gh, 0:gw].astype(np.float64)
    diag = np.clip(((rx / max(gw, 1)) * 0.55 + (ry / max(gh, 1)) * 0.45), 0, 1)
    ring_arr = (ring.point(lambda v: v / 255.0).numpy() if hasattr(ring, "numpy") else np.asarray(ring, dtype=np.float64) / 255.0)
    light = np.clip(1.0 - diag * 2.0, 0, 1)
    dark = np.clip((diag - 0.55) * 2.0, 0, 1)
    bevel_rgb = (
        np.dstack([np.full((gh, gw), 255.0), np.full((gh, gw), 255.0), np.full((gh, gw), 255.0)]) * light[..., None]
        + np.dstack([np.zeros((gh, gw)), np.zeros((gh, gw)), np.zeros((gh, gw))]) * dark[..., None]
    )
    bevel_alpha = np.clip(ring_arr * (0.35 + 0.65 * np.maximum(light, dark)), 0, 1)
    bevel = Image.fromarray(
        np.dstack([bevel_rgb, bevel_alpha * 235]).clip(0, 255).astype(np.uint8), "RGBA"
    )

    # Cast shadow below the letters.
    shadow = layer(int(S * 0.012)).filter(ImageFilter.GaussianBlur(int(S * 0.022)))
    shadow_rgba = Image.new("RGBA", (gw, gh), (0, 0, 0, 0))
    shadow_rgba.putalpha(shadow.point(lambda v: int(v * 0.75)))

    # Metal body of the letters.
    metal = fill_gradient(gw, gh, METAL_STOPS).convert("RGBA")
    metal.putalpha(glyphs)

    # Diagonal specular streak, clipped to the glyphs.
    sx = ((rx / max(gw, 1)) * 0.75 + (ry / max(gh, 1)) * 0.45 - 0.18) / 0.30
    spec = np.clip(1.0 - np.abs(sx - 0.5) * 2.0, 0, 1) ** 2
    spec_alpha = (spec * (np.asarray(glyphs, dtype=np.float64) / 255.0) * 120).clip(0, 255)
    spec_rgba = Image.fromarray(
        np.dstack([np.full((gh, gw), 255.0), np.full((gh, gw), 255.0), np.full((gh, gw), 255.0), spec_alpha]).astype(
            np.uint8
        ),
        "RGBA",
    )

    letters = Image.new("RGBA", (gw, gh), (0, 0, 0, 0))
    letters = Image.alpha_composite(letters, bevel)
    letters = Image.alpha_composite(letters, metal)
    letters = Image.alpha_composite(letters, spec_rgba)

    # Optical centring: sit the mark a touch above the geometric middle.
    origin_x = (S - gw) // 2
    origin_y = (S - gh) // 2 - int(S * 0.015)

    # Place the stack centred on the tile rather than at the raw glyph offset.
    def at(img, dx=0, dy=0):
        tmp = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        tmp.paste(img, (origin_x + dx, origin_y + dy), img)
        return tmp

    composed = body
    mark = Image.alpha_composite(at(shadow_rgba), at(letters))

    if ROTATE_CW % 360:
        # The mark only, not the tile: the update badge is a separate sign with
        # its own meaning, and a quarter turn would put it over the "C" and
        # point its arrow sideways, which reads as "go back" rather than
        # "install what was downloaded".
        mark = mark.transpose(CLOCKWISE[ROTATE_CW // 90 % 4])

    composed = Image.alpha_composite(composed, mark)

    # Downsample: supersampling is what keeps the glyph edges clean. The badge
    # goes on before this step so it is anti-aliased by the same downsample as
    # the rest of the artwork; drawn afterwards it lands on already-scaled
    # pixels and its edges go jagged at the sizes the taskbar uses.
    out = composed.resize((SIZE, SIZE), Image.LANCZOS)
    update = add_update_badge(composed).resize((SIZE, SIZE), Image.LANCZOS)

    PNG.parent.mkdir(parents=True, exist_ok=True)
    out.save(PNG, "PNG")

    out.save(ICO, format="ICO", sizes=ICO_SIZES)

    update.save(PNG_UPDATE, "PNG")
    update.save(ICO_UPDATE, format="ICO", sizes=ICO_SIZES)

    print(f"saved {PNG} ({PNG.stat().st_size} bytes)")
    print(f"saved {ICO} ({ICO.stat().st_size} bytes)")
    print(f"saved {PNG_UPDATE} ({PNG_UPDATE.stat().st_size} bytes)")
    print(f"saved {ICO_UPDATE} ({ICO_UPDATE.stat().st_size} bytes)")


def ImageChops_subtract(a: Image.Image, b: Image.Image) -> Image.Image:
    """a - b, clamped at zero (PIL has no direct helper for L-mode arrays)."""
    import numpy as np

    av = np.asarray(a, dtype=np.int16)
    bv = np.asarray(b, dtype=np.int16)
    return Image.fromarray(np.clip(av - bv, 0, 255).astype(np.uint8), "L")


if __name__ == "__main__":
    main()