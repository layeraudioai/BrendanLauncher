# ABI-1 Studio

ABI-1 Studio is a client-side scene editor and ABI-1 package builder for
BrendanLauncher. Open `index.html` in a current desktop browser; no local server,
Node.js, network connection, or package installation is required. The GLSL
compiler is bundled as WebAssembly and runs in the browser.

## Editing

- Drag Mesh, Sprite, or Audio from the palette into the viewport. Drag an
  existing hierarchy row onto another row to parent it; drop it in the
  hierarchy background to make it a root object.
- Object transforms are local to the selected object's parent. The preview
  composes parent translation, rotation, and scale.
- Mesh objects currently render as box, sphere, or plane primitives. Dropped
  OBJ files are retained in the editable project, but arbitrary OBJ geometry
  is not yet rendered by the ABI-1 target shaders.
- PNG/JPG sprites are converted to packed RGBA data and used by the generated
  shader. Image imports are limited to one megapixel each.
- Audio files are decoded in the browser to 48 kHz stereo s16le PCM. Attach
  GLSL to an Audio object or another object and call `hbSound(eventId)` to
  trigger its matching sound event.
- Create scripts in the reusable Script Library, then attach any number to an
  object. One script can be shared by multiple objects; its edits update every
  attachment. Attached scripts run in attachment order, with a combined 8 KiB
  source limit per object. Scripts used by a prefab are included with it and
  retain their shared attachments when instantiated.
- Scripts are GLSL statements compiled into the ABI-1 compute shader. The
  variables `position`, `rotation` (radians), `scale`, `color`, `dt`,
  `buttons`, and `objectIndex` are in scope. `hbSound(1u)` and
  `hbStopSound()` use the shared host audio path. Older projects with one
  inline script per object are migrated to reusable script entries when opened.
- The script editor's **Generate GLSL** helper converts one plain-language
  behavior into editable script code entirely offline. It supports basic
  movement, rotation, scale, color, sound-event, and button-triggered exit
  prompts, including pressed and held controls; use its examples for supported
  phrasing. It is a constrained local generator, not a cloud AI, and reports
  prompts it cannot interpret.
- Save Project and Save Prefab download portable files. Saved prefabs are also
  kept in browser local storage when the browser permits it.

## Building

Choose **Build ABI-1 App** to compile and validate the shaders in-browser, then
choose **Download ZIP** to save `<app-id>.zip`. Extract the ZIP into a new folder under
`BrendanLauncher/apps/`; the ZIP contains `app.json`, assets, and the compiled
SPIR-V shaders. It also includes `project.json` and GLSL sources for continued
editing. Browser export is limited to 128 MiB.

## PC Preview

Choose **Preview** to run the scene in the browser with WebGL 2, the generated
ABI-1 fragment shader, per-object GLSL scripts at a fixed 60 Hz, keyboard or
standard gamepad input, and imported PCM audio. The preview runs the app logic
without emulating NS2 hardware. PC GPU/driver and audio differences mean its
output is not guaranteed to be pixel-identical to the NS2; WebGL 2 support is
required.

The target renderer is a small ray-marched primitive renderer: boxes, spheres,
planes, and textured sprite planes are supported. The editor does not provide
arbitrary native CPU code, arbitrary OBJ rendering, or a general-purpose
physics/animation engine. Parent-child transforms are composed in the editor
and flattened into the initial package data; dynamic runtime hierarchy
transforms are not implemented.

The bundled `glslang.js` compiler is based on `@webgpu/glslang` 0.0.15; see
`LICENSE.glslang.txt` for its license.
