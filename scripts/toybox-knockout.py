"""
Knocks the flat white / light background out of Toybox artwork.

    python scripts/toybox-knockout.py [platform ...]

Many of the referenced pictures (Disney Infinity's coin covers, some LEGO
renders) are a figure on a plain light background. This floods in from the
image corners, marking only the background that is *connected to the edge* and
close in colour to the corner pixel, so white inside the character (eyes, teeth,
a white costume) is untouched. The edge of the cut-out is softened by one pixel.
Images whose corners are already transparent are left alone, and Skylanders'
collector cards are skipped (the card is the picture).

Writes a .png beside the original and removes the .jpg; the runtime cache looks
for .png first. Run after scripts/toybox-artwork.mjs. Needs Pillow + NumPy, which
the app's Python environment has.
"""

import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ARTWORK = os.path.join(ROOT, "toybox-data", "artwork")
SKIP = {"skylanders"}
TOLERANCE = 46  # max channel distance from the corner colour to count as background


def knock_out(path):
    im = Image.open(path).convert("RGBA")
    px = np.array(im).astype(np.int16)
    h, w = px.shape[:2]
    corners = [px[0, 0], px[0, w - 1], px[h - 1, 0], px[h - 1, w - 1]]
    if all(c[3] < 30 for c in corners):
        # Already transparent: just trim the empty margin so the figure fills its cubby.
        # Faint shadow pixels stretch the plain bbox to the whole canvas; measure what is visible.
        bbox = Image.fromarray((px[:, :, 3] > 24).astype(np.uint8) * 255, "L").getbbox()
        if bbox and (bbox[2] - bbox[0] < w * 0.9 or bbox[3] - bbox[1] < h * 0.9):
            im.crop(bbox).save(os.path.splitext(path)[0] + ".png")
            if not path.endswith(".png"):
                os.remove(path)
            return "trimmed"
        return "transparent"
    if not all(min(c[:3]) > 190 for c in corners):
        return "not-light"
    bg = np.median(np.array(corners)[:, :3], axis=0)
    close = (np.abs(px[:, :, :3] - bg).max(axis=2) <= TOLERANCE) & (px[:, :, 3] > 0)
    # Flood from every edge pixel that is background: only connected background goes.
    mask = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if close[y, x] and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if close[y, x] and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < h and 0 <= xx < w and close[yy, xx] and not mask[yy, xx]:
                mask[yy, xx] = True
                q.append((yy, xx))
    if mask.mean() < 0.05:
        return "no-background"
    alpha = Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), "L")
    # A one-pixel feather hides the jaggies without eating into the figure.
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.7))
    out = im.copy()
    out.putalpha(Image.fromarray(np.minimum(np.array(alpha), np.array(im)[:, :, 3]).astype(np.uint8), "L"))
    # Crop to the figure so it fills its cubby / card.
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    dst = os.path.splitext(path)[0] + ".png"
    out.save(dst)
    if dst != path:
        os.remove(path)
    return "done"


def main():
    platforms = sys.argv[1:] or [p for p in os.listdir(ARTWORK) if os.path.isdir(os.path.join(ARTWORK, p))]
    for platform in platforms:
        if platform in SKIP:
            print(f"{platform}: skipped (cards)")
            continue
        folder = os.path.join(ARTWORK, platform)
        counts = {}
        for name in sorted(os.listdir(folder)):
            if not name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                continue
            try:
                result = knock_out(os.path.join(folder, name))
            except Exception as e:  # noqa: BLE001
                result = f"error: {e}"
            counts[result] = counts.get(result, 0) + 1
        print(f"{platform}: {counts}")


if __name__ == "__main__":
    main()
