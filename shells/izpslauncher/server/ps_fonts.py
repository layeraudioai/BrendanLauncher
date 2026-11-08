"""Resolve DejaVu or equivalent Windows fonts without machine-local paths."""
from pathlib import Path
import os

def font(name='DejaVuSans.ttf'):
    explicit=os.environ.get('HB_FONT')
    windows=Path(os.environ.get('WINDIR', r'C:\Windows'))/'Fonts'
    folders=([Path(explicit).parent] if explicit else [])+[
        Path(os.environ.get('HB_FONT_DIR','/nonexistent')),
        Path('/usr/share/fonts/truetype/dejavu'),Path('/usr/share/fonts/TTF'),windows]
    for folder in folders:
        if (folder/name).is_file():return str(folder/name)
    alternatives={
      'DejaVuSans.ttf':'arial.ttf','DejaVuSans-ExtraLight.ttf':'arial.ttf',
      'DejaVuSans-Bold.ttf':'arialbd.ttf','DejaVuSans-Oblique.ttf':'ariali.ttf',
      'DejaVuSans-BoldOblique.ttf':'arialbi.ttf',
    }
    alt=alternatives.get(name)
    if alt:
        for folder in folders:
            if (folder/alt).is_file():return str(folder/alt)
    if name!='DejaVuSans.ttf':return font()
    raise FileNotFoundError('Install DejaVu Sans or set HB_FONT/HB_FONT_DIR')
