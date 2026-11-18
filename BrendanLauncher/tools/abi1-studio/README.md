# ABI-1 Studio

ABI-1 Studio is a client-side scene editor and ABI-1 package builder for
BrendanLauncher. Open `index.html` in a current desktop browser; no local server,
Node.js, network connection, or package installation is required. The GLSL
compiler is bundled as WebAssembly and runs in the browser. If an old deployed copy
keeps loading, use **Update Cache** in the top toolbar: it saves the current project,
fetches fresh Studio files with a unique `?i=` URL, and reloads without erasing your saved project or prefab data. Each release also versions its CSS and JavaScript URLs so stale copies cannot be reused across updates; the button then explicitly reloads the page at the fresh URL.

## Project seeds

The **Share or generate from a project seed** panel supports two related workflows:

- Enter a short 1–65,536 character seed using only letters or digits to create a deterministic starter project with generated scripts. The same seed reproduces the same scene, objects, scripts, and ABIM soundtrack (shared melodies, patterns, and arrangement references).
- Enter a natural-language project prompt to derive a stable `prompt...` seed and run it through the offline project prompt generator. Supported object and behavior instructions are generated; unsupported instructions remain notes rather than being guessed.
- Export the current project as a compact `.hblseed` string/file. It uses only the case-insensitive base-36 alphabet `a-z0-9` and includes a versioned project payload (deflate-compressed when smaller and supported) with an integrity checksum, so importing the seed restores the project data and detects accidental corruption.
- Import a full seed by pasting it or opening an `.hblseed` / text file. Invalid or truncated seeds are rejected before replacing the open project.

A full project seed is a sharing/serialization format, not a small procedural seed: its length depends on project size. Seed payloads are capped at 40 MiB decoded size.

## Music Studio

Open **Music Editor** from the top toolbar to compose and preview music with the built-in MML melody editor, melodic-pattern editor, and track arrangement. Each MML melody is stored once. Patterns are ordered calls to melody IDs with semitone deltas and repeats; sequence tracks place melody or pattern calls at beats, with optional transposition and repetition—no MML text is copied into the arrangement. Supported notation includes tempo (`t120`), octave (`o4`), default length (`l8`), notes/accidentals, rests, octave shifts, dotted notes, chords such as `[ceg]4`, and velocity (`v80`). Playback uses the browser's Web Audio API.

- Save and load `.abim` files (up to 40 MiB), which preserve shared melody/pattern definitions, arrangement calls, tempo, and imported audio clips.
- Import Standard MIDI `.mid`/`.midi`; note events become editable shared MML melody definitions arranged on sequence tracks. Export the same arrangement (including pattern calls and transpositions) as Standard MIDI.
- Import MP3 and common browser-decodable audio files as audio tracks. They play in the editor and are retained in `.abim`; audio clips are mixed into MP3 export (they are not transcribed into MIDI notes).
- Export the rendered song as MP3 using the bundled `lamejs` encoder and Web Audio offline rendering. The MP3 exporter supports renders up to five minutes. ABI app packages with project music include one `assets/music.abim` payload and reference it from `app.json`; this keeps the reusable music graph in its native format rather than duplicating melody text in tracks. The encoder's separate-file license and source link are in `licenses/LAMEJS-LICENSE.txt` (LGPL-3.0 text is included beside it).

MML example: `t120 o4 l8 [ceg] g e c`.

## Editing

- Drag Mesh, Sprite, or Audio from the palette into the viewport. Drag an
  existing hierarchy row onto another row to parent it; drop it in the
  hierarchy background to make it a root object.
- In the scene viewport, drag empty space with the left mouse button to orbit,
  right-click and drag to pan the vector space, and use the arrow keys to pan
  when the viewport has focus. Wheel zoom and object dragging are unchanged.
- Use **Refine the project with a prompt** to split instructions in order by
  newlines, periods, commas, then “and”. The default mode applies changes to a
  copy of the current project and preserves existing content unless a reviewed
  instruction explicitly adds, edits, or deletes it. The optional new-project
  mode remains available. Each piece is editable, removable, addable, and
  reorderable by drag/drop or accessible up/down controls; reordering reruns
  analysis so target references follow the new order. Review the summary before
  confirming. The constrained offline parser supports common mesh/sprite/audio
  additions, named colors, basic transforms/renaming/deletion, and behaviors
  handled by the reusable-script generator. Unsupported or unmatched steps
  remain visible instead of being silently guessed. The operation applies to
  the currently selected scene and selected object context.
- Object transforms are local to the selected object's parent. The preview
  composes parent translation, rotation, and scale.
- Projects can contain up to 48 independent scenes, each with its own camera
  and object hierarchy. Assets, scripts, and GLSL class files are shared across
  scenes. A project can contain up to 48 objects total. Select a scene to edit
  it and choose a startup scene in App Details.
- Each scene has one runtime camera. Set its world position and rotation in the
  Runtime Camera panel; PC Preview and built apps use the same camera transform.
  Rotation is entered in degrees.
- Scripts can switch scenes at runtime with `hbLoadScene(2u)`, using the
  scene's numeric ID shown in the scene list. Scene IDs remain stable when
  scenes are added or removed.
- Import `.glsl` class files from the GLSL Classes panel. GLSL has no `class`
  keyword; these files contain reusable structs, constants, and helper
  functions that are available to scripts in every scene.
- Mesh objects currently render as box, sphere, or plane primitives. Dropped
  OBJ files are packaged as local streamed assets, but arbitrary OBJ geometry
  is not yet rendered by the ABI-1 target shaders.
- PNG/JPG sprites are converted to packed RGBA data and used by the generated
  shader. Image imports are limited to one megapixel each; combined texture
  bytes are packaged in `assets/image-data.bin` and loaded into private GPU
  storage (up to 32 MiB), separately from the 7 MiB inline scene-data limit.
- Import MP3, WAV, FLAC, M4A, AAC, Ogg, and Opus audio with **Import Audio** or
  by dropping files into the viewport. The browser's audio decoder converts
  supported files to 48 kHz stereo s16le PCM for ABI-1; no manual conversion
  or network service is needed. Codec availability depends on the browser. Audio
  sources are limited to 24 MiB and decoded PCM to 64 MiB. Attach GLSL to an
  Audio object or another object and call `hbSound(eventId)` to trigger its
  matching sound event; the local audio service streams PCM from the app's
  `assets/` files during playback.
- Create scripts in the reusable Script Library, then attach any number to an
  object. One script can be shared by multiple objects; its edits update every
  attachment. Attached scripts run in attachment order, with a combined 8 KiB
  source limit per object. Scripts used by a prefab are included with it and
  retain their shared attachments when instantiated.
- Scripts are GLSL statements compiled into the ABI-1 compute shader. The
  variables `position`, `rotation` (radians), `scale`, `color`, `dt`,
  `buttons`, and `objectIndex` are in scope. `hbSound(1u)` and
  `hbStopSound()` use the shared host audio path. Scripts can spawn primitive
  objects at runtime with `hbSpawnObject`, spawn once per attached object with
  `hbSpawnOnce`, play an audio object's event with `hbPlayObjectAudio`, and use
  `hbSetObjectAudio` to update an attached audio event, or use `hbRandom`,
  `hbRandomRange`, and `hbRandomColor`. Each scene holds at most 48 static and
  dynamically spawned objects combined. Older projects with one inline script
  per object are migrated to reusable script entries when opened.
- The script editor's **Generate GLSL** helper converts one plain-language
  behavior into editable script code entirely offline. Unit-speed movement uses
  the concise `position.x += dt;` form. The script compiler also supports a
  math-expression layer on assignment right-hand sides: `^`/`**` powers, `%`
  modulo, postfix factorial, roots, logs, absolute values, and deterministic
  random functions. Standard GLSL `for`/`while` loops compile normally. Wrap
  initialization in `once { ... }` to execute it once per attached object; each
  object supports up to 23 one-time blocks, tracked in its persistent scene data.
  It supports movement,
  rotation, scale, fixed or random colors and positions, runtime primitive
  spawning, scene changes by name or ID, random/next/previous scene selection,
  audio-event configuration/playback/switching/stopping, object-attached
  audio, and button-triggered actions. Use its examples for supported phrasing.
  It is a constrained local generator, not a cloud AI, and reports prompts it
  cannot interpret.
- Save Project and Save Prefab download portable files. Saved prefabs are also
  kept in browser local storage when the browser permits it.

## Building

Choose **Build ABI-1 App** to compile and validate the shaders in-browser, then
Choose **Download ZIP** to save `<app-id>.zip`. Extract the ZIP into a new
folder under `BrendanLauncher/apps/`; the ZIP contains `app.json`, assets, and
the compiled SPIR-V shaders. It also includes `project.json` and imported GLSL
class files for continued editing. Browser export is limited to 128 MiB.

## PC Preview

Choose **Preview** to run all scenes in the browser with WebGL 2, starting with
the selected startup scene. Use `hbLoadScene(2u)` in a script to switch scenes
in both Preview and built ABI-1 apps. Preview uses each scene's runtime camera
and generated ABI-1 fragment shader, runs per-object GLSL scripts at a fixed
60 Hz, and supports keyboard or standard gamepad input and imported PCM audio.
It runs the app logic without
emulating NS2 hardware; streamed-file requests are stubbed in Preview. Its
raymarch distance scales with scene bounds so distant objects are not
discarded at a fixed range. PC GPU/driver and audio
differences mean its output is not guaranteed to be pixel-identical to the NS2;
WebGL 2 support is required.

The target renderer is a small ray-marched primitive renderer: boxes, spheres,
planes, and textured sprite planes are supported. The editor does not provide
arbitrary native CPU code, arbitrary OBJ rendering, or a general-purpose
physics/animation engine. Parent-child transforms are composed in the editor
and flattened into the initial package data; dynamic runtime hierarchy
transforms are not implemented.

Generated shaders can request bounded 64 KiB chunks from OBJ or other declared
local assets with `hbStreamRequest`, `hbStreamReady`, and `hbStreamByte`. The
launcher serves these files from the app folder while it runs; no external
server is needed. Streamed apps reserve the final 1 MiB of the app-data region
for transfers and may use up to 6 MiB of inline data.

The bundled `glslang.js` compiler is based on `@webgpu/glslang` 0.0.15; see
`LICENSE.glslang.txt` for its license.
