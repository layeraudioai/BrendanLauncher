"""Locate compatible fonts for generated launcher/app assets on Windows and Unix."""
from pathlib import Path
import os


def font_path(name="DejaVuSans.ttf"):
    explicit = os.environ.get("HB_FONT")
    if explicit and Path(explicit).is_file():
        return str(Path(explicit))
    windows = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    search = [Path(os.environ.get("HB_FONT_DIR", "/nonexistent")),
              Path("/usr/share/fonts/truetype/dejavu"), Path("/usr/share/fonts/TTF"),
              Path("/usr/share/fonts"), windows]
    for directory in search:
        candidate = directory / name
        if candidate.is_file():
            return str(candidate)
    fallback = {
        "DejaVuSans.ttf": "arial.ttf",
        "DejaVuSans-Bold.ttf": "arialbd.ttf",
        "DejaVuSans-Oblique.ttf": "ariali.ttf",
        "DejaVuSans-BoldOblique.ttf": "arialbi.ttf",
        "DejaVuSansMono.ttf": "consola.ttf",
        "DejaVuSansMono-Bold.ttf": "consolab.ttf",
    }.get(name)
    if fallback:
        for directory in [windows, *search]:
            candidate = directory / fallback
            if candidate.is_file():
                return str(candidate)
    raise FileNotFoundError(f"Cannot find {name}; install DejaVu Sans or set HB_FONT/HB_FONT_DIR")
