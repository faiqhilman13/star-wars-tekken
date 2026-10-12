"""Tile review renders into one labelled contact sheet (system Python + Pillow).

  python tools/blender/sd_sheet.py --out sheet.png --cols 4 --height 520 [--title T] img1.png img2.png ...
  (a glob such as dir/pose_*.png is expanded; --nearest keeps tiny gameplay renders crisp when scaled)
"""
import argparse
import glob
import os

from PIL import Image, ImageDraw, ImageFont


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--height", type=int, default=520)
    ap.add_argument("--title", default="")
    ap.add_argument("--nearest", action="store_true")
    ap.add_argument("images", nargs="+")
    a = ap.parse_args()
    files = []
    for p in a.images:
        files += sorted(glob.glob(p)) if any(ch in p for ch in "*?[") else [p]
    files = [f for f in files if os.path.exists(f)]
    tiles = []
    for f in files:
        im = Image.open(f).convert("RGB")
        s = a.height / im.height
        im = im.resize((max(1, int(im.width * s)), a.height), Image.NEAREST if a.nearest else Image.LANCZOS)
        tiles.append((os.path.splitext(os.path.basename(f))[0], im))
    if not tiles:
        raise SystemExit("no images")
    try:
        font = ImageFont.load_default(size=18)
    except TypeError:
        font = ImageFont.load_default()
    gap, lab, top = 10, 24, (34 if a.title else 0)
    rows = [tiles[i:i + a.cols] for i in range(0, len(tiles), a.cols)]
    W = max(sum(t.width for _, t in r) + gap * (len(r) + 1) for r in rows)
    H = top + len(rows) * (a.height + lab + gap) + gap
    sheet = Image.new("RGB", (W, H), (28, 29, 33))
    d = ImageDraw.Draw(sheet)
    if a.title:
        d.text((gap, 8), a.title, fill=(235, 235, 235), font=font)
    y = top + gap
    for r in rows:
        x = gap
        for name, im in r:
            d.text((x, y), name, fill=(210, 210, 210), font=font)
            sheet.paste(im, (x, y + lab))
            x += im.width + gap
        y += a.height + lab + gap
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    sheet.save(a.out)
    print("sheet", a.out, sheet.size)


if __name__ == "__main__":
    main()
