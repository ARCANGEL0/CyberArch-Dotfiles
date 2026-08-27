#!/usr/bin/env python3
import math
import shutil
import subprocess
import sys
import tempfile
def run(cmd):
    subprocess.run(cmd, shell=True, check=True)
def main(lat, lon, out):
    z = 16
    nn = 1 << z
    xt = int((lon + 180) / 360 * nn)
    lr = lat * 3.14159265 / 180
    yt = int((1 - (math.log(math.tan(lr) + 1 / math.cos(lr)) / 3.14159265)) / 2 * nn)

    d = tempfile.mkdtemp(prefix="cybermap-")
    tiles = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            idx = (dy + 1) * 3 + (dx + 1)
            y, x = yt + dy, xt + dx
            p = f"{d}/t{idx}.png"
            run(f"curl -sf --max-time 15 'https://tile.openstreetmap.de/{z}/{x}/{y}.png' -o '{p}'")
            tiles.append(p)
    grid = f"{d}/grid.png"
    run(f"montage {' '.join(tiles)} -tile 3x3 -geometry +0+0 -background white '{grid}'")
    from PIL import Image
    img = Image.open(grid).convert("RGB")
    src = img.load()
    res = Image.new("RGB", img.size, (6, 10, 15))
    dst = res.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b = src[x, y]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            water = b > r + 12 and b > 110
            green = g > r + 8 and g > b + 8 and g > 120 and not water
            road = lum < 180 and not water and not green
            major = lum < 80 and not water
            build = lum > 200 and lum < 245 and not water and not green
            if water:
                dst[x, y] = (7, 16, 22)
            elif green:
                dst[x, y] = (11, 23, 16)
            elif road:
                dst[x, y] = (40, 140, 160)
            if major:
                dst[x, y] = (60, 200, 215)
            elif build:
                dst[x, y] = (9, 14, 21)
    res.save(out)
    shutil.rmtree(d, ignore_errors=True)

if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: gen-map.py LAT LON OUT")
    main(float(sys.argv[1]), float(sys.argv[2]), sys.argv[3])
