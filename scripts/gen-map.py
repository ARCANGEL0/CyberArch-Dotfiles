#!/usr/bin/env python3
import os, subprocess, sys, tempfile

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

    import numpy as np
    from PIL import Image
    img = np.array(Image.open(grid).convert("RGB")).astype(np.float32)
    r, g, b = img[:,:,0], img[:,:,1], img[:,:,2]
    lum = 0.299*r + 0.587*g + 0.114*b
    res = np.zeros_like(img)
    res[:,:,0] = 6; res[:,:,1] = 10; res[:,:,2] = 15
    water = (b > r + 12) & (b > 110)
    green = (g > r + 8) & (g > b + 8) & (g > 120) & ~water
    res[water, 0] = 7; res[water, 1] = 16; res[water, 2] = 22
    res[green, 0] = 11; res[green, 1] = 23; res[green, 2] = 16
    road = (lum < 180) & ~water & ~green
    res[road, 0] = 40; res[road, 1] = 140; res[road, 2] = 160
    major = (lum < 80) & ~water
    res[major, 0] = 60; res[major, 1] = 200; res[major, 2] = 215
    build = (lum > 200) & (lum < 245) & ~water & ~green
    res[build, 0] = 9; res[build, 1] = 14; res[build, 2] = 21
    res = np.clip(res, 0, 255).astype(np.uint8)
    Image.fromarray(res).save(out)
    run(f"rm -rf '{d}'")

if __name__ == "__main__":
    import math
    if len(sys.argv) != 4:
        sys.exit("usage: gen-map.py LAT LON OUT")
    main(float(sys.argv[1]), float(sys.argv[2]), sys.argv[3])
