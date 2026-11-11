#!/usr/bin/env python3
"""Extract the latest MIDI/WAV artifact emitted by the app from an HBX save file.

Usage: python3 extract_save.py saves/hypertextmusicland.sav [out-dir]
The project is a fixed-width ABI-v3 C struct; constants match src/hml.h.
"""
import pathlib, struct, sys

HBX_SAVE_MAGIC = 0x56534248
APP_MAGIC = 0x504D4C48
APP_PROJECT_BYTES = 9768  # sizeof(struct hml_project), verified by host/test
APP_HEADER_BYTES = 12
HBX_HEADER_BYTES = 16
ARTIFACTS = {0x44494D48: ("project.mid", b"MThd"), 0x56415748: ("mix-bounce.wav", b"RIFF")}

def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    source = pathlib.Path(sys.argv[1])
    outdir = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path(".")
    data = source.read_bytes()
    if len(data) < HBX_HEADER_BYTES + APP_HEADER_BYTES + APP_PROJECT_BYTES + 8:
        raise SystemExit("save file is truncated or has no HML project payload")
    magic, version, used, dirty = struct.unpack_from("<IIII", data, 0)
    if magic != HBX_SAVE_MAGIC:
        raise SystemExit("not an HBLauncher save block")
    app_magic, app_version, app_size = struct.unpack_from("<III", data, HBX_HEADER_BYTES)
    if app_magic != APP_MAGIC:
        raise SystemExit("save block does not contain a HyperText Music Land project")
    artifact_pos = HBX_HEADER_BYTES + APP_HEADER_BYTES + APP_PROJECT_BYTES
    tag, size = struct.unpack_from("<II", data, artifact_pos)
    if tag not in ARTIFACTS:
        raise SystemExit("no exported MIDI/WAV artifact is stored in this save")
    name, signature = ARTIFACTS[tag]
    payload_pos = (artifact_pos + 8 + 15) & ~15
    if size > len(data) - payload_pos or size > used:
        raise SystemExit("artifact length exceeds save block bounds")
    payload = data[payload_pos:payload_pos + size]
    if not payload.startswith(signature):
        raise SystemExit("artifact signature does not match its type")
    outdir.mkdir(parents=True, exist_ok=True)
    target = outdir / name
    target.write_bytes(payload)
    print(f"{target}: {len(payload)} bytes (save v{version}, app v{app_version}, dirty={dirty})")

if __name__ == "__main__":
    main()
