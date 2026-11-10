# AirGuitar

AirGuitar is a motion-controlled split-Joy-Con rhythm game and adaptive improvisation simulator for BrendanLauncher, inspired by Clone Hero / Moonscraper (`.chart` format).

## Features

- **Split Joy-Con Motion Control:** Use both Left and Right Joy-Cons independently. Strumming, picking, and fingerpicking are driven by motion gestures and tilt/flick on one hand, while fretting, tapping, hammer-ons, pull-offs, and slides are handled by button combinations and orientation on the other hand.
- **Handedness Support:** Easily configure Left-Handed or Right-Handed player modes in the settings menu.
- **Moonscraper `.chart` Support:** Drop your favorite `.chart` files and audio stems (`guitar.ogg`, `backing.ogg`, etc.) into `assets/`.
- **Adaptive Freeplay / Improvisation Mode:** Jam out without hitting exact chart notes. The engine dynamically maps your inputs to the correct key and scale matching the background music stems, preventing harsh dissonance even during mid-song key modulations.

## Controls

- **Left / Right Joy-Con Orientation & Tilt:** Fretting positioning / strum pick detection.
- **SL / SR & Buttons (L/R, ZL/ZR, D-Pad, ABXY, +/-):** Fretting buttons and strum triggers.
- **A / Plus:** Confirm / Start.
- **B / Minus:** Back / Exit to menu.
- **R3 / L3:** Toggle Freeplay / Performance mode.
