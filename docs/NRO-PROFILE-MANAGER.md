# NRO donor profile manager — archival/staging only

This utility safely preserves two user-supplied NRO files in a profile: a donor
NRO and the payload NRO. It records SHA-256 hashes, verifies integrity, refuses
to reuse a profile ID, and can restore the donor copy to a **new** file path
without overwriting an existing file.

It does **not** create a bootable forwarder, patch a title, install or replace
content, run an NRO, or implement the R-button launch behavior. Its status is
explicitly `staged-only`.

## Use

```bat
nro-profile-manager.cmd --help
nro-profile-manager.cmd create --id my-homebrew --donor C:\homebrew\donor.nro --payload C:\homebrew\app.nro --donor-label "My donor" --title-id 0100000000001000
nro-profile-manager.cmd verify --id my-homebrew
nro-profile-manager.cmd restore-donor --id my-homebrew --output C:\homebrew\restored-donor.nro
```

On macOS/Linux, replace the `.cmd` invocation with `node tools/nro-profile-manager.cjs`.
The default profile store is `data/nro-profiles`; use `--root DIR` to select a
private location. Only input files with an `NRO0` header at offset `0x10` are
accepted. Creation copies sources and never edits the donor or payload inputs.
The profile directory must not be manually edited; `verify` detects changes.

For safety, `restore-donor` always requires a fresh output path and fails if it
already exists. Keep your own additional backups of important files.

## Why this does not inject or boot

BrendanLauncher runs its native ABI-3 and GPU-app ABI formats. It has no
implemented Horizon NRO loader, system title-content installer, title override
or R-button hook. A PC-side file server can transfer files, but cannot supply
those missing kernel/loader/title services. The Switch homebrew `.nro` format is
not interchangeable with BrendanLauncher packages or a retail title's signed
ExeFS executable. Replacing a retail title executable would require platform
support outside this project and can make that title unlaunchable; an ordinary
backup cannot make an unsigned replacement boot.

The linked [alula/hbpatcher](https://github.com/alula/hbpatcher) addresses a
different issue: patching some older Switch homebrew NROs for a newer ABI. It is
not an NRO launcher or retail-title injector. [Ozone](https://github.com/alula/Ozone)
describes itself as a partial Ounce-target Atmosphere port, not full CFW, and
[libnx-ounce](https://github.com/alula/libnx-ounce) is a userland library. Neither
is integrated as an NRO execution environment here.

Do not point this tool at Nintendo-managed title directories or use it to alter
installed content. A future real boot feature must first have an independently
verified, supported NRO runtime and documented reversible user-data API. Only
then should a donor/hold-R workflow be implemented against that interface.
