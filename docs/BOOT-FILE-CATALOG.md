# Boot-file inventory (no payload/NRO execution)

The project does not yet expose a device reboot-to-payload transport for raw
`.bin` files, nor an NRO loader for BrendanLauncher/SmileBASIC 4. This helper
therefore inventories files only; it does not present a launch button, transfer
the files to the console, reboot, chainload, or patch a title.

Put user files in the project-root `payloads/` and `nros/` folders, or scan
selected PC directories explicitly:

```sh
node tools/boot-file-catalog.cjs
node tools/boot-file-catalog.cjs /path/to/payloads /path/to/nros
```

The Windows companion is the same Node command from Command Prompt. The JSON
output reports relative path, size, SHA-256, file type, and for NROs a bounds-
checked header/segment summary (and valid asset metadata). `.bin` files remain
opaque. Both types are always marked `runnable: false`; format recognition does
not prove a file is safe or compatible with the console. See the [Ozone/libnx
port assessment](OZONE-LIBNX-NRO-PORT-PLAN.md) for the recommended loader path.

For SD files, first copy them to a PC folder with a trusted read/write method,
then scan that folder. BrendanLauncher's integrated SD browser is read-only and
has no payload-transfer or reboot operation.

## What must exist before console integration

A supported, documented Switch 2 reboot-payload interface and a compatible
payload format/boot chain are needed for `.bin`. A supported Horizon NRO loader
and SmileBASIC process-transition mechanism are needed for `.nro`. The current
SmileBASIC GPU app ABI and BrendanLauncher native ABI are not these loaders.
No generated app UI can make an arbitrary binary executable, and attempting a
blind reboot or title replacement risks data loss or an unbootable title. Until
those APIs are present and verified, launcher selection is intentionally not
wired to code execution.
