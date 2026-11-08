#!/usr/bin/env python3
"""Configure/build, pack, install, or serve this HBLauncher port."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MANIFEST = HERE / "app/manifest.json"
CONFIG = json.loads(MANIFEST.read_text())
IS_AC = CONFIG["id"] == "animalcrossing"
BUILD = HERE / "build"

def run(args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)

def required(name, relative=None):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Set {name}; see README.md")
    path = Path(value).expanduser().resolve()
    if not (path / relative if relative else path).exists():
        raise SystemExit(f"Invalid {name}: {path}")
    return path

def sdk():
    """Resolve the owning launcher; integrated builds default to BrendanLauncher.

    HBL_ROOT remains an override for maintainers testing against another ABI-3
    SDK, but a normal all-in-one checkout should build/install in its parent.
    """
    if os.environ.get("HBL_ROOT"):
        launcher = required("HBL_ROOT", "sdk/tools/hbxl-build.py")
        os.environ.setdefault("HBXL_TOOLCHAIN", str(launcher.parent / "tp-port" / "toolchain"))
        return launcher
    integrated = ROOT.parent
    if (integrated / "sdk/tools/hbxl-build.py").is_file():
        os.environ.setdefault("HBXL_TOOLCHAIN", str(integrated.parent / "tp-port" / "toolchain"))
        return integrated
    raise SystemExit(
        "BrendanLauncher SDK not found beside ports/twilight-princess; "
        "set HBL_ROOT to a BrendanLauncher checkout"
    )


def apply_patch(patch: Path, cwd: Path):
    """Apply the pinned Aurora integration patch with or without Git metadata."""
    repo = cwd / ".git"
    if repo.is_dir():
        check = subprocess.run(
            ["git", "-C", str(cwd), "apply", "--check", str(patch)],
            capture_output=True,
        )
        if check.returncode == 0:
            run(["git", "-C", str(cwd), "apply", patch])
            return
        reverse = subprocess.run(
            ["git", "-C", str(cwd), "apply", "--reverse", "--check", str(patch)],
            capture_output=True,
        )
        if reverse.returncode:
            raise SystemExit("Aurora differs from the pinned source; cannot apply the HBLauncher patch")
        return

    # Source bundles intentionally omit nested Git histories. GNU patch can
    # still apply/check the same unified diff in a clean source-only checkout.
    forward = ["patch", "--batch", "--forward", "--dry-run", "-p1", "-i", patch]
    check = subprocess.run(forward, cwd=cwd, capture_output=True)
    if check.returncode == 0:
        run(["patch", "--batch", "--forward", "-p1", "-i", patch], cwd=cwd)
        return
    reverse = ["patch", "--batch", "--reverse", "--force", "--dry-run", "-p1", "-i", patch]
    if subprocess.run(reverse, cwd=cwd, capture_output=True).returncode:
        detail = (check.stderr or check.stdout).decode(errors="replace").strip()
        raise SystemExit("Aurora differs from the pinned source; cannot apply the integration patch\n" + detail)


def install_package(package: Path):
    """Install into BrendanLauncher, replacing only this port's known stub."""
    destination = sdk() / "apps" / CONFIG["id"]
    if not destination.exists():
        shutil.copytree(package, destination)
        print(f"Installed: {destination}")
        return

    manifest = destination / "manifest.json"
    report = destination / "build/report.json"
    try:
        existing = json.loads(manifest.read_text())
    except (OSError, json.JSONDecodeError):
        existing = {}
    if existing.get("id") != CONFIG["id"] or report.exists():
        raise SystemExit(f"Install destination already contains a built/different app: {destination}")

    temporary = destination.with_name(destination.name + ".integrated-tmp")
    backup = destination.with_name(destination.name + ".placeholder-backup")
    if temporary.exists() or backup.exists():
        raise SystemExit(f"Refusing to overwrite an existing install staging path beside: {destination}")
    shutil.copytree(package, temporary)
    try:
        destination.rename(backup)
        temporary.rename(destination)
    except Exception:
        if not destination.exists() and backup.exists():
            backup.rename(destination)
        raise
    shutil.rmtree(backup)
    print(f"Installed over the unbuilt Twilight placeholder: {destination}")


def patch_aurora():
    aurora = ROOT / "extern/aurora"
    if not (aurora / "CMakeLists.txt").exists():
        raise SystemExit("Run git submodule update --init --recursive first (or restore extern/aurora from the source bundle)")
    patch = HERE / "patches/aurora-hbx-switch2.diff"
    apply_patch(patch, aurora)


def prepare_build_environment():
    """Use BrendanLauncher by default and fetch the pinned source deps on demand."""
    os.environ.setdefault("HBL_ROOT", str(sdk()))
    configured = Path(os.environ.get("HBXL_TOOLCHAIN", "" )).expanduser()
    if not (configured / "bin/aarch64-linux-musl-gcc").is_file() and os.isatty(0):
        try:
            value = input("Path to the patched AArch64 musl toolchain (blank to cancel): ").strip()
        except EOFError:
            value = ""
        if value:
            os.environ["HBXL_TOOLCHAIN"] = str(Path(value).expanduser().resolve())
    required("HBXL_TOOLCHAIN", "bin/aarch64-linux-musl-gcc")
    if not IS_AC:
        deps = HERE / "deps"
        dawn = Path(os.environ.get("DAWN_SOURCE", deps / "dawn")).expanduser()
        sdl = Path(os.environ.get("SDL3_SOURCE", deps / "sdl3")).expanduser()
        if not (dawn / "include/webgpu/webgpu.h").is_file() or not (sdl / "CMakeLists.txt").is_file():
            run(["python3", HERE / "dependencies.py", "fetch"])
        os.environ.setdefault("DAWN_SOURCE", str(dawn.resolve()))
        os.environ.setdefault("SDL3_SOURCE", str(sdl.resolve()))


def configure(extra):
    prepare_build_environment()
    hbl = sdk()
    required("HBXL_TOOLCHAIN", "bin/aarch64-linux-musl-gcc")
    dawn = required("DAWN_SOURCE", "include/webgpu/webgpu.h")
    BUILD.mkdir(parents=True, exist_ok=True)
    runtime = BUILD / "libhbxl.a"
    run(["python3", hbl / "sdk/tools/hbxl-build.py", "--runtime-lib", runtime])
    code = CONFIG["linux"]["code_base"]
    data = CONFIG["linux"]["data_base"]
    args = ["cmake", "-S", ROOT / "pc" if IS_AC else ROOT, "-B", BUILD, "-G", "Ninja",
        f"-DCMAKE_TOOLCHAIN_FILE={HERE / 'cmake/switch2-musl.cmake'}", "-DCMAKE_BUILD_TYPE=Release"]
    if IS_AC:
        dawn_build = required("DAWN_BUILD", "src/dawn/native/libwebgpu_dawn.a")
        glslang = required("GLSLANG_PREFIX", "lib/libglslang.a")
        sdl = required("SDL2_PREFIX", "libSDL2.a")
        args += ["-DPC_HBX_SWITCH2=ON", "-DPC_GLWGPU=ON", f"-DGLWGPU_DIR={HERE / 'glwgpu'}",
            f"-DDAWN_SWITCH_SRC={dawn}", f"-DDAWN_SWITCH_BUILD={dawn_build}", f"-DGLSLANG_DIR={glslang}",
            f"-DSDL_SWITCH_DIR={sdl}", f"-DHBXL_RUNTIME={runtime}", f"-DHBXL_LD={hbl / 'sdk/linux/hbxl.ld'}",
            f"-DHBXL_CODE_BASE={code}", f"-DHBXL_DATA_BASE={data}", f"-DHBXL_FS_PORT={CONFIG['linux']['fs_port']}"]
    else:
        sdl = required("SDL3_SOURCE", "CMakeLists.txt")
        patch_aurora()
        # CMake needs one shell-safe linker flag string. Paths with whitespace
        # are unsupported here, rather than silently producing a broken link.
        if any(c.isspace() for c in str(hbl) + str(BUILD)):
            raise SystemExit("Use build and SDK paths without whitespace")
        flags = f"-static -no-pie -nostartfiles -Wl,-T,{hbl / 'sdk/linux/hbxl.ld'} -Wl,--defsym=HBXL_CODE_BASE={code} -Wl,--defsym=HBXL_DATA_BASE={data} -Wl,--eh-frame-hdr -Wl,--gc-sections -Wl,-z,noexecstack -Wl,--whole-archive {runtime} -Wl,--no-whole-archive"
        args += [f"-DCMAKE_EXE_LINKER_FLAGS={flags}", "-DHBX_SWITCH2=ON", f"-DHBX_SDK_INCLUDE={hbl / 'sdk/include'}",
            "-DDUSK_ENABLE_CODE_MODS=OFF", "-DDUSK_ENABLE_OPUS=OFF", "-DAURORA_DAWN_PROVIDER=vendor",
            "-DAURORA_DAWN_LINKAGE=static", f"-DFETCHCONTENT_SOURCE_DIR_DAWN={dawn}",
            "-DAURORA_SDL3_PROVIDER=vendor", "-DAURORA_SDL3_LINKAGE=static", f"-DFETCHCONTENT_SOURCE_DIR_SDL={sdl}",
            "-DAURORA_NOD_PROVIDER=hbx", f"-DAURORA_NOD_LITE_DIR={HERE / 'nod-lite'}"]
        for option in ["DAWN_BUILD_PROTOBUF", "TINT_BUILD_IR_BINARY", "DAWN_USE_X11", "DAWN_USE_WAYLAND",
            "DAWN_ENABLE_OPENGLES", "DAWN_ENABLE_DESKTOP_GL", "TINT_BUILD_GLSL_WRITER", "TINT_BUILD_HLSL_WRITER",
            "TINT_BUILD_MSL_WRITER", "TINT_BUILD_GLSL_VALIDATOR", "DAWN_USE_GLFW", "DAWN_SUPPORTS_GLFW_FOR_WINDOWING",
            "GLFW_BUILD_WAYLAND", "GLFW_BUILD_X11", "SDL_X11", "SDL_WAYLAND", "SDL_KMSDRM", "SDL_OPENGL",
            "SDL_OPENGLES", "SDL_ALSA", "SDL_PULSEAUDIO", "SDL_PIPEWIRE", "SDL_JACK", "SDL_SNDIO", "SDL_DBUS",
            "SDL_IBUS", "SDL_LIBUDEV", "SDL_HIDAPI", "SDL_CAMERA", "SDL_TESTS", "SDL_EXAMPLES"]:
            args.append(f"-D{option}=OFF")
        args += ["-DSDL_UNIX_CONSOLE_BUILD=ON", "-DSDL_OFFSCREEN=ON"]
    run(args + extra)

def pack(elf):
    hbl = sdk()
    required("HBXL_TOOLCHAIN", "bin/aarch64-linux-musl-nm")
    if not elf.is_file():
        raise SystemExit(f"Build the game first; missing ELF: {elf}")
    run(["python3", hbl / "sdk/tools/hbxl-build.py", HERE / "app", "--pack", elf])
    # Distribute only the manifest and runtime image, never build caches or discs.
    dest = HERE / "dist" / CONFIG["id"]
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(MANIFEST, dest / "manifest.json")
    (dest / "build").mkdir(exist_ok=True)
    for filename in ["code.bin", "data.bin", "report.json"]:
        shutil.copy2(HERE / "app/build" / filename, dest / "build" / filename)
    print(f"Package: {dest}")
    return dest

def prepare_disc(fsroot: Path, disc: Path | None, prompt: bool):
    """Create the private runtime file-server content from the user's own ISO."""
    fsroot = fsroot.expanduser().resolve()
    iso = fsroot / "tp/GZ2E01.iso"
    if disc is None and iso.is_file():
        disc = iso
    if disc is None and prompt:
        try:
            value = input("Path to your own Twilight Princess GZ2E01.iso (blank to cancel): ").strip()
        except EOFError:
            value = ""
        if value:
            disc = Path(value).expanduser()
    if disc is None:
        raise SystemExit("A GZ2E01 USA GameCube ISO is required to run Twilight Princess. Use --disc /path/to/GZ2E01.iso.")
    disc = disc.expanduser().resolve()
    if not disc.is_file():
        raise SystemExit(f"Disc image does not exist: {disc}")
    with disc.open("rb") as image:
        disc_id = image.read(6)
    if disc_id != b"GZ2E01":
        raise SystemExit(f"Unsupported disc image ID {disc_id!r}; expected the user's own GZ2E01 USA ISO.")
    iso.parent.mkdir(parents=True, exist_ok=True)
    if disc != iso:
        shutil.copy2(disc, iso)
    source_res = ROOT / "res"
    if not source_res.is_dir():
        raise SystemExit("Game resources are missing. Restore the Twilight Princess source/decomp resources before starting the file server.")
    fsroot.mkdir(parents=True, exist_ok=True)
    target_res = fsroot / "res"
    if not target_res.exists():
        shutil.copytree(source_res, target_res)
    (fsroot / "hbxl-env").write_text("HBXL_PRELOAD=/tp/GZ2E01.iso\n")
    return fsroot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["configure", "build", "pack", "install", "serve"])
    parser.add_argument("--elf", type=Path, help="Pack an already linked ELF instead of building")
    parser.add_argument("--disc", type=Path, help="Path to your own GZ2E01 USA ISO (prompted for by serve when omitted)")
    parser.add_argument("--no-disc-prompt", action="store_true", help="Do not prompt in scripts/CI")
    parser.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 1))
    parser.add_argument("--fsroot", type=Path, default=HERE / "fsroot")
    args, extra = parser.parse_known_args()
    if extra and args.action not in ["configure", "build"]:
        parser.error("Extra CMake arguments require configure or build")
    elf = args.elf or (BUILD / "bin/AnimalCrossing" if IS_AC else BUILD / "dusklight")
    if args.action in ["configure", "build"]:
        configure(extra)
    if args.action == "build":
        # The runtime archive is supplied as a linker option, so force a relink
        # after rebuilding it even when the game objects are unchanged.
        elf.unlink(missing_ok=True)
        run(["cmake", "--build", BUILD, "--parallel", str(args.jobs)])
    if args.action in ["build", "pack", "install"]:
        package = pack(elf.resolve())
        if args.action == "install":
            install_package(package)
    if args.action == "serve":
        fsroot = prepare_disc(args.fsroot, args.disc, not args.no_disc_prompt)
        port = CONFIG["linux"].get("fs_port", 39501)
        run(["python3", sdk() / "tools/hbxl-fileserver.py", fsroot, "--port", str(port)])

if __name__ == "__main__":
    main()
