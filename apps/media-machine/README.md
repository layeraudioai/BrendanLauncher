# Media Machine

Put supported media files in `content/` and run `node build.cjs` here. The build host needs Python with Pillow, FFmpeg, Node.js, and the repository shader compiler (`glslangValidator`). Files are packaged in case-insensitive filename order; the catalog accepts up to 31 entries.

## Video playback and build optimizations

MP4/M4V, MOV, MKV, WebM, AVI, 3GP, and TS clips are decoded on demand by the BrendanLauncher host using FFmpeg; ABI 1 has no runtime video codec. Frames are scaled with aspect ratio preserved and letterboxed to **1600×900**, converted to **RGB565 little-endian**, and streamed into a single reusable frame slot in the app's GPU storage buffer. The frame slot is shared by clips, so package data remains about **4.8 MiB** instead of embedding hundreds of megabytes of frame data. The player updates at **5 fps**; clips loop after 100 frames (20 seconds). **A** starts the selected clip and **X** stops video playback. The resolution/FPS/frame-count constants are in `assets.py` and must stay in sync with `streamer.cjs` and the fragment shader.

The package has a **7 MiB** data limit in the GPU app ABI. `assets.py` creates a stable text atlas and only allocates the shared frame slot when at least one video exists. Add media files to `content/` and rebuild. Audio containers include MP3, WAV, FLAC, OGG, AAC, M4A, WMA, Opus, and M4B. ABI 1 currently exposes short PCM sound events rather than a continuous audio stream, so each audio file/video soundtrack is transcoded to a 0.5-second 48 kHz stereo preview; full-length audio playback is not implemented yet.

Audio is converted to 48 kHz stereo signed 16-bit PCM for the packaged playback path. Video audio, when present, is packaged the same way. Supported audio containers: MP3, WAV, FLAC, OGG, AAC, M4A, WMA, Opus, and M4B. Select a file with Up/Down and press **A**; use **B/Minus** to exit.
