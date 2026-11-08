# System Monitor

A read-only BrendanLauncher native app with a small, bounded CPU throughput test.

## Build and install

From the project root:

```sh
python3 sdk/tools/hbx-build.py apps/system-monitor
```

Use the same AArch64 cross-toolchain required to build the launcher. The build
writes generated files under `apps/system-monitor/build/`; then restart the
launcher/session so its native package catalog can discover the app.

## What it reports

- The SDK-provided architectural timer frequency (`ctx->tick_hz`), clearly
  labeled as a timer reference, not CPU MHz.
- A 350,000-round integer CPU throughput trial, available with A.
- CPU/GPU/RAM/panel clock and temperature as unavailable. This runtime has no
  documented, verified per-core/per-chip telemetry contract for a normal app.

The trial is short and read-only. It is not a stability/thermal stress test,
does not identify a Switch 2 silicon revision, and does not set clock rates,
voltage, fans, thermal limits, or power policies. It cannot identify safe
per-device overclock limits. Press B or + to return.

Do not infer hardware limits from the architectural counter rate. A safe clock
control feature would require documented platform APIs, thermal protections,
and sustained validation on real consoles; those are not provided by this
project's app ABI.
