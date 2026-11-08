"""Generate deterministic text atlas, UI strings, and icon for YouTube (VacuumTube) Switch 2 app."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
sys.path.insert(0, str(root.parents[1]))
from scripts.font_path import font_path
assets_dir = root / 'assets'
shaders_dir = root / 'shaders'
assets_dir.mkdir(exist_ok=True)
shaders_dir.mkdir(exist_ok=True)

font = font_path('DejaVuSans.ttf')

atlas = Image.new('L', (1024, 2048))
draw = ImageDraw.Draw(atlas)
header = []
y = 2

items = [
    ('TITLE', 'YouTube (VacuumTube)', 36),
    ('SUBTITLE', 'TV Client & Media Streaming for Switch 2 HBL', 18),
    ('STATUS_READY', 'Ready. Select with D-Pad, A to play, X for AdBlock/SponsorBlock, B/Minus to exit.', 16),
    ('STATUS_SELECTED', 'Playing YouTube Video Stream on Switch 2', 16),
    ('CONTROLS', 'D-Pad: Navigate | A: Play/Select | X: Toggle AdBlock | Y: SponsorBlock | B/Minus: Exit', 18),
]

for name, label, size in items:
    face = ImageFont.truetype(font, size)
    box = draw.textbbox((0, 0), label, font=face)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((2 - box[0], y - box[1]), label, font=face, fill=255)
    header.append(f'const ivec4 TEXT_{name} = ivec4(2, {y}, {w}, {h});')
    y += h + 8

menu_items = [
    '1. Home / Recommended',
    '2. Trending & Popular',
    '3. Subscriptions Feed',
    '4. Search & Explore',
    '5. Library & Watch Later',
    '6. Settings: AdBlock (Enabled)',
    '7. Settings: SponsorBlock (Auto-Skip)',
    '8. Settings: DeArrow (Clean Titles)',
    '9. Settings: Return Dislike Data',
    '10. Settings: Resolution & Codecs',
    '11. Music Mode & Audio Stream',
    '12. About VacuumTube v2.0.1'
]

header.append(f'const int NUM_YOUTUBE_ITEMS = {len(menu_items)};')
for i, label in enumerate(menu_items):
    face = ImageFont.truetype(font, 20)
    box = draw.textbbox((0, 0), label, font=face)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((2 - box[0], y - box[1]), label, font=face, fill=255)
    header.append(f'const ivec4 TEXT_YT_ITEM_{i} = ivec4(2, {y}, {w}, {h});')
    y += h + 8

# Generate App Icon (YouTube red rounded rect with play triangle)
im = Image.new('RGBA', (256, 256), (20, 20, 20, 255))
d = ImageDraw.Draw(im)
d.rounded_rectangle((28, 56, 228, 200), radius=36, fill=(225, 0, 0), outline=(255, 255, 255), width=4)
d.polygon([(105, 95), (105, 161), (165, 128)], fill=(255, 255, 255))
im.save(assets_dir / 'icon.png')

atlas_bytes = atlas.tobytes()
(assets_dir / 'text.bin').write_bytes(atlas_bytes)
(shaders_dir / 'text.glsl').write_text('\n'.join(header) + '\n')
print(f'Generated YouTube assets successfully ({len(atlas_bytes)} bytes).')
