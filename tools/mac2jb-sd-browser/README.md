# BrendanLauncher SD browser (mac2jb-style)

This is a **desktop-host utility**, not an app running on the Switch. It reuses the read-only SD browsing capability from mac2jb and adapts it to BrendanLauncher sessions backed by an ns2jb held FS-RPC run.

## Start

Keep the verified held FS-RPC session running. From the BrendanLauncher project root:

```sh
# Linux/macOS
./hbl-sd-browser --host 192.168.1.20
# Windows Command Prompt
hbl-sd-browser.cmd --host 192.168.1.20
# Any OS
node host/sd-browser.cjs --host 192.168.1.20
```

`--host` is the Switch IPv4 address. The tool automatically selects the newest run in the ns2jb checkout configured by `HBL_NS2JB` (default `../ns2jb-kurumuz`). To select it explicitly:

```sh
./hbl-sd-browser \
  --ns2jb /path/to/ns2jb-kurumuz \
  --run /path/to/ns2jb-kurumuz/runs/switch2-SESSION \
  --host 192.168.1.20
```

You may set `HBL_RPC_TARGET` instead of `--host`. `HBL_NS2JB` overrides the default checkout. Add `--no-open` to print the local browser address without opening it automatically. Node.js 18+ is required; no npm install is needed.

The adapter rejects ordinary/completed sessions. It verifies the current held-session proof and rechecks that RPC remains live while the browser is open. The panel binds only to `127.0.0.1`; the FTP export runs on the console and uses a dynamically selected port from 2122–2199. Press **Ctrl+C** in the running terminal to stop the browser and FTP service cleanly before using another RPC utility.

## Scope and safety

- Exposes only the Switch SD filesystem mounted as `/sd`.
- Browser supports listing folders and downloading files.
- FTP is **read-only**; uploads, rename, delete, and directory creation are rejected both by the FTP server and by the storage scope adapter.
- The FTP session uses anonymous, unencrypted FTP on the local network. Use a trusted LAN, do not port-forward it, and stop it when finished.
- There is no host filesystem access, no internal save/system mount, and no data is written to the SD card by this browser.
- It requires the same PC and live held FS-RPC session as the BrendanLauncher host. It is not an on-console file browser and does not boot the Switch from microSD.

Read [`NOTICE.md`](NOTICE.md), the bundled Super File Bros. [`DISCLAIMER.md`](../super-file-bros/DISCLAIMER.md), and its [`THIRD_PARTY_NOTICES.md`](../super-file-bros/THIRD_PARTY_NOTICES.md) before use.
