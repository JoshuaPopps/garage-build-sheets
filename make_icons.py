#!/usr/bin/env python3
"""Generate the Garage Build Sheets app icons (192/512 PNG) from the
same design as icons/icon.svg: gloss black rounded square, chrome
border, a white build sheet with a purple header bar, part lines,
and a purple check. Run from the app dir: python3 make_icons.py"""
from PIL import Image, ImageDraw, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def rounded_rect(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 512.0
    # Gloss black rounded square + chrome border
    rounded_rect(d, [8 * s, 8 * s, 504 * s, 504 * s], 64 * s, fill=(7, 7, 9, 255),
                 outline=(232, 232, 236, 255), width=max(2, int(10 * s)))
    # White sheet
    rounded_rect(d, [118 * s, 96 * s, 394 * s, 416 * s], 18 * s, fill=(237, 237, 242, 255))
    # Purple header bar
    rounded_rect(d, [118 * s, 96 * s, 394 * s, 152 * s], 18 * s, fill=(157, 107, 255, 255))
    d.rectangle([118 * s, 134 * s, 394 * s, 152 * s], fill=(157, 107, 255, 255))
    # Part lines
    d.rounded_rectangle([150 * s, 196 * s, 300 * s, 214 * s], radius=9 * s, fill=(7, 7, 9, 255))
    d.rounded_rectangle([150 * s, 238 * s, 362 * s, 256 * s], radius=9 * s, fill=(85, 85, 95, 255))
    d.rounded_rectangle([150 * s, 280 * s, 330 * s, 298 * s], radius=9 * s, fill=(85, 85, 95, 255))
    d.rounded_rectangle([150 * s, 322 * s, 362 * s, 340 * s], radius=9 * s, fill=(85, 85, 95, 255))
    # Purple check in a circle
    cx, cy, r = 352 * s, 366 * s, 34 * s
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(157, 107, 255, 255),
              width=max(3, int(12 * s)))
    d.line([(336 * s, 366 * s), (348 * s, 378 * s), (372 * s, 352 * s)],
           fill=(157, 107, 255, 255), width=max(3, int(12 * s)), joint="curve")
    return img


if __name__ == "__main__":
    for size in (192, 512):
        icon = draw_icon(size)
        out = os.path.join(HERE, "icons", "icon-%d.png" % size)
        icon.save(out, "PNG")
        print("wrote", out, icon.size)
