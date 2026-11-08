"""Build deterministic audio and video streaming assets for Media Machine."""
from pathlib import Path
import sys
import json
import shutil
import subprocess
import tempfile
import time
from PIL import Image, ImageDraw, ImageFont

def robust_replace(src, dst, retries=10, delay=0.3):
    for attempt in range(retries):
        try:
            Path(src).replace(dst)
            return
        except (PermissionError, OSError):
            if attempt == retries - 1:
                raise
            time.sleep(delay)

def robust_unlink(p, retries=10, delay=0.3):
    path_obj = Path(p)
    if not path_obj.exists():
        return
    for attempt in range(retries):
        try:
            path_obj.unlink(missing_ok=True)
            return
        except (PermissionError, OSError):
            if attempt == retries - 1:
                raise
            time.sleep(delay)

def robust_write_bytes(p, data, retries=10, delay=0.3):
    path_obj = Path(p)
    chunk_size = 64 * 1024 * 1024
    for attempt in range(retries):
        try:
            with open(path_obj, 'wb') as f:
                if isinstance(data, (bytes, bytearray, memoryview)):
                    total = len(data)
                    for offset in range(0, total, chunk_size):
                        f.write(data[offset:offset + chunk_size])
                else:
                    f.write(data)
            return
        except (PermissionError, OSError):
            if attempt == retries - 1:
                raise
            time.sleep(delay)

root = Path(__file__).resolve().parent
sys.path.insert(0, str(root.parents[1]))
from scripts.font_path import font_path
content_dir = root / 'content'
content_dir.mkdir(exist_ok=True)
assets_dir = root / 'assets'
assets_dir.mkdir(exist_ok=True)

AUDIO_EXTENSIONS = {'.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a', '.wma', '.opus', '.m4b'}
VIDEO_EXTENSIONS = {'.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.3gp', '.ts'}

files = sorted((p for p in content_dir.iterdir() if p.is_file() and
                p.suffix.lower() in AUDIO_EXTENSIONS | VIDEO_EXTENSIONS),
               key=lambda p: p.name.lower())[:31]
video_files = [p for p in files if p.suffix.lower() in VIDEO_EXTENSIONS]
if files and not shutil.which('ffmpeg'):
    raise SystemExit('FFmpeg is required to build media assets; install ffmpeg or set PATH.')

# The live GPU app has an 8 MiB storage buffer. Reserve one current RGB565
# frame after the 2 MiB text atlas and stream each decoded frame into that slot;
# do not bake 100 frames per clip into text.bin (that exceeded the runtime cap).
VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_FPS = 1600, 900, 5
VIDEO_FRAME_BYTES = VIDEO_WIDTH * VIDEO_HEIGHT * 2
VIDEO_FRAME_LIMIT = 100
ATLAS_BYTES = 1024 * 2048
MAX_APP_DATA_BYTES = 7 * 1024 * 1024
if ATLAS_BYTES + (VIDEO_FRAME_BYTES if video_files else 0) > MAX_APP_DATA_BYTES:
    raise SystemExit('Media Machine video slot exceeds the app storage limit.')

font = font_path('DejaVuSans.ttf')

atlas = Image.new('L', (1024, 2048))
draw = ImageDraw.Draw(atlas)
header = []
y = 2
items = [
    ('TITLE', 'Media Machine - Video and Audio', 36),
    ('SUBTITLE', 'Select with Up/Down; A plays video or audio', 18),
    ('STATUS_READY', ('Videos are streamed to 1600x900 at 5 fps.' if video_files else
                      'Add video or audio files to content/ to begin.'), 16),
    ('STATUS_SELECTED', 'Playing selected media on Switch 2', 16),
    ('CONTROLS', 'D-Pad: Navigate | A: Play | X: Stop | B/Minus: Exit', 18),
]
for name, label, size in items:
    face = ImageFont.truetype(font, size)
    box = draw.textbbox((0, 0), label, font=face)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((2 - box[0], y - box[1]), label, font=face, fill=255)
    header.append(f'const ivec4 TEXT_{name} = ivec4(2, {y}, {w}, {h});')
    y += h + 8

ui_files = files or [None]
header.append(f'const int NUM_FILES = {len(files)};')
header.append(f'const uint VIDEO_WIDTH = {VIDEO_WIDTH}u;')
header.append(f'const uint VIDEO_HEIGHT = {VIDEO_HEIGHT}u;')
header.append(f'const uint VIDEO_FRAME_BYTES = {VIDEO_FRAME_BYTES}u;')
for i in range(32):
    if i < len(ui_files) and ui_files[i] is None:
        label = 'No supported audio/video files found'
    elif i < len(ui_files):
        label = f'{i + 1}. {files[i].name}'
        if len(label) > 54:
            label = label[:51] + '...'
    else:
        label = ''
    face = ImageFont.truetype(font, 20)
    box = draw.textbbox((0, 0), label, font=face)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((2 - box[0], y - box[1]), label, font=face, fill=255)
    header.append(f'const ivec4 TEXT_FILE_{i} = ivec4(2, {y}, {w}, {h});')
    y += h + 8

im = Image.new('RGBA', (256, 256), (15, 32, 52, 255))
d = ImageDraw.Draw(im)
d.rounded_rectangle((26, 42, 230, 214), radius=22, fill=(28, 60, 90), outline=(80, 220, 240), width=5)
d.rectangle((60, 80, 196, 170), fill=(40, 90, 130), outline=(120, 240, 255), width=3)
d.polygon([(110, 105), (110, 145), (150, 125)], fill=(120, 255, 220))
im.save(assets_dir / 'icon.png')

atlas_bytes = atlas.tobytes()
video_payload = bytearray(VIDEO_FRAME_BYTES if video_files else 0)
video_meta = [(0, 0, 0) for _ in files]
video_stream_manifest = {}

for i, source in enumerate(files):
    if source.suffix.lower() in VIDEO_EXTENSIONS:
        # All video entries share a single scratch frame. Only the selected
        # clip is streamed, so this keeps the package well below the 7 MiB cap.
        offset = len(atlas_bytes)
        video_meta[i] = (offset, VIDEO_FRAME_LIMIT, VIDEO_FPS)
        video_stream_manifest[str(i)] = {
            'source': f'content/{source.name}',
            'offset': offset,
            'width': VIDEO_WIDTH,
            'height': VIDEO_HEIGHT,
            'frameRate': VIDEO_FPS,
            'frames': VIDEO_FRAME_LIMIT
        }

header.append('const ivec3 VIDEO_META[31] = ivec3[31](')
header.append(',\n'.join(f'    ivec3({offset}, {count}, {fps})' for offset, count, fps in video_meta + [(0, 0, 0)] * (31 - len(video_meta))))
header.append(');')

robust_write_bytes(assets_dir / 'text.bin', atlas_bytes + video_payload)
(assets_dir / 'video-stream.json').write_text(json.dumps(video_stream_manifest, indent=2) + '\n')
(root / 'shaders/text.glsl').write_text('\n'.join(header) + '\n')

audio_effects = {}
for i, source in enumerate(files, 1):
    target = assets_dir / f'audio_{i}.pcm'
    with tempfile.NamedTemporaryFile(prefix='media-machine-', suffix='.pcm', dir=assets_dir, delete=False) as tmp:
        temp_name = tmp.name
    try:
        command = [
            'ffmpeg', '-v', 'error', '-i', str(source), '-map', '0:a:0', '-vn', '-t', '0.5',
            '-acodec', 'pcm_s16le', '-f', 's16le', '-ar', '48000', '-ac', '2', '-y', temp_name,
        ]
        try:
            subprocess.run(command, check=True, timeout=1800)
        except subprocess.CalledProcessError:
            if source.suffix.lower() in VIDEO_EXTENSIONS:
                continue
            raise
        size = Path(temp_name).stat().st_size
        if not size or size % 4:
            if source.suffix.lower() in VIDEO_EXTENSIONS:
                continue
            raise RuntimeError(f'ffmpeg produced invalid stereo PCM for {source.name}')
        robust_replace(temp_name, target)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f'Could not decode {source.name}; verify the file has a playable audio stream') from exc
    finally:
        robust_unlink(temp_name)
    audio_effects[str(i)] = f'assets/audio_{i}.pcm'

manifest_path = root / 'app.json'
manifest = json.loads(manifest_path.read_text())
manifest['audio'] = {
    'sampleRate': 48000, 'channels': 2, 'format': 's16le', 'effects': audio_effects,
}
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Media Machine built successfully with {len(files)} files.')
