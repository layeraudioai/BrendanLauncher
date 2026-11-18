#!/usr/bin/env python3
"""Build the Moonlight ABI-1 GPU app assets.

Everything that costs CPU on a real GPU app has to be baked here, because an
ABI-1 package is shaders plus two data blobs: there is no app code, no runtime
font rasteriser and no filesystem on the console.

Outputs
-------
assets/text.bin     1024x1024 R8 static label atlas (1 MiB, first page of the
                    app data buffer).
assets/state.bin    1024-byte ABI-1 initial state (fade-in opacity preset).
assets/icon.png     256x256 catalog icon.
assets/audio_*.pcm  Silent 120 ms stereo PCM placeholders for the manifest's
                    sound-event slots. The PC host overwrites them at run time
                    with decoded game audio ("network filesystem").
shaders/text.glsl   Generated GLSL constants: label rectangles plus every
                    buffer offset shared with the JS host.
host/font.json      Host-side glyph pack so the PC can rasterise dynamic text
                    (host names, game titles, pairing PIN) without Pillow.
"""
from __future__ import annotations

import base64
import json
import math
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
SHADERS = ROOT / "shaders"
HOST = ROOT / "host"
for folder in (ASSETS, SHADERS, HOST):
    folder.mkdir(exist_ok=True)

LAYOUT = json.loads((ROOT / "layout.json").read_text())
ATLAS = LAYOUT["atlas"]
BAND = LAYOUT["band"]
HEADER = LAYOUT["header"]
VIDEO = LAYOUT["video"]
AUDIO = LAYOUT["audio"]
BUFFER = LAYOUT["buffer"]


def fail(message: str) -> "None":
    raise SystemExit("assets.py: " + message)


def font_path() -> str:
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/Library/Fonts/Arial.ttf",
        "arial.ttf",
    ):
        try:
            ImageFont.truetype(candidate, 24)
            return candidate
        except OSError:
            continue
    fail("no TrueType font available; install DejaVu Sans (fonts-dejavu-core)")


FONT = font_path()

# Static labels are drawn 1:1 on the 1920x1080 canvas. The atlas is only 1024
# pixels wide, so keep baked strings inside the left half of the screen (the
# same constraint media-machine works under) and put everything dynamic in the
# host-rendered band instead.
LABELS = [
    ("BRAND", "MOONLIGHT", 34),
    ("TAGLINE", "GameStream over the BrendanLauncher bridge", 15),
    ("SECTION_HOSTS", "HOSTS", 17),
    ("SECTION_GAMES", "APPLICATIONS", 17),
    ("SECTION_PAIR", "PAIR A PC", 17),
    ("SECTION_STREAM", "STREAMING", 17),
    ("HINT_NAV", "D-Pad: move   A: select   B: back", 15),
    ("HINT_PAIR", "Enter the PIN in Sunshine, then press A", 15),
    ("HINT_STREAM", "Minus+Plus: stop stream   B: leave app", 15),
    ("BADGE_LIVE", "LIVE", 16),
    ("EMPTY_HOSTS", "No paired PC yet: choose Pair a PC", 17),
    ("EMPTY_GAMES", "The host returned no applications", 17),
]


def build_atlas() -> tuple[bytes, list[str]]:
    image = Image.new("L", (ATLAS["width"], ATLAS["height"]))
    draw = ImageDraw.Draw(image)
    lines: list[str] = []
    y = 4
    for name, text, size in LABELS:
        face = ImageFont.truetype(FONT, size)
        box = draw.textbbox((0, 0), text, font=face)
        width, height = box[2] - box[0], box[3] - box[1]
        if width > ATLAS["width"] - 4:
            fail(f"static label {name} is wider than the atlas page")
        draw.text((2 - box[0], y - box[1]), text, font=face, fill=255)
        lines.append(f"const ivec4 TEXT_{name} = ivec4(2, {y}, {width}, {height});")
        y += height + 10
    if y >= ATLAS["height"]:
        fail("static label atlas overflow")
    return image.tobytes(), lines


def build_icon() -> None:
    image = Image.new("RGBA", (256, 256), (8, 14, 30, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((18, 34, 238, 222), radius=26, fill=(18, 32, 58), outline=(96, 214, 255), width=5)
    # Moon crescent plus a small controller silhouette: readable at catalog size.
    draw.ellipse((44, 66, 150, 172), fill=(180, 235, 255))
    draw.ellipse((72, 58, 178, 164), fill=(18, 32, 58))
    draw.rounded_rectangle((120, 128, 232, 200), radius=24, fill=(30, 74, 120), outline=(120, 240, 255), width=3)
    draw.ellipse((140, 158, 154, 172), fill=(150, 250, 220))
    draw.ellipse((196, 158, 210, 172), fill=(150, 250, 220))
    draw.rectangle((164, 160, 186, 170), fill=(150, 250, 220))
    image.save(ASSETS / "icon.png")


def build_state() -> None:
    # 960 = fade-in opacity (already opaque), 964 = requested mode.
    state = bytearray(1024)
    state[960:964] = struct.pack("<f", 1.0)
    (ASSETS / "state.bin").write_bytes(bytes(state))


def glyph_pack(size: int) -> dict:
    """1-bit glyph bitmaps for printable ASCII, drawn at band resolution."""
    face = ImageFont.truetype(FONT, size)
    ascent, descent = face.getmetrics()
    glyphs = {}
    for code in range(32, 127):
        char = chr(code)
        if char == " ":
            advance = int(round(face.getlength(" ")))
            glyphs[char] = {"w": 0, "h": 0, "adv": advance, "ox": 0, "oy": 0, "bits": ""}
            continue
        box = face.getbbox(char)
        if box is None:
            glyphs[char] = {"w": 0, "h": 0, "adv": 0, "ox": 0, "oy": 0, "bits": ""}
            continue
        cell = Image.new("L", (max(1, box[2] - box[0]), max(1, box[3] - box[1])))
        ImageDraw.Draw(cell).text((-box[0], -box[1]), char, font=face, fill=255)
        width, height = cell.size
        row_bytes = (width + 7) // 8
        payload = bytearray(row_bytes * height)
        pixels = cell.load()
        for y in range(height):
            for x in range(width):
                if pixels[x, y] >= 128:
                    payload[y * row_bytes + (x >> 3)] |= 0x80 >> (x & 7)
        glyphs[char] = {
            "w": width,
            "h": height,
            "adv": int(round(face.getlength(char))),
            "ox": box[0],
            "oy": box[1],
            "bits": base64.b64encode(bytes(payload)).decode("ascii"),
        }
    return {
        "size": size,
        "ascent": ascent,
        "descent": descent,
        "lineHeight": ascent + descent,
        "glyphs": glyphs,
    }


def build_font_pack() -> None:
    # Band pixels are 1/scale of screen pixels, so pick sizes in band space.
    sizes = [int(round(px * BAND["scale"])) for px in (14, 16, 20, 26, 34)]
    pack = {
        "version": 1,
        "bandScale": BAND["scale"],
        "bandWidth": BAND["width"],
        "bandHeight": BAND["height"],
        "font": Path(FONT).name,
        "sizes": {str(size): glyph_pack(size) for size in sizes},
    }
    (HOST / "font.json").write_text(json.dumps(pack))


def pcm_tone(milliseconds: int, frequency: float, level: float) -> bytes:
    """Stereo s16le blip; the console only ever plays what is baked here."""
    rate, channels = AUDIO["sampleRate"], AUDIO["channels"]
    frames = rate * milliseconds // 1000
    out = bytearray(frames * channels * 2)
    for i in range(frames):
        t = i / rate
        attack = min(1.0, t / 0.004)
        envelope = attack * (1.0 - i / frames) ** 1.7
        sample = int(round(32767 * level * envelope * math.sin(2 * math.pi * frequency * t)))
        for channel in range(channels):
            out[(i * channels + channel) * 2:(i * channels + channel) * 2 + 2] = struct.pack("<h", sample)
    return bytes(out)


def build_audio() -> list[str]:
    """Effect 1/2 are UI sounds; the ring slots start silent and are replaced by
    the PC host with decoded game audio at run time."""
    chunk = AUDIO["sampleRate"] * AUDIO["channels"] * 2 * AUDIO["chunkMs"] // 1000
    click = pcm_tone(28, 880.0, 0.16)
    error = pcm_tone(120, 220.0, 0.20)
    effects = []
    for slot in range(1, AUDIO["ringFirstSlot"] + AUDIO["ringSlots"]):
        name = f"audio_{slot}.pcm"
        if slot == AUDIO["clickEffect"]:
            payload = click
        elif slot == AUDIO["errorEffect"]:
            payload = error
        else:
            payload = bytes(chunk)
        (ASSETS / name).write_bytes(payload)
        effects.append(name)
    return effects


def emit_glsl(labels: list[str]) -> None:
    def word(absolute: int) -> int:
        relative = absolute - BUFFER["appDataOffset"]
        if relative % 4:
            fail(f"offset {absolute} is not word aligned")
        return relative // 4

    lines = [
        "// Generated by assets.py from layout.json. Do not edit by hand.",
        f"const int ATLAS_WIDTH = {ATLAS['width']};",
        f"const int ATLAS_HEIGHT = {ATLAS['height']};",
        f"const uint BAND_WORD = {word(BAND['offset'])}u;",
        f"const uint BAND_WIDTH = {BAND['width']}u;",
        f"const uint BAND_HEIGHT = {BAND['height']}u;",
        f"const float BAND_SCALE = {BAND['scale']};",
        f"const uint HDR_WORD = {word(HEADER['offset'])}u;",
        f"const uint VIDEO_WORD = {word(VIDEO['offset'])}u;",
        f"const uint VIDEO_STRIDE = {VIDEO['bytesPerSlot'] // 4}u;",
        f"const uint VIDEO_WIDTH = {VIDEO['width']}u;",
        f"const uint VIDEO_HEIGHT = {VIDEO['height']}u;",
        f"const int VIDEO_SLOTS = {VIDEO['slots']};",
        f"const int AUDIO_RING_SLOTS = {AUDIO['ringSlots']};",
        f"const int AUDIO_RING_FIRST = {AUDIO['ringFirstSlot']};",
        "// Header word indices (bytes are word * 4 inside the header block).",
        "const uint H_MAGIC = 0u;",
        "const uint H_VERSION = 1u;",
        "const uint H_FRAME_SEQ = 2u;",
        "const uint H_FRAME_SLOT = 3u;",
        "const uint H_FLAGS = 6u;",
        "const uint H_BAND_SEQ = 7u;",
        "const uint H_SCENE = 8u;",
        "const uint H_STATUS = 9u;",
        "const uint H_ITEMS = 10u;",
        "const uint H_SELECTED = 11u;",
        "const uint H_AUDIO_SEQ = 12u;",
        "const uint H_AUDIO_SLOT = 13u;",
        "const uint H_AUDIO_CONSUMED = 14u;",
        "const uint H_HOSTS = 16u;",
        "const uint H_GAMES = 17u;",
        "const uint H_FPS = 18u;",
        "const uint H_LATENCY = 19u;",
        "const uint H_ITEMS_BASE = 24u;",
        "const uint H_CMD = 192u;",
        "const uint H_CMD_ARG0 = 193u;",
        "const uint H_CMD_ARG1 = 194u;",
        "const uint H_CMD_SEQ = 195u;",
        "const uint H_CMD_ACK = 196u;",
        "const uint H_CMD_STATUS = 197u;",
        "const uint H_MAGIC_VALUE = 0x4E4C424Du;",
        "// Header flag bits.",
        "const uint FLAG_VIDEO = 1u;",
        "const uint FLAG_STREAMING = 2u;",
        "const uint FLAG_BUSY = 4u;",
        "// Scenes the host draws content for.",
        "const uint SCENE_HOSTS = 0u;",
        "const uint SCENE_GAMES = 1u;",
        "const uint SCENE_PAIR = 2u;",
        "const uint SCENE_STREAM = 3u;",
        "const uint SCENE_MESSAGE = 4u;",
        "// Commands the app posts for the host to execute.",
        "const uint CMD_NONE = 0u;",
        "const uint CMD_PAIR = 1u;",
        "const uint CMD_OPEN_HOST = 2u;",
        "const uint CMD_OPEN_GAME = 3u;",
        "const uint CMD_REFRESH = 4u;",
        "const uint CMD_START = 5u;",
        "const uint CMD_STOP = 6u;",
        "const uint CMD_QUIT = 7u;",
        "const uint CMD_BACK = 8u;",
        "const uint CMD_RETRY = 9u;",
        *labels,
        "",
    ]
    (SHADERS / "text.glsl").write_text("\n".join(lines))


def write_manifest(effects: list[str]) -> None:
    """Rewrite only the audio section; the rest of app.json is hand-authored."""
    path = ROOT / "app.json"
    manifest = json.loads(path.read_text())
    manifest["audio"] = {
        "sampleRate": AUDIO["sampleRate"],
        "channels": AUDIO["channels"],
        "format": "s16le",
        "effects": {str(index + 1): f"assets/{name}" for index, name in enumerate(effects)},
    }
    path.write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    atlas, labels = build_atlas()
    expected = ATLAS["width"] * ATLAS["height"]
    if len(atlas) != expected:
        fail("atlas size differs from layout.json")
    (ASSETS / "text.bin").write_bytes(atlas)
    build_icon()
    build_state()
    write_manifest(build_audio())
    build_font_pack()
    emit_glsl(labels)
    print(f"Moonlight assets: atlas {ATLAS['width']}x{ATLAS['height']}, "
          f"band {BAND['width']}x{BAND['height']}, "
          f"video {VIDEO['width']}x{VIDEO['height']}x{VIDEO['slots']}, "
          f"audio ring {AUDIO['ringSlots']}x{AUDIO['chunkMs']}ms starting at effect "
          f"{AUDIO['ringFirstSlot']}")


if __name__ == "__main__":
    sys.exit(main())
