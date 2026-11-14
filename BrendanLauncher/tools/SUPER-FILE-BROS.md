# Bundled companion project

`tools/super-file-bros/` contains the unmodified source of [byizmysh/super-file-bros](https://github.com/byizmysh/super-file-bros), upstream commit `d7b216bacdd53d25f373c4c07cb6c88fa9b319c4` (retrieved 2026-11-03). Its upstream license, disclaimer, third-party notices, README, workflow, and source manifest are retained. Super File Bros. is GPL-2.0-only; it is a separately licensed companion, not relicensed as part of BrendanLauncher.

The separately maintained `host/sd-browser.cjs` adapter brings over the **mac2jb read-only SD browsing path** for BrendanLauncher-compatible ns2jb held FS-RPC runs. Run `./hbl-sd-browser --host <Switch-IPv4>` from the project root; it verifies the current held-session proof, opens the browser on the host, and exports only `/sd` through read-only FTP. See [`mac2jb-sd-browser/README.md`](mac2jb-sd-browser/README.md).

The upstream Super File Bros. application remains a separate desktop file manager with broader file-management features; its own README declares Node.js 20.20+ (22+ recommended). Read its `DISCLAIMER.md` and README before use. No console data, session folder, credentials, or generated `data/` is included.
