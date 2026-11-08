"""Generate Sphaira assets, icon, and dynamic RomFS explorer text atlas for Switch 2 HBL framework."""
from pathlib import Path
import sys
import json
import shutil
import tempfile
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
sys.path.insert(0, str(root.parents[1]))
from scripts.font_path import font_path
assets_dir = root / 'assets'
assets_dir.mkdir(exist_ok=True)

workspace_root = root.parent.parent.parent

font = font_path('DejaVuSans.ttf')

atlas = Image.new('L', (1024, 2048))
draw = ImageDraw.Draw(atlas)
header = []
items = [
    ('TITLE', 'Sphaira - Switch 2 Homebrew Menu & Tool Suite', 32),
    ('SUBTITLE', 'D-Pad: Navigate | Left/Right: Tab | A: Select/Enter | B: Back/Exit', 16),
    ('TAB_HOME', '1. Homebrew', 18),
    ('TAB_BROWSER', '2. File Browser & RomFS', 18),
    ('TAB_STORE', '3. AppStore', 18),
    ('TAB_TOOLS', '4. Tools & Network', 18),
    ('STATUS_READY', 'Ready. Press A to explore or select option.', 16),
    ('CONTROLS', 'Homebrew Menu | File Browser & RomFS | AppStore | Network Tools', 16),
]
for name, label, size in items:
    face = ImageFont.truetype(font, size)
    box = draw.textbbox((0, 0), label, font=face)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((2 - box[0], y := locals().get('y', 2) - box[1]), label, font=face, fill=255)
    header.append(f'const ivec4 TEXT_{name} = ivec4(2, {y}, {w}, {h});')
    y += h + 8

tabs = ['Homebrew Apps', 'File Browser & RomFS', 'AppStore', 'Tools & Network']
header.append(f'const int NUM_TABS = {len(tabs)};')

# Dynamic scan of workspace for NRO files
app_entries = []
for p in sorted(workspace_root.glob('*.nro')):
    app_entries.append(f"{p.name} - Homebrew App")
switch_dir = workspace_root / 'switch'
if switch_dir.exists():
    for p in sorted(switch_dir.glob('*.nro')):
        app_entries.append(f"switch/{p.name} - System / Tool")

if not app_entries:
    app_entries = ['hbmenu.nro - Homebrew Menu Loader']

header.append(f'const int NUM_APPS = {len(app_entries)};')
for i in range(16):
    label = app_entries[i] if i < len(app_entries) else ''
    face = ImageFont.truetype(font, 20)
    box = draw.textbbox((0, 0), label, font=face)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((2 - box[0], y - box[1]), label, font=face, fill=255)
    header.append(f'const ivec4 TEXT_APP_{i} = ivec4(2, {y}, {w}, {h});')
    y += h + 8

# Root Browser Entries
browser_root_entries = ['sd:/switch/', 'sd:/atmosphere/contents/', 'sd:/romfs/ (Mounted Game Storage)']
for p in sorted(workspace_root.iterdir()):
    if p.is_dir() and not p.name.startswith('.'):
        browser_root_entries.append(f"sd:/{p.name}/")
if switch_dir.exists():
    for p in sorted(switch_dir.glob('*.nro')):
        browser_root_entries.append(f"sd:/switch/{p.name}")

header.append(f'const int NUM_BROWSER_ROOT = {len(browser_root_entries)};')
for i in range(16):
    label = browser_root_entries[i] if i < len(browser_root_entries) else ''
    face = ImageFont.truetype(font, 20)
    box = draw.textbbox((0, 0), label, font=face)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((2 - box[0], y - box[1]), label, font=face, fill=255)
    header.append(f'const ivec4 TEXT_BROWSER_ROOT_{i} = ivec4(2, {y}, {w}, {h});')
    y += h + 8

# Sub Browser Entries (RomFS / Mod Explorer View)
browser_sub_entries = [
    '< Back to Root Browser >',
    'sd:/atmosphere/contents/0100000000010000/romfs/',
    'sd:/atmosphere/contents/0100000000010000/romfs/romfs.bin (Size: 1.4GB)',
    'sd:/atmosphere/contents/0100000000010000/romfs/patch.ips (Mod Patch)',
    'sd:/atmosphere/contents/0100000000010000/exefs/',
    'sd:/romfs/romfs-master.bin (Mounted Game Dump)',
    'sd:/romfs/exefs/main.npdm'
]

header.append(f'const int NUM_BROWSER_SUB = {len(browser_sub_entries)};')
for i in range(16):
    label = browser_sub_entries[i] if i < len(browser_sub_entries) else ''
    face = ImageFont.truetype(font, 20)
    box = draw.textbbox((0, 0), label, font=face)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((2 - box[0], y - box[1]), label, font=face, fill=255)
    header.append(f'const ivec4 TEXT_BROWSER_SUB_{i} = ivec4(2, {y}, {w}, {h});')
    y += h + 8

store_entries = [
    'HB AppStore - Online Homebrew Catalog',
    'Themezer - Switch Theme Repository',
    'Ownfoil - Library Manager & Sync',
    'Switchports - Port Collection'
]
header.append(f'const int NUM_STORE = {len(store_entries)};')
for i in range(16):
    label = store_entries[i] if i < len(store_entries) else ''
    face = ImageFont.truetype(font, 20)
    box = draw.textbbox((0, 0), label, font=face)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((2 - box[0], y - box[1]), label, font=face, fill=255)
    header.append(f'const ivec4 TEXT_STORE_{i} = ivec4(2, {y}, {w}, {h});')
    y += h + 8

tools_entries = [
    'USB Install (Tinfoil / ns-usbloader protocol)',
    'FTP Server (ftpsrv file transfer / mod install)',
    'MTP Responder (USB mass media transfer)',
    'OunceCake RomFS Dumper & Exporter',
    'System Information & Battery Status'
]
header.append(f'const int NUM_TOOLS = {len(tools_entries)};')
for i in range(16):
    label = tools_entries[i] if i < len(tools_entries) else ''
    face = ImageFont.truetype(font, 20)
    box = draw.textbbox((0, 0), label, font=face)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((2 - box[0], y - box[1]), label, font=face, fill=255)
    header.append(f'const ivec4 TEXT_TOOL_{i} = ivec4(2, {y}, {w}, {h});')
    y += h + 8

im = Image.new('RGBA', (256, 256), (20, 24, 36, 255))
d = ImageDraw.Draw(im)
d.rounded_rectangle((28, 28, 228, 228), radius=32, fill=(32, 40, 60), outline=(90, 180, 255), width=6)
d.ellipse((80, 80, 176, 176), fill=(50, 120, 200), outline=(150, 220, 255), width=4)
im.save(assets_dir / 'icon.png')

(assets_dir / 'text.bin').write_bytes(atlas.tobytes())
shaders_dir = root / 'shaders'
shaders_dir.mkdir(exist_ok=True)
(shaders_dir / 'text.glsl').write_text('\n'.join(header) + '\n')

# Create dummy audio PCM effects
audio_dir = assets_dir
for i in range(1, 3):
    pcm_path = audio_dir / f'audio_{i}.pcm'
    pcm_path.write_bytes(b'\x00\x00\x00\x00' * 12000)

print('Sphaira RomFS explorer assets generated successfully.')
