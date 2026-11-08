"""Rasterize package labels/icons into a fixed GPU catalog buffer."""
import json, struct, sys, platform
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

apps=json.loads(Path(sys.argv[1]).read_text())
assert len(apps)<=32
slots=bytearray(32*131072)

sys_platform = platform.system()
candidates = []
if sys_platform == 'Windows':
    candidates = ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\segoeui.ttf']
elif sys_platform == 'Darwin':
    candidates = [
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/Library/Fonts/Arial.ttf',
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/SFNS.ttf'
    ]
else:
    candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        '/usr/share/fonts/dejavu/DejaVuSans.ttf'
    ]

font = candidates[0]
for path in candidates:
    if Path(path).exists():
        font = path
        break

for i,app in enumerate(apps):
    image=Image.new('L',(512,128)); draw=ImageDraw.Draw(image); sizes=[]
    for text,size,y in [(app['name'],34,0),(app['description'],18,64)]:
        face=ImageFont.truetype(font,size)
        while draw.textbbox((0,0),text,font=face)[2]>508:
            text=text[:-2]+'…'
        box=draw.textbbox((0,0),text,font=face)
        draw.text((-box[0],y-box[1]),text,fill=255,font=face)
        sizes.extend([box[2]-box[0],box[3]-box[1]])
    base=i*131072
    slots[base:base+65536]=image.tobytes()
    icon=Image.open(app['icon']); assert icon.width<=4096 and icon.height<=4096
    icon=ImageOps.contain(icon.convert('RGBA'),(96,96),Image.Resampling.LANCZOS)
    tile=Image.new('RGBA',(96,96));tile.alpha_composite(icon,((96-icon.width)//2,(96-icon.height)//2))
    slots[base+65536:base+102400]=tile.tobytes()
    struct.pack_into('<4I',slots,base+102400,*sizes)
Path(sys.argv[2]).write_bytes(slots)
