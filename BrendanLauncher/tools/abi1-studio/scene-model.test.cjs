'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('./scene-model.js');
require('./glslang.js');
const { Abi1PackageBuilder, crc32 } = require('./abi1-build.js');
const { Abi1PreviewRuntime } = require('./abi1-preview.js');
const { generateScript } = require('./script-generator.js');
const builder = new Abi1PackageBuilder({ model });
const uint32 = (bytes, offset) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
const float32 = (bytes, offset) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(offset, true);
function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  let directoryOffset = view.getUint32(end + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(directoryOffset, true), 0x02014b50);
    const checksum = view.getUint32(directoryOffset + 16, true);
    const size = view.getUint32(directoryOffset + 24, true);
    const nameLength = view.getUint16(directoryOffset + 28, true);
    const extraLength = view.getUint16(directoryOffset + 30, true);
    const commentLength = view.getUint16(directoryOffset + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(directoryOffset + 46,
      directoryOffset + 46 + nameLength));
    const localOffset = view.getUint32(directoryOffset + 42, true);
    assert.equal(view.getUint32(localOffset, true), 0x04034b50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const contentOffset = localOffset + 30 + localNameLength + localExtraLength;
    const contents = bytes.slice(contentOffset, contentOffset + size);
    assert.equal(crc32(contents), checksum, `ZIP CRC for ${name}`);
    entries.set(name, contents);
    directoryOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('parent transforms compose position, rotation, and scale for descendants', () => {
  const project = model.createProject();
  const parent = model.createObject('mesh', 'Parent');
  parent.transform = { x: 1, y: 0, z: 0, rx: 0, ry: 0, rz: 90, sx: 2, sy: 2, sz: 2 };
  const child = model.createObject('sprite', 'Child');
  child.parentId = parent.id;
  child.transform.x = 1;
  project.objects.push(parent, child);
  const world = model.worldTransforms(project).get(child.id);
  assert.ok(Math.abs(world.position[0] - 1) < 1e-8);
  assert.ok(Math.abs(world.position[1] - 2) < 1e-8);
  assert.ok(Math.abs(world.position[2]) < 1e-8);
  assert.deepEqual(world.scale, [2, 2, 2]);
});

test('camera drag deltas follow yaw and pitch, then convert to parent-local coordinates', () => {
  const horizontal = model.cameraPlaneDelta({ yaw: Math.PI / 2, pitch: 0 },
    10, 0, 10, 100, 100);
  assert.ok(Math.abs(horizontal[0]) < 1e-8);
  assert.ok(Math.abs(horizontal[2] + 10 * 10 / 44) < 1e-8);
  const vertical = model.cameraPlaneDelta({ yaw: 0, pitch: Math.PI / 2 },
    0, 10, 10, 100, 100);
  assert.ok(Math.abs(vertical[2] - 10 * 10 / 44) < 1e-8);

  const project = model.createProject();
  const parent = model.createObject('mesh', 'Rotated Parent');
  parent.transform.rz = 90;
  parent.transform.sx = parent.transform.sy = parent.transform.sz = 2;
  project.objects.push(parent);
  const parentWorld = model.worldTransforms(project).get(parent.id);
  const local = model.worldDeltaToParentLocal(parentWorld, [0, 2, 0]);
  assert.ok(Math.abs(local[0] - 1) < 1e-8);
  assert.ok(Math.abs(local[1]) < 1e-8);
  assert.ok(Math.abs(local[2]) < 1e-8);
});

test('scene validation rejects hierarchy cycles and zero scales', () => {
  const project = model.createProject();
  const a = model.createObject('mesh');
  const b = model.createObject('sprite');
  a.parentId = b.id;
  b.parentId = a.id;
  project.objects.push(a, b);
  assert.throws(() => model.validateProject(project), /cycle/);
  b.parentId = null;
  b.transform.sz = 0;
  assert.throws(() => model.validateProject(project), /scale cannot be zero/);
});

test('legacy object scripts migrate into reusable script attachments', () => {
  const project = model.createProject();
  const object = model.createObject('mesh', 'Spinner');
  object.script = 'rotation.y += dt;';
  project.objects.push(object);

  const normalized = model.normalizeProject(project);
  assert.equal(normalized.scripts.length, 1);
  assert.equal(normalized.scripts[0].source, 'rotation.y += dt;');
  assert.deepEqual(normalized.objects[0].scriptIds, [normalized.scripts[0].id]);
  assert.equal('script' in normalized.objects[0], false);
});

test('version 1 flat projects migrate into a single scene', () => {
  const object = model.createObject('mesh', 'Legacy Object');
  const legacy = {
    format: 'brendan-abi1-studio',
    version: 1,
    app: model.createProject().app,
    camera: { yaw: 1, pitch: 0.2, distance: 12 },
    objects: [object],
    assets: [],
    scripts: []
  };
  const normalized = model.normalizeProject(legacy);
  assert.equal(normalized.version, 2);
  assert.equal(normalized.scenes.length, 1);
  assert.equal(normalized.scenes[0].name, 'Main Scene');
  assert.equal(normalized.scenes[0].camera.distance, 12);
  assert.equal(normalized.scenes[0].objects[0].id, object.id);
});

test('prefab subtree cloning remaps IDs and retains parent links', () => {
  const project = model.createProject();
  const parent = model.createObject('mesh', 'Parent');
  const child = model.createObject('audio', 'Child');
  const script = model.createScript('Shared');
  project.scripts.push(script);
  parent.scriptIds.push(script.id);
  child.scriptIds.push(script.id);
  child.parentId = parent.id;
  project.objects.push(parent, child);
  const clone = model.cloneSubtree(project, parent.id);
  assert.equal(clone.length, 2);
  assert.notEqual(clone[0].id, parent.id);
  assert.equal(clone[1].parentId, clone[0].id);
  assert.deepEqual(clone.map(object => object.scriptIds), [[script.id], [script.id]]);
  assert.equal(clone[1].transform.x, child.transform.x);
});

test('scene binary contains flattened transforms and sprite pixels', () => {
  const project = model.createProject();
  const parent = model.createObject('mesh', 'Parent');
  parent.transform.x = 1;
  parent.transform.sx = 2;
  const sprite = model.createObject('sprite', 'Sprite');
  sprite.parentId = parent.id;
  sprite.transform.x = 1;
  const rgba = Buffer.from([255, 0, 0, 255]);
  project.objects.push(parent, sprite);
  project.assets.push({ id: 'pixels', kind: 'image', name: 'pixel.png',
    width: 1, height: 1, rgbaBytes: 4, data: rgba.toString('base64') });
  sprite.assetId = 'pixels';
  const bytes = model.toSceneData(project);
  assert.equal(uint32(bytes, 0), 2);
  assert.equal(uint32(bytes, 4), 20);
  assert.equal(uint32(bytes, 8), 1);
  const record = (4 + 4 + 1 * 20) * 4;
  assert.equal(uint32(bytes, record), 3);
  assert.equal(float32(bytes, record + 5 * 4), 3);
  const textureWord = uint32(bytes, record + 16 * 4);
  assert.deepEqual(bytes.subarray(textureWord * 4, textureWord * 4 + 4), new Uint8Array(rgba));
});

test('package scene metadata keeps combined image data outside the 7 MiB atlas', async () => {
  const project = model.createProject();
  const first = model.createObject('sprite', 'First');
  const second = model.createObject('sprite', 'Second');
  first.assetId = 'image-a';
  second.assetId = 'image-b';
  project.scenes[0].objects.push(first, second);
  const pixels = Buffer.alloc(4_000_000, 17).toString('base64');
  project.assets.push(
    { id: 'image-a', kind: 'image', name: 'a.png', width: 1000, height: 1000,
      rgbaBytes: 4_000_000, data: pixels },
    { id: 'image-b', kind: 'image', name: 'b.png', width: 1000, height: 1000,
      rgbaBytes: 4_000_000, data: pixels }
  );

  assert.throws(() => model.toSceneData(project), /7 MiB data budget/);
  const packaged = model.toScenePackageData(project);
  assert.equal(packaged.data.length, 3872);
  assert.equal(packaged.images.length, 8_000_000);
  assert.equal(uint32(packaged.data, 32 + 16 * 4), 0);
  assert.equal(uint32(packaged.data, 112 + 16 * 4), 1000 * 1000);
  assert.equal(packaged.images[0], 17);
  assert.equal(packaged.images[4_000_000], 17);
  const previewData = model.toPreviewSceneData(project);
  assert.equal(previewData.length, 8_003_872);
  assert.equal(uint32(previewData, 32 + 16 * 4), 968);
  assert.equal(uint32(previewData, 112 + 16 * 4), 1_000_968);
  const preview = new Abi1PreviewRuntime({ model, builder, canvas: {} });
  preview.project = project;
  assert.doesNotMatch(preview.previewFragmentSource(), /imageStore/);
  assert.match(preview.previewFragmentSource(), /atlasWord\(uint\(byteOffset>>2u\)\)/);

  const built = await builder.build(project);
  assert.equal(built.entries.get('assets/scene.bin').length, 3872);
  assert.equal(built.entries.get('assets/image-data.bin').length, 8_003_584);
  assert.equal(built.manifest.memory.bytes, 8_003_584);
});

test('shader generation binds input, per-object scripts, and sound to ABI-1', () => {
  const project = model.createProject();
  const object = model.createObject('mesh', 'Spinner');
  const script = model.createScript('Rotate and sound');
  script.source = 'rotation.y += dt;\nif ((buttons & HB_A) != 0u) hbSound(1u);';
  project.scripts.push(script);
  object.scriptIds.push(script.id);
  project.objects.push(object);
  const sources = builder.shaderSources(project);
  assert.match(sources.vertex, /gl_VertexIndex/);
  assert.match(sources.fragment, /objectDistance/);
  assert.match(sources.compute, /rotation\.y \+= dt/);
  assert.match(sources.compute, /hbSound\(1u\)/);
  assert.match(sources.compute, /hbStreamRequest/);
  assert.doesNotMatch(sources.compute, /#include/);
});

test('multiple reusable scripts run in attachment order and can be shared', () => {
  const project = model.createProject();
  const first = model.createScript('Move');
  first.source = 'position.x += dt;';
  const second = model.createScript('Raise');
  second.source = 'position.y += dt;';
  project.scripts.push(first, second);
  const a = model.createObject('mesh', 'A');
  a.scriptIds.push(first.id, second.id);
  const b = model.createObject('mesh', 'B');
  b.scriptIds.push(first.id);
  project.objects.push(a, b);

  const source = builder.shaderSources(project).compute;
  const firstShared = source.indexOf('position.x += dt;');
  const secondAttached = source.indexOf('position.y += dt;');
  const secondShared = source.indexOf('position.x += dt;', firstShared + 1);
  assert.ok(firstShared >= 0);
  assert.ok(secondAttached > firstShared);
  assert.ok(secondShared > secondAttached);
  assert.match(source, /if \(objectIndex == 1u\) \{\s*position\.x \+= dt;/);
});

test('script attachments must reference library entries and stay within the per-object limit', () => {
  const project = model.createProject();
  const object = model.createObject('mesh', 'Script host');
  const first = model.createScript('First');
  const second = model.createScript('Second');
  first.source = 'a'.repeat(5000);
  second.source = 'b'.repeat(4000);
  project.scripts.push(first, second);
  object.scriptIds.push(first.id, second.id);
  project.objects.push(object);
  assert.throws(() => model.validateProject(project), /attached scripts exceed the 8 KiB limit/);
  object.scriptIds = ['missing-script'];
  assert.throws(() => model.validateProject(project), /references a missing script/);
});

test('offline prompt generator creates supported individual GLSL behaviors', () => {
  const movement = generateScript('Move right at 2 units per second when pressing A');
  assert.equal(movement.name, 'Move Right on A');
  assert.match(movement.source, /buttons & HB_A/);
  assert.match(movement.source, /position\.x \+= dt \* 2/);

  const rotation = generateScript('Rotate around Z at 180 degrees per second, counterclockwise');
  assert.match(rotation.source, /rotation\.z \+= dt \* -3\.141593/);

  const color = generateScript('Set color to #FF0000 when pressing the A button');
  assert.match(color.source, /color\.rgb = vec3\(1, 0, 0\)/);
  assert.match(color.source, /buttons & HB_A/);

  const sound = generateScript('Play sound event 3 when pressing A');
  assert.match(sound.source, /hbSound\(3u\)/);
  const held = generateScript('Move left while holding the left arrow');
  assert.match(held.source, /hbButtons\(\) & HB_LEFT/);
  const exit = generateScript('Exit when pressing B');
  assert.match(exit.source, /buttons & HB_B/);
  assert.match(exit.source, /hbExit\(\)/);

  const randomColor = generateScript('Set color to a random color');
  assert.match(randomColor.source, /color\.rgb = hbRandomColor\(objectIndex\)/);
  const randomPosition = generateScript('Set position x to a random number between -2 and 2');
  assert.match(randomPosition.source, /position\.x = hbRandomRange\(-2, 2, objectIndex \+ 1u\)/);
  const randomScale = generateScript('Set scale to a random number between 1 and 3');
  assert.match(randomScale.source, /scale = vec3\(hbRandomRange\(1, 3, objectIndex \+ 2u\)\)/);
  const spawn = generateScript('Spawn a red sphere at (1, 2, 3)');
  assert.match(spawn.source, /hbSpawnOnce\(objectIndex, HB_SHAPE_SPHERE/);
  assert.match(spawn.source, /vec3\(1, 2, 3\)/);
  const spawnOnPress = generateScript('Spawn a box when pressing A');
  assert.match(spawnOnPress.source, /hbSpawnObject\(HB_SHAPE_BOX/);
  assert.match(spawnOnPress.source, /buttons & HB_A/);
  const stopSound = generateScript('Stop audio');
  assert.match(stopSound.source, /hbStopSound\(\)/);
  const switchSound = generateScript('Switch audio to sound 4');
  assert.match(switchSound.source, /hbSwitchSound\(4u\)/);
  const setObjectAudio = generateScript('Set this audio object event to 3');
  assert.match(setObjectAudio.source, /hbSetObjectAudio\(objectIndex, 3u\)/);
  const attachedAudio = generateScript('Play audio attached to this object');
  assert.match(attachedAudio.source, /hbPlayObjectAudio\(objectIndex\)/);

  const scenes = model.createProject();
  scenes.scenes.push(model.createScene(7, 'Boss Room'));
  scenes.nextSceneId = 8;
  assert.match(generateScript('Switch to the next scene', scenes, 1).source,
    /hbCurrentScene\(\) == 1u.*hbLoadScene\(7u\)/);
  assert.match(generateScript('Switch to Boss Room', scenes, 1).source,
    /hbLoadScene\(7u\)/);
  assert.match(generateScript('Switch to a random scene', scenes, 1).source,
    /hbRandom\(objectIndex\)/);
  assert.throws(() => generateScript('Make the object dance'), /could not identify a supported behavior/);
  assert.throws(() => generateScript('Move and rotate the object'), /one behavior per script/);
});

test('generated spawn, random, scene, and audio helpers compile for the ABI-1 runtime', async () => {
  const project = model.createProject();
  const spawner = model.createObject('mesh', 'Spawner');
  const sceneSwitch = model.createScene(7, 'Second Scene');
  const speaker = model.createObject('audio', 'Speaker');
  speaker.audioEventId = 3;
  project.scenes[0].objects.push(spawner, speaker);
  project.scenes.push(sceneSwitch);
  project.nextSceneId = 8;
  const scripts = [
    generateScript('Spawn a random color sphere at random position', project, 1),
    generateScript('Set position x to a random number between -2 and 2', project, 1),
    generateScript('Set this audio object event to 3', project, 1),
    generateScript('Switch to the next scene', project, 1),
    generateScript('Play audio attached to Speaker', project, 1)
  ];
  project.scripts = scripts.map(item => ({ ...model.createScript(item.name), ...item }));
  spawner.scriptIds = project.scripts.map(script => script.id);
  const result = await builder.build(project);
  assert.ok(result.entries.has('app.comp.spv'));
});

test('PC preview spawn records consume reserved scene slots and preserve spawn-once state', () => {
  const project = model.createProject();
  project.objects.push(model.createObject('mesh', 'Spawner'));
  const preview = new Abi1PreviewRuntime({ model, builder, canvas: {} });
  preview.project = model.normalizeProject(project);
  preview.sceneData = model.toPreviewSceneData(preview.project);
  preview.objectSceneIds = new Uint32Array(model.OBJECT_CAPACITY);
  preview.staticObjectIndices = new Int32Array(model.OBJECT_CAPACITY);
  preview.staticObjectIndices.fill(-1);
  preview.audioEventValues = new Uint32Array(model.OBJECT_CAPACITY);
  const output = new Float32Array(model.OBJECT_CAPACITY * 32);

  const spawned = preview.recordSpawn(1, 2, [1, 2, 3], [1, 1, 1], [0.2, 0.4, 0.6], output);
  assert.equal(spawned, 1);
  assert.equal(uint32(preview.sceneData, 24), 2);
  const record = (4 + 4 + 1 * 20) * 4;
  assert.equal(uint32(preview.sceneData, record), 2);
  assert.equal(uint32(preview.sceneData, record + 15 * 4), 0xffffffff);
  assert.equal(output[32], 1);

  preview.markSpawnOnce(1, 0, output);
  assert.equal(uint32(preview.sceneData, record - 20 * 4 + 19 * 4) >>> 31, 1);
  assert.equal(output[30], 1);
});

test('PC preview can persist a changed audio event on an audio object', () => {
  const project = model.createProject();
  const audio = model.createObject('audio', 'Speaker');
  project.objects.push(audio);
  const preview = new Abi1PreviewRuntime({ model, builder, canvas: {} });
  preview.project = model.normalizeProject(project);
  preview.sceneData = model.toPreviewSceneData(preview.project);

  preview.writeObjectAudioEvent(1, 0, 7);
  assert.equal(uint32(preview.sceneData, 32 + 14 * 4), 7);
});

test('PC preview adapts ABI-1 scene and script shaders to WebGL2', () => {
  const project = model.createProject();
  const object = model.createObject('mesh', 'Spinner');
  const script = model.createScript('Rotate');
  script.source = 'rotation.y += dt;';
  project.scripts.push(script);
  object.scriptIds.push(script.id);
  project.objects.push(object);
  const preview = new Abi1PreviewRuntime({ model, builder, canvas: {} });
  preview.project = project;

  const fragment = preview.previewFragmentSource();
  const vertex = preview.updateVertexSource();
  assert.doesNotMatch(builder.shaderSources(project).fragment, /uMaxTravel/);
  assert.match(fragment, /#version 300 es/);
  assert.match(fragment, /uniform highp usampler2D uSceneData/);
  assert.match(fragment, /uniform float uMaxTravel/);
  assert.match(fragment, /uniform uint uSceneId/);
  assert.match(fragment, /travel>uMaxTravel/);
  assert.match(fragment, /firstRecord\+i\*20u/);
  assert.match(fragment, /vec3 position=texelFetch\(uTransforms/);
  assert.doesNotMatch(fragment, /c\.atlas\[/);
  assert.match(vertex, /rotation\.y \+= dt/);
  assert.match(vertex, /bool hbSetObjectAudio\(uint objectIndex,uint eventId\)/);
  assert.match(vertex, /vExit=previewExit/);
  assert.match(preview.updateFragmentSource(), /out vec4 outColor/);
});

test('multiple isolated scenes share GLSL classes and can request runtime transitions', async () => {
  const project = model.createProject();
  const first = model.createObject('mesh', 'First object');
  project.scenes[0].objects.push(first);
  const secondScene = model.createScene(7, 'Second Scene');
  const second = model.createObject('mesh', 'Second object');
  const script = model.createScript('Switch scene');
  script.source = 'color.rgb = helperColor(); hbLoadScene(1u);';
  project.scripts.push(script);
  second.scriptIds.push(script.id);
  secondScene.objects.push(second);
  project.scenes.push(secondScene);
  project.nextSceneId = 8;
  project.classes.push({ id: 'class-color', name: 'Color Helpers',
    source: 'vec3 helperColor(){return vec3(0.2,0.4,0.6);}' });
  project.startupSceneId = 7;

  const bytes = model.toSceneData(project);
  assert.equal(uint32(bytes, 8), 2);
  assert.equal(uint32(bytes, 16), 1);
  assert.equal(uint32(bytes, 32), 7);
  assert.equal(uint32(bytes, 36), 48);
  assert.equal(uint32(bytes, 40), 1);
  const sources = builder.shaderSources(project);
  assert.match(sources.compute, /void hbLoadScene\(uint id\)/);
  assert.match(sources.compute, /helperColor\(\)/);
  assert.match(sources.fragment, /sceneRange\(c\.reserved\.x/);

  const preview = new Abi1PreviewRuntime({ model, builder, canvas: {} });
  preview.project = model.normalizeProject(project);
  assert.match(preview.updateVertexSource(), /hbLoadScene\(uint id\)/);
  assert.match(preview.updateVertexSource(), /if\(uint\(aSceneId\)==uSceneId&&aObjectIndex>=0\.0\)/);
  assert.match(preview.previewFragmentSource(), /uSceneId/);
  const built = await builder.build(project);
  assert.equal(built.sceneCount, 2);
  assert.equal(uint32(built.entries.get('assets/state.bin'), 1008), 7);
  assert.ok(built.entries.has('classes/1-Color-Helpers.glsl'));
});

test('PC preview raymarch range expands to include distant scene objects', () => {
  const preview = new Abi1PreviewRuntime({ model, builder, canvas: {} });
  preview.sceneCount = 1;
  preview.transformValues = new Float32Array(16);
  preview.transformValues[0] = 100;
  preview.transformValues[8] = 1;
  preview.transformValues[9] = 1;
  preview.transformValues[10] = 1;

  assert.ok(preview.maxTravelDistance() > 100);
});

test('browser builder compiles and packages a catalog-valid ABI-1 app', async t => {
  const project = model.createProject();
  project.app.id = `abi1-studio-test-${process.pid}`;
  const sprite = model.createObject('sprite', 'Sprite');
  sprite.assetId = 'image-asset';
  project.objects.push(sprite);
  project.assets.push({ id: 'image-asset', kind: 'image', name: 'pixel.png',
    width: 1, height: 1, rgbaBytes: 4, data: Buffer.from([40, 180, 220, 255]).toString('base64') });
  const shared = model.createScript('Shared tint');
  shared.source = generateScript('set color to blue').source;
  project.scripts.push(shared);
  sprite.scriptIds.push(shared.id);
  const movement = model.createScript('Prompt movement');
  movement.source = generateScript('move right at 2 units per second when pressing A').source;
  project.scripts.push(movement);
  sprite.scriptIds.push(movement.id);
  const sound = model.createObject('audio', 'Click');
  sound.audioEventId = 1;
  const rotation = model.createScript('Prompt rotation');
  rotation.source = generateScript('rotate around Y at 90 degrees per second').source;
  const soundScript = model.createScript('Play click');
  soundScript.source = generateScript('play sound 1 when pressing A').source;
  project.scripts.push(rotation, soundScript);
  sound.scriptIds.push(shared.id, rotation.id, soundScript.id);
  project.objects.push(sound);
  project.assets.push({ id: 'sound-asset', kind: 'audio', eventId: 1, name: 'click.pcm',
    data: Buffer.from([0, 0, 0, 0]).toString('base64') });
  project.assets.push({ id: 'mesh-asset', kind: 'mesh', name: 'model.obj',
    data: Buffer.from('o model\n').toString('base64') });
  const output = path.join(__dirname, 'exports', project.app.id);
  const zipPath = `${output}.zip`;
  t.after(() => {
    fs.rmSync(output, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  });
  const result = await builder.build(project);
  assert.equal(result.sceneObjects, 2);
  assert.equal(uint32(result.entries.get('assets/scene.bin'), 0), 2);
  assert.ok(result.entries.has('assets/image-data.bin'));
  assert.ok(result.entries.has('assets/stream/mesh_1.obj'));
  assert.match(new TextDecoder().decode(result.entries.get('app.json')), /"streamedAssets"/);
  assert.equal(uint32(result.bytes, 0), 0x04034b50);
  assert.equal(uint32(result.bytes, result.bytes.length - 22), 0x06054b50);
  const zipped = readStoredZip(result.bytes);
  assert.deepEqual([...zipped.keys()], [...result.entries.keys()]);
  for (const [name, bytes] of result.entries)
    assert.deepEqual(zipped.get(name), bytes, `ZIP contents for ${name}`);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(zipPath, result.bytes);
  for (const [name, bytes] of result.entries) {
    const file = path.join(output, ...name.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  const app = await require('../../homebrew-launcher/app-catalog.cjs').readApp(output);
  assert.equal(app.manifest.format, 'hblauncher.gpu-app');
  assert.equal(app.manifest.abi, 1);
  assert.equal(app.files.memory.bytes.length, 4096);
  assert.deepEqual(Object.keys(app.effects), ['1']);
  assert.equal(app.streamedAssets.length, 1);
  assert.equal(app.files.data.bytes.readUInt32LE(0), 2);
});
