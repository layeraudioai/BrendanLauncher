from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont
root=Path(__file__).resolve().parent
sys.path.insert(0, str(root.parents[1]))
from scripts.font_path import font_path
font=font_path('DejaVuSans.ttf')

atlas=Image.new('L',(1024,2048));draw=ImageDraw.Draw(atlas);header=[];y=2
for name,label,size in [('TITLE','Standalone Client Installer',54),('SUBTITLE','Packs HBLauncher & assets into SB4 save slots.',24),('STATUS','READY: Press A to pack into SB4 save data',22),('RETURN','B or Minus to return to HBLauncher',20)]:
 face=ImageFont.truetype(font,size);box=draw.textbbox((0,0),label,font=face);w,h=box[2]-box[0],box[3]-box[1]
 draw.text((2-box[0],y-box[1]),label,font=face,fill=255)
 header.append(f'const ivec4 TEXT_{name} = ivec4(2, {y}, {w}, {h});');y+=h+8
(root/'assets/text.bin').write_bytes(atlas.tobytes());(root/'shaders/text.glsl').write_text('\n'.join(header)+('\n'))
im=Image.new('RGBA',(256,256),(20,40,60,255));d=ImageDraw.Draw(im)
d.rounded_rectangle((26,42,230,214),radius=22,fill=(30,70,100),outline=(100,240,255),width=5)
d.rectangle((64,80,192,140),fill=(40,90,130),outline=(120,255,220),width=3)
d.text((80,95),'INSTALL',font=ImageFont.truetype(font,24),fill=(255,255,255))
im.save(root/'assets/icon.png')
