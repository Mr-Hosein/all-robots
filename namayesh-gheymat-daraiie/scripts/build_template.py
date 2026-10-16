#!/usr/bin/env python3
"""
Builds assets/template.png from assets/reference.png.

Every piece of text that changes (prices, dates, weather, zodiac ...) and every
trend arrow is erased with OpenCV inpainting, so what is left is the pure
artwork + frames + static labels. render.mjs then writes the live values on top.

Run only when the reference picture changes:
    python3 scripts/build_template.py
"""
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "reference.png"
DST = ROOT / "assets" / "template.png"

# ── field centres (y) taken from the reference picture ─────────────────────────
CUR_Y = [350, 406, 466, 527, 590]
GOLD_Y = [351, 400, 449, 499, 549, 600, 650]
OIL_Y = [761, 822, 882]
CRYPTO_Y = [814, 875, 935]
BOURSE_Y = [1114, 1158, 1205]

H = 19  # half height of a number row mask

# (x0, y0, x1, y1)
TEXT_RECTS = []   # white text -> erased by colour threshold
ARROW_RECTS = []  # green triangles -> erased by colour threshold

for y in CUR_Y:
    TEXT_RECTS.append((252, y - H, 386, y + H))
    ARROW_RECTS.append((444, y - 22, 486, y + 22))

for i, y in enumerate(GOLD_Y):
    x0 = 768 if i == 4 else 748
    x1 = 915 if i == 0 else 909
    TEXT_RECTS.append((x0, y - H, x1, y + H))
    ARROW_RECTS.append((952, y - 22, 994, y + 22))

# oil: Brent + WTI numbers, natural-gas dash (rebuilt by the renderer)
for y in OIL_Y:
    TEXT_RECTS.append((276, y - H, 394, y + H))
for y in OIL_Y[:2]:
    ARROW_RECTS.append((446, y - 22, 486, y + 22))
ARROW_RECTS.append((446, OIL_Y[2] - 22, 486, OIL_Y[2] + 22))

for y in CRYPTO_Y:
    TEXT_RECTS.append((800, y - H, 956, y + H))
    ARROW_RECTS.append((956, y - 22, 996, y + 22))

for y in BOURSE_Y:
    TEXT_RECTS.append((398, y - H, 590, y + H))
    ARROW_RECTS.append((652, y - 22, 694, y + 22))

# footer: last-update time (the label above it stays in the picture)
TEXT_RECTS.append((128, 1265, 318, 1293))

# bottom-right panel (date / time / weather / occasions)
TEXT_RECTS += [
    (746, 1306, 938, 1338),   # weekday + shamsi date
    (622, 1306, 700, 1338),   # clock time
    (756, 1338, 938, 1366),   # hijri
    (770, 1366, 938, 1394),   # gregorian
    (676, 1403, 934, 1431),   # weather text
    (776, 1440, 938, 1470),   # "مناسبت‌های امروز:" label
    (640, 1470, 938, 1500),   # occasions values
]
# weather icon (cloud) is redrawn according to the real weather
ICON_RECTS = [(936, 1400, 976, 1438)]

# bottom-left panel (zodiac + moon lines); labels are re-typeset by the renderer
TEXT_RECTS.append((262, 1306, 476, 1494))


def white_mask(img, rect, thr=150):
    x0, y0, x1, y1 = rect
    sub = img[y0:y1, x0:x1]
    m = (sub.min(axis=2) > thr).astype(np.uint8) * 255
    out = np.zeros(img.shape[:2], np.uint8)
    out[y0:y1, x0:x1] = m
    return out


def green_mask(img, rect):
    x0, y0, x1, y1 = rect
    sub = img[y0:y1, x0:x1].astype(int)
    b, g, r = sub[..., 0], sub[..., 1], sub[..., 2]
    m = ((g > 90) & (g > r * 1.35) & (g > b * 0.9)).astype(np.uint8) * 255
    out = np.zeros(img.shape[:2], np.uint8)
    out[y0:y1, x0:x1] = m
    return out


def rect_mask(img, rect):
    x0, y0, x1, y1 = rect
    out = np.zeros(img.shape[:2], np.uint8)
    out[y0:y1, x0:x1] = 255
    return out


def main():
    img = cv2.imread(str(SRC))
    if img is None:
        sys.exit(f"cannot read {SRC}")
    mask = np.zeros(img.shape[:2], np.uint8)
    for r in TEXT_RECTS:
        mask |= white_mask(img, r)
    for r in ARROW_RECTS:
        mask |= green_mask(img, r)
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    # keep dilation inside the rectangles
    allowed = np.zeros_like(mask)
    for r in TEXT_RECTS + ARROW_RECTS:
        allowed |= rect_mask(img, r)
    mask &= allowed
    # icons: erase the whole rectangle
    for r in ICON_RECTS:
        mask |= rect_mask(img, r)

    out = cv2.inpaint(img, mask, 6, cv2.INPAINT_TELEA)
    cv2.imwrite(str(DST), out)
    cv2.imwrite(str(ROOT / "assets" / "_mask_debug.png"), mask)
    print("wrote", DST, "masked px:", int((mask > 0).sum()))


if __name__ == "__main__":
    main()
