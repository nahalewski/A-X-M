"""Builds the Ghost sprite sheets from the supplied art.

ghost-eye-sprite.webp  : one front-facing shell, 12 evenly spaced eye hues. The shell
                         is pixel-identical across frames, so cycling them reads as
                         the eye changing colour rather than the model flickering.
ghost-spin-sprite.webp : the supplied 8-frame rotation, every frame scaled by the
                         same factor so the Ghost doesn't pulse as it turns.
"""
from PIL import Image
import numpy as np, colorsys, os

# Run with the two supplied sheets in a folder, e.g.:
#   python scripts/build-ghost-sprites.py path/to/source-art
# 4.webp is the eye-colour ramp, 5.webp the rotation. Needs Pillow.
import sys

BASE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'art', 'ghost')
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons')
SP = OUT

CELL = 256          # exported frame size
CONTENT = 236       # longest edge of the art inside a frame
HUES = 12           # steps around the colour wheel

EYE_GRID = ([(39, 349), (423, 733), (805, 1115), (1189, 1499)], [(142, 452), (581, 891)])
SPIN_GRID = ([(39, 368), (435, 762), (830, 1096), (1184, 1499)], [(126, 436), (594, 897)])


def cells(path, grid):
    im = Image.open(path).convert('RGBA')
    cols, rows = grid
    out = []
    for (y0, y1) in rows:
        for (x0, x1) in cols:
            out.append(im.crop((x0, y0, x1 + 1, y1 + 1)))
    return out


def trim(img):
    a = np.array(img)[:, :, 3]
    ys, xs = np.where(a > 40)
    return img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def place(img, scale):
    w = max(1, round(img.width * scale))
    h = max(1, round(img.height * scale))
    img = img.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    canvas.paste(img, ((CELL - w) // 2, (CELL - h) // 2), img)
    return canvas


def recolour_eye(frame, hue):
    """Rotates only the saturated disc at the centre; the white shell is untouched."""
    a = np.array(frame).astype(np.float32) / 255.0
    rgb, alpha = a[:, :, :3], a[:, :, 3]

    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)

    h, w = sat.shape
    yy, xx = np.mgrid[0:h, 0:w]
    radius = np.hypot(xx - w / 2, yy - h / 2) / (min(h, w) / 2)

    # The eye and its bloom live well inside the shell; the shell's own faint tints
    # sit outside this radius, so restricting by distance keeps them white.
    mask = (sat > 0.16) & (radius < 0.34) & (alpha > 0.2)
    if not mask.any():
        return frame.copy()

    out = rgb.copy()
    idx = np.argwhere(mask)
    for y, x in idx:
        r, g, b = rgb[y, x]
        _, s, v = colorsys.rgb_to_hsv(float(r), float(g), float(b))
        nr, ng, nb = colorsys.hsv_to_rgb(hue, s, v)
        out[y, x] = (nr, ng, nb)

    merged = np.dstack([out, alpha])
    return Image.fromarray((np.clip(merged, 0, 1) * 255).astype(np.uint8), 'RGBA')


def sheet(frames, path):
    out = Image.new('RGBA', (CELL * len(frames), CELL), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        out.paste(f, (i * CELL, 0), f)
    out.save(path, lossless=True, quality=95)
    return out


os.makedirs(OUT, exist_ok=True)

# ---- eye sheet: one shell, twelve hues -------------------------------------
front = trim(cells(f'{BASE}/4.webp', EYE_GRID)[0])
front = place(front, CONTENT / max(front.size))
eye_frames = [recolour_eye(front, i / HUES) for i in range(HUES)]
sheet(eye_frames, f'{OUT}/ghost-eye-sprite.webp')
print('ghost-eye-sprite.webp', HUES, 'frames')

# ---- spin sheet: the supplied rotation, one shared scale --------------------
spin = [trim(c) for c in cells(f'{BASE}/5.webp', SPIN_GRID)]
longest = max(max(c.size) for c in spin)
scale = CONTENT / longest
spin_frames = [place(c, scale) for c in spin]
sheet(spin_frames, f'{OUT}/ghost-spin-sprite.webp')
print('ghost-spin-sprite.webp', len(spin_frames), 'frames')


