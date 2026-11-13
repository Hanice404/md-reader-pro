#!/usr/bin/env node
/** Generate the extension icon set from a vector-ish PIL drawing. */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets/icons');
mkdirSync(outDir, { recursive: true });

const script = String.raw`
from PIL import Image, ImageDraw, ImageFont
import os, sys

S = 512
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded-square gradient background
radius = 118
grad = Image.new('RGBA', (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
top = (99, 102, 241)
bottom = (124, 58, 237)
for y in range(S):
    t = y / (S - 1)
    r = round(top[0] + (bottom[0] - top[0]) * t)
    g = round(top[1] + (bottom[1] - top[1]) * t)
    b = round(top[2] + (bottom[2] - top[2]) * t)
    gd.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=radius, fill=255)
img.paste(grad, (0, 0), mask)

# Soft top highlight
hilite = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(hilite).ellipse((-160, -300, S + 160, 210), fill=(255, 255, 255, 38))
img = Image.alpha_composite(img, Image.composite(hilite, Image.new('RGBA', (S, S), (0, 0, 0, 0)), mask))

d = ImageDraw.Draw(img)
font_paths = [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
]
font = None
for p in font_paths:
    if os.path.exists(p):
        try:
            font = ImageFont.truetype(p, 300)
            break
        except Exception:
            pass
if font is None:
    font = ImageFont.load_default()

# White M
text = 'M'
bbox = d.textbbox((0, 0), text, font=font)
w = bbox[2] - bbox[0]
h = bbox[3] - bbox[1]
x = (S - w) / 2 - bbox[0]
y = 96 - bbox[1]
d.text((x, y), text, font=font, fill=(255, 255, 255, 255))

# Down arrow under the M
cx = S // 2
arrow_top = 372
d.rounded_rectangle((cx - 24, arrow_top, cx + 24, arrow_top + 78), radius=18, fill=(255, 255, 255, 255))
d.polygon([(cx - 76, arrow_top + 56), (cx + 76, arrow_top + 56), (cx, arrow_top + 140)], fill=(255, 255, 255, 255))

out = sys.argv[1]
img.save(os.path.join(out, 'icon512.png'))
for size in (128, 48, 32, 16):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(out, f'icon{size}.png'))
print('icons written to', out)
`;

execFileSync('python3', ['-c', script, outDir], { stdio: 'inherit' });
