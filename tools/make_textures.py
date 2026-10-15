"""Procedural textures for the gym (numpy + Pillow only).

Usage: python3 tools/make_textures.py <out_dir>
"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "build/tex"
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_COND = "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf"
if not os.path.exists(FONT_COND):
    FONT_COND = FONT_BOLD


def noise(size, scale, octaves=4, seed=0):
    """Tileable value noise in [0,1]."""
    r = np.random.default_rng(seed)
    acc = np.zeros((size, size), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = max(2, int(scale * 2 ** o))
        g = r.random((n, n)).astype(np.float32)
        img = Image.fromarray((g * 255).astype(np.uint8))
        # tile 3x3 then crop the middle so the result wraps
        big = Image.new("L", (n * 3, n * 3))
        for i in range(3):
            for j in range(3):
                big.paste(img, (i * n, j * n))
        big = big.resize((size * 3, size * 3), Image.BICUBIC)
        layer = np.asarray(big, np.float32)[size:2 * size, size:2 * size] / 255
        acc += layer * amp
        tot += amp
        amp *= 0.5
    return acc / tot


def save(arr, name, q=88):
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    Image.fromarray(arr).save(os.path.join(OUT, name), quality=q)


def normal_from_height(h, strength=2.0):
    dx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    dy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    n = np.dstack([-dx * strength, dy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return (n * 0.5 + 0.5) * 255


def wood_floor(S=1024):
    planks_x, planks_y = 6, 1  # 6 planks across, staggered lengths
    img = np.zeros((S, S, 3), np.float32)
    h = np.zeros((S, S), np.float32)
    pw = S // planks_x
    grain = noise(S, 3, 5, 1)
    yy, xx = np.mgrid[0:S, 0:S]
    for i in range(planks_x):
        x0 = i * pw
        offs = rng.integers(0, S)
        seg = S // 2
        for k in range(3):
            y0 = (offs + k * seg) % S
            tone = rng.uniform(0.75, 1.1)
            base = np.array([150, 98, 58]) * tone
            mask = (xx >= x0) & (xx < x0 + pw) & (((yy - y0) % S) < seg)
            stripes = np.sin((xx + grain * 60 + rng.uniform(0, 50)) * 0.35 + grain * 8) * 0.5 + 0.5
            g = (stripes * 0.18 + grain * 0.25 + 0.7)
            for c in range(3):
                img[..., c] = np.where(mask, base[c] * g, img[..., c])
            # seam at plank end
            seam = mask & ((((yy - y0) % S) < 3))
            img[seam] *= 0.45
            h[seam] = -1
        img[:, x0:x0 + 3] *= 0.45
        h[:, x0:x0 + 3] = -1
    save(img, "wood.jpg")
    save(normal_from_height(h * 0.6 + grain * 0.4, 3), "wood_n.jpg")


def rubber(S=512):
    base = noise(S, 8, 3, 2) * 18 + 32
    img = np.dstack([base] * 3)
    flecks = rng.random((S, S))
    cols = [(150, 40, 30), (60, 70, 140), (120, 120, 120)]
    for i, c in enumerate(cols):
        m = (flecks > 0.985 - i * 0.004) & (flecks <= 0.99 - i * 0.004 + 0.008)
        img[m] = c
    # tile seams every 1/2 texture
    for t in (0, S // 2):
        img[t:t + 2, :] *= 0.4
        img[:, t:t + 2] *= 0.4
    save(img, "rubber.jpg")


def brick(S=1024):
    rows, cols = 16, 8
    bh, bw = S // rows, S // cols
    img = np.zeros((S, S, 3), np.float32)
    h = np.zeros((S, S), np.float32)
    n1 = noise(S, 16, 4, 3)
    n2 = noise(S, 64, 2, 4)
    mortar = np.array([150, 140, 128], np.float32)
    img[:] = mortar * (0.8 + n2[..., None] * 0.3)
    for r in range(rows):
        off = (bw // 2) * (r % 2)
        for c in range(cols + 1):
            x0 = c * bw - off
            tone = rng.uniform(0.6, 1.05)
            col = np.array(rng.choice([[128, 52, 38], [110, 44, 34], [140, 66, 46], [92, 40, 34]]), np.float32) * tone
            y0 = r * bh
            xs = slice(max(0, x0 + 3), min(S, x0 + bw - 3))
            ys = slice(y0 + 3, y0 + bh - 3)
            if xs.start >= xs.stop:
                continue
            region = n1[ys, xs][..., None] * 0.35 + 0.75 + n2[ys, xs][..., None] * 0.15
            img[ys, xs] = col * region
            h[ys, xs] = 1 + n2[ys, xs] * 0.3
            # wrap for tiling
            if x0 + bw > S:
                xs2 = slice(0, x0 + bw - 3 - S)
                img[ys, xs2] = col * (n1[ys, xs2][..., None] * 0.35 + 0.75)
                h[ys, xs2] = 1
            if x0 < 0:
                xs2 = slice(S + x0 + 3, S)
                img[ys, xs2] = col * (n1[ys, xs2][..., None] * 0.35 + 0.75)
                h[ys, xs2] = 1
    hb = np.asarray(Image.fromarray((h * 120).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)), np.float32) / 120
    save(img, "brick.jpg")
    save(normal_from_height(hb, 2.5), "brick_n.jpg")


def concrete(S=512):
    n = noise(S, 6, 5, 5)
    v = 95 + n * 50
    save(np.dstack([v, v * 0.98, v * 0.95]), "concrete.jpg")


def leather(S=512):
    n = noise(S, 24, 3, 6)
    cr = noise(S, 4, 4, 7)
    creases = np.abs(np.sin(cr * 40)) ** 0.2
    v = 205 + n * 30 - (1 - creases) * 22
    img = np.dstack([v, v, v])
    # stitched seams top/bottom of bag (v=0.08 and 0.92)
    for y in (int(S * 0.04), int(S * 0.96)):
        img[y - 2:y + 2, :] *= 0.55
        for x in range(0, S, 10):
            img[y - 6:y - 3, x:x + 5] = 245
    save(img, "leather.jpg")
    for name, tint in (("red", (0.62, 0.06, 0.05)), ("black", (0.09, 0.09, 0.1)), ("blue", (0.07, 0.17, 0.55))):
        save(img * np.array(tint, np.float32), f"leather_{name}.jpg")
    h = n * 0.7 + creases * 0.3
    save(normal_from_height(h, 2), "leather_n.jpg")


def text_img(w, h, bg, lines, name, accent=None):
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    if accent:
        accent(d, w, h)
    for (txt, size, color, y) in lines:
        f = ImageFont.truetype(FONT_COND, size)
        tw = d.textlength(txt, font=f)
        d.text(((w - tw) / 2, y), txt, font=f, fill=color)
    # grain
    arr = np.asarray(im, np.float32)
    arr *= (0.9 + noise(max(w, h), 32, 2, 9)[:h, :w, None] * 0.15)
    save(arr, name)


def posters():
    def stripes(d, w, h):
        for i in range(-h, w, 60):
            d.polygon([(i, h), (i + 30, h), (i + 30 + h, 0), (i + h, 0)], fill=(40, 10, 10))
        d.ellipse((w * 0.2, h * 0.28, w * 0.8, h * 0.28 + w * 0.6), outline=(230, 40, 40), width=14)

    text_img(512, 768, (18, 18, 20), [
        ("ТРЕНИРУЙСЯ", 58, (240, 240, 240), 40),
        ("ЖЁСТКО", 88, (230, 40, 40), 110),
        ("БЕЙ", 120, (255, 200, 40), 330),
        ("СИЛЬНЕЕ", 92, (240, 240, 240), 600),
    ], "poster1.jpg", stripes)

    def ring(d, w, h):
        d.rectangle((0, 0, w, h), fill=(200, 30, 30))
        d.rectangle((24, 24, w - 24, h - 24), outline=(255, 220, 120), width=8)
        # stylised glove
        d.rounded_rectangle((w * 0.28, h * 0.32, w * 0.72, h * 0.62), 70, fill=(20, 20, 20))
        d.rounded_rectangle((w * 0.36, h * 0.6, w * 0.64, h * 0.72), 20, fill=(240, 240, 240))
    text_img(512, 768, (200, 30, 30), [
        ("БОЙ ГОДА", 90, (255, 230, 150), 60),
        ("СУББОТА · 20:00", 46, (255, 255, 255), 600),
        ("НЕ СДАВАЙСЯ", 52, (20, 20, 20), 670),
    ], "poster2.jpg", ring)

    def grid(d, w, h):
        for i in range(0, w, 32):
            d.line((i, 0, i, h), fill=(25, 35, 60), width=2)
        for j in range(0, h, 32):
            d.line((0, j, w, j), fill=(25, 35, 60), width=2)
    text_img(512, 768, (14, 20, 40), [
        ("БОЛЬ", 120, (90, 170, 255), 80),
        ("ВРЕМЕННА", 80, (240, 240, 240), 220),
        ("СЛАВА", 120, (255, 210, 60), 420),
        ("ВЕЧНА", 120, (255, 210, 60), 560),
    ], "poster3.jpg", grid)


def ring_canvas(S=1024):
    im = Image.new("RGB", (S, S), (30, 70, 150))
    d = ImageDraw.Draw(im)
    d.ellipse((S * 0.22, S * 0.22, S * 0.78, S * 0.78), fill=(235, 235, 235))
    d.ellipse((S * 0.26, S * 0.26, S * 0.74, S * 0.74), fill=(200, 30, 30))
    f = ImageFont.truetype(FONT_COND, 120)
    for txt, y in (("Я", S * 0.33), ("БОЕЦ", S * 0.48)):
        tw = d.textlength(txt, font=f)
        d.text(((S - tw) / 2, y), txt, font=f, fill=(255, 255, 255))
    arr = np.asarray(im, np.float32) * (0.85 + noise(S, 32, 3, 11)[..., None] * 0.2)
    save(arr, "canvas.jpg")


def apron(S=1024):
    im = Image.new("RGB", (S, 128), (15, 15, 18))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT_COND, 80)
    txt = "Я БОЕЦ  ★  BOXING CLUB  ★  "
    x = 10
    while x < S:
        d.text((x, 18), txt, font=f, fill=(230, 40, 40) if (x // 10) % 2 == 0 else (255, 255, 255))
        x += d.textlength(txt, font=f)
    save(np.asarray(im, np.float32), "apron.jpg")


def night(W=1024, H=512):
    y = np.linspace(0, 1, H)[:, None]
    sky = np.dstack([10 + 30 * y, 14 + 40 * y, 40 + 70 * y]) * np.ones((1, W, 1))
    img = sky.astype(np.float32)
    stars = rng.random((H, W)) > 0.9985
    img[stars & (y < 0.5)] = 230
    for layer, (tone, hmin, hmax) in enumerate(((22, 0.25, 0.55), (12, 0.35, 0.8))):
        x = 0
        while x < W:
            bw = int(rng.integers(40, 110))
            top = int(H * (1 - rng.uniform(hmin, hmax)))
            img[top:, x:x + bw] = tone
            for wy in range(top + 10, H - 6, 18):
                for wx in range(x + 6, x + bw - 8, 14):
                    if rng.random() < 0.35:
                        img[wy:wy + 8, wx:wx + 7] = (255, 200, 110) if rng.random() < 0.8 else (170, 210, 255)
            x += bw + int(rng.integers(0, 12))
    save(img, "night.jpg")


wood_floor(); rubber(); night(); brick(); concrete(); leather(); posters(); ring_canvas(); apron()
print("textures ->", OUT, sorted(os.listdir(OUT)))
