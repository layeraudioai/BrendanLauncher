# YouTube (VacuumTube) for Switch 2 HBL Framework

Ported from Switch 1 HBL framework (VacuumTube) into the Switch 2 HBL framework (following structured apps like `media-machine`).

## Building

From the project root:

```sh
node apps/youtube/build.cjs
node apps/youtube/check.cjs
```

## Features

- YouTube TV / Leanback navigation interface
- D-Pad menu scrolling & selection
- AdBlock and SponsorBlock toggle integration
- Video playback simulation & streaming view on Switch 2
- Controller & touch support compatible with HBLauncher ABI 1
