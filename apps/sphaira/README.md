# Sphaira for Switch 2 HBL

Sphaira ported from Switch 1 HBL framework to the Switch 2 HBL framework (ABI 1), providing a modern Homebrew Menu, File Browser, AppStore, and Tool Suite with GPU-accelerated shaders, audio effects, and robust D-pad/touch navigation.

## Building

From the project root or the app directory:

```sh
node apps/sphaira/build.cjs
```

This compiles shaders using `glslangValidator` (falling back to precompiled SPIR-V if needed), packages fonts and metadata via `assets.py`, and initializes the app state.

## Features

- **Homebrew Apps**: Browse and launch homebrew applications (`.nro`).
- **File Browser**: Inspect SD card storage, archives, and directories.
- **AppStore**: Browse online homebrew repository and install packages.
- **Tools & Network**: USB install, FTP/MTP service toggles, Themezer themes.
- **Controls**: D-Pad to navigate, Left/Right to switch tabs, A to select/launch, X to refresh, B/Minus to exit.
