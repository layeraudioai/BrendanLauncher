# Brendan NRO Launcher (Ozone/libnx-ounce companion)

This is a **separate Horizon homebrew NRO**, not an app that BrendanLauncher can
run inside its current SmileBASIC/GPU runtime. It is the first runtime-side
prototype for the NRO path identified in
[`docs/OZONE-LIBNX-NRO-PORT-PLAN.md`](../../docs/OZONE-LIBNX-NRO-PORT-PLAN.md).

## What it does

- Enumerates the top-level `SD:/switch/*.nro` files.
- Checks NRO0 magic, declared image/file sizes, and each code/rodata/data segment range before offering a file.
- Requires `envHasNextLoad()` and then asks the active homebrew loader to
  chainload the selected SD path with `envSetNextLoad()`.
- If the current loader did not provide the next-load environment, it displays
  an explanation and refuses to call the handoff function.

This depends on running under a compatible Ozone homebrew loader that provides
libnx-ounce's `EntryType_NextLoadPath`. It does not install Ozone/CFW, patch a
title, write to title content, support raw `.bin` reboot payloads, load an NRO
from a PC server, or make the operation available from BrendanLauncher's app
menu. The handoff is an external chainload into another NRO, not a process
created by BrendanLauncher.

## Build

Use the Ounce-target devkitA64 toolchain and a built/installed `libnx-ounce`
checkout. The libnx-ounce Makefile installs to `$DEVKITPRO/libounce` by default.
Build that dependency following its upstream instructions first, then use the
platform helper:

```sh
ports/ozone-nro-launcher/build.sh
```

On Windows, run `ports\\ozone-nro-launcher\\build.bat` from a devkitPro/MSYS2
environment with GNU make available.

Output: `ports/ozone-nro-launcher/build/BrendanNroLauncher.nro`.
Copy it to `SD:/switch/BrendanNroLauncher.nro` and launch it through the
Ozone-provided homebrew loader. Put target NROs in `SD:/switch/` (one level;
subdirectories are not scanned). Test only with user-owned homebrew and retain
independent backups.

## Not yet verified

The source has only been host syntax-checked against a small libnx API stub in
this workspace. It has **not** been built with devkitA64/libnx-ounce, tested with
an Ozone homebrew loader, or run on a console. Ozone's loader docs describe
nx-hbloader support, but actual Ounce firmware/build compatibility and the
`NextLoadPath` runtime behavior still need on-device verification. No automatic
build or launcher integration is claimed.
